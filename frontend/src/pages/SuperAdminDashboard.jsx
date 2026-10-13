import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts'
import ResponsiveContainer from '../components/charts/SafeResponsiveContainer'
import {
  Activity, ArrowUpDown, Building2, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Download, Eye, FileSpreadsheet,
  Lightbulb, Loader2, Monitor, RefreshCw, RotateCcw, Search, ShieldAlert, ShieldCheck,
  TicketCheck, Timer, UserCheck, Users, X, FileText, BarChart3
} from 'lucide-react'
import DashboardShell from '../components/dashboard/DashboardShell'
import UserWorkDrilldown from '../components/dashboard/UserWorkDrilldown'
import api from '../services/api'
import { API_ENDPOINTS } from '../services/apiEndpoints'
import {
  downloadCompleteMisPdf, downloadOperationMisPdf, downloadProductivityPdf, downloadSalesMisPdf, exportProductivityExcel,
  exportCompleteMisExcel, formatDateTime, formatDuration, formatReportDate, REPORT_TITLE
} from '../utils/productivityReportExports'
import { buildSalesMisReport } from '../utils/salesMisReport.mjs'

const roleLabels = { superadmin: 'Super Admin', admin: 'Admin', manager: 'Manager', operation: 'Operation', sales: 'Sales', compliance: 'Compliance', accounts: 'Accounts' }
const DEFAULT_REPORT_FROM_DATE = '2026-08-01'
const MIS_PAGE_SIZE = 10
const defaultRange = () => ({ from: DEFAULT_REPORT_FROM_DATE, to: inputDate(0), search: '', role: 'all', user: 'all', risk: 'all', status: 'all' })

function inputDate(offsetDays = 0) {
  const value = new Date(Date.now() + offsetDays * 86400000)
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value)
  const pick = (type) => parts.find((item) => item.type === type)?.value || ''
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

function entityId(value) {
  if (value && typeof value === 'object') return String(value._id || value.id || '')
  return String(value || '')
}

function displayText(value, fallback = '-') {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'object') return String(value.name || value.email || value.label || value._id || value.id || fallback)
  return String(value)
}

function identityText(value) {
  if (value && typeof value === 'object') return identityText(value._id || value.id)
  return String(value || '').trim().toLowerCase()
}

function quotationPoStatus(quotation = {}, leads = []) {
  const quotationLeadKeys = new Set([
    quotation.leadRef, quotation.leadId, quotation.leadCode, quotation.businessLeadCode
  ].map(identityText).filter(Boolean))
  const lead = leads.find((item) => [item._id, item.id, item.leadCode, item.sourceLeadId, item.externalLeadId]
    .map(identityText).some((key) => quotationLeadKeys.has(key)))
  if (!lead) return 'not_applicable'

  const quotationIds = new Set([quotation._id, quotation.id, quotation.quotationNumber].map(identityText).filter(Boolean))
  const serviceIds = new Set((quotation.items || []).flatMap((item) => [item.assignedServiceId, item.sourceServiceIndex]).map(identityText).filter(Boolean))
  const assignments = Array.isArray(lead.assignments) ? lead.assignments : []
  const exactAssignments = assignments.filter((assignment) => {
    const assignmentServiceId = identityText(assignment.assignedServiceId || assignment.serviceAssignmentId)
    const rows = Array.isArray(assignment.poYearRows) ? assignment.poYearRows : []
    return (assignmentServiceId && serviceIds.has(assignmentServiceId)) || rows.some((row) => [row.quotationId, row.quotationNumber, row.quotationNo]
      .map(identityText).some((key) => key && quotationIds.has(key)))
  })
  const relevantAssignments = exactAssignments.length ? exactAssignments : assignments
  const submitted = relevantAssignments.filter((assignment) => assignment.poStatus === 'received'
    && (assignment.poYearRows || []).some((row) => row.poNumber || row.poFileUrl))
  if (submitted.length) {
    const decisions = submitted.map((assignment) => String(assignment.poApprovalStatus || '').toUpperCase())
    if (decisions.includes('REVISION_REQUIRED')) return 'revision_required'
    if (decisions.includes('REJECTED')) return 'rejected'
    if (decisions.length && decisions.every((status) => status === 'APPROVED')) return 'approved'
    return 'submitted'
  }
  const closed = Boolean(lead.closedAt || lead.closedBy || String(lead.status || '').toLowerCase() === 'closed'
    || assignments.some((assignment) => assignment.closedBy || assignment.poStatus === 'provisional'))
  return closed ? 'pending' : 'not_applicable'
}

function poStatusDisplay(status) {
  return {
    submitted: { label: 'Submitted', tone: 'bg-blue-100 text-blue-700' },
    approved: { label: 'Approved', tone: 'bg-emerald-100 text-emerald-700' },
    rejected: { label: 'Rejected', tone: 'bg-rose-100 text-rose-700' },
    revision_required: { label: 'Revision Required', tone: 'bg-amber-100 text-amber-800' },
    pending: { label: 'Pending', tone: 'bg-orange-100 text-orange-700' },
    not_applicable: { label: '-', tone: 'bg-slate-100 text-slate-500' }
  }[status] || { label: '-', tone: 'bg-slate-100 text-slate-500' }
}

function dateInReportRange(value, from, to) {
  const date = String(value || '').slice(0, 10)
  return Boolean(date && date >= from && date <= to)
}

function fallbackCompletion(data = {}) {
  let filled = 0
  let total = 0
  const visit = (value, key = '') => {
    if (/password|otp|token|secret/i.test(key)) return
    if (Array.isArray(value)) { value.forEach((item) => visit(item, key)); return }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value).filter(([field]) => !/^(_id|createdAt|updatedAt)$/i.test(field))
      if (entries.some(([field]) => /^(url|secureUrl|dataUrl|path|publicId|name|fileName)$/i.test(field))) {
        total += 1
        if (entries.some(([field, item]) => /^(url|secureUrl|dataUrl|path|publicId|name|fileName)$/i.test(field) && item)) filled += 1
        return
      }
      entries.forEach(([field, item]) => visit(item, field))
      return
    }
    total += 1
    if (value !== undefined && value !== null && String(value).trim() !== '') filled += 1
  }
  visit(data)
  return { filled, missing: Math.max(0, total - filled) }
}

async function loadTemporaryMisLeads() {
  const rows = []
  let page = 1
  let pages = 1
  do {
    const { data } = await api.get(API_ENDPOINTS.leads.temporaryLeads, { timeout: 30000, params: { page, limit: 100 } })
    rows.push(...(data.temporaryLeads || []))
    pages = Number(data.pagination?.pages || 1)
    page += 1
  } while (page <= pages)
  return rows
}

function buildFallbackMisReport({ users = [], leads = [], temporaryLeads = [], clients = [], teams = [], from, to }) {
  const periodClients = clients.filter((client) => dateInReportRange(client.createdAt, from, to))
  const identity = (value) => String(entityId(value) || '').trim().toLowerCase().replace(/\s+/g, ' ')
  const rows = users.map((account) => {
    const id = entityId(account._id || account.id)
    const aliases = new Set([id, account.crmUserId, account.email, account.name].map(identity).filter(Boolean))
    const ownedLeads = leads.filter((lead) => {
      if (!dateInReportRange(lead.createdAt, from, to)) return false
      const generatedOwner = [lead.generatedForUser, lead.generatedForName, lead.generatedForEmail].filter(Boolean)
      const owner = generatedOwner.length ? generatedOwner : [lead.createdBy, lead.createdByCrmUserId, lead.createdByEmail, lead.createdByName, lead.importedCreatedBy]
      return owner.map(identity).some((value) => aliases.has(value))
    })
    const ownedClients = periodClients.filter((client) => entityId(client.createdBy) === id)
    const completion = ownedClients.map((client) => fallbackCompletion(client.data || {}))
    const clientFieldsFilled = completion.reduce((sum, item) => sum + item.filled, 0)
    const clientFieldsMissing = completion.reduce((sum, item) => sum + item.missing, 0)
    const closedLeads = ownedLeads.filter((lead) => lead.closedBy || lead.closedAt || /closed/i.test(String(lead.status || ''))).length
    return {
      id, name: displayText(account.name || account.email, 'Unnamed user'), email: displayText(account.email, ''),
      role: String(account.role || '').toLowerCase(), team: displayText(account.team, 'No team assigned'), managerId: entityId(account.managerId),
      active: account.isActive !== false, online: false, presence: account.lastLogin ? 'Offline' : 'Never Logged In', lastLogin: account.lastLogin || null,
      temporaryLeads: temporaryLeads.filter((lead) => dateInReportRange(lead.createdAt, from, to) && entityId(lead.createdBy) === id).length,
      lastActivity: account.lastLogin || null, totalLeads: ownedLeads.length, closedLeads, openLeads: Math.max(0, ownedLeads.length - closedLeads),
      clientMasters: ownedClients.length, clientFieldsFilled, clientFieldsMissing,
      draftClients: ownedClients.filter((client) => String(client.workflowStatus || 'draft').toLowerCase() === 'draft').length,
      submittedClients: ownedClients.filter((client) => String(client.workflowStatus || '').toLowerCase() === 'submitted').length,
      pendingClients: ownedClients.filter((client) => String(client.adminControls?.approvalStatus || 'PENDING').toUpperCase() === 'PENDING').length,
      partiallyApprovedClients: ownedClients.filter((client) => String(client.adminControls?.approvalStatus || '').toUpperCase() === 'PARTIALLY_APPROVED').length,
      approvedClients: ownedClients.filter((client) => String(client.adminControls?.approvalStatus || '').toUpperCase() === 'APPROVED').length,
      rejectedClients: ownedClients.filter((client) => String(client.adminControls?.approvalStatus || '').toUpperCase() === 'REJECTED').length,
      clientCompletionPercentage: clientFieldsFilled + clientFieldsMissing ? Math.round(clientFieldsFilled / (clientFieldsFilled + clientFieldsMissing) * 100) : 0,
      activeSeconds: 0, openSeconds: 0, awaySeconds: 0, activityCount: 0, sessions: 0, score: 0,
      tickets: { total: 0, open: 0, resolved: 0 }, risk: { key: account.lastLogin ? 'healthy' : 'never', level: account.lastLogin ? 'Low Risk' : 'Never Logged In', reason: account.lastLogin ? 'Fallback MIS data' : 'No successful CRM login recorded', rank: account.lastLogin ? 1 : 5 },
      recentActions: [], timeline: [], latestAccess: null
    }
  })
  return { period: { from, to }, users: rows, summary: summarize(rows), misAccess: { isAdmin: true, scope: 'all', showSales: true, showQuotations: true, operationTeams: teams.map((team) => ({ id: entityId(team._id || team.id), name: displayText(team.name, 'Operations Team'), managerId: entityId(team.manager), operationHeadId: entityId(team.operationHead), memberIds: (team.members || []).map(entityId) })) } }
}

