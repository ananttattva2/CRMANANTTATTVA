import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowUpDown, BarChart3, Building2, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Download, Factory, FileSpreadsheet, Layers3, Leaf, RefreshCw, Recycle, Search, Users, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import DashboardShell from '../components/dashboard/DashboardShell';
import api from '../services/api';
import { API_ENDPOINTS } from '../services/apiEndpoints';
import '../styles/annual-return-operations.css';

const CATEGORY_THEME = {
  'Plastic Waste': { color: '#16a34a', soft: '#ecfdf5', position: '0%' },
  'E-Waste': { color: '#2563eb', soft: '#eff6ff', position: '25%' },
  'Tyre Waste': { color: '#f97316', soft: '#fff7ed', position: '50%' },
  'Used Oil': { color: '#eab308', soft: '#fefce8', position: '75%' },
  'Battery Waste': { color: '#7c3aed', soft: '#f5f3ff', position: '100%' }
};
const FILTER_DEFAULTS = { year: '', user: '', team: '', category: '', applicantType: '', subType: '', status: '', dueFrom: '', dueTo: '', search: '', page: 1, limit: 10, sortBy: 'company', sortDir: 'asc' };
const STATUS_OPTIONS = ['Completed', 'In Progress', 'Pending', 'Overdue', 'Due Soon'];
const APPLICANT_ICONS = [Users, Building2, Leaf];
const SUBTYPE_ICONS = [Factory, Building2, Layers3];

function readInitialFilters(search) {
  const params = new URLSearchParams(search);
  return Object.fromEntries(Object.entries(FILTER_DEFAULTS).map(([name, fallback]) => {
    const raw = params.get(name);
    return [name, typeof fallback === 'number' ? Number(raw) || fallback : raw || fallback];
  }));
}

