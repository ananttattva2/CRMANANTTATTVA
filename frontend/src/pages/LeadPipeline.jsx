import TrafficSources from '../components/leads/TrafficSources';
import { trafficSourceHierarchy, trafficSourceKey } from '../utils/trafficSources.mjs';
import { currentPipelineRows, uniquePipelineRows, pipelinePeriodRange, previousPipelinePeriodRange, inPipelinePeriod } from '../utils/leadPipeline.mjs';
import { salesRepSummary } from '../utils/salesRepSummary.mjs';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpRight, Download, Flame, Minus, Search, Snowflake, Users, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import DashboardShell from '../components/dashboard/DashboardShell';
import DashboardViewTabs from '../components/dashboard/DashboardViewTabs';
import LeadRevenuePanel, { revenueMoney } from '../components/leads/LeadRevenuePanel';
import useCrmRefresh from '../hooks/useCrmRefresh';
import api from '../services/api';
import '../styles/lead-pipeline.css';

function RepMetric({ value, previous, comparisonLabel, tone, onClick, label }) {
  const difference = value - previous;
  const TrendIcon = difference > 0 ? ArrowUp : difference < 0 ? ArrowDown : Minus;
  const percentChange = previous > 0 ? Math.round((difference / previous) * 100) : null;
  const changeText = difference === 0
    ? 'No change'
    : previous === 0
      ? `New +${value.toLocaleString('en-IN')}`
      : `${difference > 0 ? '+' : ''}${difference.toLocaleString('en-IN')} (${percentChange > 0 ? '+' : ''}${percentChange}%)`;
  return <button type="button" className={`sales-rep-metric ${tone || ''}`} onClick={onClick} disabled={!value} aria-label={`${label}: ${value} leads. View clients`}>
    {comparisonLabel && <small>This {comparisonLabel}</small>}
    <strong>{value.toLocaleString('en-IN')}</strong>
    {comparisonLabel && <span className="sales-rep-previous">Previous: <b>{previous.toLocaleString('en-IN')}</b></span>}
    {comparisonLabel && <span className={`sales-rep-change ${difference > 0 ? 'is-up' : difference < 0 ? 'is-down' : 'is-flat'}`} title={`${value} this ${comparisonLabel}; ${previous} in the previous ${comparisonLabel}`}>
      <TrendIcon aria-hidden="true" />{changeText}
    </span>}
  </button>;
}

function CardPeriodComparison({ value, previous, comparisonLabel }) {
  if (!comparisonLabel) return null;
  const difference = value - previous;
  const percent = previous > 0 ? Math.round((difference / previous) * 100) : null;
  const text = difference === 0
    ? 'No change'
    : previous === 0
      ? `New +${value.toLocaleString('en-IN')}`
      : `${difference > 0 ? '+' : ''}${difference.toLocaleString('en-IN')} (${percent > 0 ? '+' : ''}${percent}%)`;
  const TrendIcon = difference > 0 ? ArrowUp : difference < 0 ? ArrowDown : Minus;
  return <span className={`pipeline-card-comparison ${difference > 0 ? 'is-up' : difference < 0 ? 'is-down' : 'is-flat'}`}>
    <span>Previous {comparisonLabel}: <b>{previous.toLocaleString('en-IN')}</b></span>
    <em><TrendIcon aria-hidden="true" />{text}</em>
  </span>;
}

