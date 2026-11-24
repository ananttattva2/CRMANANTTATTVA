import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { filterReviewRows, pendingDays } from '../../utils/userOpenLeadReview.mjs';
import { formatDisplayDate } from '../../utils/dateFormat';
const CELL = 'px-4 py-3';
export default function LeadReviewPopup({ selection, rows, closed, onClose, onView, onExport, exporting }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const closeButton = useRef(null);
  const filtered = useMemo(() => filterReviewRows(rows, { search }), [rows, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * 20, current * 20);
  const label = selection.drillAge !== 'all' ? `${selection.drillAge} days open` : selection.drillMode !== 'all' ? selection.drillMode : selection.drillType === 'temp' ? 'Temp Leads' : selection.drillType === 'lead' ? closed ? 'Closed Leads' : 'Open Leads' : 'All Leads';
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; previousFocus?.focus?.(); };
  }, []);
  function onKeyDown(event) {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    if (event.key !== 'Tab') return;
    const focusable = [...event.currentTarget.querySelectorAll('button:not(:disabled),input,a[href],select,[tabindex="0"]')];
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return createPortal(<div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-6" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="lead-review-popup-title" onKeyDown={onKeyDown} className="flex max-h-[92vh] w-full max-w-[1600px] flex-col overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-2xl">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100 bg-emerald-50 p-5"><div><p className="text-xs font-black uppercase tracking-wider text-emerald-700">{label}</p><h2 id="lead-review-popup-title" className="mt-1 text-xl font-black">{selection.name}</h2><p className="mt-1 text-sm font-semibold text-slate-500">{filtered.length} matching leads · {closed ? 'Closure dates' : 'Pending days use India calendar dates'}</p></div><div className="flex gap-2"><button type="button" disabled={exporting || !filtered.length} onClick={() => onExport(filtered, search)} className="rounded-xl border border-emerald-700 bg-white px-4 py-2 font-bold text-emerald-800 disabled:opacity-40">{exporting ? 'Exporting…' : 'Download Excel'}</button><button ref={closeButton} type="button" onClick={onClose} aria-label="Close lead popup" className="rounded-xl border border-slate-200 bg-white px-4 py-2 font-bold">✕ Close</button></div></header>
      <label className="grid gap-1 border-b border-slate-100 p-4 text-xs font-bold text-slate-600">Search these leads and notes<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Company, lead code or note…" className="h-10 rounded-xl border border-slate-200 px-3 text-sm" /></label>
      <div className="min-h-0 flex-1 overflow-auto"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-600"><tr>{['#', 'Lead Code', 'Company', closed ? 'Closed Date' : 'Lead Date', ...(!closed ? ['Pending Days'] : []), 'Type', 'Lead Owner', 'Communication Mode', 'Status', 'Note'].map(header => <th scope="col" key={header} className={CELL}>{header}</th>)}</tr></thead><tbody>{visible.map((row, index) => <tr key={row.id} className="border-t border-slate-100 hover:bg-emerald-50/30"><td className={CELL}>{(current - 1) * 20 + index + 1}</td><td className={`${CELL} whitespace-nowrap font-bold`}>{row.code || '—'}</td><td className={CELL}>{row.temporary ? row.company : <button type="button" onClick={() => onView(row.lead)} className="text-left font-bold text-emerald-800 underline">{row.company || 'View lead'}</button>}</td><td className={`${CELL} whitespace-nowrap`}>{row.date ? formatDisplayDate(row.date) : 'Date unavailable'}</td>{!closed && <td className={`${CELL} whitespace-nowrap font-bold text-amber-800`}>{pendingDays(row) === null ? 'Date unavailable' : `${pendingDays(row)} days`}</td>}<td className={CELL}>{row.temporary ? 'Temp Lead' : closed ? 'Closed Lead' : 'Open Lead'}</td><td className={CELL}>{row.ownerName}</td><td className={CELL}>{row.temporary ? 'Not recorded' : row.mode}</td><td className={CELL}>{closed ? 'Closed' : row.lead.status || '—'}</td><td className={`${CELL} min-w-80 whitespace-pre-wrap break-words`}>{row.note || 'No note added'}</td></tr>)}</tbody></table>{!filtered.length && <p role="status" className="p-12 text-center font-bold text-slate-500">No leads match this selection.</p>}</div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4 text-xs font-bold text-slate-500"><span>{filtered.length ? `Showing ${(current - 1) * 20 + 1}–${Math.min(current * 20, filtered.length)} of ${filtered.length} leads` : '0 leads'}</span><div className="flex items-center gap-3"><button type="button" aria-label="Previous popup page" disabled={current === 1} onClick={() => setPage(current - 1)} className="rounded-lg border px-3 py-2 disabled:opacity-30">←</button><span>{current} / {pages}</span><button type="button" aria-label="Next popup page" disabled={current === pages} onClick={() => setPage(current + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-30">→</button></div></footer>
    </section>
  </div>, document.body);
}