function percent(value, total) { return total ? Math.round((value / total) * 1000) / 10 : 0; }
function formatDate(value) { return value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Not set'; }
function initials(name) { return String(name || 'U').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase(); }

function Count({ value }) {
  const [shown, setShown] = useState(value || 0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setShown(value || 0); return undefined; }
    const from = shown; const to = Number(value) || 0; const start = performance.now(); let frame;
    const tick = now => { const ratio = Math.min(1, (now - start) / 240); setShown(Math.round(from + ((to - from) * ratio))); if (ratio < 1) frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [value]);
  return shown.toLocaleString('en-IN');
}

function FilterSelect({ label, value, onChange, children, disabled = false }) {
  return <label className="arops-filter"><span>{label}</span><select value={value} onChange={event => onChange(event.target.value)} disabled={disabled}>{children}</select></label>;
}

function Progress({ value, color = '#16a34a' }) {
  return <span className="arops-progress" aria-label={`${value}% complete`}><i style={{ width: `${Math.max(0, Math.min(100, value || 0))}%`, background: color }} /></span>;
}

function Breakdown({ row }) {
  return <div className="arops-breakdown"><span><i className="is-complete" />Completed <b>{row.completed}</b></span><span><i className="is-progress" />In Progress <b>{row.inProgress}</b></span><span><i className="is-pending" />Pending <b>{row.pending}</b></span></div>;
}

function DrillCard({ row, selected, icon: Icon, onClick, index = 0 }) {
  return <button type="button" aria-pressed={selected} onClick={onClick} className={`arops-drill-card ${selected ? 'is-selected' : ''}`} style={{ '--delay': `${index * 45}ms` }}>
    {selected && <span className="arops-selected-check"><Check /></span>}
    <div className="arops-drill-heading"><span><Icon /></span><div><h3>{row.label}</h3><p><b>{row.count}</b> Annual Return Services</p></div></div>
    <div className="arops-drill-body"><Breakdown row={row} /><div className="arops-completion"><strong>{row.completion}%</strong><small>Completion</small><Progress value={row.completion} /></div></div>
    {row.overdue > 0 && <small className="arops-overdue-note">{row.overdue} overdue</small>}
  </button>;
}

function SummaryCard({ icon: Icon, label, value, note, tone, comparison, index }) {
  const change = comparison?.change;
  return <article className={`arops-summary-card is-${tone}`} style={{ '--delay': `${index * 45}ms` }}><span className="arops-summary-icon"><Icon /></span><div><p>{label}</p><strong><Count value={value} /></strong><small>{note}</small></div>{change != null && <em className={change >= 0 ? 'is-up' : 'is-down'}>{change >= 0 ? '▲' : '▼'} {Math.abs(change)}%</em>}</article>;
}

function CategoryCard({ row, selected, onClick, index }) {
  const theme = CATEGORY_THEME[row.label] || CATEGORY_THEME['Plastic Waste'];
  return <button type="button" aria-pressed={selected} onClick={onClick} className={`arops-category-card ${selected ? 'is-selected' : ''}`} style={{ '--accent': theme.color, '--soft': theme.soft, '--position': theme.position, '--delay': `${index * 55}ms` }}>
    <div className="arops-category-photo"><span><Recycle /></span><div><h3>{row.label}</h3><p>{row.count} Annual Return Services</p></div>{selected && <Check className="arops-category-check" />}</div>
    <div className="arops-category-body"><Breakdown row={row} /><div className="arops-category-completion"><strong>{row.completion}%</strong><small>Completion</small><Progress value={row.completion} color={theme.color} /></div></div>
  </button>;
}

function StatusPill({ row }) {
  const label = row.overdue ? 'Overdue' : row.status;
  return <span className={`arops-status is-${label.toLowerCase().replace(/\s+/g, '-')}`}>{label}</span>;
}

export default function AnnualReturnOperationsDashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const [currentUser] = useState(() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } });
  const [filters, setFilters] = useState(() => readInitialFilters(location.search));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const setFilter = (name, value) => setFilters(current => ({ ...current, [name]: value, page: name === 'page' ? Number(value) : 1 }));
  const chooseCategory = value => setFilters(current => ({ ...current, category: current.category === value ? '' : value, applicantType: '', subType: '', page: 1 }));
  const chooseApplicant = value => setFilters(current => ({ ...current, applicantType: current.applicantType === value ? '' : value, subType: '', page: 1 }));
  const chooseSubType = value => setFilters(current => ({ ...current, subType: current.subType === value ? '' : value, page: 1 }));

  useEffect(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([name, value]) => { if (value !== '' && value !== FILTER_DEFAULTS[name]) params.set(name, String(value)); });
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true, state: location.state });
  }, [filters]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const response = await api.get(API_ENDPOINTS.dashboardInsights.annualReturnOperations, { params: filters, signal: controller.signal });
        setData(response.data);
        if (response.data.selectedYear && filters.year !== response.data.selectedYear) {
          setFilters(current => ({ ...current, year: response.data.selectedYear, page: 1 }));
        }
      } catch (requestError) {
        if (requestError.code !== 'ERR_CANCELED') {
          const responseData = requestError?.response?.data;
          console.error('[Summary Dashboard] request failed', {
            status: requestError?.response?.status,
            diagnostic: responseData?.diagnostic,
            error: responseData?.error || requestError.message
          });
          const diagnostic = responseData?.diagnostic;
          setError(`${responseData?.error || 'Unable to load the Summary Dashboard.'}${diagnostic ? ` Diagnostic: ${diagnostic.version}/${diagnostic.stage}/${diagnostic.code}` : ''}`);
        }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, filters.search ? 220 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [filters]);

  const activeChips = useMemo(() => [
    filters.year && ['year', `FY ${filters.year}`], ['scope', 'Annual Return'], filters.user && ['user', data?.options?.users?.find(item => item.value === filters.user)?.label || 'Assigned User'],
    filters.team && ['team', filters.team], filters.category && ['category', filters.category], filters.applicantType && ['applicantType', filters.applicantType], filters.subType && ['subType', filters.subType],
    filters.status && ['status', filters.status], (filters.dueFrom || filters.dueTo) && ['due', `${filters.dueFrom || 'Any'} – ${filters.dueTo || 'Any'}`]
  ].filter(Boolean), [data?.options?.users, filters]);
  const summary = data?.summary || {};
  const maxCategory = Math.max(1, ...(data?.categories || []).map(row => row.count));
  const maxWorkload = Math.max(1, ...(data?.workloads || []).map(row => row.count));
  const records = data?.records || [];

  async function exportExcel() {
    setExporting(true); setError('');
    try {
      const response = await api.get(API_ENDPOINTS.dashboardInsights.annualReturnOperations, { params: { ...filters, export: 'true' } });
      const rows = (response.data.records || []).map(row => ({ Company: row.company, 'Lead ID': row.leadId, 'Service Category': row.category, 'Applicant Type': row.applicantType, 'Sub-Type': row.subType, 'Annual Return Year': row.annualReturnYear, 'Assigned User': row.assignedUser, 'Due Date': row.dueDate || 'Not set', Status: row.overdue ? 'Overdue' : row.status, 'Progress %': row.progress }));
      const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Annual Return Services');
      XLSX.writeFile(workbook, `Annual-Return-Summary-${data?.selectedYear || 'all'}.xlsx`);
    } catch (exportError) { setError(exportError?.response?.data?.error || 'Excel export failed.'); }
    finally { setExporting(false); }
  }

  function sort(field) { setFilters(current => ({ ...current, sortBy: field, sortDir: current.sortBy === field && current.sortDir === 'asc' ? 'desc' : 'asc', page: 1 })); }
  function clearChip(name) {
    if (name === 'scope') return;
    if (name === 'category') return chooseCategory(filters.category);
    if (name === 'applicantType') return chooseApplicant(filters.applicantType);
    if (name === 'subType') return chooseSubType(filters.subType);
    if (name === 'due') return setFilters(current => ({ ...current, dueFrom: '', dueTo: '', page: 1 }));
    setFilter(name, '');
  }

  const headingPath = ['Annual Return', filters.category, filters.applicantType, filters.subType].filter(Boolean).join(' › ');
  return <DashboardShell currentUser={currentUser}><main className="arops-page">
    <header className="arops-header"><div><h1><span><BarChart3 /></span>Operations Dashboard</h1><p>Annual Return Services Overview</p></div><div className="arops-header-actions"><button type="button" onClick={() => setFilters(current => ({ ...current }))}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh</button><button type="button" onClick={exportExcel} disabled={exporting}><Download />{exporting ? 'Exporting…' : 'Export'}</button></div></header>

    <section className="arops-toolbar" aria-label="Dashboard filters">
      <FilterSelect label="Annual Return Year" value={filters.year} onChange={value => setFilter('year', value)}>{!filters.year && <option value="">Current Reporting Year</option>}{(data?.options?.years || []).map(value => <option key={value}>{value}</option>)}</FilterSelect>
      <FilterSelect label="Assigned User" value={filters.user} onChange={value => setFilter('user', value)}><option value="">All Users</option>{(data?.options?.users || []).map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</FilterSelect>
      <FilterSelect label="Team / Manager" value={filters.team} onChange={value => setFilter('team', value)}><option value="">All Teams</option>{(data?.options?.teams || []).map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</FilterSelect>
      <FilterSelect label="Service Category" value={filters.category} onChange={chooseCategory}><option value="">All Categories</option>{(data?.options?.categories || []).map(value => <option key={value}>{value}</option>)}</FilterSelect>
      <FilterSelect label="Applicant Type" value={filters.applicantType} onChange={chooseApplicant}><option value="">All Types</option>{(data?.options?.applicantTypes || []).map(value => <option key={value}>{value}</option>)}</FilterSelect>
      <FilterSelect label="Sub-Type" value={filters.subType} onChange={chooseSubType}><option value="">All Sub-Types</option>{(data?.options?.subTypes || []).map(value => <option key={value}>{value}</option>)}</FilterSelect>
      <FilterSelect label="Service Status" value={filters.status} onChange={value => setFilter('status', value)}><option value="">All Statuses</option>{STATUS_OPTIONS.map(value => <option key={value}>{value}</option>)}</FilterSelect>
      <label className="arops-filter arops-date-filter"><span>Due Date Range</span><div><input aria-label="Due date from" type="date" value={filters.dueFrom} onChange={event => setFilter('dueFrom', event.target.value)} /><input aria-label="Due date to" type="date" value={filters.dueTo} onChange={event => setFilter('dueTo', event.target.value)} /></div></label>
      <label className="arops-search"><Search /><input value={filters.search} onChange={event => setFilter('search', event.target.value)} placeholder="Search company or lead ID" /></label>
      <button type="button" className="arops-reset" onClick={() => setFilters({ ...FILTER_DEFAULTS })}><RefreshCw />Reset Filters</button>
    </section>
    <div className="arops-chips"><strong>Active Filters:</strong>{activeChips.map(([name, label]) => <span key={name}>{label}{name !== 'scope' && <button type="button" aria-label={`Remove ${label}`} onClick={() => clearChip(name)}><X /></button>}</span>)}</div>

    {error && <div className="arops-error" role="alert"><AlertTriangle />{error}<button type="button" onClick={() => setFilters(current => ({ ...current }))}>Retry</button></div>}
    {loading && !data ? <div className="arops-skeleton"><i /><i /><i /><i /><i /><i /></div> : <>
      <section className="arops-summary-grid">
        <SummaryCard index={0} icon={FileSpreadsheet} label="Total Annual Return Services" value={summary.total} note="Distinct service assignments" tone="teal" comparison={data?.comparisons?.total} />
        <SummaryCard index={1} icon={CheckCircle2} label="Completed Services" value={summary.completed} note={`${summary.completion || 0}% completion`} tone="green" comparison={data?.comparisons?.completed} />
        <SummaryCard index={2} icon={RefreshCw} label="In Progress Services" value={summary.inProgress} note={`${percent(summary.inProgress, summary.total)}% of services`} tone="blue" comparison={data?.comparisons?.inProgress} />
        <SummaryCard index={3} icon={Clock3} label="Pending Services" value={summary.pending} note={`${percent(summary.pending, summary.total)}% of services`} tone="amber" comparison={data?.comparisons?.pending} />
        <SummaryCard index={4} icon={AlertTriangle} label="Overdue Services" value={summary.overdue} note="Past a recorded due date" tone="red" comparison={data?.comparisons?.overdue} />
        <SummaryCard index={5} icon={CalendarDays} label="Services Due Soon" value={summary.dueSoon} note="Due in the next 7 days" tone="purple" comparison={data?.comparisons?.dueSoon} />
      </section>
      <section className="arops-category-grid">{(data?.categories || []).map((row, index) => <CategoryCard key={row.label} row={row} index={index} selected={filters.category === row.label} onClick={() => chooseCategory(row.label)} />)}</section>
      <nav className="arops-breadcrumb" aria-label="Current drill-down"><span>⌂</span><b>Operations</b>{filters.category && <><i>›</i><strong>{filters.category}</strong></>}{filters.applicantType && <><i>›</i><strong>{filters.applicantType}</strong></>}{filters.subType && <><i>›</i><strong>{filters.subType}</strong></>}</nav>

      <section className="arops-main-grid"><div className="arops-drill-column">
        <section className="arops-panel"><header><span><Users /></span><div><h2>Applicant Type{filters.category ? ` – ${filters.category}` : ''}</h2><p>Annual Return services by applicant type</p></div></header>{filters.category ? <div className="arops-drill-grid">{(data?.applicantTypes || []).map((row, index) => <DrillCard key={row.label} row={row} index={index} icon={APPLICANT_ICONS[index % APPLICANT_ICONS.length]} selected={filters.applicantType === row.label} onClick={() => chooseApplicant(row.label)} />)}</div> : <p className="arops-empty">Select a service category to view its supported applicant types.</p>}</section>
        <section className="arops-panel"><header><span><Layers3 /></span><div><h2>{filters.applicantType || 'Applicant'} Sub-Type{filters.category ? ` – ${filters.category}` : ''}</h2><p>Annual Return services within the selected applicant type</p></div></header>{filters.applicantType ? <div className="arops-drill-grid">{(data?.subTypes || []).map((row, index) => <DrillCard key={row.label} row={row} index={index} icon={SUBTYPE_ICONS[index % SUBTYPE_ICONS.length]} selected={filters.subType === row.label} onClick={() => chooseSubType(row.label)} />)}</div> : <p className="arops-empty">Select an applicant type to view its saved sub-types.</p>}</section>
      </div><aside className="arops-insights">
        <section className="arops-panel arops-chart-panel"><header><span><BarChart3 /></span><div><h2>Category Comparison – Annual Return Services</h2><p>Click a bar to filter the dashboard</p></div></header><div className="arops-chart">{(data?.categories || []).map(row => { const theme = CATEGORY_THEME[row.label]; return <button type="button" key={row.label} onClick={() => chooseCategory(row.label)} title={`${row.label}: ${row.count} services, ${row.completion}% complete`} aria-label={`Select ${row.label}`}><b>{row.count}</b><span><i style={{ height: `${Math.max(4, (row.count / maxCategory) * 100)}%`, background: theme.color }} /></span><small>{row.label.replace(' Waste', '\nWaste')}</small></button>; })}</div></section>
        <section className="arops-panel arops-workload"><header><span><Users /></span><div><h2>User Workload Summary</h2><p>Annual Return service assignments</p></div><em>Total Users: {data?.workloads?.length || 0}</em></header><div>{(data?.workloads || []).slice(0, 8).map(row => <button type="button" key={row.label} onClick={() => setFilter('user', row.userId)}><span>{row.label}</span><i><b style={{ width: `${(row.count / maxWorkload) * 100}%` }} /></i><strong>{row.count}</strong></button>)}{!data?.workloads?.length && <p className="arops-empty">No assigned users match these filters.</p>}</div></section>
      </aside></section>

      <section className="arops-table-panel"><header><div><h2>Service Details – {headingPath}</h2><p>Distinct Annual Return service assignments matching the full selection</p></div><button type="button" onClick={exportExcel} disabled={exporting}><Download />Export to Excel</button></header><div className="arops-table-scroll"><table><thead><tr>{[['company','Company'],['leadId','Lead ID'],['category','Service Category'],['applicantType','Applicant Type'],['subType','Sub-Type'],['annualReturnYear','Annual Return Year'],['assignedUser','Assigned User'],['dueDate','Due Date'],['status','Status'],['progress','Progress']].map(([field,label]) => <th key={field}><button type="button" onClick={() => sort(field)}>{label}<ArrowUpDown /></button></th>)}<th>Action</th></tr></thead><tbody>{records.map(row => <tr key={row.id}><td><b>{row.company}</b></td><td><button type="button" className="arops-lead-link" onClick={() => navigate(row.openPath, { state: { returnTo: `${location.pathname}${location.search}` } })}>{row.leadId}</button></td><td>{row.category}</td><td>{row.applicantType}</td><td>{row.subType}</td><td>{row.annualReturnYear}</td><td><span className="arops-user"><i>{initials(row.assignedUser)}</i>{row.assignedUser}</span></td><td><span className="arops-due"><CalendarDays />{formatDate(row.dueDate)}</span></td><td><StatusPill row={row} /></td><td><span className="arops-row-progress"><b>{row.progress}%</b><Progress value={row.progress} /></span></td><td><button type="button" className="arops-open" onClick={() => navigate(row.openPath, { state: { returnTo: `${location.pathname}${location.search}` } })}>Open Record</button></td></tr>)}{!records.length && <tr><td colSpan="11" className="arops-table-empty">No Annual Return service records match the current filters.</td></tr>}</tbody></table></div><footer><span>Showing {data?.pagination?.total ? ((data.pagination.page - 1) * data.pagination.limit) + 1 : 0} – {Math.min((data?.pagination?.page || 1) * (data?.pagination?.limit || 10), data?.pagination?.total || 0)} of {data?.pagination?.total || 0} services</span><div><button type="button" disabled={(data?.pagination?.page || 1) <= 1} onClick={() => setFilter('page', filters.page - 1)}><ChevronLeft /></button>{Array.from({ length: Math.min(5, data?.pagination?.pages || 1) }, (_, index) => index + 1).map(page => <button type="button" key={page} className={page === data?.pagination?.page ? 'is-current' : ''} onClick={() => setFilter('page', page)}>{page}</button>)}<button type="button" disabled={(data?.pagination?.page || 1) >= (data?.pagination?.pages || 1)} onClick={() => setFilter('page', filters.page + 1)}><ChevronRight /></button></div></footer></section>
    </>}
  </main></DashboardShell>;
}
