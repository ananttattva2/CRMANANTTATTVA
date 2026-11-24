import useCrmRefresh from '../hooks/useCrmRefresh'
import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bar, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, Pie, PieChart, Tooltip, XAxis, YAxis
} from 'recharts'
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, BadgeIndianRupee, CalendarDays, CheckCircle2,
  BarChart3, FileSpreadsheet, FileText, RefreshCw, Target, TrendingUp, Users, X, XCircle
} from 'lucide-react'
import DashboardShell from '../components/dashboard/DashboardShell'
import ResponsiveContainer from '../components/charts/SafeResponsiveContainer'
import api from '../services/api'
import { API_ENDPOINTS } from '../services/apiEndpoints'
import { exportQuotationMisPdf, exportSalesManagementExcel, exportSalesManagementPdf } from '../utils/salesManagementExports'

const COLORS = ['#10B981', '#0EA5E9', '#8B5CF6', '#F59E0B', '#EF4444', '#64748B']
const EMPTY_DATA = { summary: {}, managerPerformance: [], monthlyTrend: [], monthlyCarryForward: [], departmentBreakdown: [], riskIndicators: {}, insights: {}, meta: {} }
const EMPTY_OPERATIONS = { summary: {}, users: [], misAccess: { operationTeams: [] } }

function entityId(value) {
  if (value && typeof value === 'object') return String(value._id || value.id || '')
  return String(value || '')
}

function sumRows(rows, field) {
  return rows.reduce((total, row) => total + (Number(row?.[field]) || 0), 0)
}

function buildOperationGroups(rows = [], teams = []) {
  const makeGroup = (id, name, manager, members) => {
    const people = [...(manager ? [manager] : []), ...members]
    const filled = sumRows(people, 'clientFieldsFilled')
    const missing = sumRows(people, 'clientFieldsMissing')
    return {
      id, name, manager, members, people, filled, missing,
      clientMasters: sumRows(people, 'clientMasters'), draftClients: sumRows(people, 'draftClients'),
      submittedClients: sumRows(people, 'submittedClients'), pendingClients: sumRows(people, 'pendingClients'),
      approvedClients: sumRows(people, 'approvedClients'), partiallyApprovedClients: sumRows(people, 'partiallyApprovedClients'),
      rejectedClients: sumRows(people, 'rejectedClients'), percentage: filled + missing ? Math.round((filled / (filled + missing)) * 100) : 0
    }
  }
  if (teams.length) return teams.map((team) => {
    const managerId = entityId(team.managerId)
    const manager = rows.find((row) => entityId(row.id) === managerId) || null
    const memberIds = new Set((team.memberIds || []).map(entityId))
    return makeGroup(entityId(team.id), team.name || 'Operations Team', manager, rows.filter((row) => memberIds.has(entityId(row.id)) && entityId(row.id) !== managerId))
  })
  const operationRows = rows.filter((row) => ['operation', 'manager', 'operation head', 'operations head'].includes(String(row.role || '').toLowerCase()))
  const byTeam = new Map()
  operationRows.forEach((row) => {
    const team = row.team || 'Unassigned Operations'
    if (!byTeam.has(team)) byTeam.set(team, [])
    byTeam.get(team).push(row)
  })
  return [...byTeam.entries()].map(([name, people]) => {
    const manager = people.find((row) => String(row.role || '').toLowerCase() === 'manager') || null
    return makeGroup(name, name, manager, people.filter((row) => row !== manager))
  })
}

function inputDate(value) {
  const date = new Date(value)
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
  return formatter.format(date)
}

function initialRange() {
  const now = new Date()
  return { dateFrom: inputDate(new Date(now.getFullYear(), now.getMonth() - 5, 1)), dateTo: inputDate(now), department: '', interval: 'monthly' }
}

function presetRange(preset) {
  const now = new Date()
  if (preset === 'all-time') return { dateFrom: inputDate(new Date(now.getFullYear() - 3, now.getMonth(), now.getDate() + 1)), dateTo: inputDate(now) }
  if (preset === 'monthly') return { dateFrom: inputDate(new Date(now.getFullYear(), now.getMonth(), 1)), dateTo: inputDate(now) }
  if (preset === 'quarterly') return { dateFrom: inputDate(new Date(now.getFullYear(), now.getMonth() - 2, 1)), dateTo: inputDate(now) }
  if (preset === 'yearly') return { dateFrom: inputDate(new Date(now.getFullYear(), 0, 1)), dateTo: inputDate(now) }
  return initialRange()
}

function money(value, compact = false) {
  const amount = Number(value) || 0
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: compact ? 1 : 0,
    ...(compact ? { notation: 'compact' } : {})
  }).format(amount)
}

function percent(value) {
  return `${Number(value || 0).toFixed(1)}%`
}

function monthLabel(value) {
  const weekly = /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
  const date = new Date(`${value}${weekly ? '' : '-01'}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return value
  const label = date.toLocaleDateString('en-IN', { day: weekly ? '2-digit' : undefined, month: 'short', year: 'numeric', timeZone: 'UTC' })
  return weekly ? `Week of ${label}` : label
}

function Change({ value, suffix = '%' }) {
  const number = Number(value) || 0
  const positive = number >= 0
  const Icon = positive ? ArrowUp : ArrowDown
  return <span className={`inline-flex items-center gap-1 text-xs font-black ${positive ? 'text-emerald-600' : 'text-rose-600'}`}><Icon className="h-3 w-3" />{Math.abs(number).toFixed(1)}{suffix}</span>
}

function KpiCard({ label, value, note, change, icon: Icon, tone }) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100', blue: 'bg-sky-50 text-sky-700 ring-sky-100',
    violet: 'bg-violet-50 text-violet-700 ring-violet-100', amber: 'bg-amber-50 text-amber-700 ring-amber-100'
  }
  return <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/5">
    <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-black uppercase tracking-[.16em] text-slate-500">{label}</p><p className="mt-3 text-3xl font-black tracking-tight text-slate-950">{value}</p></div><span className={`grid h-12 w-12 place-items-center rounded-2xl ring-1 ${tones[tone]}`}><Icon className="h-6 w-6" /></span></div>
    <div className="mt-4 flex items-center justify-between gap-3"><p className="truncate text-xs font-bold text-slate-500">{note}</p>{change !== undefined && <Change value={change} />}</div>
  </article>
}

function StatusBadge({ status }) {
  const config = {
    active: { icon: CheckCircle2, label: 'Active', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
    warning: { icon: AlertTriangle, label: 'Warning', tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
    'at-risk': { icon: XCircle, label: 'At risk', tone: 'bg-rose-50 text-rose-700 ring-rose-200' }
  }[status] || { icon: AlertTriangle, label: 'Review', tone: 'bg-slate-50 text-slate-600 ring-slate-200' }
  const Icon = config.icon
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase ring-1 ${config.tone}`}><Icon className="h-3.5 w-3.5" />{config.label}</span>
}

