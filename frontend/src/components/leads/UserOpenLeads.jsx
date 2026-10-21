import LeadReviewPopup from './LeadReviewPopup';
import { downloadLeadReviewExcel } from '../../utils/leadReviewExcel.mjs';
import React, { useMemo, useState } from 'react';
import { formatDisplayDate } from '../../utils/dateFormat';
import { COMMUNICATION_MODES, OPEN_AGE_BUCKETS, pendingDays, filterReviewRows, leadReviewRows, summarizeReviewRows } from '../../utils/userOpenLeadReview.mjs';
const EMPTY = { user: 'all', mode: 'all', type: 'all', days: 'all', from: '', to: '', note: 'all', age: 'all', search: '' };
const INPUT = 'h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:ring-2 focus:ring-emerald-600';
const CELL = 'px-4 py-4';
export default function UserOpenLeads({ leads, temporary, loading, error, onRefresh, onView, mode = 'open' }) {
  const closed = mode === 'closed';
  const title = closed ? 'User Lead Close' : 'User Open Lead';
  const leadLabel = closed ? 'Closed Lead' : 'Open Lead';
  const [filters, setFilters] = useState(EMPTY);
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const allRows = useMemo(() => leadReviewRows(leads, temporary, { mode }), [leads, temporary, mode]);
  const users = useMemo(() => summarizeReviewRows(allRows), [allRows]);
  const filtered = useMemo(() => filterReviewRows(allRows, filters), [allRows, filters]);
  const summary = useMemo(() => summarizeReviewRows(filtered), [filtered]);
  const detail = filtered;
  const popupRows = useMemo(() => selected ? filterReviewRows(filtered, { user: selected.key, type: selected.drillType, mode: selected.drillMode, age: selected.drillAge }) : [], [filtered, selected]);
  const showDetails = Boolean(filters.search.trim() || filters.user !== 'all');
  const display = showDetails ? detail : summary;
  const pages = Math.max(1, Math.ceil(display.length / 20));
  const currentPage = Math.min(page, pages);
  const visible = display.slice((currentPage - 1) * 20, currentPage * 20);
  const temps = filtered.filter(row => row.temporary).length;
  const busy = loading;
  function update(key, value) { setFilters(current => ({ ...current, [key]: value })); setPage(1); }
  function openUser(user, source = null, type = 'all', age = 'all') { setSelected({ ...user, drillMode: source || 'all', drillType: source ? 'lead' : type, drillAge: age }); }
  async function exportUsers(override, popupSearch = '') {
    setExporting(true); setExportError('');
    try {
      const exportRows = Array.isArray(override) ? override : showDetails ? detail : filtered;
      const totals = summarizeReviewRows(exportRows);
      const tables = [
        { name: 'User Summary', headers: ['User Name', leadLabel, ...(!closed ? ['Temp Lead'] : []), 'Total', ...(!closed ? OPEN_AGE_BUCKETS.map(([, label]) => label) : []), ...COMMUNICATION_MODES], rows: totals.map(user => [user.name, closed ? user.closed : user.open, ...(!closed ? [user.temporary] : []), user.total, ...(!closed ? OPEN_AGE_BUCKETS.map(([key]) => user.ages[key]) : []), ...COMMUNICATION_MODES.map(mode => user.modes[mode])]) },
        { name: 'Leads', headers: ['Lead Code', 'Company', closed ? 'Closed Date' : 'Lead Date', 'Lead Owner', ...(!closed ? ['Pending Days'] : []), 'Type', 'Communication Mode', 'Status', 'Note'], rows: exportRows.map(row => [row.code || '', row.company || '', row.date ? formatDisplayDate(row.date) : '', row.ownerName, ...(!closed ? [pendingDays(row)] : []), row.temporary ? 'Temp Lead' : leadLabel, row.temporary ? 'Not recorded' : row.mode, closed ? 'Closed' : row.lead.status || '', row.note]) }
      ];
      await downloadLeadReviewExcel(tables, { View: title, ...filters, 'Selected User': selected?.name || 'All', 'Popup Search': popupSearch, 'Popup Type': selected?.drillType || 'all', 'Popup Mode': selected?.drillMode || 'all', 'Popup Age': selected?.drillAge || 'all' }, closed ? 'User_Lead_Close' : 'User_Open_Lead');
    } catch { setExportError('Excel download failed. Please retry.'); }
    finally { setExporting(false); }
  }
  const headers = showDetails ? ['#', 'Lead Code', 'Company', closed ? 'Closed Date' : 'Lead Date', 'Type', 'User', 'Communication Mode', 'Status', 'Note'] : ['User Name', leadLabel, ...(!closed ? ['Temp Lead'] : []), 'Total', ...(!closed ? OPEN_AGE_BUCKETS.map(([, label]) => label) : []), ...COMMUNICATION_MODES];
  return <section aria-label={title} aria-busy={busy} className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-widest text-emerald-700">Lead Review · Live</p><h1 className="mt-1 text-3xl font-black">{title}</h1><p className="mt-2 text-sm font-semibold text-slate-500">{closed ? 'Leads with closed services, counted once per lead. Click a user to view their closed leads and notes.' : 'All currently open leads, counted once. Click a user to view their leads and notes.'}</p></div><div className="flex gap-2"><button type="button" disabled={busy || exporting || !display.length} onClick={() => exportUsers()} className="rounded-xl border border-emerald-700 bg-white px-4 py-3 font-bold text-emerald-800 disabled:opacity-40">{exporting ? 'Exporting…' : 'Download Excel'}</button><button type="button" disabled={busy} onClick={onRefresh} className="rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:opacity-50">{busy ? 'Refreshing…' : 'Refresh'}</button></div></header>
    <div className="grid gap-3 sm:grid-cols-3">{[[leadLabel, filtered.length - temps], ...(closed ? [['Total', filtered.length]] : [['Temp Lead', temps]]), ['Users', summary.length]].map(([label, count]) => <div key={label} className="rounded-2xl border border-emerald-100 bg-white p-4"><p className="text-xs font-black uppercase text-slate-500">{label}</p><strong className="mt-1 block text-3xl text-emerald-800">{busy ? '…' : count.toLocaleString('en-IN')}</strong></div>)}</div>
    {!closed && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Open lead ageing">{OPEN_AGE_BUCKETS.map(([key, label]) => <button type="button" key={key} aria-pressed={filters.age === key} onClick={() => update('age', filters.age === key ? 'all' : key)} className={`rounded-2xl border p-4 text-left ${filters.age === key ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white'}`}><span className="text-xs font-black uppercase text-slate-500">Open {label}</span><strong className="mt-1 block text-2xl text-amber-800">{busy ? '…' : summary.reduce((sum, user) => sum + user.ages[key], 0)}</strong></button>)}</div>}
    {(error || exportError) && <div role="alert" className="rounded-xl bg-rose-50 p-4 font-semibold text-rose-700">{[error, exportError].filter(Boolean).join(' ')}</div>}
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <Filter label="User" value={filters.user} onChange={value => { update('user', value); update('type', 'all'); setSelected(null); }} options={users.map(user => [user.key, user.name])} all="All Users" />
      <Filter label="Communication Mode" value={filters.mode} onChange={value => update('mode', value)} options={COMMUNICATION_MODES.map(mode => [mode, mode])} all="All Modes" />
      <Filter label={closed ? "Closed Within" : "Created Within"} value={filters.days} onChange={value => update('days', value)} options={['7', '15', '30', '90'].map(days => [days, `Last ${days} Days`])} all="All Time" />
      {!closed && <Filter label="Open Pending Age" value={filters.age} onChange={value => update('age', value)} options={[...OPEN_AGE_BUCKETS, ['unknown', 'Date unavailable']]} all="All Ages" />}
      <Filter label="Note" value={filters.note} onChange={value => update('note', value)} options={[[ 'with', 'With Note' ], ['without', 'Without Note']]} all="All Notes" />
      <label className="grid gap-1 text-xs font-bold text-slate-500">From<input type="date" value={filters.from} max={filters.to || undefined} onChange={event => update('from', event.target.value)} className={INPUT} /></label>
      <label className="grid gap-1 text-xs font-bold text-slate-500">To<input type="date" value={filters.to} min={filters.from || undefined} onChange={event => update('to', event.target.value)} className={INPUT} /></label>
      <label className="grid flex-1 gap-1 text-xs font-bold text-slate-500">Search company, lead or note<input type="search" value={filters.search} onChange={event => update('search', event.target.value)} placeholder="Search notes, company, lead…" className={`${INPUT} min-w-60`} /></label>
      <button type="button" onClick={() => { setFilters(EMPTY); setSelected(null); setPage(1); }} className={`${INPUT} font-bold`}>Reset</button>
    </div>
    <p className="text-xs font-semibold text-slate-500">User means the saved Lead Owner (Yourself / Other User); older leads use their creator. {closed ? 'Source columns count closed leads only. Date filters use the latest recorded service closure date; undated closures are excluded from date ranges.' : 'Source columns count open leads only. Temp Leads are unconverted drafts; their communication mode is not recorded.'} Dates use India time. {!closed && 'Age buckets count only regular open leads from their lead date; Temp Leads are excluded.'}</p>

    <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm"><table className={`w-full text-left text-sm ${showDetails ? 'min-w-[1100px]' : 'min-w-[1900px]'}`}>
      <thead className="bg-emerald-50 text-xs uppercase text-emerald-900"><tr>{headers.map(header => <th scope="col" key={header} className={`${CELL} whitespace-nowrap`}>{header}</th>)}</tr></thead>
      <tbody>{!busy && visible.map((row, index) => showDetails ? <tr key={row.id} className="border-t border-slate-100 hover:bg-emerald-50/30">
        <td className={CELL}>{(currentPage - 1) * 20 + index + 1}</td><td className={`${CELL} font-semibold`}>{row.code || '—'}</td><td className={CELL}>{row.temporary ? <strong>{row.company}</strong> : <button type="button" onClick={() => onView(row.lead)} className="text-left font-bold text-emerald-800 underline underline-offset-4">{row.company || 'View lead'}</button>}</td><td className={`${CELL} whitespace-nowrap`}>{row.date ? formatDisplayDate(row.date) : closed ? 'Date unavailable' : '—'}</td><td className={CELL}><span className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-bold ${row.temporary ? 'bg-violet-50 text-violet-700' : 'bg-amber-50 text-amber-800'}`}>{row.temporary ? 'Temp Lead' : leadLabel}</span></td><td className={CELL}>{row.ownerName}</td><td className={CELL}>{row.temporary ? 'Not recorded' : row.mode}</td><td className={CELL}>{closed ? 'Closed' : row.lead.status || '—'}</td><td className={`${CELL} min-w-80 whitespace-pre-wrap break-words text-slate-600`}>{row.note || 'No note added'}</td>
      </tr> : <tr key={row.key} className="border-t border-slate-100 hover:bg-emerald-50/30"><th scope="row" className={CELL}><button type="button" onClick={() => openUser(row)} className="text-left font-black text-emerald-800 underline underline-offset-4">{row.name}</button></th><td className={`${CELL} font-bold text-amber-700`}><button type="button" onClick={() => openUser(row, null, 'lead')} className="underline underline-offset-4" aria-label={`${row.name}: ${closed ? row.closed : row.open} ${closed ? 'closed' : 'open'} leads`}>{closed ? row.closed : row.open}</button></td>{!closed && <td className={`${CELL} font-bold text-violet-700`}><button type="button" onClick={() => openUser(row, null, 'temp')} className="underline underline-offset-4" aria-label={`${row.name}: ${row.temporary} Temp Leads`}>{row.temporary}</button></td>}<td className={`${CELL} font-black`}><button type="button" onClick={() => openUser(row)} className="underline underline-offset-4" aria-label={`${row.name}: ${row.total} total leads`}>{row.total}</button></td>{!closed && OPEN_AGE_BUCKETS.map(([key, label]) => <td key={key} className={`${CELL} text-amber-800`}><button type="button" onClick={() => openUser(row, null, 'lead', key)} aria-label={`${row.name}: ${row.ages[key]} open leads aged ${label}`} className="font-bold underline underline-offset-4">{row.ages[key]}</button></td>)}{COMMUNICATION_MODES.map(mode => <td key={mode} className={CELL}><button type="button" aria-label={`${row.name}, ${mode}: ${row.modes[mode]} leads`} onClick={() => openUser(row, mode)} className="rounded-lg px-2 py-1 font-semibold text-emerald-800 hover:bg-emerald-100 disabled:text-slate-400">{row.modes[mode]}</button></td>)}</tr>)}</tbody>
      {!busy && !showDetails && summary.length > 0 && <tfoot className="border-t border-emerald-200 bg-emerald-50 font-black"><tr><th scope="row" className={CELL}>Total</th>{[
        { label: leadLabel, count: filtered.length - temps, type: 'lead' },
        ...(!closed ? [{ label: 'Temp Lead', count: temps, type: 'temp' }] : []),
        { label: 'Total', count: filtered.length, type: 'all' },
        ...(!closed ? OPEN_AGE_BUCKETS.map(([age, label]) => ({ label, age, type: 'lead', count: summary.reduce((sum, row) => sum + row.ages[age], 0) })) : []),
        ...COMMUNICATION_MODES.map(source => ({ label: source, source, count: summary.reduce((sum, row) => sum + row.modes[source], 0) }))
      ].map(item => <td key={item.label} className={CELL}><button type="button" className="underline underline-offset-4" aria-label={`All Users: ${item.count} ${item.label}`} onClick={() => openUser({ key: 'all', name: 'All Users' }, item.source, item.type || 'all', item.age || 'all')}>{item.count}</button></td>)}</tr></tfoot>}
    </table>{(busy || !display.length) && <p role="status" className="p-12 text-center font-semibold text-slate-500">{busy ? (closed ? 'Loading closed leads…' : 'Loading all open leads and Temp Leads…') : 'No leads match these filters.'}</p>}
    {!busy && display.length > 0 && <footer className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs font-bold text-slate-500"><span>Showing {(currentPage - 1) * 20 + 1}–{Math.min(currentPage * 20, display.length)} of {display.length} {showDetails ? 'leads' : 'users'}</span><div className="flex items-center gap-3"><button type="button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded-lg border p-2 disabled:opacity-30">←</button><span>{currentPage} / {pages}</span><button type="button" aria-label="Next page" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)} className="rounded-lg border p-2 disabled:opacity-30">→</button></div></footer>}</div>
    {selected && <LeadReviewPopup key={`${selected.key}:${selected.drillType}:${selected.drillMode}:${selected.drillAge}`} selection={selected} rows={popupRows} closed={closed} onClose={() => setSelected(null)} onView={onView} onExport={exportUsers} exporting={exporting} />}
  </section>;
}
function Filter({ label, value, onChange, options, all }) {
  return <label className="grid gap-1 text-xs font-bold text-slate-500">{label}<select value={value} onChange={event => onChange(event.target.value)} className={INPUT}>{all && <option value="all">{all}</option>}{options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>;
}
