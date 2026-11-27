import { readPageSnapshot, savePageSnapshot } from '../services/pageReadSnapshot';
import { exportWithReason } from '../utils/dataExport.mjs'
import TrafficSources from '../components/leads/TrafficSources';
import { isExistingClientTrafficSource, trafficSourceHierarchy, trafficSourceKey } from '../utils/trafficSources.mjs';
import { currentPipelineRows, summaryPipelineRows, uniquePipelineRows, pipelinePeriodRange, previousPipelinePeriodRange, inPipelinePeriod } from '../utils/leadPipeline.mjs';
import { salesRepSummary, salesRepTableData, salesRepOwner, isUnassignedOwner } from '../utils/salesRepSummary.mjs';
import { downloadSalesRepPerformancePdf } from '../utils/salesRepPerformancePdf.mjs';
import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpRight, CalendarDays, ChevronDown, CircleDollarSign, Download, FileText, Flame, LayoutGrid, Minus, RefreshCw, Search, Snowflake, Target, Users, WalletCards, X } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Cell, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import DashboardShell from '../components/dashboard/DashboardShell';
import DashboardViewTabs from '../components/dashboard/DashboardViewTabs';
import LeadRevenuePanel, { revenueMoney } from '../components/leads/LeadRevenuePanel';
import useCrmRefresh from '../hooks/useCrmRefresh';
import api from '../services/api';
import { API_ENDPOINTS } from '../services/apiEndpoints';
import { filterQuotationServices, quotationLeadIdsInPeriod, quotationMatchesLeadIds } from '../utils/quotationServiceView.mjs';
import OpenQuotationsDialog from '../components/dashboard/OpenQuotationsDialog';
import PipelineLeadQuotations from '../components/dashboard/PipelineLeadQuotations';
import PipelineClientDetails from '../components/dashboard/PipelineClientDetails';
import '../styles/lead-pipeline.css';

const LEAD_DETAILS_PAGE_SIZE = 4;

function storedUser() {
  try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
}

function PipelineSkeleton() {
  return <div className="pipeline-skeleton" role="status" aria-label="Loading Summary Dashboard">
    <div className="pipeline-skeleton-cards"><i/><i/></div>
    <div className="pipeline-skeleton-table"><i/><i/><i/><i/></div>
  </div>;
}

function percentChange(value, previous) {
  if (!previous) return value ? 100 : 0;
  return Math.round(((value - previous) / previous) * 100);
}

function Sparkline({ values, color }) {
  const safe = values.length ? values : [0];
  const max = Math.max(...safe, 1);
  const points = safe.map((value, index) => `${(index / Math.max(1, safe.length - 1)) * 92 + 4},${42 - (value / max) * 32}`).join(' ');
  return <svg className="summary-kpi-spark" viewBox="0 0 100 48" aria-hidden="true"><polyline points={points} style={{ stroke: color }}/></svg>;
}

function SummaryKpi({ label, value, previous, comparisonLabel, icon: Icon, tone, trend, onClick, money = false }) {
  const change = percentChange(value, previous);
  const formatted = money ? revenueMoney(value) : value.toLocaleString('en-IN');
  return <button type="button" className={`summary-kpi summary-kpi-${tone}`} onClick={onClick}>
    <span className="summary-kpi-icon"><Icon aria-hidden="true"/></span>
    <span className="summary-kpi-copy"><small>{label}</small><strong>{formatted}</strong><em className={change >= 0 ? 'is-up' : 'is-down'}>{comparisonLabel ? `${change >= 0 ? '+' : ''}${change}% vs last ${comparisonLabel}` : 'Current visible total'}</em></span>
    <Sparkline values={trend} color={`var(--kpi-accent)`}/>
  </button>;
}

function SummaryStatusChart({ items, previousItems = [], comparisonLabel = '' }) {
  const totalValue = items.reduce((sum, item) => sum + item.value, 0);
  return <section className="summary-chart-card summary-status-card" aria-labelledby="lead-status-heading">
    <header><span><WalletCards/></span><div><h2 id="lead-status-heading">Lead Status</h2><p>Overall lead distribution</p></div></header>
    <div className="summary-status-body">
      <div className="summary-donut"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={items} dataKey="value" innerRadius="62%" outerRadius="88%" paddingAngle={2} stroke="none">{items.map(item => <Cell key={item.label} fill={item.color}/>)}</Pie><Tooltip formatter={(value) => `${Number(value).toLocaleString('en-IN')} leads`}/></PieChart></ResponsiveContainer><span><strong>{totalValue.toLocaleString('en-IN')}</strong><small>Total Leads</small></span></div>
      <div className="summary-status-legend">{items.map(item => { const previous = previousItems.find((entry) => entry.label === item.label)?.value || 0; return <div key={item.label}><i style={{ background:item.color }}/><span>{item.label}</span><b>{item.value.toLocaleString('en-IN')}</b><small>{comparisonLabel ? `Prev ${previous.toLocaleString('en-IN')}` : totalValue ? `${(item.value / totalValue * 100).toFixed(1)}%` : '0%'}</small></div>; })}</div>
    </div>
  </section>;
}

function PipelineTrendChart({ data, previousData = [], comparisonLabel = '' }) {
  const chartData = data.map((item, index) => ({ ...item, previousHot:previousData[index]?.hot || 0, previousCold:previousData[index]?.cold || 0 }));
  return <section className="summary-chart-card summary-trend-card" aria-labelledby="pipeline-overview-heading">
    <header><div><h2 id="pipeline-overview-heading">Revenue Pipeline Overview</h2><p>{comparisonLabel ? `Solid lines: this ${comparisonLabel} · Dashed lines: previous ${comparisonLabel}` : 'Lead and revenue movement across the selected period'}</p></div></header>
    <div className="summary-trend-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top:10, right:10, left:-18, bottom:0 }}><defs><linearGradient id="hotArea" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ff7a38" stopOpacity=".28"/><stop offset="95%" stopColor="#ff7a38" stopOpacity="0"/></linearGradient><linearGradient id="coldArea" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity=".22"/><stop offset="95%" stopColor="#3b82f6" stopOpacity="0"/></linearGradient></defs><CartesianGrid stroke="#e8eef2" strokeDasharray="3 3" vertical={false}/><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize:9, fill:'#789' }}/><YAxis yAxisId="leads" axisLine={false} tickLine={false} tick={{ fontSize:9, fill:'#789' }} allowDecimals={false}/><YAxis yAxisId="money" orientation="right" hide/><Tooltip formatter={(value, name) => name === 'Revenue' ? revenueMoney(Number(value) * 100) : `${Number(value).toLocaleString('en-IN')} leads`}/><Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize:10 }}/><Area yAxisId="leads" type="monotone" dataKey="hot" name="Hot Leads" stroke="#ff6a24" strokeWidth={2.5} fill="url(#hotArea)"/><Area yAxisId="leads" type="monotone" dataKey="cold" name="Cold Leads" stroke="#3485f6" strokeWidth={2.5} fill="url(#coldArea)"/>{comparisonLabel && <Line yAxisId="leads" type="monotone" dataKey="previousHot" name={`Previous ${comparisonLabel} Hot`} stroke="#ff9b70" strokeWidth={1.7} strokeDasharray="5 4" dot={false}/>} {comparisonLabel && <Line yAxisId="leads" type="monotone" dataKey="previousCold" name={`Previous ${comparisonLabel} Cold`} stroke="#82b8fa" strokeWidth={1.7} strokeDasharray="5 4" dot={false}/>}<Line yAxisId="money" type="monotone" dataKey="revenue" name="Revenue" stroke="#22b573" strokeWidth={2.5} dot={false}/></AreaChart></ResponsiveContainer></div>
  </section>;
}

