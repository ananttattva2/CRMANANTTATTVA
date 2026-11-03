import TrafficSources from '../components/leads/TrafficSources';
import { isExistingClientTrafficSource, trafficSourceHierarchy, trafficSourceKey } from '../utils/trafficSources.mjs';
import { currentPipelineRows, uniquePipelineRows, pipelinePeriodRange, previousPipelinePeriodRange, inPipelinePeriod } from '../utils/leadPipeline.mjs';
import { salesRepSummary } from '../utils/salesRepSummary.mjs';
import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpRight, CalendarDays, CircleDollarSign, Download, Flame, LayoutGrid, Minus, RefreshCw, Search, Snowflake, Target, Users, WalletCards, X } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Cell, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as XLSX from 'xlsx';
import DashboardShell from '../components/dashboard/DashboardShell';
import DashboardViewTabs from '../components/dashboard/DashboardViewTabs';
import LeadRevenuePanel, { revenueMoney } from '../components/leads/LeadRevenuePanel';
import useCrmRefresh from '../hooks/useCrmRefresh';
import api from '../services/api';
import '../styles/lead-pipeline.css';

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

function SummaryStatusChart({ items }) {
  const totalValue = items.reduce((sum, item) => sum + item.value, 0);
  return <section className="summary-chart-card summary-status-card" aria-labelledby="lead-status-heading">
    <header><span><WalletCards/></span><div><h2 id="lead-status-heading">Lead Status</h2><p>Overall lead distribution</p></div></header>
    <div className="summary-status-body">
      <div className="summary-donut"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={items} dataKey="value" innerRadius="62%" outerRadius="88%" paddingAngle={2} stroke="none">{items.map(item => <Cell key={item.label} fill={item.color}/>)}</Pie><Tooltip formatter={(value) => `${Number(value).toLocaleString('en-IN')} leads`}/></PieChart></ResponsiveContainer><span><strong>{totalValue.toLocaleString('en-IN')}</strong><small>Total Leads</small></span></div>
      <div className="summary-status-legend">{items.map(item => <div key={item.label}><i style={{ background:item.color }}/><span>{item.label}</span><b>{item.value.toLocaleString('en-IN')}</b><small>{totalValue ? `${(item.value / totalValue * 100).toFixed(1)}%` : '0%'}</small></div>)}</div>
    </div>
  </section>;
}

