import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, FileText, Flag, Loader2, MessageSquareText, Minus, Paperclip, Plus, Save, Trash2, UsersRound, X } from 'lucide-react';
import api from '../../services/api';
import { API_ENDPOINTS } from '../../services/apiEndpoints';
import { uploadMediaBatch } from '../../services/mediaUpload';

const MILESTONES = [
  { key: 'leadClosure', label: 'Lead Closure', description: 'Confirm whether the qualified lead has been closed.', icon: Flag, tone: 'emerald', auto: true },
  { key: 'poReceived', label: 'PO Received', description: 'Track the purchase order and its supporting proof.', icon: FileText, tone: 'orange', auto: true },
  { key: 'kickOffMeeting', label: 'Kick-off Meeting', description: 'Record the first formal delivery meeting.', icon: UsersRound, tone: 'blue', auto: false }
];

const TONES = {
  emerald: { icon: 'bg-emerald-100 text-emerald-700', active: 'bg-emerald-600 text-white', soft: 'border-emerald-100 bg-emerald-50 text-emerald-800', action: 'bg-emerald-700 hover:bg-emerald-800' },
  orange: { icon: 'bg-orange-100 text-orange-700', active: 'bg-orange-500 text-white', soft: 'border-orange-100 bg-orange-50 text-orange-800', action: 'bg-orange-500 hover:bg-orange-600' },
  blue: { icon: 'bg-blue-100 text-blue-700', active: 'bg-blue-600 text-white', soft: 'border-blue-100 bg-blue-50 text-blue-800', action: 'bg-blue-600 hover:bg-blue-700' }
};