function pipelineTrend(rows, period, periodDate, range) {
  const buckets = [];
  const addBucket = (date, label) => buckets.push({ key: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`, start:date.getTime(), label, hot:0, cold:0, revenue:0 });
  if (period === 'week' && range.start !== undefined) {
    for (let index = 0; index < 7; index += 1) { const date = new Date(range.start); date.setDate(date.getDate() + index); addBucket(date, date.toLocaleDateString('en-IN', { weekday:'short' })); }
  } else if (period === 'month') {
    const start = new Date(`${periodDate.slice(0, 7)}-01T00:00:00`);
    const days = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= days; day += 1) { const date = new Date(start.getFullYear(), start.getMonth(), day); addBucket(date, String(day)); }
  } else if (period === 'quarter' && range.start !== undefined) {
    const start = new Date(range.start);
    for (let index = 0; index < 3; index += 1) { const date = new Date(start.getFullYear(), start.getMonth() + index, 1); addBucket(date, date.toLocaleDateString('en-IN', { month:'short' })); }
  } else if (period === 'custom' && range.start !== undefined && !range.invalid) {
    const start = new Date(range.start); const end = new Date(range.end); const days = Math.ceil((end - start) / 86400000);
    if (days <= 31) for (let index = 0; index < days; index += 1) { const date = new Date(start); date.setDate(date.getDate() + index); addBucket(date, date.toLocaleDateString('en-IN', { day:'numeric', month:'short' })); }
    else { const cursor = new Date(start.getFullYear(), start.getMonth(), 1); while (cursor < end && buckets.length < 24) { addBucket(new Date(cursor), cursor.toLocaleDateString('en-IN', { month:'short', year:'2-digit' })); cursor.setMonth(cursor.getMonth() + 1); } }
  } else {
    const timestamps = rows.map(row => new Date(row.reportDate || row.createdAt).getTime()).filter(Number.isFinite);
    const anchor = period === 'year' ? new Date(`${periodDate.slice(0, 4)}-12-01T00:00:00`) : new Date(timestamps.length ? Math.max(...timestamps) : Date.now());
    const firstMonth = period === 'year' ? 0 : anchor.getMonth() - 11;
    for (let index = 0; index < 12; index += 1) { const date = new Date(anchor.getFullYear(), firstMonth + index, 1); addBucket(date, date.toLocaleDateString('en-IN', { month:'short' })); }
  }
  const endFor = (bucket, index) => index + 1 < buckets.length ? buckets[index + 1].start : (() => { if (period === 'custom' && range.end) return range.end; const date = new Date(bucket.start); period === 'week' || period === 'month' ? date.setDate(date.getDate() + 1) : date.setMonth(date.getMonth() + 1); return date.getTime(); })();
  rows.forEach(row => {
    const timestamp = new Date(row.reportDate || row.createdAt).getTime();
    const index = buckets.findIndex((bucket, bucketIndex) => timestamp >= bucket.start && timestamp < endFor(bucket, bucketIndex));
    if (index < 0) return;
    buckets[index][row.kind === 'hot' ? 'hot' : 'cold'] += 1;
    buckets[index].revenue += Number(row.revenuePaise || 0) / 100;
  });
  return buckets;
}

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

function CardPeriodComparison({ value, previous = 0, comparisonLabel, money = false }) {
  if (!comparisonLabel) return null;
  const format = money ? revenueMoney : number => number.toLocaleString('en-IN');
  const difference = value - previous;
  const percent = previous > 0 ? Math.round((difference / previous) * 100) : null;
  const text = difference === 0
    ? 'No change'
    : previous === 0
      ? `New +${money ? revenueMoney(value) : value.toLocaleString('en-IN')}`
      : `${difference > 0 ? '+' : difference < 0 && money ? '-' : ''}${money ? revenueMoney(Math.abs(difference)) : difference.toLocaleString('en-IN')} (${percent > 0 ? '+' : ''}${percent}%)`;
  const TrendIcon = difference > 0 ? ArrowUp : difference < 0 ? ArrowDown : Minus;
  return <span className={`pipeline-card-comparison ${difference > 0 ? 'is-up' : difference < 0 ? 'is-down' : 'is-flat'}`}>
    <span>Previous {comparisonLabel}: <b>{money ? revenueMoney(previous) : previous.toLocaleString('en-IN')}</b></span>
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
        <colgroup><col className="sales-rep-col-user"/><col className="sales-rep-col-total"/><col className="sales-rep-col-metric"/><col className="sales-rep-col-metric"/><col className="sales-rep-col-cold"/><col className="sales-rep-col-source"/></colgroup>
        <thead><tr><th rowSpan="2">User Name</th><th rowSpan="2">Total Hot Leads</th><th colSpan="2">Hot Lead</th><th rowSpan="2">Cold Lead<br/><small>Open</small></th><th rowSpan="2">Major Traffic Source<br/><small>Top 3</small></th></tr><tr><th>Open</th><th>Closed</th></tr></thead>
        <tbody>{visibleReps.map((rep) => {
          const totalHot = rep.hotOpen + rep.hotClosed;
          const previousTotalHot = rep.previousHotOpen + rep.previousHotClosed;
          return <tr key={rep.owner}>
            <td><span className="sales-rep-user"><i aria-hidden="true">{rep.owner.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()}</i><b>{rep.owner.toUpperCase()}</b></span></td>
            <td><RepMetric value={totalHot} previous={previousTotalHot} comparisonLabel={comparisonLabel} tone="total" label={`${rep.owner} Total Hot Leads`} onClick={() => onMetricClick(rep.owner, 'hot', '')} /></td>
            <td><RepMetric value={rep.hotOpen} previous={rep.previousHotOpen} comparisonLabel={comparisonLabel} tone="hot" label={`${rep.owner} Hot Open`} onClick={() => onMetricClick(rep.owner, 'hot', 'open')} /></td>
            <td><RepMetric value={rep.hotClosed} previous={rep.previousHotClosed} comparisonLabel={comparisonLabel} tone="closed" label={`${rep.owner} Hot Closed`} onClick={() => onMetricClick(rep.owner, 'hot', 'closed')} /></td>
            <td><RepMetric value={rep.coldOpen} previous={rep.previousColdOpen} comparisonLabel={comparisonLabel} tone="cold" label={`${rep.owner} Cold Open`} onClick={() => onMetricClick(rep.owner, 'cold', '')} /></td>
            <td><div className="sales-rep-sources">{rep.trafficSources.length ? rep.trafficSources.map((source, index) => <button type="button" key={source.label} onClick={() => onSourceClick(rep.owner, source)} aria-label={`View ${rep.owner} clients from ${source.label}`}><em>{index + 1}</em>{source.label}<b>{source.count}</b></button>) : <small>No source recorded in this period</small>}</div></td>
          </tr>;
        })}</tbody>
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

function SalesPriorityCard({ kind, open, closed, expectedRevenue, quotationValue = 0, poValue, previousOpen, previousClosed, previousExpectedRevenue, previousQuotationValue = 0, previousPoValue, comparisonLabel, onOpen, openQuotations, quotationCountUnavailable, onOpenQuotations }) {
  const hot = kind === 'hot';
  const Icon = hot ? Flame : Snowflake;
  const leadOpenMetric = <button type="button" onClick={() => onOpen(kind, hot ? 'open' : '')}><Target/><span><small>Lead Open</small><strong>{open.toLocaleString('en-IN')}</strong><CardPeriodComparison value={open} previous={previousOpen} comparisonLabel={comparisonLabel}/></span></button>;
  return <article className={`sales-priority-card ${kind}`}>
    <header><span className="sales-priority-icon"><Icon aria-hidden="true"/></span><div><h2>{hot ? 'Hot Leads' : 'Cold Leads'}</h2><p>{hot ? 'High priority leads with active engagement.' : 'Nurturing leads for future opportunities.'}</p></div><em>{hot ? 'High Priority' : 'Low Priority'}</em></header>
    <div className={`sales-priority-metrics ${hot ? 'is-paired' : 'is-cold'}`}>
      <section className="sales-priority-pair" aria-label={hot ? 'Hot open leads and quotations' : 'Cold open leads and expected revenue'}>
        {hot ? <div className="sales-priority-open-row">
          {leadOpenMetric}
          <button type="button" aria-haspopup="dialog" onClick={onOpenQuotations} disabled={openQuotations === null && !quotationCountUnavailable}>
            <FileText/><span><small>Open Quotations</small><strong>{openQuotations?.toLocaleString('en-IN') ?? '—'}</strong>
              {quotationCountUnavailable && <small>Click to retry</small>}
              {openQuotations === null && !quotationCountUnavailable && <span className="sr-only">Loading count</span>}
            </span><ChevronDown className="sales-priority-open-arrow" aria-hidden="true"/>
          </button>
        </div> : leadOpenMetric}
        {hot ? <div className="sales-priority-money-row">
          <button type="button" onClick={() => onOpen('hot', 'open')}><CircleDollarSign/><span><small>Expected Revenue</small><strong>{revenueMoney(expectedRevenue)}</strong><CardPeriodComparison value={expectedRevenue} previous={previousExpectedRevenue} comparisonLabel={comparisonLabel} money/></span></button>
          <button type="button" onClick={() => onOpen('hot', 'open')}><WalletCards/><span><small>Open Quotation Value</small><strong>{revenueMoney(quotationValue)}</strong><CardPeriodComparison value={quotationValue} previous={previousQuotationValue} comparisonLabel={comparisonLabel} money/></span></button>
        </div> : <button type="button" onClick={() => onOpen(kind)}><CircleDollarSign/><span><small>Expected Revenue</small><strong>{revenueMoney(expectedRevenue)}</strong><CardPeriodComparison value={expectedRevenue} previous={previousExpectedRevenue} comparisonLabel={comparisonLabel} money/></span></button>}
      </section>
      {hot && <section className="sales-priority-pair is-closed" aria-label="Hot closed leads and PO value">
        <button type="button" onClick={() => onOpen('hot', 'closed')}><span className="sales-priority-metric-icon is-closed">✓</span><span><small>Lead Closed</small><strong>{closed.toLocaleString('en-IN')}</strong><CardPeriodComparison value={closed} previous={previousClosed} comparisonLabel={comparisonLabel}/></span></button>
        <button type="button" onClick={() => onOpen('hot', 'closed')}><WalletCards/><span><small>PO Value</small><strong>{revenueMoney(poValue)}</strong><CardPeriodComparison value={poValue} previous={previousPoValue} comparisonLabel={comparisonLabel} money/></span></button>
      </section>}
    </div>
  </article>;
}

function SalesDashboardRepTable({ reps: allReps, comparisonLabel, range, previousRange, dashboardSummary, onMetricClick }) {
  const { reps, totals } = useMemo(() => salesRepTableData(allReps), [allReps]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [pdfExportError, setPdfExportError] = useState('');
  const pageCount = Math.max(1, Math.ceil(reps.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const first = (safePage - 1) * pageSize;
  const visible = reps.slice(first, first + pageSize);
  useEffect(() => { setPage(1); }, [reps, pageSize]);
  async function exportReps() {
    const XLSX = await import('xlsx');
    const exportRows = reps.map((rep) => ({
      'Sales Representative': rep.owner, 'Total Leads': rep.totalLeads, 'Hot Closed': rep.hotClosed, 'Hot Open': rep.hotOpen, 'Hot Unassigned': rep.hotUnassigned || 0, 'Cold Open': rep.coldOpen,
      'Expected Revenue (INR)': rep.expectedRevenuePaise / 100, 'PO Value (INR)': rep.poValuePaise / 100,
      ...(comparisonLabel ? { 'Comparison Period': comparisonLabel, 'Current Range': range.label, 'Previous Range': previousRange.label,
        'Previous Total Leads': rep.previousTotalLeads, 'Previous Hot Open': rep.previousHotOpen, 'Previous Hot Closed': rep.previousHotClosed, 'Previous Cold Open': rep.previousColdOpen,
        'Previous Expected Revenue (INR)': rep.previousExpectedRevenuePaise / 100, 'Previous PO Value (INR)': rep.previousPoValuePaise / 100 } : {}), 'Major Service Interest': rep.serviceInterests.map((item) => `${item.label} (${item.count})`).join(', ')
    }));
    exportRows.push({ 'Sales Representative': 'Grand Total', 'Total Leads': totals.totalLeads, 'Hot Closed': totals.hotClosed, 'Hot Open': totals.hotOpen, 'Hot Unassigned': totals.hotUnassigned, 'Cold Open': totals.coldOpen, 'Expected Revenue (INR)': totals.expectedRevenuePaise / 100, 'PO Value (INR)': totals.poValuePaise / 100 });
    const sheet = XLSX.utils.json_to_sheet(exportRows);
    sheet['!cols'] = (XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] || []).map(label => ({ wch: label === 'Major Service Interest' ? 55 : label === 'Sales Representative' ? 25 : Math.max(14, Math.min(30, String(label).length + 2)) }));
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Sales Reps'); await exportWithReason('sales-rep-performance.xlsx', () => XLSX.writeFile(book, 'sales-rep-performance.xlsx'));
  }
  async function exportPdf() {
    setPdfExporting(true);
    setPdfExportError('');
    try {
      await downloadSalesRepPerformancePdf({ reps, totals, summary: dashboardSummary, range, comparisonLabel, previousRange });
    } catch (error) {
      console.error('Unable to download Sales Rep Performance PDF.', error);
      setPdfExportError(error?.message || 'Unable to download the PDF report. Please try again.');
    } finally {
      setPdfExporting(false);
    }
  }
  return <section className="sales-dashboard-reps" aria-labelledby="sales-performance-heading">
    <header><div><span><Users/></span><div><h2 id="sales-performance-heading">Sales Rep Performance</h2><p>Lead summary, conversion and revenue by sales representative.</p><small className="sales-dashboard-sort-note">Sorting: Highest to lowest based on total Hot Leads.</small></div></div><div className="sales-dashboard-export-actions"><button type="button" onClick={exportReps} disabled={!allReps.length}><Download/>Export Excel</button><button type="button" onClick={exportPdf} disabled={!allReps.length || pdfExporting}><FileText/>{pdfExporting ? 'Preparing PDF...' : 'Download PDF'}</button></div></header>
    {pdfExportError && <p className="sales-dashboard-export-error" role="alert">{pdfExportError}</p>}
    {comparisonLabel && <div className="sales-rep-comparison" role="note"><div><small>This {comparisonLabel}</small><strong>{range.label}</strong></div><span aria-hidden="true">vs</span><div><small>Previous {comparisonLabel}</small><strong>{previousRange.label}</strong></div><p>Current values, previous values and change are shown for every sales metric.</p></div>}
    <div className="sales-dashboard-reps-table"><table><thead><tr><th>Sales Representative</th><th>Total<br/>Leads</th><th colSpan="3">Hot Leads<div className="has-unassigned"><small>Closed</small><small>Open</small><small>Unassigned <button type="button" className="sales-unassigned-count" aria-label={`${totals.hotUnassigned} unassigned hot leads`} onClick={() => onMetricClick('Unassigned', 'hot', '')}>{totals.hotUnassigned.toLocaleString('en-IN')}</button></small></div></th><th>Cold Leads<br/><small>Open</small></th><th>Expected Revenue</th><th>PO Value</th><th>Major Service Interest</th></tr></thead>
      <tbody>{visible.map((rep) => <tr key={rep.owner}><td><span className="sales-dashboard-rep"><i>{rep.owner.split(/\s+/).slice(0,2).map(part => part[0]).join('').toUpperCase()}</i><b>{rep.owner.toUpperCase()}</b></span></td><td><RepMetric value={rep.totalLeads} previous={rep.previousTotalLeads} comparisonLabel={comparisonLabel} label={`${rep.owner} total leads`} onClick={() => onMetricClick(rep.owner, '', '')}/></td><td className="is-closed"><RepMetric value={rep.hotClosed} previous={rep.previousHotClosed} comparisonLabel={comparisonLabel} label={`${rep.owner} hot closed leads`} onClick={() => onMetricClick(rep.owner, 'hot', 'closed')}/></td><td className="is-hot"><RepMetric value={rep.hotOpen} previous={rep.previousHotOpen} comparisonLabel={comparisonLabel} label={`${rep.owner} hot open leads`} onClick={() => onMetricClick(rep.owner, 'hot', 'open')}/></td><td className="is-unassigned"><RepMetric value={rep.hotUnassigned || 0} previous={rep.previousHotUnassigned || 0} comparisonLabel={comparisonLabel} label={`${rep.owner} released unassigned hot leads`} onClick={() => onMetricClick(rep.owner, 'hot', 'unassigned')}/></td><td className="is-cold"><RepMetric value={rep.coldOpen} previous={rep.previousColdOpen} comparisonLabel={comparisonLabel} label={`${rep.owner} cold leads`} onClick={() => onMetricClick(rep.owner, 'cold', '')}/></td><td><strong>{revenueMoney(rep.expectedRevenuePaise)}</strong><CardPeriodComparison value={rep.expectedRevenuePaise} previous={rep.previousExpectedRevenuePaise} comparisonLabel={comparisonLabel} money/></td><td><strong>{revenueMoney(rep.poValuePaise)}</strong><CardPeriodComparison value={rep.poValuePaise} previous={rep.previousPoValuePaise} comparisonLabel={comparisonLabel} money/></td><td>{rep.serviceInterests.length ? <ul className="sales-service-tags">{rep.serviceInterests.map(item => <li key={item.label}><span>{item.label}</span><b>{item.count.toLocaleString('en-IN')}</b></li>)}</ul> : <span className="sales-service-empty">Not recorded</span>}</td></tr>)}</tbody>
      {!!allReps.length && <tfoot><tr><th scope="row">Grand Total <small>All {reps.length} representatives + unassigned</small></th><td>{totals.totalLeads.toLocaleString('en-IN')}</td><td className="is-closed">{totals.hotClosed.toLocaleString('en-IN')}</td><td className="is-hot">{totals.hotOpen.toLocaleString('en-IN')}</td><td className="is-unassigned"><RepMetric value={totals.hotUnassigned} previous={totals.previousHotUnassigned} comparisonLabel={comparisonLabel} label="Unassigned hot leads" onClick={() => onMetricClick('Unassigned', 'hot', '')}/></td><td className="is-cold">{totals.coldOpen.toLocaleString('en-IN')}</td><td>{revenueMoney(totals.expectedRevenuePaise)}</td><td>{revenueMoney(totals.poValuePaise)}</td><td><span className="sales-dashboard-total-note">Stable total across all pages</span></td></tr></tfoot>}
      </table>{!reps.length && <p className="pipeline-empty">No sales representatives match these filters.</p>}</div>
    {!!reps.length && <footer><span>Showing {first + 1}–{Math.min(first + pageSize, reps.length)} of {reps.length} records</span><label>Rows per page<select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}><option value="5">5</option><option value="10">10</option><option value="25">25</option></select></label><div><button onClick={() => setPage(value => Math.max(1, value - 1))} disabled={safePage === 1}>‹</button><b>{safePage}</b><button onClick={() => setPage(value => Math.min(pageCount, value + 1))} disabled={safePage === pageCount}>›</button></div></footer>}
  </section>;
}

function SalesTrafficStrip({ sources, previousSources = [], comparisonLabel = '', onSelect }) {
  const [expandedKey, setExpandedKey] = useState('');
  const visible = sources.filter((source) => source.count > 0).slice(0, 4);
  const total = sources.reduce((sum, source) => sum + source.count, 0);
  const expanded = visible.find((source) => source.key === expandedKey);
  const children = (expanded?.children || []).filter((child) => child.count > 0).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  function selectParent(source) {
    const availableChildren = (source.children || []).filter((child) => child.count > 0);
    if (!availableChildren.length) { onSelect(source); return; }
    setExpandedKey((current) => current === source.key ? '' : source.key);
  }
  return <section className={`sales-traffic-strip ${expanded ? 'is-expanded' : ''}`} aria-labelledby="sales-traffic-heading">
    <header><span><LayoutGrid/></span><div><h2 id="sales-traffic-heading">Traffic Source</h2><p>Click a source to view sub-categories</p></div></header>
    {visible.map((source, index) => { const percent = total ? Math.round(source.count / total * 100) : 0; const isExpanded = source.key === expandedKey; const previous = previousSources.find((item) => item.key === source.key)?.count || 0; return <button type="button" key={source.key || source.label} onClick={() => selectParent(source)} aria-expanded={isExpanded} style={{ '--source-color':['#ff762e','#2387ed','#31b75f','#8756e8'][index] }}><span>{index + 1}</span><div><strong>{source.label}</strong><small>{source.count.toLocaleString('en-IN')} ({percent}%){comparisonLabel ? ` · Prev ${previous.toLocaleString('en-IN')}` : ''}</small><i><em style={{ width:`${percent}%` }}/></i></div><b aria-hidden="true">{isExpanded ? '−' : '+'}</b></button>; })}
    {expanded && <div className="sales-traffic-children" role="region" aria-label={`${expanded.label} sub-categories`}><div><strong>{expanded.label}</strong><small>{comparisonLabel ? `This ${comparisonLabel} vs previous` : 'Sub-categories'}</small></div>{children.map((child) => { const previousParent = previousSources.find((item) => item.key === expanded.key); const previous = previousParent?.children?.find((item) => item.key === child.key)?.count || 0; return <button type="button" key={child.key} onClick={() => onSelect(child)}><span>{child.label}</span><b>{child.count.toLocaleString('en-IN')}</b><small>{comparisonLabel ? `Prev ${previous.toLocaleString('en-IN')}` : `${child.percentage.toFixed(1)}%`}</small><ArrowUpRight/></button>; })}</div>}
  </section>;
}

export default function LeadPipeline() {
  const location = useLocation();
  const summaryView = location.pathname.startsWith('/summary-dashboard');
  const salesDashboardView = location.pathname === '/sales-dashboard';
  const salesDesignView = summaryView || salesDashboardView;
  const [currentUser] = useState(storedUser);
  const snapshotKey = summaryView || salesDashboardView ? 'summary-pipeline' : 'revenue-pipeline';
  const [rows, setRows] = useState(() => readPageSnapshot(snapshotKey)?.rows || []);
  const [quotationRows, setQuotationRows] = useState(null);
  const [quotationCountUnavailable, setQuotationCountUnavailable] = useState(false);
  const [quotationDialogOpen, setQuotationDialogOpen] = useState(false);
  const [sourceModes, setSourceModes] = useState([]);
  const [sourceOptionsUnavailable, setSourceOptionsUnavailable] = useState(false);
  const [loading, setLoading] = useState(() => !readPageSnapshot(snapshotKey));
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [owner, setOwner] = useState('');
  const [period, setPeriod] = useState('all');
  const [periodDate, setPeriodDate] = useState(() => `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const range = useMemo(() => {
    if (period !== 'custom') return pipelinePeriodRange(period, periodDate);
    const start = new Date(`${customFrom}T00:00:00`); const end = new Date(`${customTo}T00:00:00`); end.setDate(end.getDate() + 1);
    if (!customFrom || !customTo || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return { label:'Choose a valid custom range', invalid:true };
    const format = (date) => date.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
    const last = new Date(end); last.setDate(last.getDate() - 1);
    return { start:start.getTime(), end:end.getTime(), label:`${format(start)} – ${format(last)}` };
  }, [period, periodDate, customFrom, customTo]);
  const previousRange = useMemo(() => period === 'custom' ? null : previousPipelinePeriodRange(period, periodDate), [period, periodDate]);
  const [selection, setSelection] = useState(null);
  const [dialogSearch, setDialogSearch] = useState('');
  const deferredDialogSearch = useDeferredValue(dialogSearch);
  const [dialogPage, setDialogPage] = useState(1);
  const [expandedLeadQuotes, setExpandedLeadQuotes] = useState('');
  const [revenueRow, setRevenueRow] = useState(null);
  const [closeRow, setCloseRow] = useState(null);
  const [serviceView, setServiceView] = useState(null);
  const serviceRequest = useRef(0);
  const [remarks, setRemarks] = useState('');
  const [closing, setClosing] = useState(false);
  const [modalError, setModalError] = useState('');
  const dialog = useRef(null);
  const dialogBody = useRef(null);
  const dialogAction = useRef(null);
  const sequence = useRef(0);
  async function load() {
    const version = ++sequence.current;
    if (salesDesignView) {
      setQuotationCountUnavailable(false);
      api.get(API_ENDPOINTS.quotations.list, { params: { view: 'directory', includeServiceStatus: true } })
        .then(({ data }) => {
          if (version !== sequence.current) return;
          if (!Array.isArray(data?.quotations)) throw new Error('Quotation list unavailable');
          setQuotationRows(data.quotations);
        })
        .catch(() => {
          if (version !== sequence.current) return;
          setQuotationRows(null);
          setQuotationCountUnavailable(true);
        });
    }
    try {
      const result = await api.get(summaryView || salesDashboardView ? '/leads/summary-dashboard' : '/leads/pipeline-revenue?view=sales-rep-v6');
      if (version !== sequence.current) return;
      savePageSnapshot(snapshotKey, result.data, result);
      setRows(result.data.rows || []); setError('');
    } catch (e) { if (version === sequence.current) setError(e.response?.data?.error || 'Unable to load pipeline.'); }
    finally { if (version === sequence.current) setLoading(false); }
  }
  useEffect(() => { void load(); return () => { sequence.current++; }; }, []);
  useEffect(() => {
    let active = true;
    api.get('/leads/dropdown-options').then((response) => {
      if (active) setSourceModes(response.data?.options?.communicationMode || []);
    }).catch(() => { if (active) setSourceOptionsUnavailable(true); });
    return () => { active = false; };
  }, []);
  useCrmRefresh(load, true, loading);
  useEffect(() => {
    if (selection && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!selection && dialog.current?.open) dialog.current.close();
  }, [selection]);
  const dashboardRows = useMemo(() => summaryView ? rows.filter((row) => !isExistingClientTrafficSource(row) || (row.kind === 'hot' && row.state === 'closed')) : rows, [rows, summaryView]);
  const baseFiltered = useMemo(() => dashboardRows.filter(r => (!owner || salesRepOwner(r) === owner) && `${r.company} ${r.code} ${r.owner}`.toLowerCase().includes(deferredQuery.trim().toLowerCase())), [dashboardRows, deferredQuery, owner]);
  const openQuotations = useMemo(() => {
    if (quotationRows === null) return null;
    const term = deferredQuery.trim().toLowerCase();
    const useLeadFilters = Boolean(owner || period !== 'all');
    if (loading && (useLeadFilters || term)) return null;
    const leadIds = useLeadFilters || term ? quotationLeadIdsInPeriod(rows.filter(row =>
      (!owner || salesRepOwner(row) === owner) && `${row.company} ${row.code} ${row.owner}`.toLowerCase().includes(term)
    ), range) : null;
    return quotationRows.flatMap(row => {
      if (leadIds && !quotationMatchesLeadIds(row, leadIds)) {
        const quoteText = [row.companyName, row.leadDetails?.companyName, row.leadCode, row.businessLeadCode].join(' ').toLowerCase();
        if (useLeadFilters || !quoteText.includes(term)) return [];
      }
      const serviceSummary = filterQuotationServices(row, 'open');
      return serviceSummary ? [{ ...row, serviceSummary }] : [];
    });
  }, [deferredQuery, loading, owner, period, quotationRows, range, rows]);
  function openQuotationList() {
    if (openQuotations === null) {
      if (quotationCountUnavailable) void load();
      return;
    }
    setQuotationDialogOpen(true);
  }
  const filterPeriod = summaryView || salesDashboardView ? summaryPipelineRows
    : (source, periodRange) => currentPipelineRows(source.filter(row => inPipelinePeriod(row.createdAt, periodRange)));
  const filtered = useMemo(() => filterPeriod(baseFiltered, range), [baseFiltered, range, summaryView, salesDashboardView]);
  const previousFiltered = useMemo(() => previousRange ? filterPeriod(baseFiltered, previousRange) : [], [baseFiltered, previousRange, summaryView, salesDashboardView]);
  const unique = useMemo(() => uniquePipelineRows(filtered), [filtered]);
  const trafficSources = useMemo(() => trafficSourceHierarchy(filtered, sourceModes), [filtered, sourceModes]);
  const previousTrafficSources = useMemo(() => trafficSourceHierarchy(previousFiltered, sourceModes), [previousFiltered, sourceModes]);
  const listed = useMemo(() => selection ? (selection.kind ? filtered : unique).filter(r => (!selection.kind || r.kind === selection.kind) && (!selection.state || (selection.state === 'unassigned' ? isUnassignedOwner(r.owner) : r.state === selection.state && (!selection.owner || !isUnassignedOwner(r.owner)))) && (!selection.owner || (selection.owner === 'Unassigned' ? isUnassignedOwner(r.owner) : salesRepOwner(r) === selection.owner)) && (!selection.sources?.length || selection.sources.includes(trafficSourceKey(r.communicationMode)))) : [], [filtered, selection, unique]);
  const dialogListed = useMemo(() => {
    const q = deferredDialogSearch.trim().toLowerCase();
    if (!q) return listed;
    return listed.filter(r => `${r.company} ${r.code} ${r.owner} ${r.communicationMode || ''}`.toLowerCase().includes(q));
  }, [listed, deferredDialogSearch]);
  const dialogPageCount = Math.max(1, Math.ceil(dialogListed.length / LEAD_DETAILS_PAGE_SIZE));
  const dialogSafePage = Math.min(dialogPage, dialogPageCount);
  const dialogFirst = (dialogSafePage - 1) * LEAD_DETAILS_PAGE_SIZE;
  const dialogVisible = dialogListed.slice(dialogFirst, dialogFirst + LEAD_DETAILS_PAGE_SIZE);
  const showInactivity = dialogListed.some(row => isUnassignedOwner(row.owner) && row.inactiveDays != null);
  const leadColumns = showInactivity ? 8 : 7;
  useEffect(() => { setDialogPage(1); setDialogSearch(''); setExpandedLeadQuotes(''); }, [selection]);
  useEffect(() => {
    if (revenueRow || closeRow) dialogAction.current?.scrollIntoView({ block: 'nearest' });
  }, [revenueRow, closeRow]);
  function changeDialogPage(page) {
    setDialogPage(page);
    setExpandedLeadQuotes('');
    if (dialogBody.current) dialogBody.current.scrollTop = 0;
  }
  const total = source => source.reduce((n, r) => n + r.revenuePaise, 0);
  const poTotal = source => source.reduce((n, r) => n + (r.poAmountPaise || 0), 0);
  const quotationTotal = source => source.reduce((n, r) => n + (r.quotationAmountPaise || 0), 0);
  const { hotRows, coldRows, hotOpen, hotClosed, previousHotRows, previousColdRows, previousHotOpen, previousHotClosed } = useMemo(() => {
    const nextHotRows = filtered.filter((row) => row.kind === 'hot');
    const nextColdRows = filtered.filter((row) => row.kind === 'cold');
    const priorHotRows = previousFiltered.filter((row) => row.kind === 'hot');
    const priorColdRows = previousFiltered.filter((row) => row.kind === 'cold');
    return {
      hotRows: nextHotRows,
      coldRows: nextColdRows,
      hotOpen: nextHotRows.filter((row) => row.state === 'open'),
      hotClosed: nextHotRows.filter((row) => row.state === 'closed'),
      previousHotRows: priorHotRows,
      previousColdRows: priorColdRows,
      previousHotOpen: priorHotRows.filter((row) => row.state === 'open'),
      previousHotClosed: priorHotRows.filter((row) => row.state === 'closed')
    };
  }, [filtered, previousFiltered]);
  const activeOwnerRows = useMemo(() => (source) => source.filter((row) => {
    if (row.owner === 'Unassigned') return true;
    return row.ownerActive !== false;
  }), []);
  const ownerOptions = useMemo(() => [...new Set(activeOwnerRows(dashboardRows).map((row) => salesRepOwner(row)).filter((name) => name && name !== 'Unassigned'))].sort(), [activeOwnerRows, dashboardRows]);
  useEffect(() => { if (owner && !ownerOptions.includes(owner)) setOwner(''); }, [owner, ownerOptions]);
  const salesReps = useMemo(() => salesRepSummary(activeOwnerRows(filtered), activeOwnerRows(previousFiltered), sourceModes), [activeOwnerRows, filtered, previousFiltered, sourceModes]);
  const comparisonLabel = period === 'week' ? 'week' : period === 'month' ? 'month' : period === 'quarter' ? 'quarter' : '';
  const trendData = useMemo(() => pipelineTrend(filtered, period, periodDate, range), [filtered, period, periodDate, range]);
  const previousTrendData = useMemo(() => {
    if (!comparisonLabel || !previousRange) return [];
    const date = new Date(previousRange.start);
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return pipelineTrend(previousFiltered, period, value, previousRange);
  }, [comparisonLabel, period, previousFiltered, previousRange]);
  const statusItems = useMemo(() => [
    { label: 'Hot Open', value: hotOpen.length, color: '#ff762e' },
    { label: 'Hot Closed', value: hotClosed.length, color: '#16a66f' },
    { label: 'Cold Open', value: coldRows.length, color: '#3284f6' }
  ], [hotOpen.length, hotClosed.length, coldRows.length]);
  const previousStatusItems = useMemo(() => [
    { label: 'Hot Open', value: previousHotOpen.length },
    { label: 'Hot Closed', value: previousHotClosed.length },
    { label: 'Cold Open', value: previousColdRows.length }
  ], [previousHotOpen.length, previousHotClosed.length, previousColdRows.length]);
  const dashboardPdfSummary = useMemo(() => ({
    hotOpen: hotOpen.length,
    hotClosed: hotClosed.length,
    hotExpectedRevenuePaise: total(hotOpen),
    hotQuotationValuePaise: quotationTotal(hotOpen),
    hotPoValuePaise: poTotal(hotClosed),
    coldOpen: coldRows.length,
    coldExpectedRevenuePaise: total(coldRows)
  }), [hotOpen, hotClosed, coldRows]);
  const salesDashboardReps = useMemo(() => salesReps.map((rep) => {
    const ownerRows = activeOwnerRows(filtered).filter((row) => salesRepOwner(row) === rep.owner);
    const previousOwnerRows = activeOwnerRows(previousFiltered).filter((row) => salesRepOwner(row) === rep.owner);
    const interests = new Map();
    ownerRows.forEach((row) => (row.serviceInterests || []).forEach((label) => interests.set(label, (interests.get(label) || 0) + 1)));
    return { ...rep, totalLeads: ownerRows.length, previousTotalLeads:previousOwnerRows.length, expectedRevenuePaise: total(ownerRows), previousExpectedRevenuePaise:total(previousOwnerRows), poValuePaise: poTotal(ownerRows), previousPoValuePaise:poTotal(previousOwnerRows), serviceInterests:[...interests.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 2) };
  }), [activeOwnerRows, filtered, previousFiltered, salesReps]);
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
  async function exportRows(source, name) {
    const XLSX = await import('xlsx');
    const data = source.map(r => ({
      'Lead ID': r.code, Company: r.company, 'Client Communication Mode': r.communicationMode || 'Other / Not specified', Status: r.converted ? 'Closed — Converted to Hot' : r.state, Owner: r.owner,
      'Latest Quotation (INR)': (r.latestQuotationAmountPaise ?? r.quotationAmountPaise ?? 0) / 100, 'PO Amount (INR)': (r.poAmountPaise || 0) / 100, 'Estimated Revenue (INR)': r.revenuePaise / 100
    }));
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(data);
    sheet['!cols'] = [{ wch: 20 }, { wch: 45 }, { wch: 28 }, { wch: 28 }, { wch: 25 }, { wch: 28 }, { wch: 24 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(book, sheet, 'Lead Pipeline');
    await exportWithReason(`${name}.xlsx`, () => XLSX.writeFile(book, `${name}.xlsx`));
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
  return <DashboardShell currentUser={currentUser}><div className={`pipeline-page ${summaryView ? 'is-summary' : ''} ${salesDesignView ? 'is-sales-dashboard' : ''}`}>
    {summaryView && <DashboardViewTabs />}
    <header className="pipeline-header summary-dashboard-heading"><div className="pipeline-heading">{(summaryView || salesDashboardView) && <span className="summary-heading-icon"><LayoutGrid/></span>}<div><h1>{salesDashboardView ? 'Sales Dashboard' : summaryView ? 'Summary Dashboard' : 'Revenue Pipeline'}</h1><p>{salesDashboardView ? 'Real-time overview of leads, revenue, team performance and pipeline.' : summaryView ? 'Overview of leads, revenue, team performance and pipeline in real time.' : 'A clear view of your hot and cold pipeline, with locked revenue history.'}</p></div></div><div className="pipeline-filters"><label><Search size={17}/><input aria-label="Search pipeline" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search company, lead ID or owner…"/></label><select aria-label="Filter by owner" value={owner} onChange={e => setOwner(e.target.value)}><option value="">All active owners</option>{ownerOptions.map(name => <option key={name} value={name}>{name.toUpperCase()}</option>)}</select></div></header>
    <section className="pipeline-period-bar" aria-label="Pipeline date filters">
      <div className="pipeline-period-tabs" role="group" aria-label="Filter period">{(salesDesignView ? [['all', 'All Data'], ['week', 'This Week'], ['month', 'This Month'], ['quarter', 'This Quarter'], ['year', 'This Year'], ['custom', 'Custom Range']] : [['all', 'All time'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']]).map(([value, label]) => <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)}>{value === 'custom' && <CalendarDays/>}{label}</button>)}</div>
      <div className="pipeline-period-context">{period === 'custom' ? <label className="sales-custom-range"><input aria-label="Custom range start" type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)}/><span>to</span><input aria-label="Custom range end" type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)}/></label> : period !== 'all' && !salesDesignView ? <label>Choose {period}{period === 'year' ? <select aria-label="Choose year" value={periodDate.slice(0, 4)} onChange={e => setPeriodDate(`${e.target.value}-01-01`)}>{[...new Set([new Date().getFullYear(), Number(periodDate.slice(0, 4)), ...rows.map(row => new Date(row.createdAt).getFullYear()).filter(Number.isFinite)])].sort((a, b) => b - a).map(year => <option key={year} value={year}>{year}</option>)}</select> : <input aria-label={`Choose ${period}`} type={period === 'month' ? 'month' : 'date'} value={period === 'month' ? periodDate.slice(0, 7) : periodDate} onChange={e => { if (e.target.value) setPeriodDate(period === 'month' ? `${e.target.value}-01` : e.target.value); }}/>}</label> : null}<span>{range.label} · {summaryView || salesDashboardView ? 'Open leads by creation date · Closed leads and approved POs by approval or closure date' : 'Lead creation date'}</span></div>
      {salesDesignView && <button className="pipeline-refresh" type="button" onClick={load} disabled={loading}><RefreshCw size={15}/>Refresh</button>}
      <button className="pipeline-export" type="button" disabled={loading || !unique.length} onClick={() => exportRows(unique, `pipeline-${period}`)}><Download size={16}/>Export</button>
    </section>
    {error && <p role="alert" className="pipeline-error">{error}</p>}
    {loading ? <PipelineSkeleton /> : <>
      {summaryView && !salesDesignView && <>{!unique.length && <p role="status" className="pipeline-filter-empty">No leads match these filters. Try another period or owner.</p>}
      <section className="summary-kpi-grid" aria-label="Sales summary">
        <SummaryKpi label="Hot Leads" value={hotOpen.length} previous={previousHotOpen.length} comparisonLabel={comparisonLabel} icon={Flame} tone="hot" trend={trendData.map(item => item.hot)} onClick={() => open('hot', 'open')}/>
        <SummaryKpi label="Cold Leads" value={coldRows.length} previous={previousColdRows.length} comparisonLabel={comparisonLabel} icon={Snowflake} tone="cold" trend={trendData.map(item => item.cold)} onClick={() => open('cold')}/>
        <SummaryKpi label="Total Expected Revenue" value={total(unique)} previous={total(previousFiltered)} comparisonLabel={comparisonLabel} icon={CircleDollarSign} tone="revenue" trend={trendData.map(item => item.revenue)} money onClick={() => open()}/>
        <SummaryKpi label="PO Value" value={poTotal(hotClosed)} previous={poTotal(previousHotClosed)} comparisonLabel={comparisonLabel} icon={WalletCards} tone="po" trend={trendData.map(item => item.revenue)} money onClick={() => open('hot', 'closed')}/>
      </section>
      <section className="summary-analytics-grid">
        <TrafficSources sources={trafficSources} onSelect={openSource} optionsUnavailable={sourceOptionsUnavailable}/>
      </section>
      <SalesDashboardRepTable reps={salesDashboardReps} comparisonLabel={comparisonLabel} range={range} previousRange={previousRange} dashboardSummary={dashboardPdfSummary} onMetricClick={(selectedOwner, kind, state) => open(kind, state, selectedOwner)}/></>}
      {salesDesignView && <>
        {comparisonLabel ? <section className="sales-period-comparison" aria-label="Dashboard period comparison"><span>{comparisonLabel[0].toUpperCase() + comparisonLabel.slice(1)} comparison</span><strong>{range.label}</strong><small>vs</small><strong>{previousRange.label}</strong></section> : <p className="sales-comparison-hint">Select This Week or This Month above to compare the complete dashboard with the previous period.</p>}
        {!unique.length && <p role="status" className="pipeline-filter-empty">No leads match these filters. Try another period or owner.</p>}
        {comparisonLabel && previousRange && <div className="sales-period-comparison" role="note"><div><small>Selected {comparisonLabel}</small><strong>{range.label}</strong></div><span>compared with</span><div><small>Previous {comparisonLabel}</small><strong>{previousRange.label}</strong></div></div>}
        <section className="sales-priority-grid" aria-label="Sales pipeline priorities">
          <SalesPriorityCard kind="hot" open={hotOpen.length} closed={hotClosed.length} expectedRevenue={total(hotOpen)} quotationValue={quotationTotal(hotOpen)} poValue={poTotal(hotClosed)} previousOpen={previousHotOpen.length} previousClosed={previousHotClosed.length} previousExpectedRevenue={total(previousHotOpen)} previousQuotationValue={quotationTotal(previousHotOpen)} previousPoValue={poTotal(previousHotClosed)} comparisonLabel={comparisonLabel} onOpen={open} openQuotations={openQuotations?.length ?? null} quotationCountUnavailable={quotationCountUnavailable} onOpenQuotations={openQuotationList}/>
          <SalesPriorityCard kind="cold" open={coldRows.length} closed={0} expectedRevenue={total(coldRows)} poValue={0} previousOpen={previousColdRows.length} previousClosed={0} previousExpectedRevenue={total(previousColdRows)} previousPoValue={0} comparisonLabel={comparisonLabel} onOpen={open}/>
        </section>
        <section className="sales-dashboard-main">
          <SalesDashboardRepTable reps={salesDashboardReps} comparisonLabel={comparisonLabel} range={range} previousRange={previousRange} dashboardSummary={dashboardPdfSummary} onMetricClick={(selectedOwner, kind, state) => open(kind, state, selectedOwner)}/>
        </section>
        <SalesTrafficStrip sources={trafficSources} previousSources={previousTrafficSources} comparisonLabel={comparisonLabel} onSelect={openSource}/>
      </>}
      {!summaryView && !salesDashboardView && <div className="pipeline-content-layout"><section className="pipeline-sales-workspace" aria-label="Sales pipeline">
        {!unique.length && <p role="status" className="pipeline-filter-empty">No leads match these filters. Try another period or owner.</p>}
        <div className="pipeline-kind-grid">
          <article className="pipeline-kind-card hot"><header><span><Flame/></span><button type="button" onClick={() => open('hot')}>Hot Leads<ArrowUpRight/></button>{comparisonLabel && <small className="pipeline-card-period">{comparisonLabel} comparison</small>}</header><div className="pipeline-kind-counts"><button type="button" onClick={() => open('hot', 'open')}><small>Open</small><strong>{hotOpen.length.toLocaleString('en-IN')}</strong><CardPeriodComparison value={hotOpen.length} previous={previousHotOpen.length} comparisonLabel={comparisonLabel}/></button><button type="button" onClick={() => open('hot', 'closed')}><small>Closed</small><strong>{hotClosed.length.toLocaleString('en-IN')}</strong><CardPeriodComparison value={hotClosed.length} previous={previousHotClosed.length} comparisonLabel={comparisonLabel}/></button></div><div className="pipeline-kind-money"><button type="button" onClick={() => open('hot')}><small>Estimated Revenue</small><strong>{revenueMoney(total(hotRows))}</strong></button><button type="button" onClick={() => open('hot', 'closed')}><small>PO Value</small><strong>{revenueMoney(poTotal(hotClosed))}</strong></button></div></article>
          <article className="pipeline-kind-card cold"><header><span><Snowflake/></span><button type="button" onClick={() => open('cold')}>Cold Leads<ArrowUpRight/></button>{comparisonLabel && <small className="pipeline-card-period">{comparisonLabel} comparison</small>}</header><div className="pipeline-kind-counts pipeline-kind-counts-single"><button type="button" onClick={() => open('cold')}><small>Open</small><strong>{coldRows.length.toLocaleString('en-IN')}</strong><CardPeriodComparison value={coldRows.length} previous={previousColdRows.length} comparisonLabel={comparisonLabel}/></button></div><div className="pipeline-kind-money"><button type="button" onClick={() => open('cold')}><small>Estimated Revenue</small><strong>{revenueMoney(total(coldRows))}</strong></button></div></article>
        </div>
        <p className="pipeline-note">Converted leads appear only in the Hot pipeline. Hot plus Cold therefore matches the unique Traffic Source total. PO value and estimated revenue are shown separately.</p>
      </section><TrafficSources sources={trafficSources} onSelect={openSource} optionsUnavailable={sourceOptionsUnavailable}/></div>}
      {!salesDesignView && <SalesRepTable reps={salesReps} comparisonLabel={comparisonLabel} range={range} previousRange={previousRange} onMetricClick={(selectedOwner, kind, state) => open(kind, state, selectedOwner)} onSourceClick={openOwnerSource}/>}
    </>}
    {quotationDialogOpen && <OpenQuotationsDialog quotations={openQuotations || []} onClose={() => setQuotationDialogOpen(false)}/>}
    <dialog ref={dialog} className="pipeline-dialog pipeline-lead-details" aria-labelledby="pipeline-lead-details-title" onClose={() => setSelection(null)}>
      {selection && <>
        <header>
          <div>
            <h2 id="pipeline-lead-details-title">
              {selection.owner && `${selection.owner.toUpperCase()} · `}
              {selection.sourceLabel ? `Traffic Source · ${selection.sourceLabel}` : selection.kind ? `${selection.kind === 'hot' ? 'Hot' : 'Cold'} Leads` : 'All Leads'}
              {selection.state && ` · ${selection.state === 'open' ? 'Open' : selection.state === 'unassigned' ? 'Unassigned' : 'Closed'}`}
            </h2>
            <dl className="pipeline-details-totals">
              <div><dt>Clients</dt><dd>{listed.length.toLocaleString('en-IN')}</dd></div>
              <div><dt>Estimated revenue</dt><dd>{revenueMoney(total(listed))}</dd></div>
              {selection.kind === 'hot' && selection.state === 'open' && <div><dt>Latest quotation value</dt><dd>{revenueMoney(quotationTotal(listed))}</dd></div>}
              {selection.kind === 'hot' && selection.state === 'closed' && <div><dt>PO value</dt><dd>{revenueMoney(poTotal(listed))}</dd></div>}
            </dl>
          </div>
          <div className="pipeline-details-tools">
            <button type="button" onClick={() => exportRows(listed, 'pipeline-details')} disabled={!listed.length}><Download size={16}/>Excel</button>
            <button type="button" onClick={() => dialog.current.close()} aria-label="Close lead list"><X size={19}/></button>
          </div>
        </header>
        <div className="pipeline-dialog-search">
          <label>
            <Search size={16} aria-hidden="true"/>
            <input aria-label="Search leads in this dialog" value={dialogSearch} onChange={event => { setDialogSearch(event.target.value); changeDialogPage(1); }} placeholder="Search company, lead ID, owner or source…"/>
          </label>
        </div>
        <div ref={dialogBody} className="pipeline-dialog-body">
          {dialogListed.length > 0 ? (
            <div className="pipeline-table-wrap">
              <table className="pipeline-leads-table" role="table">
                <thead role="rowgroup">
                  <tr role="row">
                    <th scope="col">Lead / Company</th>
                    <th scope="col">Status</th>
                    <th scope="col">Lead owner</th>
                    {showInactivity && <th scope="col">Inactivity</th>}
                    <th scope="col">Latest quotation</th>
                    <th scope="col">PO amount</th>
                    <th scope="col">Est. revenue</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {dialogVisible.map(row => {
                    const key = `${row.kind}-${row.id}`;
                    const quoteId = `pipeline-quotes-${key}`;
                    const expanded = expandedLeadQuotes === key;
                    const inactive = isUnassignedOwner(row.owner) && row.inactiveDays != null;
                    const latestQuote = row.latestQuotationAmountPaise ?? row.quotationAmountPaise;
                    return (
                      <React.Fragment key={key}>
                        <tr role="row" className="pipeline-details-lead-row" data-expanded={expanded}>
                          <td role="cell"><button type="button" className="pipeline-company-button" onClick={() => showServices(row)}><b>{row.company}</b><ArrowUpRight size={14} aria-hidden="true"/></button><small>{row.code}</small></td>
                          <td role="cell" data-label="Status"><span className={`pipeline-badge ${row.state}`}>{row.state}</span>{row.converted && <small>Converted to Hot Lead</small>}</td>
                          <td role="cell" data-label="Lead owner"><span className="pipeline-owner"><Users size={14} aria-hidden="true"/>{row.owner.toUpperCase()}</span>{row.previousOwner && <small>Previous: {row.previousOwner.toUpperCase()}</small>}</td>
                          {showInactivity && <td role="cell" data-label="Inactivity">{inactive ? <span className="pipeline-inactive">{row.inactiveDays} day{row.inactiveDays === 1 ? '' : 's'}</span> : '—'}</td>}
                          <td role="cell" data-label="Latest quotation" className="pipeline-details-money">{row.kind === 'hot' && latestQuote > 0 ? revenueMoney(latestQuote) : '—'}</td>
                          <td role="cell" data-label="PO amount" className="pipeline-details-money">{row.kind === 'hot' ? revenueMoney(row.poAmountPaise) : '—'}</td>
                          <td role="cell" data-label="Est. revenue" className="pipeline-details-money">{revenueMoney(row.revenuePaise)}</td>
                          <td role="cell">
                            <div className="pipeline-details-actions">
                              <button type="button" className="pipeline-details-quote-toggle" aria-expanded={expanded} aria-controls={expanded ? quoteId : undefined}
                                onClick={() => setExpandedLeadQuotes(current => current === key ? '' : key)}>
                                <FileText size={14} aria-hidden="true"/>{expanded ? 'Hide Quotations' : 'View Quotations'}<ChevronDown size={13} aria-hidden="true"/>
                              </button>
                              <button type="button" onClick={() => { setRevenueRow(row); setCloseRow(null); }}>Revenue history</button>
                              {row.kind === 'cold' && row.state === 'open' && <button type="button" onClick={() => { setCloseRow(row); setRevenueRow(null); setRemarks(''); setModalError(''); }}>Close cold lead</button>}
                            </div>
                          </td>
                        </tr>
                        {expanded && (
                          <tr role="row" className="pipeline-details-expanded"><td role="cell" colSpan={leadColumns}>
                            <PipelineLeadQuotations leadId={row.id} company={row.company} id={quoteId}/>
                          </td></tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="pipeline-empty" role="status">No leads match this search.</p>}

          {revenueRow && <section ref={dialogAction} className="mt-4"><h3 className="font-black">{revenueRow.company} · Revenue</h3><LeadRevenuePanel key={`${revenueRow.kind}-${revenueRow.id}`} kind={revenueRow.kind} leadId={revenueRow.id} onSaved={load}/></section>}
          {closeRow && <section ref={dialogAction} className="mt-5 rounded-2xl border bg-slate-50 p-5"><h3 className="font-black">Close cold lead: {closeRow.company}</h3><p className="mt-2 text-sm text-slate-500">This moves the lead to Closed Cold Leads and locks its estimate. It does not convert it to a Hot Lead.</p><label className="mt-3 block text-sm font-bold">Closing remarks<textarea value={remarks} onChange={e => setRemarks(e.target.value)} maxLength={1000} className="mt-2 block w-full rounded-xl border bg-white p-3"/></label><button type="button" disabled={closing || !remarks.trim()} onClick={closeCold} className="mt-3 rounded-xl bg-emerald-800 px-4 py-3 font-bold text-white disabled:opacity-40">{closing ? 'Closing…' : 'Confirm close'}</button><button type="button" onClick={() => setCloseRow(null)} className="ml-3">Cancel</button></section>}
          {modalError && <p role="alert" className="pipeline-error">{modalError}</p>}
        </div>
        {dialogListed.length > 0 && (
          <footer className="pipeline-dialog-pagination">
            <span><b>{dialogFirst + 1}–{Math.min(dialogFirst + LEAD_DETAILS_PAGE_SIZE, dialogListed.length)}</b> of <b>{dialogListed.length}</b> leads</span>
            {dialogPageCount > 1 && <nav aria-label="Lead list pages">
              <button type="button" onClick={() => changeDialogPage(dialogSafePage - 1)} disabled={dialogSafePage === 1}>Previous</button>
              <span>Page {dialogSafePage} of {dialogPageCount}</span>
              <button type="button" onClick={() => changeDialogPage(dialogSafePage + 1)} disabled={dialogSafePage === dialogPageCount}>Next</button>
            </nav>}
          </footer>
        )}
      </>}
    </dialog>
    {serviceView && <PipelineClientDetails key={`${serviceView.row.kind}-${serviceView.row.id}`} view={serviceView}
      onClose={closeServices} onRetry={() => showServices(serviceView.row)}/>}
  </div></DashboardShell>;
}
