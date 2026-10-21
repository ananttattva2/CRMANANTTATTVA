import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../services/api';
import { API_ENDPOINTS } from '../../services/apiEndpoints';
import useCrmRefresh from '../../hooks/useCrmRefresh';
import { formatDisplayDate } from '../../utils/dateFormat';
import { COMMUNICATION_MODES, filterReviewRows, leadReviewRows, summarizeReviewRows } from '../../utils/userOpenLeadReview.mjs';
const EMPTY = { user: 'all', mode: 'all', type: 'all', days: 'all', from: '', to: '', note: 'all', search: '' };
const INPUT = 'h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:ring-2 focus:ring-emerald-600';
const CELL = 'px-4 py-4';
export default function UserOpenLeads({ leads, loading, error, onRefresh, onView }) {
  const [temporary, setTemporary] = useState([]);
  const [tempLoading, setTempLoading] = useState(true);
  const [tempError, setTempError] = useState('');
  const [filters, setFilters] = useState(EMPTY);
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const request = useRef(0);
  async function loadTemporary() {
    const version = ++request.current;
    setTempLoading(true); setTempError('');
    try {
      const rows = [];
      let page = 1, pages = 1;
      do {
        const { data } = await api.get(API_ENDPOINTS.leads.temporaryLeads, { params: { status: 'DRAFT', limit: 100, page }, timeout: 30000 });
        if (version !== request.current) return;
        rows.push(...(data.temporaryLeads || []));
        pages = Number(data.pagination?.pages || 1); page++;
      } while (page <= pages);
      setTemporary(rows);
    } catch (failure) { if (version === request.current) setTempError(failure.response?.data?.error || 'Unable to load Temp Leads. Counts may be incomplete; refresh to retry.'); }
    finally { if (version === request.current) setTempLoading(false); }
  }
  useEffect(() => { loadTemporary(); return () => { request.current++; }; }, []);
  useCrmRefresh(loadTemporary);
  const allRows = useMemo(() => leadReviewRows(leads, temporary), [leads, temporary]);
  const users = useMemo(() => summarizeReviewRows(allRows), [allRows]);
  const filtered = useMemo(() => filterReviewRows(allRows, filters), [allRows, filters]);
  const summary = useMemo(() => summarizeReviewRows(filtered), [filtered]);
  const detail = useMemo(() => selected ? filtered.filter(row => row.ownerKey === selected.key) : [], [filtered, selected]);
  const display = selected ? detail : summary;
  const pages = Math.max(1, Math.ceil(display.length / 20));
  const currentPage = Math.min(page, pages);
  const visible = display.slice((currentPage - 1) * 20, currentPage * 20);
  const temps = filtered.filter(row => row.temporary).length;
  const busy = loading || tempLoading;
  function update(key, value) { setFilters(current => ({ ...current, [key]: value })); setPage(1); }
  function openUser(user, mode) { setSelected(user); setPage(1); if (mode) setFilters(current => ({ ...current, mode, type: 'lead' })); }
  const headers = selected ? ['#', 'Lead Code', 'Company', 'Lead Date', 'Type', 'Communication Mode', 'Status', 'Note'] : ['User Name', 'Open Lead', 'Temp Lead', 'Total', ...COMMUNICATION_MODES];
  return <section aria-label="User Open Lead" aria-busy={busy} className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-widest text-emerald-700">Lead Review · Live</p><h1 className="mt-1 text-3xl font-black">User Open Lead</h1><p className="mt-2 text-sm font-semibold text-slate-500">All currently open leads, counted once. Click a user to view their leads and notes.</p></div><button type="button" disabled={busy} onClick={() => { onRefresh(); loadTemporary(); }} className="rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:opacity-50">{busy ? 'Refreshing…' : 'Refresh'}</button></header>
    <div className="grid gap-3 sm:grid-cols-3">{[['Open Lead', filtered.length - temps], ['Temp Lead', temps], ['Users', summary.length]].map(([label, count]) => <div key={label} className="rounded-2xl border border-emerald-100 bg-white p-4"><p className="text-xs font-black uppercase text-slate-500">{label}</p><strong className="mt-1 block text-3xl text-emerald-800">{busy ? '…' : count.toLocaleString('en-IN')}</strong></div>)}</div>
    {(error || tempError) && <div role="alert" className="rounded-xl bg-rose-50 p-4 font-semibold text-rose-700">{[error, tempError].filter(Boolean).join(' ')}</div>}
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <Filter label="User" value={filters.user} onChange={value => { update('user', value); setSelected(null); }} options={users.map(user => [user.key, user.name])} all="All Users" />
      <Filter label="Communication Mode" value={filters.mode} onChange={value => update('mode', value)} options={COMMUNICATION_MODES.map(mode => [mode, mode])} all="All Modes" />
      <Filter label="Lead Type" value={filters.type} onChange={value => update('type', value)} options={[[ 'lead', 'Open Lead' ], ['temp', 'Temp Lead']]} all="All Leads" />
      <Filter label="Created Within" value={filters.days} onChange={value => update('days', value)} options={['7', '15', '30', '90'].map(days => [days, `Last ${days} Days`])} all="All Time" />
      <Filter label="Note" value={filters.note} onChange={value => update('note', value)} options={[[ 'with', 'With Note' ], ['without', 'Without Note']]} all="All Notes" />
      <label className="grid gap-1 text-xs font-bold text-slate-500">From<input type="date" value={filters.from} max={filters.to || undefined} onChange={event => update('from', event.target.value)} className={INPUT} /></label>
      <label className="grid gap-1 text-xs font-bold text-slate-500">To<input type="date" value={filters.to} min={filters.from || undefined} onChange={event => update('to', event.target.value)} className={INPUT} /></label>
      <label className="grid flex-1 gap-1 text-xs font-bold text-slate-500">Search company, lead or note<input type="search" value={filters.search} onChange={event => update('search', event.target.value)} placeholder="Search notes, company, lead…" className={`${INPUT} min-w-60`} /></label>
      <button type="button" onClick={() => { setFilters(EMPTY); setSelected(null); setPage(1); }} className={`${INPUT} font-bold`}>Reset</button>
    </div>
    <p className="text-xs font-semibold text-slate-500">User means lead creator. Source columns count open leads only. Temp Leads are unconverted drafts; their communication mode is not recorded. Dates use India time.</p>
    {selected && <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={() => { setSelected(null); setPage(1); }} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-emerald-800">← All Users</button><h2 className="text-lg font-black">{selected.name} · {detail.length} leads</h2></div>}
    <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm"><table className={`w-full text-left text-sm ${selected ? 'min-w-[1100px]' : 'min-w-[1900px]'}`}>
      <thead className="bg-emerald-50 text-xs uppercase text-emerald-900"><tr>{headers.map(header => <th scope="col" key={header} className={`${CELL} whitespace-nowrap`}>{header}</th>)}</tr></thead>
      <tbody>{!busy && visible.map((row, index) => selected ? <tr key={row.id} className="border-t border-slate-100 hover:bg-emerald-50/30">
        <td className={CELL}>{(currentPage - 1) * 20 + index + 1}</td><td className={`${CELL} font-semibold`}>{row.code || '—'}</td><td className={CELL}>{row.temporary ? <strong>{row.company}</strong> : <button type="button" onClick={() => onView(row.lead)} className="text-left font-bold text-emerald-800 underline underline-offset-4">{row.company || 'View lead'}</button>}</td><td className={`${CELL} whitespace-nowrap`}>{row.date ? formatDisplayDate(row.date) : '—'}</td><td className={CELL}><span className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-bold ${row.temporary ? 'bg-violet-50 text-violet-700' : 'bg-amber-50 text-amber-800'}`}>{row.temporary ? 'Temp Lead' : 'Open Lead'}</span></td><td className={CELL}>{row.temporary ? 'Not recorded' : row.mode}</td><td className={CELL}>{row.lead.status || '—'}</td><td className={`${CELL} min-w-80 whitespace-pre-wrap break-words text-slate-600`}>{row.note || 'No note added'}</td>
      </tr> : <tr key={row.key} className="border-t border-slate-100 hover:bg-emerald-50/30"><th scope="row" className={CELL}><button type="button" onClick={() => openUser(row)} className="text-left font-black text-emerald-800 underline underline-offset-4">{row.name}</button></th><td className={`${CELL} font-bold text-amber-700`}>{row.open}</td><td className={`${CELL} font-bold text-violet-700`}>{row.temporary}</td><td className={`${CELL} font-black`}>{row.total}</td>{COMMUNICATION_MODES.map(mode => <td key={mode} className={CELL}><button type="button" disabled={!row.modes[mode]} aria-label={`${row.name}, ${mode}: ${row.modes[mode]} leads`} onClick={() => openUser(row, mode)} className="rounded-lg px-2 py-1 font-semibold text-emerald-800 hover:bg-emerald-100 disabled:text-slate-400">{row.modes[mode]}</button></td>)}</tr>)}</tbody>
      {!busy && !selected && summary.length > 0 && <tfoot className="border-t border-emerald-200 bg-emerald-50 font-black"><tr><th scope="row" className={CELL}>Total</th><td className={CELL}>{filtered.length - temps}</td><td className={CELL}>{temps}</td><td className={CELL}>{filtered.length}</td>{COMMUNICATION_MODES.map(mode => <td key={mode} className={CELL}>{summary.reduce((sum, row) => sum + row.modes[mode], 0)}</td>)}</tr></tfoot>}
    </table>{(busy || !display.length) && <p role="status" className="p-12 text-center font-semibold text-slate-500">{busy ? 'Loading all open leads and Temp Leads…' : 'No leads match these filters.'}</p>}
    {!busy && display.length > 0 && <footer className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs font-bold text-slate-500"><span>Showing {(currentPage - 1) * 20 + 1}–{Math.min(currentPage * 20, display.length)} of {display.length} {selected ? 'leads' : 'users'}</span><div className="flex items-center gap-3"><button type="button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded-lg border p-2 disabled:opacity-30">←</button><span>{currentPage} / {pages}</span><button type="button" aria-label="Next page" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)} className="rounded-lg border p-2 disabled:opacity-30">→</button></div></footer>}</div>
  </section>;
}
function Filter({ label, value, onChange, options, all }) {
  return <label className="grid gap-1 text-xs font-bold text-slate-500">{label}<select value={value} onChange={event => onChange(event.target.value)} className={INPUT}><option value="all">{all}</option>{options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>;
}