function riskTone(key) {
  return {
    healthy: 'bg-emerald-100 text-emerald-800 ring-emerald-200', away: 'bg-orange-100 text-orange-800 ring-orange-200',
    stale: 'bg-amber-100 text-amber-800 ring-amber-200', never: 'bg-rose-100 text-rose-800 ring-rose-200',
    inactive: 'bg-slate-200 text-slate-700 ring-slate-300'
  }[key] || 'bg-slate-100 text-slate-700 ring-slate-200'
}

function presenceTone(value) {
  return {
    Active: 'bg-emerald-100 text-emerald-800', Away: 'bg-orange-100 text-orange-800',
    Offline: 'bg-slate-100 text-slate-600', 'Never Logged In': 'bg-rose-100 text-rose-700'
  }[value] || 'bg-slate-100 text-slate-600'
}

function summarize(rows) {
  return rows.reduce((summary, row) => ({
    totalUsers: summary.totalUsers + 1, activeUsers: summary.activeUsers + (row.active ? 1 : 0),
    onlineNow: summary.onlineNow + (row.online ? 1 : 0), activeSeconds: summary.activeSeconds + row.activeSeconds,
    awaySeconds: summary.awaySeconds + row.awaySeconds, actions: summary.actions + row.activityCount,
    totalLeads: summary.totalLeads + row.totalLeads, closedLeads: summary.closedLeads + row.closedLeads,
    supportTickets: summary.supportTickets + row.tickets.total, totalSessions: summary.totalSessions + row.sessions
  }), { totalUsers: 0, activeUsers: 0, onlineNow: 0, activeSeconds: 0, awaySeconds: 0, actions: 0, totalLeads: 0, closedLeads: 0, supportTickets: 0, totalSessions: 0 })
}

function topRow(rows, selector) {
  return rows.length ? [...rows].sort((a, b) => selector(b) - selector(a))[0] : null
}

function buildOperationGroups(rows, teams = []) {
  if (teams.length) return teams.map((team) => {
    const managerId = entityId(team.managerId)
    const manager = rows.find((row) => entityId(row.id) === managerId) || null
    const memberIds = new Set((team.memberIds || []).map(entityId))
    const members = rows.filter((row) => memberIds.has(entityId(row.id)) && entityId(row.id) !== managerId)
    const people = [...(manager ? [manager] : []), ...members]
    const filled = people.reduce((sum, row) => sum + Number(row.clientFieldsFilled || 0), 0)
    const missing = people.reduce((sum, row) => sum + Number(row.clientFieldsMissing || 0), 0)
    return { id: String(team.id), name: team.name, manager, members, clientMasters: people.reduce((sum, row) => sum + Number(row.clientMasters || 0), 0), filled, missing, draftClients: people.reduce((sum, row) => sum + Number(row.draftClients || 0), 0), submittedClients: people.reduce((sum, row) => sum + Number(row.submittedClients || 0), 0), approvedClients: people.reduce((sum, row) => sum + Number(row.approvedClients || 0), 0), partiallyApprovedClients: people.reduce((sum, row) => sum + Number(row.partiallyApprovedClients || 0), 0), rejectedClients: people.reduce((sum, row) => sum + Number(row.rejectedClients || 0), 0), percentage: filled + missing ? Math.round((filled / (filled + missing)) * 100) : 0 }
  })
  const managers = rows.filter((row) => String(row.role).toLowerCase() === 'manager')
  const operationUsers = rows.filter((row) => String(row.role).toLowerCase() === 'operation')
  const groups = managers.map((manager, index) => {
    const members = operationUsers.filter((row) => String(row.managerId || '') === String(manager.id))
    const people = [manager, ...members]
    const filled = people.reduce((sum, row) => sum + Number(row.clientFieldsFilled || 0), 0)
    const missing = people.reduce((sum, row) => sum + Number(row.clientFieldsMissing || 0), 0)
    return {
      id: String(manager.id), name: manager.team || `Team ${String.fromCharCode(65 + index)}`,
      manager, members, clientMasters: people.reduce((sum, row) => sum + Number(row.clientMasters || 0), 0),
      filled, missing, draftClients: people.reduce((sum, row) => sum + Number(row.draftClients || 0), 0), submittedClients: people.reduce((sum, row) => sum + Number(row.submittedClients || 0), 0), approvedClients: people.reduce((sum, row) => sum + Number(row.approvedClients || 0), 0), partiallyApprovedClients: people.reduce((sum, row) => sum + Number(row.partiallyApprovedClients || 0), 0), rejectedClients: people.reduce((sum, row) => sum + Number(row.rejectedClients || 0), 0), percentage: filled + missing ? Math.round((filled / (filled + missing)) * 100) : 0
    }
  })
  const assigned = new Set(groups.flatMap((group) => group.members.map((row) => String(row.id))))
  const unassigned = operationUsers.filter((row) => !assigned.has(String(row.id)))
  if (unassigned.length) {
    const filled = unassigned.reduce((sum, row) => sum + Number(row.clientFieldsFilled || 0), 0)
    const missing = unassigned.reduce((sum, row) => sum + Number(row.clientFieldsMissing || 0), 0)
    groups.push({ id: 'unassigned', name: 'Unassigned Operations', manager: null, members: unassigned,
      clientMasters: unassigned.reduce((sum, row) => sum + Number(row.clientMasters || 0), 0), filled, missing,
      draftClients: unassigned.reduce((sum, row) => sum + Number(row.draftClients || 0), 0), submittedClients: unassigned.reduce((sum, row) => sum + Number(row.submittedClients || 0), 0), approvedClients: unassigned.reduce((sum, row) => sum + Number(row.approvedClients || 0), 0), partiallyApprovedClients: unassigned.reduce((sum, row) => sum + Number(row.partiallyApprovedClients || 0), 0), rejectedClients: unassigned.reduce((sum, row) => sum + Number(row.rejectedClients || 0), 0), percentage: filled + missing ? Math.round((filled / (filled + missing)) * 100) : 0 })
  }
  return groups
}

function MetricCard({ label, value, note, icon: Icon, tone, loading }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[.14em] text-slate-500">{label}</p>{loading ? <div className="mt-3 h-7 w-24 animate-pulse rounded-lg bg-slate-100" /> : <p className="mt-2 truncate text-2xl font-black text-slate-950">{value}</p>}</div><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone}`}><Icon className="h-5 w-5" /></span></div>
    <p className="mt-3 truncate text-[11px] font-bold text-slate-500">{note}</p>
  </article>
}

function MisOverviewCard({ title, subtitle, icon: Icon, tone, metrics, loading }) {
  const tones = {
    emerald: 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white text-emerald-700',
    blue: 'border-blue-200 bg-gradient-to-br from-blue-50 to-white text-blue-700',
    orange: 'border-orange-200 bg-gradient-to-br from-orange-50 to-white text-orange-600',
    rose: 'border-rose-200 bg-gradient-to-br from-rose-50 to-white text-rose-700',
    violet: 'border-violet-200 bg-gradient-to-br from-violet-50 to-white text-violet-700'
  }
  return <article className={`rounded-2xl border p-4 shadow-sm ${tones[tone]}`}>
    <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white/80 shadow-sm"><Icon className="h-5 w-5" /></span><div><h2 className="font-black text-slate-950">{title}</h2><p className="text-[10px] font-bold text-slate-500">{subtitle}</p></div></div>
    <div className="mt-4 grid grid-cols-2 gap-3">{metrics.map(([label, value]) => <div key={label} className="border-l border-current/20 pl-3"><small className="block text-[9px] font-black uppercase tracking-wider text-slate-500">{label}</small>{loading ? <div className="mt-2 h-5 w-14 animate-pulse rounded bg-slate-200" /> : <strong className="mt-1 block text-lg text-slate-950">{value}</strong>}</div>)}</div>
  </article>
}