const emptyMilestone = () => ({ date: '', completed: 'no', remark: '', moms: [], proofs: [] });
const newFollowUp = () => ({ id: `follow-up-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, remark: '', date: '', status: 'Pending', priority: 'Medium' });
const emptyLifecycle = () => ({ milestones: Object.fromEntries(MILESTONES.map(({ key }) => [key, emptyMilestone()])), workFollowUps: [] });

function normalizeLifecycle(value) {
  const base = emptyLifecycle();
  const stored = value && typeof value === 'object' ? value : {};
  return {
    milestones: Object.fromEntries(MILESTONES.map(({ key }) => [key, {
      ...base.milestones[key],
      ...(stored.milestones?.[key] || {}),
      moms: stored.milestones?.[key]?.moms || [],
      proofs: stored.milestones?.[key]?.proofs || []
    }])),
    workFollowUps: Array.isArray(stored.workFollowUps) ? stored.workFollowUps : []
  };
}

function dateInputValue(value) {
  if (!value) return '';
  const direct = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function displayDate(value) {
  const input = dateInputValue(value);
  if (!input) return 'Not available';
  return new Date(`${input}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function rowServiceId(row = {}) {
  return String(row.assignedServiceId || row.serviceAssignmentId || row.assignmentId || '').trim();
}

function closureEvidence(row = {}) {
  return Boolean(row.closedBy || String(row.closedByText || '').trim() || row.closedAt);
}

function deriveAutoStages(client = {}, data = {}) {
  const lead = client.selectedLead && typeof client.selectedLead === 'object' ? client.selectedLead : {};
  const assignedServiceId = String(client.assignedServiceId || data.assignedServiceId || data.selectedLeadSnapshot?.assignedServiceId || '').trim();
  const assignments = Array.isArray(lead.assignments) ? lead.assignments : [];
  const services = Array.isArray(lead.serviceSelections) ? lead.serviceSelections : [];
  const assignmentIndex = assignedServiceId ? assignments.findIndex((row) => rowServiceId(row) === assignedServiceId) : -1;
  const serviceIndex = assignedServiceId ? services.findIndex((row) => rowServiceId(row) === assignedServiceId) : -1;
  const resolvedIndex = assignmentIndex >= 0 ? assignmentIndex : serviceIndex >= 0 ? serviceIndex : (Math.max(assignments.length, services.length) === 1 ? 0 : -1);
  const assignment = assignments[resolvedIndex] || {};
  const service = services[resolvedIndex] || {};
  const allowLeadFallback = services.length <= 1 && assignments.length <= 1;
  const leadClosed = closureEvidence(assignment) || closureEvidence(service) || (allowLeadFallback && (closureEvidence(lead) || /closed/i.test(String(lead.status || ''))));
  const closureDate = assignment.closedAt || assignment.permanentClosedAt || service.closedAt
    || (allowLeadFallback ? (lead.closedAt || lead.closureDate) : '')
    || (leadClosed ? (lead.updatedAt || lead.importedUpdatedAt || client.updatedAt || client.createdAt) : '');
  const closedBy = assignment.closedBy?.name || assignment.closedByText || service.closedBy?.name || service.closedByText || lead.closedBy?.name || lead.closedByText || '';
  const poRows = Array.isArray(assignment.poYearRows) ? assignment.poYearRows : [];
  const receivedRows = poRows.filter((row) => String(row?.poNumber || row?.poFileUrl || row?.poProofUrl || row?.poReceivedDate || '').trim());
  const poStatusReceived = /yes|received|approved|complete/i.test(String(assignment.poStatus || ''));
  const poReceived = receivedRows.length > 0 || poStatusReceived;
  const firstDatedPo = receivedRows.find((row) => row.poReceivedDate || row.poDate) || {};
  const poTargetDate = firstDatedPo.poReceivedDate || firstDatedPo.poDate || assignment.permanentClosedAt
    || assignment.closedAt || (poReceived ? (lead.closedAt || lead.updatedAt || lead.importedUpdatedAt || client.updatedAt || client.createdAt) : '');
  const poProofs = receivedRows.map((row, index) => {
    const url = String(row.poFileUrl || row.poProofUrl || '').trim();
    return url ? { name: row.poFileName || row.poNumber || `PO proof ${index + 1}`, url, secureUrl: url, autoFetched: true } : null;
  }).filter(Boolean);
  const poNumbers = [...new Set(receivedRows.map((row) => String(row.poNumber || '').trim()).filter(Boolean))];
  const poAmount = receivedRows.reduce((total, row) => total + (Number(row.poAmount) || 0), 0);
  return {
    leadGeneratedAt: lead.leadDate || lead.importedCreatedAt || lead.createdAt || data.selectedLeadSnapshot?.createdAt || client.createdAt,
    leadClosure: { completed: leadClosed ? 'yes' : 'no', date: dateInputValue(closureDate), details: [closedBy ? `Closed by ${closedBy}` : '', lead.status ? `Lead status: ${lead.status}` : ''].filter(Boolean) },
    poReceived: { completed: poReceived ? 'yes' : 'no', date: dateInputValue(poTargetDate), details: [poNumbers.length ? `PO: ${poNumbers.join(', ')}` : '', poAmount ? `Value: ₹${poAmount.toLocaleString('en-IN')}` : '', assignment.poStatus ? `Status: ${assignment.poStatus}` : ''].filter(Boolean), proofs: poProofs }
  };
}

function applyAutoStages(lifecycle, autoStages) {
  return {
    ...lifecycle,
    milestones: {
      ...lifecycle.milestones,
      leadClosure: { ...lifecycle.milestones.leadClosure, completed: autoStages.leadClosure.completed, date: autoStages.leadClosure.date },
      poReceived: { ...lifecycle.milestones.poReceived, completed: autoStages.poReceived.completed, date: autoStages.poReceived.date }
    }
  };
}

function MomModal({ milestoneLabel, onClose, onSave }) {
  const [mom, setMom] = useState(() => ({ id: `mom-${Date.now()}`, date: '', subject: '', points: [''] }));
  const points = mom.points?.length ? mom.points : [''];
  const valid = Boolean(mom.date && mom.subject.trim() && points.some((point) => point.trim()));
  const updatePoint = (index, value) => setMom((current) => ({ ...current, points: points.map((point, currentIndex) => currentIndex === index ? value : point) }));
  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="mom-modal-title">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/70 bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-teal-100 bg-gradient-to-r from-teal-50 via-white to-orange-50 p-6 text-slate-800"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-orange-500">Minutes of meeting</p><h3 id="mom-modal-title" className="mt-1 text-2xl font-black text-teal-900">{milestoneLabel} MOM</h3></div><button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl border border-teal-100 bg-white text-teal-700 shadow-sm hover:bg-teal-50" aria-label="Close MOM popup"><X className="h-5 w-5" /></button></header>
        <div className="space-y-5 p-6"><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-black text-slate-700">Meeting date<input type="date" value={mom.date} onChange={(event) => setMom((current) => ({ ...current, date: event.target.value }))} className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-100" /></label><label className="text-sm font-black text-slate-700">Subject<input value={mom.subject} maxLength={200} onChange={(event) => setMom((current) => ({ ...current, subject: event.target.value }))} placeholder="Meeting subject" className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-100" /></label></div>
          <div><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-black text-slate-800">MOM points</p><p className="text-xs font-semibold text-slate-500">Add each discussion or action item separately.</p></div><button type="button" onClick={() => setMom((current) => ({ ...current, points: [...points, ''] }))} className="inline-flex items-center gap-2 rounded-xl bg-orange-50 px-3 py-2 text-xs font-black text-orange-700"><Plus className="h-4 w-4" /> Add point</button></div><div className="mt-3 space-y-3">{points.map((point, index) => <div key={`${mom.id}-point-${index}`} className="flex gap-2"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-sm font-black text-slate-500">{index + 1}</span><textarea value={point} maxLength={500} rows="2" onChange={(event) => updatePoint(index, event.target.value)} placeholder="Write MOM point..." className="min-h-11 flex-1 resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-100" />{points.length > 1 ? <button type="button" onClick={() => setMom((current) => ({ ...current, points: points.filter((_, currentIndex) => currentIndex !== index) }))} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50" aria-label={`Remove MOM point ${index + 1}`}><Minus className="h-4 w-4" /></button> : null}</div>)}</div></div>
        </div>
        <footer className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50 p-5"><button type="button" onClick={onClose} className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-600">Cancel</button><button type="button" disabled={!valid} onClick={() => onSave({ ...mom, points: points.map((point) => point.trim()).filter(Boolean) })} className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-45"><Check className="h-4 w-4" /> Save MOM</button></footer>
      </div>
    </div>
  );
}

function StageRow({ index, milestone, value, autoData, busy, onChange, onSave, onOpenMom, onRemoveMom, onUploadProof, onRemoveProof }) {
  const tone = TONES[milestone.tone];
  const Icon = milestone.icon;
  const allProofs = [...(autoData?.proofs || []), ...(value.proofs || [])];
  return (
    <tr className="border-b border-slate-200 align-middle last:border-0">
      <td className="px-4 py-7 text-center text-sm font-black text-slate-500">{index + 1}</td>
      <td className="px-4 py-7"><div className="flex items-center gap-3"><span className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${tone.icon}`}><Icon className="h-5 w-5" /></span><div><p className="font-black text-slate-950">{milestone.label}</p>{milestone.auto ? <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${tone.soft}`}>Auto synced</span> : null}</div></div></td>
      <td className="px-4 py-7"><p className="max-w-[210px] text-sm font-semibold leading-6 text-slate-600">{milestone.description}</p>{autoData?.details?.length ? <div className="mt-2 space-y-1">{autoData.details.map((detail) => <p key={detail} className="text-[10px] font-black text-slate-500">{detail}</p>)}</div> : null}</td>
      <td className="px-4 py-7"><input aria-label={`${milestone.label} date`} type="date" value={value.date || ''} disabled={milestone.auto} onChange={(event) => onChange({ date: event.target.value })} title={milestone.auto ? 'Fetched automatically from Lead Generation' : ''} className="h-12 w-40 rounded-xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-800 outline-none focus:border-orange-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-600" /></td>
      <td className="px-4 py-7"><div className="grid w-36 grid-cols-2 rounded-xl border border-slate-200 bg-slate-50 p-1">{['yes', 'no'].map((choice) => <button key={choice} type="button" disabled={milestone.auto} onClick={() => onChange({ completed: choice })} className={`rounded-lg px-3 py-2.5 text-xs font-black capitalize transition disabled:cursor-not-allowed ${value.completed === choice ? tone.active : 'text-slate-600'}`}>{choice}</button>)}</div></td>
      <td className="px-4 py-7"><textarea aria-label={`${milestone.label} remark`} value={value.remark || ''} maxLength={1000} onChange={(event) => onChange({ remark: event.target.value })} rows="3" placeholder="Add clear remark..." className="min-h-[84px] w-60 resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-100" /></td>
      <td className="px-4 py-7"><button type="button" onClick={onOpenMom} className={`inline-flex w-36 items-center justify-center gap-2 rounded-xl border px-3 py-3 text-xs font-black ${tone.soft}`}><MessageSquareText className="h-4 w-4" /> {value.moms?.length ? `${value.moms.length} MOM` : 'Add MOM'}</button>{value.moms?.map((mom, momIndex) => <div key={mom.id || momIndex} className="mt-2 flex w-36 items-center gap-2 rounded-lg bg-slate-50 p-2 text-[10px] font-bold text-slate-600"><span className="min-w-0 flex-1 truncate">{mom.subject}</span><button type="button" onClick={() => onRemoveMom(momIndex)} className="text-rose-600" aria-label={`Remove ${mom.subject || 'MOM'}`}><Trash2 className="h-3.5 w-3.5" /></button></div>)}</td>
      <td className="px-4 py-7"><label className="flex min-h-12 w-36 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 shadow-sm hover:border-orange-300 hover:text-orange-700"><Paperclip className="h-4 w-4" />{busy === `proof-${milestone.key}` ? 'Uploading...' : 'Add proof'}<input type="file" multiple accept="image/*,.pdf" className="sr-only" disabled={Boolean(busy)} onChange={(event) => onUploadProof(event.target.files, event.target)} /></label>{allProofs.map((file, proofIndex) => <div key={`${file.url}-${proofIndex}`} className="mt-2 flex w-36 items-center gap-2 rounded-lg bg-slate-50 p-2"><a href={file.secureUrl || file.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[10px] font-black text-slate-700 underline">{file.name || `Proof ${proofIndex + 1}`}</a>{file.autoFetched ? <span className="text-[8px] font-black uppercase text-emerald-700">Auto</span> : <button type="button" onClick={() => onRemoveProof(proofIndex - (autoData?.proofs?.length || 0))} className="text-rose-600" aria-label={`Remove ${file.name || 'proof'}`}><X className="h-3.5 w-3.5" /></button>}</div>)}</td>
      <td className="px-4 py-7"><button type="button" disabled={Boolean(busy)} onClick={onSave} className={`inline-flex w-32 items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-black text-white shadow-sm disabled:opacity-50 ${tone.action}`}>{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Done</button></td>
    </tr>
  );
}

export default function ClientLifecycleTracker({ client, data, onClientUpdated }) {
  const clientId = String(client?._id || client?.id || '');
  const autoStages = useMemo(() => deriveAutoStages(client, data), [client, data]);
  const autoSyncKey = `${autoStages.leadClosure.completed}|${autoStages.leadClosure.date}|${autoStages.poReceived.completed}|${autoStages.poReceived.date}`;
  const [lifecycle, setLifecycle] = useState(() => applyAutoStages(normalizeLifecycle(data?.clientLifecycle), deriveAutoStages(client, data)));
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);
  const [momTarget, setMomTarget] = useState('');
  const completedCount = useMemo(() => MILESTONES.filter(({ key }) => lifecycle.milestones[key]?.completed === 'yes').length, [lifecycle.milestones]);
  const progress = Math.round((completedCount / MILESTONES.length) * 100);

  useEffect(() => { setLifecycle(applyAutoStages(normalizeLifecycle(data?.clientLifecycle), autoStages)); setMessage(null); setMomTarget(''); }, [clientId, data?.clientLifecycle, autoSyncKey]);

  const setMilestone = (key, patch) => setLifecycle((current) => ({ ...current, milestones: { ...current.milestones, [key]: { ...current.milestones[key], ...patch } } }));
  const save = async () => {
    if (!clientId) return;
    setBusy('save'); setMessage(null);
    try {
      const payload = applyAutoStages(lifecycle, autoStages);
      const response = await api.put(API_ENDPOINTS.clients.lifecycle(clientId), payload);
      const saved = applyAutoStages(normalizeLifecycle(response.data?.lifecycle || payload), autoStages);
      setLifecycle(saved);
      onClientUpdated?.({ ...client, data: { ...data, clientLifecycle: response.data?.lifecycle || saved } });
      setMessage({ type: 'success', text: 'Sales process checklist saved successfully.' });
    } catch (error) { setMessage({ type: 'error', text: error?.response?.data?.error || 'Unable to save sales process checklist.' }); }
    finally { setBusy(''); }
  };
  const uploadProof = async (key, files, input) => {
    if (!files?.length) return;
    setBusy(`proof-${key}`); setMessage(null);
    try {
      const remaining = Math.max(0, 10 - (lifecycle.milestones[key].proofs?.length || 0));
      const uploaded = await uploadMediaBatch(Array.from(files).slice(0, remaining), `crm/client-lifecycle/${clientId}/${key}`);
      setMilestone(key, { proofs: [...(lifecycle.milestones[key].proofs || []), ...uploaded] });
    } catch (error) { setMessage({ type: 'error', text: error.message || 'Proof upload failed.' }); }
    finally { setBusy(''); if (input) input.value = ''; }
  };
  const updateFollowUp = (id, patch) => setLifecycle((current) => ({ ...current, workFollowUps: current.workFollowUps.map((row) => row.id === id ? { ...row, ...patch } : row) }));

  return (
    <div className="mt-5 space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><div className="grid gap-6 lg:grid-cols-[1fr_480px] lg:items-center"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-orange-500">Lead generated {displayDate(autoStages.leadGeneratedAt)}</p><h3 className="mt-2 text-2xl font-black text-slate-950">Sales Process Checklist</h3><p className="mt-2 text-sm font-semibold text-slate-500">Track and complete all key steps to convert a qualified lead into an active client.</p></div><div><div className="flex items-end justify-between gap-4"><div><p className="text-sm font-black text-slate-900">Overall Progress</p><p className="mt-1 text-xs font-bold text-slate-500">Lead Closure and PO update automatically</p></div><p className="text-sm font-black text-slate-600">{completedCount} of 3 Completed <span className="ml-3 text-xl text-orange-500">{progress}%</span></p></div><div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400 transition-all duration-500" style={{ width: `${progress}%` }} /></div></div></div></section>

      {message ? <div role="status" className={`rounded-xl border px-4 py-3 text-sm font-black ${message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>{message.text}</div> : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[1500px]"><thead><tr className="border-b border-slate-200 bg-slate-50/80 text-left text-xs font-black text-slate-500"><th className="w-16 px-4 py-5 text-center">#</th><th className="w-52 px-4 py-5">Stage</th><th className="w-60 px-4 py-5">Description</th><th className="w-48 px-4 py-5">Target Date</th><th className="w-44 px-4 py-5">Completed?</th><th className="w-72 px-4 py-5">User Remark</th><th className="w-44 px-4 py-5">MOM</th><th className="w-44 px-4 py-5">Proof</th><th className="w-40 px-4 py-5">Action</th></tr></thead><tbody>{MILESTONES.map((milestone, index) => <StageRow key={milestone.key} index={index} milestone={milestone} value={lifecycle.milestones[milestone.key]} autoData={autoStages[milestone.key]} busy={busy} onChange={(patch) => setMilestone(milestone.key, patch)} onSave={save} onOpenMom={() => setMomTarget(milestone.key)} onRemoveMom={(momIndex) => setMilestone(milestone.key, { moms: lifecycle.milestones[milestone.key].moms.filter((_, current) => current !== momIndex) })} onUploadProof={(files, input) => uploadProof(milestone.key, files, input)} onRemoveProof={(proofIndex) => setMilestone(milestone.key, { proofs: lifecycle.milestones[milestone.key].proofs.filter((_, current) => current !== proofIndex) })} />)}</tbody></table></div><footer className="flex items-center justify-between border-t border-slate-200 px-6 py-5"><p className="text-sm font-bold text-slate-500">Showing 1 to 3 of 3 steps</p><div className="flex items-center gap-2"><button type="button" disabled className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-300" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button><span className="grid h-10 w-10 place-items-center rounded-xl bg-orange-500 text-sm font-black text-white">1</span><button type="button" disabled className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-300" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button></div></footer></section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><header className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/80 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-orange-500">Execution desk</p><h4 className="mt-1 text-xl font-black text-slate-950">Work follow-ups</h4><p className="mt-1 text-xs font-semibold text-slate-500">Create dated actions and track each item until completion.</p></div><button type="button" onClick={() => setLifecycle((current) => ({ ...current, workFollowUps: [...current.workFollowUps, newFollowUp()] }))} className="inline-flex w-fit items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-xs font-black text-teal-800 shadow-sm hover:bg-teal-100"><Plus className="h-4 w-4" /> Add follow-up</button></header>
        <div className="overflow-x-auto"><table className="w-full min-w-[900px]"><thead><tr className="border-b border-slate-200 bg-white text-left text-[10px] font-black uppercase tracking-wider text-slate-500"><th className="w-16 px-4 py-3">#</th><th className="px-4 py-3">Work / remark</th><th className="w-44 px-4 py-3">Target Date</th><th className="w-36 px-4 py-3">Priority</th><th className="w-48 px-4 py-3">Status</th><th className="w-20 px-4 py-3 text-center">Cut</th></tr></thead><tbody>{lifecycle.workFollowUps.length ? lifecycle.workFollowUps.map((row, index) => <tr key={row.id} className="border-b border-slate-100 last:border-0"><td className="px-4 py-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-orange-50 text-xs font-black text-orange-700">{index + 1}</span></td><td className="px-4 py-3"><input value={row.remark} maxLength={1000} onChange={(event) => updateFollowUp(row.id, { remark: event.target.value })} placeholder="Enter work follow-up remark" className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-100" /></td><td className="px-4 py-3"><input type="date" value={row.date} onChange={(event) => updateFollowUp(row.id, { date: event.target.value })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none focus:border-orange-400" /></td><td className="px-4 py-3"><select value={row.priority || 'Medium'} onChange={(event) => updateFollowUp(row.id, { priority: event.target.value })} className={`h-11 w-full rounded-xl border px-3 text-sm font-black outline-none ${row.priority === 'High' ? 'border-rose-200 bg-rose-50 text-rose-700' : row.priority === 'Low' ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}><option>High</option><option>Medium</option><option>Low</option></select></td><td className="px-4 py-3"><select value={row.status} onChange={(event) => updateFollowUp(row.id, { status: event.target.value })} className={`h-11 w-full rounded-xl border px-3 text-sm font-black outline-none ${row.status === 'Done' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : row.status === 'In Progress' ? 'border-orange-200 bg-orange-50 text-orange-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`}><option>Pending</option><option>In Progress</option><option>Done</option></select></td><td className="px-4 py-3 text-center"><button type="button" onClick={() => setLifecycle((current) => ({ ...current, workFollowUps: current.workFollowUps.filter((item) => item.id !== row.id) }))} className="grid h-10 w-10 place-items-center rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50" aria-label={`Remove follow-up ${index + 1}`}><Trash2 className="h-4 w-4" /></button></td></tr>) : <tr><td colSpan="6" className="px-5 py-12 text-center"><ClipboardList className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-black text-slate-700">No work follow-ups added</p><p className="mt-1 text-xs font-semibold text-slate-500">Use Add follow-up to create the first action row.</p></td></tr>}</tbody></table></div>
        <footer className="flex justify-end border-t border-slate-200 bg-slate-50/60 p-4"><button type="button" disabled={Boolean(busy)} onClick={save} className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-black text-white shadow hover:bg-orange-600 disabled:opacity-50">{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Done & save all</button></footer>
      </section>

      {momTarget ? <MomModal milestoneLabel={MILESTONES.find(({ key }) => key === momTarget)?.label || 'Meeting'} onClose={() => setMomTarget('')} onSave={(mom) => { setMilestone(momTarget, { moms: [...lifecycle.milestones[momTarget].moms, mom] }); setMomTarget(''); }} /> : null}
    </div>
  );
}