function PipelineTrendChart({ data }) {
  return <section className="summary-chart-card summary-trend-card" aria-labelledby="pipeline-overview-heading">
    <header><div><h2 id="pipeline-overview-heading">Revenue Pipeline Overview</h2><p>Lead and revenue movement across the selected period</p></div></header>
    <div className="summary-trend-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top:10, right:10, left:-18, bottom:0 }}><defs><linearGradient id="hotArea" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ff7a38" stopOpacity=".28"/><stop offset="95%" stopColor="#ff7a38" stopOpacity="0"/></linearGradient><linearGradient id="coldArea" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity=".22"/><stop offset="95%" stopColor="#3b82f6" stopOpacity="0"/></linearGradient></defs><CartesianGrid stroke="#e8eef2" strokeDasharray="3 3" vertical={false}/><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize:9, fill:'#789' }}/><YAxis yAxisId="leads" axisLine={false} tickLine={false} tick={{ fontSize:9, fill:'#789' }} allowDecimals={false}/><YAxis yAxisId="money" orientation="right" hide/><Tooltip formatter={(value, name) => name === 'Revenue' ? revenueMoney(Number(value) * 100) : `${Number(value).toLocaleString('en-IN')} leads`}/><Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize:10 }}/><Area yAxisId="leads" type="monotone" dataKey="hot" name="Hot Leads" stroke="#ff6a24" strokeWidth={2.5} fill="url(#hotArea)"/><Area yAxisId="leads" type="monotone" dataKey="cold" name="Cold Leads" stroke="#3485f6" strokeWidth={2.5} fill="url(#coldArea)"/><Line yAxisId="money" type="monotone" dataKey="revenue" name="Revenue" stroke="#22b573" strokeWidth={2.5} dot={false}/></AreaChart></ResponsiveContainer></div>
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
    const timestamps = rows.map(row => new Date(row.createdAt).getTime()).filter(Number.isFinite);
    const anchor = period === 'year' ? new Date(`${periodDate.slice(0, 4)}-12-01T00:00:00`) : new Date(timestamps.length ? Math.max(...timestamps) : Date.now());
    const firstMonth = period === 'year' ? 0 : anchor.getMonth() - 11;
    for (let index = 0; index < 12; index += 1) { const date = new Date(anchor.getFullYear(), firstMonth + index, 1); addBucket(date, date.toLocaleDateString('en-IN', { month:'short' })); }
  }
  const endFor = (bucket, index) => index + 1 < buckets.length ? buckets[index + 1].start : (() => { if (period === 'custom' && range.end) return range.end; const date = new Date(bucket.start); period === 'week' || period === 'month' ? date.setDate(date.getDate() + 1) : date.setMonth(date.getMonth() + 1); return date.getTime(); })();
  rows.forEach(row => {
    const timestamp = new Date(row.createdAt).getTime();
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

function SalesPriorityCard({ kind, open, closed, revenue, poValue, previousOpen, previousClosed, comparisonLabel, onOpen }) {
  const hot = kind === 'hot';
  const Icon = hot ? Flame : Snowflake;
  return <article className={`sales-priority-card ${kind}`}>
    <header><span className="sales-priority-icon"><Icon aria-hidden="true"/></span><div><h2>{hot ? 'Hot Leads' : 'Cold Leads'}</h2><p>{hot ? 'High priority leads with active engagement.' : 'Nurturing leads for future opportunities.'}</p></div><em>{hot ? 'High Priority' : 'Low Priority'}</em></header>
    <div className={`sales-priority-metrics ${hot ? '' : 'is-cold'}`}>
      <button type="button" onClick={() => onOpen(kind, hot ? 'open' : '')}><Target/><span><small>Lead Open</small><strong>{open.toLocaleString('en-IN')}</strong><CardPeriodComparison value={open} previous={previousOpen} comparisonLabel={comparisonLabel}/></span></button>
      {hot && <button type="button" onClick={() => onOpen('hot', 'closed')}><span className="sales-priority-metric-icon is-closed">✓</span><span><small>Lead Closed</small><strong>{closed.toLocaleString('en-IN')}</strong><CardPeriodComparison value={closed} previous={previousClosed} comparisonLabel={comparisonLabel}/></span></button>}
      <button type="button" onClick={() => onOpen(kind)}><CircleDollarSign/><span><small>Expected Revenue</small><strong>{revenueMoney(revenue)}</strong></span></button>
      {hot && <button type="button" onClick={() => onOpen('hot', 'closed')}><WalletCards/><span><small>PO Value</small><strong>{revenueMoney(poValue)}</strong></span></button>}
    </div>
  </article>;
}

function SalesDashboardRepTable({ reps, onMetricClick }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const pageCount = Math.max(1, Math.ceil(reps.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const first = (safePage - 1) * pageSize;
  const visible = reps.slice(first, first + pageSize);
  useEffect(() => { setPage(1); }, [reps, pageSize]);
  function exportReps() {
    const sheet = XLSX.utils.json_to_sheet(reps.map((rep) => ({
      'Sales Representative': rep.owner, 'Total Leads': rep.totalLeads, 'Hot Open': rep.hotOpen, 'Hot Closed': rep.hotClosed, 'Cold Open': rep.coldOpen,
      'Expected Revenue (INR)': rep.expectedRevenuePaise / 100, 'PO Value (INR)': rep.poValuePaise / 100, 'Major Service Interest': rep.serviceInterests.map((item) => `${item.label} (${item.count})`).join(', ')
    })));
    sheet['!cols'] = [{ wch:25 }, { wch:12 }, { wch:12 }, { wch:12 }, { wch:12 }, { wch:22 }, { wch:20 }, { wch:55 }];
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Sales Reps'); XLSX.writeFile(book, 'sales-rep-performance.xlsx');
  }
  return <section className="sales-dashboard-reps" aria-labelledby="sales-performance-heading">
    <header><div><span><Users/></span><div><h2 id="sales-performance-heading">Sales Rep Performance</h2><p>Lead summary, conversion and revenue by sales representative.</p></div></div><button type="button" onClick={exportReps} disabled={!reps.length}><Download/>Export</button></header>
    <div className="sales-dashboard-reps-table"><table><thead><tr><th>Sales Representative</th><th>Total<br/>Leads</th><th colSpan="2">Hot Leads<div><small>Open</small><small>Closed</small></div></th><th>Cold Leads<br/><small>Open</small></th><th>Expected Revenue</th><th>PO Value</th><th>Major Service Interest</th></tr></thead>
      <tbody>{visible.map((rep) => <tr key={rep.owner}><td><span className="sales-dashboard-rep"><i>{rep.owner.split(/\s+/).slice(0,2).map(part => part[0]).join('').toUpperCase()}</i><b>{rep.owner.toUpperCase()}</b></span></td><td><button onClick={() => onMetricClick(rep.owner, '', '')}>{rep.totalLeads}</button></td><td className="is-hot"><button onClick={() => onMetricClick(rep.owner, 'hot', 'open')}>{rep.hotOpen}</button></td><td className="is-closed"><button onClick={() => onMetricClick(rep.owner, 'hot', 'closed')}>{rep.hotClosed}</button></td><td className="is-cold"><button onClick={() => onMetricClick(rep.owner, 'cold', '')}>{rep.coldOpen}</button></td><td>{revenueMoney(rep.expectedRevenuePaise)}</td><td>{revenueMoney(rep.poValuePaise)}</td><td><div className="sales-service-tags">{rep.serviceInterests.length ? rep.serviceInterests.map((item, index) => <span key={item.label}><i>{index + 1}</i>{item.label}<b>{item.count}</b></span>) : <small>Not recorded</small>}</div></td></tr>)}</tbody></table>{!reps.length && <p className="pipeline-empty">No sales representatives match these filters.</p>}</div>
    {!!reps.length && <footer><span>Showing {first + 1}–{Math.min(first + pageSize, reps.length)} of {reps.length} records</span><label>Rows per page<select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}><option value="5">5</option><option value="10">10</option><option value="25">25</option></select></label><div><button onClick={() => setPage(value => Math.max(1, value - 1))} disabled={safePage === 1}>‹</button><b>{safePage}</b><button onClick={() => setPage(value => Math.min(pageCount, value + 1))} disabled={safePage === pageCount}>›</button></div></footer>}
  </section>;
}

function SalesTrafficStrip({ sources, onSelect }) {
  const visible = sources.filter((source) => source.count > 0).slice(0, 4);
  const total = sources.reduce((sum, source) => sum + source.count, 0);
  return <section className="sales-traffic-strip" aria-labelledby="sales-traffic-heading"><header><span><LayoutGrid/></span><div><h2 id="sales-traffic-heading">Traffic Source</h2><p>Where your leads are coming from</p></div></header>{visible.map((source, index) => { const percent = total ? Math.round(source.count / total * 100) : 0; return <button type="button" key={source.key || source.label} onClick={() => onSelect(source)} style={{ '--source-color':['#ff762e','#2387ed','#31b75f','#8756e8'][index] }}><span>{index + 1}</span><div><strong>{source.label}</strong><small>{source.count.toLocaleString('en-IN')} ({percent}%)</small><i><em style={{ width:`${percent}%` }}/></i></div></button>; })}</section>;
}

export default function LeadPipeline() {
  const location = useLocation();
  const summaryView = location.pathname.startsWith('/summary-dashboard');
  const salesDashboardView = location.pathname === '/sales-dashboard';
  const [currentUser] = useState(storedUser);
  const [rows, setRows] = useState([]);
  const [sourceModes, setSourceModes] = useState([]);
  const [sourceOptionsUnavailable, setSourceOptionsUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
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
      const result = await api.get(summaryView || salesDashboardView ? '/leads/summary-dashboard' : '/leads/pipeline-revenue?view=sales-rep-v6');
      if (version !== sequence.current) return;
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
  useCrmRefresh(load);
  useEffect(() => {
    if (selection && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!selection && dialog.current?.open) dialog.current.close();
  }, [selection]);
  useEffect(() => {
    if (serviceView && serviceDialog.current && !serviceDialog.current.open) serviceDialog.current.showModal();
    if (!serviceView && serviceDialog.current?.open) serviceDialog.current.close();
  }, [serviceView]);
  const dashboardRows = useMemo(() => summaryView ? rows.filter((row) => !isExistingClientTrafficSource(row)) : rows, [rows, summaryView]);
  const baseFiltered = useMemo(() => dashboardRows.filter(r => (!owner || r.owner === owner) && `${r.company} ${r.code} ${r.owner}`.toLowerCase().includes(deferredQuery.trim().toLowerCase())), [dashboardRows, deferredQuery, owner]);
  const filtered = useMemo(() => currentPipelineRows(baseFiltered.filter(r => inPipelinePeriod(r.createdAt, range))), [baseFiltered, range]);
  const previousFiltered = useMemo(() => previousRange ? currentPipelineRows(baseFiltered.filter(r => inPipelinePeriod(r.createdAt, previousRange))) : [], [baseFiltered, previousRange]);
  const unique = useMemo(() => uniquePipelineRows(filtered), [filtered]);
  const trafficSources = useMemo(() => trafficSourceHierarchy(filtered, sourceModes), [filtered, sourceModes]);
  const listed = useMemo(() => selection ? (selection.kind ? filtered : unique).filter(r => (!selection.kind || r.kind === selection.kind) && (!selection.state || r.state === selection.state) && (!selection.owner || r.owner === selection.owner) && (!selection.sources?.length || selection.sources.includes(trafficSourceKey(r.communicationMode)))) : [], [filtered, selection, unique]);
  const total = source => source.reduce((n, r) => n + r.revenuePaise, 0);
  const poTotal = source => source.reduce((n, r) => n + (r.poAmountPaise || 0), 0);
  const { hotRows, coldRows, hotOpen, hotClosed, previousColdRows, previousHotOpen, previousHotClosed } = useMemo(() => {
    const nextHotRows = filtered.filter((row) => row.kind === 'hot');
    const nextColdRows = filtered.filter((row) => row.kind === 'cold');
    const priorHotRows = previousFiltered.filter((row) => row.kind === 'hot');
    const priorColdRows = previousFiltered.filter((row) => row.kind === 'cold');
    return {
      hotRows: nextHotRows,
      coldRows: nextColdRows,
      hotOpen: nextHotRows.filter((row) => row.state === 'open'),
      hotClosed: nextHotRows.filter((row) => row.state === 'closed'),
      previousColdRows: priorColdRows,
      previousHotOpen: priorHotRows.filter((row) => row.state === 'open'),
      previousHotClosed: priorHotRows.filter((row) => row.state === 'closed')
    };
  }, [filtered, previousFiltered]);
  const activeOwnerRows = useMemo(() => (source) => source.filter((row) => {
    if (row.owner === 'Unassigned') return true;
    return row.ownerActive !== false;
  }), []);
  const ownerOptions = useMemo(() => [...new Set(activeOwnerRows(dashboardRows).map((row) => row.owner).filter((name) => name && name !== 'Unassigned'))].sort(), [activeOwnerRows, dashboardRows]);
  useEffect(() => { if (owner && !ownerOptions.includes(owner)) setOwner(''); }, [owner, ownerOptions]);
  const salesReps = useMemo(() => salesRepSummary(activeOwnerRows(filtered), activeOwnerRows(previousFiltered), sourceModes), [activeOwnerRows, filtered, previousFiltered, sourceModes]);
  const comparisonLabel = period === 'week' ? 'week' : period === 'month' ? 'month' : period === 'quarter' ? 'quarter' : '';
  const trendData = useMemo(() => pipelineTrend(filtered, period, periodDate, range), [filtered, period, periodDate, range]);
  const statusItems = useMemo(() => [
    { label: 'Hot Open', value: hotOpen.length, color: '#ff762e' },
    { label: 'Hot Closed', value: hotClosed.length, color: '#16a66f' },
    { label: 'Cold Open', value: coldRows.length, color: '#3284f6' }
  ], [hotOpen.length, hotClosed.length, coldRows.length]);
  const salesDashboardReps = useMemo(() => salesReps.map((rep) => {
    const ownerRows = activeOwnerRows(filtered).filter((row) => row.owner === rep.owner);
    const interests = new Map();
    ownerRows.forEach((row) => (row.serviceInterests || []).forEach((label) => interests.set(label, (interests.get(label) || 0) + 1)));
    return { ...rep, totalLeads: ownerRows.length, expectedRevenuePaise: total(ownerRows), poValuePaise: poTotal(ownerRows), serviceInterests:[...interests.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 2) };
  }), [activeOwnerRows, filtered, salesReps]);
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
  return <DashboardShell currentUser={currentUser}><div className={`pipeline-page ${summaryView ? 'is-summary' : ''} ${salesDashboardView ? 'is-sales-dashboard' : ''}`}>
    {summaryView && <DashboardViewTabs />}
    <header className="pipeline-header summary-dashboard-heading"><div className="pipeline-heading">{(summaryView || salesDashboardView) && <span className="summary-heading-icon"><LayoutGrid/></span>}<div><h1>{salesDashboardView ? 'Sales Dashboard' : summaryView ? 'Summary Dashboard' : 'Revenue Pipeline'}</h1><p>{salesDashboardView ? 'Real-time overview of leads, revenue, team performance and pipeline.' : summaryView ? 'Overview of leads, revenue, team performance and pipeline in real time.' : 'A clear view of your hot and cold pipeline, with locked revenue history.'}</p></div></div><div className="pipeline-filters"><label><Search size={17}/><input aria-label="Search pipeline" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search company, lead ID or owner…"/></label><select aria-label="Filter by owner" value={owner} onChange={e => setOwner(e.target.value)}><option value="">All active owners</option>{ownerOptions.map(name => <option key={name} value={name}>{name.toUpperCase()}</option>)}</select></div></header>
    <section className="pipeline-period-bar" aria-label="Pipeline date filters">
      <div className="pipeline-period-tabs" role="group" aria-label="Filter period">{(salesDashboardView ? [['all', 'All Data'], ['month', 'This Month'], ['quarter', 'This Quarter'], ['year', 'This Year'], ['custom', 'Custom Range']] : [['all', 'All time'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']]).map(([value, label]) => <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)}>{value === 'custom' && <CalendarDays/>}{label}</button>)}</div>
      <div className="pipeline-period-context">{period === 'custom' ? <label className="sales-custom-range"><input aria-label="Custom range start" type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)}/><span>to</span><input aria-label="Custom range end" type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)}/></label> : period !== 'all' && !salesDashboardView ? <label>Choose {period}{period === 'year' ? <select aria-label="Choose year" value={periodDate.slice(0, 4)} onChange={e => setPeriodDate(`${e.target.value}-01-01`)}>{[...new Set([new Date().getFullYear(), Number(periodDate.slice(0, 4)), ...rows.map(row => new Date(row.createdAt).getFullYear()).filter(Number.isFinite)])].sort((a, b) => b - a).map(year => <option key={year} value={year}>{year}</option>)}</select> : <input aria-label={`Choose ${period}`} type={period === 'month' ? 'month' : 'date'} value={period === 'month' ? periodDate.slice(0, 7) : periodDate} onChange={e => { if (e.target.value) setPeriodDate(period === 'month' ? `${e.target.value}-01` : e.target.value); }}/>}</label> : null}<span>{range.label} · Lead creation date</span></div>
      {salesDashboardView && <button className="pipeline-refresh" type="button" onClick={load} disabled={loading}><RefreshCw size={15}/>Refresh</button>}
      <button className="pipeline-export" type="button" disabled={loading || !unique.length} onClick={() => exportRows(unique, `pipeline-${period}`)}><Download size={16}/>Export</button>
    </section>
    {error && <p role="alert" className="pipeline-error">{error}</p>}
    {loading ? <PipelineSkeleton /> : <>
      {summaryView && <>{!unique.length && <p role="status" className="pipeline-filter-empty">No leads match these filters. Try another period or owner.</p>}
      <section className="summary-kpi-grid" aria-label="Sales summary">
        <SummaryKpi label="Hot Leads" value={hotOpen.length} previous={previousHotOpen.length} comparisonLabel={comparisonLabel} icon={Flame} tone="hot" trend={trendData.map(item => item.hot)} onClick={() => open('hot', 'open')}/>
        <SummaryKpi label="Cold Leads" value={coldRows.length} previous={previousColdRows.length} comparisonLabel={comparisonLabel} icon={Snowflake} tone="cold" trend={trendData.map(item => item.cold)} onClick={() => open('cold')}/>
        <SummaryKpi label="Total Expected Revenue" value={total(unique)} previous={total(previousFiltered)} comparisonLabel={comparisonLabel} icon={CircleDollarSign} tone="revenue" trend={trendData.map(item => item.revenue)} money onClick={() => open()}/>
        <SummaryKpi label="PO Value" value={poTotal(hotClosed)} previous={poTotal(previousHotClosed)} comparisonLabel={comparisonLabel} icon={WalletCards} tone="po" trend={trendData.map(item => item.revenue)} money onClick={() => open('hot', 'closed')}/>
      </section>
      <section className="summary-analytics-grid">
        <PipelineTrendChart data={trendData}/>
        <SummaryStatusChart items={statusItems}/>
        <TrafficSources sources={trafficSources} onSelect={openSource} optionsUnavailable={sourceOptionsUnavailable}/>
      </section></>}
      {salesDashboardView && <>
        {!unique.length && <p role="status" className="pipeline-filter-empty">No leads match these filters. Try another period or owner.</p>}
        <section className="sales-priority-grid" aria-label="Sales pipeline priorities">
          <SalesPriorityCard kind="hot" open={hotOpen.length} closed={hotClosed.length} revenue={total(hotRows)} poValue={poTotal(hotClosed)} previousOpen={previousHotOpen.length} previousClosed={previousHotClosed.length} comparisonLabel={comparisonLabel} onOpen={open}/>
          <SalesPriorityCard kind="cold" open={coldRows.length} closed={0} revenue={total(coldRows)} poValue={0} previousOpen={previousColdRows.length} previousClosed={0} comparisonLabel={comparisonLabel} onOpen={open}/>
        </section>
        <section className="sales-dashboard-main">
          <div className="sales-dashboard-charts"><PipelineTrendChart data={trendData}/><SummaryStatusChart items={statusItems}/></div>
          <SalesDashboardRepTable reps={salesDashboardReps} onMetricClick={(selectedOwner, kind, state) => open(kind, state, selectedOwner)}/>
        </section>
        <SalesTrafficStrip sources={trafficSources} onSelect={openSource}/>
      </>}
      {!summaryView && !salesDashboardView && <div className="pipeline-content-layout"><section className="pipeline-sales-workspace" aria-label="Sales pipeline">
        {!unique.length && <p role="status" className="pipeline-filter-empty">No leads match these filters. Try another period or owner.</p>}
        <div className="pipeline-kind-grid">
          <article className="pipeline-kind-card hot"><header><span><Flame/></span><button type="button" onClick={() => open('hot')}>Hot Leads<ArrowUpRight/></button>{comparisonLabel && <small className="pipeline-card-period">{comparisonLabel} comparison</small>}</header><div className="pipeline-kind-counts"><button type="button" onClick={() => open('hot', 'open')}><small>Open</small><strong>{hotOpen.length.toLocaleString('en-IN')}</strong><CardPeriodComparison value={hotOpen.length} previous={previousHotOpen.length} comparisonLabel={comparisonLabel}/></button><button type="button" onClick={() => open('hot', 'closed')}><small>Closed</small><strong>{hotClosed.length.toLocaleString('en-IN')}</strong><CardPeriodComparison value={hotClosed.length} previous={previousHotClosed.length} comparisonLabel={comparisonLabel}/></button></div><div className="pipeline-kind-money"><button type="button" onClick={() => open('hot')}><small>Estimated Revenue</small><strong>{revenueMoney(total(hotRows))}</strong></button><button type="button" onClick={() => open('hot', 'closed')}><small>PO Value</small><strong>{revenueMoney(poTotal(hotClosed))}</strong></button></div></article>
          <article className="pipeline-kind-card cold"><header><span><Snowflake/></span><button type="button" onClick={() => open('cold')}>Cold Leads<ArrowUpRight/></button>{comparisonLabel && <small className="pipeline-card-period">{comparisonLabel} comparison</small>}</header><div className="pipeline-kind-counts pipeline-kind-counts-single"><button type="button" onClick={() => open('cold')}><small>Open</small><strong>{coldRows.length.toLocaleString('en-IN')}</strong><CardPeriodComparison value={coldRows.length} previous={previousColdRows.length} comparisonLabel={comparisonLabel}/></button></div><div className="pipeline-kind-money"><button type="button" onClick={() => open('cold')}><small>Estimated Revenue</small><strong>{revenueMoney(total(coldRows))}</strong></button></div></article>
        </div>
        <p className="pipeline-note">Converted leads appear only in the Hot pipeline. Hot plus Cold therefore matches the unique Traffic Source total. PO value and estimated revenue are shown separately.</p>
      </section><TrafficSources sources={trafficSources} onSelect={openSource} optionsUnavailable={sourceOptionsUnavailable}/></div>}
      {!salesDashboardView && <SalesRepTable reps={salesReps} comparisonLabel={comparisonLabel} range={range} previousRange={previousRange} onMetricClick={(selectedOwner, kind, state) => open(kind, state, selectedOwner)} onSourceClick={openOwnerSource}/>}
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