function salesDepartment(row = {}) {
  const role = String(row.role || '').toLowerCase()
  const team = String(row.team || '').toLowerCase()
  if (['admin', 'super admin', 'superadmin', 'management'].includes(role) || team.includes('management')) return 'Management'
  if (role === 'sales' || team.includes('sales')) return 'Sales Team'
  if (['operation', 'manager', 'operation head', 'operations head'].includes(role) || team.includes('operation')) return 'Operations Team'
  return 'Other Departments'
}

function buildSalesDepartmentGroups(rows = []) {
  return ['Sales Team', 'Operations Team', 'Management', 'Other Departments'].map((name) => {
    const members = rows.filter((row) => salesDepartment(row) === name)
    const totals = members.reduce((sum, row) => ({ total: sum.total + Number(row.totalLeads || 0), open: sum.open + Number(row.openLeads || 0), closed: sum.closed + Number(row.closedLeads || 0), temporary: sum.temporary + Number(row.temporaryLeads || 0) }), { total: 0, open: 0, closed: 0, temporary: 0 })
    return { name, members, ...totals }
  }).filter((group) => group.members.length)
}

function SalesOwnershipTable({ groups, loading, onOpenUser }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[940px] text-sm"><thead className="bg-slate-50 text-left text-[10px] font-black uppercase tracking-wider text-slate-500"><tr><th rowSpan={2} scope="col" className="px-5 py-3">Sr. No.</th><th rowSpan={2} scope="col" className="px-5 py-3">Lead Owner</th><th rowSpan={2} scope="col" className="px-5 py-3">Role / CRM Team</th><th colSpan={2} scope="colgroup" className="border-x border-emerald-100 bg-emerald-50 px-5 py-3 text-center text-emerald-800">Total Leads</th><th rowSpan={2} scope="col" className="px-5 py-3 text-right">Lead Open</th><th rowSpan={2} scope="col" className="px-5 py-3 text-right">Lead Close</th><th rowSpan={2} scope="col" className="px-5 py-3">Close Rate</th></tr><tr><th scope="col" className="border-l border-emerald-100 bg-violet-50 px-5 py-2 text-right text-violet-700">Temp Lead</th><th scope="col" className="border-r border-emerald-100 bg-emerald-50 px-5 py-2 text-right text-emerald-700">Lead</th></tr></thead><tbody>
    {loading && <tr><td colSpan="8" className="p-5"><div className="h-12 animate-pulse rounded-xl bg-slate-100" /></td></tr>}
    {!loading && groups.flatMap((group) => {
      const teamRate = group.total ? Math.round(group.closed / group.total * 100) : 0
      return [<tr key={`department-${group.name}`} className="border-t-2 border-emerald-200 bg-emerald-50 font-black text-emerald-950"><td className="px-5 py-3" colSpan="3"><span className="inline-flex items-center gap-2"><Users className="h-4 w-4" />{group.name}<small className="rounded-full bg-white px-2 py-1 text-[10px] text-emerald-700">{group.members.length} users</small></span></td><td className="px-5 py-3 text-right text-lg text-violet-700">{group.temporary}</td><td className="px-5 py-3 text-right text-lg">{group.total}</td><td className="px-5 py-3 text-right text-orange-600">{group.open}</td><td className="px-5 py-3 text-right text-emerald-700">{group.closed}</td><td className="px-5 py-3 text-emerald-800">{teamRate}%</td></tr>, ...group.members.map((row, index) => { const rate = row.totalLeads ? Math.round(row.closedLeads / row.totalLeads * 100) : 0; return <tr key={String(row.id)} className="border-t border-slate-100 font-semibold text-slate-700 hover:bg-emerald-50/50"><td className="px-5 py-4 pl-8 font-black text-slate-400">{index + 1}</td><td className="px-5 py-4"><button type="button" onClick={() => onOpenUser(row)} className="text-left"><strong className="block text-slate-950 hover:text-emerald-700">{row.name}</strong><small className="text-slate-500">{row.email}</small></button></td><td className="px-5 py-4"><strong className="block text-xs">{row.roleLabel}</strong><small className="text-slate-500">{row.team || group.name}</small></td><td className="px-5 py-4 text-right text-lg font-black text-violet-700">{Number(row.temporaryLeads || 0)}</td><td className="px-5 py-4 text-right text-lg font-black text-slate-950">{row.totalLeads}</td><td className="px-5 py-4 text-right text-lg font-black text-orange-600">{row.openLeads}</td><td className="px-5 py-4 text-right text-lg font-black text-emerald-700">{row.closedLeads}</td><td className="px-5 py-4"><div className="flex items-center gap-3"><div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${rate}%` }} /></div><strong className="text-emerald-800">{rate}%</strong></div></td></tr> })]
    })}
    {!loading && !groups.length && <tr><td colSpan="8" className="p-10 text-center font-bold text-slate-400">No lead owners found.</td></tr>}
  </tbody></table></div>
}

function SalesMisInfographic({ model, loading, period, onDownload, downloading, onOpenUser }) {
  const { owners, groups, totals, ranked, openLeaders, focusOpen, focusPercent } = model
  const scale = Math.max(1, ...groups.map((group) => group.total))
  const ownerScale = Math.max(1, ...ranked.map((row) => row.closedLeads))
  const topClosed = ranked.filter((row) => row.closedLeads > 0).slice(0, 4)
  const zeroClosed = ranked.filter((row) => row.closedLeads === 0)
  const focusNames = openLeaders.map((row) => row.name).join(' and ')
  return <section className="mt-4 overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-emerald-100 px-5 py-4">
      <div className="flex min-w-0 items-center gap-4"><img src="/ananttattva-logo.png" alt="AnantTattva" className="h-10 w-auto object-contain" /><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-orange-500">Management report</p><h2 className="text-xl font-black text-[#075848]">Sales MIS</h2><p className="text-xs font-semibold text-slate-500">Permanent Lead Owner Performance · {formatReportDate(period.from)}–{formatReportDate(period.to)}</p></div></div>
      <button type="button" onClick={onDownload} disabled={loading || downloading} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#075848] px-4 text-sm font-black text-white disabled:opacity-50">{downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{downloading ? 'Generating…' : 'Download Sales MIS PDF'}</button>
    </header>
    <div className="grid grid-cols-2 border-b border-slate-100 sm:grid-cols-4">{[['Total Leads', totals.total, 'text-[#075848]'], ['Open Leads', totals.open, 'text-orange-600'], ['Closed Leads', totals.closed, 'text-emerald-700'], ['Close Rate', `${totals.closeRate}%`, 'text-[#075848]']].map(([label, value, tone]) => <div key={label} className="border-r border-slate-100 px-5 py-3 last:border-r-0"><p className="text-[9px] font-black uppercase tracking-wider text-slate-500">{label}</p><strong className={`mt-1 block text-2xl ${tone}`}>{loading ? '—' : value}</strong></div>)}</div>
    <div className="grid gap-4 p-4 xl:grid-cols-2">
      <section className="rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between"><div><h3 className="font-black text-[#075848]">Team Comparison</h3><p className="text-[10px] font-semibold text-slate-500">Open and closed leads · common scale</p></div><div className="flex gap-3 text-[10px] font-bold text-slate-500"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-orange-400" />Open</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-700" />Closed</span></div></div><div className="mt-4 space-y-4">{groups.map((group) => <div key={group.name}><div className="mb-1 flex justify-between gap-3 text-xs"><strong className="text-slate-800">{group.name}</strong><span className="font-semibold text-slate-500">{group.users} users · {group.total} leads · {group.closeRate}% closed</span></div><div className="flex h-3 overflow-hidden rounded-full bg-slate-100" aria-label={`${group.name}: ${group.open} open and ${group.closed} closed`}><span className="bg-orange-400" style={{ width: `${group.open / scale * 100}%` }} /><span className="bg-emerald-700" style={{ width: `${group.closed / scale * 100}%` }} /></div><p className="mt-1 text-[10px] font-bold text-slate-500">{group.open} open · {group.closed} closed</p></div>)}</div></section>
      <section className="rounded-xl border border-slate-200 p-4"><h3 className="font-black text-[#075848]">Closed Leads by Owner</h3><p className="text-[10px] font-semibold text-slate-500">Ranked by closed lead count</p><div className="mt-3 space-y-2">{topClosed.map((row) => <div key={String(row.id || row.name)} className="grid grid-cols-[minmax(110px,1fr)_2fr_auto] items-center gap-3 text-xs"><strong className="truncate text-slate-700">{row.name}</strong><span className="h-2 overflow-hidden rounded-full bg-slate-100"><i className="block h-full rounded-full bg-emerald-700" style={{ width: `${row.closedLeads / ownerScale * 100}%` }} /></span><span className="min-w-24 text-right font-bold text-slate-500">{row.closedLeads} · {row.closeRate}%</span></div>)}{zeroClosed.length > 0 && <p className="pt-1 text-[10px] font-bold text-slate-400">Remaining {zeroClosed.length} owner{zeroClosed.length === 1 ? '' : 's'}: 0 closed leads</p>}</div></section>
    </div>
    <div className="mx-4 mb-4 rounded-xl border-l-4 border-orange-400 bg-orange-50 px-4 py-3 text-xs font-semibold text-slate-700"><strong className="text-[#075848]">Management focus:</strong> {totals.open} leads remain open. {focusNames || 'The leading owners'} together hold {focusOpen} open leads, approximately {focusPercent}% of the open pipeline.</div>
    <div className="overflow-x-auto border-t border-slate-100"><table className="w-full min-w-[760px] text-xs"><thead className="bg-[#075848] text-left text-[10px] uppercase tracking-wider text-white"><tr><th rowSpan={2} className="px-4 py-2.5 align-middle">Lead Owner</th><th colSpan={2} className="border-x border-emerald-300/40 px-4 py-2.5 text-center">Total Leads</th><th rowSpan={2} className="px-4 py-2.5 text-right align-middle">Open</th><th rowSpan={2} className="px-4 py-2.5 text-right align-middle">Closed</th><th rowSpan={2} className="px-4 py-2.5 text-right align-middle">Close Rate</th></tr><tr><th className="border-l border-t border-emerald-300/40 bg-[#0a6a58] px-4 py-2 text-right">Temp Lead</th><th className="border-r border-t border-emerald-300/40 bg-[#0a6a58] px-4 py-2 text-right">Lead</th></tr></thead><tbody>{owners.map((row) => <tr key={String(row.id || row.name)} className="border-b border-slate-100 last:border-0"><td className="px-4 py-2"><button type="button" onClick={() => onOpenUser(row)} className="font-bold text-slate-800 hover:text-emerald-700">{row.name}</button></td><td className="px-4 py-2 text-right font-bold text-violet-700">{row.temporaryLeads}</td><td className="px-4 py-2 text-right font-bold">{row.totalLeads}</td><td className="px-4 py-2 text-right font-bold text-orange-600">{row.openLeads}</td><td className="px-4 py-2 text-right font-bold text-emerald-700">{row.closedLeads}</td><td className="px-4 py-2 text-right font-bold">{row.closeRate}%</td></tr>)}</tbody><tfoot className="bg-emerald-50 font-black text-[#075848]"><tr><td className="px-4 py-2">Total · {owners.length} owners</td><td className="px-4 py-2 text-right text-violet-700">{totals.temporary}</td><td className="px-4 py-2 text-right">{totals.total}</td><td className="px-4 py-2 text-right">{totals.open}</td><td className="px-4 py-2 text-right">{totals.closed}</td><td className="px-4 py-2 text-right">{totals.closeRate}%</td></tr></tfoot></table></div>
    <footer className="border-t border-slate-100 px-4 py-2 text-[10px] font-semibold text-slate-500">Temporary leads ({totals.temporary}) are shown as Temp Lead beside Lead under Total Leads and are not included in the permanent Lead count.</footer>
  </section>
}

function MisPagination({ page, total, pageSize = MIS_PAGE_SIZE, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-3 text-xs font-bold text-slate-500">Showing {total} of {total} records</div>
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * pageSize + 1
  const end = Math.min(total, safePage * pageSize)
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-3"><span className="text-xs font-bold text-slate-500">Showing {start}-{end} of {total} records</span><div className="flex items-center gap-2"><button type="button" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><span className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white">Page {safePage} / {totalPages}</span><button type="button" disabled={safePage >= totalPages} onClick={() => onPageChange(safePage + 1)} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div></div>
}

function SortHeading({ label, value, sort, onSort, align = 'left' }) {
  return <th className={`sticky top-0 z-10 bg-slate-50 px-3 py-3 ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'}`}><button type="button" onClick={() => onSort(value)} className="inline-flex items-center gap-1 whitespace-nowrap text-[10px] font-black uppercase tracking-wider text-slate-500 hover:text-emerald-700">{label}<ArrowUpDown className={`h-3 w-3 ${sort.key === value ? 'text-emerald-600' : 'text-slate-300'}`} /></button></th>
}

export default function SuperAdminDashboard({ misPage = false }) {
  const navigate = useNavigate()
  const [user] = useState(() => JSON.parse(localStorage.getItem('user') || 'null'))
  const currentRole = String(user?.role || '').trim().toLowerCase().replace(/[\s_-]+/g, '')
  const currentUserIsAdmin = ['admin', 'superadmin'].includes(currentRole)
  const [report, setReport] = useState({ period: { from: DEFAULT_REPORT_FROM_DATE, to: inputDate(0) }, summary: {}, users: [] })
  const [draftFilters, setDraftFilters] = useState(defaultRange)
  const [appliedFilters, setAppliedFilters] = useState(defaultRange)
  const [sort, setSort] = useState({ key: 'risk', direction: 'desc' })
  const [loading, setLoading] = useState(true)
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [exportingExcel, setExportingExcel] = useState(false)
  const [approvalCountsLoading, setApprovalCountsLoading] = useState(misPage && currentUserIsAdmin)
  const [generatingMisPdf, setGeneratingMisPdf] = useState('')
  const [error, setError] = useState('')
  const [exportError, setExportError] = useState('')
  const [selected, setSelected] = useState(null)
  const [workReportUser, setWorkReportUser] = useState(null)
  const [quotations, setQuotations] = useState([])
  const [quotationLeads, setQuotationLeads] = useState([])
  const [approvalWorkflowClients, setApprovalWorkflowClients] = useState([])
  const [salesPage, setSalesPage] = useState(1)
  const [operationPage, setOperationPage] = useState(1)
  const [quotationPage, setQuotationPage] = useState(1)

  async function loadProductivityReport(timeout = 60000) {
    return api.get(API_ENDPOINTS.auth.userProductivityReport, {
      params: { from: appliedFilters.from, to: appliedFilters.to },
      timeout
    })
  }

  async function load() {
    setLoading(true)
    setError('')
    try {
      let reportResult
      try { reportResult = await loadProductivityReport(60000) }
      catch (firstError) {
        if (firstError?.code !== 'ECONNABORTED' && firstError?.message !== 'Network Error') throw firstError
        reportResult = await loadProductivityReport(90000)
      }
      setReport(reportResult.data || reportResult)
    } catch (requestError) {
      if (misPage && currentUserIsAdmin) {
        const fallbackResults = await Promise.allSettled([
          api.get(API_ENDPOINTS.auth.users, { timeout: 30000 }), api.get(API_ENDPOINTS.leads.list, { timeout: 30000 }),
          api.get(API_ENDPOINTS.clients.list, { timeout: 30000 }), api.get(API_ENDPOINTS.teams.list, { timeout: 30000 }), loadTemporaryMisLeads()
        ])
        const [usersResult, leadsResult, clientsResult, teamsResult, temporaryResult] = fallbackResults
        const users = usersResult.status === 'fulfilled' ? usersResult.value.data?.users || [] : []
        const leads = leadsResult.status === 'fulfilled' ? leadsResult.value.data?.leads || [] : []
        const clients = clientsResult.status === 'fulfilled' ? clientsResult.value.data?.clients || [] : []
        const teams = teamsResult.status === 'fulfilled' ? teamsResult.value.data?.teams || [] : []
        if (users.length) {
          setReport(buildFallbackMisReport({ users, leads, temporaryLeads: temporaryResult.status === 'fulfilled' ? temporaryResult.value : [], clients, teams, from: appliedFilters.from, to: appliedFilters.to }))
          setError('Live activity telemetry is temporarily unavailable. Sales and Operation MIS are showing current CRM records.')
        } else setError(requestError?.response?.data?.error || 'Unable to load MIS data. Please try again.')
      } else setError(requestError?.response?.data?.error || 'Unable to load the user activity report. Please try again.')
    } finally { setLoading(false) }
    if (misPage && currentUserIsAdmin) {
      setApprovalCountsLoading(true)
      api.get(API_ENDPOINTS.quotations.list, { timeout: 30000 })
        .then((result) => setQuotations(result.data?.quotations || []))
        .catch((quotationError) => console.error('Unable to load Quotation MIS', quotationError))
      api.get(API_ENDPOINTS.leads.list, { timeout: 30000 })
        .then((result) => setQuotationLeads(result.data?.leads || []))
        .catch((leadError) => console.error('Unable to load PO statuses for Quotation MIS', leadError))
      api.get(API_ENDPOINTS.clients.pendingApprovals, { timeout: 30000, params: { _: Date.now() } })
        .then((result) => setApprovalWorkflowClients(result.data?.pendingClients || []))
        .catch((approvalError) => console.error('Unable to load approval status counts for Operations MIS', approvalError))
        .finally(() => setApprovalCountsLoading(false))
    }
  }

  useEffect(() => { load() }, [appliedFilters.from, appliedFilters.to])

  useEffect(() => {
    if (draftFilters.from > draftFilters.to) {
      setError('From Date cannot be after To Date.')
      return undefined
    }
    setError('')
    const timer = window.setTimeout(() => setAppliedFilters((current) => (
      current.from === draftFilters.from && current.to === draftFilters.to
        && current.search === draftFilters.search && current.role === draftFilters.role
        && current.user === draftFilters.user && current.risk === draftFilters.risk
        && current.status === draftFilters.status ? current : { ...draftFilters }
    )), 200)
    return () => window.clearTimeout(timer)
  }, [draftFilters])

  const rows = useMemo(() => {
    const approvalCounts = new Map()
    approvalWorkflowClients.forEach((client) => {
      const owner = displayText(client.createdBy || client.createdByName, '').trim().toLowerCase().replace(/\s+/g, ' ')
      if (!owner) return
      const current = approvalCounts.get(owner) || { approved: 0, partial: 0, rejected: 0 }
      const status = String(client.approvalStatus || client.status || '').trim().toUpperCase()
      if (status === 'APPROVED') current.approved += 1
      else if (status === 'PARTIALLY_APPROVED') current.partial += 1
      else if (status === 'REJECTED') current.rejected += 1
      approvalCounts.set(owner, current)
    })
    return (report.users || []).map((row) => {
      const aliases = [row.name, row.email].map((value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean)
      const workflow = aliases.map((alias) => approvalCounts.get(alias)).find(Boolean)
      return { ...row, roleLabel: roleLabels[row.role] || row.role || '-',
        approvedClients: workflow ? workflow.approved : Number(row.approvedClients || 0),
        partiallyApprovedClients: workflow ? workflow.partial : Number(row.partiallyApprovedClients || 0),
        rejectedClients: workflow ? workflow.rejected : Number(row.rejectedClients || 0) }
    })
  }, [approvalWorkflowClients, report.users])
  const allSalesMisRows = useMemo(() => rows, [rows])
  const salesMisModel = useMemo(() => buildSalesMisReport(allSalesMisRows), [allSalesMisRows])
  const salesDepartmentGroups = useMemo(() => buildSalesDepartmentGroups(allSalesMisRows), [allSalesMisRows])
  const managementSalesGroups = useMemo(() => salesDepartmentGroups.filter((group) => group.name === 'Management'), [salesDepartmentGroups])
  const departmentSalesGroups = useMemo(() => salesDepartmentGroups.filter((group) => group.name !== 'Management' && group.name !== 'Operations Team'), [salesDepartmentGroups])
  const misAccess = report.misAccess || { isAdmin: true, scope: 'all', showSales: true, showQuotations: true, operationTeams: [] }
  const operationsOnlyMis = misPage && !misAccess.isAdmin
  const misTitle = operationsOnlyMis
    ? (misAccess.scope === 'operation-head' ? 'Complete Operations MIS' : `${misAccess.operationTeams?.[0]?.name || 'Team'} Operations MIS`)
    : 'Complete MIS'
  const allOperationGroups = useMemo(() => buildOperationGroups(rows, misAccess.operationTeams), [rows, misAccess.operationTeams])
  const allQuotationMisRows = useMemo(() => [...quotations]
    .sort((left, right) => new Date(right.quotationDate || right.createdAt || 0) - new Date(left.quotationDate || left.createdAt || 0))
    .map((row) => ({ ...row, poMisStatus: quotationPoStatus(row, quotationLeads) })), [quotationLeads, quotations])
  const salesMisRows = useMemo(() => allSalesMisRows.slice((salesPage - 1) * MIS_PAGE_SIZE, salesPage * MIS_PAGE_SIZE), [allSalesMisRows, salesPage])
  const operationGroups = useMemo(() => allOperationGroups.slice((operationPage - 1) * MIS_PAGE_SIZE, operationPage * MIS_PAGE_SIZE), [allOperationGroups, operationPage])
  const quotationMisRows = useMemo(() => allQuotationMisRows.slice((quotationPage - 1) * MIS_PAGE_SIZE, quotationPage * MIS_PAGE_SIZE), [allQuotationMisRows, quotationPage])
  const salesTotals = { leads: salesMisModel.totals.total, open: salesMisModel.totals.open, closed: salesMisModel.totals.closed }
  const operationTotals = useMemo(() => allOperationGroups.reduce((total, group) => ({ clients: total.clients + Number(group.clientMasters || 0), draft: total.draft + Number(group.draftClients || 0), submitted: total.submitted + Number(group.submittedClients || 0), pending: total.pending + Number(group.pendingClients || 0), filled: total.filled + Number(group.filled || 0), missing: total.missing + Number(group.missing || 0) }), { clients: 0, draft: 0, submitted: 0, pending: 0, filled: 0, missing: 0 }), [allOperationGroups])
  useEffect(() => { setSalesPage(1); setOperationPage(1); setQuotationPage(1) }, [appliedFilters.from, appliedFilters.to])
  const quotationTotals = useMemo(() => ({ total: allQuotationMisRows.length, open: allQuotationMisRows.filter((row) => ['draft', 'submitted', 'sent'].includes(String(row.status || '').toLowerCase())).length, converted: allQuotationMisRows.filter((row) => ['approved', 'converted'].includes(String(row.status || '').toLowerCase())).length }), [allQuotationMisRows])
  const roles = useMemo(() => [...new Set(rows.map((row) => row.role).filter(Boolean))].sort(), [rows])
  const visible = useMemo(() => {
    const search = appliedFilters.search.trim().toLowerCase()
    const filtered = rows.filter((row) => (!search || `${row.name} ${row.email} ${row.roleLabel}`.toLowerCase().includes(search))
      && (appliedFilters.role === 'all' || row.role === appliedFilters.role)
      && (appliedFilters.user === 'all' || String(row.id) === appliedFilters.user)
      && (appliedFilters.risk === 'all' || row.risk.key === appliedFilters.risk)
      && (appliedFilters.status === 'all' || (appliedFilters.status === 'online' ? row.online : row.presence.toLowerCase() === appliedFilters.status)))
    const selectors = {
      score: (row) => row.score, activeSeconds: (row) => row.activeSeconds, awaySeconds: (row) => row.awaySeconds,
      totalLeads: (row) => row.totalLeads, closedLeads: (row) => row.closedLeads,
      tickets: (row) => row.tickets.total, risk: (row) => row.risk.rank, sessions: (row) => row.sessions
    }
    const selector = selectors[sort.key] || selectors.risk
    return filtered.sort((a, b) => (selector(a) - selector(b)) * (sort.direction === 'asc' ? 1 : -1) || a.name.localeCompare(b.name))
  }, [rows, appliedFilters, sort])
  const summary = useMemo(() => summarize(visible), [visible])
  const insights = useMemo(() => ({
    mostActive: topRow(visible, (row) => row.activeSeconds), highestScore: topRow(visible, (row) => row.score),
    mostLeads: topRow(visible, (row) => row.totalLeads), mostTickets: topRow(visible, (row) => row.tickets.total)
  }), [visible])
  const attention = ['never', 'stale', 'away', 'inactive'].map((key) => ({ key, count: rows.filter((row) => row.risk.key === key).length, label: { never: 'Never logged in', stale: 'Medium risk / stale', away: 'High away ratio', inactive: 'Inactive accounts' }[key] }))
  const chart = [...visible].sort((a, b) => b.activeSeconds - a.activeSeconds).slice(0, 8).map((row) => ({ name: (row.name || 'User').split(' ')[0], Active: Math.round(row.activeSeconds / 60), Away: Math.round(row.awaySeconds / 60) }))

  function resetFilters() {
    const next = defaultRange()
    setDraftFilters(next)
    setAppliedFilters(next)
    setSort({ key: 'risk', direction: 'desc' })
  }

  function changeSort(key) {
    setSort((current) => ({ key, direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc' }))
  }

  async function downloadPdf() {
    if (generatingPdf) return
    setGeneratingPdf(true)
    setExportError('')
    try { await downloadProductivityPdf({ rows: visible, summary, period: report.period, insights }) }
    catch (pdfError) { console.error('Unable to generate productivity PDF', pdfError); setExportError('Unable to generate the report. Please try again.') }
    finally { setGeneratingPdf(false) }
  }

  async function downloadExcel() {
    if (exportingExcel) return
    setExportingExcel(true)
    setExportError('')
    try { await exportProductivityExcel({ rows: visible, summary, period: report.period }) }
    catch (excelError) { console.error('Unable to export productivity Excel', excelError); setExportError('Unable to export Excel. Please try again.') }
    finally { setExportingExcel(false) }
  }

  async function downloadCompleteMisExcel() {
    if (exportingExcel) return
    setExportingExcel(true)
    setExportError('')
    try { await exportCompleteMisExcel({ salesRows: allSalesMisRows, operationGroups: allOperationGroups, period: report.period }) }
    catch (excelError) { console.error('Unable to export Complete MIS Excel', excelError); setExportError('Unable to export Complete MIS Excel. Please try again.') }
    finally { setExportingExcel(false) }
  }

  async function downloadCompletePdf() {
    if (generatingMisPdf) return
    setGeneratingMisPdf('complete')
    setExportError('')
    try { await downloadCompleteMisPdf({ salesRows: allSalesMisRows, operationGroups: allOperationGroups, period: report.period }) }
    catch (pdfError) { console.error('Unable to generate Complete MIS PDF', pdfError); setExportError('Unable to generate Complete MIS PDF. Please try again.') }
    finally { setGeneratingMisPdf('') }
  }

  async function downloadMisPdf(type) {
    if (generatingMisPdf) return
    setGeneratingMisPdf(type)
    setExportError('')
    try {
      if (type === 'sales') await downloadSalesMisPdf({ rows: allSalesMisRows, period: report.period })
      else await downloadOperationMisPdf({ groups: allOperationGroups, period: report.period })
    } catch (pdfError) {
      console.error(`Unable to generate ${type} MIS PDF`, pdfError)
      setExportError(`Unable to generate the ${type === 'sales' ? 'Sales' : 'Operation'} MIS report. Please try again.`)
    } finally { setGeneratingMisPdf('') }
  }

  const cards = [
    ['Total Users', summary.totalUsers, `${summary.activeUsers} active accounts`, Users, 'bg-indigo-50 text-indigo-700'],
    ['Online Now', summary.onlineNow, 'Latest heartbeat status', UserCheck, 'bg-emerald-50 text-emerald-700'],
    ['Active CRM Time', formatDuration(summary.activeSeconds), `${formatReportDate(report.period.from)} - ${formatReportDate(report.period.to)}`, Timer, 'bg-cyan-50 text-cyan-700'],
    ['Away Time', formatDuration(summary.awaySeconds), 'Away from active CRM tab', Clock3, 'bg-orange-50 text-orange-700'],
    ['Closed Leads', summary.closedLeads, `${summary.totalLeads} leads in period`, CheckCircle2, 'bg-teal-50 text-teal-700'],
    ['Support Tickets Raised', summary.supportTickets, 'Created in selected period', TicketCheck, 'bg-emerald-50 text-emerald-700'],
    ['Total Sessions', summary.totalSessions, 'CRM login sessions', Monitor, 'bg-slate-100 text-slate-700']
  ]

  return <DashboardShell currentUser={user}>
    <div className="min-h-screen bg-[#f3f8f6] p-4 lg:p-6">
      <div className="w-full">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div><p className="text-[10px] font-black uppercase tracking-[.24em] text-orange-500">{misPage ? 'Management information system' : 'Super admin control center'}</p><h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">{misPage ? misTitle : REPORT_TITLE}</h1><p className="mt-2 text-sm font-semibold text-slate-500">Report Period: {formatReportDate(report.period.from)} - {formatReportDate(report.period.to)} · {misPage ? (operationsOnlyMis ? 'Operations and Client Master completion for your authorised team scope.' : 'Sales, Operations and Quotation MIS in one place.') : 'user presence, CRM activity, leads, tickets and risk.'}</p></div>
          <div className="flex flex-wrap gap-2"><button onClick={load} disabled={loading} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-teal-700 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-md disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>{misPage && <><button onClick={downloadCompleteMisExcel} disabled={loading || approvalCountsLoading || exportingExcel} className="group inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-700 via-teal-700 to-cyan-700 px-5 text-sm font-black text-white shadow-lg shadow-emerald-900/20 transition hover:-translate-y-0.5 hover:shadow-xl disabled:opacity-50"><span className="grid h-7 w-7 place-items-center rounded-lg bg-white/15 ring-1 ring-white/20">{exportingExcel || approvalCountsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}</span><span><span className="block leading-4">{approvalCountsLoading ? 'Loading Counts...' : exportingExcel ? 'Preparing Excel...' : 'Download Excel'}</span><span className="block text-[9px] font-bold tracking-wide text-emerald-100">COMPLETE MIS</span></span></button><button onClick={downloadCompletePdf} disabled={loading || approvalCountsLoading || Boolean(generatingMisPdf)} className="group inline-flex h-11 items-center gap-2 rounded-xl border border-orange-200 bg-white px-5 text-sm font-black text-orange-600 shadow-sm transition hover:-translate-y-0.5 hover:bg-orange-50 hover:shadow-md disabled:opacity-50">{generatingMisPdf === 'complete' || approvalCountsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}<span>{approvalCountsLoading ? 'Loading Counts...' : generatingMisPdf === 'complete' ? 'Preparing PDF...' : 'Download PDF'}</span></button></>}{!misPage && <><button onClick={downloadExcel} disabled={loading || exportingExcel} className="inline-flex h-11 items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 text-sm font-black text-emerald-700 disabled:opacity-50">{exportingExcel ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}{exportingExcel ? 'Exporting...' : 'Export Excel'}</button><button onClick={downloadPdf} disabled={loading || generatingPdf} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#075848] px-4 text-sm font-black text-white disabled:opacity-50">{generatingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{generatingPdf ? 'Generating PDF...' : 'Download PDF'}</button><button onClick={() => navigate('/dashboard/users')} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700"><Users className="h-4 w-4" />User Management</button></>}</div>
        </header>

        {misPage && <section className="mt-5 flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
          <div><p className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-700">MIS Report Period</p><p className="mt-1 text-sm font-semibold text-slate-500">Select the period used by your authorised MIS reports.</p></div>
          <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">From Date<input type="date" value={draftFilters.from} onChange={(event) => setDraftFilters((current) => ({ ...current, from: event.target.value }))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold normal-case" /></label>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">To Date<input type="date" value={draftFilters.to} onChange={(event) => setDraftFilters((current) => ({ ...current, to: event.target.value }))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold normal-case" /></label>
          </div>
        </section>}

        {misPage && <section className="mis-overview-grid mt-4 grid gap-4 md:grid-cols-2">
          <MisOverviewCard title="Sales MIS" subtitle="Complete lead ownership" icon={Users} tone="emerald" loading={loading} metrics={[["Total Leads", salesTotals.leads], ["Open Leads", salesTotals.open], ["Closed Leads", salesTotals.closed], ["Close Rate", `${salesTotals.leads ? ((salesTotals.closed / salesTotals.leads) * 100).toFixed(1) : 0}%`]]} />
          <MisOverviewCard title="Operation MIS" subtitle="Client Master workflow overview" icon={Building2} tone="blue" loading={loading} metrics={[["Client Masters", operationTotals.clients], ["Total Draft", operationTotals.draft], ["Total Submitted", operationTotals.submitted], ["Approved", allOperationGroups.reduce((sum, group) => sum + Number(group.approvedClients || 0), 0)]]} />
          <MisOverviewCard title="Quotation MIS" subtitle="Commercial performance" icon={FileText} tone="orange" loading={loading} metrics={[["Total", quotationTotals.total], ["Open", quotationTotals.open], ["Converted", quotationTotals.converted], ["Conversion", `${quotationTotals.total ? ((quotationTotals.converted / quotationTotals.total) * 100).toFixed(1) : 0}%`]]} />
          <MisOverviewCard title="Overall Summary" subtitle="Live CRM overview" icon={BarChart3} tone="violet" loading={loading} metrics={[["CRM Users", rows.length], ["Active Users", rows.filter((row) => row.active).length], ["Clients", operationTotals.clients], ["Quotations", quotationTotals.total]]} />
        </section>}

        <section className={`${misPage ? 'hidden' : ''} mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm`}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">From Date<input type="date" value={draftFilters.from} onChange={(event) => setDraftFilters((current) => ({ ...current, from: event.target.value }))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold normal-case" /></label>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">To Date<input type="date" value={draftFilters.to} onChange={(event) => setDraftFilters((current) => ({ ...current, to: event.target.value }))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold normal-case" /></label>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Role<select value={draftFilters.role} onChange={(event) => setDraftFilters((current) => ({ ...current, role: event.target.value }))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold normal-case"><option value="all">All roles</option>{roles.map((role) => <option key={role} value={role}>{roleLabels[role] || role}</option>)}</select></label>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">User<select value={draftFilters.user} onChange={(event) => setDraftFilters((current) => ({ ...current, user: event.target.value }))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold normal-case"><option value="all">All users</option>{rows.map((row) => <option key={String(row.id)} value={String(row.id)}>{row.name}</option>)}</select></label>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Risk Level<select value={draftFilters.risk} onChange={(event) => setDraftFilters((current) => ({ ...current, risk: event.target.value }))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold normal-case"><option value="all">All risk levels</option><option value="healthy">Low Risk</option><option value="stale">Medium Risk</option><option value="away">High Risk</option><option value="never">Never Logged In</option><option value="inactive">Inactive Account</option></select></label>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Online Status<select value={draftFilters.status} onChange={(event) => setDraftFilters((current) => ({ ...current, status: event.target.value }))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold normal-case"><option value="all">All statuses</option><option value="online">Online</option><option value="active">Active</option><option value="away">Away</option><option value="offline">Offline</option><option value="never logged in">Never Logged In</option></select></label>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Search<div className="relative mt-1"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={draftFilters.search} onChange={(event) => setDraftFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Name, email or role" className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm font-semibold outline-none focus:border-emerald-500 focus:bg-white" /></div></label>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2"><button onClick={resetFilters} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-black text-slate-600"><RotateCcw className="h-4 w-4" />Reset Filters</button></div>
        </section>

        {(error || exportError) && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error || exportError}</div>}
        <section className={`${misPage ? 'hidden' : ''} mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8`}>{cards.map(([label, value, note, Icon, tone]) => <MetricCard key={label} label={label} value={value} note={note} icon={Icon} tone={tone} loading={loading} />)}</section>

        {!misPage && <section className="mt-4 grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_310px]">
          <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-black text-slate-950">Active vs Away Time</h2><p className="text-xs font-semibold text-slate-500">Top users in selected period · minutes</p></div><Activity className="h-5 w-5 text-emerald-600" /></div><div className="mt-3 h-60">{chart.length ? <ResponsiveContainer><BarChart data={chart}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={10} /><YAxis fontSize={10} /><Tooltip /><Legend /><Bar dataKey="Active" fill="#059669" radius={[5, 5, 0, 0]} /><Bar dataKey="Away" fill="#f97316" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer> : <div className="grid h-full place-items-center text-sm font-bold text-slate-400">No chart data for selected period.</div>}</div></article>
          <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-orange-500" /><div><h2 className="font-black text-slate-950">Admin Attention</h2><p className="text-xs font-semibold text-slate-500">Accounts to review</p></div></div><div className="mt-3 space-y-2">{attention.map((item) => <button key={item.key} onClick={() => { const next = { ...draftFilters, risk: item.key }; setDraftFilters(next); setAppliedFilters(next) }} className="flex w-full items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-left hover:border-emerald-200"><span className="text-xs font-black text-slate-700">{item.label}</span><strong className="text-lg text-slate-950">{item.count}</strong></button>)}</div></aside>
        </section>}

        {misPage && misAccess.showSales && <SalesMisInfographic model={salesMisModel} loading={loading} period={report.period} onDownload={() => downloadMisPdf('sales')} downloading={generatingMisPdf === 'sales'} onOpenUser={setWorkReportUser} />}

        {misPage && <section className="mt-4 overflow-hidden rounded-2xl border border-cyan-200 bg-white shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-100 bg-gradient-to-r from-cyan-50 to-white px-5 py-4">
            <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-100 text-cyan-700"><Building2 className="h-5 w-5" /></span><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-cyan-700">Team hierarchy MIS</p><h2 className="text-xl font-black text-slate-950">Operation MIS</h2><p className="text-xs font-semibold text-slate-500">Team → Manager → Users · Client Master data completion analysis</p></div></div>
            <button type="button" onClick={() => downloadMisPdf('operation')} disabled={loading || approvalCountsLoading || Boolean(generatingMisPdf)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-cyan-700 px-4 text-sm font-black text-white disabled:opacity-50">{generatingMisPdf === 'operation' || approvalCountsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{approvalCountsLoading ? 'Loading Counts...' : generatingMisPdf === 'operation' ? 'Generating...' : 'Download Operation PDF'}</button>
          </header>
          <div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-sm"><thead className="bg-cyan-100 text-left text-[10px] font-black uppercase tracking-wider text-cyan-950"><tr className="border-b border-cyan-200"><th colSpan="6" className="bg-cyan-50 px-5 py-2"></th><th colSpan="3" className="bg-cyan-200 px-5 py-2 text-center text-xs tracking-[.16em] text-cyan-900">Compliance Status</th></tr><tr className="border-b border-cyan-200"><th className="px-5 py-3">Team / User</th><th className="px-5 py-3">Level</th><th className="px-5 py-3">Reports To</th><th className="px-5 py-3 text-right">Total Clients</th><th className="px-5 py-3 text-right">Draft</th><th className="px-5 py-3 text-right">Submitted</th><th className="px-5 py-3 text-right">Approved</th><th className="px-5 py-3 text-right">Partially Approved</th><th className="px-5 py-3 text-right">Reject</th></tr></thead><tbody>
            {operationGroups.flatMap((group) => {
              const people = [...(group.manager ? [group.manager] : []), ...group.members]
              const teamRow = <tr key={`team-${group.id}`} className="border-t-2 border-cyan-100 bg-cyan-50/70 font-black text-slate-900"><td className="px-5 py-4"><span className="inline-flex items-center gap-2"><Building2 className="h-4 w-4 text-cyan-700" />{group.name}</span></td><td className="px-5 py-4"><span className="rounded-full bg-cyan-100 px-2.5 py-1 text-[10px] uppercase text-cyan-800">Team Total</span></td><td className="px-5 py-4">{group.manager?.name || '-'}</td><td className="px-5 py-4 text-right text-lg">{group.clientMasters}</td><td className="px-5 py-4 text-right text-orange-600">{group.draftClients || 0}</td><td className="px-5 py-4 text-right text-emerald-700">{group.submittedClients || 0}</td><td className="px-5 py-4 text-right text-emerald-700">{group.approvedClients || 0}</td><td className="px-5 py-4 text-right text-amber-600">{group.partiallyApprovedClients || 0}</td><td className="px-5 py-4 text-right text-rose-600">{group.rejectedClients || 0}</td></tr>
              const peopleRows = people.map((row) => <tr key={`${group.id}-${row.id}`} className="border-t border-slate-100 font-semibold text-slate-700 hover:bg-slate-50"><td className="py-3 pl-10 pr-5"><button type="button" onClick={() => setWorkReportUser({ ...row, initialView: "clients" })} className="block text-left font-black text-slate-950 hover:text-cyan-700 hover:underline">{row.name}</button><small className="text-slate-500">{row.email}</small></td><td className="px-5 py-3"><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${row === group.manager ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700'}`}>{row === group.manager ? 'Manager' : 'User'}</span></td><td className="px-5 py-3">{row === group.manager ? '—' : group.manager?.name || 'Not assigned'}</td><td className="px-5 py-3 text-right font-black">{row.clientMasters || 0}</td><td className="px-5 py-3 text-right font-black text-orange-600">{row.draftClients || 0}</td><td className="px-5 py-3 text-right font-black text-emerald-700">{row.submittedClients || 0}</td><td className="px-5 py-3 text-right font-black text-emerald-700">{row.approvedClients || 0}</td><td className="px-5 py-3 text-right font-black text-amber-600">{row.partiallyApprovedClients || 0}</td><td className="px-5 py-3 text-right font-black text-rose-600">{row.rejectedClients || 0}</td></tr>)
              return [teamRow, ...peopleRows]
            })}
            {!loading && !operationGroups.length && <tr><td colSpan="9" className="p-10 text-center font-bold text-slate-400">No Operation teams found.</td></tr>}
          </tbody></table></div>
          <MisPagination page={operationPage} total={allOperationGroups.length} onPageChange={setOperationPage} />
        </section>}

        {misPage && misAccess.showQuotations && <section className="mt-4 overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-orange-100 bg-gradient-to-r from-orange-50 to-white px-5 py-4">
            <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-orange-100 text-orange-700"><FileText className="h-5 w-5" /></span><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-orange-700">Commercial MIS</p><h2 className="text-xl font-black text-slate-950">Quotation MIS</h2><p className="text-xs font-semibold text-slate-500">All quotations · latest quotation first</p></div></div>
            <button type="button" onClick={() => navigate('/sales/quotations')} className="inline-flex h-10 items-center gap-2 rounded-xl bg-orange-500 px-4 text-sm font-black text-white">Open Quotations</button>
          </header>
          <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-sm"><thead className="bg-slate-50 text-left text-[10px] font-black uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Quotation</th><th className="px-5 py-3">Company</th><th className="px-5 py-3">PO Status</th><th className="px-5 py-3">Prepared By</th><th className="px-5 py-3">Valid Until</th><th className="px-5 py-3 text-right">Items</th><th className="px-5 py-3 text-right">Amount</th><th className="px-5 py-3">Status</th></tr></thead><tbody>
            {quotationMisRows.map((row, index) => { const poStatus = poStatusDisplay(row.poMisStatus); return <tr key={entityId(row._id || row.id) || index} className={`border-t border-slate-100 font-semibold text-slate-700 hover:bg-orange-50/50 ${index === 0 ? 'bg-orange-50/60' : ''}`}><td className="px-5 py-3"><strong className="text-orange-700">{displayText(row.quotationNumber)}</strong>{index === 0 && <small className="ml-2 rounded-full bg-orange-500 px-2 py-1 text-[9px] font-black uppercase text-white">Latest</small>}</td><td className="px-5 py-3 font-black text-slate-950">{displayText(row.companyName || row.leadDetails?.companyName)}</td><td className="px-5 py-3"><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${poStatus.tone}`}>{poStatus.label}</span></td><td className="px-5 py-3">{displayText(row.preparedBy || row.createdByName || row.createdBy)}</td><td className="px-5 py-3">{formatReportDate(row.validUntil)}</td><td className="px-5 py-3 text-right font-black">{row.items?.length || 0}</td><td className="px-5 py-3 text-right font-black text-orange-700">₹{(Number(row.grandTotal) || 0).toLocaleString('en-IN')}</td><td className="px-5 py-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-700">{displayText(row.status, 'draft')}</span></td></tr> })}
            {!loading && !quotationMisRows.length && <tr><td colSpan="8" className="p-10 text-center font-bold text-slate-400">No quotations found.</td></tr>}
          </tbody></table></div>
          <MisPagination page={quotationPage} total={allQuotationMisRows.length} onPageChange={setQuotationPage} />
        </section>}

        <section onClickCapture={(event) => { const cell = event.target.closest('td'); if (!cell || cell.cellIndex !== 1) return; const tableRow = cell.closest('tr'); const index = tableRow ? tableRow.sectionRowIndex : -1; if (index >= 0 && visible[index]) setWorkReportUser(visible[index]) }} className={`${misPage ? 'hidden' : ''} mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm`}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4"><div><h2 className="text-lg font-black text-slate-950">{REPORT_TITLE}</h2><p className="text-xs font-semibold text-slate-500">{visible.length} users · Report Period: {formatReportDate(report.period.from)} - {formatReportDate(report.period.to)}</p></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">Live aggregated data</span></div>
          <div className="max-h-[720px] overflow-auto"><table className="w-full min-w-[1750px] text-left text-sm"><thead><tr><th className="sticky top-0 z-10 bg-slate-50 px-3 py-3 text-center text-[10px] font-black uppercase text-slate-500">Sr. No.</th><th className="sticky top-0 z-10 bg-slate-50 px-3 py-3 text-[10px] font-black uppercase text-slate-500">User Name</th><th className="sticky top-0 z-10 bg-slate-50 px-3 py-3 text-[10px] font-black uppercase text-slate-500">Role</th><th className="sticky top-0 z-10 bg-slate-50 px-3 py-3 text-[10px] font-black uppercase text-slate-500">Status</th><SortHeading label="Productivity Score" value="score" sort={sort} onSort={changeSort} align="center" /><SortHeading label="Total Leads" value="totalLeads" sort={sort} onSort={changeSort} align="right" /><SortHeading label="Closed Leads" value="closedLeads" sort={sort} onSort={changeSort} align="right" /><SortHeading label="Active Time" value="activeSeconds" sort={sort} onSort={changeSort} align="right" /><SortHeading label="Away Time" value="awaySeconds" sort={sort} onSort={changeSort} align="right" /><SortHeading label="Sessions" value="sessions" sort={sort} onSort={changeSort} align="right" /><SortHeading label="Support Tickets Raised" value="tickets" sort={sort} onSort={changeSort} align="right" /><th className="sticky top-0 z-10 bg-slate-50 px-3 py-3 text-[10px] font-black uppercase text-slate-500">Last Activity</th><SortHeading label="Risk Level" value="risk" sort={sort} onSort={changeSort} /><th className="sticky top-0 z-10 bg-slate-50 px-3 py-3 text-center text-[10px] font-black uppercase text-slate-500">Details</th></tr></thead><tbody>
            {loading ? Array.from({ length: 6 }).map((_, index) => <tr key={index} className="border-t border-slate-100"><td colSpan="14" className="px-4 py-3"><div className="h-10 animate-pulse rounded-xl bg-slate-100" /></td></tr>) : visible.map((row, index) => <tr key={String(row.id)} className="border-t border-slate-100 font-semibold text-slate-700 odd:bg-white even:bg-slate-50/50 hover:bg-emerald-50/60"><td className="px-3 py-3 text-center font-black text-slate-400">{index + 1}</td><td className="px-3 py-3"><strong className="block text-slate-950">{row.name}</strong><small className="text-slate-500">{row.email}</small></td><td className="px-3"><strong>{row.roleLabel}</strong><small className="block text-slate-500">{row.team || 'No team assigned'}</small></td><td className="px-3"><span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${presenceTone(row.presence)}`}>{row.presence}</span></td><td className="px-3 text-center"><strong className="text-slate-950">{row.score}/100</strong><div className="mx-auto mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${row.score}%` }} /></div></td><td className="px-3 text-right font-black">{row.totalLeads}</td><td className="px-3 text-right font-black text-emerald-700">{row.closedLeads}</td><td className="px-3 text-right font-black text-emerald-700">{formatDuration(row.activeSeconds)}</td><td className="px-3 text-right font-black text-orange-700">{formatDuration(row.awaySeconds)}</td><td className="px-3 text-right font-black">{row.sessions}</td><td className="px-3 text-right"><strong className="text-emerald-800">{row.tickets.total}</strong><small className="block text-slate-500">Open {row.tickets.open} · Resolved {row.tickets.resolved}</small></td><td className="px-3 text-xs">{formatDateTime(row.lastActivity)}</td><td className="px-3"><span title={row.risk.reason} className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black ring-1 ${riskTone(row.risk.key)}`}>{row.risk.level}</span><small className="mt-1 block max-w-[170px] text-slate-500">{row.risk.reason}</small></td><td className="px-3 text-center"><button onClick={() => setSelected(row)} title="View user activity details" className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-emerald-700 hover:border-emerald-300"><Eye className="h-4 w-4" /></button></td></tr>)}
            {!loading && !visible.length && <tr><td colSpan="14" className="p-14 text-center"><Activity className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 font-black text-slate-500">No user activity found for the selected period.</p><p className="mt-1 text-xs text-slate-400">Reset filters or choose a different date range.</p></td></tr>}
          </tbody></table></div>
        </section>
      </div>
    </div>

    {workReportUser && <UserWorkDrilldown user={workReportUser} from={report.period.from} to={report.period.to} initialView={workReportUser.initialView || 'sales'} onClose={() => setWorkReportUser(null)} />}
    {selected && <div className="fixed inset-0 z-[120] bg-slate-950/45 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}><aside className="ml-auto flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"><header className="border-b border-slate-200 bg-gradient-to-r from-emerald-50 to-white p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-emerald-700">User activity profile</p><h2 className="mt-1 text-2xl font-black text-slate-950">{selected.name}</h2><p className="text-sm font-semibold text-slate-500">{selected.email} · {selected.roleLabel}</p></div><button onClick={() => setSelected(null)} className="grid h-10 w-10 place-items-center rounded-xl bg-white text-slate-500 shadow-sm"><X className="h-5 w-5" /></button></div><div className="mt-4 grid grid-cols-4 gap-2"><div className="rounded-xl bg-white p-3"><small className="font-black uppercase text-slate-400">Score</small><strong className="mt-1 block text-lg">{selected.score}/100</strong></div><div className="rounded-xl bg-white p-3"><small className="font-black uppercase text-slate-400">Sessions</small><strong className="mt-1 block text-lg">{selected.sessions}</strong></div><div className="rounded-xl bg-white p-3"><small className="font-black uppercase text-slate-400">Actions</small><strong className="mt-1 block text-lg">{selected.activityCount}</strong></div><div className="rounded-xl bg-white p-3"><small className="font-black uppercase text-slate-400">Tickets</small><strong className="mt-1 block text-lg">{selected.tickets.total}</strong></div></div></header><div className="flex-1 space-y-5 overflow-y-auto p-5"><section><h3 className="flex items-center gap-2 text-sm font-black text-slate-950"><CalendarDays className="h-4 w-4 text-emerald-600" />Daily timeline</h3><div className="mt-3 space-y-2">{selected.timeline.length ? selected.timeline.map((day) => <article key={day.date} className="rounded-2xl border border-slate-200 p-4"><div className="flex items-center justify-between"><strong>{formatReportDate(day.date)}</strong><span className="text-xs font-bold text-slate-500">{day.actions} actions</span></div><div className="mt-3 grid grid-cols-2 gap-3 text-xs"><p><span className="block font-black uppercase text-slate-400">First login</span>{formatDateTime(day.firstLogin)}</p><p><span className="block font-black uppercase text-slate-400">Last activity</span>{formatDateTime(day.lastSeen)}</p><p><span className="block font-black uppercase text-slate-400">Active</span>{formatDuration(day.activeSeconds)}</p><p><span className="block font-black uppercase text-slate-400">Away</span>{formatDuration(day.awaySeconds)}</p></div><p className="mt-3 text-xs font-bold text-slate-500">Modules: {day.modules.join(', ') || 'No module actions'}</p></article>) : <p className="rounded-xl bg-slate-50 p-5 text-sm font-bold text-slate-500">No sessions in selected period.</p>}</div></section><section><h3 className="flex items-center gap-2 text-sm font-black text-slate-950"><Activity className="h-4 w-4 text-violet-600" />Recent CRM actions</h3><div className="mt-3 space-y-2">{selected.recentActions.length ? selected.recentActions.map((action, index) => <article key={action.id || index} className="rounded-xl border border-slate-100 bg-slate-50 p-3"><div className="flex justify-between gap-3"><strong className="text-xs text-emerald-800">{action.module}</strong><small className="text-slate-400">{formatDateTime(action.occurredAt)}</small></div><p className="mt-1 text-sm font-semibold text-slate-700">{action.description}</p></article>) : <p className="rounded-xl bg-slate-50 p-5 text-sm font-bold text-slate-500">No recorded actions.</p>}</div></section><section className="rounded-2xl border border-slate-200 p-4"><h3 className="flex items-center gap-2 text-sm font-black"><Monitor className="h-4 w-4 text-slate-500" />Latest access</h3><p className="mt-3 text-xs font-bold text-slate-600">IP: {selected.latestAccess?.ipAddress || '-'}</p><p className="mt-1 break-words text-xs font-bold text-slate-600">Device: {selected.latestAccess?.device || '-'}</p></section><section className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4"><h3 className="flex items-center gap-2 text-sm font-black text-emerald-900"><Lightbulb className="h-4 w-4" />Risk assessment</h3><p className="mt-2 text-sm font-black text-slate-800">{selected.risk.level}</p><p className="mt-1 text-xs font-semibold text-slate-600">{selected.risk.reason}</p></section></div><footer className="grid gap-2 border-t border-slate-200 p-4 sm:grid-cols-2"><button onClick={() => navigate('/dashboard/users')} className="h-11 rounded-xl border border-emerald-200 font-black text-emerald-700">View Full Logs</button><button onClick={() => navigate('/dashboard/users')} className="h-11 rounded-xl bg-[#075848] font-black text-white">Open User Management</button></footer></aside></div>}
  </DashboardShell>
}