function Sparkline({ values = [] }) {
  const numbers = values.map((item) => Number(item.conversionRate) || 0)
  if (!numbers.length) return <span className="text-[10px] font-bold text-slate-400">No trend yet</span>
  const max = Math.max(100, ...numbers)
  const denominator = Math.max(1, numbers.length - 1)
  const points = numbers.map((value, index) => `${(index / denominator) * 110},${30 - ((value / max) * 26)}`).join(' ')
  return <svg viewBox="0 0 110 32" className="h-8 w-28" role="img" aria-label="Manager conversion trend"><path d="M0 30 H110" stroke="#d1fae5" /><polyline points={points} fill="none" stroke="#10B981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function SortButton({ label, field, sort, setSort, right = false }) {
  function toggle() {
    setSort((current) => ({ field, direction: current.field === field && current.direction === 'desc' ? 'asc' : 'desc' }))
  }
  return <th className={`whitespace-nowrap px-4 py-3 ${right ? 'text-right' : 'text-left'}`}><button type="button" onClick={toggle} className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-500 hover:text-emerald-700">{label}<ArrowUpDown className={`h-3.5 w-3.5 ${sort.field === field ? 'text-emerald-600' : 'text-slate-300'}`} /></button></th>
}

function ManagerDetailsModal({ manager, filters, onClose }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  useEffect(() => {
    let active = true
    setLoading(true)
    api.get(API_ENDPOINTS.salesMis.managementDashboard, { params: { ...filters, managerId: manager.leadOwnerId || manager.managerId, includeLeadDetails: true } })
      .then((result) => { if (active) setRows(result.data?.leadDetails || []) })
      .catch((requestError) => { if (active) setError(requestError?.response?.data?.error || 'Unable to load lead-owner details.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [filters, manager.leadOwnerId, manager.managerId])
  return <div className="fixed inset-0 z-[170] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section role="dialog" aria-modal="true" aria-labelledby="manager-detail-title" className="max-h-[88vh] w-full max-w-6xl overflow-hidden rounded-3xl bg-white shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-emerald-100 bg-emerald-50 px-6 py-5"><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-700">Lead-owner drill-down</p><h2 id="manager-detail-title" className="mt-1 text-2xl font-black text-slate-950">{manager.leadOwnerName || manager.managerName}</h2><p className="mt-1 text-sm font-bold text-slate-500">{manager.department} | Reports to {manager.reportingManagerName || '-'} | {manager.totalLeads} leads | {money(manager.confirmedRevenue)} approved PO value</p><p className="mt-1 text-xs font-bold text-slate-500">Lead split: {manager.oldLeads || 0} old + {manager.newLeads || 0} new | PO split: {money(manager.oldBusinessPoValue)} old + {money(manager.newBusinessPoValue)} new</p></div><button type="button" onClick={onClose} aria-label="Close lead-owner details" className="grid h-10 w-10 place-items-center rounded-xl bg-white text-slate-500 shadow-sm"><X className="h-5 w-5" /></button></header>
      <div className="max-h-[68vh] overflow-auto">
        {loading && <div className="p-12 text-center font-black text-slate-500">Loading lead details…</div>}
        {error && <div className="m-6 rounded-2xl bg-rose-50 p-4 font-bold text-rose-700">{error}</div>}
        {!loading && !error && <table className="w-full min-w-[1350px] text-sm"><thead className="sticky top-0 bg-slate-50 text-left text-[10px] font-black uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Lead</th><th className="px-5 py-3">Company</th><th className="px-5 py-3">Owner</th><th className="px-5 py-3">Stage</th><th className="px-5 py-3">Business</th><th className="px-5 py-3 text-right">Approved Quotes</th><th className="px-5 py-3 text-right">Closed Services</th><th className="px-5 py-3 text-right">Old PO Value</th><th className="px-5 py-3 text-right">New Quote Value</th><th className="px-5 py-3 text-right">New PO Value</th><th className="px-5 py-3 text-right">Total PO Value</th></tr></thead><tbody>{rows.map((row) => <tr key={row.leadId} className="border-t border-slate-100 hover:bg-emerald-50/50"><td className="px-5 py-3"><button type="button" onClick={() => navigate('/sales/lead-generation')} className="font-black text-emerald-700 hover:underline">{row.leadCode || 'Open lead'}</button></td><td className="px-5 py-3 font-bold text-slate-900">{row.company || '-'}</td><td className="px-5 py-3 text-slate-600">{row.ownerName || '-'}</td><td className="px-5 py-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-600">{String(row.pipelineStage || 'open').replace(/([A-Z])/g, ' $1')}</span></td><td className="px-5 py-3 font-black text-slate-700">{row.oldBusinessLead && row.newBusinessLead ? 'Mixed' : row.newBusinessLead ? 'New' : row.oldBusinessLead ? 'Old' : '-'}</td><td className="px-5 py-3 text-right font-black">{row.approvedQuotationCount || 0}</td><td className="px-5 py-3 text-right font-black">{row.convertedServiceCount || 0}</td><td className="px-5 py-3 text-right font-black text-amber-700">{money(row.oldBusinessPoValue)}</td><td className="px-5 py-3 text-right font-black text-violet-700">{money(row.newBusinessQuotationValue)}</td><td className="px-5 py-3 text-right font-black text-sky-700">{money(row.newBusinessPoValue)}</td><td className="px-5 py-3 text-right font-black text-emerald-700">{money(row.confirmedRevenue)}</td></tr>)}</tbody></table>}
        {!loading && !error && !rows.length && <div className="p-12 text-center font-black text-slate-400">No leads found for this owner and period.</div>}
      </div>
    </section>
  </div>
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return <div className="rounded-2xl border border-slate-200 bg-white/95 p-3 text-xs shadow-xl backdrop-blur"><p className="mb-2 font-black text-slate-900">{label}</p>{payload.map((item) => <p key={item.dataKey} className="mt-1 flex items-center justify-between gap-6 font-bold" style={{ color: item.color }}><span>{item.name}</span><strong>{item.dataKey === 'conversionRate' ? percent(item.value) : item.value}</strong></p>)}</div>
}

function CarryForwardTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload || {}
  const available = Number(row.totalAvailable) || 0
  const closureRate = available ? ((Number(row.closedThisMonth) || 0) / available) * 100 : 0
  const items = [
    ['Opening Pending', row.openingPending, '#F59E0B'], ['New Leads', row.newLeads, '#0EA5E9'],
    ['Total Available', row.totalAvailable, '#475569'], ['Closed From Opening', row.closedFromOpening, '#047857'],
    ['Closed From New', row.closedFromNew, '#65C47B'], ['Total Closed', row.closedThisMonth, '#059669'],
    ['Closing Pending', row.closingPending, '#EF4444'], ['Closure Rate', `${closureRate.toFixed(1)}%`, '#475569']
  ]
  return <div className="min-w-56 rounded-2xl border border-slate-200 bg-white/95 p-4 text-xs shadow-xl backdrop-blur"><p className="mb-2 font-black text-slate-950">{monthLabel(label)}</p>{items.map(([name, value, color], index) => <div key={name} className={`flex items-center justify-between gap-5 py-1 font-bold ${[2, 5].includes(index) ? 'mt-1 border-t border-slate-100 pt-2' : ''}`}><span className="flex items-center gap-2 text-slate-600"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />{name}</span><strong className="text-slate-950">{value ?? 0}</strong></div>)}</div>
}

function OperationsMis({ report }) {
  const groups = useMemo(() => buildOperationGroups(report.users || [], report.misAccess?.operationTeams || []), [report])
  const totals = useMemo(() => ({
    clients: sumRows(groups, 'clientMasters'), drafts: sumRows(groups, 'draftClients'),
    submitted: sumRows(groups, 'submittedClients'), approved: sumRows(groups, 'approvedClients'),
    partial: sumRows(groups, 'partiallyApprovedClients'), pending: sumRows(groups, 'pendingClients')
  }), [groups])
  return <>
    <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Client Masters" value={totals.clients} note="Handled by operation teams" icon={Users} tone="blue" />
      <KpiCard label="Submitted" value={totals.submitted} note={`${totals.drafts} drafts in progress`} icon={FileText} tone="violet" />
      <KpiCard label="Approved" value={totals.approved} note={`${totals.partial} partially approved`} icon={CheckCircle2} tone="emerald" />
      <KpiCard label="Pending Review" value={totals.pending} note="Awaiting workflow action" icon={AlertTriangle} tone="amber" />
    </section>
    <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm max-sm:hidden">
      <div className="border-b border-slate-100 px-5 py-4"><p className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-700">Operations MIS</p><h2 className="mt-1 text-xl font-black text-slate-950">Operation Team Performance</h2><p className="mt-1 text-xs font-bold text-slate-500">Client-master progress, approval pipeline and data completion by team.</p></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm"><thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3 text-left">Team / Manager</th><th className="px-5 py-3 text-right">Members</th><th className="px-5 py-3 text-right">Client Masters</th><th className="px-5 py-3 text-right">Draft</th><th className="px-5 py-3 text-right">Submitted</th><th className="px-5 py-3 text-right">Pending</th><th className="px-5 py-3 text-right">Approved</th><th className="px-5 py-3 text-right">Partial</th><th className="px-5 py-3 text-right">Rejected</th><th className="px-5 py-3 text-right">Completion</th></tr></thead><tbody>{groups.map((group) => <React.Fragment key={group.id}><tr className="border-t-2 border-emerald-200 bg-emerald-50 font-black text-slate-800"><td className="px-5 py-3"><strong className="block text-emerald-900">{group.name}</strong><small className="text-emerald-700">Manager: {group.manager?.name || 'Not assigned'}</small></td><td className="px-5 py-3 text-right">{group.people.length}</td><td className="px-5 py-3 text-right">{group.clientMasters}</td><td className="px-5 py-3 text-right">{group.draftClients}</td><td className="px-5 py-3 text-right">{group.submittedClients}</td><td className="px-5 py-3 text-right text-amber-700">{group.pendingClients}</td><td className="px-5 py-3 text-right text-emerald-700">{group.approvedClients}</td><td className="px-5 py-3 text-right">{group.partiallyApprovedClients}</td><td className="px-5 py-3 text-right text-rose-700">{group.rejectedClients}</td><td className="px-5 py-3 text-right text-emerald-700">{group.percentage}%</td></tr>{group.people.map((person) => <tr key={entityId(person.id)} className="border-t border-slate-100 font-semibold text-slate-600 hover:bg-slate-50"><td className="px-5 py-3 pl-9"><strong className="block text-slate-900">{person.name || person.email}</strong><small>{person.roleLabel || person.role}</small></td><td className="px-5 py-3 text-right">-</td><td className="px-5 py-3 text-right">{person.clientMasters || 0}</td><td className="px-5 py-3 text-right">{person.draftClients || 0}</td><td className="px-5 py-3 text-right">{person.submittedClients || 0}</td><td className="px-5 py-3 text-right">{person.pendingClients || 0}</td><td className="px-5 py-3 text-right">{person.approvedClients || 0}</td><td className="px-5 py-3 text-right">{person.partiallyApprovedClients || 0}</td><td className="px-5 py-3 text-right">{person.rejectedClients || 0}</td><td className="px-5 py-3 text-right font-black">{person.clientCompletionPercentage || 0}%</td></tr>)}</React.Fragment>)}</tbody></table>{!groups.length && <div className="p-10 text-center font-black text-slate-400">No operations data for this period.</div>}</div>
    </section>
  </>
}

function QuotationMis({ quotations, filters, onError }) {
  const [exporting, setExporting] = useState(false)
  const rows = useMemo(() => [...quotations].sort((a, b) => new Date(b.quotationDate || b.createdAt || 0) - new Date(a.quotationDate || a.createdAt || 0)), [quotations])
  const approved = rows.filter((row) => String(row.status || '').toLowerCase() === 'approved')
  const open = rows.filter((row) => ['draft', 'submitted', 'sent'].includes(String(row.status || '').toLowerCase()))
  const rejected = rows.filter((row) => String(row.status || '').toLowerCase() === 'rejected')
  return <>
    <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="Total Quotations" value={rows.length} note="Visible quotations" icon={FileText} tone="blue" /><KpiCard label="Approved Quotations" value={approved.length} note={money(sumRows(approved, 'grandTotal'), true)} icon={CheckCircle2} tone="emerald" /><KpiCard label="Open Quotations" value={open.length} note="Draft, submitted or sent" icon={TrendingUp} tone="violet" /><KpiCard label="Rejected Quotations" value={rejected.length} note={money(sumRows(rejected, 'grandTotal'), true)} icon={XCircle} tone="amber" /></section>
    <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm max-sm:hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-700">Quotation MIS</p><h2 className="mt-1 text-xl font-black text-slate-950">Quotation Pipeline</h2><p className="mt-1 text-xs font-bold text-slate-500">Showing quotations dated {filters.dateFrom} to {filters.dateTo}</p></div><button type="button" disabled={exporting} onClick={async () => { setExporting(true); try { await exportQuotationMisPdf(rows, filters) } catch (error) { onError(error?.message || 'Unable to download quotation PDF.') } finally { setExporting(false) } }} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-black text-white disabled:opacity-60"><FileText className="h-4 w-4" />{exporting ? 'Preparing PDF...' : 'Download PDF'}</button></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3 text-left">Quotation</th><th className="px-5 py-3 text-left">Company</th><th className="px-5 py-3 text-left">Prepared By</th><th className="px-5 py-3 text-left">Status</th><th className="px-5 py-3 text-left">Date</th><th className="px-5 py-3 text-right">Quote Value</th></tr></thead><tbody>{rows.map((row, index) => <tr key={entityId(row._id || row.id) || index} className="border-t border-slate-100 font-semibold text-slate-700 hover:bg-emerald-50/50"><td className="px-5 py-3 font-black text-emerald-700">{row.quotationNumber || '-'}</td><td className="px-5 py-3 font-black text-slate-900">{row.companyName || row.leadDetails?.companyName || '-'}</td><td className="px-5 py-3">{row.preparedBy || row.createdByName || '-'}</td><td className="px-5 py-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase">{row.status || 'draft'}</span></td><td className="px-5 py-3">{row.quotationDate || row.createdAt ? new Date(row.quotationDate || row.createdAt).toLocaleDateString('en-IN') : '-'}</td><td className="px-5 py-3 text-right font-black">{money(row.grandTotal)}</td></tr>)}</tbody></table>{!rows.length && <div className="p-10 text-center font-black text-slate-400">No quotations found.</div>}</div></section>
  </>
}

function CompleteOverview({ sales, operations, quotations }) {
  const groups = buildOperationGroups(operations.users || [], operations.misAccess?.operationTeams || [])
  const completed = sumRows(groups, 'approvedClients')
  const totalClients = sumRows(groups, 'clientMasters')
  const approvedQuotes = quotations.filter((row) => String(row.status || '').toLowerCase() === 'approved')
  return <><section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><KpiCard label="Sales Leads" value={sales.summary?.totalLeads || 0} note={`${percent(sales.summary?.conversionRate)} PO conversion`} icon={Users} tone="blue" /><KpiCard label="Approved PO Value" value={money(sales.summary?.confirmedRevenue, true)} note="Attributed to permanent lead owners" icon={BadgeIndianRupee} tone="emerald" /><KpiCard label="Operation Clients" value={totalClients} note={`${completed} approved`} icon={Target} tone="violet" /><KpiCard label="Operation Teams" value={groups.length} note="Team performance available" icon={BarChart3} tone="amber" /><KpiCard label="Quotations" value={quotations.length} note={`${approvedQuotes.length} approved`} icon={FileText} tone="blue" /><KpiCard label="Approved Quote Value" value={money(sumRows(approvedQuotes, 'grandTotal'), true)} note="Pipeline value, separate from PO" icon={TrendingUp} tone="emerald" /></section><section className="mt-6 grid gap-5 lg:grid-cols-2"><article className="rounded-3xl border border-slate-200 bg-white p-5"><h2 className="text-xl font-black">Top Lead Owners</h2><div className="mt-4 space-y-2">{(sales.insights?.topManagers || []).map((owner, index) => <div key={owner.managerId} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"><span className="font-black">{index + 1}. {owner.leadOwnerName || owner.managerName}</span><span className="font-black text-emerald-700">{money(owner.confirmedRevenue)} | {percent(owner.conversionRate)}</span></div>)}</div></article><article className="rounded-3xl border border-slate-200 bg-white p-5"><h2 className="text-xl font-black">Operation Teams</h2><div className="mt-4 space-y-2">{groups.map((group) => <div key={group.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"><span><strong className="block">{group.name}</strong><small className="font-bold text-slate-500">{group.people.length} members</small></span><span className="font-black text-emerald-700">{group.percentage}% complete</span></div>)}</div></article></section></>
}

export default function SalesManagementDashboard() {
  const navigate = useNavigate()
  const [currentUser] = useState(() => { try { return JSON.parse(localStorage.getItem('user') || 'null') } catch { return null } })
  const [filters, setFilters] = useState(initialRange)
  const [draftFilters, setDraftFilters] = useState(initialRange)
  const [data, setData] = useState(EMPTY_DATA)
  const [operations, setOperations] = useState(EMPTY_OPERATIONS)
  const [quotations, setQuotations] = useState([])
  const [activeTab, setActiveTab] = useState('sales')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [sort, setSort] = useState({ field: 'conversionRate', direction: 'desc' })
  const [selectedManager, setSelectedManager] = useState(null)
  const [exporting, setExporting] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)

  async function load({ quiet = false } = {}) {
    quiet ? setRefreshing(true) : setLoading(true)
    setError('')
    try {
      void Promise.allSettled([
        api.get(API_ENDPOINTS.auth.userProductivityReport, { params: { from: filters.dateFrom, to: filters.dateTo }, timeout: 60000 }),
        api.get(API_ENDPOINTS.quotations.list, { timeout: 60000 })
      ]).then(([operationResult, quotationResult]) => {
        if (operationResult.status === 'fulfilled') setOperations(operationResult.value.data || operationResult.value || EMPTY_OPERATIONS)
        if (quotationResult.status === 'fulfilled') setQuotations(quotationResult.value.data?.quotations || [])
      })
      const salesResult = await api.get(API_ENDPOINTS.salesMis.managementDashboard, { params: filters, timeout: 60000 })
      setData(salesResult.data || EMPTY_DATA)
      setLastUpdated(new Date())
    } catch (requestError) {
      setError(requestError?.response?.data?.error || 'Unable to load the sales management dashboard.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { load() }, [filters])
  useCrmRefresh(() => load({ quiet: true }))

  const managers = useMemo(() => [...(data.managerPerformance || [])].sort((left, right) => {
    const delta = (Number(left[sort.field]) || 0) - (Number(right[sort.field]) || 0)
    return (sort.direction === 'asc' ? delta : -delta) || left.managerName.localeCompare(right.managerName)
  }), [data.managerPerformance, sort])
  const filteredQuotations = useMemo(() => {
    const start = new Date(`${filters.dateFrom}T00:00:00`).getTime()
    const end = new Date(`${filters.dateTo}T23:59:59.999`).getTime()
    return quotations.filter((row) => {
      const timestamp = new Date(row.quotationDate || row.createdAt || 0).getTime()
      return Number.isFinite(timestamp) && timestamp >= start && timestamp <= end
    })
  }, [filters.dateFrom, filters.dateTo, quotations])
  const carryForwardChart = useMemo(() => (data.monthlyCarryForward || []).slice(-12), [data.monthlyCarryForward])
  const latestCarryForward = carryForwardChart[carryForwardChart.length - 1] || {}
  const latestAvailable = Number(latestCarryForward.totalAvailable) || 0
  const latestClosureRate = latestAvailable ? ((Number(latestCarryForward.closedThisMonth) || 0) / latestAvailable) * 100 : 0
  const latestPendingRate = latestAvailable ? ((Number(latestCarryForward.closingPending) || 0) / latestAvailable) * 100 : 0
  const previousCarryForward = carryForwardChart[carryForwardChart.length - 2] || {}
  const availableChange = (Number(latestCarryForward.totalAvailable) || 0) - (Number(previousCarryForward.totalAvailable) || 0)

  function applyFilters(event) {
    event.preventDefault()
    if (draftFilters.dateFrom > draftFilters.dateTo) return setError('From date cannot be after To date.')
    setFilters({ ...draftFilters })
  }

  function applyPreset(preset) {
    const range = presetRange(preset)
    setDraftFilters((current) => ({ ...current, ...range }))
    setFilters((current) => ({ ...current, ...range }))
  }

  async function exportReport(type) {
    setExporting(type)
    setError('')
    try {
      if (type === 'excel') await exportSalesManagementExcel(data)
      else await exportSalesManagementPdf(data)
    } catch (exportError) {
      setError(exportError?.message || `Unable to export ${type}.`)
    } finally { setExporting('') }
  }

  const previous = data.summary?.previousPeriod || {}
  return <DashboardShell currentUser={currentUser}>
    <div className="w-full p-4 sm:p-5 lg:p-6">
      <header className="overflow-hidden rounded-[28px] bg-gradient-to-br from-[#075848] via-[#087A70] to-[#0f766e] p-5 text-white shadow-xl shadow-emerald-950/15 sm:p-7">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[.24em] text-emerald-100">Management intelligence</p><h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Management Information System</h1><p className="mt-2 max-w-2xl text-sm font-semibold text-emerald-50/80">Sales ownership, approved PO revenue, operations delivery and quotation pipeline in one workspace.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => navigate('/mis/complete')} className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-black hover:bg-white/15"><BarChart3 className="h-4 w-4" />Legacy MIS</button><button type="button" onClick={() => load({ quiet: true })} disabled={refreshing} className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-black hover:bg-white/15 disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />Refresh</button>{['sales', 'overview'].includes(activeTab) && <><button type="button" onClick={() => exportReport('excel')} disabled={Boolean(exporting)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-black text-emerald-800 disabled:opacity-60"><FileSpreadsheet className="h-4 w-4" />Sales Excel</button><button type="button" onClick={() => exportReport('pdf')} disabled={Boolean(exporting)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#f59e0b] px-4 text-sm font-black text-amber-950 disabled:opacity-60"><FileText className="h-4 w-4" />Sales PDF</button></>}</div></div>
        <form onSubmit={applyFilters} className="mt-6 grid gap-3 rounded-2xl border border-white/15 bg-white/10 p-3 backdrop-blur md:grid-cols-[auto_auto_minmax(170px,1fr)_auto]"><label className="text-xs font-black text-emerald-50"><span className="mb-1.5 block">From</span><input type="date" value={draftFilters.dateFrom} onChange={(event) => setDraftFilters((current) => ({ ...current, dateFrom: event.target.value }))} className="h-11 w-full rounded-xl border border-white/20 bg-white px-3 font-bold text-slate-900" /></label><label className="text-xs font-black text-emerald-50"><span className="mb-1.5 block">To</span><input type="date" value={draftFilters.dateTo} onChange={(event) => setDraftFilters((current) => ({ ...current, dateTo: event.target.value }))} className="h-11 w-full rounded-xl border border-white/20 bg-white px-3 font-bold text-slate-900" /></label><label className="text-xs font-black text-emerald-50"><span className="mb-1.5 block">Department</span><select value={draftFilters.department} onChange={(event) => setDraftFilters((current) => ({ ...current, department: event.target.value }))} className="h-11 w-full rounded-xl border border-white/20 bg-white px-3 font-bold text-slate-900"><option value="">All departments</option>{(data.meta?.departments || []).map((department) => <option key={department}>{department}</option>)}</select></label><button type="submit" className="mt-auto h-11 rounded-xl bg-emerald-950 px-5 text-sm font-black text-white">Apply filters</button></form>
        <div className="mt-3 flex flex-wrap items-center gap-2"><span className="mr-1 inline-flex items-center gap-1 text-xs font-bold text-emerald-100"><CalendarDays className="h-4 w-4" />Quick range</span>{[['all-time','All CRM Data'],['six-months','6 Months'],['monthly','Monthly'],['quarterly','Quarterly'],['yearly','Yearly']].map(([value,label]) => <button key={value} type="button" onClick={() => applyPreset(value)} className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-black text-white hover:bg-white/10">{label}</button>)}<span className="ml-auto text-[10px] font-bold text-emerald-100">{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'Auto-refreshes every 5 minutes'}</span></div>
      </header>

      <nav aria-label="MIS sections" className="mt-5 flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">{[['sales', 'Sales MIS'], ['operations', 'Operations MIS'], ['quotations', 'Quotation MIS'], ['overview', 'Complete Overview']].map(([value, label]) => <button key={value} type="button" onClick={() => setActiveTab(value)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black transition ${activeTab === value ? 'bg-emerald-700 text-white shadow-sm' : 'text-slate-600 hover:bg-emerald-50 hover:text-emerald-800'}`}>{label}</button>)}</nav>

      {error && <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 font-bold text-rose-700">{error}</div>}
      {loading ? <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-40 animate-pulse rounded-3xl bg-white" />)}</div> : <>
        {activeTab === 'sales' && <>
        <section aria-label="Sales summary" className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Total Leads" value={data.summary.totalLeads || 0} note="Created in selected period" change={previous.totalLeadsChangePct} icon={Users} tone="blue" />
          <KpiCard label="Conversion Rate" value={percent(data.summary.conversionRate)} note={`${data.summary.convertedLeads || 0} leads with approved PO`} change={previous.conversionRateChange} icon={TrendingUp} tone="emerald" />
          <KpiCard label="Confirmed PO Revenue" value={money(data.summary.confirmedRevenue, true)} note={`${money(data.summary.approvedQuotationValue, true)} approved quote value`} change={previous.revenueChangePct} icon={BadgeIndianRupee} tone="violet" />
          <KpiCard label="Closed Service Deals" value={data.summary.closedDeals || 0} note={`${data.summary.approvedQuotations || 0} approved quotations`} icon={Target} tone="amber" />
          <KpiCard label="Old Business Leads" value={data.summary.oldBusinessLeads || 0} note="CRM quotation value is zero" icon={Users} tone="amber" />
          <KpiCard label="Old PO Value" value={money(data.summary.oldBusinessPoValue, true)} note="PO value without CRM quotation value" icon={BadgeIndianRupee} tone="amber" />
          <KpiCard label="New Business Leads" value={data.summary.newBusinessLeads || 0} note="CRM quotation and PO both have value" icon={Users} tone="emerald" />
          <KpiCard label="New Quotation Value" value={money(data.summary.newBusinessQuotationValue, true)} note="Quotation value captured at closure" icon={FileText} tone="violet" />
          <KpiCard label="New PO Value" value={money(data.summary.newBusinessPoValue, true)} note="Confirmed PO value from new business" icon={BadgeIndianRupee} tone="blue" />
        </section>

        <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm max-sm:hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-700">Section 2</p><h2 className="mt-1 text-xl font-black text-slate-950">Lead Owner Sales Performance</h2><p className="mt-1 text-xs font-bold text-slate-500">Leads created from {data.meta?.dateFrom} to {data.meta?.dateTo}. Use All CRM Data for each owner's complete count.</p><p className="mt-1 text-xs font-bold text-emerald-700">PO value stays with the permanent lead owner; reporting manager is shown separately.</p></div><span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600">{managers.length} owners</span></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[1950px] text-sm"><thead className="bg-slate-50"><tr><th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider text-slate-500">Lead Owner</th><th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider text-slate-500">Reporting Manager</th><th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider text-slate-500">Role / Department</th><SortButton label="Total Leads" field="totalLeads" sort={sort} setSort={setSort} right /><th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-wider text-slate-500">Open Quotations</th><th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-wider text-slate-500">Approved Quotes</th><th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-wider text-slate-500">Approved Quote Value</th><th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-wider text-slate-500">Converted</th><SortButton label="Conversion" field="conversionRate" sort={sort} setSort={setSort} right /><SortButton label="Old Leads" field="oldLeads" sort={sort} setSort={setSort} right /><SortButton label="Old PO Value" field="oldBusinessPoValue" sort={sort} setSort={setSort} right /><SortButton label="New Leads" field="newLeads" sort={sort} setSort={setSort} right /><SortButton label="New Quote Value" field="newBusinessQuotationValue" sort={sort} setSort={setSort} right /><SortButton label="New PO Value" field="newBusinessPoValue" sort={sort} setSort={setSort} right /><SortButton label="Total PO Value" field="confirmedRevenue" sort={sort} setSort={setSort} right /><th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider text-slate-500">Status</th><th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider text-slate-500">Trend</th></tr></thead><tbody>{managers.map((manager) => <tr key={manager.leadOwnerId || manager.managerId || manager.managerName} onClick={() => setSelectedManager(manager)} className="group cursor-pointer border-t border-slate-100 font-semibold text-slate-700 hover:bg-emerald-50/60"><td className="px-4 py-3"><button type="button" className="text-left font-black text-slate-950 group-hover:text-emerald-700">{manager.leadOwnerName || manager.managerName}</button></td><td className="px-4 py-3 text-xs font-bold text-slate-600">{manager.reportingManagerName || '-'}</td><td className="px-4 py-3"><strong className="block text-xs text-slate-700">{manager.role}</strong><span className="text-[11px] text-slate-500">{manager.department}</span></td><td className="px-4 py-3 text-right font-black">{manager.totalLeads}</td><td className="px-4 py-3 text-right">{manager.openQuotations}</td><td className="px-4 py-3 text-right">{manager.approvedQuotations}</td><td className="px-4 py-3 text-right font-black text-violet-700">{money(manager.approvedQuotationValue)}</td><td className="px-4 py-3 text-right font-black text-emerald-700">{manager.convertedToSale}</td><td className="px-4 py-3 text-right font-black">{percent(manager.conversionRate)}</td><td className="px-4 py-3 text-right font-black text-amber-700">{manager.oldLeads}</td><td className="px-4 py-3 text-right font-black text-amber-700">{money(manager.oldBusinessPoValue)}</td><td className="px-4 py-3 text-right font-black text-sky-700">{manager.newLeads}</td><td className="px-4 py-3 text-right font-black text-violet-700">{money(manager.newBusinessQuotationValue)}</td><td className="px-4 py-3 text-right font-black text-sky-700">{money(manager.newBusinessPoValue)}</td><td className="px-4 py-3 text-right font-black text-emerald-700">{money(manager.confirmedRevenue)}</td><td className="px-4 py-3"><StatusBadge status={manager.status} /></td><td className="px-4 py-2"><Sparkline values={manager.monthlyTrend} /></td></tr>)}</tbody></table>{!managers.length && <div className="p-10 text-center font-black text-slate-400">No lead-owner performance data for this period.</div>}</div>
        </section>

        <section className="mt-6 hidden overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm sm:block">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-5 py-4"><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-700">{filters.interval === 'weekly' ? 'Weekly' : 'Monthly'} movement</p><h2 className="mt-1 text-xl font-black text-slate-950">Lead Carry-Forward</h2><p className="mt-1 text-xs font-bold text-slate-500">Opening pending is kept separate from new leads. Closing pending becomes the next {filters.interval === 'weekly' ? 'week' : 'month'}'s opening balance.</p>{data.meta?.legacyBulkCutoff && <p className="mt-1 text-xs font-black text-amber-700">Historical bulk uploads through {data.meta.legacyBulkCutoff} are classified as old leads in the opening backlog.</p>}</div><div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1" aria-label="Carry-forward interval">{[['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([value, label]) => <button key={value} type="button" aria-pressed={filters.interval === value} onClick={() => { setDraftFilters((current) => ({ ...current, interval: value })); setFilters((current) => ({ ...current, interval: value })) }} className={`rounded-lg px-4 py-2 text-xs font-black transition ${filters.interval === value ? 'bg-emerald-700 text-white shadow-sm' : 'text-slate-600 hover:bg-white'}`}>{label}</button>)}</div></div>
          <div className="border-b border-slate-100 p-5"><div className="h-[380px]"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={carryForwardChart} margin={{ top: 28, right: 25, left: 5, bottom: 12 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} /><XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 11, fontWeight: 700 }} label={{ value: 'Month', position: 'insideBottom', offset: -8, fontSize: 11, fontWeight: 700 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} label={{ value: 'Number of Leads', angle: -90, position: 'insideLeft', offset: 0, fontSize: 11, fontWeight: 700 }} /><Tooltip content={<CarryForwardTooltip />} /><Legend wrapperStyle={{ fontSize: 11, fontWeight: 700, paddingTop: 14 }} /><Bar dataKey="openingPending" name="Opening Pending" stackId="available" fill="#F59E0B"><LabelList dataKey="openingPending" position="center" fill="#fff" fontSize={11} fontWeight={800} formatter={(value) => value || ''} /></Bar><Bar dataKey="newLeads" name="New Leads" stackId="available" fill="#0EA5E9" radius={[4, 4, 0, 0]}><LabelList dataKey="newLeads" position="center" fill="#fff" fontSize={11} fontWeight={800} formatter={(value) => value || ''} /></Bar><Line type="monotone" dataKey="closedThisMonth" name="Total Closed" stroke="#059669" strokeWidth={3} dot={{ r: 4, fill: '#059669' }}><LabelList dataKey="closedThisMonth" position="top" fill="#047857" fontSize={10} fontWeight={800} /></Line><Line type="monotone" dataKey="closingPending" name="Closing Pending" stroke="#EF4444" strokeWidth={3} dot={{ r: 4, fill: '#EF4444' }}><LabelList dataKey="closingPending" position="top" fill="#DC2626" fontSize={10} fontWeight={800} /></Line></ComposedChart></ResponsiveContainer></div><div className="mt-3 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-xs font-bold leading-5 text-sky-900"><strong>Key insight:</strong> Total available leads {availableChange >= 0 ? 'increased' : 'decreased'} by {Math.abs(availableChange)} from {monthLabel(previousCarryForward.month)} to {monthLabel(latestCarryForward.month)}. The latest closure rate is {percent(latestClosureRate)}, with {latestCarryForward.closingPending || 0} leads carried forward.</div></div>
          <div className="grid gap-5 border-b border-slate-100 p-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,.6fr)]"><article className="rounded-2xl border border-slate-200 p-4"><h3 className="font-black text-slate-950">Lead Closure Breakdown</h3><p className="mt-1 text-xs font-bold text-slate-500">{filters.interval === 'weekly' ? 'Weekly' : 'Monthly'} closures split between carried-forward and newly generated leads.</p><div className="mt-3 h-[260px]"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={carryForwardChart} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} /><XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 10, fontWeight: 700 }} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip content={<ChartTooltip />} /><Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} /><Bar dataKey="closedFromOpening" name="Closed From Opening" stackId="closures" fill="#3B82F6" /><Bar dataKey="closedFromNew" name="Closed From New" stackId="closures" fill="#65C47B" radius={[5, 5, 0, 0]} /></ComposedChart></ResponsiveContainer></div></article><article className="rounded-2xl border border-slate-200 p-4"><h3 className="font-black text-slate-950">Lead Status</h3><p className="mt-1 text-xs font-bold text-slate-500">{monthLabel(latestCarryForward.month)} available workload</p><div className="mt-5 h-[190px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{ name: 'Closed', value: Number(latestCarryForward.closedThisMonth) || 0 }, { name: 'Pending', value: Number(latestCarryForward.closingPending) || 0 }]} dataKey="value" nameKey="name" innerRadius={55} outerRadius={78} startAngle={90} endAngle={-270}><Cell fill="#10B981" /><Cell fill="#F59E0B" /></Pie><Tooltip formatter={(value, name) => [value, name]} /><Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} /></PieChart></ResponsiveContainer></div><div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-emerald-50 p-3 text-center"><p className="text-[10px] font-black uppercase text-emerald-700">Closure Rate</p><strong className="mt-1 block text-xl text-emerald-800">{percent(latestClosureRate)}</strong></div><div className="rounded-xl bg-amber-50 p-3 text-center"><p className="text-[10px] font-black uppercase text-amber-700">Pending Rate</p><strong className="mt-1 block text-xl text-amber-800">{percent(latestPendingRate)}</strong></div></div></article></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm"><thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3 text-left">{filters.interval === 'weekly' ? 'Week' : 'Month'}</th><th className="px-5 py-3 text-right">Opening Pending</th><th className="px-5 py-3 text-right">New Leads</th><th className="px-5 py-3 text-right">Total Available</th><th className="px-5 py-3 text-right">Closed From Opening</th><th className="px-5 py-3 text-right">Closed From New</th><th className="px-5 py-3 text-right">Total Closed</th><th className="px-5 py-3 text-right">Closing Pending</th></tr></thead><tbody>{(data.monthlyCarryForward || []).map((row) => <tr key={row.month} className="border-t border-slate-100 font-semibold text-slate-700"><td className="px-5 py-3 font-black text-slate-950">{monthLabel(row.month)}</td><td className="px-5 py-3 text-right text-amber-700">{row.openingPending}</td><td className="px-5 py-3 text-right text-sky-700">{row.newLeads}</td><td className="px-5 py-3 text-right font-black">{row.totalAvailable}</td><td className="px-5 py-3 text-right">{row.closedFromOpening}</td><td className="px-5 py-3 text-right">{row.closedFromNew}</td><td className="px-5 py-3 text-right font-black text-emerald-700">{row.closedThisMonth}</td><td className="px-5 py-3 text-right font-black text-amber-700">{row.closingPending}</td></tr>)}</tbody></table>{!data.monthlyCarryForward?.length && <div className="p-10 text-center font-black text-slate-400">No {filters.interval} movement data for this period.</div>}</div>
        </section>

        <section className="mt-6 hidden gap-6 lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(360px,.65fr)] sm:grid">
          <article className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-700">Section 3</p><h2 className="mt-1 text-xl font-black text-slate-950">{filters.interval === 'weekly' ? 'Weekly' : 'Monthly'} Pipeline Trend</h2><p className="mt-1 text-xs font-bold text-slate-500">Current stage of leads created in each {filters.interval === 'weekly' ? 'week' : 'month'} · conversion rate overlay</p></div><div className="mt-5 h-[370px]"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data.monthlyTrend || []} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} /><XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 11, fontWeight: 700 }} /><YAxis yAxisId="count" tick={{ fontSize: 11 }} allowDecimals={false} /><YAxis yAxisId="rate" orientation="right" domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 11 }} /><Tooltip content={<ChartTooltip />} /><Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} /><Bar yAxisId="count" dataKey="open" name="Open" stackId="pipeline" fill="#94A3B8" /><Bar yAxisId="count" dataKey="quotationOpen" name="Quotation Open" stackId="pipeline" fill="#0EA5E9" /><Bar yAxisId="count" dataKey="quotationApproved" name="Quote Approved" stackId="pipeline" fill="#8B5CF6" /><Bar yAxisId="count" dataKey="converted" name="Converted / Closed" stackId="pipeline" fill="#10B981" /><Bar yAxisId="count" dataKey="quotationClosed" name="Quote Closed" stackId="pipeline" fill="#EF4444" radius={[4, 4, 0, 0]} /><Line yAxisId="rate" type="monotone" dataKey="conversionRate" name="Conversion Rate" stroke="#F59E0B" strokeWidth={3} dot={{ r: 3, fill: '#F59E0B' }} /></ComposedChart></ResponsiveContainer></div></article>
          <article className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-700">Section 4</p><h2 className="mt-1 text-xl font-black text-slate-950">Lead Distribution</h2><p className="mt-1 text-xs font-bold text-slate-500">Click a department to filter the dashboard</p></div><div className="mt-3 h-[270px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data.departmentBreakdown || []} dataKey="leadCount" nameKey="department" innerRadius={62} outerRadius={98} paddingAngle={3} onClick={(row) => { const department = row?.department || ''; setDraftFilters((current) => ({ ...current, department })); setFilters((current) => ({ ...current, department })) }}>{(data.departmentBreakdown || []).map((row, index) => <Cell key={row.department} fill={COLORS[index % COLORS.length]} className="cursor-pointer" />)}</Pie><Tooltip formatter={(value) => [value, 'Leads']} /><Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} /></PieChart></ResponsiveContainer></div><div className="mt-2 rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black text-slate-700">Commercial definition</p><p className="mt-1 text-xs font-semibold leading-5 text-slate-500">Approved quotation value tracks the accepted pipeline. Only admin-approved PO amounts count as confirmed revenue.</p></div></article>
        </section>

        <section className="mt-6 hidden overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm sm:block"><div className="border-b border-slate-100 px-5 py-4"><h2 className="text-xl font-black text-slate-950">Department Breakdown</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[920px] text-sm"><thead className="bg-slate-50 text-left text-[10px] font-black uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Department</th><th className="px-5 py-3 text-right">Lead Count</th><th className="px-5 py-3 text-right">Conversion</th><th className="px-5 py-3 text-right">Avg Deal Value</th><th className="px-5 py-3 text-right">Approved Quote Value</th><th className="px-5 py-3 text-right">Target</th><th className="px-5 py-3 text-right">Actual Revenue</th></tr></thead><tbody>{(data.departmentBreakdown || []).map((row) => <tr key={row.department} onClick={() => { setDraftFilters((current) => ({ ...current, department: row.department })); setFilters((current) => ({ ...current, department: row.department })) }} className="cursor-pointer border-t border-slate-100 font-semibold text-slate-700 hover:bg-emerald-50/60"><td className="px-5 py-3 font-black text-slate-950">{row.department}</td><td className="px-5 py-3 text-right">{row.leadCount}</td><td className="px-5 py-3 text-right font-black text-emerald-700">{percent(row.conversionRate)}</td><td className="px-5 py-3 text-right">{money(row.avgDealValue)}</td><td className="px-5 py-3 text-right">{money(row.approvedQuotationValue)}</td><td className="px-5 py-3 text-right text-slate-400">{row.target ?? 'Not configured'}</td><td className="px-5 py-3 text-right font-black text-emerald-700">{money(row.actual)}</td></tr>)}</tbody></table></div></section>

        <section className="mt-6 hidden gap-4 md:grid-cols-3 sm:grid"><article className="rounded-3xl border border-rose-100 bg-rose-50 p-5"><p className="text-[10px] font-black uppercase tracking-wider text-rose-600">At-risk indicators</p><p className="mt-3 text-3xl font-black text-rose-800">{data.riskIndicators?.stalledQuotations || 0}</p><p className="mt-1 text-xs font-bold text-rose-700">Quotations awaiting action over 30 days</p><p className="mt-4 text-xs font-semibold text-rose-700">{data.riskIndicators?.lowConversionManagers || 0} low-conversion managers · {data.riskIndicators?.overdueFollowUps || 0} leads with overdue follow-ups</p></article><article className="rounded-3xl border border-emerald-100 bg-emerald-50 p-5"><p className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Top performers</p><div className="mt-3 space-y-2">{(data.insights?.topManagers || []).map((manager, index) => <div key={manager.managerId || manager.managerName} className="flex items-center justify-between rounded-xl bg-white/75 px-3 py-2 text-xs"><span className="font-black text-slate-800">{index + 1}. {manager.managerName}</span><strong className="text-emerald-700">{percent(manager.conversionRate)}</strong></div>)}</div></article><article className="rounded-3xl border border-amber-100 bg-amber-50 p-5"><p className="text-[10px] font-black uppercase tracking-wider text-amber-700">Recommendations</p><ul className="mt-3 space-y-2">{(data.insights?.recommendations || []).map((item) => <li key={item} className="flex gap-2 text-xs font-semibold leading-5 text-amber-900"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />{item}</li>)}</ul></article></section>
        </>}
        {activeTab === 'operations' && <OperationsMis report={operations} />}
        {activeTab === 'quotations' && <QuotationMis quotations={filteredQuotations} filters={filters} onError={setError} />}
        {activeTab === 'overview' && <CompleteOverview sales={data} operations={operations} quotations={filteredQuotations} />}
      </>}
    </div>
    {selectedManager && <ManagerDetailsModal manager={selectedManager} filters={filters} onClose={() => setSelectedManager(null)} />}
  </DashboardShell>
}
