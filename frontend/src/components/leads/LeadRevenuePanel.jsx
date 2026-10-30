import React, { useEffect, useRef, useState } from 'react';
import { LockKeyhole, Plus, IndianRupee } from 'lucide-react';
import api from '../../services/api';

export const revenueMoney = paise => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(paise || 0) / 100);

export async function saveLeadRevenue(kind, id, draft) {
  if (!draft?.amount) return;
  const { data } = await api.get(`/leads/revenue/${kind}/${id}`);
  const serviceKeys = data.eligibleServices.map(s => s.key);
  await api.post(`/leads/revenue/${kind}/${id}`, { ...draft, serviceKeys });
}

export default function LeadRevenuePanel({ kind = 'hot', leadId, serviceVersion = '', onDraftChange, onSaved, initialDraft }) {
  const [data, setData] = useState({ groups: [], eligibleServices: [] });
  const [draft, setDraft] = useState(() => initialDraft || { amount: '', mode: 'new', groupId: '', requestId: crypto.randomUUID() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const previousLead = useRef(`${kind}:${leadId || ''}`);
  const callback = useRef(onDraftChange); callback.current = onDraftChange;
  useEffect(() => { callback.current?.(draft); }, [draft]);
  useEffect(() => {
    let active = true;
    setLoaded(!leadId); setError('');
    setData({ groups: [], eligibleServices: [] });
    const identity = `${kind}:${leadId || ''}`;
    if (previousLead.current !== identity) {
      previousLead.current = identity;
      setDraft({ amount: '', mode: 'new', groupId: '', requestId: crypto.randomUUID() });
    }
    if (leadId) api.get(`/leads/revenue/${kind}/${leadId}`).then(r => { if (active) { setData(r.data); setLoaded(true); } }).catch(e => { if (active) setError(e.response?.data?.error || 'Unable to load saved revenue.'); });
    return () => { active = false; };
  }, [kind, leadId, serviceVersion]);
  const canRecord = !leadId || (loaded && (data.eligibleServices.length > 0 || (serviceVersion && serviceVersion.split(',').some(key => key && !(data.serviceKeys || []).includes(key)))));
  const change = (field, value) => setDraft(d => ({ ...d, [field]: value }));
  async function save() {
    if (!leadId || busy) return;
    setBusy(true); setError('');
    try {
      await saveLeadRevenue(kind, leadId, draft);
      const response = await api.get(`/leads/revenue/${kind}/${leadId}`);
      setData(response.data); setDraft({ amount: '', mode: 'new', groupId: '', requestId: crypto.randomUUID() });
      onSaved?.();
    } catch (e) { setError(e.response?.data?.error || e.message || 'Unable to save revenue.'); }
    finally { setBusy(false); }
  }
  return <section className="my-5 rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 via-white to-emerald-50 p-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="flex items-center gap-2 text-lg font-black text-slate-900"><IndianRupee className="h-5 w-5 text-orange-600"/>Estimated Revenue</h3><p className="mt-1 text-xs font-semibold text-slate-500">Saved amounts are locked for every user. New services can add revenue without changing history.</p></div><strong className="text-2xl font-black text-emerald-700">{revenueMoney(data.groups.reduce((n, g) => n + g.amountPaise, 0))}</strong></header>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">{data.groups.map((g, i) => <article key={g.id} className="rounded-xl border border-emerald-200 bg-white p-4"><div className="flex justify-between text-xs font-bold text-slate-500"><span>Revenue group {i + 1}</span><LockKeyhole className="h-4 w-4"/></div><strong className="mt-2 block text-xl font-black text-emerald-800">{revenueMoney(g.amountPaise)}</strong><details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer font-bold">{g.contributions.length} locked contribution(s)</summary>{g.contributions.map(c => <div key={c.id} className="mt-2 border-t pt-2"><b>{revenueMoney(c.amountPaise)}</b> · {c.createdByName}<p>{(c.services || []).join(', ')}</p></div>)}</details></article>)}</div>
    {data.locked ? <p className="mt-4 text-sm font-semibold text-slate-500">This cold lead is closed or converted; revenue is read-only.</p> : <div className="mt-4 space-y-3">
      <label className="block text-xs font-black text-slate-600">New revenue amount (₹)<input aria-label="New revenue amount" type="number" disabled={!canRecord} min="0.01" max="9999999999.99" step="0.01" value={draft.amount} onChange={e => change('amount', e.target.value)} placeholder="e.g. 10000" className="mt-2 block h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-base outline-none focus:border-orange-400"/></label>
      {data.groups.length > 0 && <div className="grid gap-3 sm:grid-cols-2"><label className="rounded-xl border bg-white p-3 text-sm font-bold"><input type="radio" name={`revenue-${kind}-${leadId}`} checked={draft.mode === 'new'} onChange={() => change('mode', 'new')}/> Create a separate revenue group</label><label className="rounded-xl border bg-white p-3 text-sm font-bold"><input type="radio" name={`revenue-${kind}-${leadId}`} checked={draft.mode === 'add'} onChange={() => change('mode', 'add')}/> Add to an existing revenue group</label></div>}
      {draft.mode === 'add' && <label className="block text-xs font-black text-slate-600">Existing group<select aria-label="Existing revenue group" value={draft.groupId} onChange={e => change('groupId', e.target.value)} className="mt-2 h-11 w-full rounded-xl border bg-white px-3"><option value="">Choose revenue group</option>{data.groups.map((g, i) => <option key={g.id} value={g.id}>Group {i + 1} — {revenueMoney(g.amountPaise)}{draft.amount ? ` → ${revenueMoney(g.amountPaise + Math.round(Number(draft.amount) * 100))}` : ''}</option>)}</select></label>}
      <p className="text-xs font-semibold text-slate-500">{!canRecord ? 'Saved services are locked or belong to another author. Add a new service to record additional revenue.' : onDraftChange ? 'This contribution is recorded when you save the lead/services. Only your new, unpriced saved services are included.' : `${data.eligibleServices.length} new unpriced service(s) available. The amount is locked after recording.`}</p>
      {!onDraftChange && <button type="button" onClick={save} disabled={busy || !loaded || !draft.amount || !data.eligibleServices.length || (draft.mode === 'add' && !draft.groupId)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-black text-white disabled:opacity-40"><Plus className="h-4 w-4"/>{busy ? 'Recording…' : 'Record & lock revenue'}</button>}
    </div>}
    {error && <p role="alert" className="mt-3 text-sm font-bold text-red-700">{error}</p>}
  </section>;
}
