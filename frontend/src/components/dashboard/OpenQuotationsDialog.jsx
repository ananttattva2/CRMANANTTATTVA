import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Search, X } from 'lucide-react';
import api from '../../services/api';
import { API_ENDPOINTS } from '../../services/apiEndpoints';
import { loadFullQuotation } from '../../utils/quotationDetail.mjs';
import { buildQuotationPrintHtml, formatDisplayDate, formatInr } from '../../utils/quotationDocument.mjs';

const PAGE_SIZE = 10;

export default function OpenQuotationsDialog({ quotations, onClose }) {
  const dialog = useRef(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState('');
  const [preview, setPreview] = useState(null);
  const title = preview ? preview.row.quotationNumber || 'Quotation Details' : 'Open Quotations';

  useEffect(() => {
    if (!dialog.current.open) dialog.current.showModal();
  }, []);

  const companies = useMemo(() => {
    const term = search.trim().toLowerCase();
    const groups = new Map();
    for (const row of quotations) {
      const company = (row.companyName || row.leadDetails?.companyName || '').trim();
      const key = company.toLowerCase().replace(/\s+/g, ' ') || String(row.linkedLeadId || row._id || row.id);
      const leadCode = row.businessLeadCode || row.leadCode;
      if (term && ![company, leadCode, row.quotationNumber].join(' ').toLowerCase().includes(term)) continue;
      if (!groups.has(key)) groups.set(key, { key, company: company || 'Unnamed client', rows: [] });
      groups.get(key).rows.push(row);
    }
    return [...groups.values()];
  }, [quotations, search]);

  const totalPages = Math.max(1, Math.ceil(companies.length / PAGE_SIZE));
  const activePage = Math.min(page, totalPages);

  async function viewQuotation(row) {
    const request = { row, loading: true };
    setPreview(request);
    try {
      const full = await loadFullQuotation(row, id => api.get(API_ENDPOINTS.quotations.detail(id)));
      const html = buildQuotationPrintHtml(full);
      setPreview(current => current === request ? { row, html } : current);
    } catch {
      setPreview(current => current === request ? { row, error: 'Could not load the quotation details.' } : current);
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby="dashboard-open-quotations-title" onClose={onClose}
      className="fixed inset-0 m-auto max-h-[88vh] w-11/12 max-w-5xl overflow-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/50">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-white px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          {preview && <button type="button" aria-label="Back to open quotations" onClick={() => setPreview(null)} className="rounded-lg border p-2 hover:bg-slate-50"><ArrowLeft size={18}/></button>}
          <div>
            <h2 id="dashboard-open-quotations-title" className="text-lg font-bold">{title}</h2>
            {!preview && <p className="text-sm text-slate-600">{quotations.length.toLocaleString('en-IN')} open {quotations.length === 1 ? 'quotation' : 'quotations'}</p>}
          </div>
        </div>
        <button type="button" aria-label="Close open quotations" onClick={() => dialog.current.close()} className="rounded-lg border p-2 hover:bg-slate-50"><X size={18}/></button>
      </header>
      {preview ? (
        <div className="bg-slate-50">
          {preview.loading && <p className="p-5 text-sm text-slate-600" role="status">Loading quotation details…</p>}
          {preview.error && <div className="flex flex-wrap items-center gap-3 p-5"><p role="alert">{preview.error}</p><button type="button" onClick={() => viewQuotation(preview.row)} className="rounded-lg border bg-white px-3 py-2">Retry</button></div>}
          {preview.html && <iframe sandbox="" srcDoc={preview.html} title="Full quotation document" className="block h-[68vh] w-full border-0" />}
        </div>
      ) : (
        <div className="space-y-4 p-5">
          <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-slate-500">
            <Search size={16} aria-hidden="true"/>
            <input aria-label="Search open quotations" placeholder="Search client, lead code or quotation number" value={search}
              onChange={event => { setSearch(event.target.value); setPage(1); }} className="w-full bg-transparent text-sm text-slate-900 outline-none"/>
          </label>
          {!companies.length && <p role="status" className="py-5 text-center text-sm text-slate-500">No open quotations found.</p>}
          <div className="space-y-2">
            {companies.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE).map(company => (
              <section key={company.key} className="rounded-lg border border-slate-200">
                <button type="button" aria-expanded={expanded === company.key} onClick={() => setExpanded(expanded === company.key ? '' : company.key)}
                  className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left hover:bg-slate-50">
                  <ChevronDown size={16} aria-hidden="true" className={expanded === company.key ? 'shrink-0 rotate-180' : 'shrink-0'}/>
                  <strong className="min-w-0 flex-1 break-words text-sm">{company.company}</strong>
                  <span className="shrink-0 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800">{company.rows.length} open</span>
                </button>
                {expanded === company.key && <ul className="divide-y border-t bg-slate-50 px-4">
                  {company.rows.map(row => (
                    <li key={row._id || row.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                      <div>
                        <button type="button" onClick={() => viewQuotation(row)} className="font-bold text-teal-800 underline-offset-2 hover:underline">{row.quotationNumber || 'View quotation'}</button>
                        <p className="text-xs text-slate-600">{[row.businessLeadCode || row.leadCode, formatDisplayDate(row.quotationDate || row.createdAt)].filter(Boolean).join(' · ')}</p>
                        <ul className="mt-1 list-disc pl-4 text-slate-700">{row.serviceSummary.items.map((item, index) => (
                          <li key={index}>{item.servicesOffered || item.applicableService || item.serviceCategory || item.eprCategory || item.businessCategory || 'Unnamed service'}{item.servicesForYear && ` · ${item.servicesForYear}`}</li>
                        ))}</ul>
                      </div>
                      <strong className="whitespace-nowrap text-orange-700">{row.serviceSummary.total === null ? 'Shared pricing' : formatInr(row.serviceSummary.total)}</strong>
                    </li>
                  ))}
                </ul>}
              </section>
            ))}
          </div>
          {totalPages > 1 && <footer className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
            <span>Page {activePage} of {totalPages}</span>
            <div className="flex gap-2">
              <button type="button" disabled={activePage === 1} onClick={() => setPage(activePage - 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Previous</button>
              <button type="button" disabled={activePage === totalPages} onClick={() => setPage(activePage + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Next</button>
            </div>
          </footer>}
        </div>
      )}
    </dialog>
  );
}
