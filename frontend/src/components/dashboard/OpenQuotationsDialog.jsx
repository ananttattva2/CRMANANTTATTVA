import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowUpRight, Building2, ChevronDown, ChevronLeft, ChevronRight, FileText, Search, X } from 'lucide-react';
import api from '../../services/api';
import { API_ENDPOINTS } from '../../services/apiEndpoints';
import { loadFullQuotation } from '../../utils/quotationDetail.mjs';
import { buildQuotationPrintHtml, formatDisplayDate, formatInr } from '../../utils/quotationDocument.mjs';

const PAGE_SIZE = 10;

function QuotationClient({ company, isExpanded, onToggle, onView }) {
  const reducedMotion = useReducedMotion();
  return (
    <section className="dashboard-quotation-company" data-expanded={isExpanded}>
      <button type="button" aria-expanded={isExpanded} onClick={onToggle} className="dashboard-quotation-company-toggle">
        <span className="dashboard-quotation-client-icon"><Building2 size={17} aria-hidden="true"/></span>
        <strong>{company.company}</strong>
        <span className="dashboard-quotation-count">{company.rows.length} open</span>
        <ChevronDown size={16} aria-hidden="true" className="dashboard-quotation-chevron"/>
      </button>
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div className="dashboard-quotation-disclosure"
            initial={reducedMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}>
            <ul className="dashboard-quotation-company-quotes">
              {company.rows.map(row => (
                <li key={row._id || row.id} className="dashboard-quotation-entry">
                  <div>
                    <strong className="dashboard-quotation-number">{row.quotationNumber || 'Unnumbered quotation'}</strong>
                    <p className="dashboard-quotation-meta">{[row.businessLeadCode || row.leadCode, formatDisplayDate(row.quotationDate || row.createdAt)].filter(Boolean).join(' · ')}</p>
                    <ul className="dashboard-quotation-services">{row.serviceSummary.items.map((item, index) => (
                      <li key={index}>
                        <span>{item.servicesOffered || item.applicableService || item.serviceCategory || item.eprCategory || item.businessCategory || 'Unnamed service'}</span>
                        {item.servicesForYear && <small>{item.servicesForYear}</small>}
                      </li>
                    ))}</ul>
                  </div>
                  <div className="dashboard-quotation-amount">
                    <small>Open service amount</small>
                    <strong>{row.serviceSummary.total === null ? 'Shared pricing' : formatInr(row.serviceSummary.total)}</strong>
                    <button type="button" onClick={() => onView(row)} className="dashboard-quotation-link" aria-label={row.quotationNumber ? `View quotation ${row.quotationNumber}` : 'View quotation'}>
                      View quotation<ArrowUpRight size={15} aria-hidden="true"/>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export default function OpenQuotationsDialog({ quotations, onClose }) {
  const dialog = useRef(null);
  const list = useRef(null);
  const searchInput = useRef(null);
  const back = useRef(null);
  const trigger = useRef(null);
  const savedScroll = useRef(0);
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

  function changePage(next) {
    setPage(next);
    setExpanded('');
    if (list.current) list.current.scrollTop = 0;
  }

  function changeSearch(value) {
    setSearch(value);
    changePage(1);
  }

  const showingPreview = Boolean(preview);
  useEffect(() => {
    if (showingPreview) back.current?.focus();
    else if (trigger.current) {
      if (list.current) list.current.scrollTop = savedScroll.current;
      const buttons = dialog.current.querySelectorAll('.dashboard-quotation-link');
      [...buttons].find(button => button.getAttribute('aria-label') === trigger.current)?.focus();
      trigger.current = null;
    }
  }, [showingPreview]);

  async function viewQuotation(row) {
    if (list.current) savedScroll.current = list.current.scrollTop;
    trigger.current = row.quotationNumber ? `View quotation ${row.quotationNumber}` : 'View quotation';
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
            ? <button ref={back} type="button" aria-label="Back to open quotations" onClick={() => setPreview(null)} className="dashboard-quotation-icon-button"><ArrowLeft size={18}/></button>
            : <span className="dashboard-quotation-header-icon"><FileText size={21} aria-hidden="true"/></span>}
          <div>
            <h2 id="dashboard-open-quotations-title">{title}</h2>
            <p>{preview ? 'Quotation preview' : `${quotations.length.toLocaleString('en-IN')} open ${quotations.length === 1 ? 'quotation' : 'quotations'}`}</p>
          </div>
        </div>
        <button type="button" aria-label="Close open quotations" onClick={() => dialog.current.close()} className="dashboard-quotation-icon-button"><X size={18}/></button>
      </header>
      {preview ? (
        <div className="dashboard-quotation-preview-panel">
          {preview.loading && <p className="p-5 text-sm text-slate-600" role="status">Loading quotation details…</p>}
          {preview.error && <div className="flex flex-wrap items-center gap-3 p-5"><p role="alert">{preview.error}</p><button type="button" onClick={() => viewQuotation(preview.row)} className="rounded-lg border bg-white px-3 py-2">Retry</button></div>}
          {preview.html && <iframe sandbox="" srcDoc={preview.html} title="Full quotation document" className="dashboard-quotation-preview" />}
        </div>
      ) : (
        <>
          <div className="dashboard-quotation-toolbar">
            <div className="dashboard-quotation-search">
              <Search size={17} aria-hidden="true"/>
              <input ref={searchInput} type="text" aria-label="Search open quotations" placeholder="Search client, lead code or quotation number" value={search}
                onChange={event => changeSearch(event.target.value)} />
              {search && <button type="button" aria-label="Clear quotation search" onClick={() => { changeSearch(''); searchInput.current?.focus(); }}><X size={16}/></button>}
            </div>
            <span aria-live="polite">{companies.length.toLocaleString('en-IN')} {companies.length === 1 ? 'client' : 'clients'}</span>
          </div>
          <div ref={list} className="dashboard-quotation-list">
            {!companies.length && <p role="status" className="dashboard-quotation-empty"><Search size={22} aria-hidden="true"/>No open quotations found.</p>}
            {companies.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE).map(company => (
              <QuotationClient key={company.key} company={company} isExpanded={expanded === company.key}
                onToggle={() => setExpanded(current => current === company.key ? '' : company.key)} onView={viewQuotation}/>
            ))}
          </div>
          {totalPages > 1 && <footer className="dashboard-quotation-footer">
            <span>Clients {(activePage - 1) * PAGE_SIZE + 1}–{Math.min(activePage * PAGE_SIZE, companies.length)} of {companies.length}</span>
            <nav aria-label="Quotation client pages">
              <button type="button" aria-label="Previous client page" disabled={activePage === 1} onClick={() => changePage(activePage - 1)} className="dashboard-quotation-icon-button"><ChevronLeft size={18}/></button>
              <span>Page {activePage} of {totalPages}</span>
              <button type="button" aria-label="Next client page" disabled={activePage === totalPages} onClick={() => changePage(activePage + 1)} className="dashboard-quotation-icon-button"><ChevronRight size={18}/></button>
            </nav>
          </footer>}
        </>
      )}
    </dialog>
  );
}