function SalesRepTable({ reps, comparisonLabel, range, previousRange, onMetricClick, onSourceClick }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const pageCount = Math.max(1, Math.ceil(reps.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const first = (safePage - 1) * pageSize;
  const visibleReps = reps.slice(first, first + pageSize);
  useEffect(() => { setPage(1); }, [reps, pageSize]);
  return <section className="sales-rep-panel" aria-labelledby="sales-rep-heading">
    <header>
      <div><p className="pipeline-eyebrow">OWNER PERFORMANCE</p><h2 id="sales-rep-heading">Sales Rep</h2><p>Lead counts use the actual lead owner. Major traffic source shows each owner&rsquo;s top three parent sources.</p></div>
      <span className="sales-rep-total"><Users aria-hidden="true" />{reps.length} sales reps</span>
    </header>
    {comparisonLabel && <div className="sales-rep-comparison" role="note">
      <div><small>This {comparisonLabel}</small><strong>{range.label}</strong></div>
      <span aria-hidden="true">vs</span>
      <div><small>Previous {comparisonLabel}</small><strong>{previousRange.label}</strong></div>
      <p>Each cell shows the current count, previous count and exact change.</p>
    </div>}
    <div className="sales-rep-table-wrap">
      <table>
        <colgroup><col className="sales-rep-col-user"/><col className="sales-rep-col-metric"/><col className="sales-rep-col-metric"/><col className="sales-rep-col-cold"/><col className="sales-rep-col-source"/></colgroup>
        <thead><tr><th rowSpan="2">User Name</th><th colSpan="2">Hot Lead</th><th rowSpan="2">Cold Lead<br/><small>Open</small></th><th rowSpan="2">Major Traffic Source<br/><small>Top 3</small></th></tr><tr><th>Open</th><th>Closed</th></tr></thead>
        <tbody>{visibleReps.map((rep) => <tr key={rep.owner}>
          <td><span className="sales-rep-user"><i aria-hidden="true">{rep.owner.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()}</i><b>{rep.owner.toUpperCase()}</b></span></td>
          <td><RepMetric value={rep.hotOpen} previous={rep.previousHotOpen} comparisonLabel={comparisonLabel} tone="hot" label={`${rep.owner} Hot Open`} onClick={() => onMetricClick(rep.owner, 'hot', 'open')} /></td>
          <td><RepMetric value={rep.hotClosed} previous={rep.previousHotClosed} comparisonLabel={comparisonLabel} tone="closed" label={`${rep.owner} Hot Closed`} onClick={() => onMetricClick(rep.owner, 'hot', 'closed')} /></td>
          <td><RepMetric value={rep.coldOpen} previous={rep.previousColdOpen} comparisonLabel={comparisonLabel} tone="cold" label={`${rep.owner} Cold Open`} onClick={() => onMetricClick(rep.owner, 'cold', '')} /></td>
          <td><div className="sales-rep-sources">{rep.trafficSources.length ? rep.trafficSources.map((source, index) => <button type="button" key={source.label} onClick={() => onSourceClick(rep.owner, source)} aria-label={`View ${rep.owner} clients from ${source.label}`}><em>{index + 1}</em>{source.label}<b>{source.count}</b></button>) : <small>No source recorded in this period</small>}</div></td>
        </tr>)}</tbody>
      </table>
      {!reps.length && <p className="pipeline-empty">No sales representatives match these filters.</p>}
    </div>
    {!!reps.length && <footer className="sales-rep-pagination">
      <span>Showing <b>{first + 1}</b>–<b>{Math.min(first + pageSize, reps.length)}</b> of <b>{reps.length}</b> users</span>
      <label>Rows per page<select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}><option value="10">10</option><option value="25">25</option><option value="50">50</option></select></label>
      <div><button type="button" onClick={() => setPage(value => Math.max(1, value - 1))} disabled={safePage === 1} aria-label="Previous Sales Rep page">Previous</button><span>Page {safePage} of {pageCount}</span><button type="button" onClick={() => setPage(value => Math.min(pageCount, value + 1))} disabled={safePage === pageCount} aria-label="Next Sales Rep page">Next</button></div>
    </footer>}
  </section>;
}

export default function LeadPipeline() {
  const [currentUser, setCurrentUser] = useState(null);
  const [rows, setRows] = useState([]);
  const [sourceModes, setSourceModes] = useState([]);
  const [activeUsers, setActiveUsers] = useState(null);
  const [sourceOptionsUnavailable, setSourceOptionsUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [owner, setOwner] = useState('');
  const [period, setPeriod] = useState('all');
  const [periodDate, setPeriodDate] = useState(() => `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`);
  const range = useMemo(() => pipelinePeriodRange(period, periodDate), [period, periodDate]);
  const previousRange = useMemo(() => previousPipelinePeriodRange(period, periodDate), [period, periodDate]);
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
      const [me, result, modeOptions, userOptions] = await Promise.all([api.get('/auth/me'), api.get('/leads/pipeline-revenue?view=sales-rep-v4'), api.get('/leads/dropdown-options').catch(() => null), api.get('/auth/users').catch(() => null)]);
      if (version !== sequence.current) return;
      setCurrentUser(me.data.user); setRows(result.data.rows || []); setSourceModes(modeOptions?.data?.options?.communicationMode || []); setActiveUsers(userOptions?.data?.users || null); setSourceOptionsUnavailable(!modeOptions); setError('');
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
  const baseFiltered = useMemo(() => rows.filter(r => (!owner || r.owner === owner) && `${r.company} ${r.code} ${r.owner}`.toLowerCase().includes(query.trim().toLowerCase())), [rows, query, owner]);
  const filtered = useMemo(() => currentPipelineRows(baseFiltered.filter(r => inPipelinePeriod(r.createdAt, range))), [baseFiltered, range]);
  const previousFiltered = useMemo(() => previousRange ? currentPipelineRows(baseFiltered.filter(r => inPipelinePeriod(r.createdAt, previousRange))) : [], [baseFiltered, previousRange]);
  const unique = uniquePipelineRows(filtered);
  const trafficSources = useMemo(() => trafficSourceHierarchy(filtered, sourceModes), [filtered, sourceModes]);
  const listed = selection ? (selection.kind ? filtered : unique).filter(r => (!selection.kind || r.kind === selection.kind) && (!selection.state || r.state === selection.state) && (!selection.owner || r.owner === selection.owner) && (!selection.sources?.length || selection.sources.includes(trafficSourceKey(r.communicationMode)))) : [];
  const total = source => source.reduce((n, r) => n + r.revenuePaise, 0);
  const poTotal = source => source.reduce((n, r) => n + (r.poAmountPaise || 0), 0);
  const hotRows = filtered.filter((row) => row.kind === 'hot');
  const coldRows = filtered.filter((row) => row.kind === 'cold');
  const hotOpen = hotRows.filter((row) => row.state === 'open');
  const hotClosed = hotRows.filter((row) => row.state === 'closed');
  const previousHotRows = previousFiltered.filter((row) => row.kind === 'hot');
  const previousColdRows = previousFiltered.filter((row) => row.kind === 'cold');
  const previousHotOpen = previousHotRows.filter((row) => row.state === 'open');
  const previousHotClosed = previousHotRows.filter((row) => row.state === 'closed');
  const activeOwnerIndex = useMemo(() => activeUsers ? {
    ids: new Set(activeUsers.flatMap((user) => [user._id, user.id, user.crmUserId].filter(Boolean).map(String))),
    names: new Set(activeUsers.flatMap((user) => [user.name, user.email].filter(Boolean).map((value) => String(value).trim().toLowerCase())))
  } : null, [activeUsers]);
  const activeOwnerRows = useMemo(() => (source) => source.filter((row) => {
    if (row.owner === 'Unassigned') return true;
    if (row.ownerActive === false) return false;
    if (!activeOwnerIndex) return true;
    return (row.ownerId && activeOwnerIndex.ids.has(String(row.ownerId))) || activeOwnerIndex.names.has(String(row.owner || '').trim().toLowerCase());
  }), [activeOwnerIndex]);
  const ownerOptions = useMemo(() => [...new Set(activeOwnerRows(rows).map((row) => row.owner).filter((name) => name && name !== 'Unassigned'))].sort(), [activeOwnerRows, rows]);
  useEffect(() => { if (owner && !ownerOptions.includes(owner)) setOwner(''); }, [owner, ownerOptions]);
  const salesReps = useMemo(() => salesRepSummary(activeOwnerRows(filtered), activeOwnerRows(previousFiltered), sourceModes), [activeOwnerRows, filtered, previousFiltered, sourceModes]);
  const comparisonLabel = period === 'week' ? 'week' : period === 'month' ? 'month' : '';
  async function showServices(row) {
    const request = ++serviceRequest.current;
    setServiceView({ row, loading: true });
    try { const response = await api.get(`/leads/pipeline-revenue/${row.kind}/${row.id}/services`); if (request === serviceRequest.current) setServiceView({ row, ...response.data, loading: false }); }
    catch (e) { if (request === serviceRequest.current) setServiceView({ row, loading: false, error: e.response?.data?.error || 'Unable to load services.' }); }
  }
  function closeServices() { serviceRequest.current++; setServiceView(null); }
  function open(kind = '', state = '', selectedOwner = '') { setRevenueRow(null); setCloseRow(null); setModalError(''); setSelection({ kind, state, owner: selectedOwner }); }
  function openSource(source) { setRevenueRow(null); setCloseRow(null); setModalError(''); setSelection({ sources: source.keys || [source.key], sourceLabel: source.label }); }
  function openOwnerSource(selectedOwner, source) { setRevenueRow(null); setCloseRow(null); setModalError(''); setSelection({ owner: selectedOwner, sources: source.keys || [source.key], sourceLabel: source.label }); }
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
    <DashboardViewTabs />
    <header className="pipeline-header"><div className="pipeline-heading"><h1>Revenue Pipeline</h1><p>A clear view of your hot and cold pipeline, with locked revenue history.</p></div><div className="pipeline-filters"><label><Search size={17}/><input aria-label="Search pipeline" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search company, lead ID or owner…"/></label><select aria-label="Filter by owner" value={owner} onChange={e => setOwner(e.target.value)}><option value="">All active owners</option>{ownerOptions.map(name => <option key={name} value={name}>{name.toUpperCase()}</option>)}</select></div></header>
    <section className="pipeline-period-bar" aria-label="Pipeline date filters">
      <div className="pipeline-period-tabs" role="group" aria-label="Filter period">{[['all', 'All time'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']].map(([value, label]) => <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>)}</div>
      <div className="pipeline-period-context">{period !== 'all' && <label>Choose {period}{period === 'year' ? <select aria-label="Choose year" value={periodDate.slice(0, 4)} onChange={e => setPeriodDate(`${e.target.value}-01-01`)}>{[...new Set([new Date().getFullYear(), Number(periodDate.slice(0, 4)), ...rows.map(row => new Date(row.createdAt).getFullYear()).filter(Number.isFinite)])].sort((a, b) => b - a).map(year => <option key={year} value={year}>{year}</option>)}</select> : <input aria-label={`Choose ${period}`} type={period === 'month' ? 'month' : 'date'} value={period === 'month' ? periodDate.slice(0, 7) : periodDate} onChange={e => { if (e.target.value) setPeriodDate(period === 'month' ? `${e.target.value}-01` : e.target.value); }}/>}</label>}<span>{range.label} · Lead creation date</span></div>
      <button className="pipeline-export" type="button" disabled={loading || !unique.length} onClick={() => exportRows(unique, `pipeline-${period}`)}><Download size={16}/>Export</button>
    </section>
    {error && <p role="alert" className="pipeline-error">{error}</p>}
    {loading ? <div role="status" className="pipeline-empty">Loading your lead pipeline…</div> : <>
      <div className="pipeline-content-layout"><section className="pipeline-sales-workspace" aria-label="Sales pipeline">
        {!unique.length && <p role="status" className="pipeline-filter-empty">No leads match these filters. Try another period or owner.</p>}
        <div className="pipeline-kind-grid">
          <article className="pipeline-kind-card hot"><header><span><Flame/></span><button type="button" onClick={() => open('hot')}>Hot Leads<ArrowUpRight/></button>{comparisonLabel && <small className="pipeline-card-period">{comparisonLabel} comparison</small>}</header><div className="pipeline-kind-counts"><button type="button" onClick={() => open('hot', 'open')}><small>Open</small><strong>{hotOpen.length.toLocaleString('en-IN')}</strong><CardPeriodComparison value={hotOpen.length} previous={previousHotOpen.length} comparisonLabel={comparisonLabel}/></button><button type="button" onClick={() => open('hot', 'closed')}><small>Closed</small><strong>{hotClosed.length.toLocaleString('en-IN')}</strong><CardPeriodComparison value={hotClosed.length} previous={previousHotClosed.length} comparisonLabel={comparisonLabel}/></button></div><div className="pipeline-kind-money"><button type="button" onClick={() => open('hot')}><small>Estimated Revenue</small><strong>{revenueMoney(total(hotRows))}</strong></button><button type="button" onClick={() => open('hot', 'closed')}><small>PO Value</small><strong>{revenueMoney(poTotal(hotClosed))}</strong></button></div></article>
          <article className="pipeline-kind-card cold"><header><span><Snowflake/></span><button type="button" onClick={() => open('cold')}>Cold Leads<ArrowUpRight/></button>{comparisonLabel && <small className="pipeline-card-period">{comparisonLabel} comparison</small>}</header><div className="pipeline-kind-counts pipeline-kind-counts-single"><button type="button" onClick={() => open('cold')}><small>Open</small><strong>{coldRows.length.toLocaleString('en-IN')}</strong><CardPeriodComparison value={coldRows.length} previous={previousColdRows.length} comparisonLabel={comparisonLabel}/></button></div><div className="pipeline-kind-money"><button type="button" onClick={() => open('cold')}><small>Estimated Revenue</small><strong>{revenueMoney(total(coldRows))}</strong></button></div></article>
        </div>
        <p className="pipeline-note">Converted leads appear only in the Hot pipeline. Hot plus Cold therefore matches the unique Traffic Source total. PO value and estimated revenue are shown separately.</p>
      </section><TrafficSources sources={trafficSources} onSelect={openSource} optionsUnavailable={sourceOptionsUnavailable}/></div>
      <SalesRepTable reps={salesReps} comparisonLabel={comparisonLabel} range={range} previousRange={previousRange} onMetricClick={(selectedOwner, kind, state) => open(kind, state, selectedOwner)} onSourceClick={openOwnerSource}/>
    </>}
    <dialog ref={dialog} className="pipeline-dialog" onCancel={() => setSelection(null)} onClose={() => setSelection(null)}>
      {selection && <><header><div><p className="pipeline-eyebrow">PIPELINE DETAILS</p><h2>{selection.owner ? `${selection.owner.toUpperCase()} · ` : ''}{selection.sourceLabel ? `Traffic Source · ${selection.sourceLabel}` : selection.kind ? `${selection.kind === 'hot' ? 'Hot' : 'Cold'} Leads` : 'All Leads'}{selection.state ? ` · ${selection.state === 'open' ? 'Open' : 'Closed'}` : ''}</h2><p>{selection.owner ? `Lead Owner: ${selection.owner.toUpperCase()} · ` : ''}{listed.length} clients · {revenueMoney(total(listed))} estimated revenue{selection.kind === 'hot' && selection.state === 'closed' ? ` · ${revenueMoney(poTotal(listed))} PO value` : ''}</p></div><div className="pipeline-toolbar"><button type="button" onClick={() => exportRows(listed, 'pipeline-details')} disabled={!listed.length}><Download size={16}/>Excel</button><button type="button" onClick={() => setSelection(null)} aria-label="Close lead list"><X/></button></div></header>
      <div className="pipeline-dialog-body"><div className="pipeline-table-wrap"><table><thead><tr>{['Lead / Company', 'Status', 'Actual Lead Owner', 'PO amount', 'Estimated revenue', 'Actions'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{listed.map(r => <tr key={`${r.kind}-${r.id}`}><td><button type="button" className="pipeline-company-button" onClick={() => showServices(r)}><b>{r.company}</b><ArrowUpRight size={14}/></button><small>{r.code}</small></td><td><span className={`pipeline-badge ${r.state}`}>{r.state}</span>{r.converted && <small>Converted to Hot Lead</small>}</td><td><span className="pipeline-owner"><Users size={14}/>{r.owner.toUpperCase()}</span></td><td className="font-bold">{r.kind === 'hot' ? revenueMoney(r.poAmountPaise) : '—'}</td><td className="font-black">{revenueMoney(r.revenuePaise)}</td><td><button type="button" onClick={() => { setRevenueRow(r); setCloseRow(null); }}>Revenue history</button>{r.kind === 'cold' && r.state === 'open' && <button type="button" onClick={() => { setCloseRow(r); setRevenueRow(null); setRemarks(''); setModalError(''); }}>Close cold lead</button>}</td></tr>)}</tbody></table>{!listed.length && <p className="pipeline-empty">No leads in this category.</p>}</div>

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
