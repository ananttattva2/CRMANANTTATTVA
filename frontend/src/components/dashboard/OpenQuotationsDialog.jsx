import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Building2, ChevronDown, FileText, Search, X } from 'lucide-react';
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
      className="dashboard-quotation-dialog">
      <header className="dashboard-quotation-header">
        <div className="flex min-w-0 items-center gap-3">
          {preview
            ? <button type="button" aria-label="Back to open quotations" onClick={() => setPreview(null)} className="dashboard-quotation-icon-button"><ArrowLeft size={18}/></button>
            : <span className="dashboard-quotation-header-icon"><FileText size={21} aria-hidden="true"/></span>}
          <div>
            <h2 id="dashboard-open-quotations-title">{title}</h2>
            <p>{preview ? 'Quotation preview' : `${quotations.length.toLocaleString('en-IN')} open ${quotations.length === 1 ? 'quotation' : 'quotations'}`}</p>
          </div>
        </div>
        <button type="button" aria-label="Close open quotations" onClick={() => dialog.current.close()} className="dashboard-quotation-icon-button"><X size={18}/></button>
      </header>
      {preview ? (
        <div className="bg-slate-50">
          {preview.loading && <p className="p-5 text-sm text-slate-600" role="status">Loading quotation details…</p>}
          {preview.error && <div className="flex flex-wrap items-center gap-3 p-5"><p role="alert">{preview.error}</p><button type="button" onClick={() => viewQuotation(preview.row)} className="rounded-lg border bg-white px-3 py-2">Retry</button></div>}
          {preview.html && <iframe sandbox="" srcDoc={preview.html} title="Full quotation document" className="dashboard-quotation-preview" />}
        </div>
      ) : (
        <>
          <div className="dashboard-quotation-toolbar">
            <label>
              <Search size={17} aria-hidden="true"/>
              <input aria-label="Search open quotations" placeholder="Search client, lead code or quotation number" value={search}
                onChange={event => { setSearch(event.target.value); setPage(1); }} />
            </label>
            <span>{companies.length.toLocaleString('en-IN')} {companies.length === 1 ? 'client' : 'clients'}</span>
          </div>
          <div className="dashboard-quotation-list">
          {!companies.length && <p role="status" className="py-5 text-center text-sm text-slate-500">No open quotations found.</p>}
            {companies.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE).map(company => (
              <section key={company.key} className="dashboard-quotation-company">
                <button type="button" aria-expanded={expanded === company.key} onClick={() => setExpanded(expanded === company.key ? '' : company.key)}
                  className="dashboard-quotation-company-toggle">
                  <Building2 size={17} aria-hidden="true"/>
                  <strong>{company.company}</strong>
                  <span>{company.rows.length} open</span>
                  <ChevronDown size={16} aria-hidden="true" className={expanded === company.key ? 'rotate-180' : ''}/>
                </button>
                {expanded === company.key && <ul className="dashboard-quotation-company-quotes">
                  {company.rows.map(row => (
                    <li key={row._id || row.id} className="dashboard-quotation-entry">
                      <div>
                        <button type="button" onClick={() => viewQuotation(row)} className="dashboard-quotation-link">{row.quotationNumber || 'View quotation'}<ArrowUpRight size={15} aria-hidden="true"/></button>
                        <p className="text-xs text-slate-600">{[row.businessLeadCode || row.leadCode, formatDisplayDate(row.quotationDate || row.createdAt)].filter(Boolean).join(' · ')}</p>
                        <ul className="mt-1 list-disc pl-4 text-slate-700">{row.serviceSummary.items.map((item, index) => (
                          <li key={index}>{item.servicesOffered || item.applicableService || item.serviceCategory || item.eprCategory || item.businessCategory || 'Unnamed service'}{item.servicesForYear && ` · ${item.servicesForYear}`}</li>
                        ))}</ul>
                      </div>
                      <div className="dashboard-quotation-amount"><small>Open service amount</small><strong>{row.serviceSummary.total === null ? 'Shared pricing' : formatInr(row.serviceSummary.total)}</strong></div>
                    </li>
                  ))}
                </ul>}
              </section>
            ))}
          </div>
          {totalPages > 1 && <footer className="dashboard-quotation-footer">
            <span>Clients {(activePage - 1) * PAGE_SIZE + 1}–{Math.min(activePage * PAGE_SIZE, companies.length)} of {companies.length}</span>
            <div className="flex gap-2">
              <button type="button" disabled={activePage === 1} onClick={() => setPage(activePage - 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Previous</button>
              <button type="button" disabled={activePage === totalPages} onClick={() => setPage(activePage + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Next</button>
            </div>
          </footer>}
        </>
      )}
    </dialog>
  );
}
