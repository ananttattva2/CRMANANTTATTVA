import TrafficSources from '../components/leads/TrafficSources';
import { trafficSourceHierarchy, trafficSourceKey } from '../utils/trafficSources.mjs';
import { uniquePipelineRows } from '../utils/leadPipeline.mjs';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BadgeIndianRupee, Download, Flame, Search, Snowflake, Users, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import DashboardShell from '../components/dashboard/DashboardShell';
import LeadRevenuePanel, { revenueMoney } from '../components/leads/LeadRevenuePanel';
import useCrmRefresh from '../hooks/useCrmRefresh';
import api from '../services/api';
import '../styles/lead-pipeline.css';

export default function LeadPipeline() {
  const [currentUser, setCurrentUser] = useState(null);
  const [rows, setRows] = useState([]);
  const [sourceModes, setSourceModes] = useState([]);
  const [sourceOptionsUnavailable, setSourceOptionsUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [owner, setOwner] = useState('');
  const [selection, setSelection] = useState(null);
  const [revenueRow, setRevenueRow] = useState(null);
  const [closeRow, setCloseRow] = useState(null);
  const [serviceView, setServiceView] = useState(null);
  const serviceDialog = useRef(null);
  const serviceRequest = useRef(0);
  const [remarks, setRemarks] = useState('');
  const [closing, setClosing] = useState(false);
  const [modalError, setModalError] = useState('');
  const dialog = useRef(null);
  const sequence = useRef(0);
  async function load() {
    const version = ++sequence.current;
    try {
      const [me, result, modeOptions] = await Promise.all([api.get('/auth/me'), api.get('/leads/pipeline-revenue'), api.get('/leads/dropdown-options').catch(() => null)]);
      if (version !== sequence.current) return;
      setCurrentUser(me.data.user); setRows(result.data.rows || []); setSourceModes(modeOptions?.data?.options?.communicationMode || []); setSourceOptionsUnavailable(!modeOptions); setError('');
    } catch (e) { if (version === sequence.current) setError(e.response?.data?.error || 'Unable to load pipeline.'); }
    finally { if (version === sequence.current) setLoading(false); }
  }
  useEffect(() => { void load(); return () => { sequence.current++; }; }, []);
  useCrmRefresh(load);
  useEffect(() => {
    if (selection && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!selection && dialog.current?.open) dialog.current.close();
  }, [selection]);
  useEffect(() => {
    if (serviceView && serviceDialog.current && !serviceDialog.current.open) serviceDialog.current.showModal();
    if (!serviceView && serviceDialog.current?.open) serviceDialog.current.close();
  }, [serviceView]);
  const filtered = useMemo(() => rows.filter(r => (!owner || r.owner === owner) && `${r.company} ${r.code} ${r.owner}`.toLowerCase().includes(query.trim().toLowerCase())), [rows, query, owner]);
  const unique = uniquePipelineRows(filtered);
  const trafficSources = useMemo(() => trafficSourceHierarchy(filtered, sourceModes), [filtered, sourceModes]);
  const listed = selection ? (selection.kind ? filtered : unique).filter(r => (!selection.kind || r.kind === selection.kind) && (!selection.state || r.state === selection.state) && (!selection.sources?.length || selection.sources.includes(trafficSourceKey(r.communicationMode)))) : [];
  const total = source => source.reduce((n, r) => n + r.revenuePaise, 0);
  const poTotal = source => source.reduce((n, r) => n + (r.poAmountPaise || 0), 0);
  const hotRows = filtered.filter((row) => row.kind === 'hot');
  const coldRows = filtered.filter((row) => row.kind === 'cold');
  const hotOpen = hotRows.filter((row) => row.state === 'open');
  const hotClosed = hotRows.filter((row) => row.state === 'closed');
  const coldOpen = coldRows.filter((row) => row.state === 'open');
  const coldClosed = coldRows.filter((row) => row.state === 'closed');
  async function showServices(row) {
    const request = ++serviceRequest.current;
    setServiceView({ row, loading: true });
    try { const response = await api.get(`/leads/pipeline-revenue/${row.kind}/${row.id}/services`); if (request === serviceRequest.current) setServiceView({ row, ...response.data, loading: false }); }
    catch (e) { if (request === serviceRequest.current) setServiceView({ row, loading: false, error: e.response?.data?.error || 'Unable to load services.' }); }
  }
  function closeServices() { serviceRequest.current++; setServiceView(null); }
  function open(kind = '', state = '') { setRevenueRow(null); setCloseRow(null); setModalError(''); setSelection({ kind, state }); }
  function openSource(source) { setRevenueRow(null); setCloseRow(null); setModalError(''); setSelection({ sources: source.keys || [source.key], sourceLabel: source.label }); }
  function exportRows(source, name) {
    const data = source.map(r => ({
      'Lead ID': r.code, Company: r.company, 'Client Communication Mode': r.communicationMode || 'Other / Not specified', Status: r.converted ? 'Closed — Converted to Hot' : r.state, Owner: r.owner,
      'PO Amount (INR)': (r.poAmountPaise || 0) / 100, 'Estimated Revenue (INR)': r.revenuePaise / 100
    }));
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(data);
    sheet['!cols'] = [{ wch: 20 }, { wch: 45 }, { wch: 28 }, { wch: 28 }, { wch: 25 }, { wch: 24 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(book, sheet, 'Lead Pipeline');
    XLSX.writeFile(book, `${name}.xlsx`);
  }
  async function closeCold() {
    if (!closeRow || !remarks.trim() || closing) return;
    setClosing(true); setModalError('');
    try {
      await api.post(`/leads/revenue/cold/${closeRow.id}/close`, { remarks });
      setCloseRow(null); setRemarks(''); await load();
    } catch (e) { setModalError(e.response?.data?.error || 'Unable to close cold lead.'); }
    finally { setClosing(false); }
  }
  return <DashboardShell currentUser={currentUser}><div className="pipeline-page">
    <header className="pipeline-header"><div className="pipeline-heading"><h1>Revenue Pipeline</h1><p>A clear view of your hot and cold pipeline, with locked revenue history.</p></div><div className="pipeline-filters"><label><Search size={17}/><input aria-label="Search pipeline" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search company, lead ID or owner…"/></label><select aria-label="Filter by owner" value={owner} onChange={e => setOwner(e.target.value)}><option value="">All visible owners</option>{[...new Set(rows.map(r => r.owner))].sort().map(name => <option key={name}>{name}</option>)}</select><span><Users size={15}/>{unique.length} unique leads</span></div></header>
    {error && <p role="alert" className="pipeline-error">{error}</p>}
    {loading ? <div role="status" className="pipeline-empty">Loading your lead pipeline…</div> : <>
      <section className="pipeline-summary-grid" aria-label="Pipeline summary">
        <button type="button" onClick={() => open()}><span className="is-green"><Users/></span><small>Unique Leads</small><strong>{unique.length.toLocaleString('en-IN')}</strong></button>
        <button type="button" onClick={() => open()}><span className="is-emerald"><BadgeIndianRupee/></span><small>Estimated Revenue</small><strong>{revenueMoney(total(unique))}</strong></button>
        <button type="button" onClick={() => open('hot')}><span className="is-orange"><Flame/></span><small>Hot Leads</small><strong>{hotRows.length.toLocaleString('en-IN')}</strong></button>
        <button type="button" onClick={() => open('cold')}><span className="is-blue"><Snowflake/></span><small>Cold Leads</small><strong>{coldRows.length.toLocaleString('en-IN')}</strong></button>
      </section>
      <div className="pipeline-content-layout"><section className="pipeline-overview" aria-label="Pipeline Overview">
        <h2>Pipeline Overview</h2>
        <div className="pipeline-overview-table"><table><thead><tr>{['Pipeline', 'Total Leads', 'Open', 'Closed', 'Estimated Revenue', 'PO Value'].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>
          <tr><td><button type="button" onClick={() => open('hot')}><Flame/>Hot Leads</button></td><td>{hotRows.length.toLocaleString('en-IN')}</td><td><button type="button" onClick={() => open('hot', 'open')}>{hotOpen.length.toLocaleString('en-IN')}</button></td><td><button type="button" onClick={() => open('hot', 'closed')}>{hotClosed.length.toLocaleString('en-IN')}</button></td><td>{revenueMoney(total(hotRows))}</td><td>{revenueMoney(poTotal(hotClosed))}</td></tr>
          <tr><td><button type="button" onClick={() => open('cold')}><Snowflake/>Cold Leads</button></td><td>{coldRows.length.toLocaleString('en-IN')}</td><td><button type="button" onClick={() => open('cold', 'open')}>{coldOpen.length.toLocaleString('en-IN')}</button></td><td><button type="button" onClick={() => open('cold', 'closed')}>{coldClosed.length.toLocaleString('en-IN')}</button></td><td>{revenueMoney(total(coldRows))}</td><td>—</td></tr>
        </tbody></table></div>
        <div className="pipeline-kind-grid">
          <article className="pipeline-kind-card hot"><header><span><Flame/></span><button type="button" onClick={() => open('hot')}>Hot Leads<ArrowUpRight/></button></header><div className="pipeline-kind-counts"><button type="button" onClick={() => open('hot', 'open')}><small>Open</small><strong>{hotOpen.length.toLocaleString('en-IN')}</strong></button><button type="button" onClick={() => open('hot', 'closed')}><small>Closed</small><strong>{hotClosed.length.toLocaleString('en-IN')}</strong></button></div><div className="pipeline-kind-money"><button type="button" onClick={() => open('hot')}><small>Estimated Revenue</small><strong>{revenueMoney(total(hotRows))}</strong></button><button type="button" onClick={() => open('hot', 'closed')}><small>PO Value</small><strong>{revenueMoney(poTotal(hotClosed))}</strong></button></div></article>
          <article className="pipeline-kind-card cold"><header><span><Snowflake/></span><button type="button" onClick={() => open('cold')}>Cold Leads<ArrowUpRight/></button></header><div className="pipeline-kind-counts"><button type="button" onClick={() => open('cold', 'open')}><small>Open</small><strong>{coldOpen.length.toLocaleString('en-IN')}</strong></button><button type="button" onClick={() => open('cold', 'closed')}><small>Closed</small><strong>{coldClosed.length.toLocaleString('en-IN')}</strong></button></div><div className="pipeline-kind-money"><button type="button" onClick={() => open('cold')}><small>Estimated Revenue</small><strong>{revenueMoney(total(coldRows))}</strong></button></div></article>
        </div>
        <p className="pipeline-note">Cold Closed includes leads converted to Hot. The overall count and revenue count each business lead once. PO value and estimated revenue are shown separately.</p>
      </section><TrafficSources sources={trafficSources} total={unique.length} onSelect={openSource} optionsUnavailable={sourceOptionsUnavailable}/></div>
    </>}
    <dialog ref={dialog} className="pipeline-dialog" onCancel={() => setSelection(null)} onClose={() => setSelection(null)}>
      {selection && <><header><div><p className="pipeline-eyebrow">PIPELINE DETAILS</p><h2>{selection.sourceLabel ? `Traffic Source · ${selection.sourceLabel}` : selection.kind ? `${selection.kind === 'hot' ? 'Hot' : 'Cold'} Leads` : 'All Leads'}{selection.state ? ` · ${selection.state === 'open' ? 'Open' : 'Closed'}` : ''}</h2><p>{listed.length} leads · {revenueMoney(total(listed))} estimated revenue{selection.kind === 'hot' && selection.state === 'closed' ? ` · ${revenueMoney(poTotal(listed))} PO value` : ''}</p></div><div className="pipeline-toolbar"><button type="button" onClick={() => exportRows(listed, 'pipeline-details')} disabled={!listed.length}><Download size={16}/>Excel</button><button type="button" onClick={() => setSelection(null)} aria-label="Close lead list"><X/></button></div></header>
      <div className="pipeline-dialog-body"><div className="pipeline-table-wrap"><table><thead><tr>{['Lead / Company', 'Status', 'Actual Lead Owner', 'PO amount', 'Estimated revenue', 'Actions'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{listed.map(r => <tr key={`${r.kind}-${r.id}`}><td><button type="button" className="pipeline-company-button" onClick={() => showServices(r)}><b>{r.company}</b><ArrowUpRight size={14}/></button><small>{r.code}</small></td><td><span className={`pipeline-badge ${r.state}`}>{r.state}</span>{r.converted && <small>Converted to Hot Lead</small>}</td><td><span className="pipeline-owner"><Users size={14}/>{r.owner}</span></td><td className="font-bold">{r.kind === 'hot' ? revenueMoney(r.poAmountPaise) : '—'}</td><td className="font-black">{revenueMoney(r.revenuePaise)}</td><td><button type="button" onClick={() => { setRevenueRow(r); setCloseRow(null); }}>Revenue history</button>{r.kind === 'cold' && r.state === 'open' && <button type="button" onClick={() => { setCloseRow(r); setRevenueRow(null); setRemarks(''); setModalError(''); }}>Close cold lead</button>}</td></tr>)}</tbody></table>{!listed.length && <p className="pipeline-empty">No leads in this category.</p>}</div>

        {revenueRow && <section className="mt-4"><h3 className="font-black">{revenueRow.company} · Revenue</h3><LeadRevenuePanel key={`${revenueRow.kind}-${revenueRow.id}`} kind={revenueRow.kind} leadId={revenueRow.id} onSaved={load}/></section>}
        {closeRow && <section className="mt-5 rounded-2xl border bg-slate-50 p-5"><h3 className="font-black">Close cold lead: {closeRow.company}</h3><p className="mt-2 text-sm text-slate-500">This moves the lead to Closed Cold Leads and locks its estimate. It does not convert it to a Hot Lead.</p><label className="mt-3 block text-sm font-bold">Closing remarks<textarea value={remarks} onChange={e => setRemarks(e.target.value)} maxLength={1000} className="mt-2 block w-full rounded-xl border bg-white p-3"/></label><button type="button" disabled={closing || !remarks.trim()} onClick={closeCold} className="mt-3 rounded-xl bg-emerald-800 px-4 py-3 font-bold text-white disabled:opacity-40">{closing ? 'Closing…' : 'Confirm close'}</button><button type="button" onClick={() => setCloseRow(null)} className="ml-3">Cancel</button></section>}
        {modalError && <p role="alert" className="pipeline-error">{modalError}</p>}
      </div></>}
    </dialog>
    <dialog ref={serviceDialog} className="pipeline-dialog pipeline-services-dialog" onCancel={closeServices} onClose={closeServices}>
      {serviceView && <><header><div><p className="pipeline-eyebrow">CLIENT DETAILS</p><h2>{serviceView.row.company}</h2><p>{serviceView.row.code} · {serviceView.services?.length || 0} services</p></div><button type="button" onClick={closeServices} aria-label="Close services" className="rounded-xl border bg-white p-2"><X/></button></header><div className="pipeline-dialog-body">
        {serviceView.loading ? <p role="status" className="pipeline-empty">Loading services…</p> : serviceView.error ? <p role="alert" className="pipeline-error">{serviceView.error}</p> : <>
          {serviceView.clientDetails && <section className="pipeline-client-profile" aria-label="Client contact details">{[
            ['Contact person', serviceView.clientDetails.contactPerson], ['Email', serviceView.clientDetails.email], ['Phone', serviceView.clientDetails.phone],
            ['Communication mode', serviceView.clientDetails.communicationMode || 'Other / Not specified'], ['Industry / Sector', serviceView.clientDetails.industry], ['Lead owner', serviceView.row.owner],
            ['Address', serviceView.clientDetails.address], ['City / State / PIN', [serviceView.clientDetails.city, serviceView.clientDetails.state, serviceView.clientDetails.pinCode].filter(Boolean).join(', ')],
            ...(serviceView.clientDetails.communicationNote ? [['Communication note', serviceView.clientDetails.communicationNote]] : [])
          ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || 'Not recorded'}</strong></div>)}</section>}
          <h3 className="mb-3 mt-5 font-black">Services &amp; assignments</h3>
          <div className="pipeline-service-grid">{(serviceView.services || []).map((service, index) => <article key={service.id}><div className="flex items-start justify-between gap-3"><span className="pipeline-service-index">{String(index + 1).padStart(2, '0')}</span><span className={`pipeline-badge ${service.closed ? 'closed' : 'open'}`}>{service.closed ? 'Closed' : 'Open'}</span></div><h3>{service.offering || 'Service'}</h3><p>{service.category || 'Category not recorded'}</p><dl><div><dt>Applicant</dt><dd>{service.applicant || '—'}</dd></div><div><dt>Financial year</dt><dd>{service.year || '—'}</dd></div><div><dt>Manager</dt><dd>{service.manager || '—'}</dd></div><div><dt>Staff</dt><dd>{service.staff || '—'}</dd></div></dl></article>)}</div>
          {!serviceView.services?.length && <p className="pipeline-empty">No accessible services recorded for this lead yet.</p>}
          {serviceView.purchaseOrders?.length > 0 && <section className="mt-5"><h3 className="mb-3 font-black">Recorded purchase orders</h3><div className="pipeline-po-list">{serviceView.purchaseOrders.map((po, index) => <div key={index}><b>{po.number}</b><span>{po.date || 'Date not recorded'}</span><strong>{revenueMoney(po.amountPaise)}</strong></div>)}</div></section>}
        </>}
      </div></>}
    </dialog>
  </div></DashboardShell>;
}
