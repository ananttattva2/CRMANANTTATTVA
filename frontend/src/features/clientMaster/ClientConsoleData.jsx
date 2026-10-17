import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, Loader2, RefreshCw, Search } from 'lucide-react';
import api from '../../services/api';
import { API_ENDPOINTS } from '../../services/apiEndpoints';

const errorText = (error) => error?.response?.data?.error || error?.response?.data?.message || error?.message || 'Unable to load Client Console Data.';

export default function ClientConsoleData({ clientId, financialYear }) {
  const [moduleName, setModuleName] = useState('purchase');
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    if (!clientId || !financialYear) return;
    setLoading(true); setError('');
    try {
      const { data } = await api.get(API_ENDPOINTS.clients.clientConsoleData(clientId), { params: { financialYear, module: moduleName } });
      setPayload(data);
    } catch (requestError) { setError(errorText(requestError)); setPayload(null); }
    finally { setLoading(false); }
  }, [clientId, financialYear, moduleName]);

  useEffect(() => { setQuery(''); load(); }, [load]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (payload?.rows || []).filter((row) => !needle || [row.category, row.entityName, row.registerType, row.entityType, row.recycled].some((value) => String(value || '').toLowerCase().includes(needle)));
  }, [payload, query]);
  const categoryGroups = useMemo(() => rows.reduce((groups, row) => {
    const category = row.category || 'Not Recorded';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(row);
    return groups;
  }, new Map()), [rows]);

  return <div className="space-y-4 bg-[linear-gradient(145deg,#f8fafc,#fff,#f0fdfa)] p-4">
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-5">
        <div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-teal-50 text-[#087A70]"><Database className="h-5 w-5" /></span><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-[#087A70]">Complete uploaded records</p><h5 className="mt-1 text-lg font-black text-slate-950">Client Console Data</h5><p className="mt-1 text-xs font-bold text-slate-500">All Category Of Plastic records from the latest portal upload, grouped by category and Entity Name.</p></div></div>
        <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
      </header>

      <div className="border-b border-slate-200 bg-slate-50 p-3"><div role="tablist" aria-label="Client Console Data module" className="inline-flex rounded-xl border border-slate-200 bg-white p-1">{[['purchase','Purchase'],['sales','Sales']].map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={moduleName === key} onClick={() => setModuleName(key)} className={`min-w-32 rounded-lg px-5 py-2.5 text-xs font-black transition ${moduleName === key ? 'bg-[#087A70] text-white shadow-sm' : 'text-slate-600 hover:bg-teal-50 hover:text-teal-800'}`}>{label}</button>)}</div></div>

      {error && <div role="alert" className="m-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-black text-rose-700">{error}</div>}
      {loading ? <div className="grid min-h-64 place-items-center"><div className="text-center"><Loader2 className="mx-auto h-7 w-7 animate-spin text-[#087A70]" /><p className="mt-2 text-sm font-black text-slate-500">Loading complete {moduleName} data…</p></div></div> : !error && <>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
          <div><div className="flex items-center gap-2"><span className="rounded-lg bg-orange-100 px-3 py-1.5 text-xs font-black text-orange-700">Category Of Plastic</span><strong className="text-sm text-slate-900">{payload?.source || `${moduleName === 'sales' ? 'Sales' : 'Purchase'} Portal Upload`}</strong></div><p className="mt-2 text-xs font-bold text-slate-500">{payload?.rows?.length || 0} unique category/entity records from {payload?.sourceRowCount || 0} uploaded rows.</p></div>
          <label className="flex h-10 min-w-64 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3"><Search className="h-4 w-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search console data" className="w-full text-xs font-bold outline-none" /></label>
        </div>
        {rows.length ? <div className="space-y-4 p-4">{[...categoryGroups].map(([category, categoryRows]) => <section key={category} className="overflow-hidden rounded-xl border border-slate-200"><header className="flex items-center justify-between bg-gradient-to-r from-teal-50 to-emerald-50 px-4 py-3"><h6 className="font-black text-teal-900">{category.replace('-', ' ')}</h6><span className="rounded-full bg-white px-3 py-1 text-[10px] font-black text-teal-700 ring-1 ring-teal-200">{categoryRows.length} unique entities</span></header><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs"><thead className="bg-slate-100 text-slate-600"><tr>{['Entity Name','Register Type','Entity Type','Recycled'].map((label) => <th key={label} className="px-4 py-3 font-black uppercase tracking-wide">{label}</th>)}</tr></thead><tbody>{categoryRows.map((row) => <tr key={`${row.category}-${row.entityName}`} className="border-t border-slate-100"><td className="px-4 py-3 font-black text-slate-950">{row.entityName}</td><td className="px-4 py-3 font-bold text-slate-700">{row.registerType || '-'}</td><td className="px-4 py-3 font-bold text-slate-700">{row.entityType || '-'}</td><td className="px-4 py-3 font-bold text-slate-700">{row.recycled || '-'}</td></tr>)}</tbody></table></div></section>)}</div> : <div className="p-10 text-center text-xs font-bold text-slate-400">{payload?.sourceRowCount ? 'No entities match your search.' : `No Category Of Plastic records are available in the ${moduleName === 'sales' ? 'Sales' : 'Purchase'} Portal Upload.`}</div>}
      </>}
    </section>
  </div>;
}
