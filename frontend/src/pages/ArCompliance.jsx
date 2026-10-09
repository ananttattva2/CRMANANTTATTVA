import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, FileCheck2, Loader2, LockKeyhole, RefreshCw } from 'lucide-react';
import DashboardShell from '../components/dashboard/DashboardShell';
import PendingApproval from './PendingApproval';
import ArReviewData from './ArReviewData';
import ArReviewDialog from './ArReviewDialog';
import { hasAnyRole } from '../constants/dashboard';
import api from '../services/api';
import './arCompliance.css';
const human = value => String(value || 'NOT_REVIEWED').replaceAll('_', ' ');
const endpoint = id => `/clients/${encodeURIComponent(id)}/ar-compliance`;
function Status({
  value
}) {
  return <span className="ar-status" data-status={value}>{human(value)}</span>;
}
function DataItem({
  field
}) {
  const [reveal, setReveal] = useState(false);
  const sensitive = /password|secret|token/i.test(field.label);
  return <article className={`ar-field ${field.kind ? 'ar-table-review' : ''} ${field.kind === 'upload' ? 'ar-upload-review' : ''}`}>
    {field.kind !== 'tracker' && !/Entity List$/.test(field.label) && <h3>{field.label}</h3>}
    <div className="ar-value">{sensitive && !reveal ? '••••••••' : <ArReviewData field={field} />}{sensitive && <button className="ml-2 inline-flex items-center gap-1 text-xs text-teal-700" onClick={() => setReveal(value => !value)} aria-label={`${reveal ? 'Hide' : 'Show'} ${field.label}`}><Eye size={14} />{reveal ? 'Hide' : 'Show'}</button>}</div>
  </article>;
}
function SectionData({
  section
}) {
  if (!section) return null;
  const entities = section.fields.filter(field => /Entity List$/.test(field.label));
  const fields = section.fields.filter(field => !entities.includes(field) && !/^(Validation & Reconciliation Issues|Supporting Screenshots|User Remarks|(?:Purchase|Sales) (?:Base|Portal) Excel Table)$/.test(field.label));
  const summaryIndex = fields.findIndex(field => field.kind === 'summary');
  const dataItem = field => <DataItem key={field.key} field={field} />;
  return <div className="ar-fields">{fields.map((field, index) => <React.Fragment key={field.key}>{dataItem(field)}{index === summaryIndex && entities.length > 0 && <div className="ar-entity-pair">{entities.map(dataItem)}</div>}</React.Fragment>)}{summaryIndex < 0 && entities.map(dataItem)}</div>;
}
function Workflow({
  payload
}) {
  const {
    workflow,
    managerDecision
  } = payload;
  return <section className="ar-workflow ar-card">
    <div className={`ar-step ${workflow.stage.startsWith('MANAGER') ? 'is-current' : 'is-done'}`}><strong>1. Manager Review</strong><span>{human(workflow.managerStatus)}</span></div><span className="ar-stage-arrow">→</span>
    <div className={`ar-step ${workflow.stage === 'COMPLIANCE_REVIEW' ? 'is-current' : workflow.stage === 'COMPLETED' ? 'is-done' : ''}`}><strong>2. Compliance Review</strong><span>{human(workflow.complianceStatus)}</span></div>
    <p className="ar-muted">Current stage: <b>{workflow.stageLabel}</b>{!payload.canReview && ' · Waiting for the current stage reviewer'}</p>
    {managerDecision?.at && <p className="ar-manager-note"><b>Manager decision:</b> {human(managerDecision.status)} · {managerDecision.by} · {new Date(managerDecision.at).toLocaleString('en-IN')}<br />{managerDecision.remarks}</p>}
  </section>;
}
export function ArComplianceWorkspace({
  clientId
}) {
  const navigate = useNavigate();
  const [payload, setPayload] = useState(null),
    [year, setYear] = useState(() => new URLSearchParams(window.location.search).get('financialYear') || '');
  const [activeKey, setActiveKey] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [loading, setLoading] = useState(true),
    [loadVersion, setLoadVersion] = useState(0),
    [saving, setSaving] = useState('');
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [decision, setDecision] = useState(''),
    [finalRemarks, setFinalRemarks] = useState('');
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPayload(null);
    setReviewOpen(false);
    setError('');
    setNotice('');
    setDecision('');
    api.get(endpoint(clientId), {
      params: {
        financialYear: year || undefined
      }
    }).then(({
      data
    }) => {
      if (cancelled) return;
      setPayload(data);
      setActiveKey(data.sections[0]?.key || '');
      setFinalRemarks(data.finalRemarks || '');
    }).catch(err => {
      if (!cancelled) setError(err?.response?.data?.error || 'Unable to load AR data.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [clientId, year, loadVersion]);
  async function submitDecision() {
    setSaving('decision');
    setError('');
    setNotice('');
    try {
      const {
        data
      } = await api.post(`${endpoint(clientId)}/decision`, {
        financialYear: payload.financialYear,
        reviewStage: payload.reviewStage,
        sourceFingerprint: payload.sourceFingerprint,
        decision,
        remarks: finalRemarks
      });
      setPayload(data);
      setFinalRemarks(data.finalRemarks || '');
      setDecision('');
      setReviewOpen(false);
      setNotice(payload.reviewStage === 'manager' && decision === 'APPROVED' ? 'Manager approved. AR data is now with Compliance for review.' : `${payload.reviewStage === 'manager' ? 'Manager' : 'Compliance'} decision saved: ${human(decision)}.`);
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to save decision.');
    } finally {
      setSaving('');
    }
  }
  const section = payload?.sections.find(item => item.key === activeKey);
  const manager = payload?.reviewStage === 'manager';
  const canReview = Boolean(payload?.canReview);
  const validDecision = ['APPROVED', 'REJECTED', ...(!manager ? ['PARTIALLY_APPROVED'] : [])].includes(decision);
  return <div className="ar-review">
    <header className="ar-heading ar-card"><div className="ar-heading-left"><button className="ar-back" aria-label="Back to AR Compliance list" onClick={() => navigate('/compliance/ar')}><ArrowLeft size={18} /></button><div><p className="ar-eyebrow">AR Review Workspace · {manager ? 'Manager' : 'Compliance'}</p><h1>{payload?.client.name || 'Annual Return Review'}</h1><p className="ar-muted flex items-center gap-2"><LockKeyhole size={13} />User data is read-only · {payload?.client.code || '-'}</p></div></div><span className="ar-readonly-badge"><LockKeyhole size={14} />Read-only AR data</span></header>
    <div className="ar-card ar-filter mb-3"><label className="ar-year">Financial Year<select value={year || payload?.financialYear || ''} onChange={event => setYear(event.target.value)} disabled={Boolean(saving) || loading}><option value="" disabled>Select financial year</option>{payload?.years.map(value => <option key={value} value={value}>{value}</option>)}</select></label><Status value={payload?.status || 'PENDING'} /><p className="ar-muted">Review the complete AR data and submit one final decision.</p></div>
    {payload?.workflow && <Workflow payload={payload} />}
    {error && <div role="alert" className="ar-alert">{error}{!payload && <button className="ml-3 underline" onClick={() => setLoadVersion(value => value + 1)}>Reload data</button>}</div>}{notice && <div role="status" className="ar-notice">{notice}</div>}
    {loading ? <div className="ar-empty"><Loader2 className="mx-auto animate-spin" /><p>Loading saved annual-return data…</p></div> : !payload?.sections.length ? <div className="ar-card ar-empty">AR review becomes available after both Base Data and Portal Upload Excel files are successfully imported.</div> : <>
      <div className="ar-grid"><aside className="ar-card ar-nav"><header><h2>AR Data</h2><p className="ar-muted">View saved client information</p></header>{payload.sections.map(item => <button key={item.key} aria-current={activeKey === item.key} disabled={Boolean(saving)} onClick={() => setActiveKey(item.key)}>{item.label}</button>)}</aside>
        <main className="ar-card overflow-hidden"><header className="ar-section-header ar-section-actions"><div><h2>{section?.label}</h2><p className="ar-muted">Review the upload tracker, supporting documents and reconciliation. All user data is read-only.</p></div><button type="button" className="ar-save" disabled={!canReview || Boolean(saving)} onClick={() => setReviewOpen(true)}><FileCheck2 size={15} />{manager ? 'Manager Review' : 'Compliance Review'}</button></header><SectionData key={`${payload.financialYear}:${section?.key}`} section={section} /></main></div>
      {reviewOpen && <ArReviewDialog title={manager ? 'Manager Review' : 'Compliance Review'} busy={Boolean(saving)} onClose={() => setReviewOpen(false)}><p className="ar-muted mb-4">{payload.client.name} · {payload.financialYear}</p>{error && <div role="alert" className="ar-alert">{error}</div>}      <form className="ar-final" onSubmit={event => {
          event.preventDefault();
          if (canReview && validDecision && finalRemarks.trim() && !saving) submitDecision();
        }}><label>Final {manager ? 'manager' : 'compliance'} remarks *<textarea disabled={!canReview || Boolean(saving)} rows={3} maxLength={2000} value={finalRemarks} onChange={event => setFinalRemarks(event.target.value)} placeholder="Enter your final review, decision and any required corrections…" /><span className="ar-muted">One final review applies to all AR data for this financial year.</span></label><div className="grid content-start gap-3"><label>Final {manager ? 'manager' : 'compliance'} decision<select value={decision} onChange={event => setDecision(event.target.value)} disabled={!canReview || Boolean(saving)}><option value="">Select decision</option><option value="APPROVED">Approve</option><option value="REJECTED">Reject</option>{!manager && <option value="PARTIALLY_APPROVED">Partially Approve</option>}</select></label><button type="submit" className="ar-save flex items-center gap-2 justify-center w-full" disabled={!canReview || !validDecision || !finalRemarks.trim() || Boolean(saving)}><FileCheck2 size={15} />{saving === 'decision' ? 'Submitting…' : 'Submit Final Review'}</button></div></form></ArReviewDialog>}

    </>}
  </div>;
}
export default function ArComplianceList() {
  const [currentUser] = useState(() => JSON.parse(localStorage.getItem('user') || 'null'));
  const [queueTab, setQueueTab] = useState('ar'),
    [rows, setRows] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [status, setStatus] = useState('PENDING'),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1);
  const canCompany = hasAnyRole(currentUser, ['admin', 'superadmin', 'compliance']);
  async function load() {
    setLoading(true);
    setError('');
    try {
      const {
        data
      } = await api.get('/clients/ar-compliance');
      setRows(data.rows || []);
      setPage(1);
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to load AR clients.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    api.get('/clients/ar-compliance').then(({
      data
    }) => {
      if (!cancelled) setRows(data.rows || []);
    }).catch(() => {
      if (!cancelled) setError('Unable to load AR clients.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const matches = (row, value) => value === 'PENDING' ? ['PENDING', 'IN_REVIEW', 'NOT_READY'].includes(row.status) : row.status === value;
  const filtered = rows.filter(row => matches(row, status) && `${row.clientName} ${row.financialYear} ${row.stageLabel}`.toLowerCase().includes(search.toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  return <DashboardShell currentUser={currentUser}><div className="ar-list ar-review">
    <header className="ar-heading ar-card"><div><p className="ar-eyebrow">Compliance</p><h1>{queueTab === 'company' ? 'Company Compliance' : 'AR Compliance'}</h1><p className="ar-muted">Company verification and annual-return review in one workspace.</p></div>{queueTab === 'ar' && <button className="ar-save flex items-center gap-2" onClick={load} disabled={loading}><RefreshCw size={15} />Refresh</button>}</header>
    <div className="ar-tabs" role="tablist" aria-label="Compliance queues"><button role="tab" aria-selected={queueTab === 'company'} disabled={!canCompany} title={!canCompany ? 'Company reviews are available to Compliance and Admin' : ''} onClick={() => setQueueTab('company')}>Company Compliance</button><button role="tab" aria-selected={queueTab === 'ar'} onClick={() => setQueueTab('ar')}>AR Compliance</button></div>
    {queueTab === 'company' ? <div className="ar-company-queue"><PendingApproval embedded companyOnly /></div> : <>
      {error && <div role="alert" className="ar-alert">{error}</div>}<section className="ar-card"><div className="ar-filter"><label className="max-w-sm flex-1"><span className="sr-only">Search clients, financial year or stage</span><input placeholder="Search client, year or stage…" value={search} onChange={event => {
                setSearch(event.target.value);
                setPage(1);
              }} /></label>{[['PENDING', 'Pending'], ['PARTIALLY_APPROVED', 'Partially Approved'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']].map(([key, text]) => <button key={key} aria-pressed={status === key} onClick={() => {
              setStatus(key);
              setPage(1);
            }}>{text} <b>{rows.filter(row => matches(row, key)).length}</b></button>)}</div>
        <div className="ar-table-scroll"><table className="ar-table"><thead><tr>{['Client Name', 'Financial Year', 'Current Stage', 'Manager Status', 'Compliance Status', 'Approval Status', 'Decision By', 'Reviewed At', 'Actions'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{filtered.slice((page - 1) * 10, page * 10).map(row => <tr key={`${row.clientId}:${row.financialYear}`}><td>{row.clientName}</td><td>{row.financialYear}</td><td><span className="ar-stage-label">{row.stageLabel}</span></td><td><Status value={row.managerStatus} /></td><td><Status value={row.complianceStatus} /></td><td><Status value={row.status} /></td><td>{row.decisionBy}</td><td>{row.reviewedAt ? new Date(row.reviewedAt).toLocaleString('en-IN') : '-'}</td><td><Link to={`/compliance/ar/${row.clientId}?financialYear=${encodeURIComponent(row.financialYear)}`} className="inline-flex items-center gap-2"><FileCheck2 size={15} />Review</Link></td></tr>)}</tbody></table></div>
        {loading ? <div className="ar-empty">Loading AR clients…</div> : !filtered.length && <div className="ar-empty">No clients in this view. AR clients appear after both Excel files are imported.</div>}<div className="ar-pagination"><span>{filtered.length} records · Page {page} of {pages}</span><button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><button disabled={page >= pages} onClick={() => setPage(value => value + 1)}>Next</button></div>
      </section>
    </>}
  </div></DashboardShell>;
}
