import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { AnimatePresence, motion } from 'framer-motion'
import { useLocation, useNavigate } from 'react-router-dom'
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps'
import indiaStatesGeoJson from '../assets/india-states.json'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart as RechartsPieChart,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import ResponsiveContainer from '../components/charts/SafeResponsiveContainer'
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Building2,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  FileClock,
  FileText,
  Download,
  Gauge,
  Eye,
  FolderOpen,
  Flag,
  ListChecks,
  Mail,
  MoreVertical,
  PieChart,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Target,
  TrendingUp,
  UserRound,
  Users,
  X,
  Zap
} from 'lucide-react'
import PurchaseSalesProgress from '../components/dashboard/PurchaseSalesProgress'
import AddUserModal from '../components/dashboard/AddUserModal'
import CreateTeamModal from '../components/dashboard/CreateTeamModal'
import EditUserModal from '../components/dashboard/EditUserModal'
import KpiSummary from '../components/dashboard/KpiSummary'
import ProfileModal from '../components/dashboard/ProfileModal'
import Sidebar from '../components/dashboard/Sidebar'
import Topbar from '../components/dashboard/Topbar'
import UserActionsMenu from '../components/dashboard/UserActionsMenu'
import UserDetailsModal from '../components/dashboard/UserDetailsModal'
import PremiumQuotationModal from '../components/PremiumQuotationModal'
import ToastMessage from '../components/ToastMessage'
import { adminRoles, defaultUserForm, getUserRoles, hasAnyRole, roleLabels, roles as defaultRoles } from '../constants/dashboard'
import api, { storeSessionUser } from '../services/api'
import { API_ENDPOINTS } from '../services/apiEndpoints'
import { downloadOperationMisPdf } from '../utils/productivityReportExports'
import { formatDisplayDate, formatDisplayDateTime } from '../utils/dateFormat'
import { allocationOwnerKeys, buildOperationsProgressGroups, buildOperationsWorkbookData, getOperationsStatusDates, getOperationsFinalFlag, getPoFinancialYear, permanentStaffOwnerKeys, selectRowsForPoFinancialYear } from '../utils/operationsUserProgress.mjs'
import { downloadOperationsReportPdf } from '../utils/operationsReportPdf.mjs'

const CALENDAR_TODO_STORAGE_KEY = 'crm.calendar.todos.v1'
const DASHBOARD_CACHE_KEY = 'crm.dashboard.cache.v10'
const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000
const DASHBOARD_REQUEST_TIMEOUT_MS = 30000

function isUserActive(user = {}) {
  const value = user?.isActive
  return !(value === false || value === 0 || ['false', '0', 'inactive'].includes(String(value || '').trim().toLowerCase()))
}

function readSessionCache(key, ttlMs = DASHBOARD_CACHE_TTL_MS) {
  const stores = [sessionStorage, localStorage].filter(Boolean)
  for (const store of stores) {
    try {
      const parsed = JSON.parse(store.getItem(key) || 'null')
      if (!parsed || Date.now() - Number(parsed.savedAt || 0) > ttlMs) continue
      return parsed.data || null
    } catch {
      // Try the next cache store.
    }
  }
  return null
}

function writeSessionCache(key, data) {
  const payload = JSON.stringify({ savedAt: Date.now(), data })
  for (const store of [sessionStorage, localStorage].filter(Boolean)) {
    try {
      store.setItem(key, payload)
    } catch {
      // Cache is only for faster navigation.
    }
  }
}

async function fetchDashboardCollection(endpoint, key, requestConfig = {}, extraParams = {}) {
  const params = { ...requestConfig.params, ...extraParams, paginated: true, page: 1, limit: 100 };
  const first = await api.get(endpoint, { ...requestConfig, params });
  const totalPages = Number(first.data?.pagination?.totalPages || first.data?.pagination?.pages || 1);
  const remaining = totalPages > 1
    ? await Promise.all(Array.from({ length: totalPages - 1 }, (_, index) => (
      api.get(endpoint, { ...requestConfig, params: { ...params, page: index + 2 } })
    )))
    : [];
  return { data: { ...first.data, [key]: [first, ...remaining].flatMap((response) => response.data?.[key] || []) } };
}

function readCalendarTodoItems() {
  const items = []
  const seen = new Set()
  for (const store of [localStorage, sessionStorage].filter(Boolean)) {
    try {
      const parsed = JSON.parse(store.getItem(CALENDAR_TODO_STORAGE_KEY) || '[]')
      if (!Array.isArray(parsed)) continue
      parsed.forEach((item, index) => {
        const key = String(item.id || item._id || `${item.title || ''}-${item.scheduledDate || ''}-${item.scheduledTime || ''}-${index}`)
        if (seen.has(key)) return
        seen.add(key)
        items.push(item)
      })
    } catch {
      // Try the next browser store.
    }
  }
  return items
}

function isCalendarFollowUp(item = {}) {
  return item.type === 'follow-up' || item.category === 'Follow-Up'
}

function calendarItemBelongsToUser(item = {}, user = {}) {
  const safeUser = user || {}
  const role = normalizeKey(safeUser.role)
  if (adminRoles.map(normalizeKey).includes(role) || role === 'admin' || role === 'superadmin' || role === 'super admin') return true
  const userTokens = [safeUser.name, safeUser.email, safeUser.firstName && safeUser.lastName ? `${safeUser.firstName} ${safeUser.lastName}` : '', safeUser._id, safeUser.id]
    .filter(Boolean)
    .map((value) => normalizeKey(value))
  if (!userTokens.length) return true
  const ownerTokens = [item.assignedTo, item.assignedToName, item.assignedToEmail, item.assignedToId, item.createdBy, item.owner, item.scheduledBy]
    .filter(Boolean)
    .map((value) => normalizeKey(value))
  if (!ownerTokens.length) return true
  return ownerTokens.some((owner) => userTokens.some((token) => owner === token || owner.includes(token) || token.includes(owner)))
}

function getLeadFollowUpCompany(lead = {}) {
  return displayValue(lead.companyName || lead.company || lead.clientName || lead['Company Name'] || lead.Company || lead.leadCompanyName, 'Lead follow-up')
}

function getLeadFollowUpOwner(lead = {}) {
  const assigned = lead.assignedTo && typeof lead.assignedTo === 'object' ? lead.assignedTo : {}
  const creator = lead.createdBy && typeof lead.createdBy === 'object' ? lead.createdBy : {}
  return displayValue(
    lead.assignedToName || assigned.name || assigned.email || lead.assignedToText || lead.assignedToEmail ||
    (typeof lead.assignedTo === 'string' ? lead.assignedTo : '') || lead.ownerName || lead.importedCreatedBy ||
    lead.createdByName || creator.name || creator.email || (typeof lead.createdBy === 'string' ? lead.createdBy : '') ||
    lead.assignedBy || lead.leadGeneratedBy,
    'Unassigned'
  )
}

function buildLeadFollowUpItems(leads = []) {
  return leads
    .filter((lead) => lead.nextFollowUpDate || lead['Next Follow-Up Date'])
    .flatMap((lead, index) => {
      const scheduledDate = lead.nextFollowUpDate || lead['Next Follow-Up Date']
      const scheduledTime = lead.nextFollowUpTime || lead['Next Follow-Up Time'] || ''
      const company = getLeadFollowUpCompany(lead)
      const services = (Array.isArray(lead.serviceSelections) && lead.serviceSelections.length ? lead.serviceSelections : [lead])
        .filter((service) => !service.closedBy && !service.closedByText)
      return services.map((service, serviceIndex) => ({
        id: `lead-follow-up-${lead._id || lead.id || lead.leadCode || lead.leadNumber || index}-${serviceIndex}`,
        title: lead.followUpTitle || `${service.servicesOffered || service.applicableService || 'Service'} follow-up`,
        description: lead.followUpRemarks || lead['Follow-Up Remarks'] || lead.remarks || '',
        clientName: lead.clientName || '',
        leadCompanyName: company,
        leadNumber: lead.leadCode || lead.leadNumber || lead['Lead Number'] || '',
        assignedTo: service.createdByCrmUserId || service.createdByEmail || lead.assignedTo || lead.assignedToId || getLeadFollowUpOwner(lead),
        assignedToName: service.createdByName || service.createdByEmail || getLeadFollowUpOwner(lead),
        assignedToEmail: service.createdByEmail || lead.assignedToEmail || lead.ownerEmail || lead.createdByEmail || '',
        assignedToId: service.createdByCrmUserId || lead.assignedToId || lead.assignedTo?._id || lead.assignedTo?.id || '',
        createdBy: lead.createdBy || lead.createdById || '',
        createdByName: lead.createdByName || lead.importedCreatedBy || '',
        createdByEmail: lead.createdByEmail || '',
        scheduledDate,
        scheduledTime,
        priority: lead.followUpPriority || lead.priority || 'Medium',
        category: 'Follow-Up',
        status: lead.followUpStatus || lead.status || 'open',
        type: 'follow-up',
        source: 'lead',
        followUpHistory: Array.isArray(lead.followUpHistory) ? lead.followUpHistory : [],
        updatedAt: lead.updatedAt || '',
        createdAt: lead.createdAt || lead.importedCreatedAt || '',
        serviceName: service.servicesOffered || service.applicableService || '',
        serviceContributor: service.createdByName || service.createdByEmail || ''
      }))
    })
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remaining = seconds % 60
  return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', `${remaining}s`].filter(Boolean).join(' ')
}

function auditDateKey(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const pick = (type) => parts.find((item) => item.type === type)?.value || ''
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

function formatAuditDate(value) {
  return formatDisplayDate(value)
}

function formatAuditTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
}

function buildDailyLogRows(sessionRows = []) {
  const groups = new Map()
  const timestamp = (value) => value ? new Date(value).getTime() : 0
  for (const row of sessionRows) {
    const logDate = auditDateKey(row.loginAt || row.lastActivityAt)
    if (!logDate) continue
    const userKey = String(row.userId || row.email || row.name || 'unknown')
    const key = `${userKey}:${logDate}`
    const existing = groups.get(key)
    const endAt = row.logoutAt || row.offlineSince || row.lastActivityAt || row.loginAt
    if (!existing) {
      groups.set(key, {
        ...row,
        id: `daily-${key}`,
        logDate,
        firstLoginAt: row.loginAt,
        lastActivityAt: row.lastActivityAt || row.loginAt,
        offlineAt: row.sessionStatus === 'Online' ? null : endAt,
        durationSeconds: Math.max(0, Number(row.durationSeconds) || 0),
        activeSeconds: Math.max(0, Number(row.activeSeconds) || 0),
        awaySeconds: Math.max(0, (Number(row.durationSeconds) || 0) - (Number(row.activeSeconds) || 0)),
        sessionCount: 1,
        activityCount: Math.max(0, Number(row.activityCount) || 0),
        activities: [...(row.activities || [])],
        completedLeads: [...(row.completedLeads || [])]
      })
      continue
    }
    existing.firstLoginAt = timestamp(row.loginAt) < timestamp(existing.firstLoginAt) ? row.loginAt : existing.firstLoginAt
    if (timestamp(row.lastActivityAt) >= timestamp(existing.lastActivityAt)) {
      existing.lastActivityAt = row.lastActivityAt || existing.lastActivityAt
      existing.ipAddress = row.ipAddress || existing.ipAddress
      existing.device = row.device || existing.device
    }
    existing.durationSeconds += Math.max(0, Number(row.durationSeconds) || 0)
    existing.activeSeconds += Math.max(0, Number(row.activeSeconds) || 0)
    existing.awaySeconds += Math.max(0, (Number(row.durationSeconds) || 0) - (Number(row.activeSeconds) || 0))
    existing.sessionCount += 1
    existing.activityCount += Math.max(0, Number(row.activityCount) || 0)
    existing.activities.push(...(row.activities || []))
    existing.completedLeads.push(...(row.completedLeads || []))
    if (row.sessionStatus === 'Online') {
      existing.sessionStatus = 'Online'
      existing.offlineAt = null
    } else if (existing.sessionStatus !== 'Online' && timestamp(endAt) >= timestamp(existing.offlineAt)) {
      existing.sessionStatus = row.sessionStatus
      existing.offlineAt = endAt
    }
  }
  return [...groups.values()].map((row) => ({
    ...row,
    loginAt: row.firstLoginAt,
    logoutAt: row.offlineAt,
    offlineSince: row.offlineAt,
    activities: row.activities.sort((a, b) => timestamp(b.occurredAt) - timestamp(a.occurredAt))
  })).sort((a, b) => b.logDate.localeCompare(a.logDate) || timestamp(b.firstLoginAt) - timestamp(a.firstLoginAt))
}

function latestUserSessions(rows = []) {
  const latest = new Map()
  for (const row of rows) {
    const key = String(row.userId || row.email || row.name || row.id)
    const current = latest.get(key)
    if (!current || new Date(row.loginAt || 0).getTime() > new Date(current.loginAt || 0).getTime()) latest.set(key, row)
  }
  return [...latest.values()]
}

function UserLogsModal({ onClose }) {
  const [rows, setRows] = useState([])
  const [modules, setModules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState('')
  const [filters, setFilters] = useState({ search: '', role: 'all', status: 'all', module: 'all', from: '', to: '' })
  const [statusClock, setStatusClock] = useState(Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setStatusClock(Date.now()), 15000)
    return () => window.clearInterval(timer)
  }, [])

  async function loadLogs() {
    setLoading(true); setError('')
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([key, value]) => key !== 'search' && value && value !== 'all'))
      const response = await api.get(API_ENDPOINTS.auth.auditLogs, { params, timeout: 15000 })
      setRows(response.data.rows || []); setModules(response.data.modules || [])
    } catch (err) { setError(err?.response?.data?.error || 'Unable to load user logs.') }
    finally { setLoading(false) }
  }

  useEffect(() => { loadLogs() }, [filters.role, filters.status, filters.module, filters.from, filters.to])
  const dailyRows = useMemo(() => buildDailyLogRows(rows), [rows])
  const matchesSearch = (row) => `${row.name} ${row.email} ${row.team} ${row.ipAddress}`.toLowerCase().includes(filters.search.toLowerCase())
  const visible = dailyRows.filter(matchesSearch)
  const statusRows = latestUserSessions(rows).filter(matchesSearch)

  useEffect(() => {
    try {
      const setHoverForGaurav = () => {
        const smalls = Array.from(document.querySelectorAll('small'))
          .filter((el) => el.textContent && el.textContent.trim() === 'sustainability.manager@ananttattva.com')
        for (const s of smalls) {
          const td = s.closest('td')
          const strong = td && td.querySelector('strong')
          if (strong) strong.setAttribute('title', '4')
        }
      }
      setHoverForGaurav()
      const obs = new MutationObserver(setHoverForGaurav)
      obs.observe(document.body, { childList: true, subtree: true })
      return () => obs.disconnect()
    } catch {
      // noop
    }
  }, [visible])

  function exportLogs() {
    const dailyExportRows = visible.map((row) => ({
      Date: formatAuditDate(row.logDate), Name: row.name, Email: row.email, Role: row.role, Team: row.team,
      'First Login': row.firstLoginAt ? formatDisplayDateTime(row.firstLoginAt) : '',
      'Offline / Last Seen': row.offlineAt ? formatDisplayDateTime(row.offlineAt) : 'Still online',
      'Online Window': `${formatAuditTime(row.firstLoginAt)} - ${row.offlineAt ? formatAuditTime(row.offlineAt) : 'Online'}`,
      'Online / Active Duration': formatDuration(row.activeSeconds),
      'Away / Other Tab Duration': formatDuration(row.awaySeconds),
      'Total Open Duration': formatDuration(row.durationSeconds),
      Sessions: row.sessionCount, Activities: row.activityCount, Status: row.sessionStatus,
      'IP Address': row.ipAddress, Device: row.device
    }))
    const rawSessionRows = rows.filter(matchesSearch).map((row) => ({
      Name: row.name, Email: row.email, Role: row.role, Team: row.team, 'User Status': row.userStatus,
      Login: row.loginAt ? formatDisplayDateTime(row.loginAt) : '',
      'Last Activity': row.lastActivityAt ? formatDisplayDateTime(row.lastActivityAt) : '',
      Logout: row.logoutAt ? formatDisplayDateTime(row.logoutAt) : '',
      'Session Status': row.sessionStatus,
      'Online / Active For': formatDuration(row.activeSeconds),
      'Offline / Away For': formatDuration(row.sessionStatus === 'Online' ? Math.max(0, row.durationSeconds - row.activeSeconds) : Math.max(0, Math.round((statusClock - new Date(row.offlineSince || row.lastActivityAt).getTime()) / 1000))),
      'Offline Since / Last Seen': row.offlineSince ? formatDisplayDateTime(row.offlineSince) : '',
      'Open Duration': formatDuration(row.durationSeconds), 'Active CRM Time': formatDuration(row.activeSeconds), 'Away / Other Tab Time': formatDuration(Math.max(0, row.durationSeconds - row.activeSeconds)), Activities: row.activityCount,
      'IP Address': row.ipAddress, Device: row.device
    }))
    const activityRows = visible.flatMap((row) => (row.activities || []).map((item) => ({
      Name: row.name, Email: row.email, Role: row.role, Module: item.module, Action: item.action,
      Description: item.description, Date: item.occurredAt ? formatDisplayDateTime(item.occurredAt) : '',
      'HTTP Status': item.statusCode
    })))
    const leadRows = visible.flatMap((row) => (row.completedLeads || []).map((lead) => ({
      User: row.name, Email: row.email, Company: lead.company, 'Lead ID': lead.leadCode,
      'Form Started': lead.formStartedAt ? formatDisplayDateTime(lead.formStartedAt) : '',
      'Assign Reached': lead.assignReachedAt ? formatDisplayDateTime(lead.assignReachedAt) : '',
      'Submitted / Closed': lead.submittedAt ? formatDisplayDateTime(lead.submittedAt) : '',
      'Time To Fill': formatDuration(lead.fillDurationSeconds)
    })))
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(dailyExportRows), 'Daily User Summary')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rawSessionRows), 'Login Sessions')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(activityRows), 'CRM Activities')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(leadRows), 'Lead Completion Time')
    XLSX.writeFile(workbook, `CRM_User_Logs_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="flex max-h-[94vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-5">
        <div><p className="text-xs font-black uppercase tracking-[.24em] text-emerald-700">Security & activity audit</p><h2 className="mt-1 text-2xl font-black text-slate-950">User Login & CRM Logs</h2><p className="text-sm font-semibold text-slate-500">Focused CRM time excludes hidden tabs and other websites; Excel includes open, active and away time.</p></div>
        <div className="flex gap-2"><button type="button" onClick={exportLogs} disabled={!visible.length} className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-700 px-5 text-sm font-black text-white disabled:opacity-50"><Download className="h-4 w-4"/>Download Excel</button><button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100"><X className="h-5 w-5"/></button></div>
      </header>
      <div className="grid gap-2 border-b border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-6">
        <input value={filters.search} onChange={(e) => setFilters((v) => ({ ...v, search: e.target.value }))} placeholder="Search name, email, IP" className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold xl:col-span-2"/>
        <select value={filters.role} onChange={(e) => setFilters((v) => ({ ...v, role: e.target.value }))} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold"><option value="all">All roles</option>{[...new Set(rows.map((r) => r.role).filter(Boolean))].map((role) => <option key={role} value={role}>{roleLabels[role] || role}</option>)}</select>
        <select value={filters.status} onChange={(e) => setFilters((v) => ({ ...v, status: e.target.value }))} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold"><option value="all">All users</option><option value="active">Active users</option><option value="inactive">Inactive users</option></select>
        <select value={filters.module} onChange={(e) => setFilters((v) => ({ ...v, module: e.target.value }))} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold"><option value="all">All CRM modules</option>{modules.map((item) => <option key={item}>{item}</option>)}</select>
        <button type="button" onClick={loadLogs} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white text-sm font-black text-emerald-700"><RefreshCw className="h-4 w-4"/>Refresh</button>
        <label className="text-xs font-black text-slate-500">From<input type="date" value={filters.from} onChange={(e) => setFilters((v) => ({ ...v, from: e.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-2"/></label>
        <label className="text-xs font-black text-slate-500">To<input type="date" value={filters.to} onChange={(e) => setFilters((v) => ({ ...v, to: e.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-2"/></label>
      </div>
      <div className="overflow-auto p-4">
        {error && <ToastMessage type="error">{error}</ToastMessage>}
        {!loading && statusRows.length > 0 && <div className="mb-3 flex gap-2 overflow-x-auto pb-1">{statusRows.map((row) => {
          const online = row.sessionStatus === 'Online'
          const offlineSeconds = Math.max(0, Math.round((statusClock - new Date(row.offlineSince || row.lastActivityAt).getTime()) / 1000))
          return <article key={`status-${row.id}`} className={`min-w-[220px] rounded-xl border px-3 py-2 ${online ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
            <div className="flex items-center justify-between gap-2"><strong className="truncate text-xs text-slate-900">{row.name}</strong><span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${online ? 'bg-emerald-200 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>{row.sessionStatus}</span></div>
            <p className="mt-1 text-xs font-black text-slate-700">{online ? `Online for ${formatDuration(row.activeSeconds)}` : `Offline for ${formatDuration(offlineSeconds)}`}</p>
            <small className="block text-[10px] font-semibold text-slate-500">{online ? `Away/other tabs: ${formatDuration(Math.max(0, row.durationSeconds - row.activeSeconds))}` : `Last seen: ${formatDateTime(row.offlineSince || row.lastActivityAt)}`}</small>
          </article>
        })}</div>}
        {loading ? <div className="p-12 text-center font-black text-slate-500">Loading user logs...</div> : <table className="w-full min-w-[1500px] border-separate border-spacing-y-2 text-left text-sm"><thead><tr className="text-xs uppercase text-slate-500">{['User','Date','Role / Team','Online From - Offline At','Online Duration','Away Duration','Total Duration','Status','Sessions / Actions','IP / Device','Details'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead><tbody>{visible.map((row) => <React.Fragment key={row.id}><tr className="bg-slate-50 font-semibold text-slate-700"><td className="rounded-l-xl px-3 py-3"><strong className="block text-slate-950">{row.name}</strong><small>{row.email}</small></td><td className="px-3 font-black text-slate-900">{formatAuditDate(row.logDate)}</td><td className="px-3"><strong>{roleLabels[row.role] || row.role}</strong><small className="block">{row.team}</small></td><td className="px-3"><strong className="block text-slate-900">{formatAuditTime(row.firstLoginAt)} - {row.offlineAt ? formatAuditTime(row.offlineAt) : 'Online'}</strong><small className="block">First login to {row.offlineAt ? 'offline/last seen' : 'current session'}</small></td><td className="px-3 font-black text-emerald-700">{formatDuration(row.activeSeconds)}</td><td className="px-3 font-black text-amber-700">{formatDuration(row.awaySeconds)}</td><td className="px-3 font-black">{formatDuration(row.durationSeconds)}</td><td className="px-3"><span className={`rounded-full px-2 py-1 text-xs font-black ${row.sessionStatus === 'Online' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{row.sessionStatus}</span></td><td className="px-3"><strong>{row.sessionCount} session{row.sessionCount === 1 ? '' : 's'}</strong><small className="block">{row.activityCount} actions</small></td><td className="max-w-[230px] px-3"><strong>{row.ipAddress || '-'}</strong><small className="block truncate" title={row.device}>{row.device || '-'}</small></td><td className="rounded-r-xl px-3"><button type="button" onClick={() => setExpanded((v) => v === row.id ? '' : row.id)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-black text-emerald-700">{expanded === row.id ? 'Hide' : 'View'}</button></td></tr>{expanded === row.id && <tr><td colSpan="11" className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4"><div className="mb-3 grid gap-2 sm:grid-cols-3"><div className="rounded-xl bg-white p-3"><small className="font-black uppercase text-slate-400">First login</small><strong className="mt-1 block">{formatDateTime(row.firstLoginAt)}</strong></div><div className="rounded-xl bg-white p-3"><small className="font-black uppercase text-slate-400">Offline / Last seen</small><strong className="mt-1 block">{row.offlineAt ? formatDateTime(row.offlineAt) : 'Currently online'}</strong></div><div className="rounded-xl bg-white p-3"><small className="font-black uppercase text-slate-400">Daily duration</small><strong className="mt-1 block">Online {formatDuration(row.activeSeconds)} · Away {formatDuration(row.awaySeconds)}</strong></div></div><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{row.activities?.length ? row.activities.map((item) => <article key={item.id} className="rounded-xl bg-white p-3 shadow-sm"><div className="flex justify-between gap-2"><strong className="text-emerald-800">{item.module}</strong><small>{formatDateTime(item.occurredAt)}</small></div><p className="mt-1 font-bold text-slate-700">{item.description}</p></article>) : <p className="font-bold text-slate-500">No recorded CRM changes on this date.</p>}</div></td></tr>}</React.Fragment>)}</tbody></table>}
        {!loading && !visible.length && <div className="p-12 text-center font-black text-slate-500">No logs match these filters.</div>}
      </div>
    </section>
  </div>
}

function getFollowUpDueAt(item = {}) {
  if (!item.scheduledDate) return null
  const value = new Date(`${item.scheduledDate}T${item.scheduledTime || '23:59'}:00`)
  return Number.isNaN(value.getTime()) ? null : value
}

function getRedFlagStage(item = {}, now = new Date()) {
  const dueAt = getFollowUpDueAt(item)
  if (!dueAt) return null
  const completed = normalizeKey(item.status) === 'completed'
  const completedAt = completed ? new Date(item.completedAt || item.updatedAt || now) : null
  const referenceTime = completedAt && !Number.isNaN(completedAt.getTime()) ? completedAt.getTime() : now.getTime()
  const delta = referenceTime - dueAt.getTime()
  if (completed) {
    if (delta < 30 * 60 * 1000) return null
    if (delta < 48 * 60 * 60 * 1000) return { key: 'resolved-green', label: 'Resolved Green', detail: 'Overdue follow-up completed before the 48-hour Red Flag threshold', rank: 2, resolved: true }
    return { key: 'resolved-red', label: 'Resolved Red Flag', detail: 'Previously crossed the 48-hour Red Flag threshold; corrective action completed', rank: 5, resolved: true }
  }
  if (delta >= 48 * 60 * 60 * 1000) return { key: 'permanent-red', label: 'Permanent Red Flag', detail: 'No action for 48+ hours', rank: 5 }
  if (delta >= 24 * 60 * 60 * 1000) return { key: 'overdue-24', label: '24 hours overdue', detail: 'Follow-up is overdue but has not reached the 48-hour Red Flag threshold', rank: 4 }
  if (delta >= 60 * 60 * 1000) return { key: 'overdue-60', label: '60 min overdue', detail: 'Third overdue reminder reached', rank: 3 }
  if (delta >= 30 * 60 * 1000) return { key: 'overdue-30', label: '30 min overdue', detail: 'Second reminder window crossed', rank: 2 }
  if (delta >= -30 * 60 * 1000) return { key: 'due-30', label: 'Due in 30 min', detail: 'First reminder window', rank: 1 }
  return null
}

function formatAuditDateTime(value) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return `${date.toLocaleDateString('en-GB').replace(/\//g, '-')} · ${date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
}

function buildRedFlagHistory(item = {}, stage = {}) {
  const dueAt = getFollowUpDueAt(item)
  const events = [
    { title: 'Follow-up scheduled', detail: item.description || 'Follow-up created', at: item.createdAt || dueAt },
    { title: '30 min before', detail: 'First reminder window reached.', at: dueAt ? new Date(dueAt.getTime() - 30 * 60 * 1000) : null }
  ]
  if (stage.rank >= 2) events.push({ title: '30 min after', detail: 'No action recorded; overdue reminder reached.', at: new Date(dueAt.getTime() + 30 * 60 * 1000) })
  if (stage.rank >= 3) events.push({ title: '60 min after', detail: 'Follow-up remains open; third reminder reached.', at: new Date(dueAt.getTime() + 60 * 60 * 1000) })
  if (stage.rank >= 4) events.push({ title: '24 hours after', detail: 'Follow-up remains overdue; Red Flag threshold not reached yet.', at: new Date(dueAt.getTime() + 24 * 60 * 60 * 1000) })
  if (stage.rank >= 5) events.push({ title: '48 hours after', detail: 'No corrective action; Red Flag applied.', at: new Date(dueAt.getTime() + 48 * 60 * 60 * 1000) })
  ;(Array.isArray(item.followUpHistory) ? item.followUpHistory : []).forEach((entry) => events.push({
    title: entry.title || entry.reason || 'Follow-up history',
    detail: entry.remarks || entry.description || entry.followUpRemarks || 'Follow-up updated',
    at: entry.updatedAt || entry.createdAt || entry.scheduledDate
  }))
  return events.filter((event) => event.at)
}

function RedFlagAuditSection({ items = [], users = [], title = 'Red Flag & Missed Action Audit', compact = false }) {
  const [selected, setSelected] = useState(null)
  const [expanded, setExpanded] = useState(!compact)
  const [page, setPage] = useState(1)
  const pageSize = 5
  const rows = useMemo(() => items
    .map((item) => ({ item, stage: getRedFlagStage(item) }))
    .filter((row) => row.stage)
    .sort((a, b) => b.stage.rank - a.stage.rank || getFollowUpDueAt(a.item) - getFollowUpDueAt(b.item)), [items])
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pagedRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize)

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages))
  }, [totalPages])

  const counts = rows.reduce((result, row) => {
    result[row.stage.key] = (result[row.stage.key] || 0) + 1
    return result
  }, {})

  return (
    <>
      <section className={`red-flag-audit${compact ? ' red-flag-audit-compact' : ''}${expanded ? ' is-expanded' : ''}`}>
        <header>
          <div className="red-flag-audit-title"><ShieldAlert aria-hidden="true" /><div><span>Action control</span><h2>{title}</h2><p>30 minutes before through the permanent 48-hour red-flag escalation in one place.</p></div></div>
          <div className="red-flag-audit-summary">
            <b>{counts['permanent-red'] || 0}<small>Red flags</small></b>
            <b>{(counts['overdue-60'] || 0) + (counts['overdue-30'] || 0)}<small>Missed</small></b>
            <b>{counts['due-30'] || 0}<small>Due soon</small></b>
            <b className="is-resolved-green">{counts['resolved-green'] || 0}<small>Resolved green</small></b>
            <b className="is-resolved-red">{counts['resolved-red'] || 0}<small>Resolved red</small></b>
            {compact && <button type="button" className="red-flag-details-toggle" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Hide Details' : 'View Details'}<ChevronDown aria-hidden="true" /></button>}
          </div>
        </header>
        <div className="red-flag-table-wrap" hidden={compact && !expanded}>
          <table>
            <thead><tr><th>Stage</th><th>Lead / Follow-up</th><th>Assigned User</th><th>Due At</th><th>No-action Reason</th><th>History</th></tr></thead>
            <tbody>
              {rows.length ? pagedRows.map(({ item, stage }, index) => {
                const assignee = resolveFollowUpAssignee(item, users)
                return (
                  <tr key={item.id || item._id || index}>
                    <td><mark className={`red-flag-stage is-${stage.key}`}>{stage.key === 'resolved-green' ? <CheckCircle2 aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />}{stage.label}</mark></td>
                    <td><strong>{item.title || getCalendarFollowUpCompany(item)}</strong><small>{getCalendarFollowUpCompany(item)}</small></td>
                    <td><span className="red-flag-user"><UserAvatar user={assignee} /><span>{assignee.name}<small>{assignee.email || 'CRM user'}</small></span></span></td>
                    <td><strong>{formatAuditDateTime(getFollowUpDueAt(item))}</strong></td>
                    <td><span>{stage.detail}</span><small>{stage.resolved ? `Completed ${formatAuditDateTime(item.completedAt || item.updatedAt)}` : `Status remains ${displayValue(item.status, 'open')}`}</small></td>
                    <td><button type="button" className="red-flag-eye" onClick={() => setSelected({ item, stage })} aria-label={`View complete history for ${item.title || 'follow-up'}`}><Eye className="h-4 w-4" /> View</button></td>
                  </tr>
                )
              }) : <tr><td colSpan={6} className="red-flag-empty">No missed action or red flag in your visible records.</td></tr>}
            </tbody>
          </table>
        </div>
        {(!compact || expanded) && rows.length > pageSize && (
          <div className="red-flag-pagination">
            <div className="red-flag-pagination-meta">
              <strong>{rows.length ? (safePage - 1) * pageSize + 1 : 0}-{Math.min(safePage * pageSize, rows.length)}</strong>
              <span>of {rows.length} entries</span>
            </div>
            <div className="red-flag-pagination-center">Page {safePage} of {totalPages}</div>
            <div className="red-flag-pagination-actions">
              <button type="button" disabled={safePage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
              <button type="button" disabled={safePage === totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</button>
            </div>
          </div>
        )}
      </section>
      <AnimatePresence>
        {selected && (
          <motion.div className="red-flag-modal-backdrop" onClick={() => setSelected(null)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.aside className="red-flag-modal" onClick={(event) => event.stopPropagation()} initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }}>
              <header><div><span>Complete action history</span><h2>{selected.item.title || getCalendarFollowUpCompany(selected.item)}</h2><p>{getCalendarFollowUpCompany(selected.item)} · {selected.stage.detail}</p></div><button type="button" onClick={() => setSelected(null)}><X className="h-5 w-5" /></button></header>
              <div className="red-flag-modal-meta"><span><b>Assigned</b>{resolveFollowUpAssignee(selected.item, users).name}</span><span><b>Scheduled</b>{formatAuditDateTime(getFollowUpDueAt(selected.item))}</span><span><b>Priority</b>{selected.item.priority || 'Medium'}</span><span><b>Current stage</b>{selected.stage.label}</span></div>
              <div className="red-flag-history">
                {buildRedFlagHistory(selected.item, selected.stage).map((event, index) => <article key={`${event.title}-${index}`}><i>{index + 1}</i><div><strong>{event.title}</strong><p>{event.detail}</p><time>{formatAuditDateTime(event.at)}</time></div></article>)}
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function getCalendarFollowUpsForUser(user = {}, extraItems = []) {
  const safeUser = user || {}
  const seen = new Set()
  // Prefer the database copy over stale browser storage when both carry the
  // same external id. The server copy contains completion/red-to-green history.
  return [...extraItems, ...readCalendarTodoItems()]
    .filter(isCalendarFollowUp)
    .filter((item) => calendarItemBelongsToUser(item, safeUser))
    .filter((item, index) => {
      const key = String(item.id || item._id || `${item.title || ''}-${item.scheduledDate || ''}-${item.scheduledTime || ''}-${index}`)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => `${a.scheduledDate || ''} ${a.scheduledTime || ''}`.localeCompare(`${b.scheduledDate || ''} ${b.scheduledTime || ''}`))
}

function getCalendarFollowUpCompany(item = {}) {
  return displayValue(item.clientName || item.leadCompanyName || item.leadNumber || item.clientNumber, 'Follow-up')
}

function getCalendarFollowUpOwner(item = {}) {
  const assigned = item.assignedTo && typeof item.assignedTo === 'object' ? item.assignedTo : {}
  const creator = item.createdBy && typeof item.createdBy === 'object' ? item.createdBy : {}
  return displayValue(
    item.assignedToName || assigned.name || assigned.email || item.assignedToText || item.assignedToEmail ||
    (typeof item.assignedTo === 'string' ? item.assignedTo : '') || item.ownerName || item.importedCreatedBy ||
    item.createdByName || creator.name || creator.email || (typeof item.createdBy === 'string' ? item.createdBy : '') ||
    item.assignedBy || item.leadGeneratedBy,
    'Unassigned'
  )
}

function formatDateTime(value) {
  return formatDisplayDateTime(value, 'No login yet')
}

function formatShortDate(value) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not available'
  return new Intl.DateTimeFormat('en', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date)
}

function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

function parseDateKey(value) {
  const date = new Date(`${value || ''}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function diffDays(fromValue, toValue) {
  const from = parseDateKey(fromValue)
  const to = parseDateKey(toValue)
  if (!from || !to) return 0
  return Math.round((to - from) / 86400000)
}

function getFollowUpTone(item = {}, todayKey = dateKey()) {
  if (normalizeKey(item.status) === 'completed') return 'done'
  if (item.scheduledDate && item.scheduledDate < todayKey) return 'overdue'
  if ((item.history || []).length) return 'revised'
  return 'open'
}

function getFollowUpStatusLabel(item = {}, todayKey = dateKey()) {
  const tone = getFollowUpTone(item, todayKey)
  if (tone === 'done') return 'Completed'
  if (tone === 'overdue') return 'Overdue'
  if (tone === 'revised') return 'Revised'
  return 'Open'
}

function getFollowUpProgress(item = {}, todayKey = dateKey()) {
  if (normalizeKey(item.status) === 'completed') return 100
  if (item.scheduledDate && item.scheduledDate < todayKey) return 20
  if ((item.history || []).length) return 55
  return 35
}

function formatPoDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date).replace(/\//g, '-')
}

function parseFinancialYearStart(value = '') {
  const match = String(value || '').match(/(20\d{2})/)
  return match ? Number(match[1]) : null
}

function formatFinancialYear(startYear) {
  return `${startYear}-${String(startYear + 1).slice(-2)}`
}

function getLatestCompletedFinancialYearStart(date = new Date()) {
  const currentFinancialYearStart = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1
  return currentFinancialYearStart - 1
}

function buildOperationsAnnualYearOptions(row = {}) {
  const latestStart = getLatestCompletedFinancialYearStart()
  const starts = (row.annualReturns || [])
    .map((annualRow) => parseFinancialYearStart(annualRow.annualYear || annualRow.year))
    .filter(Boolean)
  const firstStart = parseFinancialYearStart(row.firstAnnualReturnYear || row.annualYear) || Math.min(...starts, latestStart - 2)
  const startYear = Math.min(firstStart, latestStart)

  return Array.from({ length: latestStart - startYear + 1 }, (_, index) => {
    const year = startYear + index
    const label = formatFinancialYear(year)
    const filing = (row.annualReturns || []).find((annualRow) => {
      return formatFinancialYear(parseFinancialYearStart(annualRow.annualYear || annualRow.year) || 0) === label
    })

    return {
      label,
      period: 'April - March',
      status: year === latestStart ? 'Current hub' : 'Open hub',
      completed: filing ? getAnnualTabCompletedCount(filing) : 0
    }
  })
}

function splitName(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] || 'User',
    lastName: parts.slice(1).join(' ') || '-'
  }
}

function readClientData(client = {}) {
  const safeClient = asRecord(client)
  return safeClient.data && typeof safeClient.data === 'object' ? safeClient.data : safeClient
}

function getVisibilityStatus(client = {}) {
  const safeClient = asRecord(client)
  return String(safeClient.adminControls?.visibilityStatus || readClientData(safeClient).adminControls?.visibilityStatus || '').trim().toUpperCase()
}

function getClientName(client = {}) {
  const safeClient = asRecord(client)
  const data = readClientData(safeClient)
  return data.basic?.clientLegalName || data.basic?.tradeName || safeClient.clientName || safeClient.companyName || 'Untitled client'
}

function formatAtplCode(value) {
  const code = String(value || '').trim()
  const businessMatch = code.match(/^ATPL-LEAD-(\d+)$/i)
  return businessMatch ? `ATPL-${businessMatch[1]}` : code
}

function isGeneratedLeadCode(value) {
  const code = String(value || '').trim()
  return /^ATPL-LEAD-[A-F\d]{10,}$/i.test(code) || /^ATPL-\d{8,}$/i.test(code)
}

function formatPiboCategory(value) {
  const category = String(value || '').trim()
  if (!category) return 'Unassigned'
  const normalized = normalizeKey(category).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  const labels = {
    producer: 'Producer', importer: 'Importer', recycler: 'Recycler',
    'brand owner': 'Brand Owner', refurbisher: 'Refurbisher', simp: 'SIMP', pwp: 'PWP'
  }
  return labels[normalized] || category.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function getClientCategory(client = {}) {
  const safeClient = asRecord(client)
  const data = readClientData(safeClient)
  const lead = safeClient.selectedLead && typeof safeClient.selectedLead === 'object' ? safeClient.selectedLead : {}
  return formatPiboCategory(data.basic?.piboCategory || safeClient.piboCategory || lead.piboCategory)
}

function getClientApplicantGroup(client = {}) {
  const safeClient = asRecord(client)
  const data = readClientData(safeClient)
  const lead = safeClient.selectedLead && typeof safeClient.selectedLead === 'object' ? safeClient.selectedLead : {}
  const explicit = data.basic?.applicantType || data.basic?.piboParent || data.piboParent || lead.applicantType || lead.piboParent
  if (['PIBO', 'SIMP', 'PWP'].includes(String(explicit || '').toUpperCase())) return String(explicit).toUpperCase()
  const child = normalizeKey(data.basic?.piboCategory || safeClient.piboCategory || lead.piboCategory)
  if (['producer', 'importer', 'brand owner'].includes(child)) return 'PIBO'
  if (['seller', 'importer of raw material', 'importer of plastic packaging'].includes(child) || child.includes('simp')) return 'SIMP'
  if (['recycler', 'refurbisher', 'retreader', 'pwp'].includes(child)) return 'PWP'
  return explicit || 'Unassigned'
}

function isOperationsUser(user = {}) {
  const role = String(user.role || '').toLowerCase()
  const team = String(user.team || '').toLowerCase()
  return ['operation', 'admin', 'superadmin', 'manager'].includes(role) || team.includes('operation')
}

function isSalesDashboardUser(user = {}) {
  return normalizeKey(user?.role) === 'sales'
}

function canSwitchDashboard(user = {}) {
  const role = normalizeKey(user?.role)
  return adminRoles.map(normalizeKey).includes(role) || role === 'superadmin' || role === 'super admin'
}

function getLeadOwnerName(lead = {}) {
  const staffAssignment = (Array.isArray(lead.assignments) ? lead.assignments : []).find((row) => row?.assignedStaff || row?.assignedStaffText || row?.assignedStaffEmail) || {}
  return staffAssignment.assignedStaff?.name || staffAssignment.assignedStaffText || lead.assignedStaff?.name || lead.assignedStaffText || lead.assignedTo?.name || lead.assignedToText || lead.createdBy?.name || lead.createdBy?.email || lead.referredBy || 'Unassigned'
}

function getSalesRecordCreatorName(record = {}, users = []) {
  const creator = record.createdBy && typeof record.createdBy === 'object' ? record.createdBy : {}
  const creatorKeys = [
    creator._id,
    creator.id,
    creator.email,
    record.createdById,
    record.createdByEmail,
    typeof record.createdBy === 'string' ? record.createdBy : ''
  ].map(normalizeKey).filter(Boolean)
  const matchedUser = users.find((user) => getUserMatchKeys(user).some((key) => creatorKeys.includes(key)))
  const rawCreator = typeof record.createdBy === 'string' ? record.createdBy.trim() : ''
  const readableCreator = rawCreator && !/^[a-f0-9]{24}$/i.test(rawCreator) && !rawCreator.includes('@') ? rawCreator : ''
  const explicitName = record.createdByName || creator.name || creator.fullName || matchedUser?.name || matchedUser?.fullName || readableCreator
  if (String(explicitName || '').trim()) return String(explicitName).trim()
  const email = creator.email || record.createdByEmail || matchedUser?.email
  if (String(email || '').trim()) return String(email).trim()
  return 'Unassigned'
}

function getLeadCompanyName(lead = {}) {
  return lead.company || lead.companyName || lead.leadDetails?.companyName || ''
}

function leadConvertedToClientMaster(lead = {}, clients = []) {
  const status = normalizeKey(lead.status || lead.stage || lead.leadStatus || '')
  if (lead.existingClient === 'Yes' || status.includes('existing') || status.includes('convert')) return true
  const leadName = getLeadCompanyName(lead)
  if (!leadName) return false
  return clients.some((client) => businessNamesMatch(getClientName(client), leadName))
}

function getLeadMergeKey(item = {}) {
  return String(item?._id || item?.id || item?.sourceLeadId || item?.leadCode || item?.company || item?.companyName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function mergeLeadSources(crmLeads = [], ccpLeads = []) {
  const merged = []
  const indexByKey = new Map()

  ;[...ccpLeads, ...crmLeads].forEach((item) => {
    const key = getLeadMergeKey(item)
    if (key && indexByKey.has(key)) {
      const index = indexByKey.get(key)
      merged[index] = { ...merged[index], ...item }
      return
    }
    if (key) indexByKey.set(key, merged.length)
    merged.push(item)
  })

  return merged
}

function leadBelongsToSalesUser(lead = {}, user = {}) {
  const role = normalizeKey(user.role)
  if (['admin', 'superadmin', 'super admin'].includes(role)) return true
  const userKeys = getUserMatchKeys(user)
  const assigned = lead.assignedTo && typeof lead.assignedTo === 'object' ? lead.assignedTo : {}
  const leadKeys = [
    assigned._id,
    assigned.id,
    assigned.email,
    assigned.name,
    lead.assignedTo,
    lead.assignedToText,
    lead.createdBy?._id,
    lead.createdBy?.id,
    lead.createdBy?.email,
    lead.createdBy?.name,
    lead.createdById,
    lead.createdByEmail,
    lead.createdByName,
    lead.ownerId,
    lead.ownerEmail,
    lead.ownerName,
    lead.referredBy
  ].map(normalizeKey).filter(Boolean)
  return leadKeys.some((key) => userKeys.includes(key))
}

function quotationBelongsToSalesUser(quotation = {}, user = {}) {
  const role = normalizeKey(user.role)
  if (['admin', 'superadmin', 'super admin'].includes(role)) return true
  const userKeys = getUserMatchKeys(user)
  const quoteKeys = [
    quotation.createdBy?._id,
    quotation.createdBy?.id,
    quotation.createdBy?.email,
    quotation.createdBy?.name,
    quotation.createdById,
    quotation.createdByEmail,
    quotation.createdByName,
    quotation.ownerId,
    quotation.ownerEmail,
    quotation.ownerName,
    quotation.leadDetails?.referredBy
  ].map(normalizeKey).filter(Boolean)
  return quoteKeys.some((key) => userKeys.includes(key))
}

function getSalesVisibleRecords(records = [], predicate) {
  return records.filter(predicate)
}

function getLeadCreatedDate(lead = {}) {
  return lead.createdAt || lead.createdOn || lead.leadDate || lead.date || lead.updatedAt || ''
}

function isTodayDate(value) {
  if (!value) return false
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return false
  const today = new Date()
  return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate()
}

function isDateInSalesPeriod(value, period = 'q1') {
  if (!value) return false
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return false
  const periodValue = String(period)
  if (periodValue.startsWith('months:')) {
    const selectedMonths = periodValue
      .replace('months:', '')
      .split(',')
      .map((month) => Number(String(month).replace('m', '')))
      .filter((month) => Number.isInteger(month) && month >= 0 && month <= 11)
    return selectedMonths.includes(date.getMonth())
  }
  if (periodValue.startsWith('m')) {
    return date.getMonth() === Number(periodValue.slice(1))
  }
  if (periodValue.startsWith('y')) {
    return date.getFullYear() === Number(periodValue.slice(1))
  }
  const month = date.getMonth()
  const quarterMonths = {
    q1: [3, 4, 5],
    q2: [6, 7, 8],
    q3: [9, 10, 11],
    q4: [0, 1, 2]
  }
  return (quarterMonths[period] || quarterMonths.q1).includes(month)
}

function getQuotationStatusBucket(quote = {}) {
  const status = normalizeKey(quote.quotationStatus || quote.status || quote.approvalStatus || quote.adminApproval || 'draft')
  if (status.includes('expire')) return 'Expired'
  if (status.includes('reply')) return 'Replied'
  if (status.includes('open')) return 'Opened'
  if (status.includes('sent') || status.includes('pending')) return 'Sent'
  if (status.includes('approve')) return 'Approved'
  if (status.includes('draft')) return 'Draft'
  return 'Draft'
}

function getQuotationValue(quote = {}) {
  return (quote.items || []).reduce((sum, item) => sum + (Number(item.basicAmount) || 0), 0)
}

function getQuotationOwnerName(quote = {}) {
  const assignedName = String(quote.assignedUserName || '').trim()
  const creatorName = String(quote.createdBy?.name || quote.createdBy?.email || quote.createdByName || '').trim()
  const leadCreator = String(quote.leadGeneratedBy || '').trim()
  const referredBy = String(quote.leadDetails?.referredBy || '').trim()
  if (assignedName) return assignedName
  if (creatorName) return creatorName
  if (leadCreator && !/^demo(?:\s+demo)?$/i.test(leadCreator)) return leadCreator
  return referredBy || 'Unassigned'
}

function getQuotationDate(quote = {}) {
  return quote.createdAt || quote.quotationDate || quote.updatedAt || ''
}

function formatMonthYear(value) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return 'No month'
  return new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(date)
}

function buildSalesValueGroups(quotations = []) {
  const groups = new Map()
  quotations.forEach((quote) => {
    const userName = getQuotationOwnerName(quote)
    const month = formatMonthYear(getQuotationDate(quote))
    const key = `${userName}__${month}`
    const existing = groups.get(key) || { key, userName, month, totalValue: 0, quotations: [] }
    const value = getQuotationValue(quote)
    existing.totalValue += value
    existing.quotations.push({ ...quote, __salesValue: value })
    groups.set(key, existing)
  })
  return [...groups.values()].sort((a, b) => b.totalValue - a.totalValue)
}

function buildSalesValueReportRows(quotations = []) {
  return buildSalesValueGroups(quotations).flatMap((group) => (
    group.quotations.map((quote) => [
      group.userName,
      group.month,
      quote.leadDetails?.companyName || quote.companyName || 'Client',
      formatShortDate(getQuotationDate(quote)),
      formatDashboardInr(quote.__salesValue)
    ])
  ))
}

function getLeadPipelineStage(lead = {}) {
  const status = normalizeKey(lead.status || lead.stage || lead.leadStatus || '')
  if (lead.existingClient === 'Yes' || status.includes('won') || status.includes('existing') || status.includes('convert')) return 'Won'
  if (status.includes('lost') || status.includes('reject')) return 'Lost'
  if (status.includes('negotiation') || status.includes('negotiate')) return 'Negotiation'
  if (status.includes('quotation') || status.includes('quote') || status.includes('proposal')) return 'Quotation'
  if (status.includes('qualified')) return 'Qualified'
  if (status.includes('contact') || status.includes('call') || status.includes('follow')) return 'Contacted'
  return 'New'
}

function quotationMatchesLead(quote = {}, lead = {}) {
  return businessNamesMatch(quote.leadDetails?.companyName || quote.companyName || '', lead.company || lead.companyName || '')
}

function getLeadSalesValue(lead = {}, quotations = []) {
  return quotations
    .filter((quote) => quotationMatchesLead(quote, lead))
    .reduce((sum, quote) => sum + getQuotationValue(quote), 0)
}

function buildDistributionRows(items = [], getLabel, palette = []) {
  const counts = new Map()
  items.forEach((item) => {
    const label = getLabel(item) || 'Others'
    counts.set(label, (counts.get(label) || 0) + 1)
  })
  const total = items.length || 0
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], index) => ({
      label,
      value,
      percent: total ? Math.round((value / total) * 1000) / 10 : 0,
      color: palette[index % palette.length] || '#0f766e'
    }))
}

function getLeadOwnerKeys(lead = {}) {
  const assigned = lead.assignedTo && typeof lead.assignedTo === 'object' ? lead.assignedTo : {}
  const assignments = Array.isArray(lead.assignments) ? lead.assignments : []
  return [
    lead.assignedStaff,
    lead.assignedStaff?._id,
    lead.assignedStaff?.email,
    lead.assignedStaffText,
    lead.assignedStaffEmail,
    ...assignments.flatMap((row) => [row?.assignedStaff, row?.assignedStaff?._id, row?.assignedStaff?.email, row?.assignedStaffText, row?.assignedStaffEmail]),
    assigned._id,
    assigned.id,
    assigned.email,
    assigned.name,
    lead.assignedTo,
    lead.assignedToText,
    lead.ownerId,
    lead.userId,
    lead.createdBy?._id,
    lead.createdBy?.id,
    lead.createdBy?.email,
    lead.createdBy?.name,
    lead.referredBy
  ].map(normalizeKey).filter(Boolean)
}

function findUserByOwnerPriority(users = [], ownerKeys = []) {
  for (const ownerKey of ownerKeys) {
    const matched = users.find((user) => getUserMatchKeys(user).includes(ownerKey))
    if (matched) return matched
  }
  return null
}

function leadMatchesAnyUserKey(lead = {}, allowedKeys = new Set()) {
  return getLeadOwnerKeys(lead).some((key) => allowedKeys.has(key))
}

function buildOperationsLeadAnalytics(leads = [], users = [], currentUser = {}) {
  const role = normalizeKey(currentUser?.role)
  const canSeeAll = adminRoles.includes(currentUser?.role) || role === 'admin' || role === 'superadmin'
  const canSeeTeam = role === 'manager' || role.includes('operation head')
  let visibleLeads = leads
  let visibleUsers = users

  if (!canSeeAll && canSeeTeam) {
    const allowedKeys = new Set(getUserMatchKeys(currentUser))
    visibleUsers = users.filter((user) => userBelongsToManager(user, currentUser) || getUserId(user) === getUserId(currentUser))
    visibleUsers.flatMap(getUserMatchKeys).forEach((key) => allowedKeys.add(key))
    visibleLeads = leads.filter((lead) => leadMatchesAnyUserKey(lead, allowedKeys))
  } else if (!canSeeAll && !role.includes('compliance')) {
    const allowedKeys = new Set(getUserMatchKeys(currentUser))
    visibleUsers = users.filter((user) => getUserMatchKeys(user).some((key) => allowedKeys.has(key)))
    visibleLeads = leads.filter((lead) => leadMatchesAnyUserKey(lead, allowedKeys))
  }

  const userCounts = new Map()
  visibleLeads.forEach((lead) => {
    const ownerKeys = getLeadOwnerKeys(lead)
    const matchedUser = findUserByOwnerPriority(users, ownerKeys)
    const id = matchedUser ? (getUserId(matchedUser) || getUserName(matchedUser)) : getLeadOwnerName(lead)
    const name = matchedUser ? getUserName(matchedUser) : getLeadOwnerName(lead)
    const existing = userCounts.get(id) || { id, name, leads: 0 }
    existing.leads += 1
    userCounts.set(id, existing)
  })

  if (canSeeAll || canSeeTeam) {
    visibleUsers.forEach((user) => {
      const id = getUserId(user)
      if (id && !userCounts.has(id)) userCounts.set(id, { id, name: getUserName(user), leads: 0 })
    })
  }

  const ownerRows = [...userCounts.values()]
    .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name))
    .slice(0, 10)
    .map((row, index) => ({ ...row, fill: ['#0f9f83', '#2563eb', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6'][index % 6] }))

  const stageRows = buildDistributionRows(
    visibleLeads,
    getLeadPipelineStage,
    ['#0f9f83', '#2563eb', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#64748b']
  )

  return {
    leads: visibleLeads,
    ownerRows,
    stageRows,
    assignedTotal: visibleLeads.filter((lead) => normalizeKey(getLeadOwnerName(lead)) !== 'unassigned').length,
    unassignedTotal: visibleLeads.filter((lead) => normalizeKey(getLeadOwnerName(lead)) === 'unassigned').length
  }
}

const salesCommunicationModes = ['TeleCalling', 'Referral', 'Physical Visit', 'Campaign', 'Existing Client', 'Web Database']
const salesLeadStatuses = ['Potential - Interested', 'Potential - Not Interested', 'Need Assistance', 'Lost', 'Existing Client']

function normalizeSalesMatrixValue(value = '', fallback = 'Unassigned') {
  return String(value || fallback).trim() || fallback
}

function findSalesMatrixBucket(value = '', buckets = [], fallback = 'Unassigned') {
  const normalized = normalizeKey(value)
  return buckets.find((bucket) => normalizeKey(bucket) === normalized) || fallback
}

function buildSalesLeadMatrixRows(leads = []) {
  const rows = new Map()
  leads.forEach((lead) => {
    const owner = getLeadOwnerName(lead)
    const key = normalizeKey(owner) || 'unassigned'
    const existing = rows.get(key) || {
      key,
      owner: normalizeSalesMatrixValue(owner),
      communication: Object.fromEntries(salesCommunicationModes.map((mode) => [mode, 0])),
      statuses: Object.fromEntries(salesLeadStatuses.map((status) => [status, 0])),
      total: 0
    }
    const communicationMode = findSalesMatrixBucket(lead.communicationMode || lead.clientCommunicationMode || lead.mode, salesCommunicationModes)
    const status = findSalesMatrixBucket(lead.status || lead.leadStatus || lead.stage, salesLeadStatuses)
    if (existing.communication[communicationMode] !== undefined) existing.communication[communicationMode] += 1
    if (existing.statuses[status] !== undefined) existing.statuses[status] += 1
    existing.total += 1
    rows.set(key, existing)
  })
  return [...rows.values()].sort((a, b) => b.total - a.total || a.owner.localeCompare(b.owner))
}

function buildConicGradient(rows = []) {
  if (!rows.length) return '#e2e8f0'
  let cursor = 0
  const stops = rows.map((row) => {
    const start = cursor
    cursor += row.percent
    return `${row.color} ${start}% ${cursor}%`
  })
  return `conic-gradient(${stops.join(', ')})`
}

function buildCategoryRows(clients = []) {
  const counts = new Map()
  clients.forEach((client) => {
    const category = getClientCategory(client)
    counts.set(category, (counts.get(category) || 0) + 1)
  })
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
}

function buildTeamRows(users = [], clients = [], annualReturns = []) {
  const teams = new Map()
  users.forEach((user) => {
    const team = user.team || 'No team assigned'
    if (!teams.has(team)) teams.set(team, { label: team, users: 0, clients: 0, annualReturns: 0 })
    teams.get(team).users += 1
  })
  clients.forEach((client) => {
    const team = client.adminControls?.assignedTeam || client.data?.importMeta?.team || 'No team assigned'
    if (!teams.has(team)) teams.set(team, { label: team, users: 0, clients: 0, annualReturns: 0 })
    teams.get(team).clients += 1
  })
  annualReturns.forEach((row) => {
    const team = row.adminControls?.assignedTeam || 'No team assigned'
    if (!teams.has(team)) teams.set(team, { label: team, users: 0, clients: 0, annualReturns: 0 })
    teams.get(team).annualReturns += 1
  })
  return [...teams.values()].sort((a, b) => (b.clients + b.annualReturns + b.users) - (a.clients + a.annualReturns + a.users))
}

function buildRecentOperations(clients = [], annualReturns = [], pendingClients = [], pendingQuotations = []) {
  const clientItems = clients.slice(0, 4).map((client) => ({
    id: `client-${client._id || client.id || getClientName(client)}`,
    title: getClientName(client),
    subtitle: `Client status: ${getVisibilityStatus(client) || 'Draft'}`,
    date: client.updatedAt || client.createdAt,
    tone: 'teal'
  }))
  const annualItems = annualReturns.slice(0, 4).map((row) => ({
    id: `annual-${row._id || row.clientKey || row.clientName}-${row.annualYear}`,
    title: row.clientName || 'Annual return',
    subtitle: `Annual return ${row.annualYear || '-'} - ${row.status || 'draft'}`,
    date: row.updatedAt || row.savedAt,
    tone: 'emerald'
  }))
  const approvalItems = [...pendingClients.slice(0, 2), ...pendingQuotations.slice(0, 2)].map((row, index) => ({
    id: `approval-${row.id || row._id || index}`,
    title: row.clientName || row.companyName || row.userName || 'Approval request',
    subtitle: row.approvalType || row.approvalStatus || 'Pending approval',
    date: row.createdAt || row.requestDate || row.updatedAt,
    tone: 'orange'
  }))
  return [...approvalItems, ...annualItems, ...clientItems].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
}

function buildWorkflowRows({ leads = [], clients = [], quotations = [], annualReturns = [], pendingTotal = 0 }) {
  const max = Math.max(leads.length, clients.length, quotations.length, annualReturns.length, pendingTotal, 1)
  return [
    { label: 'Lead intake', value: leads.length, note: 'CRM lead records', tone: 'teal' },
    { label: 'Client master', value: clients.length, note: 'Client files in operations', tone: 'emerald' },
    { label: 'Approval queue', value: pendingTotal, note: 'Items waiting action', tone: 'orange' },
    { label: 'Quotations', value: quotations.length, note: 'Commercial requests', tone: 'indigo' },
    { label: 'Annual returns', value: annualReturns.length, note: 'Filing workspaces', tone: 'teal' }
  ].map((row) => ({ ...row, percent: Math.round((row.value / max) * 100) }))
}

function buildAttentionItems({ analytics, clients = [], inactiveUsers = 0 }) {
  const items = [
    {
      title: 'Approval queue',
      value: analytics.pendingTotal,
      detail: analytics.pendingTotal ? 'Needs decision from operations/admin' : 'Queue is clear',
      severity: analytics.pendingTotal > 0 ? 'high' : 'good'
    },
    {
      title: 'Annual drafts',
      value: analytics.annualDraft,
      detail: analytics.annualDraft ? 'Draft filings need completion' : 'No open annual drafts',
      severity: analytics.annualDraft > 0 ? 'medium' : 'good'
    },
    {
      title: 'Discontinued clients',
      value: analytics.discontinuedClients,
      detail: 'Review visibility before operational planning',
      severity: analytics.discontinuedClients > 0 ? 'medium' : 'good'
    },
    {
      title: 'Inactive operation users',
      value: inactiveUsers,
      detail: 'Capacity unavailable in operations team',
      severity: inactiveUsers > 0 ? 'low' : 'good'
    }
  ]

  if (!clients.length) {
    items.unshift({
      title: 'Client pipeline',
      value: 0,
      detail: 'No client master records loaded',
      severity: 'medium'
    })
  }

  return items
}

function percent(value, total) {
  return total ? Math.round((value / total) * 100) : 0
}

function normalizeText(value = '') {
  return displayValue(value).trim().toLowerCase()
}

function normalizeKey(value = '') {
  return normalizeText(value).replace(/\s+/g, ' ')
}

function displayValue(value, fallback = '') {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((item) => displayValue(item)).filter(Boolean).join(', ') || fallback
  if (typeof value === 'object') {
    return value.name || value.email || value.label || value.title || value.companyName || value.clientName || value._id || value.id || fallback
  }
  return fallback
}

function asRecord(value) {
  return value && typeof value === 'object' ? value : {}
}

function asRecordList(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []
}

function normalizeBusinessKey(value = '') {
  return normalizeText(value)
    .replace(/\b(m\s*s|ms|m\/s|shree|shri|sri)\b/g, ' ')
    .replace(/\b(private|limited|pvt|ltd|llp|company|co|industries|industry|enterprise|enterprises)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeDigits(value = '') {
  return String(value || '').replace(/\D+/g, '')
}

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase()
}

function compactName(value = '') {
  return normalizeBusinessKey(value).replace(/\s+/g, '')
}

function businessNamesMatch(left = '', right = '') {
  const a = normalizeBusinessKey(left)
  const b = normalizeBusinessKey(right)
  if (!a || !b) return false
  if (a === b) return true

  const compactA = compactName(a)
  const compactB = compactName(b)
  if (!compactA || !compactB) return false
  if (compactA === compactB) return true
  if (compactA.length >= 8 && compactB.includes(compactA)) return true
  if (compactB.length >= 8 && compactA.includes(compactB)) return true

  const aTokens = new Set(a.split(' ').filter((token) => token.length > 2))
  const bTokens = b.split(' ').filter((token) => token.length > 2)
  const matches = bTokens.filter((token) => aTokens.has(token)).length
  return matches >= 2 && matches >= Math.min(aTokens.size, bTokens.length) - 1
}

function getUserId(user = {}) {
  const safeUser = user || {}
  return String(safeUser._id || safeUser.id || safeUser.userId || '').trim()
}

function getUserName(user = {}) {
  const safeUser = user || {}
  return safeUser.name || safeUser.email || 'Unassigned'
}

function getUserMatchKeys(user = {}) {
  const safeUser = user || {}
  return [
    safeUser._id,
    safeUser.id,
    safeUser.userId,
    safeUser.crmUserId,
    safeUser.email,
    safeUser.name
  ].map(normalizeKey).filter(Boolean)
}

function getClientCode(client = {}) {
  const safeClient = asRecord(client)
  const data = readClientData(safeClient)
  const lead = safeClient.selectedLead && typeof safeClient.selectedLead === 'object' ? safeClient.selectedLead : {}
  const code = data.importMeta?.uniqueId || safeClient.clientCode || safeClient.code || lead.sourceLeadId || data.importMeta?.leadNumber || safeClient.leadCode || lead.leadCode
  return formatAtplCode(code) || '-'
}

function getClientFirstAnnualYear(client = {}) {
  const safeClient = asRecord(client)
  const data = readClientData(safeClient)
  return data.basic?.firstAnnualReturnYear || data.firstAnnualReturnYear || safeClient.firstAnnualReturnYear || ''
}

function getClientMatchKeys(client = {}) {
  const safeClient = asRecord(client)
  const data = readClientData(safeClient)
  const lead = asRecord(safeClient.selectedLead)
  const companyKeys = [
    getClientName(safeClient),
    data.basic?.clientLegalName,
    data.basic?.tradeName
  ].map(normalizeBusinessKey).filter(Boolean).map((value) => `company:${value}`)
  return [
    safeClient._id,
    safeClient.id,
    safeClient.clientKey,
    safeClient.client,
    getClientCode(safeClient),
    getClientName(safeClient),
    data.importMeta?.uniqueId,
    data.importMeta?.leadNumber,
    lead._id,
    lead.id,
    lead.leadCode,
    ...companyKeys
  ].map((value) => String(value || '').startsWith('company:') ? value : normalizeKey(value)).filter(Boolean)
}

function getClientDedupeKey(client = {}) {
  const safeClient = asRecord(client)
  const data = readClientData(safeClient)
  const recordId = normalizeKey(safeClient._id || safeClient.id || safeClient.clientMasterId)
  const assignedServiceId = normalizeKey(safeClient.assignedServiceId || data.assignedServiceId || data.selectedLeadSnapshot?.assignedServiceId)
  // A Client Master document represents one converted service. Preserve that
  // identity instead of collapsing every service belonging to the same lead.
  if (recordId) return `record:${recordId}${assignedServiceId ? `:service:${assignedServiceId}` : ''}`
  const strongCode = normalizeKey(data.importMeta?.uniqueId || data.importMeta?.leadNumber || safeClient.clientCode || safeClient.code || '')
  if (strongCode) return `client:${strongCode}${assignedServiceId ? `:service:${assignedServiceId}` : ''}`
  const company = normalizeKey(getClientName(safeClient))
  const category = normalizeKey(getClientCategory(safeClient))
  const assigned = getAssignedUserKeysFromClient(safeClient).join('|')
  if (company && company !== 'untitled client') return [company, category, assigned].filter(Boolean).join('::')
  return normalizeKey(safeClient._id || safeClient.id || getClientCode(safeClient))
}

function getAssignedUserKeysFromClient(client = {}) {
  const safeClient = asRecord(client)
  const data = readClientData(safeClient)
  const admin = safeClient.adminControls || data.adminControls || {}
  const importMeta = data.importMeta || {}
  const assigned = asRecord(admin.assignedTo)
  const lead = asRecord(safeClient.selectedLead || data.selectedLeadSnapshot)
  const serviceId = String(safeClient.assignedServiceId || data.assignedServiceId || '')
  const assignments = (Array.isArray(lead.assignments) ? lead.assignments : []).filter((assignment) => !serviceId || String(assignment.assignedServiceId || assignment.serviceAssignmentId || '') === serviceId)
  return [
    ...permanentStaffOwnerKeys(safeClient),
    // Client-level/original ownership is authoritative for user-wise reporting.
    // Service allocations remain a fallback and must not duplicate one client
    // under every user who has ever handled one of its services.
    admin.assignedTo,
    assigned._id,
    assigned.id,
    assigned.name,
    assigned.email,
    admin.assignedUser,
    admin.user,
    admin.userId,
    admin.managerId,
    importMeta.assignedTo,
    importMeta.user,
    importMeta.userName,
    safeClient.assignedTo,
    safeClient.assignedUser,
    safeClient.userName,
    safeClient.user?.name,
    safeClient.user?.email,
    safeClient.user?._id,
    ...[lead, ...assignments].flatMap((owner) => [owner.assignedTo, owner.assignedTo?._id, owner.assignedTo?.email, owner.assignedToText, owner.assignedStaff, owner.assignedStaffText, owner.assignedStaffEmail]),
    ...allocationOwnerKeys(safeClient)
  ].map(normalizeKey).filter(Boolean)
}

function resolveAssignedUser(client = {}, users = [], fallbackUser = null) {
  const assignedKeys = getAssignedUserKeysFromClient(client)
  const matched = findUserByOwnerPriority(users, assignedKeys)
  if (matched) return matched
  return fallbackUser || null
}

function getAnnualReturnClientKeys(row = {}) {
  const client = row.client && typeof row.client === 'object' ? row.client : {}
  const clientData = row.clientData && typeof row.clientData === 'object' ? row.clientData : {}
  return [
    row.clientKey,
    row.client,
    row.clientId,
    row.clientName,
    row.companyName,
    row.atplCode,
    row.uniqueId,
    row.leadNumber,
    client._id,
    client.id,
    client.name,
    client.clientName,
    clientData.importMeta?.uniqueId,
    clientData.importMeta?.leadNumber,
  ].map(normalizeKey).filter(Boolean)
}

function getQuotationClientKeys(row = {}) {
  const client = row.client && typeof row.client === 'object' ? row.client : {}
  const lead = row.lead && typeof row.lead === 'object' ? row.lead : {}
  const details = row.leadDetails || {}
  const companyKeys = [
    row.companyName,
    details.companyName,
    client.clientName,
    client.companyName
  ].map(normalizeBusinessKey).filter(Boolean).map((value) => `company:${value}`)
  return [
    row.client,
    row.clientId,
    row.clientKey,
    row.clientName,
    row.companyName,
    details.companyName,
    row.leadCode,
    details.leadCode,
    row.atplCode,
    row.uniqueId,
    row.leadNumber,
    client._id,
    client.id,
    client.clientName,
    client.companyName,
    lead._id,
    lead.id,
    lead.leadCode,
    ...companyKeys
  ].map((value) => String(value || '').startsWith('company:') ? value : normalizeKey(value)).filter(Boolean)
}

function quotationMatchesClientLoose(quote = {}, client = {}) {
  const safeClient = asRecord(client)
  const data = readClientData(safeClient)
  const details = quote.leadDetails || {}
  const quoteNames = [
    quote.companyName,
    quote.clientName,
    details.companyName,
    quote.leadName
  ].filter(Boolean)
  const clientNames = [
    getClientName(safeClient),
    data.basic?.clientLegalName,
    data.basic?.tradeName
  ].filter(Boolean)
  if (quoteNames.some((quoteName) => clientNames.some((clientName) => businessNamesMatch(quoteName, clientName)))) return true

  const quotePhones = [
    quote.mobileNo1,
    quote.mobileNo2,
    quote.mobile,
    quote.phone,
    details.mobileNo1,
    details.mobileNo2,
    details.mobile,
    details.phone
  ].map(normalizeDigits).filter((value) => value.length >= 8)
  const clientPhones = [
    data.otp?.mobile,
    data.otp?.mobileNo,
    data.authorised?.mobile,
    data.authorised?.mobileNo,
    data.coordinating?.mobile,
    data.coordinating?.mobileNo,
    safeClient.mobileNo1,
    safeClient.mobileNo2,
    safeClient.mobile,
    safeClient.phone
  ].map(normalizeDigits).filter((value) => value.length >= 8)
  if (quotePhones.some((phone) => clientPhones.some((clientPhone) => phone.endsWith(clientPhone) || clientPhone.endsWith(phone)))) return true

  const quoteEmails = [
    quote.email,
    quote.emailId,
    details.email,
    details.emailId
  ].map(normalizeEmail).filter(Boolean)
  const clientEmails = [
    data.otp?.email,
    data.authorised?.email,
    data.coordinating?.email,
    safeClient.email,
    safeClient.emailId
  ].map(normalizeEmail).filter(Boolean)
  if (quoteEmails.some((email) => clientEmails.includes(email))) return true

  const quoteTokens = getQuotationClientKeys(quote)
  const clientTokens = getClientMatchKeys(safeClient)
  return quoteTokens.some((key) => clientTokens.includes(key))
}

function getAnnualWorkflowStage(row = {}) {
  const workflow = row.approvalWorkflow || row.workflow || {}
  const status = normalizeKey(workflow.status || row.status || '')
  if (status === 'complete' || status.includes('approved by compliance')) return 'complete'
  if (status.includes('compliance') && !status.includes('reject')) return 'compliance'
  if (status.includes('manager') && !status.includes('reject')) return 'manager'
  return normalizeKey(workflow.currentStage || row.currentStage || row.stage || status || 'user')
}

function isAnnualReturnDone(row = {}) {
  const stage = getAnnualWorkflowStage(row)
  const status = normalizeKey(row.status || row.approvalWorkflow?.status || '')
  return stage === 'complete' || ['filed', 'submitted', 'closed', 'approved', 'complete'].some((item) => status.includes(item))
}

function isAnnualCompliancePending(row = {}) {
  const stage = getAnnualWorkflowStage(row)
  const status = normalizeKey(row.status || row.approvalWorkflow?.status || '')
  return stage === 'compliance' || status.includes('compliance_pending') || status.includes('pending with compliance')
}

function getAnnualTabCompletedCount(row = {}) {
  const completedTabs = row?.draft?.__completedTabs && typeof row.draft.__completedTabs === 'object' && !Array.isArray(row.draft.__completedTabs)
    ? row.draft.__completedTabs
    : {}
  const tabIds = ['basic', 'financials', 'data', 'cpcbLetter']
  const tabCount = tabIds.filter((tabId) => completedTabs[tabId]).length
  if (tabCount) return tabCount
  return isAnnualReturnDone(row) ? 4 : 0
}

function getAnnualRowsCompletedCount(rows = []) {
  if (!rows.length) return 0
  return Math.max(...rows.map(getAnnualTabCompletedCount), 0)
}

function getLatestOperationAnnualReturn(rows = []) {
  return [...rows]
    .filter((row) => parseFinancialYearStart(row.annualYear || row.year))
    .sort((left, right) => {
      return parseFinancialYearStart(right.annualYear || right.year) - parseFinancialYearStart(left.annualYear || left.year)
    })[0] || rows[0] || null
}

function getLatestAvailableAnnualYear(firstAnnualReturnYear = '') {
  const firstStart = parseFinancialYearStart(firstAnnualReturnYear)
  const latestStart = getLatestCompletedFinancialYearStart()
  if (!firstStart) return formatFinancialYear(latestStart)
  return formatFinancialYear(firstStart > latestStart ? firstStart : latestStart)
}

function getFileDisplayValue(value) {
  if (!value) return ''
  if (Array.isArray(value)) return value.map(getFileDisplayValue).filter(Boolean).join(', ')
  if (typeof value === 'object') return value.name || value.fileName || value.originalName || value.url || value.fileUrl || value.path || value.dataUrl || ''
  return String(value)
}

function getFileUrl(value) {
  if (!value) return ''
  if (typeof value === 'object') return value.dataUrl || value.url || value.fileUrl || value.path || ''
  return String(value)
}

function getPoValue(...values) {
  return values.find((value) => {
    if (Array.isArray(value)) return value.length
    if (value && typeof value === 'object') return Boolean(getFileDisplayValue(value))
    return String(value || '').trim()
  }) || ''
}

function getAnnualReturnDraftValue(row = {}, key = '') {
  const draft = row?.draft && typeof row.draft === 'object' ? row.draft : {}
  const aliases = {
    'financials.compliancePoNo': ['Compliance PO No.'],
    'financials.compliancePoDate': ['Compliance PO Date'],
    'financials.compliancePoFile': ['Upload Compliance PO']
  }
  return [key, ...(aliases[key] || [])].map((item) => draft[item]).find((value) => getPoValue(value)) || ''
}

function getLeadPurchaseOrder(client = {}, quotations = [], leads = []) {
  const data = readClientData(client)
  const assignedServiceId = String(client.assignedServiceId || data.assignedServiceId || data.selectedLeadSnapshot?.assignedServiceId || '').trim()
  const matchIds = new Set([
    client.selectedLead, client.leadId, client.sourceLeadId, data.selectedLead, data.importMeta?.leadId,
    ...quotations.flatMap((quote) => [quote.leadRef, quote.leadId, quote.sourceLeadId, quote.businessLeadCode, quote.leadCode])
  ].map((value) => normalizeKey(value?._id || value?.id || value)).filter(Boolean))
  const clientCodes = new Set([getClientCode(client), client.leadCode, data.leadCode, client.selectedLead?.leadCode]
    .map(formatAtplCode).map(normalizeKey).filter(Boolean))
  const clientNames = [getClientName(client), data.basic?.tradeName, client.selectedLead?.company, client.selectedLead?.companyName].filter(Boolean)
  const matches = leads.filter((lead) => {
    const exactIdentity = [lead._id, lead.id, lead.leadCode].map(normalizeKey).some((id) => matchIds.has(id))
    const codeIdentity = clientCodes.has(normalizeKey(formatAtplCode(lead.leadCode)))
    const companyIdentity = clientNames.some((name) => businessNamesMatch(name, getLeadCompanyName(lead)))
    return exactIdentity || codeIdentity || companyIdentity
  })
    .flatMap((lead) => (lead.assignments || []).filter((assignment) => !assignedServiceId || !(lead.assignments || []).some((row) => row.assignedServiceId) || String(assignment.assignedServiceId || '').trim() === assignedServiceId).flatMap((assignment) => [...(assignment.poYearRows || []), ...(assignment.originalPoDetails ? [assignment.originalPoDetails] : [])].map((row) => ({ ...row, closedAt: assignment.closedAt || lead.closedAt || lead.updatedAt }))))
    .filter((row) => getPoValue(row.poNumber, row.poFileUrl))
    .sort((left, right) => new Date(right.poReceivedDate || right.updatedAt || right.closedAt || 0) - new Date(left.poReceivedDate || left.updatedAt || left.closedAt || 0))
  return { ...(matches[0] || {}), records: matches }
}

function getCompliancePoDetails(client = {}, quotations = [], annualReturns = [], leads = []) {
  const data = readClientData(client)
  const leadPo = getLeadPurchaseOrder(client, quotations, leads)
  const quoteWithPo = quotations.find((quote) => getPoValue(
    quote.compliancePoNo,
    quote.compliancePoDate,
    quote.compliancePoFile,
    quote.poNo,
    quote.poNumber,
    quote.purchaseOrderNo,
    quote.purchaseOrder?.number,
    quote.purchaseOrder?.date,
    quote.purchaseOrder?.document,
    quote.poDocument
  )) || {}
  const annualWithPo = annualReturns.find((row) => getPoValue(
    row.financials?.compliancePoNo,
    row.financials?.poNo,
    row.financials?.compliancePoDate,
    row.financials?.poDate,
    row.financials?.compliancePoFile,
    row.financials?.poDocument,
    getAnnualReturnDraftValue(row, 'financials.compliancePoNo'),
    getAnnualReturnDraftValue(row, 'financials.compliancePoDate'),
    getAnnualReturnDraftValue(row, 'financials.compliancePoFile')
  )) || {}
  const purchaseOrder = quoteWithPo.purchaseOrder && typeof quoteWithPo.purchaseOrder === 'object' ? quoteWithPo.purchaseOrder : {}
  const poNo = getPoValue(
    leadPo.poNumber,
    data.financials?.compliancePoNo,
    data.financials?.poNo,
    data.financials?.poNumber,
    data.validation?.poNumber,
    data.validation?.poNo,
    quoteWithPo.compliancePoNo,
    quoteWithPo.poNo,
    quoteWithPo.poNumber,
    quoteWithPo.purchaseOrderNo,
    purchaseOrder.number,
    annualWithPo.financials?.compliancePoNo,
    annualWithPo.financials?.poNo,
    getAnnualReturnDraftValue(annualWithPo, 'financials.compliancePoNo')
  )
  const poDate = getPoValue(
    leadPo.poDate,
    leadPo.poReceivedDate,
    data.financials?.compliancePoDate,
    data.financials?.poDate,
    data.validation?.poDate,
    quoteWithPo.compliancePoDate,
    quoteWithPo.poDate,
    quoteWithPo.purchaseOrderDate,
    purchaseOrder.date,
    annualWithPo.financials?.compliancePoDate,
    annualWithPo.financials?.poDate,
    getAnnualReturnDraftValue(annualWithPo, 'financials.compliancePoDate')
  )
  const poFile = getPoValue(
    leadPo.poFileUrl && { url: leadPo.poFileUrl, name: leadPo.poFileName || 'Purchase order' },
    data.financials?.compliancePoFile,
    data.financials?.poDocument,
    data.validation?.poDocument,
    quoteWithPo.compliancePoFile,
    quoteWithPo.poDocument,
    purchaseOrder.document,
    purchaseOrder.file,
    annualWithPo.financials?.compliancePoFile,
    annualWithPo.financials?.poDocument,
    getAnnualReturnDraftValue(annualWithPo, 'financials.compliancePoFile')
  )

  const hasPo = Boolean(poNo || poDate || getFileDisplayValue(poFile))
  return {
    poNo,
    poDate,
    records: (leadPo.records || []).map((po) => ({ poNo: po.poNumber || '', poDate: po.poDate || po.poReceivedDate || '', poEndDate: po.poEndDate || '', poFinancialYear: po.poFinancialYear || '', paymentTerm: po.paymentTerm || '', poAmount: po.poAmount ?? '', fileUrl: po.poFileUrl || '', fileName: po.poFileName || 'Purchase Order' })),
    poEndDate: getPoValue(leadPo.poEndDate, data.financials?.poEndDate, quoteWithPo.poEndDate, purchaseOrder.endDate, annualWithPo.financials?.poEndDate),
    poFinancialYear: getPoValue(leadPo.poFinancialYear, data.financials?.poFinancialYear, quoteWithPo.poFinancialYear, purchaseOrder.financialYear, annualWithPo.financials?.poFinancialYear),
    paymentTerm: getPoValue(leadPo.paymentTerm, data.financials?.paymentTerm, quoteWithPo.paymentTerm, purchaseOrder.paymentTerm, annualWithPo.financials?.paymentTerm),
    poAmount: getPoValue(leadPo.poAmount, data.financials?.poAmount, quoteWithPo.poAmount, purchaseOrder.amount, annualWithPo.financials?.poAmount),
    poFile,
    fileName: getFileDisplayValue(poFile),
    fileUrl: getFileUrl(poFile),
    source: hasPo ? (leadPo.poNumber || leadPo.poFileUrl ? 'Lead purchase order' : annualWithPo._id ? 'Annual Return upload' : quoteWithPo._id || quoteWithPo.id ? 'Quotation / PO data' : 'Client Master') : '',
    hasPo
  }
}

function getPerformanceTone(value = 0) {
  if (value >= 100) return 'complete'
  if (value > 90) return 'good'
  if (value > 75) return 'warn'
  return 'risk'
}

function buildPiboCategoryCards(clients = []) {
  const required = ['Producer', 'Brand Owner', 'Importer', 'SIMP', 'Recycler', 'PWP', 'Refurbisher']
  const counts = new Map(required.map((label) => [normalizeKey(label), { label, value: 0 }]))
  clients.forEach((client) => {
    const label = client.category || getClientCategory(client) || 'Unassigned'
    const key = normalizeKey(label)
    const existing = counts.get(key) || { label, value: 0 }
    existing.value += 1
    counts.set(key, existing)
  })
  return [...counts.values()].sort((a, b) => required.indexOf(a.label) - required.indexOf(b.label))
}

function buildManagerCards(users = [], rows = []) {
  const managerRoles = ['manager', 'operation head', 'operations head', 'admin', 'superadmin']
  return users
    .filter((user) => managerRoles.includes(normalizeKey(user.role)))
    .map((manager) => {
      const managerId = getUserId(manager)
      const teamUsers = users.filter((user) => String(user.managerId || user.operationHeadId || '') === managerId)
      const userIds = new Set([managerId, ...teamUsers.map(getUserId)].filter(Boolean))
      const managerRows = rows.filter((row) => userIds.has(getUserId(row.user)))
      const total = managerRows.reduce((sum, row) => sum + row.annualTotal, 0)
      const done = managerRows.reduce((sum, row) => sum + row.annualDone, 0)
      return {
        id: managerId || manager.email || manager.name,
        name: getUserName(manager),
        users: teamUsers.length,
        total,
        done,
        percent: percent(done, total)
      }
    })
    .filter((row) => row.users || row.total)
}

function mergeOperationRow(existing = {}, incoming = {}) {
  const annualReturns = [...new Map([...(existing.annualReturns || []), ...(incoming.annualReturns || [])].map((row) => [row._id || `${row.clientKey || row.clientName}-${row.annualYear || row.year}`, row])).values()]
  const quotations = [...new Map([...(existing.quotations || []), ...(incoming.quotations || [])].map((row) => [row._id || row.id || row.quotationNo || JSON.stringify(row), row])).values()]
  const displayAnnualReturn = getLatestOperationAnnualReturn(annualReturns)
  const annualYear = displayAnnualReturn?.annualYear || displayAnnualReturn?.year || existing.annualYear || incoming.annualYear || getLatestAvailableAnnualYear(existing.firstAnnualReturnYear || incoming.firstAnnualReturnYear)
  const annualDone = displayAnnualReturn ? getAnnualTabCompletedCount(displayAnnualReturn) : Math.max(existing.annualDone || 0, incoming.annualDone || 0)
  const annualTotal = annualReturns.length
  const poDetails = existing.hasPo ? existing.poDetails : incoming.poDetails
  return {
    ...existing,
    ...incoming,
    atplCode: existing.atplCode && existing.atplCode !== '-' ? existing.atplCode : incoming.atplCode,
    quotations,
    quoteCount: quotations.length,
    hasQuotation: quotations.length > 0,
    poDetails,
    hasPo: Boolean(existing.hasPo || incoming.hasPo),
    annualReturns,
    annualDone,
    annualTotal,
    annualPercent: percent(annualDone, annualTotal),
    annualYear,
    firstAnnualReturnYear: existing.firstAnnualReturnYear || incoming.firstAnnualReturnYear,
    compliancePending: Boolean(existing.compliancePending || incoming.compliancePending),
    user: existing.user || incoming.user,
    userName: existing.userName && existing.userName !== 'Unassigned' ? existing.userName : incoming.userName,
    assignedKeys: [...new Set([...(existing.assignedKeys || []), ...(incoming.assignedKeys || [])])]
  }
}

function dedupeOperationRows(rows = []) {
  const byKey = new Map()
  rows.forEach((row) => {
    const key = row.dedupeKey || row.id
    byKey.set(key, byKey.has(key) ? mergeOperationRow(byKey.get(key), row) : row)
  })
  return [...byKey.values()]
}

function buildOperationsRows({ clients = [], annualReturns = [], quotations = [], pendingClients = [], users = [], leads = [] }) {
  const userByMatchKey = new Map()
  users.forEach((user) => getUserMatchKeys(user).forEach((key) => {
    if (!userByMatchKey.has(key)) userByMatchKey.set(key, user)
  }))
  const clientCodesByCompany = new Map()
  clients.forEach((client) => {
    const companyKey = normalizeBusinessKey(getClientName(client))
    const code = getClientCode(client)
    if (!companyKey || !code || code === '-') return
    const codes = clientCodesByCompany.get(companyKey) || new Set()
    codes.add(code)
    clientCodesByCompany.set(companyKey, codes)
  })
  const pendingClientById = new Map()
  pendingClients.forEach((client) => {
    ;[client.id, client.sourceClientId, client.payload?.id]
      .map(normalizeKey).filter(Boolean)
      .forEach((key) => pendingClientById.set(key, client))
  })
  const annualByClientKey = new Map()
  annualReturns.forEach((row) => {
    getAnnualReturnClientKeys(row).forEach((key) => {
      const rows = annualByClientKey.get(key) || []
      rows.push(row)
      annualByClientKey.set(key, rows)
    })
  })
  const quotationsByClientKey = new Map()
  quotations.forEach((quote) => {
    getQuotationClientKeys(quote).forEach((key) => {
      const rows = quotationsByClientKey.get(key) || []
      rows.push(quote)
      quotationsByClientKey.set(key, rows)
    })
  })

  const quotationsByContactKey = new Map()
  const addQuotationContactKey = (key, quote) => {
    if (!key) return
    const rows = quotationsByContactKey.get(key) || []
    rows.push(quote)
    quotationsByContactKey.set(key, rows)
  }
  quotations.forEach((quote) => {
    const details = quote.leadDetails || {}
    ;[quote.companyName, quote.clientName, details.companyName, quote.leadName]
      .map(normalizeBusinessKey).filter(Boolean)
      .forEach((value) => addQuotationContactKey(`company:${value}`, quote))
    ;[quote.email, quote.emailId, details.email, details.emailId]
      .map(normalizeEmail).filter(Boolean)
      .forEach((value) => addQuotationContactKey(`email:${value}`, quote))
    ;[quote.mobileNo1, quote.mobileNo2, quote.mobile, quote.phone, details.mobileNo1, details.mobileNo2, details.mobile, details.phone]
      .map(normalizeDigits).filter((value) => value.length >= 8)
      .forEach((value) => addQuotationContactKey(`phone:${value.slice(-10)}`, quote))
  })

  const rows = clients.filter((client) => client && typeof client === 'object').map((client) => {
    const data = readClientData(client)
    const keys = getClientMatchKeys(client)
    const clientAnnualReturns = [...new Map(keys.flatMap((key) => annualByClientKey.get(key) || []).map((row) => [row._id || `${row.clientKey}-${row.annualYear}`, row])).values()]
    const keyedQuotations = keys.flatMap((key) => quotationsByClientKey.get(key) || [])
    const contactKeys = [
      ...[getClientName(client), data.basic?.clientLegalName, data.basic?.tradeName].map(normalizeBusinessKey).filter(Boolean).map((value) => `company:${value}`),
      ...[data.otp?.email, data.authorised?.email, data.coordinating?.email, client.email, client.emailId].map(normalizeEmail).filter(Boolean).map((value) => `email:${value}`),
      ...[data.otp?.mobile, data.otp?.mobileNo, data.authorised?.mobile, data.authorised?.mobileNo, data.coordinating?.mobile, data.coordinating?.mobileNo, client.mobileNo1, client.mobileNo2, client.mobile, client.phone]
        .map(normalizeDigits).filter((value) => value.length >= 8).map((value) => `phone:${value.slice(-10)}`)
    ]
    const looseQuotations = contactKeys.flatMap((key) => quotationsByContactKey.get(key) || [])
    const clientQuotations = [...new Map([...keyedQuotations, ...looseQuotations].map((row) => [row._id || row.id || row.quotationNumber || row.quotationNo || JSON.stringify(row), row])).values()]
    const user = getAssignedUserKeysFromClient(client).map((key) => userByMatchKey.get(key)).find(Boolean) || null
    const annualTotal = clientAnnualReturns.length
    const firstAnnualReturnYear = getClientFirstAnnualYear(client)
    const displayAnnualReturn = getLatestOperationAnnualReturn(clientAnnualReturns)
    const annualYear = displayAnnualReturn?.annualYear || displayAnnualReturn?.year || getLatestAvailableAnnualYear(firstAnnualReturnYear)
    const annualDone = displayAnnualReturn ? getAnnualTabCompletedCount(displayAnnualReturn) : 0
    const compliancePending = clientAnnualReturns.some(isAnnualCompliancePending)
    const poDetails = getCompliancePoDetails(client, clientQuotations, clientAnnualReturns, leads)
    const pendingClient = [client._id, client.id, data.importMeta?.uniqueId]
      .map(normalizeKey).filter(Boolean)
      .map((key) => pendingClientById.get(key)).find(Boolean) || {}
    const directClientCode = getClientCode(client)
    const companyCodes = clientCodesByCompany.get(normalizeBusinessKey(getClientName(client))) || new Set()
    const uniqueCompanyCode = companyCodes.size === 1 ? [...companyCodes][0] : ''
    const quotationLeadCode = clientQuotations.map((quote) => quote.businessLeadCode || quote.sourceLeadId || quote.leadCode || quote.leadDetails?.leadCode).find(Boolean) || ''
    const pendingClientCode = formatAtplCode(pendingClient.uniqueId || pendingClient.clientCode || '')
    const validDirectCode = directClientCode !== '-' && !isGeneratedLeadCode(directClientCode) ? directClientCode : ''
    const validQuotationCode = quotationLeadCode && !isGeneratedLeadCode(quotationLeadCode) && !/^QUOTATION-/i.test(quotationLeadCode) ? quotationLeadCode : ''
    const validUniqueCompanyCode = uniqueCompanyCode && !isGeneratedLeadCode(uniqueCompanyCode) ? uniqueCompanyCode : ''
    const resolvedClientCode = pendingClientCode || validDirectCode || validUniqueCompanyCode || validQuotationCode || '-'
    const operationRow = {
      id: client._id || client.id || getClientCode(client) || getClientName(client),
      client,
      dedupeKey: getClientDedupeKey(client),
      clientKey: client._id || client.id || client.clientKey || getClientCode(client),
      atplCode: formatAtplCode(resolvedClientCode) || '-',
      companyName: getClientName(client),
      eprCategory: data.basic?.eprCategory || data.eprCategory || '-',
      category: getClientApplicantGroup(client),
      subApplicantType: data.basic?.subApplicantType || data.basic?.piboSubcategory || (getClientCategory(client) !== 'Unassigned' ? getClientCategory(client) : formatPiboCategory(pendingClient.piboCategory)),
      quotations: clientQuotations,
      quoteCount: clientQuotations.length,
      hasQuotation: clientQuotations.length > 0,
      poDetails,
      hasPo: poDetails.hasPo,
      annualDone,
      annualTotal,
      annualPercent: percent(annualDone, annualTotal),
      annualReturns: clientAnnualReturns,
      annualYear,
      firstAnnualReturnYear,
      compliancePending,
      approval: pendingClient,
      user,
      userName: user ? getUserName(user) : (getAssignedUserKeysFromClient(client)[0] || 'Unassigned'),
      assignedKeys: getAssignedUserKeysFromClient(client)
    }
    return operationRow
  })
  return dedupeOperationRows(rows)
}

function userBelongsToManager(user = {}, manager = {}) {
  const managerId = getUserId(manager)
  const managerKeys = getUserMatchKeys(manager)
  const reportingKeys = [user.managerId, user.operationHeadId, user.reportingTo, user.manager?._id, user.manager?.id, user.manager?.name, user.manager?.email].map(normalizeKey).filter(Boolean)
  return Boolean(managerId && reportingKeys.includes(normalizeKey(managerId))) || reportingKeys.some((key) => managerKeys.includes(key))
}

function getScopedOperationsRows(rows = [], users = [], currentUser = {}) {
  const role = normalizeKey(currentUser?.role)
  const currentUserId = getUserId(currentUser)
  if (adminRoles.includes(currentUser?.role) || role === 'superadmin' || role === 'admin') return rows
  if (role.includes('compliance')) return rows.filter((row) => row.compliancePending)
  const currentUserKeys = getUserMatchKeys(currentUser)
  if (role === 'manager' || role.includes('operation head')) {
    const allowedKeys = new Set(
      users
        .filter((user) => userBelongsToManager(user, currentUser) || getUserId(user) === currentUserId)
        .flatMap(getUserMatchKeys)
    )
    currentUserKeys.forEach((key) => allowedKeys.add(key))
    return rows.filter((row) => getUserMatchKeys(row.user).some((key) => allowedKeys.has(key)) || (row.assignedKeys || []).some((key) => allowedKeys.has(key)))
  }
  return rows.filter((row) => getUserMatchKeys(row.user).some((key) => currentUserKeys.includes(key)) || (row.assignedKeys || []).some((key) => currentUserKeys.includes(key)))
}

function getLeadUserKey(lead = {}, users = []) {
  const ownerKeys = getLeadOwnerKeys(lead)
  const matchedUser = findUserByOwnerPriority(users, ownerKeys)
  if (matchedUser) return getUserId(matchedUser) || getUserName(matchedUser)
  return getLeadOwnerName(lead) || 'unassigned'
}

function getLeadUserName(lead = {}, users = []) {
  const ownerKeys = getLeadOwnerKeys(lead)
  const matchedUser = findUserByOwnerPriority(users, ownerKeys)
  return matchedUser ? getUserName(matchedUser) : getLeadOwnerName(lead)
}

function getOperationRowUserKeys(row = {}) {
  return [
    getUserId(row.user),
    row.userName,
    ...(row.assignedKeys || [])
  ].map(normalizeKey).filter(Boolean)
}

function getCompletedAnnualFilingCountForRow(row = {}) {
  const completedFilings = (row.annualReturns || []).filter((annualRow) => {
    return getAnnualTabCompletedCount(annualRow) >= 4 || isAnnualReturnDone(annualRow)
  }).length
  if (completedFilings) return completedFilings
  return (row.annualTotal && row.annualDone >= row.annualTotal) ? 1 : 0
}

function buildUserPerformanceCards(rows = [], users = [], currentUser = {}, leads = []) {
  const userRows = new Map()
  leads.forEach((lead) => {
    const key = getLeadUserKey(lead, users) || 'unassigned'
    const existing = userRows.get(key) || {
      id: key,
      name: getLeadUserName(lead, users) || 'Unassigned',
      done: 0,
      total: 0,
      pendingCompliance: 0,
      matchKeys: []
    }
    existing.total += 1
    existing.matchKeys = [...new Set([...existing.matchKeys, ...getLeadOwnerKeys(lead), normalizeKey(key), normalizeKey(existing.name)])]
    userRows.set(key, existing)
  })

  rows.forEach((row) => {
    const key = getUserId(row.user) || row.userName || 'unassigned'
    const existing = userRows.get(key) || {
      id: key,
      name: row.userName || 'Unassigned',
      done: 0,
      total: 0,
      pendingCompliance: 0,
      matchKeys: []
    }
    existing.done += getCompletedAnnualFilingCountForRow(row)
    if (!existing.total) existing.total += 1
    if (row.compliancePending) existing.pendingCompliance += 1
    existing.matchKeys = [...new Set([...existing.matchKeys, ...getOperationRowUserKeys(row), normalizeKey(key), normalizeKey(existing.name)])]
    userRows.set(key, existing)
  })

  const role = normalizeKey(currentUser?.role)
  if (role === 'manager' || role.includes('operation head') || adminRoles.includes(currentUser?.role)) {
    users.forEach((user) => {
      const id = getUserId(user)
      if (!id || userRows.has(id)) return
      if (adminRoles.includes(currentUser?.role) || userBelongsToManager(user, currentUser) || id === getUserId(currentUser)) {
        userRows.set(id, { id, name: getUserName(user), done: 0, total: 0, pendingCompliance: 0, matchKeys: getUserMatchKeys(user) })
      }
    })
  }

  return [...userRows.values()]
    .map((row) => {
      const safeDone = Math.min(row.done, row.total || row.done)
      const completion = percent(safeDone, row.total)
      return { ...row, done: safeDone, leadTotal: row.total, percent: completion, tone: getPerformanceTone(completion) }
    })
    .sort((a, b) => b.total - a.total || b.percent - a.percent)
}

function buildClientOwnershipAnalytics(rows = []) {
  const buckets = new Map()
  rows.forEach((row) => {
    const id = getUserId(row.user) || normalizeKey(row.userName) || 'unassigned'
    const name = row.userName || getUserName(row.user) || 'Unassigned'
    const bucket = buckets.get(id) || { id, name, total: 0, completed: 0, pending: 0, annualDone: 0, annualTotal: 0, dataComplete: 0, dataPartial: 0, dataMissing: 0, completenessTotal: 0, companies: [] }
    const completed = getCompletedAnnualFilingCountForRow(row) > 0
    const profile = getClientDataCompleteness(row.client || {})
    bucket.total += 1
    bucket.completed += completed ? 1 : 0
    bucket.pending += completed ? 0 : 1
    bucket.annualDone += Number(row.annualDone || 0)
    bucket.annualTotal += Number(row.annualTotal || 0)
    bucket.completenessTotal += profile.percent
    bucket.dataComplete += profile.status === 'complete' ? 1 : 0
    bucket.dataPartial += profile.status === 'partial' ? 1 : 0
    bucket.dataMissing += profile.status === 'missing' ? 1 : 0
    const clientUpdatedAt = row.client?.updatedAt || row.client?.data?.updatedAt || row.client?.createdAt
    const clientCreatedAt = row.client?.createdAt || row.client?.data?.createdAt || clientUpdatedAt
    const daysPending = getDaysSince(clientCreatedAt)
    const freshnessDays = getDaysSince(clientUpdatedAt)
    const stage = completed
      ? 'Completed'
      : row.compliancePending
        ? 'Compliance Review'
        : row.annualDone > 0
          ? 'Annual Processing'
          : profile.percent >= 75
            ? 'Data Review'
            : 'Data Capture'
    const approvalStatus = row.client?.adminControls?.approvalStatus || readClientData(row.client || {}).adminControls?.approvalStatus || 'Pending'
    const riskReasons = []
    if (profile.percent < 50) riskReasons.push('Data incomplete')
    if (!row.hasQuotation) riskReasons.push('Quotation missing')
    if (!row.hasPo) riskReasons.push('PO missing')
    if (row.annualDone > 0 && row.annualDone < row.annualTotal && daysPending > 30) riskReasons.push('Annual return overdue')
    if (normalizeKey(approvalStatus).includes('reject')) riskReasons.push('Approval rejected')
    if (freshnessDays > 30) riskReasons.push('No recent activity')
    const riskScore = Math.min(100, riskReasons.length * 18 + Math.min(30, Math.floor(daysPending / 15) * 5))
    const risk = riskScore >= 70 ? 'Critical' : riskScore >= 45 ? 'High Risk' : riskScore >= 20 ? 'Attention Required' : 'Healthy'
    const timeline = buildCompanyActivityTimeline(row, { clientCreatedAt, clientUpdatedAt, stage, approvalStatus })
    bucket.companies.push({
      id: row.id,
      name: row.companyName,
      category: row.category,
      stage,
      annualDone: row.annualDone,
      annualTotal: row.annualTotal,
      annualYear: row.annualYear,
      compliancePending: row.compliancePending,
      hasQuotation: row.hasQuotation,
      hasPo: row.hasPo,
      approvalStatus,
      workflowStatus: row.client?.workflowStatus || 'draft',
      clientCreatedAt,
      clientUpdatedAt,
      daysPending,
      freshnessDays,
      risk,
      riskScore,
      riskReasons,
      timeline,
      ...profile
    })
    buckets.set(id, bucket)
  })
  return [...buckets.values()]
    .map((item) => ({
      ...item,
      completion: percent(item.completed, item.total),
      workProgress: percent(item.annualDone, item.annualTotal)
      , averageDataFill: item.total ? Math.round(item.completenessTotal / item.total) : 0,
      overdue: item.companies.filter((company) => company.daysPending > 30 && company.stage !== 'Completed').length,
      stale: item.companies.filter((company) => company.freshnessDays > 30).length,
      highRisk: item.companies.filter((company) => ['High Risk', 'Critical'].includes(company.risk)).length,
      performanceScore: calculateEmployeePerformanceScore(item)
    }))
    .sort((a, b) => b.total - a.total || b.completion - a.completion)
}

function getDaysSince(value) {
  const date = new Date(value || '')
  if (Number.isNaN(date.getTime())) return 0
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000))
}

function formatAnalyticsDate(value) {
  const date = new Date(value || '')
  return Number.isNaN(date.getTime()) ? 'Not available' : new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

function calculateEmployeePerformanceScore(item = {}) {
  const total = item.total || 0
  const dataScore = total ? item.completenessTotal / total : 0
  const completionScore = percent(item.completed, total)
  const annualScore = percent(item.annualDone, item.annualTotal)
  const agingPenalty = total ? Math.min(100, (item.companies || []).reduce((sum, company) => sum + Math.min(company.daysPending, 60), 0) / total * 1.6) : 0
  const riskPenalty = total ? percent((item.companies || []).filter((company) => ['High Risk', 'Critical'].includes(company.risk)).length, total) : 0
  return Math.max(0, Math.min(100, Math.round(dataScore * .35 + completionScore * .3 + annualScore * .25 + (100 - agingPenalty) * .05 + (100 - riskPenalty) * .05)))
}

function buildCompanyActivityTimeline(row = {}, meta = {}) {
  const events = []
  if (meta.clientCreatedAt) events.push({ label: 'Client created', date: meta.clientCreatedAt, tone: 'blue' })
  if (row.userName) events.push({ label: `Assigned to ${row.userName}`, date: meta.clientCreatedAt, tone: 'teal' })
  if (meta.clientUpdatedAt && meta.clientUpdatedAt !== meta.clientCreatedAt) events.push({ label: 'Client data updated', date: meta.clientUpdatedAt, tone: 'teal' })
  const quoteDate = row.quotations?.map((quote) => quote.updatedAt || quote.createdAt || quote.quotationDate).filter(Boolean).sort().at(-1)
  if (quoteDate) events.push({ label: 'Quotation prepared', date: quoteDate, tone: 'violet' })
  if (row.hasPo) events.push({ label: 'Compliance PO available', date: meta.clientUpdatedAt, tone: 'green' })
  const annual = row.annualReturns?.slice().sort((a, b) => new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0)).at(-1)
  if (annual) events.push({ label: `Annual return ${row.annualDone}/${row.annualTotal}`, date: annual.updatedAt || annual.createdAt, tone: 'orange' })
  if (meta.stage === 'Compliance Review') events.push({ label: 'Submitted for compliance review', date: annual?.updatedAt, tone: 'orange' })
  if (meta.stage === 'Completed') events.push({ label: 'Processing completed', date: annual?.updatedAt || meta.clientUpdatedAt, tone: 'green' })
  return events.filter((event) => event.date).sort((a, b) => new Date(a.date) - new Date(b.date))
}

const CLIENT_DATA_CHECKS = [
  { label: 'Legal name', paths: ['basic.clientLegalName', 'basic.tradeName', 'clientName', 'companyName'] },
  { label: 'PIBO category', paths: ['basic.piboCategory', 'piboCategory'] },
  { label: 'EPR category', paths: ['basic.eprCategory', 'eprCategory'] },
  { label: 'GST number', paths: ['basic.gstNumber', 'validation.gstNumber', 'gstNumber'] },
  { label: 'PAN number', paths: ['basic.panNumber', 'validation.panNumber', 'panNumber'] },
  { label: 'Registered address', paths: ['basic.registeredAddress', 'address.registeredAddress', 'registeredAddress.addressLine1', 'addressLine1'] },
  { label: 'State', paths: ['basic.state', 'address.state', 'registeredAddress.state', 'state'] },
  { label: 'City', paths: ['basic.city', 'address.city', 'registeredAddress.city', 'city'] },
  { label: 'Contact person', paths: ['contact.contactPerson', 'basic.authorisedPersonName', 'contactPerson'] },
  { label: 'Email', paths: ['contact.email', 'contact.emails', 'basic.authorisedPersonEmail', 'email', 'emails'] },
  { label: 'Mobile', paths: ['contact.mobileNo1', 'contact.mobile', 'basic.otpMobile', 'mobileNo1', 'mobile'] },
  { label: 'CPCB registration', paths: ['cpcb.registrationNumber', 'basic.cpcbRegistrationNumber', 'data.registrationNumber'] }
]

function readPath(source, path) {
  return path.split('.').reduce((value, key) => value?.[key], source)
}

function hasClientValue(value) {
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.values(value).some(hasClientValue)
  return value !== undefined && value !== null && String(value).trim() !== '' && String(value).trim() !== '-'
}

function getClientDataCompleteness(client = {}) {
  const safeClient = asRecord(client)
  const data = readClientData(safeClient)
  const checks = CLIENT_DATA_CHECKS.map((check) => ({ ...check, filled: check.paths.some((path) => hasClientValue(readPath(data, path)) || hasClientValue(readPath(safeClient, path))) }))
  const filled = checks.filter((item) => item.filled).length
  const total = checks.length
  const completeness = percent(filled, total)
  return {
    percent: completeness,
    filled,
    totalFields: total,
    status: completeness >= 75 ? 'complete' : completeness >= 30 ? 'partial' : 'missing',
    missingFields: checks.filter((item) => !item.filled).map((item) => item.label)
    , filledFields: checks.filter((item) => item.filled).map((item) => item.label)
  }
}

function OperationMisSection({ rows = [], users = [], teams = [], onOpenFullMis }) {
  const [query, setQuery] = useState('')
  const [expandedTeams, setExpandedTeams] = useState(() => new Set())
  const [downloading, setDownloading] = useState(false)

  const groups = useMemo(() => {
    const userRows = users.map((user) => {
      const matchKeys = new Set(getUserMatchKeys(user))
      const ownedRows = rows.filter((row) => getOperationRowUserKeys(row).some((key) => matchKeys.has(key)))
      const completion = ownedRows.map((row) => getClientDataCompleteness(row.client))
      const filled = completion.reduce((sum, item) => sum + item.filled, 0)
      const total = completion.reduce((sum, item) => sum + item.totalFields, 0)
      return {
        id: getUserId(user), name: getUserName(user), email: user.email || '', role: normalizeKey(user.role),
        clientMasters: ownedRows.length, clientFieldsFilled: filled, clientFieldsMissing: Math.max(0, total - filled),
        clientCompletionPercentage: percent(filled, total)
      }
    })
    const byId = new Map(userRows.map((row) => [String(row.id), row]))
    const configured = teams.map((team, index) => {
      const managerId = String(team.manager?._id || team.manager?.id || team.manager || '')
      const manager = byId.get(managerId) || null
      const memberIds = new Set((team.members || []).map((entry) => String(entry?._id || entry?.id || entry)))
      const members = userRows.filter((row) => memberIds.has(String(row.id)) && String(row.id) !== managerId)
      const people = [...(manager ? [manager] : []), ...members]
      const filled = people.reduce((sum, row) => sum + row.clientFieldsFilled, 0)
      const missing = people.reduce((sum, row) => sum + row.clientFieldsMissing, 0)
      return { id: String(team._id || team.id || index), name: team.name || `Team ${index + 1}`, manager, members,
        clientMasters: people.reduce((sum, row) => sum + row.clientMasters, 0), filled, missing, percentage: percent(filled, filled + missing) }
    })
    if (configured.length) return configured
    const managers = userRows.filter((row) => row.role === 'manager')
    return managers.map((manager, index) => {
      const source = users.find((user) => String(getUserId(user)) === String(manager.id)) || {}
      const members = userRows.filter((row) => {
        const member = users.find((user) => String(getUserId(user)) === String(row.id)) || {}
        return row.id !== manager.id && userBelongsToManager(member, source)
      })
      const people = [manager, ...members]
      const filled = people.reduce((sum, row) => sum + row.clientFieldsFilled, 0)
      const missing = people.reduce((sum, row) => sum + row.clientFieldsMissing, 0)
      return { id: String(manager.id || index), name: manager.name ? `${manager.name}'s Team` : `Team ${index + 1}`, manager, members,
        clientMasters: people.reduce((sum, row) => sum + row.clientMasters, 0), filled, missing, percentage: percent(filled, filled + missing) }
    })
  }, [rows, teams, users])

  const visibleGroups = useMemo(() => {
    const search = normalizeKey(query)
    if (!search) return groups
    return groups.map((group) => ({ ...group, members: group.members.filter((row) => normalizeKey(`${row.name} ${row.email}`).includes(search)) }))
      .filter((group) => normalizeKey(group.name).includes(search) || normalizeKey(`${group.manager?.name} ${group.manager?.email}`).includes(search) || group.members.length)
  }, [groups, query])
  const totals = groups.reduce((sum, group) => ({ clients: sum.clients + group.clientMasters, filled: sum.filled + group.filled, missing: sum.missing + group.missing }), { clients: 0, filled: 0, missing: 0 })
  const totalCompletion = percent(totals.filled, totals.filled + totals.missing)

  const toggleTeam = (id) => setExpandedTeams((current) => {
    const next = new Set(current)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const handleDownload = async () => {
    setDownloading(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      await downloadOperationMisPdf({ groups, period: { from: today, to: today } })
    } finally { setDownloading(false) }
  }

  return <section className="operation-mis-card">
    <header className="operation-mis-header">
      <div className="operation-mis-heading"><span><Building2 /></span><div><small>Team hierarchy MIS</small><h2>Operation MIS</h2><p>Team → Manager → Users · Client Master data completion analysis</p></div></div>
      <div className="operation-mis-actions">
        <label><Search className="h-4 w-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search team or user" /></label>
        <button type="button" onClick={handleDownload} disabled={downloading}><Download className="h-4 w-4" />{downloading ? 'Generating...' : 'Download PDF'}</button>
        <button type="button" className="primary" onClick={onOpenFullMis}>Full MIS <ArrowUpRight className="h-4 w-4" /></button>
      </div>
    </header>
    <div className="operation-mis-summary">
      <article><span>Operation teams</span><strong>{groups.length}</strong><small>Configured hierarchy</small></article>
      <article><span>Client masters</span><strong>{totals.clients}</strong><small>Assigned records</small></article>
      <article className="filled"><span>Data filled</span><strong>{totals.filled.toLocaleString('en-IN')}</strong><small>Critical fields complete</small></article>
      <article className="missing"><span>Data missing</span><strong>{totals.missing.toLocaleString('en-IN')}</strong><small>Needs team action</small></article>
      <article className="completion"><span>Overall completion</span><strong>{totalCompletion}%</strong><div><i style={{ width: `${totalCompletion}%` }} /></div></article>
    </div>
    <div className="operation-mis-table-wrap"><table className="operation-mis-table"><thead><tr><th>Team / User</th><th>Level</th><th>Reports to</th><th>Client masters</th><th>Data filled</th><th>Data missing</th><th>Completion</th></tr></thead><tbody>
      {visibleGroups.flatMap((group) => {
        const expanded = expandedTeams.has(group.id) || Boolean(query)
        const people = [...(group.manager ? [group.manager] : []), ...group.members]
        const teamRow = <tr key={`team-${group.id}`} className="team-row"><td><button type="button" onClick={() => toggleTeam(group.id)} aria-expanded={expanded}><ChevronRight className={expanded ? 'expanded' : ''} /><Building2 /> <strong>{group.name}</strong></button></td><td><em>Team total</em></td><td>{group.manager?.name || 'Not assigned'}</td><td>{group.clientMasters}</td><td>{group.filled.toLocaleString('en-IN')}</td><td>{group.missing.toLocaleString('en-IN')}</td><td><div className="mis-progress"><i style={{ width: `${group.percentage}%` }} /><strong>{group.percentage}%</strong></div></td></tr>
        const userRows = expanded ? people.map((row) => <tr key={`${group.id}-${row.id}`}><td><div className="mis-user"><span>{row.name?.slice(0, 1).toUpperCase() || 'U'}</span><div><strong>{row.name}</strong><small>{row.email || 'No email'}</small></div></div></td><td><em className={row === group.manager ? 'manager' : 'user'}>{row === group.manager ? 'Manager' : 'User'}</em></td><td>{row === group.manager ? '—' : group.manager?.name || 'Not assigned'}</td><td>{row.clientMasters}</td><td>{row.clientFieldsFilled.toLocaleString('en-IN')}</td><td>{row.clientFieldsMissing.toLocaleString('en-IN')}</td><td><div className="mis-progress user"><i style={{ width: `${row.clientCompletionPercentage}%` }} /><strong>{row.clientCompletionPercentage}%</strong></div></td></tr>) : []
        return [teamRow, ...userRows]
      })}
      {!visibleGroups.length && <tr><td colSpan="7" className="operation-mis-empty">No matching Operations team or user found.</td></tr>}
    </tbody></table></div>
    <footer><span><i /> Live Client Master quality view</span><small>Click a team row to view manager and users</small></footer>
  </section>
}

function getPiboTypes(value = '') {
  const category = normalizeKey(value)
  const types = []
  if (category.includes('producer')) types.push('Producer')
  if (category.includes('importer')) types.push('Importer')
  if (category.includes('brand owner') || category.includes('brandowner')) types.push('Brand Owner')
  return types.length ? types : ['Other / Unassigned']
}

function ClientOwnershipAnalyticsModal({ rows = [], onClose }) {
  const [selectedId, setSelectedId] = useState('all')
  const [selectedCompany, setSelectedCompany] = useState(null)
  const [stageFilter, setStageFilter] = useState('all')
  const [riskFilter, setRiskFilter] = useState('all')
  const [ageFilter, setAgeFilter] = useState('all')
  const [dataFilter, setDataFilter] = useState('all')
  const [piboFilter, setPiboFilter] = useState('all')
  const [compareA, setCompareA] = useState('')
  const [compareB, setCompareB] = useState('')
  const analytics = useMemo(() => buildClientOwnershipAnalytics(rows), [rows])
  const selected = selectedId === 'all' ? null : analytics.find((item) => String(item.id) === String(selectedId))
  const allCompanies = useMemo(() => analytics.flatMap((item) => item.companies.map((company) => ({ ...company, assignee: item.name, assigneeId: item.id }))), [analytics])
  const filteredCompanies = useMemo(() => allCompanies.filter((company) => {
    const selectedMatch = selectedId === 'all' || String(company.assigneeId) === String(selectedId)
    const stageMatch = stageFilter === 'all' || company.stage === stageFilter
    const riskMatch = riskFilter === 'all' || company.risk === riskFilter
    const dataMatch = dataFilter === 'all' || company.status === dataFilter
    const ageMatch = ageFilter === 'all' || (ageFilter === '0-7' && company.daysPending <= 7) || (ageFilter === '8-15' && company.daysPending >= 8 && company.daysPending <= 15) || (ageFilter === '16-30' && company.daysPending >= 16 && company.daysPending <= 30) || (ageFilter === '30+' && company.daysPending > 30)
    const piboMatch = piboFilter === 'all' || getPiboTypes(company.category).includes(piboFilter)
    return selectedMatch && stageMatch && riskMatch && dataMatch && ageMatch && piboMatch
  }), [ageFilter, allCompanies, dataFilter, piboFilter, riskFilter, selectedId, stageFilter])
  const total = selected?.total ?? analytics.reduce((sum, item) => sum + item.total, 0)
  const completed = selected?.completed ?? analytics.reduce((sum, item) => sum + item.completed, 0)
  const pending = selected?.pending ?? analytics.reduce((sum, item) => sum + item.pending, 0)
  const rate = percent(completed, total)
  const dataComplete = selected?.dataComplete ?? analytics.reduce((sum, item) => sum + item.dataComplete, 0)
  const dataPartial = selected?.dataPartial ?? analytics.reduce((sum, item) => sum + item.dataPartial, 0)
  const dataMissing = selected?.dataMissing ?? analytics.reduce((sum, item) => sum + item.dataMissing, 0)
  const averageDataFill = selected?.averageDataFill ?? (total ? Math.round(analytics.reduce((sum, item) => sum + item.completenessTotal, 0) / total) : 0)
  const donutRows = [{ name: 'Completed', value: completed, color: '#12a67d' }, { name: 'Pending', value: pending, color: '#f59e0b' }].filter((item) => item.value)
  const chartRows = (selected ? [selected] : analytics).slice(0, 10)
  const agingBuckets = [
    { label: '0–7 days', value: filteredCompanies.filter((item) => item.daysPending <= 7).length, tone: 'good' },
    { label: '8–15 days', value: filteredCompanies.filter((item) => item.daysPending >= 8 && item.daysPending <= 15).length, tone: 'blue' },
    { label: '16–30 days', value: filteredCompanies.filter((item) => item.daysPending >= 16 && item.daysPending <= 30).length, tone: 'warn' },
    { label: '30+ days', value: filteredCompanies.filter((item) => item.daysPending > 30).length, tone: 'risk' }
  ]
  const missingFieldRows = CLIENT_DATA_CHECKS.map((check) => ({ name: check.label, count: filteredCompanies.filter((company) => company.missingFields.includes(check.label)).length })).sort((a, b) => b.count - a.count).slice(0, 5)
  const funnelRows = [
    { label: 'Total Clients', value: filteredCompanies.length },
    { label: 'Data Filled', value: filteredCompanies.filter((item) => item.percent >= 75).length },
    { label: 'Quotation Ready', value: filteredCompanies.filter((item) => item.hasQuotation).length },
    { label: 'PO Received', value: filteredCompanies.filter((item) => item.hasPo).length },
    { label: 'Annual Started', value: filteredCompanies.filter((item) => item.annualDone > 0).length },
    { label: 'Completed', value: filteredCompanies.filter((item) => item.stage === 'Completed').length }
  ]
  const comparison = [analytics.find((item) => String(item.id) === String(compareA)), analytics.find((item) => String(item.id) === String(compareB))].filter(Boolean)
  const rankedEmployees = analytics.slice().sort((a, b) => b.performanceScore - a.performanceScore || b.completed - a.completed || b.averageDataFill - a.averageDataFill || a.name.localeCompare(b.name))
  const piboSourceCompanies = selected ? allCompanies.filter((company) => String(company.assigneeId) === String(selected.id)) : allCompanies
  const piboRows = ['Producer', 'Importer', 'Brand Owner', 'Other / Unassigned'].map((type) => {
    const companies = piboSourceCompanies.filter((company) => getPiboTypes(company.category).includes(type))
    const completedCount = companies.filter((company) => company.stage === 'Completed').length
    return {
      type,
      total: companies.length,
      completed: completedCount,
      pending: Math.max(0, companies.length - completedCount),
      dataFill: companies.length ? Math.round(companies.reduce((sum, company) => sum + company.percent, 0) / companies.length) : 0,
      annualProgress: companies.length ? Math.round(companies.reduce((sum, company) => sum + percent(company.annualDone, company.annualTotal), 0) / companies.length) : 0
    }
  }).filter((item) => item.total || item.type !== 'Other / Unassigned')

  function exportManagementReport() {
    const rowsToExport = filteredCompanies.map((company) => ({ Assignee: company.assignee, Company: company.name, Category: company.category, Stage: company.stage, Risk: company.risk, 'Days Pending': company.daysPending, 'Data Filled %': company.percent, 'Filled Fields': company.filledFields.join(', '), 'Missing Fields': company.missingFields.join(', '), Quotation: company.hasQuotation ? 'Available' : 'Missing', 'Compliance PO': company.hasPo ? 'Available' : 'Missing', 'Annual Progress': `${company.annualDone}/${company.annualTotal}`, Approval: company.approvalStatus, 'Last Updated': formatAnalyticsDate(company.clientUpdatedAt) }))
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rowsToExport), 'Client Analytics')
    XLSX.writeFile(workbook, `client-analytics-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <motion.div className="client-analytics-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.section className="client-analytics-modal" initial={{ opacity: 0, y: 24, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, scale: .98 }} transition={{ type: 'spring', stiffness: 360, damping: 30 }}>
        <header className="client-analytics-head">
          <div><span>Operations intelligence</span><h2>Client Ownership Analytics</h2><p>Assignee-wise workload, completion and pending client analysis</p></div>
          <div className="client-analytics-head-actions">
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} aria-label="Filter assignee"><option value="all">All assignees</option>{analytics.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
            <button type="button" onClick={onClose} aria-label="Close analytics"><X className="h-5 w-5" /></button>
          </div>
        </header>
        <div className="client-analytics-body">
          <div className="client-analytics-toolbar"><div><select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}><option value="all">All stages</option>{['Data Capture', 'Data Review', 'Annual Processing', 'Compliance Review', 'Completed'].map((value) => <option key={value}>{value}</option>)}</select><select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)}><option value="all">All risks</option>{['Healthy', 'Attention Required', 'High Risk', 'Critical'].map((value) => <option key={value}>{value}</option>)}</select><select value={dataFilter} onChange={(event) => setDataFilter(event.target.value)}><option value="all">All data quality</option><option value="complete">Fully filled</option><option value="partial">Partial</option><option value="missing">Not filled</option></select><select value={piboFilter} onChange={(event) => setPiboFilter(event.target.value)}><option value="all">All PIBO types</option><option>Producer</option><option>Importer</option><option>Brand Owner</option><option>Other / Unassigned</option></select><select value={ageFilter} onChange={(event) => setAgeFilter(event.target.value)}><option value="all">All aging</option><option value="0-7">0–7 days</option><option value="8-15">8–15 days</option><option value="16-30">16–30 days</option><option value="30+">30+ days</option></select></div><div><button type="button" onClick={exportManagementReport}>Export Excel</button><button type="button" onClick={() => window.print()}>Print / PDF</button></div></div>
          <div className="client-analytics-kpis">
            <article><span>Total Clients</span><strong>{total}</strong><small>{selected?.name || `${analytics.length} assignees`}</small></article>
            <article className="done"><span>Completed</span><strong>{completed}</strong><small>{rate}% completion rate</small></article>
            <article className="pending"><span>Pending</span><strong>{pending}</strong><small>{percent(pending, total)}% needs action</small></article>
            <article className="rate"><span>Performance</span><strong>{rate}%</strong><small>{rate >= 75 ? 'Healthy delivery' : rate >= 45 ? 'Needs attention' : 'Critical backlog'}</small></article>
          </div>
          <div className="client-data-quality-strip">
            <div><span>Company data quality</span><strong>{averageDataFill}%</strong><small>Average fields filled</small></div>
            <div className="complete"><span>Fully filled</span><strong>{dataComplete}</strong><small>75% or more data</small></div>
            <div className="partial"><span>Partially filled</span><strong>{dataPartial}</strong><small>30–74% data</small></div>
            <div className="missing"><span>Not filled</span><strong>{dataMissing}</strong><small>Less than 30% data</small></div>
          </div>
          <article className="pibo-assignee-analytics"><header><div><span>PIBO portfolio intelligence</span><h3>{selected?.name || 'Operations team'} — category-wise completion</h3></div><small>Click a category to filter companies</small></header><div className="pibo-assignee-grid">{piboRows.map((item) => <button type="button" className={`pibo-assignee-card ${normalizeKey(item.type).replace(/\s+/g, '-')} ${piboFilter === item.type ? 'selected' : ''}`} key={item.type} onClick={() => setPiboFilter(piboFilter === item.type ? 'all' : item.type)}><header><span>{item.type}</span><strong>{item.total}</strong></header><div className="pibo-counts"><p><b>{item.completed}</b><span>Completed</span></p><p><b>{item.pending}</b><span>Pending</span></p></div><div className="pibo-progress"><span>Data fill <b>{item.dataFill}%</b></span><i><em style={{ width: `${item.dataFill}%` }} /></i></div><div className="pibo-progress annual"><span>Annual progress <b>{item.annualProgress}%</b></span><i><em style={{ width: `${item.annualProgress}%` }} /></i></div></button>)}</div></article>
          <div className="client-intelligence-grid"><article className="aging-panel"><header><div><span>Aging & SLA</span><h3>Pending company aging</h3></div><b>{filteredCompanies.filter((item) => item.daysPending > 30).length} breached</b></header><div>{agingBuckets.map((item) => <section className={item.tone} key={item.label}><strong>{item.value}</strong><span>{item.label}</span><i style={{ width: `${percent(item.value, Math.max(filteredCompanies.length, 1))}%` }} /></section>)}</div><footer>Oldest: {filteredCompanies.slice().sort((a, b) => b.daysPending - a.daysPending)[0]?.name || 'No company'} · {filteredCompanies.slice().sort((a, b) => b.daysPending - a.daysPending)[0]?.daysPending || 0} days</footer></article><article className="data-gap-panel"><header><div><span>Missing data intelligence</span><h3>Top 5 data gaps</h3></div></header><div>{missingFieldRows.map((item) => <section key={item.name}><span>{item.name}</span><div><i style={{ width: `${percent(item.count, Math.max(filteredCompanies.length, 1))}%` }} /></div><strong>{item.count}</strong><small>{percent(item.count, Math.max(filteredCompanies.length, 1))}%</small></section>)}</div></article></div>
          <article className="client-funnel-panel"><header><div><span>Stage funnel</span><h3>Client readiness and delivery conversion</h3></div><small>Applied filters: {filteredCompanies.length} companies</small></header><div>{funnelRows.map((item, index) => <section key={item.label} style={{ '--funnel-width': `${Math.max(28, percent(item.value, Math.max(funnelRows[0].value, 1)))}%` }}><div><b>{item.value}</b><span>{item.label}</span></div>{index < funnelRows.length - 1 && <small>{percent(funnelRows[index + 1].value, Math.max(item.value, 1))}% move forward</small>}</section>)}</div></article>
          <div className="employee-intelligence"><article><header><div><span>Employee score</span><h3>Weighted performance</h3></div><small>Data 35% · Completion 30% · Annual 25% · Risk/Aging 10%</small></header><div>{analytics.slice(0, 8).map((item) => <section key={item.id}><strong>{item.name}</strong><div><i style={{ width: `${item.performanceScore}%` }} /></div><b>{item.performanceScore}</b><small>{item.highRisk} risk · {item.overdue} overdue</small></section>)}</div></article><article><header><div><span>Workload balance</span><h3>Capacity recommendation</h3></div></header><div className="workload-cards">{analytics.slice(0, 6).map((item) => { const average = analytics.length ? analytics.reduce((sum, row) => sum + row.total, 0) / analytics.length : 0; const load = item.total > average * 1.25 ? 'Overloaded' : item.total < average * .7 ? 'Under-utilized' : 'Balanced'; return <section className={normalizeKey(load)} key={item.id}><strong>{item.name}</strong><b>{item.total} clients</b><span>{load}</span></section> })}</div></article></div>
          <article className="employee-ranking"><header><div><span>Performance leaderboard</span><h3>Operations employee ranking</h3></div><small>Score → completed clients → data quality</small></header>{rankedEmployees.length ? <><div className="ranking-podium">{rankedEmployees.slice(0, 3).map((item, index) => <section className={`rank-${index + 1}`} key={item.id}><div className="rank-medal"><span>{index === 0 ? '★' : index + 1}</span></div><em>Rank {index + 1}</em><h4>{item.name}</h4><strong>{item.performanceScore}<small>/100</small></strong><div><span>{item.total} clients</span><span>{item.completed} completed</span><span>{item.averageDataFill}% data</span></div><i><b style={{ width: `${item.performanceScore}%` }} /></i></section>)}</div>{rankedEmployees.length > 3 && <div className="ranking-list">{rankedEmployees.slice(3).map((item, index) => <section key={item.id}><b>{index + 4}</b><div><strong>{item.name}</strong><span>{item.completed}/{item.total} completed · {item.averageDataFill}% data filled</span></div><div className="ranking-list-meter"><i style={{ width: `${item.performanceScore}%` }} /></div><em>{item.performanceScore}</em><small>{item.highRisk ? `${item.highRisk} risk` : 'Healthy'}</small></section>)}</div>}</> : <p className="comparison-empty">No employee performance data available.</p>}</article>
          <article className="employee-comparison"><header><div><span>Comparison mode</span><h3>Compare two employees</h3></div><div><select value={compareA} onChange={(event) => setCompareA(event.target.value)}><option value="">Employee A</option>{analytics.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={compareB} onChange={(event) => setCompareB(event.target.value)}><option value="">Employee B</option>{analytics.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div></header>{comparison.length ? <div>{comparison.map((item) => <section key={item.id}><h4>{item.name}</h4><p><span>Clients</span><b>{item.total}</b></p><p><span>Data filled</span><b>{item.averageDataFill}%</b></p><p><span>Completed</span><b>{item.completed}</b></p><p><span>Overdue</span><b>{item.overdue}</b></p><p><span>Score</span><b>{item.performanceScore}/100</b></p></section>)}</div> : <p className="comparison-empty">Select employees to compare performance.</p>}</article>
          <div className="client-analytics-charts">
            <article className="client-analytics-chart-card wide"><header><div><span>Workload comparison</span><h3>Clients by assignee</h3></div><b>Top {chartRows.length}</b></header><div className="client-analytics-bar"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartRows} margin={{ top: 12, right: 12, left: -18, bottom: 2 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7eeec" /><XAxis dataKey="name" tick={{ fontSize: 10, fill: '#667085', fontWeight: 700 }} axisLine={false} tickLine={false} interval={0} /><YAxis tick={{ fontSize: 10, fill: '#98a2b3' }} axisLine={false} tickLine={false} /><Tooltip /><Bar dataKey="completed" name="Completed" stackId="clients" fill="#12a67d" radius={[0, 0, 4, 4]} /><Bar dataKey="pending" name="Pending" stackId="clients" fill="#f4b544" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div></article>
            <article className="client-analytics-chart-card"><header><div><span>Portfolio health</span><h3>Completion split</h3></div></header><div className="client-analytics-donut"><ResponsiveContainer width="100%" height="100%"><RechartsPieChart><Pie data={donutRows.length ? donutRows : [{ name: 'No data', value: 1, color: '#e5e7eb' }]} dataKey="value" nameKey="name" innerRadius={62} outerRadius={84} paddingAngle={4} stroke="#fff" strokeWidth={4}>{(donutRows.length ? donutRows : [{ color: '#e5e7eb' }]).map((item) => <Cell key={item.name || item.color} fill={item.color} />)}</Pie><Tooltip /></RechartsPieChart></ResponsiveContainer><div><strong>{rate}%</strong><span>complete</span></div></div><footer><span><i className="done" />Completed {completed}</span><span><i className="pending" />Pending {pending}</span></footer></article>
          </div>
          <article className="client-analytics-matrix"><header><div><span>Assignee performance matrix</span><h3>Who has how many companies and how much data is filled</h3></div><small>Click an assignee for company-level details</small></header><div className="client-analytics-table-wrap"><table><thead><tr><th>Assignee</th><th>Companies</th><th>Data filled</th><th>Full / Partial / Empty</th><th>Annual progress</th><th>Completion</th></tr></thead><tbody>{analytics.map((item) => <tr key={item.id} onClick={() => setSelectedId(String(item.id))}><td><b>{item.name}</b></td><td>{item.total}</td><td><div className="client-progress data"><i style={{ width: `${item.averageDataFill}%` }} /></div><small>{item.averageDataFill}%</small></td><td><span className="quality-count good">{item.dataComplete}</span><span className="quality-count warn">{item.dataPartial}</span><span className="quality-count risk">{item.dataMissing}</span></td><td><div className="client-progress"><i style={{ width: `${item.workProgress}%` }} /></div><small>{item.workProgress}%</small></td><td><strong className={item.completion >= 75 ? 'good' : item.completion >= 45 ? 'warn' : 'risk'}>{item.completion}%</strong></td></tr>)}</tbody></table></div></article>
          {selected && <article className="company-data-drilldown"><header><div><span>Company drill-down</span><h3>{selected.name}: {filteredCompanies.length} visible companies</h3></div><button type="button" onClick={() => { setSelectedId('all'); setSelectedCompany(null) }}>View all assignees</button></header><div className="company-data-grid">{filteredCompanies.map((company) => <button type="button" className={`company-data-card ${company.status}`} key={company.id} onClick={() => setSelectedCompany(company)}><div><strong>{company.name}</strong><span>{company.category || 'Unassigned category'}</span></div><b>{company.percent}%</b><div className="company-data-meter"><i style={{ width: `${company.percent}%` }} /></div><footer><span>{company.filled}/{company.totalFields} critical fields</span><em>{company.status === 'complete' ? 'Data filled' : company.status === 'partial' ? 'Partial data' : 'Not filled'}</em></footer>{company.missingFields.length > 0 && <small>Missing: {company.missingFields.slice(0, 3).join(', ')}{company.missingFields.length > 3 ? ` +${company.missingFields.length - 3}` : ''}</small>}<mark>View full analysis →</mark></button>)}</div></article>}
          <AnimatePresence>{selectedCompany && <CompanyDataAnalysis company={selectedCompany} onClose={() => setSelectedCompany(null)} />}</AnimatePresence>
        </div>
      </motion.section>
    </motion.div>
  )
}

function CompanyDataAnalysis({ company, onClose }) {
  const navigate = useNavigate()
  const stages = ['Data Capture', 'Data Review', 'Annual Processing', 'Compliance Review', 'Completed']
  const activeIndex = Math.max(0, stages.indexOf(company.stage))
  const nextAction = company.missingFields.length
    ? `Fill ${company.missingFields.slice(0, 2).join(' and ')}`
    : !company.hasQuotation
      ? 'Create and attach quotation'
      : !company.hasPo
        ? 'Add compliance PO details'
        : company.annualDone < company.annualTotal
          ? 'Complete remaining annual return sections'
          : company.compliancePending
            ? 'Complete compliance review'
            : 'No immediate action required'
  return (
    <motion.div className="company-analysis-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.article className="company-analysis-panel" initial={{ opacity: 0, y: 18, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .98 }}>
        <header><div><span>Company data intelligence</span><h2>{company.name}</h2><p>{company.category} · FY {company.annualYear || 'Not selected'}</p></div><button type="button" onClick={onClose}><X className="h-5 w-5" /></button></header>
        <div className="company-analysis-body">
          <div className="company-analysis-summary"><div><span>Data filled</span><strong>{company.percent}%</strong><small>{company.filled}/{company.totalFields} critical fields</small></div><div><span>Current stage</span><strong className="stage">{company.stage}</strong><small>Workflow: {company.workflowStatus}</small></div><div><span>Annual progress</span><strong>{company.annualDone}/{company.annualTotal}</strong><small>{percent(company.annualDone, company.annualTotal)}% processing</small></div><div><span>Approval</span><strong className="stage">{company.approvalStatus}</strong><small>{company.compliancePending ? 'Waiting compliance review' : 'No compliance hold'}</small></div></div>
          <section className="company-stage-flow">{stages.map((stage, index) => <div className={`${index < activeIndex ? 'done' : index === activeIndex ? 'active' : ''}`} key={stage}><i>{index < activeIndex ? '✓' : index + 1}</i><span>{stage}</span></div>)}</section>
          <div className="company-analysis-grid"><section><header><span>Filled data</span><b>{company.filled}</b></header><div className="field-chip-grid">{company.filledFields.map((field) => <em className="filled" key={field}><CheckCircle2 className="h-3.5 w-3.5" />{field}</em>)}</div></section><section><header><span>Missing data</span><b>{company.missingFields.length}</b></header><div className="field-chip-grid">{company.missingFields.length ? company.missingFields.map((field) => <em className="missing" key={field}><ShieldAlert className="h-3.5 w-3.5" />{field}</em>) : <em className="filled"><CheckCircle2 className="h-3.5 w-3.5" />All critical fields filled</em>}</div></section></div>
          <div className="company-readiness"><div><span>Quotation</span><strong className={company.hasQuotation ? 'yes' : 'no'}>{company.hasQuotation ? 'Available' : 'Missing'}</strong></div><div><span>Compliance PO</span><strong className={company.hasPo ? 'yes' : 'no'}>{company.hasPo ? 'Available' : 'Missing'}</strong></div><div><span>Recommended next action</span><strong>{nextAction}</strong></div></div>
          <div className="company-freshness-row"><div><span>Created</span><strong>{formatAnalyticsDate(company.clientCreatedAt)}</strong><small>{company.daysPending} days in pipeline</small></div><div className={company.freshnessDays > 30 ? 'stale' : ''}><span>Last updated</span><strong>{formatAnalyticsDate(company.clientUpdatedAt)}</strong><small>{company.freshnessDays > 30 ? `Stale for ${company.freshnessDays} days` : `${company.freshnessDays} days ago`}</small></div><div className={`risk-${normalizeKey(company.risk).replace(/\s+/g, '-')}`}><span>Risk classification</span><strong>{company.risk}</strong><small>{company.riskReasons.join(', ') || 'No material risks'}</small></div></div>
          <section className="company-activity"><header><span>Company activity timeline</span><b>{company.timeline.length} events</b></header><div>{company.timeline.map((event, index) => <article key={`${event.label}-${index}`}><i className={event.tone} /><div><strong>{event.label}</strong><small>{formatAnalyticsDate(event.date)}</small></div></article>)}</div></section>
          <section className="company-action-centre"><header><span>Action centre</span><small>Continue work without leaving the analysis context</small></header><div><button type="button" onClick={() => navigate('/sales/client-master')}>Open Client Master</button><button type="button" onClick={() => navigate(`/sales/client-data-processing/${encodeURIComponent(company.id)}/${encodeURIComponent(company.annualYear || '2025-26')}`)}>Open Annual Return</button><button type="button" onClick={() => navigate('/sales/quotations?mode=add')}>Create Quotation</button><button type="button" onClick={() => navigate('/calendar')}>Open Calendar</button><button type="button" onClick={() => navigate('/calendar')}>Add Follow-up</button><button type="button" onClick={() => window.print()}>Print Summary</button></div></section>
        </div>
      </motion.article>
    </motion.div>
  )
}

function buildManagerPerformanceCards(users = [], rows = []) {
  return buildManagerCards(users, rows).map((row) => ({ ...row, tone: getPerformanceTone(row.percent) }))
}

function PerformanceCard({ item, type = 'user', selected = false, onClick }) {
  const isUserPerformance = type === 'user'
  const content = (
    <>
      <div>
        <span>{type === 'manager' ? 'Manager' : 'User'}</span>
        <strong>{item.name}</strong>
        <p>{item.done}/{item.total} {isUserPerformance ? 'annual returns completed' : 'filings completed'}</p>
      </div>
      <div className="operations-performance-meter">
        <b>{item.percent}%</b>
        <i><em style={{ width: `${item.percent}%` }} /></i>
      </div>
      {item.pendingCompliance ? <small>{item.pendingCompliance} waiting compliance approval</small> : <small>{isUserPerformance ? 'Lead to annual return progress' : 'Assigned filing progress'}</small>}
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`operations-performance-card operations-performance-clickable operations-performance-${item.tone} ${selected ? 'operations-performance-selected' : ''}`}
      >
        {content}
      </button>
    )
  }

  return (
    <article className={`operations-performance-card operations-performance-${item.tone}`}>
      {content}
    </article>
  )
}

function buildControlSignals({ analytics, clients = [], quotations = [], pendingClients = [], pendingQuotations = [], activeUsers = 0 }) {
  return [
    {
      label: 'Live client control',
      value: `${analytics.clientCompletion}%`,
      detail: `${analytics.liveClients}/${clients.length} clients live`,
      tone: analytics.clientCompletion >= 70 ? 'good' : analytics.clientCompletion >= 35 ? 'warn' : 'risk'
    },
    {
      label: 'Approval pressure',
      value: analytics.pendingTotal,
      detail: `${pendingClients.length} client and ${pendingQuotations.length} quotation approvals`,
      tone: analytics.pendingTotal ? 'risk' : 'good'
    },
    {
      label: 'Filing closure',
      value: `${analytics.annualCompletion}%`,
      detail: `${analytics.annualFiled} filed, ${analytics.annualDraft} drafts`,
      tone: analytics.annualCompletion >= 75 ? 'good' : analytics.annualDraft ? 'warn' : 'good'
    },
    {
      label: 'Team capacity',
      value: activeUsers,
      detail: `${activeUsers} active operations users`,
      tone: activeUsers ? 'good' : 'warn'
    },
    {
      label: 'Quote movement',
      value: percent(analytics.sentQuotes, quotations.length) + '%',
      detail: `${analytics.sentQuotes} sent or approved`,
      tone: quotations.length && analytics.sentQuotes === 0 ? 'warn' : 'good'
    }
  ]
}

function ActionTile({ title, value, note, icon: Icon, tone, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`operations-action-tile operations-action-${tone}`}>
      <span><Icon className="h-5 w-5" /></span>
      <div>
        <strong>{value}</strong>
        <p>{title}</p>
        <small>{note}</small>
      </div>
      <ArrowUpRight className="operations-action-arrow h-4 w-4" />
    </button>
  )
}

function OperationsScore({ score, pendingTotal }) {
  return (
    <div className="operations-score-card">
      <div className="operations-score-ring" style={{ '--score': `${score}%` }}>
        <span>{score}</span>
      </div>
      <div>
        <p>Operations Score</p>
        <strong>{score >= 80 ? 'Strong control' : score >= 55 ? 'Needs focus' : 'Needs attention'}</strong>
        <small>{pendingTotal ? `${pendingTotal} approval items need action` : 'Approval queue is clear'}</small>
      </div>
      <Target className="h-5 w-5" />
    </div>
  )
}

function OperationsMetric({ metric }) {
  const Icon = metric.icon
  return (
    <article className={`operations-metric operations-metric-${metric.tone}`}>
      <span><Icon className="h-5 w-5" /></span>
      <div>
        <p>{metric.label}</p>
        <strong>{metric.value}</strong>
        <small>{metric.note}</small>
      </div>
    </article>
  )
}

function PanelHeader({ icon: Icon, title, note }) {
  return (
    <div className="operations-panel-head">
      <div>
        <span><Icon className="h-4 w-4" /></span>
        <strong>{title}</strong>
      </div>
      <p>{note}</p>
    </div>
  )
}

function OperationsCommandOverview({ rows = [], followUps = [], onCalendar }) {
  const today = dateKey()
  const isOpen = (item) => !['completed', 'done', 'closed'].includes(normalizeKey(item.status))
  const activeTasks = followUps.filter(isOpen).length
  const dueToday = followUps.filter((item) => isOpen(item) && item.scheduledDate === today).length
  const overdueTasks = followUps.filter((item) => isOpen(item) && item.scheduledDate && item.scheduledDate < today).length
  const pipeline = [
    ['Onboarding', rows.length, 'mint'],
    ['Documentation', rows.filter((row) => row.hasQuotation).length, 'blue'],
    ['Compliance Review', rows.filter((row) => row.hasPo).length, 'violet'],
    ['Filing', rows.filter((row) => row.annualTotal > 0).length, 'orange'],
    ['Completed', rows.filter((row) => row.annualTotal > 0 && row.annualDone >= row.annualTotal).length, 'green']
  ]
  const onTrack = rows.filter((row) => !row.compliancePending && row.hasPo).length
  const breached = rows.filter((row) => row.compliancePending).length
  const risk = Math.max(0, rows.length - onTrack - breached)
  const slaPercent = percent(onTrack, rows.length)
  const teamMap = new Map()
  rows.forEach((row) => {
    const name = row.userName || 'Unassigned'
    const item = teamMap.get(name) || { name, total: 0, done: 0, due: 0, overdue: 0 }
    item.total += 1
    item.done += row.annualTotal > 0 && row.annualDone >= row.annualTotal ? 1 : 0
    item.due += !row.hasPo ? 1 : 0
    item.overdue += row.compliancePending ? 1 : 0
    teamMap.set(name, item)
  })
  const teams = [...teamMap.values()].sort((a, b) => b.total - a.total).slice(0, 5)
  const maxTeam = Math.max(1, ...teams.map((team) => team.total))
  const queue = followUps.filter(isOpen).sort((a, b) => `${a.scheduledDate || '9999'} ${a.scheduledTime || ''}`.localeCompare(`${b.scheduledDate || '9999'} ${b.scheduledTime || ''}`)).slice(0, 5)
  const kpis = [
    ['Active Clients', rows.length, 'Live operational portfolio', Users, 'green'],
    ['Open Tasks', activeTasks, `${followUps.length} total follow-ups`, ClipboardCheck, 'blue'],
    ['Due Today', dueToday, `${queue.length} in priority queue`, CalendarDays, 'orange'],
    ['At Risk', rows.filter((row) => row.compliancePending || !row.hasPo).length + overdueTasks, `${overdueTasks} overdue tasks`, ShieldAlert, 'red']
  ]
  return <div className="ops-command">
    <div className="ops-command-kpis">{kpis.map(([label, value, note, Icon, tone], index) => <article key={label} className={`ops-command-kpi is-${tone}`}><span className="ops-command-kpi-icon"><Icon /></span><div><small>{label}</small><strong>{value.toLocaleString('en-IN')}</strong><em>{note}</em></div><svg viewBox="0 0 90 36"><polyline points={index % 2 ? '2,15 12,25 22,9 33,29 44,17 55,22 66,7 77,18 88,10' : '2,29 12,20 22,24 33,8 44,18 55,13 66,22 77,7 88,4'} /></svg></article>)}</div>
    <div className="ops-command-primary">
      <section className="ops-command-card ops-pipeline-card"><header><div><strong>Operations Pipeline</strong><span>Live client movement across delivery stages</span></div><b>{percent(pipeline[4][1], pipeline[0][1])}% conversion</b></header><div className="ops-pipeline">{pipeline.map(([label, value, tone]) => <div key={label} className={`ops-pipeline-stage is-${tone}`}><span>{label}</span><strong>{value}</strong><small>{percent(value, rows.length)}%</small></div>)}</div><div className="ops-pipeline-progress"><i style={{ width: `${percent(pipeline[4][1], pipeline[0][1])}%` }} /></div></section>
      <section className="ops-command-card ops-sla-card"><header><div><strong>SLA Health</strong><span>Compliance and PO readiness</span></div></header><div className="ops-sla-body"><div className="ops-sla-ring" style={{ '--sla': `${slaPercent * 3.6}deg` }}><strong>{slaPercent}%</strong><span>On Track</span></div><div className="ops-sla-legend"><p><i className="green" />On Track <b>{onTrack}</b></p><p><i className="orange" />At Risk <b>{risk}</b></p><p><i className="red" />Breached <b>{breached}</b></p></div></div></section>
    </div>
    <div className="ops-command-secondary">
      <section className="ops-command-card ops-workload-card"><header><div><strong>Workload by Team</strong><span>Client distribution and risk</span></div></header><div className="ops-workload-list">{teams.length ? teams.map((team) => <div key={team.name}><label><span>{team.name}</span><b>{team.total}</b></label><div><i className="done" style={{ width: `${team.done/maxTeam*100}%` }} /><i className="active" style={{ width: `${Math.max(0,team.total-team.done-team.due-team.overdue)/maxTeam*100}%` }} /><i className="due" style={{ width: `${team.due/maxTeam*100}%` }} /><i className="late" style={{ width: `${team.overdue/maxTeam*100}%` }} /></div></div>) : <EmptyOperationState label="No team workload found" />}</div></section>
      <section className="ops-command-card ops-queue-card"><header><div><strong>Priority Queue</strong><span>Next operational actions</span></div><button type="button" onClick={onCalendar}>View all</button></header><div className="ops-queue-list">{queue.length ? queue.map((item,index) => <div key={item.id||index}><span><strong>{getCalendarFollowUpCompany(item)}</strong><small>{displayValue(item.title,'Follow-up')}</small></span><em>{getCalendarFollowUpOwner(item)}</em><time>{formatShortDate(item.scheduledDate)}</time><b className={item.scheduledDate<today?'high':item.scheduledDate===today?'medium':'low'}>{item.scheduledDate<today?'High':item.scheduledDate===today?'Due':'Open'}</b></div>) : <EmptyOperationState label="Priority queue is clear" />}</div></section>
      <section className="ops-command-card ops-deadline-card"><header><div><strong>Upcoming Deadlines</strong><span>Calendar-linked schedule</span></div><button type="button" onClick={onCalendar}>Calendar</button></header><div className="ops-deadline-list">{queue.length ? queue.map((item,index) => <div key={item.id||index}><i className={item.scheduledDate<today?'red':index<2?'orange':'blue'} /><time>{formatShortDate(item.scheduledDate)}</time><span><strong>{displayValue(item.title,'Client follow-up')}</strong><small>{getCalendarFollowUpCompany(item)}</small></span></div>) : <EmptyOperationState label="No upcoming deadlines" />}</div></section>
    </div>
  </div>
}

function AdminDashboardSkeleton() {
  return (
    <main className="min-h-screen bg-[#eef7f5] pt-16 text-slate-900">
      <section className="admin-dashboard-skeleton operations-dashboard" aria-label="Loading dashboard">
        <div className="operations-hero admin-skeleton-hero">
          <span className="admin-skeleton-block admin-skeleton-icon" />
          <div className="admin-skeleton-copy">
            <i className="admin-skeleton-line admin-skeleton-line-lg" />
            <i className="admin-skeleton-line admin-skeleton-line-sm" />
          </div>
          <span className="admin-skeleton-block admin-skeleton-button" />
        </div>

        <section className="operations-panel operations-snapshot-panel">
          <div className="admin-skeleton-panel-head">
            <i className="admin-skeleton-block" />
            <div>
              <span className="admin-skeleton-line admin-skeleton-line-md" />
              <span className="admin-skeleton-line admin-skeleton-line-sm" />
            </div>
          </div>
          <div className="operations-snapshot-grid">
            {[0, 1, 2].map((item) => (
              <article key={item} className="operations-kpi-card admin-skeleton-card">
                <i className="admin-skeleton-line admin-skeleton-line-sm" />
                <strong className="admin-skeleton-number" />
                <span className="admin-skeleton-meter" />
              </article>
            ))}
          </div>
        </section>

        <div className="operations-dashboard-row operations-dashboard-row-followup">
          <section className="dashboard-followup-flow admin-skeleton-flow">
            <div className="followup-flow-head">
              <div>
                <span className="admin-skeleton-line admin-skeleton-line-sm" />
                <strong className="admin-skeleton-line admin-skeleton-line-lg" />
              </div>
              <span className="admin-skeleton-block admin-skeleton-button" />
            </div>
            <div className="followup-flow-table admin-skeleton-timeline">
              <div className="followup-flow-month">
                <span className="admin-skeleton-line admin-skeleton-line-xs" />
                <strong className="admin-skeleton-line admin-skeleton-line-md" />
                <span className="admin-skeleton-line admin-skeleton-line-xs" />
              </div>
              <div className="followup-flow-head-row">
                {['wbs', 'task', 'assigned', 'done', 'timeline'].map((item) => <span key={item} className="admin-skeleton-line" />)}
              </div>
              <div className="followup-flow-body">
                {[0, 1, 2, 3].map((item) => (
                  <div key={item} className="admin-skeleton-row">
                    <span />
                    <strong />
                    <em />
                    <i />
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        <section className="operations-panel operations-pibo-chart-panel admin-skeleton-pibo">
          <div className="admin-skeleton-panel-head">
            <i className="admin-skeleton-block" />
            <div>
              <span className="admin-skeleton-line admin-skeleton-line-md" />
              <span className="admin-skeleton-line admin-skeleton-line-sm" />
            </div>
          </div>
          <div className="operations-pibo-chart-layout">
            <div className="operations-pibo-bar-card-modern admin-skeleton-chart-card">
              <div className="operations-pibo-modern-chart">
                {[0, 1, 2, 3, 4, 5].map((item) => <span key={item} style={{ width: `${36 + item * 9}%` }} />)}
              </div>
              <div className="operations-pibo-bar-legend">
                {[0, 1, 2, 3, 4, 5].map((item) => <span key={item} className="admin-skeleton-pill" />)}
              </div>
            </div>
            <div className="operations-lead-chart-card operations-lead-pie-card-featured admin-skeleton-chart-card">
              <div className="admin-skeleton-donut" />
              <div className="admin-skeleton-pill-list">
                <span />
                <span />
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>
  )
}

function WorkflowFunnel({ rows }) {
  return (
    <div className="operations-funnel">
      {rows.map((row) => (
        <div key={row.label} className={`operations-funnel-row operations-funnel-${row.tone}`}>
          <div>
            <strong>{row.label}</strong>
            <span>{row.note}</span>
          </div>
          <div className="operations-funnel-track"><i style={{ width: `${row.percent}%` }} /></div>
          <b>{row.value}</b>
        </div>
      ))}
    </div>
  )
}

function AttentionItem({ item }) {
  return (
    <div className={`operations-attention-item operations-attention-${item.severity}`}>
      <span>{item.severity === 'good' ? <CheckCircle2 className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}</span>
      <div>
        <strong>{item.title}</strong>
        <p>{item.detail}</p>
      </div>
      <b>{item.value}</b>
    </div>
  )
}

function ProgressCard({ label, value, caption }) {
  return (
    <div className="operations-progress-card">
      <div className="operations-progress-ring" style={{ '--value': `${Math.min(100, Math.max(0, value))}%` }}>
        <span>{value}%</span>
      </div>
      <div>
        <strong>{label}</strong>
        <p>{caption}</p>
      </div>
    </div>
  )
}

function DataBar({ label, value, total }) {
  const percent = total ? Math.round((value / total) * 100) : 0
  return (
    <div className="operations-data-bar">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <i><b style={{ width: `${percent}%` }} /></i>
    </div>
  )
}

function QueueCard({ label, value, icon: Icon }) {
  return (
    <div className="operations-queue-card">
      <Icon className="h-5 w-5" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function EmptyOperationState({ label }) {
  return <div className="operations-empty">{label}</div>
}

function OperationsChartStudio({ workflowRows = [], score = 0 }) {
  const workflowPeak = Math.max(...workflowRows.map((row) => row.value), 1)

  return (
    <motion.section
      className="operations-chart-studio"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, delay: 0.08 }}
    >
      <div className="operations-chart-studio-head">
        <div>
          <span>Command Analytics</span>
          <strong>Operations performance map</strong>
        </div>
        <p>{score}% operational readiness</p>
      </div>

      <div className="operations-chart-studio-grid">
        <article className="operations-planner-card">
          <div className="operations-chart-card-head">
            <div><Activity className="h-4 w-4" /><strong>Workflow Timeline</strong></div>
            <span>Live counts</span>
          </div>
          <div className="operations-planner-table">
            <div className="operations-planner-head">
              <span>WBS</span><span>Task</span><span>Done</span><span>Progress</span>
            </div>
            {workflowRows.map((row, index) => (
              <motion.div key={row.label} className="operations-planner-row" initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.32, delay: index * 0.04 }}>
                <span>{index + 1}</span>
                <strong>{row.label}</strong>
                <em>{row.value}</em>
                <div>
                  <i style={{ left: `${Math.min(62, index * 12)}%`, width: `${Math.max(12, (row.value / workflowPeak) * 34)}%` }}>
                    <b className={`operations-planner-tone-${row.tone}`} />
                  </i>
                  <aside className="operations-planner-analysis">
                    <strong>{row.label}</strong>
                    <span>{row.value} records</span>
                    <p>{row.percent}% of current workflow peak</p>
                    <small>{row.note}</small>
                  </aside>
                </div>
              </motion.div>
            ))}
          </div>
        </article>
      </div>
    </motion.section>
  )
}

function getFollowUpAssigneeTokens(item = {}) {
  const assigned = item.assignedTo && typeof item.assignedTo === 'object' ? item.assignedTo : {}
  const createdBy = item.createdBy && typeof item.createdBy === 'object' ? item.createdBy : {}
  return [
    item.assignedToName,
    item.assignedToEmail,
    item.assignedToId,
    item.ownerName,
    item.ownerEmail,
    item.ownerId,
    item.scheduledBy,
    item.createdByName,
    item.createdByEmail,
    item.createdById,
    assigned.name,
    assigned.email,
    assigned._id,
    assigned.id,
    createdBy.name,
    createdBy.email,
    createdBy._id,
    createdBy.id,
    typeof item.assignedTo === 'string' ? item.assignedTo : '',
    typeof item.createdBy === 'string' ? item.createdBy : ''
  ].filter(Boolean).map((value) => normalizeKey(value))
}

function resolveFollowUpAssignee(item = {}, users = []) {
  const assigned = item.assignedTo && typeof item.assignedTo === 'object' ? item.assignedTo : null
  const createdBy = item.createdBy && typeof item.createdBy === 'object' ? item.createdBy : null
  const tokens = getFollowUpAssigneeTokens(item)
  const matchedUser = users.find((user) => getUserMatchKeys(user).some((key) => tokens.includes(key)))
  const source = matchedUser || assigned || createdBy || {}
  const rawName = item.assignedToName || source.name || source.fullName || source.email || (typeof item.assignedTo === 'string' ? item.assignedTo : '') || item.createdByName || (typeof item.createdBy === 'string' ? item.createdBy : '')
  const looksLikeId = /^[a-f0-9]{16,}$/i.test(String(rawName || '').trim())
  return {
    name: looksLikeId ? 'Unassigned' : displayValue(rawName, 'Unassigned'),
    email: source.email || item.assignedToEmail || item.createdByEmail || '',
    avatarUrl: source.avatarUrl || source.avatar || source.profileImage || ''
  }
}

function UserAvatar({ user, className = '' }) {
  const name = displayValue(user?.name || user?.email, 'U')
  const initial = name.charAt(0).toUpperCase()
  return (
    <span className={`followup-flow-avatar ${className}`}>
      {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initial}
    </span>
  )
}

function DashboardFollowUpTimeline({ items = [], users = [], onView, onCalendar }) {
  const todayKey = dateKey()
  const sortedItems = [...items]
    .filter((item) => normalizeKey(item.status) !== 'completed')
    .sort((a, b) => `${a.scheduledDate || ''} ${a.scheduledTime || ''}`.localeCompare(`${b.scheduledDate || ''} ${b.scheduledTime || ''}`))
    .slice(0, 4)
  const dateKeys = [todayKey, ...sortedItems.map((item) => item.scheduledDate).filter(Boolean)].sort()
  const startKey = dateKeys[0] || todayKey
  const endKey = dateKeys[dateKeys.length - 1] || todayKey
  const totalDays = Math.max(8, diffDays(startKey, endKey) + 4)
  const timelineDays = Array.from({ length: Math.min(10, totalDays + 1) }, (_, index) => {
    const date = parseDateKey(startKey) || new Date()
    date.setDate(date.getDate() + index)
    return dateKey(date)
  })
  const todayOffset = Math.max(0, Math.min(100, (diffDays(startKey, todayKey) / Math.max(1, timelineDays.length - 1)) * 100))
  const dayLabel = (value) => {
    const date = parseDateKey(value)
    if (!date) return { date: 'N/A', day: '' }
    return {
      date: new Intl.DateTimeFormat('en', { month: 'short', day: '2-digit' }).format(date),
      day: new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date)
    }
  }

  return (
    <motion.section className="followup-flow-board dashboard-followup-flow" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.36, delay: 0.1 }}>
      <div className="followup-flow-head">
        <div>
          <span>Follow-Up Flow</span>
          <strong>Scheduled follow-up timeline</strong>
        </div>
        <div className="followup-flow-actions">
          <p>{items.length} active follow-ups</p>
          <button type="button" onClick={onCalendar}>Calendar</button>
        </div>
      </div>
      <div className="followup-flow-table">
        <div className="followup-flow-month">
          <span>{formatShortDate(startKey)} - {formatShortDate(endKey)}</span>
          <strong>Follow-Up Window</strong>
        </div>
        <div className="followup-flow-head-row">
          <span>WBS</span>
          <span>Task</span>
          <span>Assigned</span>
          <span>Priority</span>
          <span>Status</span>
          <span>Timeline</span>
        </div>
        <div className="followup-flow-date-row">
          {timelineDays.map((value) => {
            const label = dayLabel(value)
            return (
              <span key={value} className={value === todayKey ? 'followup-flow-date-today' : ''}>
                <b>{label.date}</b>
                <small>{label.day}</small>
              </span>
            )
          })}
        </div>
        <div className="followup-flow-body">
          <i className="followup-flow-today" style={{ left: `${todayOffset}%`, '--today-left': `calc(${todayOffset}% + ${626 * (1 - todayOffset / 100)}px)` }}><b>Today</b></i>
          {sortedItems.length ? sortedItems.map((item, index) => {
            const tone = getFollowUpTone(item, todayKey)
            const offset = Math.max(0, Math.min(82, (diffDays(startKey, item.scheduledDate) / Math.max(1, timelineDays.length - 1)) * 100))
            const width = normalizeKey(item.status) === 'completed' ? 18 : tone === 'overdue' ? 18 : 28 + (index % 2) * 8
            const assignee = resolveFollowUpAssignee(item, users)
            const title = displayValue(item.title, `Follow up with ${getCalendarFollowUpCompany(item)}`)
            const priority = displayValue(item.priority, tone === 'overdue' ? 'High' : 'Medium')
            const status = displayValue(getFollowUpStatusLabel(item, todayKey), 'Open')
            return (
              <motion.div
                key={item.id || item._id || `${title}-${index}`}
                className={`followup-flow-row followup-flow-row-${tone}`}
                initial={{ opacity: 0, x: -14 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.26, delay: index * 0.035 }}
              >
                <span>{`OPS-${String(index + 1).padStart(2, '0')}`}</span>
                <strong>{title}</strong>
                <div className="followup-flow-assignee">
                  <UserAvatar user={assignee} />
                  <em>{assignee.name}</em>
                </div>
                <mark className={`followup-flow-priority followup-flow-priority-${normalizeKey(priority)}`}>{priority}</mark>
                <mark className={`followup-flow-status followup-flow-status-${tone}`}>{status}</mark>
                <div className="followup-flow-track">
                  <i style={{ left: `${offset}%`, width: `${width}%` }}>
                    <b>{status}</b>
                  </i>
                  <aside className="followup-flow-analysis">
                    <strong>{title}</strong>
                    <span>{formatShortDate(item.scheduledDate)} {item.scheduledTime || 'All day'}</span>
                    <p>Status: {getFollowUpStatusLabel(item, todayKey)}</p>
                    <small>{item.description || getCalendarFollowUpCompany(item) || 'Pending follow-up action'}</small>
                  </aside>
                </div>
              </motion.div>
            )
          }) : <div className="followup-flow-empty">No follow-ups found. Add a Follow-Up to see the flow.</div>}
        </div>
      </div>
      <button type="button" className="sales-donut-link" onClick={onView}>View All Follow-ups <ArrowUpRight className="h-3.5 w-3.5" /></button>
    </motion.section>
  )
}

function OperationsLeadAnalytics({ analytics, piboCards = [], convertedLeadCount = 0, annualReturnStats = {}, followUps = [], onViewFollowUps, onOpenCalendar }) {
  const [hoveredLeadRow, setHoveredLeadRow] = useState(null)
  const piboTotal = piboCards.reduce((sum, row) => sum + row.value, 0)
  const barRows = piboCards.length
    ? piboCards.map((row, index) => ({
      id: row.label,
      name: row.label,
      value: row.value,
      percent: percent(row.value, piboTotal),
      fill: ['#0f9f83', '#2563eb', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#64748b', '#84cc16', '#f97316'][index % 9]
    }))
    : [{ id: 'empty', name: 'No PIBO data', value: 0, percent: 0, fill: '#cbd5e1' }]
  const totalLeads = analytics.leads.length
  const remainingLeads = Math.max(0, totalLeads - convertedLeadCount)
  const leadPieRows = totalLeads
    ? [
      { label: 'Converted Lead', value: convertedLeadCount, percent: percent(convertedLeadCount, totalLeads), color: '#0f9f83' },
      { label: 'Remaining Lead', value: remainingLeads, percent: percent(remainingLeads, totalLeads), color: '#facc15' }
    ]
    : [{ label: 'No Leads', value: 1, color: '#e2e8f0' }]
  const leadLegendRows = totalLeads ? [leadPieRows[1], leadPieRows[0]] : leadPieRows
  const activeLeadRow = hoveredLeadRow || { label: 'Total Leads', value: totalLeads, percent: 100, color: '#0f9f83' }
  return (
    <div className="operations-analytics-stack">
      <section className="operations-panel operations-pibo-chart-panel">
        <PanelHeader icon={PieChart} title="PIBO Category" note="Category wise current table count" />
        <div className="operations-pibo-chart-layout">
          <div className="operations-pibo-bar-card operations-pibo-bar-card-modern">
            <div className="operations-pibo-bar-card-head">
              <div>
                <strong>PIBO Category Split</strong>
                <p>Animated category wise client distribution</p>
              </div>
              <span>{piboTotal} clients</span>
            </div>
            <div className="operations-pibo-modern-chart">
              <ResponsiveContainer width="100%" height={Math.max(300, barRows.length * 23)}>
                <BarChart data={barRows} layout="vertical" margin={{ top: 6, right: 44, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="4 6" horizontal={false} stroke="#d8ebe7" />
                  <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={{ stroke: '#dbe7e5' }} tick={{ fill: '#64748b', fontSize: 11, fontWeight: 900 }} />
                  <YAxis dataKey="name" type="category" width={190} tickLine={false} axisLine={false} tick={{ fill: '#26384d', fontSize: 9, fontWeight: 900 }} />
                  <Bar dataKey="value" radius={[0, 12, 12, 0]} barSize={15} animationDuration={1100} animationEasing="ease-out" label={{ position: 'right', fill: '#0f172a', fontSize: 12, fontWeight: 950 }}>
                    {barRows.map((row) => (
                      <Cell
                        key={row.id}
                        fill={row.fill}
                        className="operations-pibo-bar-segment"
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="operations-pibo-bar-legend">
              {barRows.map((row) => (
                <span
                  key={row.id}
                  title={`${row.name}: ${row.value} clients (${row.percent}%)`}
                ><i style={{ background: row.fill }} />{row.name}: {row.value}<small>{row.percent}%</small></span>
              ))}
            </div>
          </div>

          <article className="operations-lead-chart-card operations-lead-pie-card operations-lead-pie-card-featured">
            <div className="operations-lead-chart-head">
              <div>
                <strong>Lead Conversion Pie</strong>
                <p>Total leads and converted leads in Client Master</p>
              </div>
              <span>{convertedLeadCount} converted</span>
            </div>
            <div className="operations-lead-pie-wrap">
              <div className="operations-lead-pie">
                <ResponsiveContainer width="100%" height={230}>
                  <RechartsPieChart>
                    <Pie
                      data={leadPieRows}
                      dataKey="value"
                      nameKey="label"
                      innerRadius={54}
                      outerRadius={88}
                      paddingAngle={totalLeads ? 3 : 0}
                      stroke="none"
                      animationDuration={1100}
                      animationEasing="ease-out"
                    >
                      {leadPieRows.map((row) => (
                        <Cell
                          key={row.label}
                          fill={row.color}
                          className={`operations-lead-pie-segment ${hoveredLeadRow?.label === row.label ? 'is-active' : ''} ${hoveredLeadRow && hoveredLeadRow.label !== row.label ? 'is-dim' : ''}`}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      cursor={false}
                      contentStyle={{ border: '1px solid #bfdbfe', borderRadius: 12, boxShadow: '0 18px 36px rgba(15, 23, 42, 0.16)', fontWeight: 900 }}
                      formatter={(value, name, item) => [`${value} leads (${item?.payload?.percent || 0}%)`, item?.payload?.label || name]}
                    />
                  </RechartsPieChart>
                </ResponsiveContainer>
                <div className="operations-lead-pie-center">
                  <small>{activeLeadRow.label}</small>
                  <strong>{activeLeadRow.value}</strong>
                  <span>{activeLeadRow.percent}%</span>
                </div>
                </div>
                <div className="operations-lead-legend">
                {leadLegendRows.map((row) => (
                  <div
                    key={row.label}
                    className={`${hoveredLeadRow?.label === row.label ? 'active' : ''} ${hoveredLeadRow && hoveredLeadRow.label !== row.label ? 'analysis-light' : ''}`}
                    title={`${row.label}: ${row.value} (${row.percent || 0}%)`}
                    onMouseEnter={() => setHoveredLeadRow(row)}
                    onMouseLeave={() => setHoveredLeadRow(null)}
                  >
                    <span style={{ background: row.color }} />
                    <p>{row.label}</p>
                    <strong>{row.value}</strong>
                    <small>{row.percent || 0}%</small>
                  </div>
                ))}
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>
  )
}

function OperationsAnnualReturnProgress({ annualReturnStats = {} }) {
  const [hoveredAnnualRow, setHoveredAnnualRow] = useState(null)
  const annualTotal = annualReturnStats.total || 0
  const annualCompleted = annualReturnStats.completed || 0
  const annualPending = annualReturnStats.pending || 0
  const annualRejected = annualReturnStats.rejected || annualReturnStats.overdue || 0
  const annualPercent = percent(annualCompleted, annualTotal)
  const annualRows = [
    { label: 'Completed', value: annualCompleted, percent: percent(annualCompleted, annualTotal), color: '#0f9f83' },
    { label: 'Pending', value: annualPending, percent: percent(annualPending, annualTotal), color: '#facc15' },
    { label: 'Rejected', value: annualRejected, percent: percent(annualRejected, annualTotal), color: '#ef4444' }
  ]
  const annualPieRows = annualTotal
    ? annualRows.filter((row) => row.value > 0)
    : [{ label: 'No Annual Returns', value: 1, percent: 0, color: '#e2e8f0' }]
  const activeAnnualRow = hoveredAnnualRow || { label: 'Completed', percent: annualPercent, color: '#0f9f83' }

  return (
    <article className="operations-lead-chart-card operations-annual-return-card">
      <div className="operations-lead-chart-head">
        <div>
          <strong>Annual Return Progress</strong>
          <p>Completed, pending and rejected annual return work</p>
        </div>
        <span>{annualTotal} total</span>
      </div>
      <div className="operations-annual-return-body">
        <div className="operations-annual-donut">
          <ResponsiveContainer width="100%" height={210}>
            <RechartsPieChart>
              <Pie
                data={annualPieRows}
                dataKey="value"
                nameKey="label"
                innerRadius={60}
                outerRadius={86}
                startAngle={180}
                endAngle={0}
                paddingAngle={annualTotal && annualPieRows.length > 1 ? 4 : 0}
                minAngle={annualTotal ? 8 : 0}
                cornerRadius={10}
                stroke="#ffffff"
                strokeWidth={annualTotal ? 4 : 0}
                animationDuration={900}
              >
                {annualPieRows.map((row) => <Cell key={row.label} fill={hoveredAnnualRow ? activeAnnualRow.color : row.color} className="operations-annual-gauge-segment" />)}
              </Pie>
            </RechartsPieChart>
          </ResponsiveContainer>
          <div className="operations-lead-pie-center">
            <strong>{activeAnnualRow.percent}%</strong>
            <span>{activeAnnualRow.label}</span>
          </div>
        </div>
        <div className="operations-annual-legend">
          {annualRows.map((row) => (
            <div
              key={row.label}
              className={hoveredAnnualRow?.label === row.label ? 'active' : ''}
              data-percent={`${row.percent}%`}
              aria-label={`${row.label}: ${row.value} (${row.percent}%)`}
              onMouseEnter={() => setHoveredAnnualRow(row)}
              onMouseLeave={() => setHoveredAnnualRow(null)}
              onFocus={() => setHoveredAnnualRow(row)}
              onBlur={() => setHoveredAnnualRow(null)}
              tabIndex={0}
            >
              <span style={{ background: row.color }} />
              <p>{row.label}</p>
              <strong>{row.value}</strong>
              <small>({row.percent}%)</small>
            </div>
          ))}
        </div>
      </div>
    </article>
  )
}

function ControlSignal({ signal }) {
  return (
    <div className={`operations-control-signal operations-control-${signal.tone}`}>
      <span>{signal.label}</span>
      <strong>{signal.value}</strong>
      <small>{signal.detail}</small>
    </div>
  )
}

function CommandStat({ label, value, note, icon: Icon }) {
  return (
    <div className="operations-command-stat">
      <Icon className="h-4 w-4" />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </div>
  )
}

function formatDashboardInr(value) {
  return (Number(value) || 0).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function getQuotationTotal(quotation = {}) {
  return (quotation.items || []).reduce((sum, item) => sum + (Number(item.basicAmount) || 0), 0)
}

function getMeaningfulQuotationItems(items = []) {
  return items.filter((item) => {
    return [
      item.serviceCategory,
      item.servicesForYear,
      item.eprCategory,
      item.piboCategory,
      item.unit,
      item.basicAmount
    ].some((value) => String(value || '').trim() && String(value || '').trim() !== '-')
  })
}

function getLatestQuotationItem(items = []) {
  const meaningfulItems = getMeaningfulQuotationItems(items)
  return meaningfulItems[meaningfulItems.length - 1] || items[items.length - 1] || {}
}

function QuotationDetailsModal({ row, onClose }) {
  const quotations = Array.isArray(row?.quotations) ? row.quotations : []
  const quotation = quotations[0] || {}
  const details = quotation.leadDetails || {}
  const items = Array.isArray(quotation.items) ? quotation.items : []
  const latestItem = getLatestQuotationItem(items)
  const meaningfulItems = getMeaningfulQuotationItems(items)
  const totalAmount = Number(latestItem.basicAmount) || getQuotationTotal(quotation)
  const revisionCount = Math.max(quotations.length, meaningfulItems.length || items.length)
  const resolvedOwner = getQuotationOwnerName(quotation)
  const userName = resolvedOwner !== 'Unassigned' ? resolvedOwner : (row?.userName || '-')

  return (
    <PremiumQuotationModal
      open
      onClose={onClose}
      companyName={details.companyName || row?.companyName || 'Quotation Details'}
      quotationNumber={quotation.quotationNumber || quotation.quotationNo || 'Quotation'}
      totalAmount={totalAmount}
      revisionCount={revisionCount}
      userName={userName}
      piboCategory={latestItem.piboCategory || row?.category || '-'}
      businessCategory={latestItem.businessCategory || '-'}
      serviceCategory={latestItem.serviceCategory || '-'}
      items={items}
    />
  )
}

function AnimatedInrAmount({ value }) {
  const animatedValue = useCountUpNumber(Number(value) || 0)
  return <span className="count-up-number">{formatDashboardInr(animatedValue)}</span>
}

function PoDetailsModal({ row, onClose }) {
  const po = row?.poDetails || {}
  const fileHref = po.fileUrl || ''
  const hasPo = Boolean(po.hasPo)

  return (
    <div className="operations-modal-backdrop" role="presentation" onClick={onClose}>
      <div className="operations-po-modal operations-po-modal-v2" role="dialog" aria-modal="true" aria-label="Compliance PO Details" onClick={(event) => event.stopPropagation()}>
        <div className="operations-po-modal-head operations-po-modal-head-v2">
          <div>
            <span>PO Status</span>
            <h3>{row?.companyName || 'Compliance PO Details'}</h3>
            <p>{row?.atplCode || '-'} - {po.source || 'No PO source found'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close Compliance PO Details">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className={`operations-po-status-hero ${hasPo ? 'operations-po-status-hero-yes' : 'operations-po-status-hero-no'}`}>
          <span><FileCheck2 className="h-5 w-5" /></span>
          <div>
            <small>Current PO Decision</small>
            <strong>{hasPo ? 'PO available' : 'PO not available'}</strong>
          </div>
          <em>{hasPo ? 'Yes' : 'No'}</em>
        </div>

        <div className="operations-po-detail-grid operations-po-detail-grid-v2">
          <div className="operations-po-detail-row operations-po-detail-row-v2">
            <span><FileText className="h-4 w-4" /></span>
            <div>
              <small>Compliance PO No.</small>
              <strong>{po.poNo || '-'}</strong>
            </div>
          </div>
          <div className="operations-po-detail-row operations-po-detail-row-v2">
            <span><CalendarDays className="h-4 w-4" /></span>
            <div>
              <small>Compliance PO Date</small>
              <strong>{po.poDate ? formatPoDate(po.poDate) : 'dd-mm-yyyy'}</strong>
            </div>
          </div>
          <div className="operations-po-detail-row operations-po-detail-row-v2 operations-po-detail-row-wide">
            <span><FolderOpen className="h-4 w-4" /></span>
            <div>
              <small>Upload Compliance PO</small>
              {fileHref ? (
                <a href={fileHref} target="_blank" rel="noreferrer">{po.fileName || 'View uploaded file / folder'}</a>
              ) : (
                <strong>No file uploaded</strong>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function financialYearStart(value) {
  const match = String(value || '').match(/(20\d{2})/)
  return match ? Number(match[1]) : 0
}

function currentFinancialYear() {
  const today = new Date()
  const start = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1
  return `${start}-${String(start + 1).slice(-2)}`
}

function rowAppliesToFinancialYear(row, financialYear) {
  const selectedStart = financialYearStart(financialYear)
  const poYear = getPoFinancialYear(row)
  if (poYear) return financialYearStart(poYear) === selectedStart
  const firstStart = financialYearStart(row.firstAnnualReturnYear)
  const explicitYears = (row.annualReturns || []).flatMap((item) => [item.annualYear, item.financialYear, item.year]).filter(Boolean)
  if (explicitYears.some((year) => financialYearStart(year) === selectedStart)) return true
  if (firstStart) return selectedStart >= firstStart
  return !row.annualYear || financialYearStart(row.annualYear) === selectedStart
}

const PO_APPLICANT_BUCKETS = ['Producer', 'Importer', 'Brand Owner', 'Recycler', 'SIMP', 'PWP', 'Other']

function getPoWasteCategory(row = {}) {
  const value = normalizeKey(row.eprCategory).replace(/[_-]+/g, ' ')
  if (value.includes('plastic')) return 'Plastic'
  if (value.includes('battery')) return 'Battery Waste'
  if (value.includes('e waste') || value.includes('electronic')) return 'E-Waste'
  return 'Other EPR'
}

function getPoApplicantBucket(row = {}) {
  const value = normalizeKey(`${row.subApplicantType || ''} ${row.category || ''}`).replace(/[_-]+/g, ' ')
  if (value.includes('brand owner')) return 'Brand Owner'
  if (value.includes('recycler')) return 'Recycler'
  if (value.includes('producer')) return 'Producer'
  if (value.includes('importer')) return 'Importer'
  if (value.includes('simp') || value.includes('seller')) return 'SIMP'
  if (value.includes('pwp') || value.includes('refurbisher') || value.includes('retreader')) return 'PWP'
  return 'Other'
}

const COMPLIANCE_WASTE_TYPES = ['Plastic Waste', 'Battery Waste', 'E-Waste', 'Used Oil', 'Other Waste']
const COMPLIANCE_DEFAULT_APPLICANTS = ['Producer', 'Importer', 'Brand Owner', 'Recycler', 'SIMP', 'PWP']

function complianceText(...values) {
  return values.flat(Infinity).map((value) => {
    if (value && typeof value === 'object') return value.name || value.label || value.value || ''
    return String(value || '')
  }).join(' ').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function getComplianceWasteType(source = {}) {
  const value = complianceText(source.eprCategory, source.serviceCategory, source.wasteCategory, source.categoryName)
  if (value.includes('plastic')) return 'Plastic Waste'
  if (value.includes('battery')) return 'Battery Waste'
  if (value.includes('e waste') || value.includes('electronic')) return 'E-Waste'
  if (value.includes('used oil') || value.includes('waste oil')) return 'Used Oil'
  return 'Other Waste'
}

function formatComplianceApplicant(value = '') {
  const clean = String(value || '').trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  if (!clean) return 'Other'
  const upper = clean.toUpperCase()
  if (['PIBO', 'SIMP', 'PWP'].includes(upper)) return upper
  if (upper === 'BRANDOWNER' || upper === 'BRAND OWNER') return 'Brand Owner'
  return clean.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function getComplianceApplicantGroup(source = {}, wasteType = getComplianceWasteType(source)) {
  // Plastic registrations use the sub-applicant type. Other EPR streams use
  // their direct applicant/application type, as used by the source portal.
  const applicantType = wasteType === 'Plastic Waste'
    ? complianceText(source.subApplicantType, source.piboCategory)
    : complianceText(source.applicantType, source.applicationType, source.category, source.piboParent)
  return formatComplianceApplicant(applicantType)
}

function getComplianceServiceKinds(source = {}, fallbackKind = '') {
  const value = complianceText(
    source.servicesOffered,
    source.serviceOffered,
    source.applicableService,
    source.service,
    source.serviceName,
    source.scope
  )
  const compactValue = value.replace(/\s+/g, '')
  const kinds = []
  if (value.includes('annual return') || value.includes('annual filing') || compactValue.includes('annualreturn')) kinds.push('annual')
  if (value.includes('registration')) kinds.push('registration')
  if (!kinds.length && fallbackKind) kinds.push(fallbackKind)
  return kinds
}

function getComplianceRecordYears(source = {}) {
  if (source.poFinancialYear) return [source.poFinancialYear]
  return [
    source.annualYear,
    source.financialYear,
    source.year,
    source.servicesForYear,
    source.registrationYear,
    ...(Array.isArray(source.annualReturnYears) ? source.annualReturnYears : []),
    ...(Array.isArray(source.financialYears) ? source.financialYears : [])
  ].filter(Boolean)
}

function complianceRecordAppliesToYear(record, financialYear) {
  if (record.source.poFinancialYear) return financialYearStart(record.source.poFinancialYear) === financialYearStart(financialYear)
  if (record.source.clientMasterService && record.kind === 'registration') return true
  const selectedStart = financialYearStart(financialYear)
  const firstStart = financialYearStart(record.source.firstAnnualReturnYearApplicable || record.source.firstAnnualReturnYear)
  if (record.source.clientMasterService && record.kind === 'annual' && firstStart) return selectedStart >= firstStart
  const exactYears = getComplianceRecordYears(record.source)
  if (exactYears.length) return exactYears.some((year) => financialYearStart(year) === selectedStart)
  if (record.kind === 'annual' && firstStart) return selectedStart >= firstStart
  return true
}

function buildComplianceKpi(clientRows = [], financialYear = currentFinancialYear(), poYearMode = false) {
  const records = []
  const diagnostics = []
  const addRecord = (source, owner, kind, sourceId) => {
    const waste = getComplianceWasteType(source)
    const applicant = getComplianceApplicantGroup(source, waste)
    const record = { source, owner, kind, waste, applicant, sourceId }
    if (!poYearMode && !complianceRecordAppliesToYear(record, financialYear)) return false
    records.push(record)
    return true
  }

  clientRows.forEach((row, rowIndex) => {
    const client = row.client || {}
    const clientData = readClientData(client)
    const snapshot = clientData.selectedLeadSnapshot || {}
    const linkedLead = client.selectedLead && typeof client.selectedLead === 'object' ? client.selectedLead : {}
    const assignedServiceId = String(client.assignedServiceId || clientData.assignedServiceId || snapshot.assignedServiceId || '').trim()
    const linkedServices = Array.isArray(linkedLead.serviceSelections) ? linkedLead.serviceSelections : []
    const linkedService = linkedServices.find((service) => String(
      service?.assignedServiceId || service?._id || service?.id || ''
    ).trim() === assignedServiceId) || (linkedServices.length === 1 ? linkedServices[0] : {})
    const clientRecordId = row.id || row.clientKey || rowIndex
    const common = {
      poFinancialYear: getPoFinancialYear(row),
      eprCategory: clientData.basic?.eprCategory || snapshot.eprCategory || snapshot.serviceCategory || client.eprCategory || client.serviceCategory || linkedService.eprCategory || linkedService.serviceCategory || row.eprCategory,
      applicantType: clientData.basic?.applicantType || snapshot.applicantType || snapshot.piboParent || client.applicantType || client.piboParent || linkedService.applicantType || linkedService.piboParent || row.category,
      subApplicantType: clientData.basic?.subApplicantType || clientData.basic?.piboCategory || snapshot.subApplicantType || snapshot.piboCategory || client.subApplicantType || client.piboCategory || linkedService.subApplicantType || linkedService.piboCategory || row.subApplicantType,
      firstAnnualReturnYear: clientData.basic?.firstAnnualReturnYear || clientData.firstAnnualReturnYearApplicable || snapshot.firstAnnualReturnYearApplicable || client.firstAnnualReturnYear || linkedService.firstAnnualReturnYearApplicable || row.firstAnnualReturnYear
    }
    ;(row.annualReturns || []).forEach((filing, filingIndex) => {
      const filingData = filing.data && typeof filing.data === 'object' ? filing.data : {}
      const filingSource = {
        ...common,
        ...filing,
        eprCategory: filing.eprCategory || filingData.basic?.eprCategory || common.eprCategory,
        applicantType: filing.applicantType || filingData.basic?.applicantType || common.applicantType,
        subApplicantType: filing.subApplicantType || filing.piboCategory || filingData.basic?.piboCategory || common.subApplicantType
      }
      const counted = addRecord(
        filingSource,
        clientRecordId,
        'annual',
        filing._id || filing.annualReturnId || `${row.id || rowIndex}:annual:${filingIndex}`
      )
      diagnostics.push({
        clientMasterId: String(clientRecordId),
        source: 'Saved Annual Return form',
        service: 'Annual Return',
        waste: getComplianceWasteType(filingSource),
        applicant: getComplianceApplicantGroup(filingSource, getComplianceWasteType(filingSource)),
        result: counted ? 'COUNTED' : `SKIPPED: outside ${financialYear}`
      })
    })

    const clientServiceSource = {
      ...common,
      clientMasterService: true,
      servicesOffered: clientData.basic?.servicesOffered || snapshot.servicesOffered || client.servicesOffered || linkedService.servicesOffered,
      applicableService: clientData.basic?.applicableService || snapshot.applicableService || client.applicableService || linkedService.applicableService,
      service: snapshot.service || snapshot.serviceName || client.service || client.serviceName || linkedService.service || linkedService.serviceName,
      servicesForYear: clientData.basic?.servicesForYear || snapshot.servicesForYear || snapshot.financialYear || client.servicesForYear || client.financialYear || linkedService.servicesForYear || linkedService.financialYear,
      registrationYear: clientData.basic?.registrationYear || snapshot.registrationYear || client.registrationYear
    }
    // Both service totals come only from converted Client Master records. An
    // actual saved Annual Return form is also included above and deduplicated.
    const clientKinds = getComplianceServiceKinds(clientServiceSource)
    const clientResults = clientKinds.map((kind) => ({
      kind,
      counted: addRecord(clientServiceSource, clientRecordId, kind, `${clientRecordId}:client-${kind}`)
    }))
    diagnostics.push({
      clientMasterId: String(clientRecordId),
      source: 'Client Master snapshot',
      service: complianceText(clientServiceSource.servicesOffered, clientServiceSource.applicableService, clientServiceSource.service) || '(empty)',
      waste: getComplianceWasteType(clientServiceSource),
      applicant: getComplianceApplicantGroup(clientServiceSource, getComplianceWasteType(clientServiceSource)),
      result: !clientKinds.length
        ? 'SKIPPED: service is not Annual Return or Registration'
        : clientResults.map(({ kind, counted }) => `${kind}: ${counted ? 'COUNTED' : `outside ${financialYear}`}`).join(', ')
    })
    ;(Array.isArray(client.services) ? client.services : []).forEach((service, serviceIndex) => {
      const serviceSource = { ...common, ...service, clientMasterService: true }
      const serviceKinds = getComplianceServiceKinds(serviceSource)
      const serviceResults = serviceKinds.map((kind) => ({
        kind,
        counted: addRecord(serviceSource, clientRecordId, kind, `${clientRecordId}:service-${service.assignedServiceId || serviceIndex}-${kind}`)
      }))
      diagnostics.push({
        clientMasterId: String(clientRecordId),
        source: `Client Master services[${serviceIndex}]`,
        service: complianceText(serviceSource.servicesOffered, serviceSource.applicableService, serviceSource.service, serviceSource.serviceName) || '(empty)',
        waste: getComplianceWasteType(serviceSource),
        applicant: getComplianceApplicantGroup(serviceSource, getComplianceWasteType(serviceSource)),
        result: !serviceKinds.length
          ? 'SKIPPED: service is not Annual Return or Registration'
          : serviceResults.map(({ kind, counted }) => `${kind}: ${counted ? 'COUNTED' : `outside ${financialYear}`}`).join(', ')
      })
    })
  })

  const uniqueRecords = new Map()
  records.forEach((record) => {
    const owner = normalizeBusinessKey(record.owner) || normalizeKey(record.sourceId)
    const year = getComplianceRecordYears(record.source).map(financialYearStart).find(Boolean) || financialYearStart(financialYear)
    const key = [record.kind, owner, record.waste, record.applicant, year].join('|')
    if (!uniqueRecords.has(key)) uniqueRecords.set(key, record)
  })

  const applicantLabels = [...new Set([...uniqueRecords.values()].map((record) => record.applicant).filter(Boolean))]
  const visibleApplicantLabels = applicantLabels.length ? applicantLabels : COMPLIANCE_DEFAULT_APPLICANTS
  const applicantOrder = new Map(COMPLIANCE_DEFAULT_APPLICANTS.map((label, index) => [normalizeKey(label), index]))
  visibleApplicantLabels.sort((left, right) => {
    const leftOrder = applicantOrder.get(normalizeKey(left)) ?? 999
    const rightOrder = applicantOrder.get(normalizeKey(right)) ?? 999
    return leftOrder - rightOrder || left.localeCompare(right)
  })
  const applicantIcons = [Building2, BriefcaseBusiness, FileText, RefreshCw]
  const groups = visibleApplicantLabels.map((label, index) => ({
    key: normalizeKey(label).replace(/\s+/g, '-'),
    label,
    note: 'Applicant type',
    icon: applicantIcons[index % applicantIcons.length],
    annual: 0,
    registration: 0,
    waste: COMPLIANCE_WASTE_TYPES.map((name) => ({ name, annual: 0, registration: 0 }))
  }))
  const groupMap = new Map(groups.map((group) => [group.key, group]))
  uniqueRecords.forEach((record) => {
    const group = groupMap.get(normalizeKey(record.applicant).replace(/\s+/g, '-'))
    const waste = group?.waste.find((item) => item.name === record.waste)
    if (!group || !waste) return
    group[record.kind] += 1
    waste[record.kind] += 1
  })
  const result = {
    annual: groups.reduce((sum, group) => sum + group.annual, 0),
    registration: groups.reduce((sum, group) => sum + group.registration, 0),
    groups
  }
  console.groupCollapsed(`[Operations KPI] Client Master classification · ${financialYear}`)
  console.info('[Operations KPI] Fetch-to-KPI summary', {
    clientMasterRowsReceived: clientRows.length,
    candidatesInspected: diagnostics.length,
    recordsBeforeDeduplication: records.length,
    recordsAfterDeduplication: uniqueRecords.size,
    annualReturnTotal: result.annual,
    registrationTotal: result.registration
  })
  if (diagnostics.length) console.table(diagnostics.slice(0, 200))
  if (!clientRows.length) console.error('[Operations KPI] No Client Master rows reached the KPI. Check the [Dashboard API] log and user visibility scope.')
  else if (!uniqueRecords.size) console.warn('[Operations KPI] Client Master rows were fetched, but none had a recognized Annual Return/Registration service for the selected year. See the Result column above.')
  console.info('[Operations KPI] Final applicant groups', groups.map(({ label, annual, registration, waste }) => ({ label, annual, registration, waste })))
  console.groupEnd()
  return result
}

function AnnualRegistrationKpi({ data }) {
  const chartRef = useRef(null)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('Preparing PDF…')
  async function downloadPdf() {
    if (exporting) return
    setExporting(true); setError('')
    try { await downloadOperationsReportPdf(chartRef.current, setProgress, { title: 'Annual Return & Registration', filename: 'Annual-Return-Registration', width: 1800 }) }
    catch (failure) { setError(failure.message || 'PDF download failed. Please retry.') }
    finally { setExporting(false) }
  }
  const groupCount = Math.max(1, data.groups.length)
  const branchEdge = `calc(${50 / groupCount}% - ${(groupCount - 1) * 28 / (2 * groupCount)}px)`
  return <section ref={chartRef} className="compliance-kpi-tree" aria-label="Annual Return and Registration KPI">
    <div className="compliance-kpi-export operations-pdf-hide"><button type="button" className="operations-report-download" disabled={exporting} onClick={downloadPdf}><Download aria-hidden="true" />{exporting ? progress : 'Download PDF'}</button></div>
    {error && <p role="alert" className="operations-export-error operations-pdf-hide">{error}</p>}
    <header className="compliance-kpi-root">
      <span className="compliance-kpi-root-icon"><BarChart3 aria-hidden="true" /></span>
      <div><h2>Annual Return &amp; Registration</h2><p><span>Annual Return: <b>{data.annual.toLocaleString('en-IN')}</b></span><i /><span>Registration: <b>{data.registration.toLocaleString('en-IN')}</b></span></p></div>
    </header>
    <div className="compliance-kpi-branches" style={{ '--applicant-count': groupCount, '--branch-edge': branchEdge }}>
      {data.groups.map((group, index) => {
        const Icon = group.icon
        return <article key={group.key} className={`compliance-kpi-branch compliance-kpi-branch-${(index % 6) + 1}`}>
          <header><span><Icon aria-hidden="true" /></span><div><h3>{group.label}</h3><p>{group.note}</p></div><dl><div><dt>AR</dt><dd>{group.annual}</dd></div><i /><div><dt>Reg</dt><dd>{group.registration}</dd></div></dl></header>
          <div className="compliance-kpi-waste-list">
            {group.waste.map((waste) => <div key={waste.name} className="compliance-kpi-waste-row"><span><FileText aria-hidden="true" /></span><div><strong>{waste.name}</strong><p>AR: <b>{waste.annual}</b><i />Reg: <b>{waste.registration}</b></p></div></div>)}
          </div>
        </article>
      })}
    </div>
  </section>
}

function buildLeadPoRows(leads = [], users = []) {
  const userByKey = new Map()
  users.forEach((user) => getUserMatchKeys(user).forEach((key) => userByKey.set(key, user)))
  return leads.flatMap((lead) => {
    const services = Array.isArray(lead.serviceSelections) && lead.serviceSelections.length ? lead.serviceSelections : [{}]
    const assignments = Array.isArray(lead.assignments) ? lead.assignments : []
    return services.flatMap((service, serviceIndex) => {
      const assignment = assignments[serviceIndex] || {}
      const savedPoRows = Array.isArray(assignment.poYearRows) && assignment.poYearRows.length ? assignment.poYearRows : [{}]
      const assigneeKeys = [assignment.assignedStaff, assignment.assignedStaffEmail, assignment.assignedStaffText, assignment.assignedTo, assignment.assignedToEmail, assignment.assignedToText]
        .map(normalizeKey).filter(Boolean)
      const user = assigneeKeys.map((key) => userByKey.get(key)).find(Boolean) || null
      return savedPoRows.map((po, poIndex) => {
        const financialYear = po.fy || service.servicesForYear || service.financialYear || lead.firstAnnualReturnYearApplicable || ''
        const fileUrl = po.poFileUrl || ''
        const hasPo = Boolean(String(po.poNumber || '').trim() || fileUrl)
        return {
          id: `lead-po-${lead._id || lead.id || lead.leadCode}-${service.assignedServiceId || serviceIndex}-${financialYear || poIndex}`,
          atplCode: formatAtplCode(lead.leadCode || lead.sourceLeadId || '-') || '-',
          companyName: lead.company || lead.companyName || 'Unnamed client',
          eprCategory: service.eprCategory || service.serviceCategory || lead.eprCategory || 'Other EPR',
          category: service.piboParent || service.applicantType || lead.piboParent || lead.applicantType || 'Unassigned',
          subApplicantType: service.subApplicantType || service.piboCategory || lead.subApplicantType || lead.piboCategory || 'Unassigned',
          firstAnnualReturnYear: financialYear,
          annualYear: financialYear,
          poFinancialYear: po.poFinancialYear || '',
          createdAt: po.poDate || po.poReceivedDate || assignment.updatedAt || lead.updatedAt || lead.createdAt || '',
          annualReturns: [],
          hasPo,
          poDetails: { hasPo, poNo: po.poNumber || '', poDate: po.poDate || po.poReceivedDate || '', poEndDate: po.poEndDate || '', poFinancialYear: po.poFinancialYear || '', paymentTerm: po.paymentTerm || '', poAmount: po.poAmount ?? '', fileUrl, fileName: po.poFileName || 'Purchase Order' },
          user,
          userName: user ? getUserName(user) : assignment.assignedStaffText || assignment.assignedToText || assignment.closedByText || lead.createdByName || 'Unassigned'
        }
      })
    })
  })
}

function DashboardFilePreview({ file, onClose }) {
  if (!file?.url) return null
  const isPdf = /\.pdf(?:$|\?)/i.test(file.url) || /pdf/i.test(file.name || '')
  return <div className="fixed inset-0 z-[150] grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Purchase order file preview" onClick={onClose}><section className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}><header className="flex items-center justify-between border-b bg-[#0f5d46] px-5 py-4 text-white"><div><p className="text-xs font-black uppercase tracking-wider text-emerald-100">Purchase Order Proof</p><h2 className="mt-1 font-black">{file.name || 'Uploaded file'}</h2></div><button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 hover:bg-white/20" aria-label="Close file preview"><X className="h-5 w-5" /></button></header><div className="min-h-0 flex-1 bg-slate-100 p-3">{isPdf ? <iframe title="Purchase order PDF" src={file.url} className="h-full w-full rounded-xl bg-white" /> : <img src={file.url} alt={file.name || 'Purchase order proof'} className="h-full w-full rounded-xl object-contain" />}</div></section></div>
}

function UserWisePoStatus({ rows = [], leads = [], users = [], onRefresh, onOpenPo }) {
  const leadPoRows = useMemo(() => buildLeadPoRows(leads, users), [leads, users])
  const dashboardRows = leadPoRows.length ? leadPoRows : rows
  const availableYears = useMemo(() => {
    const years = new Set([currentFinancialYear()])
    dashboardRows.forEach((row) => {
      ;[row.poFinancialYear, row.annualYear, row.firstAnnualReturnYear, ...(row.annualReturns || []).flatMap((item) => [item.annualYear, item.financialYear, item.year])]
        .filter(Boolean).forEach((year) => {
          const start = financialYearStart(year)
          if (start) years.add(`${start}-${String(start + 1).slice(-2)}`)
        })
    })
    return [...years].sort((a, b) => financialYearStart(b) - financialYearStart(a))
  }, [dashboardRows])
  const [financialYear, setFinancialYear] = useState(currentFinancialYear())
  const [search, setSearch] = useState('')
  const [expandedUser, setExpandedUser] = useState('')
  const [expandedYear, setExpandedYear] = useState('')
  const [previewFile, setPreviewFile] = useState(null)
  const selectedRows = useMemo(
    () => dashboardRows.filter((row) => rowAppliesToFinancialYear(row, financialYear)),
    [dashboardRows, financialYear]
  )
  useEffect(() => {
    if (!dashboardRows.length || selectedRows.length) return
    const populatedYear = availableYears.find((year) => dashboardRows.some((row) => rowAppliesToFinancialYear(row, year)))
    if (populatedYear && populatedYear !== financialYear) setFinancialYear(populatedYear)
  }, [availableYears, dashboardRows, financialYear, selectedRows.length])
  const groups = useMemo(() => {
    const byUser = new Map()
    selectedRows.forEach((row) => {
      const name = row.userName || 'Unassigned'
      const current = byUser.get(name) || { name, role: row.user?.role || 'Operation', rows: [] }
      current.rows.push(row)
      byUser.set(name, current)
    })
    const needle = search.trim().toLowerCase()
    return [...byUser.values()]
      .filter((group) => !needle || [
        group.name,
        financialYear,
        ...group.rows.flatMap((row) => [row.companyName, row.atplCode, row.poDetails?.poNo, row.eprCategory, row.category, row.subApplicantType])
      ].some((value) => String(value || '').toLowerCase().includes(needle)))
      .sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name))
  }, [financialYear, search, selectedRows])
  const poReceived = selectedRows.filter((row) => row.hasPo).length
  const poPending = Math.max(0, selectedRows.length - poReceived)
  const poAnalytics = useMemo(() => {
    const categories = ['Plastic', 'E-Waste', 'Battery Waste', 'Other EPR'].map((name) => ({ name, total: 0, received: 0, applicants: new Map() }))
    const categoryByName = new Map(categories.map((item) => [item.name, item]))
    const applicantCounts = new Map(PO_APPLICANT_BUCKETS.map((name) => [name, 0]))
    selectedRows.forEach((row) => {
      const category = categoryByName.get(getPoWasteCategory(row))
      const applicant = getPoApplicantBucket(row)
      category.total += 1
      if (row.hasPo) category.received += 1
      category.applicants.set(applicant, (category.applicants.get(applicant) || 0) + 1)
      applicantCounts.set(applicant, (applicantCounts.get(applicant) || 0) + 1)
    })
    return {
      categories: categories.map((item) => ({ ...item, applicants: [...item.applicants.entries()].sort((left, right) => right[1] - left[1]) })),
      applicants: PO_APPLICANT_BUCKETS.map((name) => ({ name, count: applicantCounts.get(name) || 0 }))
    }
  }, [selectedRows])

  return (
    <div className="operations-po-dashboard space-y-5">
      <section className="operations-po-overview overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-900/5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[.22em] text-violet-600">PO Dashboard</p>
            <h1 className="mt-1 text-2xl font-black text-slate-950">User Wise PO Status</h1>
            <p className="mt-1 text-sm font-semibold text-slate-500">Expand a user to see financial-year PO counts and complete client details.</p>
          </div>
          <div className="flex items-end gap-3">
            <label className="grid gap-1 text-xs font-black uppercase tracking-wider text-slate-500">
              Financial Year
              <select className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-800 outline-none focus:border-violet-300" value={financialYear} onChange={(event) => { setFinancialYear(event.target.value); setExpandedYear('') }}>
                {availableYears.map((year) => <option key={year}>{year}</option>)}
              </select>
            </label>
            <button type="button" onClick={onRefresh} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-50"><RefreshCw className="h-4 w-4" />Refresh</button>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {[
            ['Total Clients', selectedRows.length, 'border-blue-100 bg-blue-50 text-blue-700'],
            ['PO Received', poReceived, 'border-emerald-100 bg-emerald-50 text-emerald-700'],
            ['PO Pending', poPending, 'border-red-100 bg-red-50 text-red-700']
          ].map(([label, count, tone]) => <div key={label} className={`rounded-xl border p-4 ${tone}`}><p className="text-xs font-black uppercase tracking-widest">{label} · {financialYear}</p><strong className="mt-2 block text-2xl">{count}</strong></div>)}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-900/5">
        <header className="border-b border-slate-200 bg-gradient-to-r from-emerald-50 via-white to-violet-50 p-5">
          <p className="text-xs font-black uppercase tracking-[.2em] text-emerald-700">Category intelligence · {financialYear}</p>
          <h2 className="mt-1 text-xl font-black text-slate-950">EPR Applicant &amp; Sub-applicant Analysis</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">Live client distribution with PO received and pending visibility.</p>
        </header>
        <div className="grid gap-4 p-5 xl:grid-cols-4">
          {poAnalytics.categories.map((category, index) => {
            const tone = ['from-emerald-600 to-teal-700', 'from-sky-600 to-blue-700', 'from-amber-500 to-orange-600', 'from-violet-600 to-purple-700'][index]
            return <article key={category.name} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className={`bg-gradient-to-br ${tone} p-4 text-white`}><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-white/75">EPR Category</p><h3 className="mt-1 text-lg font-black">{category.name}</h3></div><strong className="text-3xl">{category.total}</strong></div><div className="mt-4 flex gap-2 text-[11px] font-black"><span className="rounded-full bg-white/20 px-3 py-1">Received {category.received}</span><span className="rounded-full bg-black/15 px-3 py-1">Pending {category.total - category.received}</span></div></div>
              <div className="min-h-28 p-4"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Applicant / Sub-applicant count</p><div className="mt-3 flex flex-wrap gap-2">{category.applicants.length ? category.applicants.map(([name, count]) => <span key={name} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-700">{name}<b className="rounded-full bg-white px-2 py-0.5 text-emerald-700 shadow-sm">{count}</b></span>) : <span className="text-sm font-bold text-slate-400">No clients in this category.</span>}</div></div>
            </article>
          })}
        </div>
        <div className="border-t border-slate-200 bg-slate-50/70 p-5"><div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="font-black text-slate-950">Overall applicant mix</h3><p className="text-xs font-semibold text-slate-500">Producer, Importer, Brand Owner, Recycler and PIBO group distribution.</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-600 shadow-sm">{selectedRows.length} total</span></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">{poAnalytics.applicants.map((item) => <article key={item.name} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{item.name}</p><strong className="mt-2 block text-2xl text-slate-950">{item.count}</strong><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><i className="block h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500" style={{ width: `${selectedRows.length ? Math.max(4, (item.count / selectedRows.length) * 100) : 0}%` }} /></div></article>)}</div></div>
      </section>

      <section className="operations-po-users overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-900/5">
        <header className="flex flex-col gap-4 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div><h2 className="font-black text-slate-950">PO Status By User</h2><p className="text-xs font-semibold text-slate-500">Click a user row, then expand a financial year to see clients.</p></div>
          <label className="flex h-11 min-w-[320px] items-center gap-3 rounded-xl border border-slate-200 px-4 text-slate-400 focus-within:border-violet-300"><Search className="h-4 w-4" /><input className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search user, FY, client, PO..." /></label>
        </header>
        <div>
          {groups.length ? groups.map((group) => {
            const userOpen = expandedUser === group.name
            const received = group.rows.filter((row) => row.hasPo).length
            const yearKey = `${group.name}:${financialYear}`
            const clientsOpen = expandedYear === yearKey
            return <div key={group.name} className="border-b border-slate-100 last:border-0">
              <button type="button" onClick={() => { setExpandedUser(userOpen ? '' : group.name); if (userOpen) setExpandedYear('') }} className={`grid w-full gap-4 px-4 py-5 text-left transition hover:bg-slate-50 md:grid-cols-[1.7fr_1fr_1fr_1fr_auto] md:items-center ${userOpen ? 'bg-slate-50' : ''}`}>
                <span className="flex items-center gap-3"><i className="grid h-11 w-11 place-items-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-700"><Users className="h-5 w-5" /></i><span><strong className="block text-sm text-slate-950">{group.name}</strong><small className="font-semibold text-slate-500">{group.role}</small></span></span>
                <span><small className="block text-[10px] font-black uppercase tracking-wider text-slate-400">Total Clients · {financialYear}</small><strong className="text-lg text-slate-900">{group.rows.length}</strong></span>
                <span><small className="block text-[10px] font-black uppercase tracking-wider text-slate-400">PO Received · {financialYear}</small><strong className="text-lg text-emerald-700">{received}</strong></span>
                <span><small className="block text-[10px] font-black uppercase tracking-wider text-slate-400">PO Pending · {financialYear}</small><strong className="text-lg text-red-600">{group.rows.length - received}</strong></span>
                <span className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700">{userOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{userOpen ? 'Collapse' : 'Expand'}</span>
              </button>
              {userOpen && <div className="bg-slate-50 px-4 pb-5">
                <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
                  <table className="w-full min-w-[900px] text-left text-sm">
                    <thead className="bg-slate-100 text-xs uppercase tracking-wider text-slate-500"><tr>{['Financial Year', 'Total Clients', 'PO Received', 'PO Pending', 'Action'].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
                    <tbody><tr className="border-t"><td className="px-4 py-4 font-black">{financialYear}</td><td className="px-4 py-4">{group.rows.length}</td><td className="px-4 py-4 font-black text-emerald-700">{received}</td><td className="px-4 py-4 font-black text-red-600">{group.rows.length - received}</td><td className="px-4 py-4"><button type="button" onClick={() => setExpandedYear(clientsOpen ? '' : yearKey)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700">{clientsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}View Clients</button></td></tr></tbody>
                  </table>
                  {clientsOpen && <div className="border-t border-slate-200 p-3"><div className="overflow-auto rounded-lg border border-slate-200"><table className="w-full min-w-[1600px] text-left text-sm"><thead className="bg-[#0f5d46] text-[10px] uppercase tracking-wider text-white"><tr>{['Client Name', 'Lead Code', 'Service Category', 'Applicant Type', 'Sub Applicant Type', 'FY Year', 'PO Status', 'PO Number', 'PO Date', 'Uploaded File'].map((label) => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody>{group.rows.map((row) => <tr key={row.id} className="border-t"><td className="px-3 py-3 font-black">{row.companyName}</td><td className="px-3 py-3">{row.atplCode}</td><td className="px-3 py-3">{row.eprCategory}</td><td className="px-3 py-3 font-bold">{row.category}</td><td className="px-3 py-3">{row.subApplicantType}</td><td className="px-3 py-3">{financialYear}</td><td className="px-3 py-3"><button type="button" onClick={() => onOpenPo(row)} className={`rounded-full px-3 py-1 text-xs font-black ${row.hasPo ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{row.hasPo ? 'Received' : 'Pending'}</button></td><td className="px-3 py-3 font-bold">{row.poDetails?.poNo || '-'}</td><td className="px-3 py-3">{row.poDetails?.poDate ? new Date(row.poDetails.poDate).toLocaleDateString('en-GB') : '-'}</td><td className="px-3 py-3">{row.poDetails?.fileUrl ? <button type="button" className="font-black text-blue-600 hover:underline" onClick={() => setPreviewFile({ url: row.poDetails.fileUrl, name: row.poDetails.fileName || `${row.companyName} PO` })}>View File</button> : '-'}</td></tr>)}</tbody></table></div></div>}
                </div>
              </div>}
            </div>
          }) : <div className="p-12 text-center font-black text-slate-400">No PO status records match this filter.</div>}
        </div>
      </section>
      <DashboardFilePreview file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  )
}

const OPERATIONS_PROGRESS_MILESTONES = [48, 72, 96]

function OperationsProgressValue({ done = 0, total = 0, tone = 'green', label }) {
  const percentage = total ? Math.round((done / total) * 100) : 0
  return <div className={`operations-user-progress operations-user-progress-${tone}`}>
    <strong>{label || `${done} / ${total}`}</strong>
    <span><motion.i initial={{ width: 0 }} animate={{ width: `${Math.min(100, percentage)}%` }} transition={{ duration: .72, ease: [0.22, 1, 0.36, 1] }} /></span>
    <small>{percentage}%</small>
  </div>
}

function OperationsFinalFlag({ rows = [], sla }) {
  const red = sla ? (getOperationsFinalFlag(sla) === 'red' ? 1 : 0) : rows.filter((row) => getOperationsFinalFlag(row.sla) === 'red').length
  const tone = red ? 'red' : 'green'
  return <span className={`operations-final-flag is-${tone}`} aria-label={`Final Flag: ${tone}`} title="Final flag is red only when 48h, 72h and 96h are all red."><Flag aria-hidden="true" fill="currentColor" /><strong>{tone === 'red' ? 'Red' : 'Green'}</strong>{!sla && <small>{red} / {rows.length} red</small>}</span>
}

function fitOperationsWorksheet(sheet, rows = []) {
  const headers = rows.length ? Object.keys(rows[0]) : []
  sheet['!cols'] = headers.map((header) => ({ wch: Math.min(55, Math.max(12, header.length + 2, ...rows.map((row) => String(row[header] ?? '').length + 2))) }))
  if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] }
  sheet['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' }
}

function downloadOperationsExcel(groups, financialYear) {
  const { summary, clients, poDetails, tabRemarks } = buildOperationsWorkbookData(groups, financialYear)
  const summarySheet = XLSX.utils.json_to_sheet(summary)
  const clientSheet = XLSX.utils.json_to_sheet(clients)
  const poSheet = XLSX.utils.json_to_sheet(poDetails)
  const remarksSheet = XLSX.utils.json_to_sheet(tabRemarks)
  fitOperationsWorksheet(summarySheet, summary)
  fitOperationsWorksheet(clientSheet, clients)
  fitOperationsWorksheet(poSheet, poDetails)
  fitOperationsWorksheet(remarksSheet, tabRemarks)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'User Summary')
  XLSX.utils.book_append_sheet(workbook, clientSheet, 'Client Details')
  XLSX.utils.book_append_sheet(workbook, poSheet, 'PO Details')
  XLSX.utils.book_append_sheet(workbook, remarksSheet, 'Compliance Tab Remarks')
  const yearLabel = String(financialYear || 'all').replace(/[^a-z0-9-]+/gi, '-')
  XLSX.writeFile(workbook, `Operations-Dashboard-${yearLabel}-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

const OperationsClientDetails = React.memo(function OperationsClientDetails({ group }) {
  const [expandedCompany, setExpandedCompany] = useState(null)
  return <div className="operations-client-details operations-company-details">
                <header><strong>{group.name} · Assigned clients</strong><span>{group.total} client records</span></header>
                {group.rows.length ? <div className="operations-company-list">{group.rows.map(company => <section key={company.id}>
                  <button type="button" className="operations-company-toggle" aria-expanded={expandedCompany === company.id} onClick={() => setExpandedCompany(current => current === company.id ? null : company.id)}><span>{expandedCompany === company.id ? '⌄' : '›'}</span><strong>{company.companyName}</strong></button>
                  {expandedCompany === company.id && <div className="operations-company-services"><table><thead><tr><th>Client / Applicant</th><th>Compliance Status</th><th>PO Status</th>{OPERATIONS_PROGRESS_MILESTONES.map(hours => <th key={hours}>{hours}h+ Red Flag</th>)}<th>Final Flag</th></tr></thead><tbody>{(company.serviceRows || [company]).map(row => {
                    const basic = row.client?.data?.basic || {}
                    const services = row.client?.selectedLead?.serviceSelections || []
                    const service = services.find(item => String(item.assignedServiceId || item.serviceAssignmentId || '') === String(row.client?.assignedServiceId || '')) || (services.length === 1 ? services[0] : {})
                    const applicant = basic.piboCategory || basic.subApplicantType || service.subApplicantType || service.piboCategory || basic.applicantType || service.applicantType || 'Applicant not recorded'
                    const approval = row.client?.operationsSla?.approvalStatus || row.client?.adminControls?.approvalStatus || 'PENDING'
                    const statusDates = getOperationsStatusDates(row)
                    return <tr key={row.id} ><td><div className="operations-client-name"><FileText aria-hidden="true" /><span><strong title={row.companyName}>{row.companyName}</strong><small>{applicant} · {row.atplCode}</small></span></div></td>
                      <td><em className={approval === 'APPROVED' ? 'status-applicable' : 'status-partial'}>{String(approval).replace(/_/g, ' ')}</em><small className="operations-status-date"><CalendarDays aria-hidden="true" />{statusDates.compliance.value ? `${statusDates.compliance.label} ${formatDisplayDateTime(statusDates.compliance.value)}` : 'Status date not recorded'}</small></td>
                      <td><em className={row.hasPo ? 'status-received' : 'status-missing'}>{row.hasPo ? 'Received' : 'Pending'}</em><small className="operations-status-date"><CalendarDays aria-hidden="true" />{statusDates.po.value ? `PO date ${formatDisplayDate(statusDates.po.value)}` : row.hasPo ? 'PO date not recorded' : 'Awaiting PO'}</small>{row.poDetails?.poNo && <small className="operations-po-number">PO #{row.poDetails.poNo}</small>}{row.poDetails?.fileUrl && <a className="operations-po-proof-link" href={row.poDetails.fileUrl} target="_blank" rel="noopener noreferrer"><Eye aria-hidden="true" />View PO Proof</a>}</td>

                      {OPERATIONS_PROGRESS_MILESTONES.map((hours) => <td key={hours}><em className={row.sla[hours].breached ? 'status-missing' : row.sla[hours].known ? 'status-received' : 'status-neutral'}>{row.sla[hours].breached ? 'Red flag' : row.sla[hours].known ? 'Clear' : 'No correction deadline'}</em>{row.sla[hours].due && <small className="operations-sla-date">Due {formatDisplayDateTime(row.sla[hours].due)}</small>}</td>)}
                      <td><OperationsFinalFlag sla={row.sla} /></td>
                    </tr>
                  })}</tbody></table></div>}
                </section>)}</div> : <p className="operations-client-empty">No clients allocated to this Operations user.</p>}
              </div>
})

const OperationsUserProgressTable = React.memo(function OperationsUserProgressTable({ rows = [], users = [], pdfMode = false, reportTime, financialYear = currentFinancialYear() }) {
  const [assignedClients, setAssignedClients] = useState(null)
  const [assignmentError, setAssignmentError] = useState('')
  const [assignmentRefresh, setAssignmentRefresh] = useState(0)
  useEffect(() => {
    if (pdfMode) return
    const controller = new AbortController()
    api.get('/dashboard-insights/upload-tracker', { params: { assignmentsOnly: 'true' }, signal: controller.signal, timeout: 45000 })
      .then(({ data }) => { setAssignedClients(data.assignments || []); setAssignmentError('') })
      .catch(error => { if (error.code !== 'ERR_CANCELED') setAssignmentError('Could not refresh manager-to-staff assignments. Please retry.') })
    return () => controller.abort()
  }, [pdfMode, assignmentRefresh])
  const reportRows = useMemo(() => {
    if (!assignedClients) return pdfMode ? rows : []
    const existing = new Map(rows.map(row => [String(row.client?._id || row.id), row]))
    return assignedClients.map(client => {
      const row = existing.get(String(client._id))
      if (row) return { ...row, companyName: client.selectedLead?.company || client.selectedLead?.companyName || row.companyName, client: { ...row.client, ...client } }
      const assignment = client.selectedLead?.assignments?.find(item => item.assignedServiceId === client.assignedServiceId) || client.selectedLead?.assignments?.[0] || {}
      const poRecords = [...(assignment.poYearRows || []), ...(assignment.originalPoDetails ? [assignment.originalPoDetails] : [])]
      const financials = client.data?.financials || {}
      // Lead assignments contribute to the total; confirmed PO progress comes from Client Master records.
      const hasPo = !client.assignmentOnly && (poRecords.some(po => po.poNumber || po.poNo || po.poDate || po.poReceivedDate || po.poFileName) || Boolean(financials.compliancePoNo || financials.poNo || financials.poNumber || financials.compliancePoDate || financials.poDate || financials.compliancePoFileName || financials.poFileName))
      return { id: String(client._id), client, companyName: client.selectedLead?.company || client.selectedLead?.companyName || client.data?.basic?.clientLegalName || client.data?.basic?.tradeName || client.data?.importMeta?.companyName || 'Untitled client', atplCode: client.data?.importMeta?.leadNumber || '', hasPo, poDetails: { ...poRecords[0], records: poRecords } }
    })
  }, [rows, assignedClients, pdfMode])
  const [activeTab, setActiveTab] = useState('ownership')
  const [expandedUser, setExpandedUser] = useState('')
  const [search, setSearch] = useState('')
  const [now, setNow] = useState(() => reportTime || Date.now())
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [pdfProgress, setPdfProgress] = useState('Preparing PDF…')
  const pdfRef = useRef(null)
  useEffect(() => {
    if (pdfMode) return
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [pdfMode])
  useEffect(() => {
    if (!exporting || !pdfRef.current) return
    downloadOperationsReportPdf(pdfRef.current.firstElementChild, setPdfProgress)
      .catch((error) => setExportError(error.message || 'PDF download failed. Please try again.'))
      .finally(() => setExporting(false))
  }, [exporting])
  const groups = useMemo(() => buildOperationsProgressGroups(reportRows, users, getAssignedUserKeysFromClient, now), [reportRows, users, now])
  const visibleGroups = groups.filter((group) => [group.name, ...group.rows.flatMap((row) => [row.companyName, row.atplCode])].some((value) => normalizeKey(value).includes(normalizeKey(search))))
  const totals = useMemo(() => groups.reduce((result, group) => ({
    clients: result.clients + group.total,
    compliance: result.compliance + group.complianceDone,
    po: result.po + group.poDone,
    48: result[48] + group.milestones[48],
    72: result[72] + group.milestones[72],
    96: result[96] + group.milestones[96]
  }), { clients: 0, compliance: 0, po: 0, 48: 0, 72: 0, 96: 0 }), [groups])
  const tones = ['orange', 'red', 'violet', 'blue', 'green']

  return <section className="operations-user-status-card" aria-label="User-wise operations status">
    <header className="operations-user-status-heading">
      <div><span>Operations performance</span><h2>Client Ownership &amp; Red Flags</h2><p>Assigned clients, approved compliance and overdue correction deadlines. Red flags are cumulative: 96h also counts in 72h and 48h.</p></div>
      <div className="operations-report-actions">{pdfMode ? <b><Users aria-hidden="true" />{groups.length} Operations users</b> : <div role="tablist" aria-label="Operations reports" className="flex flex-wrap gap-2"><button type="button" role="tab" aria-selected={activeTab === 'ownership'} className="operations-report-download" onClick={() => setActiveTab('ownership')}><Users aria-hidden="true" />{groups.length} Operations users</button><button type="button" role="tab" aria-selected={activeTab === 'data'} className="operations-report-download" onClick={() => setActiveTab('data')}>Purchase &amp; Sales</button></div>}{!pdfMode && activeTab === 'ownership' && <><button type="button" className="operations-report-download" disabled={!groups.length} onClick={() => downloadOperationsExcel(groups, financialYear)}><Download aria-hidden="true" />Export Excel</button><button type="button" className="operations-report-download" disabled={exporting || !groups.length} onClick={() => { setExportError(''); setPdfProgress('Preparing PDF…'); setExporting(true) }}><Download aria-hidden="true" />{exporting ? pdfProgress : 'Download full PDF'}</button></>}</div>
    </header>
    <div className="operations-report-meta"><span><CalendarDays aria-hidden="true" />Updated {formatDisplayDateTime(now)} IST</span><span>{pdfMode ? 'PDF contains aggregate user metrics only; client names are excluded.' : 'PDF includes every Operations user as an aggregate table without client names.'}</span></div>
    {assignmentError && <p role="alert" className="operations-export-error">{assignmentError} <button type="button" onClick={() => { setAssignmentError(''); setAssignmentRefresh(value => value + 1) }} className="ml-2 font-bold underline">Retry</button></p>}
    {!pdfMode && !assignedClients && !assignmentError && <p role="status" className="p-5 text-sm text-slate-500">Loading all manager-to-staff assignments…</p>}
    {exportError && <p className="operations-export-error" role="alert">{exportError}</p>}
    {!pdfMode && <div className="operations-user-toolbar"><label><Search aria-hidden="true" /><input aria-label="Search Operations users or clients" placeholder="Search user, client or ATPL code" value={search} onChange={(event) => setSearch(event.target.value)} /></label><span>{new Set(groups.flatMap((group) => group.rows.map((row) => row.id))).size} assigned clients · {totals[48]} overdue assignments</span></div>}
    {activeTab === 'data' ? <PurchaseSalesProgress groups={visibleGroups} financialYear={financialYear} /> : <>
    <div className="operations-user-status-scroll">
      <table className="operations-user-status-table">
        <thead><tr><th>Operations User</th><th>Assigned Clients</th><th>Compliance<small>Approved / Assigned</small></th><th>Purchase Order<small>Received / Assigned</small></th>{OPERATIONS_PROGRESS_MILESTONES.map((milestone) => <th key={milestone}>{milestone}h+ Red Flags<small>Overdue / Assigned</small></th>)}<th>Final Flag<small>All three red = Red</small></th><th aria-label="Action">View</th></tr></thead>
        <tbody>
          {visibleGroups.map((group, groupIndex) => {
            const open = !pdfMode && expandedUser === group.id
            const initials = group.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U'
            return <React.Fragment key={group.id}>
              <tr className={`operations-user-summary-row ${open ? 'is-open' : ''}`}>
                <td><button type="button" className="operations-user-toggle" aria-expanded={open} onClick={() => setExpandedUser(open ? '' : group.id)}><ChevronRight aria-hidden="true" /><i className={`avatar-${tones[groupIndex % tones.length]}`}>{initials}</i><strong>{group.name}</strong></button></td>
                <td><b>{group.total}</b></td>
                <td><OperationsProgressValue done={group.complianceDone} total={group.total} tone={group.complianceDone === group.total ? 'green' : 'red'} /></td>
                <td><OperationsProgressValue done={group.poDone} total={group.total} tone="green" /></td>
                {OPERATIONS_PROGRESS_MILESTONES.map((hours) => <td key={hours}><OperationsProgressValue done={group.milestones[hours]} total={group.total} tone={group.milestones[hours] ? 'red' : 'green'} /></td>)}
                <td><OperationsFinalFlag rows={group.rows} /></td>
                <td><button type="button" className="operations-user-view" aria-label={`${open ? 'Hide' : 'View'} ${group.name} clients`} onClick={() => setExpandedUser(open ? '' : group.id)}><Eye aria-hidden="true" /></button></td>
              </tr>
              {open && <tr className="operations-user-detail-row"><td colSpan={9}><OperationsClientDetails key={group.id} group={group} /></td></tr>}
            </React.Fragment>
          })}
        </tbody>
        <tfoot><tr><td><span><BarChart3 aria-hidden="true" />Total (Operations assignments)</span></td><td><b>{totals.clients}</b></td><td><OperationsProgressValue done={totals.compliance} total={totals.clients} tone="green" /></td><td><OperationsProgressValue done={totals.po} total={totals.clients} tone="green" /></td><td><OperationsProgressValue done={totals[48]} total={totals.clients} tone="red" /></td><td><OperationsProgressValue done={totals[72]} total={totals.clients} tone="red" /></td><td><OperationsProgressValue done={totals[96]} total={totals.clients} tone="red" /></td><td><OperationsFinalFlag rows={groups.flatMap((group) => group.rows)} /></td><td /></tr></tfoot>
      </table>
    </div>
    </>}
    {!groups.length && <div className="operations-user-status-empty"><Users aria-hidden="true" /><strong>No assigned client records found</strong></div>}
    {!pdfMode && exporting && <div ref={pdfRef} className="operations-pdf-source" aria-hidden="true"><OperationsUserProgressTable rows={reportRows} users={users} pdfMode reportTime={now} /></div>}
  </section>
})

function EprAnalyticsDashboard({ rows = [], complianceRows = [], leads = [], users = [], onRefresh }) {
  const leadPoRows = useMemo(() => buildLeadPoRows(leads, users), [leads, users])
  const dashboardRows = leadPoRows.length ? leadPoRows : rows
  const availableYears = useMemo(() => {
    const years = new Set(Array.from({ length: 8 }, (_, index) => `${2022 + index}-${String(2023 + index).slice(-2)}`))
    ;[...dashboardRows, ...rows].forEach((row) => [
      row.poFinancialYear,
      row.annualYear,
      row.firstAnnualReturnYear,
      ...(row.annualReturns || []).flatMap((filing) => [filing.annualYear, filing.financialYear, filing.year])
    ].filter(Boolean).forEach((year) => {
      const start = financialYearStart(year)
      if (start) years.add(`${start}-${String(start + 1).slice(-2)}`)
    }))
    return [...years].sort((a, b) => financialYearStart(b) - financialYearStart(a))
  }, [dashboardRows, rows])
  const [financialYear, setFinancialYear] = useState('all')
  const [search, setSearch] = useState('')
  const [poStatus, setPoStatus] = useState('all')
  const [eprCategory, setEprCategory] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const financialYearRows = useMemo(() => selectRowsForPoFinancialYear(dashboardRows, financialYear), [dashboardRows, financialYear])
  const selectedRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return financialYearRows.filter((row) => {
      if (poStatus === 'received' && !row.hasPo) return false
      if (poStatus === 'pending' && row.hasPo) return false
      if (eprCategory !== 'all' && getPoWasteCategory(row) !== eprCategory) return false
      const rowDate = String(row.poDetails?.poDate || row.createdAt || '').slice(0, 10)
      if (dateFrom && (!rowDate || rowDate < dateFrom)) return false
      if (dateTo && (!rowDate || rowDate > dateTo)) return false
      return !needle || [row.companyName, row.atplCode, row.poDetails?.poNo, row.eprCategory, row.category, row.subApplicantType, row.userName].some((value) => String(value || '').toLowerCase().includes(needle))
    })
  }, [dateFrom, dateTo, eprCategory, financialYearRows, poStatus, search])
  const clientSelectedRows = useMemo(() => selectRowsForPoFinancialYear(rows, financialYear).filter((row) => {
    if (poStatus === 'received' && !row.hasPo) return false
    if (poStatus === 'pending' && row.hasPo) return false
    if (eprCategory !== 'all' && getPoWasteCategory(row) !== eprCategory) return false
    const rowDate = String(row.poDetails?.poDate || row.createdAt || '').slice(0, 10)
    if (dateFrom && (!rowDate || rowDate < dateFrom)) return false
    if (dateTo && (!rowDate || rowDate > dateTo)) return false
    const needle = search.trim().toLowerCase()
    return !needle || [row.companyName, row.atplCode, row.poDetails?.poNo, row.eprCategory, row.category, row.subApplicantType, row.userName].some((value) => String(value || '').toLowerCase().includes(needle))
  }), [rows, financialYear, poStatus, eprCategory, dateFrom, dateTo, search])
  const complianceKpi = useMemo(
    () => buildComplianceKpi(selectRowsForPoFinancialYear(complianceRows.length ? complianceRows : rows, financialYear), financialYear, true),
    [complianceRows, financialYear, rows]
  )
  const analytics = useMemo(() => {
    const categories = ['Plastic', 'E-Waste', 'Battery Waste', 'Other EPR'].map((name) => ({ name, total: 0, received: 0, applicants: new Map() }))
    const categoryMap = new Map(categories.map((item) => [item.name, item]))
    const applicantMap = new Map(PO_APPLICANT_BUCKETS.map((name) => [name, 0]))
    selectedRows.forEach((row) => {
      const category = categoryMap.get(getPoWasteCategory(row))
      const applicant = getPoApplicantBucket(row)
      category.total += 1
      if (row.hasPo) category.received += 1
      category.applicants.set(applicant, (category.applicants.get(applicant) || 0) + 1)
      applicantMap.set(applicant, (applicantMap.get(applicant) || 0) + 1)
    })
    return { categories: categories.map((item) => ({ ...item, applicants: [...item.applicants.entries()].sort((a, b) => b[1] - a[1]) })), applicants: PO_APPLICANT_BUCKETS.map((name) => ({ name, count: applicantMap.get(name) || 0 })) }
  }, [selectedRows])
  const categoryColors = ['#10b981', '#1687e8', '#fb8500', '#7c3aed']
  const categoryChartData = analytics.categories.filter((item) => item.total)
  const chartData = categoryChartData.length ? categoryChartData : [{ name: 'No data', total: 1 }]
  const resetFilters = () => { setFinancialYear('all'); setSearch(''); setPoStatus('all'); setEprCategory('all'); setDateFrom(''); setDateTo('') }

  return <div className="epr-intelligence-dashboard"><section className="epr-dashboard-shell">
    <header className="epr-dashboard-heading"><div><p>ANANTTATTVA e-connect · {financialYear === 'all' ? 'All PO Financial Years' : financialYear === 'unrecorded' ? 'PO year not recorded' : financialYear}</p><h1>EPR Applicant &amp; Sub-applicant Analysis</h1><span>Live client distribution with PO received and pending visibility.</span></div><button type="button" onClick={onRefresh}><RefreshCw aria-hidden="true" />Refresh data</button></header>
    <div className="epr-filter-bar" aria-label="Dashboard filters">
      <label className="epr-search-filter"><Search aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search client, lead, user or PO..." /></label>
      <select aria-label="PO Financial Year" title="Filter by saved PO Financial Year" value={financialYear} onChange={(event) => setFinancialYear(event.target.value)}><option value="all">All PO Financial Years</option>{availableYears.map((year) => <option key={year}>{year}</option>)}<option value="unrecorded">Not recorded</option></select>
      <select aria-label="PO status" value={poStatus} onChange={(event) => setPoStatus(event.target.value)}><option value="all">All PO Status</option><option value="received">PO Received</option><option value="pending">PO Pending</option></select>
      <select aria-label="EPR category" value={eprCategory} onChange={(event) => setEprCategory(event.target.value)}><option value="all">All Categories</option>{['Plastic', 'E-Waste', 'Battery Waste', 'Other EPR'].map((item) => <option key={item}>{item}</option>)}</select>
      <label className="epr-date-filter"><span>From</span><input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} /></label>
      <label className="epr-date-filter"><span>To</span><input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} /></label>
      <button type="button" className="epr-clear-filter" onClick={resetFilters}>Clear</button>
    </div>
    <div className="epr-category-grid" hidden style={{ display: 'none' }}>{analytics.categories.map((category, index) => <motion.article key={category.name} className={`epr-category-card epr-category-${index + 1}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .06 }}><div><p>EPR Category</p><h2>{category.name}</h2><strong>{category.total}</strong><section><span>Received {category.received}</span><span>Pending {category.total - category.received}</span></section></div><footer><p>Applicant / Sub-applicant count</p><section>{category.applicants.length ? category.applicants.map(([name, count]) => <span key={name}>{name}<b>{count}</b></span>) : <em>No clients in this category.</em>}</section></footer></motion.article>)}</div>
    <OperationsUserProgressTable rows={clientSelectedRows} users={users} financialYear={financialYear} />
    <div className="epr-chart-grid">
      <article className="epr-chart-card"><header><div><h2>Leads by EPR Category</h2><p>Filtered category distribution</p></div><b>{selectedRows.length} total</b></header><div className="epr-donut-body"><div className="epr-donut"><ResponsiveContainer width="100%" height="100%"><RechartsPieChart><Pie data={chartData} dataKey="total" nameKey="name" innerRadius={62} outerRadius={86} paddingAngle={3} stroke="none">{chartData.map((entry, index) => <Cell key={entry.name} fill={categoryChartData.length ? categoryColors[index] : '#e5e7eb'} />)}</Pie><Tooltip /></RechartsPieChart></ResponsiveContainer><span><strong>{selectedRows.length}</strong>Total</span></div><div className="epr-chart-legend">{analytics.categories.map((item, index) => <div key={item.name}><i style={{ background: categoryColors[index] }} /><span>{item.name}</span><strong>{item.total}</strong><small>{selectedRows.length ? `${((item.total / selectedRows.length) * 100).toFixed(1)}%` : '0%'}</small></div>)}</div></div></article>
      <article className="epr-chart-card"><header><div><h2>Applicant / Sub-applicant Mix</h2><p>Live distribution by applicant type</p></div></header><div className="epr-bar-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={analytics.applicants} margin={{ top: 24, right: 10, left: -20, bottom: 5 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8edf3" /><XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} /><Tooltip cursor={{ fill: '#f8fafc' }} /><Bar dataKey="count" radius={[7, 7, 0, 0]} maxBarSize={54}>{analytics.applicants.map((item, index) => <Cell key={item.name} fill={['#fb923c', '#34d399', '#8b5cf6', '#0ea5e9', '#f43f5e', '#94a3b8', '#fbbf24'][index]} />)}</Bar></BarChart></ResponsiveContainer></div></article>
    </div>
    <div className="epr-summary-strip"><div><h2>Overall applicant mix</h2><p>Producer, Importer, Brand Owner, Recycler and PIBO group distribution.</p></div><span>{selectedRows.length} total</span><section>{analytics.applicants.map((item) => <article key={item.name}><p>{item.name}</p><strong>{item.count}</strong><i><b style={{ width: `${selectedRows.length ? Math.max(3, (item.count / selectedRows.length) * 100) : 0}%` }} /></i></article>)}</section></div>
    {!selectedRows.length && <div className="epr-empty-state"><BarChart3 aria-hidden="true" /><strong>No records match these filters</strong><span>Try clearing a filter or selecting another financial year.</span></div>}
  </section></div>
}

function AnnualReturnYearModal({ row, onClose, onSelectYear }) {
  const years = buildOperationsAnnualYearOptions(row)

  return (
    <div className="operations-modal-backdrop" role="presentation" onClick={onClose}>
      <div className="operations-annual-modal" role="dialog" aria-modal="true" aria-label="Select Annual Return Year" onClick={(event) => event.stopPropagation()}>
        <div className="operations-annual-modal-head">
          <div>
            <span>Annual Return Hubs</span>
            <h3>{row?.companyName || 'Select annual return year'}</h3>
            <p>{row?.atplCode || '-'} - EPR Year - April - March</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close Annual Return Year Picker">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="operations-annual-table-card">
          <table className="operations-annual-year-table">
            <thead>
              <tr>
                <th>EPR Year</th>
                <th>Period</th>
                <th>Hub Status</th>
                <th>Completion</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {years.map((year, index) => {
                const percentReady = percent(year.completed, 4)
                const isCurrent = year.status === 'Current hub'
                return (
                  <tr key={year.label} style={{ '--delay': `${index * 55}ms` }}>
                    <td>
                      <div className="operations-annual-year-cell">
                        <span><CalendarDays className="h-4 w-4" /></span>
                        <strong>{year.label}</strong>
                      </div>
                    </td>
                    <td>{year.period}</td>
                    <td>
                      <span className={`operations-annual-hub-pill ${isCurrent ? 'operations-annual-hub-current' : ''}`}>
                        {year.status}
                      </span>
                    </td>
                    <td>
                      <div className="operations-annual-progress-cell">
                        <div>
                          <strong>{year.completed}/4</strong>
                          <span>{percentReady}% ready</span>
                        </div>
                        <i><em style={{ width: `${percentReady}%` }} /></i>
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => onSelectYear(year.label)}
                        className="operations-annual-view-action"
                        aria-label={`View annual return ${year.label}`}
                        title={`View ${year.label}`}
                      >
                        <Eye className="h-4 w-4" />
                        <span>View</span>
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function SalesAnalyticsBars({ title, subtitle, rows = [], tone = 'teal', delay = 0, initialLimit = 0 }) {
  const [showAllRows, setShowAllRows] = useState(false)
  const max = Math.max(1, ...rows.map((row) => row.value))
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  const visibleRows = initialLimit && !showAllRows ? rows.slice(0, initialLimit) : rows
  return (
    <motion.article className={`sales-mix-card sales-mix-${tone}`} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .42, delay }}>
      <header><div><span>{subtitle}</span><h3>{title}</h3></div><b>{total}</b></header>
      <div className="sales-mix-bars">
        {rows.length ? visibleRows.map((row, index) => {
          const percentValue = Math.round((row.value / Math.max(total, 1)) * 100)
          return (
            <div className="sales-mix-row" key={`${row.label}-${index}`} title={`${row.label}: ${row.value} (${percentValue}%)`}>
              <strong>{row.label}</strong>
              <div><motion.i initial={{ width: 0 }} animate={{ width: `${Math.max(4, (row.value / max) * 100)}%` }} transition={{ duration: .72, delay: delay + index * .055, ease: [0.22, 1, 0.36, 1] }} /></div>
              <em>{row.value}</em><small>{percentValue}%</small>
            </div>
          )
        }) : <p className="sales-mix-empty">No data available yet</p>}
      </div>
      {initialLimit > 0 && rows.length > initialLimit && <button type="button" className="sales-mix-view-more" aria-expanded={showAllRows} onClick={() => setShowAllRows((value) => !value)}>{showAllRows ? 'View Less' : `View More (${rows.length - initialLimit})`}<ChevronDown aria-hidden="true" /></button>}
    </motion.article>
  )
}

function SalesMixAnalytics({ analytics, total }) {
  const [applicantTypeView, setApplicantTypeView] = useState('pibo')
  const applicantTypeConfig = applicantTypeView === 'services'
    ? { title: 'Services Offered', subtitle: 'Lead service portfolio', rows: analytics.services, tone: 'teal' }
    : { title: 'PIBO Category', subtitle: 'Sub applicant type distribution', rows: analytics.subApplicantTypes, tone: 'violet' }

  return (
    <section className="sales-mix-section">
      <div className="sales-mix-top-grid">
        <SalesAnalyticsBars title="Top Industries" subtitle="Market concentration" rows={analytics.industries} tone="blue" delay={.06} />
        <div className="sales-applicant-type-panel">
          <div className="sales-applicant-type-head">
            <div>
              <span>Applicant Type</span>
              <h3>Applicant Type</h3>
            </div>
            <div className="sales-applicant-type-tabs" role="tablist" aria-label="Applicant type analytics">
              <button
                type="button"
                className={applicantTypeView === 'pibo' ? 'active' : ''}
                onClick={() => setApplicantTypeView('pibo')}
                role="tab"
                aria-selected={applicantTypeView === 'pibo'}
              >
                PIBO Category
              </button>
              <button
                type="button"
                className={applicantTypeView === 'services' ? 'active' : ''}
                onClick={() => setApplicantTypeView('services')}
                role="tab"
                aria-selected={applicantTypeView === 'services'}
              >
                Services Offered
              </button>
            </div>
          </div>
          <SalesAnalyticsBars
            title={applicantTypeConfig.title}
            subtitle={applicantTypeConfig.subtitle}
            rows={applicantTypeConfig.rows}
            tone={applicantTypeConfig.tone}
            delay={.11}
          />
        </div>
        <SalesAnalyticsBars title="Top States by Leads" subtitle="Geographic demand" rows={analytics.states} tone="green" delay={.16} />
        <SalesAnalyticsBars title="Team Workload · Leads Assigned" subtitle="Ownership balance" rows={analytics.workload} tone="amber" delay={.2} />
      </div>
    </section>
  )
}

function SalesRiskStrip({ items = [], onView, expanded = false }) {
  return (
    <section className="sales-risk-strip">
      <div className="sales-risk-title"><ShieldAlert aria-hidden="true" /><strong>Sales Red Flags &amp; Missed Follow-ups</strong></div>
      <button type="button" onClick={onView} aria-expanded={expanded}>{expanded ? 'Hide Details' : 'View Details'}<ChevronDown aria-hidden="true" /></button>
    </section>
  )
}

function SalesStatesMapCard({ rows = [], delay = 0 }) {
  const [hoveredState, setHoveredState] = useState(null)
  const showMapTooltip = (event, details) => {
    const container = event.currentTarget.closest('.sales-india-map')
    if (!container) return setHoveredState(details)
    const bounds = container.getBoundingClientRect()
    const scaleX = container.offsetWidth / Math.max(bounds.width, 1)
    const scaleY = container.offsetHeight / Math.max(bounds.height, 1)
    const x = Math.min(Math.max(8, (event.clientX - bounds.left) * scaleX + 12), Math.max(8, container.offsetWidth - 150))
    const y = Math.min(Math.max(8, (event.clientY - bounds.top) * scaleY + 12), Math.max(8, container.offsetHeight - 76))
    setHoveredState({ ...details, x, y })
  }
  const normalizeState = (value = '') => {
    const key = String(value).trim().toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim()
    const aliases = { orissa: 'odisha', uttaranchal: 'uttarakhand', 'nct of delhi': 'delhi', 'jammu and kashmir': 'jammu and kashmir', 'dadra and nagar haveli and daman and diu': 'dadra and nagar haveli and daman and diu' }
    return aliases[key] || key
  }
  const displayState = (value = '') => value.replace(/\b\w/g, (letter) => letter.toUpperCase()).replace(/\bAnd\b/g, 'and')
  const aggregatedRows = Object.entries(rows.reduce((result, row) => {
    const key = normalizeState(row.label)
    if (key && key !== 'others') result[key] = (result[key] || 0) + Number(row.value || 0)
    return result
  }, {})).map(([key, value]) => ({ key, label: displayState(key), value })).sort((a, b) => b.value - a.value)
  const total = aggregatedRows.reduce((sum, row) => sum + row.value, 0)
  const max = Math.max(1, ...aggregatedRows.map((row) => row.value))
  const topRows = aggregatedRows.slice(0, 6)
  const othersValue = aggregatedRows.slice(6).reduce((sum, row) => sum + row.value, 0)
  const visibleRows = othersValue ? [...topRows, { key: 'others', label: 'Others', value: othersValue }] : topRows
  const stateValues = Object.fromEntries(aggregatedRows.map((row) => [row.key, row.value]))
  const rankByState = Object.fromEntries(topRows.map((row, index) => [row.key, index + 1]))
  const markerCoordinates = { gujarat: [71.2, 22.7], maharashtra: [75.5, 19.2], karnataka: [76.1, 14.7], delhi: [77.1, 28.6], rajasthan: [73.8, 26.8], 'uttar pradesh': [80.8, 27.3], 'madhya pradesh': [78.2, 23.5], 'tamil nadu': [78.4, 10.8], telangana: [79.1, 17.8], 'west bengal': [87.8, 23.1], haryana: [76.2, 29.1], punjab: [75.3, 31.1], odisha: [84.2, 20.5] }
  const colorForValue = (value) => {
    if (!value) return '#f8fafc'
    const ratio = value / max
    if (ratio >= .8) return '#0f5d46'
    if (ratio >= .55) return '#2f8f6b'
    if (ratio >= .3) return '#75b99d'
    if (ratio >= .12) return '#b7dccb'
    return '#e2f1ea'
  }

  return (
    <motion.article className="sales-states-map-card" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .42, delay }}>
      <header>
        <div><span>Geographic demand</span><h3>Top States by Leads</h3><p>Distribution of leads across India</p></div>
        <b><strong>{total}</strong><small>Total Leads</small></b>
      </header>
      <div className="sales-states-map-body">
        <div className="sales-india-map" aria-label="Interactive India lead distribution map">
          <ComposableMap projection="geoMercator" projectionConfig={{ center: [82, 22], scale: 560 }} width={420} height={340}>
            <Geographies geography={indiaStatesGeoJson}>{({ geographies }) => geographies.map((geo) => {
              const key = normalizeState(geo.properties.ST_NM || geo.properties.st_nm || geo.properties.NAME_1)
              const value = stateValues[key] || 0
              const percentage = total ? ((value / total) * 100).toFixed(1) : '0.0'
              const details = { name: displayState(key), value, percentage }
              return <Geography key={geo.rsmKey} geography={geo} fill={colorForValue(value)} stroke="#d5e0dc" strokeWidth={.55} tabIndex={0} aria-label={`${displayState(key)}, ${value} leads, ${percentage}% of total`} onMouseEnter={(event) => showMapTooltip(event, details)} onMouseMove={(event) => showMapTooltip(event, details)} onMouseLeave={() => setHoveredState(null)} onFocus={() => setHoveredState(details)} onBlur={() => setHoveredState(null)} style={{ default: { outline: 'none' }, hover: { fill: '#0a7150', outline: 'none', cursor: 'pointer' }, pressed: { outline: 'none' } }} />
            })}</Geographies>
            {topRows.map((row) => markerCoordinates[row.key] && <Marker key={row.key} coordinates={markerCoordinates[row.key]}><circle r={9} className={rankByState[row.key] === 1 ? 'map-rank-first' : 'map-rank'} /><text y={3.2}>{rankByState[row.key]}</text></Marker>)}
          </ComposableMap>
          {hoveredState && <div className="sales-map-tooltip" style={hoveredState.x !== undefined ? { left: hoveredState.x, top: hoveredState.y } : undefined}><strong>{hoveredState.name}</strong><span>{hoveredState.value} Leads</span><small>{hoveredState.percentage}% of Total</small></div>}
          <div className="sales-map-scale"><span>Lead Count</span><i /><small><em>Low</em><em>High</em></small></div>
        </div>
        <div className="sales-state-ranking">
          {visibleRows.length ? visibleRows.map((row, index) => {
            const percent = Math.round((row.value / Math.max(total, 1)) * 100)
            return <div className="sales-state-rank-row" key={`${row.label}-${index}`}><i>{index < 6 ? index + 1 : <Users aria-hidden="true" />}</i><div><strong title={row.label}>{row.label}</strong><span><b style={{ width: `${Math.max(4, (row.value / max) * 100)}%` }} /></span></div><em>{row.value}</em><small>{percent}%</small></div>
          }) : <p className="sales-mix-empty">No state data available yet</p>}
        </div>
      </div>
      <footer><span><BarChart3 aria-hidden="true" />Data represents leads distribution by state</span><time>Live CRM data <RefreshCw aria-hidden="true" /></time></footer>
    </motion.article>
  )
}

function SalesLeadSourcesTable({ rows = [], total = 0, onView }) {
  return (
    <motion.section className="sales-source-table-card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
      <div className="sales-section-head"><div><Target className="h-4 w-4" /><strong>Lead Sources / Follow-up Analytics</strong></div><b>{total} leads</b></div>
      <div className="sales-source-table-wrap"><table><thead><tr><th>Lead Source</th><th>Leads</th><th>Share</th></tr></thead><tbody>
        {rows.length ? rows.map((row) => <tr key={row.label}><td><i style={{ background: row.color }} />{row.label}</td><td><strong>{row.value}</strong></td><td><div><span style={{ width: `${Math.max(3, Number(row.percent) || 0)}%`, background: row.color }} /></div><small>{row.percent}%</small></td></tr>) : <tr><td colSpan={3}><EmptyOperationState label="No lead source data found" /></td></tr>}
      </tbody></table></div>
      <button type="button" className="sales-donut-link" onClick={onView}>View Full Report <ArrowUpRight className="h-3.5 w-3.5" /></button>
    </motion.section>
  )
}

function SalesCommunicationTerms({ users = [], currentUser = {} }) {
  const rows = (users.length ? users : [currentUser]).filter(Boolean).slice(0, 5)
  return (
    <motion.section className="sales-communication-card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
      <div className="sales-section-head"><div><Mail className="h-4 w-4" /><strong>My Communication Terms</strong></div></div>
      <div className="sales-activity-table"><table><thead><tr><th>Mobile No.</th><th>OTP Status</th><th>Person Name</th><th>Designation</th><th>Mode</th><th>Verified</th><th>Status</th></tr></thead>
        <tbody>{rows.length ? rows.map((user, index) => <tr key={user._id || user.id || user.email || index}>
          <td>{user.mobile || user.phone || '-'}</td><td><span>OTP Verified</span></td><td>{user.name || user.email || 'CRM User'}</td><td>{roleLabels[user.role] || user.role || 'Sales'}</td><td>{user.communicationMode || 'Email'}</td><td><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /></td><td><span>Active</span></td>
        </tr>) : <tr><td colSpan={7}><EmptyOperationState label="No communication records" /></td></tr>}</tbody>
      </table></div>
    </motion.section>
  )
}

function SalesDashboard({ leads = [], quotations = [], clients = [], users = [], calendarItems = [], currentUser = {}, onOpenTodayLeads, onOpenSalesValue, onRefresh, refreshing = false }) {
  const navigate = useNavigate()
  const [reportModal, setReportModal] = useState(null)
  const [redFlagsExpanded, setRedFlagsExpanded] = useState(false)
  const [leadSourcePeriod, setLeadSourcePeriod] = useState(() => `months:m${new Date().getMonth()}`)
  const [quotationPeriod, setQuotationPeriod] = useState(() => `months:m${new Date().getMonth()}`)
  useEffect(() => {
    document.body.classList.add('sales-dashboard-page')
    return () => document.body.classList.remove('sales-dashboard-page')
  }, [])
  const scopedLeads = useMemo(() => getSalesVisibleRecords(leads, (lead) => leadBelongsToSalesUser(lead, currentUser)), [currentUser, leads])
  const scopedQuotations = useMemo(() => getSalesVisibleRecords(quotations, (quote) => quotationBelongsToSalesUser(quote, currentUser)), [currentUser, quotations])
  const periodLeads = useMemo(() => scopedLeads.filter((lead) => isDateInSalesPeriod(getLeadCreatedDate(lead), leadSourcePeriod)), [leadSourcePeriod, scopedLeads])
  const periodQuotations = useMemo(() => scopedQuotations.filter((quote) => isDateInSalesPeriod(getQuotationDate(quote), quotationPeriod)), [quotationPeriod, scopedQuotations])
  const todayLeads = useMemo(() => scopedLeads.filter((lead) => isTodayDate(getLeadCreatedDate(lead))), [scopedLeads])
  const salesComputed = useMemo(() => {
    const clientCompanyKeys = new Set(clients.map((client) => normalizeBusinessKey(getClientName(client))).filter(Boolean))
    const quotationValueByCompany = new Map()
    const quotationStatusCounts = new Map()
    let totalSalesValue = 0
    scopedQuotations.forEach((quote) => {
      const value = getQuotationValue(quote)
      const companyKey = normalizeBusinessKey(quote.leadDetails?.companyName || quote.companyName || '')
      if (companyKey) quotationValueByCompany.set(companyKey, (quotationValueByCompany.get(companyKey) || 0) + value)
      const status = getQuotationStatusBucket(quote)
      quotationStatusCounts.set(status, (quotationStatusCounts.get(status) || 0) + value)
      totalSalesValue += value
    })
    const leadValue = (lead) => quotationValueByCompany.get(normalizeBusinessKey(lead.company || lead.companyName || '')) || 0
    const stageBuckets = new Map(['New', 'Contacted', 'Qualified', 'Quotation', 'Negotiation', 'Won', 'Lost'].map((stage) => [stage, []]))
    scopedLeads.forEach((lead) => stageBuckets.get(getLeadPipelineStage(lead))?.push(lead))
    const pipeline = [...stageBuckets].map(([stage, stageLeads]) => ({
      stage,
      leads: stageLeads,
      value: stageLeads.reduce((sum, lead) => sum + leadValue(lead), 0)
    }))
    const activities = [
      ...scopedLeads.map((lead) => ({
        type: 'New Lead Created',
        lead: lead.company || lead.companyName || '-',
        owner: getLeadOwnerName(lead),
        stage: getLeadPipelineStage(lead),
        amount: leadValue(lead),
        date: getLeadCreatedDate(lead),
        nextStep: 'Call / qualify lead'
      })),
      ...scopedQuotations.map((quote) => ({
        type: 'Quotation Sent',
        lead: quote.leadDetails?.companyName || quote.companyName || '-',
        owner: getQuotationOwnerName(quote),
        stage: getQuotationStatusBucket(quote),
        amount: getQuotationValue(quote),
        date: getQuotationDate(quote),
        nextStep: getQuotationStatusBucket(quote) === 'Approved' ? 'Handover to operations' : 'Follow up'
      }))
    ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    return {
      convertedLeads: scopedLeads.filter((lead) => clientCompanyKeys.has(normalizeBusinessKey(lead.company || lead.companyName || ''))),
      quotationSent: scopedQuotations.filter((quote) => ['Sent', 'Opened', 'Replied', 'Approved'].includes(getQuotationStatusBucket(quote))),
      quotationApproved: scopedQuotations.filter((quote) => normalizeKey(quote.approvalStatus || quote.adminApproval || quote.status).includes('approve')),
      salesValue: totalSalesValue,
      pipelineRows: pipeline,
      revenueRows: ['Approved', 'Sent', 'Opened', 'Replied', 'Draft', 'Expired'].map((stage) => ({ stage, value: quotationStatusCounts.get(stage) || 0 })),
      recentQuotes: [...scopedQuotations].sort((a, b) => new Date(b.createdAt || b.updatedAt || 0) - new Date(a.createdAt || a.updatedAt || 0)).slice(0, 5),
      allActivities: activities,
      recentActivities: activities.slice(0, 6)
    }
  }, [clients, scopedLeads, scopedQuotations])
  const { convertedLeads, quotationSent, quotationApproved, pipelineRows, revenueRows, recentQuotes, allActivities, recentActivities } = salesComputed
  const leadSourceRows = useMemo(() => buildDistributionRows(
    periodLeads,
    (lead) => lead.source || lead.leadSource || 'Others',
    ['#0f9f83', '#45b8ad', '#8b5cf6', '#f59e0b', '#ef4444', '#9ca3af']
  ), [periodLeads])
  const quotationRows = useMemo(() => buildDistributionRows(
    periodQuotations,
    getQuotationStatusBucket,
    ['#0f9f83', '#2563eb', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6']
  ), [periodQuotations])
  const calendarFollowUps = useMemo(() => getCalendarFollowUpsForUser(currentUser, [...calendarItems, ...buildLeadFollowUpItems(leads)]), [calendarItems, currentUser, leads])
  const followUps = useMemo(() => {
    const open = calendarFollowUps.filter((item) => normalizeKey(item.status) !== 'completed')
    const completed = calendarFollowUps
      .filter((item) => normalizeKey(item.status) === 'completed')
      .sort((left, right) => `${right.scheduledDate || ''} ${right.scheduledTime || ''}`.localeCompare(`${left.scheduledDate || ''} ${left.scheduledTime || ''}`))
    return [...open, ...completed].slice(0, 5)
  }, [calendarFollowUps])
  const purchaseOrderRows = useMemo(() => {
    const records = []
    scopedLeads.forEach((lead) => {
      const company = getLeadCompanyName(lead) || 'Lead company'
      ;(lead.assignments || []).forEach((assignment) => {
        ;(assignment.poYearRows || []).forEach((row) => {
          if (!getPoValue(row.poNumber, row.poFileUrl, row.poAmount)) return
          records.push({ owner: getSalesRecordCreatorName(lead, users), company, poNumber: row.poNumber || '', fileUrl: row.poFileUrl || getFileUrl(row.poFile), amount: Number(row.poAmount || row.amount || 0), fy: row.fy || row.fyYear || '', source: 'Lead purchase order' })
        })
      })
    })
    scopedQuotations.forEach((quote) => {
      const purchaseOrder = quote.purchaseOrder && typeof quote.purchaseOrder === 'object' ? quote.purchaseOrder : {}
      const poNumber = getPoValue(quote.poNumber, quote.poNo, quote.purchaseOrderNo, purchaseOrder.number)
      const file = getPoValue(quote.poFileUrl, quote.poDocument, purchaseOrder.document, purchaseOrder.file)
      if (!poNumber && !file) return
      records.push({ owner: getSalesRecordCreatorName(quote, users), company: quote.leadDetails?.companyName || quote.companyName || 'Quotation company', poNumber, fileUrl: getFileUrl(file), amount: Number(quote.poAmount || purchaseOrder.amount || quote.grandTotal || 0), source: 'Quotation purchase order' })
    })
    const unique = new Map()
    records.forEach((row) => {
      const key = `${normalizeBusinessKey(row.company)}:${normalizeKey(row.poNumber) || row.fileUrl}`
      if (!unique.has(key)) unique.set(key, row)
    })
    return [...unique.values()].sort((left, right) => right.amount - left.amount)
  }, [scopedLeads, scopedQuotations, users])
  const metrics = [
    { label: 'Total Lead', value: scopedLeads.length, note: 'Assigned sales leads', icon: Users, tone: 'teal' },
    { label: 'Quotation Sent', value: quotationSent.length, note: 'Sent / opened / replied', icon: FileText, tone: 'blue' },
    { label: 'Converted Lead', value: convertedLeads.length, note: 'Lead converted in Client Master', icon: TrendingUp, tone: 'orange' },
    { label: 'Today Lead', value: todayLeads.length, note: 'Generated today', icon: CalendarDays, tone: 'pink', onClick: onOpenTodayLeads }
  ]

  const salesMixAnalytics = useMemo(() => {
    const firstValue = (record, keys, fallback = 'Others') => {
      for (const key of keys) {
        const value = key.split('.').reduce((next, part) => next?.[part], record)
        if (Array.isArray(value) && value.length) return value.join(', ')
        if (String(value || '').trim()) return String(value).trim()
      }
      return fallback
    }
    const distribution = (records, keys, limit = 6) => {
      const counts = new Map()
      records.forEach((record) => {
        const raw = firstValue(record, keys)
        const values = raw.split(/[,|/]+/).map((value) => value.trim()).filter(Boolean)
        ;(values.length ? values : ['Others']).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1))
      })
      const sorted = [...counts].sort((a, b) => b[1] - a[1])
      const shown = sorted.slice(0, limit)
      const remainder = sorted.slice(limit).reduce((sum, [, value]) => sum + value, 0)
      if (remainder) shown.push(['Others', remainder])
      return shown.map(([label, value]) => ({ label, value }))
    }
    const serviceRows = scopedLeads.flatMap((lead) => (
      Array.isArray(lead.serviceSelections) && lead.serviceSelections.length
        ? lead.serviceSelections.map((service) => ({ lead, service: service || {} }))
        : [{ lead, service: lead }]
    ))
    const serviceDistribution = (getValue) => {
      const counts = new Map()
      serviceRows.forEach(({ lead, service }) => {
        const label = String(getValue(service, lead) || '').trim() || 'Not specified'
        counts.set(label, (counts.get(label) || 0) + 1)
      })
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([label, value]) => ({ label, value }))
    }
    return {
      industries: distribution(scopedLeads, ['industry', 'industryType', 'businessType', 'sector', 'companyIndustry']),
      subApplicantTypes: serviceDistribution((service, lead) => service.subApplicantType || service.piboCategory || lead.subApplicantType || lead.piboCategory),
      services: serviceDistribution((service, lead) => service.servicesOffered || service.serviceOffered || service.applicableService || service.eprCategory || lead.servicesOffered || lead.serviceOffered || lead.applicableService || lead.eprCategory),
      states: distribution(scopedLeads, ['state', 'address.state', 'registeredState', 'companyState', 'location.state']),
      workload: distribution(scopedLeads, ['assignedToName', 'ownerName', 'createdByName', 'referredBy', 'assignedTo.name'], 8),
    }
  }, [scopedLeads])

  return (
    <motion.div
      className="sales-dashboard"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="sales-hero">
        <div>
          <p className="operations-eyebrow">Sales command center</p>
          <h1>Sales Dashboard</h1>
          <p>Real-time overview of your sales pipeline and performance.</p>
        </div>
        <div className="sales-hero-actions">
          <button type="button" onClick={onRefresh} disabled={refreshing} aria-label="Refresh Sales Dashboard">
            <RefreshCw className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="sales-metric-grid">
        {metrics.map((metric, index) => <SalesMetricCard key={metric.label} metric={metric} index={index} />)}
      </div>

      <SalesRiskStrip items={calendarFollowUps} expanded={redFlagsExpanded} onView={() => setRedFlagsExpanded((value) => !value)} />

      <AnimatePresence initial={false}>
        {redFlagsExpanded && <motion.div id="sales-red-flag-details" className="sales-red-flag-expand" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: .38, ease: [0.22, 1, 0.36, 1] }}><RedFlagAuditSection items={calendarFollowUps} users={users} title="Sales Red Flag & Missed Follow-ups" /></motion.div>}
      </AnimatePresence>

      <div className="sales-reference-top-grid">
        <SalesAnalyticsBars title="Applicant Type" subtitle="Applicant distribution" rows={salesMixAnalytics.subApplicantTypes} tone="teal" delay={.04} initialLimit={7} />
        <SalesAnalyticsBars title="Top Industries" subtitle="Industry concentration" rows={salesMixAnalytics.industries} tone="teal" delay={.08} />
        <SalesStatesMapCard rows={salesMixAnalytics.states} delay={.1} />
      </div>

      <div className="sales-reference-middle-grid">
        <SalesLeadBreakdownTable rows={buildSalesLeadMatrixRows(scopedLeads)} />
        <SalesFollowUps
          leads={followUps}
          onCalendar={() => navigate('/calendar')}
          onView={() => setReportModal({
            title: 'Follow-ups',
            subtitle: `${calendarFollowUps.length} calendar follow-up records`,
            columns: ['Date', 'Time', 'Title', 'Company', 'Owner', 'Priority', 'Status'],
            rows: calendarFollowUps.map((item) => [
              formatShortDate(item.scheduledDate),
              item.scheduledTime || 'No time',
              displayValue(item.title, '-'),
              getCalendarFollowUpCompany(item),
              getCalendarFollowUpOwner(item),
              displayValue(item.priority, 'Medium'),
              displayValue(item.status, 'open')
            ]),
            actionLabel: 'Open Calendar',
            onAction: () => navigate('/calendar')
          })}
        />
      </div>

      <div className="sales-reference-analytics-grid">
        <SalesLeadSourcesTable rows={leadSourceRows} total={periodLeads.length} onView={() => setReportModal({ title: 'Lead Sources', subtitle: `${periodLeads.length} leads in selected period`, columns: ['Referred By', 'Date', 'Lead Source', 'Company'], rows: periodLeads.map((lead) => [getLeadOwnerName(lead), formatShortDate(getLeadCreatedDate(lead)), lead.source || lead.leadSource || '-', getLeadCompanyName(lead) || '-']) })} />
        <SalesDonutCard title="Quotation Status" total={periodQuotations.length} centerLabel="Total Quotations" rows={quotationRows} actionLabel="View All Quotations" icon={FileCheck2} period={quotationPeriod} onPeriodChange={setQuotationPeriod} onView={() => navigate('/sales/quotations')} pie />
      </div>

      <SalesPurchaseOrderTable rows={purchaseOrderRows} />

      <div className="sales-reference-bottom-grid sales-reference-bottom-single">
        <SalesRecentActivity
          rows={recentActivities}
          onView={() => setReportModal({
            title: 'Recent Sales Activity',
            subtitle: `${allActivities.length} activity records`,
            columns: ['Date & Time', 'Activity', 'Lead / Account', 'Owner', 'Stage', 'Next Step'],
            rows: allActivities.map((row) => [formatDateTime(row.date), row.type, row.lead, row.owner, row.stage, row.nextStep])
          })}
        />
      </div>

      <AnimatePresence>
        {reportModal && <SalesReportModal report={reportModal} onClose={() => setReportModal(null)} />}
      </AnimatePresence>
    </motion.div>
  )
}

function SalesLeadBreakdownTable({ rows = [] }) {
  const sourceColumns = ['Existing Client', 'TeleCalling', 'Physical Visit', 'Referral', 'Web Database', 'Campaign']

  return (
    <motion.section className="sales-lead-breakdown-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.36, delay: 0.08 }}>
      <div className="sales-section-head">
        <div><ListChecks className="h-4 w-4" /><strong>Lead Generated by Source</strong></div>
        <p>{rows.length} sales users</p>
      </div>
      <div className="sales-lead-breakdown-wrap">
        <table className="sales-lead-breakdown-table">
          <colgroup><col className="sales-lead-owner-column" />{sourceColumns.map((mode) => <col key={mode} />)}<col /></colgroup>
          <thead>
            <tr><th>Lead Generated By</th>{sourceColumns.map((mode) => <th key={mode}>{mode}</th>)}<th>Total</th></tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row, index) => (
              <tr key={row.key}>
                <td><div className="sales-lead-owner-cell">{index < 3 && <i className={`sales-owner-rank rank-${index + 1}`}>{index + 1}</i>}<strong>{row.owner}</strong></div></td>
                {sourceColumns.map((mode) => <td key={mode}>{row.communication[mode] || 0}</td>)}
                <td><b>{row.total}</b></td>
              </tr>
            )) : (
              <tr><td colSpan={sourceColumns.length + 2}><EmptyOperationState label="No lead source records found" /></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </motion.section>
  )
}

function SalesMetricCard({ metric, index = 0 }) {
  const Icon = metric.icon
  const isNumberValue = typeof metric.value === 'number'
  const animatedValue = useAnimatedNumber(isNumberValue ? metric.value : 0)
  const displayValue = isNumberValue ? (metric.formatter ? metric.formatter(animatedValue) : animatedValue) : metric.value
  const content = (
    <>
      <span><Icon className="h-5 w-5" /></span>
      <div>
        <p>{metric.label}</p>
        <strong>{displayValue}</strong>
        <small>{metric.note}</small>
      </div>
      <div className="sales-metric-spark" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
    </>
  )
  if (metric.onClick) {
    return (
      <motion.button
        type="button"
        onClick={metric.onClick}
        className={`sales-metric-card sales-metric-${metric.tone}`}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, delay: index * 0.045 }}
        whileHover={{ y: -4, scale: 1.01 }}
        whileTap={{ scale: 0.985 }}
      >
        {content}
      </motion.button>
    )
  }
  return (
    <motion.article
      className={`sales-metric-card sales-metric-${metric.tone}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: index * 0.045 }}
      whileHover={{ y: -4, scale: 1.01 }}
    >
    {content}
  </motion.article>
  )
}

function SalesPipelineBoard({ rows = [], quotations = [] }) {
  return (
    <motion.section className="sales-pipeline-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.36, delay: 0.12 }}>
      <div className="sales-section-head">
        <div><Target className="h-4 w-4" /><strong>Lead Pipeline</strong></div>
        <p>{rows.reduce((sum, row) => sum + row.leads.length, 0)} leads across sales stages</p>
      </div>
      <div className="sales-pipeline-board">
        {rows.map((row, index) => (
          <motion.div key={row.stage} className="sales-pipeline-column" style={{ '--stage-color': ['#06b6d4', '#10b981', '#8b5cf6', '#f59e0b', '#14b8a6', '#22c55e', '#ef4444'][index] }} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.18 + index * 0.035 }}>
            <div className="sales-pipeline-column-head">
              <strong>{row.stage}</strong>
              <span>{row.leads.length} Leads</span>
            </div>
            <div className="sales-pipeline-leads">
              {row.leads.slice(0, 3).map((lead, leadIndex) => {
                const amount = getLeadSalesValue(lead, quotations)
                return (
                  <motion.article key={lead._id || lead.id || leadIndex} className="sales-pipeline-lead" whileHover={{ y: -3 }}>
                    <strong>{lead.company || lead.companyName || 'Lead'}</strong>
                    <span>{formatDashboardInr(amount)}</span>
                    <small>{(lead.company || 'LD').slice(0, 2).toUpperCase()}</small>
                  </motion.article>
                )
              })}
              {!row.leads.length && <div className="sales-pipeline-empty">No leads</div>}
            </div>
            {row.leads.length > 3 && <button type="button" className="sales-pipeline-more">+ {row.leads.length - 3} more</button>}
          </motion.div>
        ))}
      </div>
    </motion.section>
  )
}

function SalesRevenueForecast({ rows = [], totalValue = 0 }) {
  const activeRows = rows.filter((row) => row.value > 0)
  const chartColors = ['#22c55e', '#f59e0b', '#8b5cf6', '#3b82f6', '#ef4444', '#14b8a6', '#64748b']
  const chartRows = activeRows.map((row, index) => ({
    name: row.stage,
    value: row.value,
    color: chartColors[index % chartColors.length]
  }))
  return (
    <motion.section className="sales-revenue-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.36, delay: 0.16 }}>
      <div className="sales-section-head">
        <div><TrendingUp className="h-4 w-4" /><strong>Revenue Forecast</strong></div>
        <select value="quarter" onChange={() => {}} aria-label="Revenue period"><option value="quarter">This Quarter</option></select>
      </div>
      <div className="sales-revenue-total">
        <span>Forecasted Revenue</span>
        <strong>{formatDashboardInr(totalValue)}</strong>
        <em>Live quotation value</em>
      </div>
      <div className="sales-revenue-chart">
        {chartRows.length ? (
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={chartRows} margin={{ top: 12, right: 10, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#e7f0ee" strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#64748b', fontSize: 11, fontWeight: 800 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 800 }} tickFormatter={(value) => formatDashboardInr(value)} />
              <Tooltip
                cursor={{ fill: 'rgba(15, 118, 110, 0.07)' }}
                formatter={(value) => [formatDashboardInr(value), 'Value']}
                contentStyle={{ border: '1px solid #d8e7e4', borderRadius: 12, boxShadow: '0 14px 34px rgba(15, 23, 42, 0.12)', fontWeight: 800 }}
              />
              <Bar dataKey="value" radius={[10, 10, 3, 3]} animationDuration={950} animationEasing="ease-out">
                {chartRows.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyOperationState label="No revenue forecast yet" />
        )}
      </div>
      <div className="sales-revenue-stack">
        {(activeRows.length ? activeRows : rows.slice(0, 4)).map((row, index) => (
          <span key={row.stage} style={{ width: `${percent(row.value, totalValue) || (activeRows.length ? 0 : 25)}%`, background: ['#22c55e', '#f59e0b', '#8b5cf6', '#3b82f6', '#ef4444'][index % 5] }} />
        ))}
      </div>
      <div className="sales-revenue-list">
        {(activeRows.length ? activeRows : rows.slice(0, 4)).map((row) => (
          <div key={row.stage}>
            <span>{row.stage}</span>
            <strong>{formatDashboardInr(row.value)}</strong>
          </div>
        ))}
      </div>
    </motion.section>
  )
}

function SalesFollowUps({ leads = [], onView, onCalendar }) {
  const visibleFollowUps = leads.slice(0, 5)
  return (
    <motion.section className="sales-follow-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.36, delay: 0.2 }}>
      <div className="sales-section-head">
        <div><CalendarDays className="h-4 w-4" /><strong>Follow-ups</strong></div>
        <button type="button" onClick={onCalendar}>View Calendar</button>
      </div>
      <div className="sales-follow-list">
        {visibleFollowUps.length ? visibleFollowUps.map((lead, index) => {
          const followDate = lead.scheduledDate || getLeadCreatedDate(lead) || Date.now()
          const followTitle = lead.title || `Follow up with ${lead.company || lead.companyName || 'Lead'}`
          const company = getCalendarFollowUpCompany(lead)
          const owner = getCalendarFollowUpOwner(lead)
          const initials = owner.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'SM'
          const priority = lead.priority || (index < 2 ? 'High' : index < 4 ? 'Medium' : 'Low')
          const completed = normalizeKey(lead.status) === 'completed'
          const badge = completed ? 'Completed' : priority
          return (
          <motion.article key={lead._id || lead.id || index} className="sales-follow-item" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.28, delay: index * 0.035 }} whileHover={{ x: 4 }}>
            <time><strong>{String(new Date(followDate).getDate()).padStart(2, '0')}</strong><span>{new Intl.DateTimeFormat('en', { month: 'short' }).format(new Date(followDate))}</span></time>
            <div>
              <strong>{followTitle}</strong>
              <span>{company}</span>
            </div>
            <small>{initials}</small>
            <em className={completed ? 'sales-follow-status-completed' : `sales-follow-priority-${String(priority).toLowerCase()}`}>{badge}</em>
          </motion.article>
          )
        }) : <EmptyOperationState label="No follow-ups found" />}
      </div>
      <button type="button" className="sales-donut-link" onClick={onView}>View All Follow-ups <ArrowUpRight className="h-3.5 w-3.5" /></button>
    </motion.section>
  )
}

function SalesPurchaseOrderFlatTable({ rows = [] }) {
  const totalValue = rows.reduce((sum, row) => sum + row.amount, 0)
  return (
    <motion.section className="sales-po-card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
      <div className="sales-section-head"><div><FileCheck2 className="h-4 w-4" /><strong>Purchase Orders</strong></div><p>{rows.length} PO records · {formatDashboardInr(totalValue)}</p></div>
      <div className="sales-po-table-wrap"><table><thead><tr><th>Company Name</th><th>PO Number</th><th>PO Upload</th><th>Total PO</th></tr></thead><tbody>
        {rows.length ? rows.map((row, index) => <tr key={`${row.company}-${row.poNumber}-${index}`}><td><strong>{row.company}</strong><small>{row.fy || row.source || 'Sales PO'}</small></td><td>{row.poNumber || '-'}</td><td>{row.fileUrl ? <a href={row.fileUrl} target="_blank" rel="noreferrer"><Eye aria-hidden="true" />View PO</a> : <span className="sales-po-pending">Not uploaded</span>}</td><td><strong>{formatDashboardInr(row.amount)}</strong></td></tr>) : <tr><td colSpan={4}><EmptyOperationState label="No purchase orders found" /></td></tr>}
      </tbody></table></div>
    </motion.section>
  )
}

function SalesPurchaseOrderTable({ rows = [] }) {
  const [expandedOwner, setExpandedOwner] = useState('')
  const ownerGroups = Object.values(rows.reduce((groups, row) => {
    const owner = row.owner || 'Unassigned'
    const key = normalizeKey(owner) || 'unassigned'
    if (!groups[key]) groups[key] = { key, owner, rows: [] }
    groups[key].rows.push(row)
    return groups
  }, {})).sort((left, right) => right.rows.length - left.rows.length || left.owner.localeCompare(right.owner))
  return (
    <motion.section className="sales-po-card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
      <div className="sales-section-head"><div><FileCheck2 className="h-4 w-4" /><strong>Purchase Orders by Created By</strong></div><p>{rows.length} PO records</p></div>
      <div className="sales-po-owner-list">{ownerGroups.length ? ownerGroups.map((group) => {
        const open = expandedOwner === group.key
        const initials = group.owner.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'NA'
        return <section className="sales-po-owner" key={group.key}><button type="button" aria-expanded={open} onClick={() => setExpandedOwner((current) => current === group.key ? '' : group.key)}><i>{initials}</i><span><strong>{group.owner}</strong><small>{group.rows.length} purchase order{group.rows.length === 1 ? '' : 's'}</small></span><em>{group.rows.length} PO</em><ChevronDown aria-hidden="true" /></button><AnimatePresence initial={false}>{open && <motion.div className="sales-po-table-wrap" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: .28 }}><table><thead><tr><th>Company Name</th><th>PO Number</th><th>PO Upload</th></tr></thead><tbody>{group.rows.map((row, index) => <tr key={`${row.company}-${row.poNumber}-${index}`}><td><strong>{row.company}</strong><small>{row.fy || row.source || 'Sales PO'}</small></td><td>{row.poNumber || '-'}</td><td>{row.fileUrl ? <a href={row.fileUrl} target="_blank" rel="noreferrer"><Eye aria-hidden="true" />View PO</a> : <span className="sales-po-pending">Not uploaded</span>}</td></tr>)}</tbody></table></motion.div>}</AnimatePresence></section>
      }) : <EmptyOperationState label="No purchase orders found" />}</div>
    </motion.section>
  )
}

function SalesRecentActivity({ rows = [], onView }) {
  return (
    <motion.section className="sales-recent-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.36, delay: 0.24 }}>
      <div className="sales-section-head">
        <div><Clock3 className="h-4 w-4" /><strong>Recent Sales Activity</strong></div>
        <button type="button" onClick={onView}>View All Activities</button>
      </div>
      <div className="sales-activity-table">
        <table>
          <thead>
            <tr><th>Date & Time</th><th>Activity</th><th>Lead / Account</th><th>Owner</th><th>Stage</th><th>Next Step</th></tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row, index) => (
              <tr key={`${row.type}-${index}`}>
                <td>{formatDateTime(row.date)}</td>
                <td>{row.type}</td>
                <td>{row.lead}</td>
                <td>{row.owner}</td>
                <td><span>{row.stage}</span></td>
                <td>{row.nextStep}</td>
              </tr>
            )) : <tr><td colSpan={6}><EmptyOperationState label="No recent sales activity" /></td></tr>}
          </tbody>
        </table>
      </div>
    </motion.section>
  )
}

function SalesDonutCard({ title, total, centerLabel, rows = [], actionLabel, icon: Icon, onView, period = 'q1', onPeriodChange, pie = false }) {
  const [showAllRows, setShowAllRows] = useState(false)
  const [monthMenuOpen, setMonthMenuOpen] = useState(false)
  const monthMenuRef = useRef(null)
  const chartRows = rows.length ? rows : [{ label: 'No data', value: 1, color: '#e2e8f0', percent: '0.0' }]
  const visibleRows = showAllRows ? rows : rows.slice(0, 5)
  const currentYear = new Date().getFullYear()
  const currentMonth = new Date().getMonth()
  const periodValue = String(period)
  const periodMode = periodValue.startsWith('months:') || periodValue.startsWith('m') ? 'month' : periodValue.startsWith('y') ? 'year' : 'quarter'
  const monthOptions = [
    ['m0', 'Jan'],
    ['m1', 'Feb'],
    ['m2', 'Mar'],
    ['m3', 'Apr'],
    ['m4', 'May'],
    ['m5', 'Jun'],
    ['m6', 'Jul'],
    ['m7', 'Aug'],
    ['m8', 'Sep'],
    ['m9', 'Oct'],
    ['m10', 'Nov'],
    ['m11', 'Dec']
  ]
  const yearOptions = Array.from({ length: 5 }, (_, index) => currentYear - index)
  const selectedMonths = periodValue.startsWith('months:')
    ? periodValue.replace('months:', '').split(',').filter(Boolean)
    : periodValue.startsWith('m')
      ? [periodValue]
      : []
  const selectedMonthLabel = selectedMonths.length
    ? monthOptions
      .filter(([value]) => selectedMonths.includes(value))
      .map(([, label]) => label)
      .join(', ')
    : 'Select months'

  useEffect(() => {
    if (!monthMenuOpen) return undefined
    function handlePointerDown(event) {
      if (monthMenuRef.current && !monthMenuRef.current.contains(event.target)) {
        setMonthMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [monthMenuOpen])

  function changePeriodMode(nextMode) {
    if (nextMode === 'month') onPeriodChange?.(`months:m${currentMonth}`)
    else if (nextMode === 'year') onPeriodChange?.(`y${currentYear}`)
    else onPeriodChange?.('q1')
  }

  function toggleMonth(monthValue) {
    const nextMonths = selectedMonths.includes(monthValue)
      ? selectedMonths.filter((value) => value !== monthValue)
      : [...selectedMonths, monthValue]
    const orderedMonths = monthOptions.map(([value]) => value).filter((value) => nextMonths.includes(value))
    onPeriodChange?.(`months:${orderedMonths.join(',')}`)
  }

  return (
    <motion.section
      className={`sales-donut-card sales-donut-card-animated${pie ? ' sales-pie-card' : ''}`}
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: false, amount: 0.42 }}
      transition={{ duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -3 }}
    >
      <div className="sales-donut-head">
        <div><Icon className="h-4 w-4" /><strong>{title}</strong></div>
        <div className="sales-period-controls">
          <select value={periodMode} onChange={(event) => changePeriodMode(event.target.value)} aria-label={`${title} period type`}>
            <option value="quarter">Quarter</option>
            <option value="month">Month</option>
            <option value="year">Year</option>
          </select>
          {periodMode === 'quarter' && (
            <select value={period} onChange={(event) => onPeriodChange?.(event.target.value)} aria-label={`${title} quarter`}>
              <option value="q1">Q1 Apr-Jun</option>
              <option value="q2">Q2 Jul-Sep</option>
              <option value="q3">Q3 Oct-Dec</option>
              <option value="q4">Q4 Jan-Mar</option>
            </select>
          )}
          {periodMode === 'month' && (
            <div className="sales-month-dropdown" ref={monthMenuRef}>
              <button
                type="button"
                className="sales-month-trigger"
                aria-label={`${title} months`}
                aria-expanded={monthMenuOpen}
                onClick={() => setMonthMenuOpen((open) => !open)}
              >
                <span>{selectedMonthLabel}</span>
                <span>{selectedMonths.length ? `${selectedMonths.length}` : ''}</span>
              </button>
              {monthMenuOpen && (
                <div className="sales-month-menu">
                  {monthOptions.map(([value, label]) => (
                    <label key={value} className="sales-month-option">
                      <input
                        type="checkbox"
                        checked={selectedMonths.includes(value)}
                        onChange={() => toggleMonth(value)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          {periodMode === 'year' && (
            <select value={period} onChange={(event) => onPeriodChange?.(event.target.value)} aria-label={`${title} year`}>
              {yearOptions.map((year) => <option key={year} value={`y${year}`}>{year}</option>)}
            </select>
          )}
        </div>
      </div>
      <div className="sales-donut-body">
        <div className="sales-rechart-donut">
          <ResponsiveContainer width="100%" height={184}>
            <RechartsPieChart>
              <Pie
                key={`${title}-${period}-${chartRows.map((row) => `${row.label}:${row.value}`).join('|')}`}
                data={chartRows}
                dataKey="value"
                nameKey="label"
                innerRadius={pie ? 0 : 54}
                outerRadius={80}
                paddingAngle={rows.length > 1 ? 3 : 0}
                stroke="none"
                animationBegin={140}
                animationDuration={1250}
                animationEasing="ease-out"
                startAngle={450}
                endAngle={90}
                label={pie && rows.length ? ({ percent: slicePercent }) => `${Math.round((slicePercent || 0) > 1 ? slicePercent : (slicePercent || 0) * 100)}%` : false}
                labelLine={false}
              >
                {chartRows.map((row) => <Cell key={row.label} fill={row.color} />)}
              </Pie>
            </RechartsPieChart>
          </ResponsiveContainer>
          {!pie && <div className="sales-chart-center"><strong>{total}</strong><span>{centerLabel}</span></div>}
        </div>
        <div className="sales-donut-legend">
          {rows.length ? visibleRows.map((row, index) => (
            <div key={row.label} style={{ '--legend-index': index }}>
              <span style={{ background: row.color }} />
              <p>{row.label}</p>
              <strong>{row.value}</strong>
              <small>({row.percent}%)</small>
            </div>
          )) : <EmptyOperationState label="No data found" />}
          {rows.length > 5 && (
            <button type="button" className="sales-donut-show-more" onClick={() => setShowAllRows((value) => !value)}>
              {showAllRows ? 'Show less' : `Show more (${rows.length - 5})`}
            </button>
          )}
        </div>
      </div>
      <button type="button" className="sales-donut-link" onClick={onView}>{actionLabel} <ArrowUpRight className="h-3.5 w-3.5" /></button>
    </motion.section>
  )
}

function SalesReportModal({ report = {}, onClose }) {
  const rows = Array.isArray(report.rows) ? report.rows : []
  const columns = Array.isArray(report.columns) ? report.columns : []
  const rowsPerPage = 10
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage))
  const visibleRows = rows.slice((page - 1) * rowsPerPage, page * rowsPerPage)

  useEffect(() => { setPage(1) }, [report.title, rows.length])
  return (
    <motion.div className="operations-modal-backdrop" role="presentation" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="sales-report-modal"
        role="dialog"
        aria-modal="true"
        aria-label={report.title || 'Sales Report'}
        onClick={(event) => event.stopPropagation()}
        initial={{ opacity: 0, y: 28, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.98 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="sales-today-modal-head">
          <div>
            <span>Sales Report</span>
            <h3>{report.title || 'Report'}</h3>
            <p>{report.subtitle || `${rows.length} records`}</p>
          </div>
          <div className="sales-report-modal-actions">
            {report.actionLabel && (
              <button type="button" className="sales-report-primary-action" onClick={() => { onClose(); report.onAction?.(); }}>
                <CalendarDays className="h-4 w-4" />
                {report.actionLabel}
              </button>
            )}
            <button type="button" className="sales-report-close-action" onClick={onClose} aria-label="Close Sales Report"><X className="h-5 w-5" /></button>
          </div>
        </div>
        <div className="sales-report-table">
          <table>
            <thead>
              <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
            </thead>
            <tbody>
              {visibleRows.length ? visibleRows.map((row, rowIndex) => {
                const absoluteIndex = (page - 1) * rowsPerPage + rowIndex
                return (
                <tr key={absoluteIndex}>
                  {row.map((cell, cellIndex) => <td key={`${absoluteIndex}-${cellIndex}`}>{cell}</td>)}
                </tr>
                )
              }) : <tr><td colSpan={columns.length || 1}><EmptyOperationState label="No records found" /></td></tr>}
            </tbody>
          </table>
        </div>
        {rows.length > rowsPerPage && (
          <div className="sales-report-pagination">
            <div><strong>{(page - 1) * rowsPerPage + 1}-{Math.min(page * rowsPerPage, rows.length)}</strong><span>of {rows.length} records</span></div>
            <span>Page {page} of {totalPages}</span>
            <div className="sales-report-pagination-actions">
              <button type="button" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
              <button type="button" disabled={page === totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

function useAnimatedNumber(value = 0) {
  const [displayValue, setDisplayValue] = useState(0)

  useEffect(() => {
    let frameId = 0
    const startTime = performance.now()
    const duration = 760

    function tick(now) {
      const progress = Math.min((now - startTime) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplayValue(Math.round(value * eased))
      if (progress < 1) frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [value])

  return displayValue
}

function TodayLeadsModal({ leads = [], onClose }) {
  return (
    <motion.div className="operations-modal-backdrop" role="presentation" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="sales-today-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Today Lead Details"
        onClick={(event) => event.stopPropagation()}
        initial={{ opacity: 0, y: 28, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.98 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="sales-today-modal-head">
          <div>
            <span>Today Lead</span>
            <h3>Lead Generated Today</h3>
            <p>{leads.length} lead records</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close Today Lead Popup"><X className="h-5 w-5" /></button>
        </div>
        <div className="sales-today-table">
          <table>
            <thead>
              <tr><th>Company Name</th><th>Referred By</th><th>Date</th><th>Lead Source</th></tr>
            </thead>
            <tbody>
              {leads.length ? leads.map((lead, index) => (
                <tr key={lead._id || lead.id || index}>
                  <td>{getLeadCompanyName(lead) || '-'}</td>
                  <td>{getLeadOwnerName(lead)}</td>
                  <td>{formatShortDate(getLeadCreatedDate(lead))}</td>
                  <td>{lead.source || lead.leadSource || '-'}</td>
                </tr>
              )) : <tr><td colSpan={4}><EmptyOperationState label="No lead generated today" /></td></tr>}
            </tbody>
          </table>
        </div>
      </motion.div>
    </motion.div>
  )
}

function SalesValueModal({ quotations = [], onClose }) {
  const [openGroupKey, setOpenGroupKey] = useState('')
  const groups = useMemo(() => buildSalesValueGroups(quotations), [quotations])
  const totalValue = groups.reduce((sum, group) => sum + group.totalValue, 0)

  return (
    <motion.div className="operations-modal-backdrop" role="presentation" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="sales-value-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Sales Value Details"
        onClick={(event) => event.stopPropagation()}
        initial={{ opacity: 0, y: 28, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.98 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="sales-value-drawer-head sales-value-modal-head">
          <div>
            <span>Sales Value</span>
            <h3>{formatDashboardInr(totalValue)}</h3>
            <p>User wise monthly quotation value</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close Sales Value Popup"><X className="h-5 w-5" /></button>
        </div>

        <div className="sales-value-summary">
          <div><span>Users</span><strong>{new Set(groups.map((group) => group.userName)).size}</strong></div>
          <div><span>Months</span><strong>{new Set(groups.map((group) => group.month)).size}</strong></div>
          <div><span>Quotations</span><strong>{quotations.length}</strong></div>
        </div>

        <div className="sales-value-table-wrap">
          <table className="sales-value-table">
            <thead>
              <tr><th>User Name</th><th>Month</th><th>Total Value</th></tr>
            </thead>
            <tbody>
              {groups.length ? groups.map((group) => {
                const open = openGroupKey === group.key
                return (
                  <React.Fragment key={group.key}>
                    <tr>
                      <td>
                        <button type="button" className="sales-value-user-toggle" onClick={() => setOpenGroupKey(open ? '' : group.key)}>
                          <span>{open ? '-' : '+'}</span>
                          <strong>{group.userName}</strong>
                        </button>
                      </td>
                      <td>{group.month}</td>
                      <td>{formatDashboardInr(group.totalValue)}</td>
                    </tr>
                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.tr className="sales-value-detail-row" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                          <td colSpan={3}>
                            <table>
                              <thead>
                                <tr><th>Client Name</th><th>Date</th><th>Sales Value</th></tr>
                              </thead>
                              <tbody>
                                {group.quotations.map((quote, index) => (
                                  <tr key={quote._id || quote.id || index}>
                                    <td>{quote.leadDetails?.companyName || quote.companyName || 'Client'}</td>
                                    <td>{formatShortDate(getQuotationDate(quote))}</td>
                                    <td>{formatDashboardInr(quote.__salesValue)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </motion.tr>
                      )}
                    </AnimatePresence>
                  </React.Fragment>
                )
              }) : <tr><td colSpan={3}><EmptyOperationState label="No sales value found" /></td></tr>}
            </tbody>
          </table>
        </div>
      </motion.div>
    </motion.div>
  )
}

function SalesValueDrawer({ quotations = [], onClose }) {
  const [openGroupKey, setOpenGroupKey] = useState('')
  const groups = useMemo(() => buildSalesValueGroups(quotations), [quotations])
  const totalValue = groups.reduce((sum, group) => sum + group.totalValue, 0)

  return (
    <motion.div className="sales-drawer-backdrop" role="presentation" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.aside
        className="sales-value-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Sales Value Details"
        onClick={(event) => event.stopPropagation()}
        initial={{ x: 56, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 42, opacity: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="sales-value-drawer-head">
          <div>
            <span>Sales Value</span>
            <h3>{formatDashboardInr(totalValue)}</h3>
            <p>User wise monthly quotation value</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close Sales Value Drawer"><X className="h-5 w-5" /></button>
        </div>

        <div className="sales-value-summary">
          <div><span>Users</span><strong>{new Set(groups.map((group) => group.userName)).size}</strong></div>
          <div><span>Months</span><strong>{new Set(groups.map((group) => group.month)).size}</strong></div>
          <div><span>Quotations</span><strong>{quotations.length}</strong></div>
        </div>

        <div className="sales-value-table-wrap">
          <table className="sales-value-table">
            <thead>
              <tr><th>User Name</th><th>Month</th><th>Total Value</th></tr>
            </thead>
            <tbody>
              {groups.length ? groups.map((group) => {
                const open = openGroupKey === group.key
                return (
                  <React.Fragment key={group.key}>
                    <tr>
                      <td>
                        <button type="button" className="sales-value-user-toggle" onClick={() => setOpenGroupKey(open ? '' : group.key)}>
                          <span>{open ? '-' : '+'}</span>
                          <strong>{group.userName}</strong>
                        </button>
                      </td>
                      <td>{group.month}</td>
                      <td>{formatDashboardInr(group.totalValue)}</td>
                    </tr>
                    <AnimatePresence initial={false}>
                      {open && (
                      <motion.tr className="sales-value-detail-row" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <td colSpan={3}>
                          <table>
                            <thead>
                              <tr><th>Client Name</th><th>Date</th><th>Sales Value</th></tr>
                            </thead>
                            <tbody>
                              {group.quotations.map((quote, index) => (
                                <tr key={quote._id || quote.id || index}>
                                  <td>{quote.leadDetails?.companyName || quote.companyName || 'Client'}</td>
                                  <td>{formatShortDate(getQuotationDate(quote))}</td>
                                  <td>{formatDashboardInr(quote.__salesValue)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </motion.tr>
                      )}
                    </AnimatePresence>
                  </React.Fragment>
                )
              }) : <tr><td colSpan={3}><EmptyOperationState label="No sales value found" /></td></tr>}
            </tbody>
          </table>
        </div>
      </motion.aside>
    </motion.div>
  )
}

export default function AdminDashboard() {
  const [currentUser, setCurrentUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null') } catch { return null }
  })
  const [users, setUsers] = useState([])
  const [teams, setTeams] = useState([])
  const [availableRoles, setAvailableRoles] = useState(() => defaultRoles.map((name) => ({ name, label: roleLabels[name] || name })))
  const [clients, setClients] = useState([])
  const [complianceClients, setComplianceClients] = useState([])
  const [leads, setLeads] = useState([])
  const [calendarItems, setCalendarItems] = useState([])
  const [quotations, setQuotations] = useState([])
  const [annualReturns, setAnnualReturns] = useState([])
  const [pendingClients, setPendingClients] = useState([])
  const [pendingQuotations, setPendingQuotations] = useState([])
  const [form, setForm] = useState(defaultUserForm)
  const [loading, setLoading] = useState(() => !currentUser)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [rowsPerPage, setRowsPerPage] = useState(8)
  const [operationsRowsPerPage, setOperationsRowsPerPage] = useState(5)
  const [operationsPage, setOperationsPage] = useState(1)
  const [selectedPerformanceUserId, setSelectedPerformanceUserId] = useState('')
  const [selectedPiboCategory, setSelectedPiboCategory] = useState('')
  const [page, setPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const [teamModalOpen, setTeamModalOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [activeActionUser, setActiveActionUser] = useState(null)
  const [detailsUser, setDetailsUser] = useState(null)
  const [editingUser, setEditingUser] = useState(null)
  const [editForm, setEditForm] = useState(defaultUserForm)
  const [profileOpen, setProfileOpen] = useState(false)
  const [userLogsOpen, setUserLogsOpen] = useState(false)
  const [poDetailsRow, setPoDetailsRow] = useState(null)
  const [quotationDetailsRow, setQuotationDetailsRow] = useState(null)
  const [annualReturnRow, setAnnualReturnRow] = useState(null)
  const [todayLeadsOpen, setTodayLeadsOpen] = useState(false)
  const [salesValueDrawerOpen, setSalesValueDrawerOpen] = useState(false)
  const [operationsReportModal, setOperationsReportModal] = useState(null)
  const [clientAnalyticsOpen, setClientAnalyticsOpen] = useState(false)
  const [dashboardMode, setDashboardMode] = useState('operations')
  const dashboardDataRef = useRef({})
  const dashboardRequestInFlightRef = useRef(false)
  const navigate = useNavigate()
  const location = useLocation()
  const isUserManagementView = location.pathname === '/dashboard/users'

  const routeRole = normalizeKey(currentUser?.role)
  const canManageUsers = hasAnyRole(currentUser, adminRoles)
  const currentRole = normalizeKey(currentUser?.role)
  const showDashboardSwitcher = !isUserManagementView && canSwitchDashboard(currentUser)
  const isSalesDashboardView = !isUserManagementView && (isSalesDashboardUser(currentUser) || (showDashboardSwitcher && dashboardMode === 'sales'))

  useEffect(() => {
    if (!sidebarOpen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [sidebarOpen])

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const text = `${user.name || ''} ${user.email || ''} ${getUserRoles(user).join(' ')} ${user.team || ''}`.toLowerCase()
      const matchesSearch = text.includes(query.toLowerCase())
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && isUserActive(user)) ||
        (statusFilter === 'inactive' && !isUserActive(user))

      return matchesSearch && matchesStatus
    })
  }, [query, statusFilter, users])

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / rowsPerPage))
  const visibleUsers = filteredUsers.slice((page - 1) * rowsPerPage, page * rowsPerPage)
  const operationUsers = useMemo(() => users.filter((user) => isOperationsUser(user)), [users])
  const activeUsers = operationUsers.filter((user) => isUserActive(user)).length
  const inactiveUsers = operationUsers.filter((user) => !isUserActive(user)).length
  const userById = useMemo(() => new Map(users.map((user) => [String(user._id || user.id), user])), [users])

  const operationAnalytics = useMemo(() => {
    const liveClients = clients.filter((client) => getVisibilityStatus(client) === 'LIVE').length
    const discontinuedClients = clients.filter((client) => getVisibilityStatus(client) === 'DISCONTINUED').length
    const annualFiled = annualReturns.filter((row) => ['filed', 'submitted', 'closed'].includes(String(row.status || '').toLowerCase())).length
    const annualDraft = annualReturns.filter((row) => !['filed', 'submitted', 'closed'].includes(String(row.status || '').toLowerCase())).length
    const sentQuotes = quotations.filter((quote) => ['sent', 'approved'].includes(String(quote.status || quote.approvalStatus || '').toLowerCase())).length
    const draftQuotes = quotations.filter((quote) => String(quote.status || '').toLowerCase() === 'draft').length
    const pendingTotal = pendingClients.length + pendingQuotations.length
    const clientCompletion = clients.length ? Math.round((liveClients / clients.length) * 100) : 0
    const annualCompletion = annualReturns.length ? Math.round((annualFiled / annualReturns.length) * 100) : 0

    return {
      liveClients,
      discontinuedClients,
      annualFiled,
      annualDraft,
      sentQuotes,
      draftQuotes,
      pendingTotal,
      clientCompletion,
      annualCompletion
    }
  }, [annualReturns, clients, pendingClients.length, pendingQuotations.length, quotations])

  const operationsMetrics = [
    { label: 'Operations Clients', value: clients.length, note: `${operationAnalytics.liveClients} live`, icon: ClipboardCheck, tone: 'teal' },
    { label: 'Pending Approvals', value: operationAnalytics.pendingTotal, note: `${pendingClients.length} clients, ${pendingQuotations.length} quotations`, icon: ShieldAlert, tone: 'orange' },
    { label: 'Annual Returns', value: annualReturns.length, note: `${operationAnalytics.annualFiled} filed`, icon: FileCheck2, tone: 'emerald' },
    { label: 'Operations Team', value: operationUsers.length, note: `${activeUsers} active, ${inactiveUsers} inactive`, icon: Users, tone: 'indigo' }
  ]

  const categoryRows = useMemo(() => buildCategoryRows(clients), [clients])
  const teamRows = useMemo(() => buildTeamRows(operationUsers, clients, annualReturns), [operationUsers, clients, annualReturns])
  const recentOperations = useMemo(() => buildRecentOperations(clients, annualReturns, pendingClients, pendingQuotations), [annualReturns, clients, pendingClients, pendingQuotations])
  const workflowRows = useMemo(() => buildWorkflowRows({
    leads,
    clients,
    quotations,
    annualReturns,
    pendingTotal: operationAnalytics.pendingTotal
  }), [annualReturns, clients, leads, operationAnalytics.pendingTotal, quotations])
  const attentionItems = useMemo(() => buildAttentionItems({
    analytics: operationAnalytics,
    clients,
    inactiveUsers
  }), [clients, inactiveUsers, operationAnalytics])
  const controlSignals = useMemo(() => buildControlSignals({
    analytics: operationAnalytics,
    clients,
    quotations,
    pendingClients,
    pendingQuotations,
    activeUsers
  }), [activeUsers, clients, operationAnalytics, pendingClients, pendingQuotations, quotations])
  const allOperationsRows = useMemo(() => buildOperationsRows({
    clients: isSalesDashboardView ? [] : clients,
    annualReturns: isSalesDashboardView ? [] : annualReturns,
    quotations: isSalesDashboardView ? [] : quotations,
    pendingClients: isSalesDashboardView ? [] : pendingClients,
    users: isSalesDashboardView ? [] : users,
    leads: isSalesDashboardView ? [] : leads,
    currentUser
  }), [annualReturns, clients, currentUser, isSalesDashboardView, leads, pendingClients, quotations, users])
  const complianceOperationsRows = useMemo(() => buildOperationsRows({
    clients: isSalesDashboardView ? [] : complianceClients,
    annualReturns: isSalesDashboardView ? [] : annualReturns,
    quotations: [],
    pendingClients: [],
    users,
    leads: []
  }), [annualReturns, complianceClients, isSalesDashboardView, users])
  const scopedOperationsRows = useMemo(
    () => getScopedOperationsRows(allOperationsRows, users, currentUser),
    [allOperationsRows, currentUser, users]
  )
  const scopedOperationAnalytics = useMemo(() => {
    const annualTotal = scopedOperationsRows.reduce((sum, row) => sum + row.annualTotal, 0)
    const annualDone = scopedOperationsRows.reduce((sum, row) => sum + row.annualDone, 0)
    const compliancePending = scopedOperationsRows.filter((row) => row.compliancePending).length
    const poMissing = scopedOperationsRows.filter((row) => !row.hasPo).length
    const quoteMissing = scopedOperationsRows.filter((row) => !row.hasQuotation).length
    const annualCompletion = percent(annualDone, annualTotal)
    const base = Math.round((100 + annualCompletion) / 2)
    const penalty = Math.min(45, compliancePending * 6 + poMissing * 1 + quoteMissing * 1)
    return {
      annualCompletion,
      compliancePending,
      score: Math.max(0, Math.min(100, base - penalty + (compliancePending ? 0 : 8)))
    }
  }, [scopedOperationsRows])
  const operationsScore = scopedOperationAnalytics.score
  const piboCards = useMemo(() => buildPiboCategoryCards(allOperationsRows), [allOperationsRows])
  const operationsLeadAnalytics = useMemo(
    () => buildOperationsLeadAnalytics(leads, users, currentUser),
    [currentUser, leads, users]
  )
  const leadFollowUpItems = useMemo(() => buildLeadFollowUpItems(leads), [leads])
  const operationsFollowUps = useMemo(
    () => getCalendarFollowUpsForUser(currentUser, [...calendarItems, ...leadFollowUpItems]),
    [calendarItems, currentUser, leadFollowUpItems]
  )
  const convertedOperationsLeadCount = useMemo(
    () => clients.length,
    [clients]
  )
  const operationsAnnualReturnStats = useMemo(() => {
    const actualFilings = adminRoles.includes(currentUser?.role)
      ? annualReturns
      : scopedOperationsRows.flatMap((row) => row.annualReturns || [])
    const filingMap = new Map(actualFilings.map((filing) => [
      filing._id || filing.annualReturnId || `${filing.clientKey || filing.client || filing.clientName || 'client'}:${filing.annualYear || filing.year || 'year'}`,
      filing
    ]))
    const clientsWithActualFilings = new Set(actualFilings.flatMap((filing) => getAnnualReturnClientKeys(filing)))
    scopedOperationsRows.forEach((row) => {
      if (!row.firstAnnualReturnYear || (row.annualReturns || []).length) return
      const rowKeys = getClientMatchKeys(row.client || {})
      if (rowKeys.some((key) => clientsWithActualFilings.has(key))) return
      const key = `mapped:${row.clientKey || row.id}:${row.annualYear || row.firstAnnualReturnYear}`
      filingMap.set(key, {
        _id: key,
        clientKey: row.clientKey || row.id,
        clientName: row.companyName,
        annualYear: row.annualYear || row.firstAnnualReturnYear,
        status: 'pending',
        source: 'client-year-mapping'
      })
    })
    const filings = [...filingMap.values()]
    const normalizedStatus = (filing) => String(
      filing.status || filing.approvalWorkflow?.status || filing.approvalStatus || 'pending'
    ).trim().toLowerCase()
    const completedStatuses = new Set(['filed', 'submitted', 'closed', 'approved', 'completed', 'compliance_approved'])
    const rejectedStatuses = new Set(['rejected', 'compliance_rejected', 'manager_rejected'])
    const completed = filings.filter((filing) => completedStatuses.has(normalizedStatus(filing))).length
    const rejected = filings.filter((filing) => rejectedStatuses.has(normalizedStatus(filing))).length
    const total = filings.length
    return {
      total,
      completed,
      rejected,
      pending: Math.max(0, total - completed - rejected)
    }
  }, [annualReturns, currentUser?.role, scopedOperationsRows])
  const userPerformanceCards = useMemo(
    () => buildUserPerformanceCards(scopedOperationsRows, users, currentUser, operationsLeadAnalytics.leads),
    [currentUser, operationsLeadAnalytics.leads, scopedOperationsRows, users]
  )
  const selectedPerformanceUser = useMemo(
    () => userPerformanceCards.find((item) => String(item.id) === String(selectedPerformanceUserId)) || null,
    [selectedPerformanceUserId, userPerformanceCards]
  )
  const selectedPerformanceRows = useMemo(
    () => {
      if (!selectedPerformanceUser) return []
      const selectedKeys = new Set((selectedPerformanceUser.matchKeys || [selectedPerformanceUser.id, selectedPerformanceUser.name]).map(normalizeKey).filter(Boolean))
      return scopedOperationsRows.filter((row) => getOperationRowUserKeys(row).some((key) => selectedKeys.has(key)))
    },
    [scopedOperationsRows, selectedPerformanceUser]
  )
  const selectedOperationsRows = useMemo(() => {
    if (selectedPiboCategory) {
      return allOperationsRows.filter((row) => normalizeKey(row.category) === normalizeKey(selectedPiboCategory))
    }
    if (selectedPerformanceUser) return selectedPerformanceRows
    return scopedOperationsRows
  }, [allOperationsRows, scopedOperationsRows, selectedPerformanceRows, selectedPerformanceUser, selectedPiboCategory])
  const selectedOperationsTitle = selectedPiboCategory
    ? `${selectedPiboCategory} Clients`
    : selectedPerformanceUser
      ? `${selectedPerformanceUser.name} Clients`
      : 'Operations Client Table'
  const selectedOperationsNote = selectedPiboCategory
    ? `${selectedOperationsRows.length} ${selectedPiboCategory} clients in Client Master`
    : selectedPerformanceUser
      ? `${selectedOperationsRows.length} clients, ${selectedPerformanceUser.done}/${selectedPerformanceUser.total} annual returns completed`
      : `${scopedOperationsRows.length} visible clients`
  const managerPerformanceCards = useMemo(
    () => buildManagerPerformanceCards(users, scopedOperationsRows),
    [scopedOperationsRows, users]
  )
  const compliancePendingRows = useMemo(() => scopedOperationsRows.filter((row) => row.compliancePending), [scopedOperationsRows])
  const operationsTotalPages = operationsRowsPerPage === 'all' ? 1 : Math.max(1, Math.ceil(selectedOperationsRows.length / operationsRowsPerPage))
  const visibleOperationsRows = operationsRowsPerPage === 'all'
    ? selectedOperationsRows
    : selectedOperationsRows.slice((operationsPage - 1) * operationsRowsPerPage, operationsPage * operationsRowsPerPage)
  const operationsRoleLabel = normalizeKey(currentUser?.role).includes('compliance')
    ? 'Compliance approval view'
    : adminRoles.includes(currentUser?.role)
      ? 'All users'
      : normalizeKey(currentUser?.role) === 'manager'
        ? 'Manager team'
        : 'My assigned clients'
  const salesScopedLeads = useMemo(() => getSalesVisibleRecords(leads, (lead) => leadBelongsToSalesUser(lead, currentUser)), [currentUser, leads])
  const salesTodayLeads = useMemo(() => salesScopedLeads.filter((lead) => isTodayDate(getLeadCreatedDate(lead))), [salesScopedLeads])
  const salesScopedQuotations = useMemo(() => getSalesVisibleRecords(quotations, (quote) => quotationBelongsToSalesUser(quote, currentUser)), [currentUser, quotations])
  const canSeeTeamPerformance = adminRoles.includes(currentUser?.role) || currentRole === 'manager' || currentRole.includes('operation head')

  useEffect(() => {
    loadDashboard()
  }, [location.pathname])

  useEffect(() => {
    let refreshing = false
    const refreshLiveData = async () => {
      if (refreshing || document.visibilityState === 'hidden') return
      refreshing = true
      try { await loadDashboard({ force: true, silent: true }) } finally { refreshing = false }
    }
    const intervalId = window.setInterval(refreshLiveData, 30000)
    window.addEventListener('focus', refreshLiveData)
    document.addEventListener('visibilitychange', refreshLiveData)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refreshLiveData)
      document.removeEventListener('visibilitychange', refreshLiveData)
    }
  }, [location.pathname])

  useEffect(() => {
    setPage(1)
  }, [query, rowsPerPage, statusFilter])

  useEffect(() => {
    setOperationsPage(1)
  }, [operationsRowsPerPage, selectedOperationsRows.length, selectedPiboCategory, selectedPerformanceUserId])

  useEffect(() => {
    if (selectedPerformanceUserId && !userPerformanceCards.some((item) => String(item.id) === String(selectedPerformanceUserId))) {
      setSelectedPerformanceUserId('')
    }
  }, [selectedPerformanceUserId, userPerformanceCards])

  useEffect(() => {
    if (selectedPiboCategory && !piboCards.some((item) => normalizeKey(item.label) === normalizeKey(selectedPiboCategory))) {
      setSelectedPiboCategory('')
    }
  }, [piboCards, selectedPiboCategory])

  function applyDashboardData(snapshot = {}) {
    dashboardDataRef.current = { ...dashboardDataRef.current, ...snapshot }
    if (snapshot.currentUser) setCurrentUser(snapshot.currentUser)
    setUsers(snapshot.users || [])
    setTeams(snapshot.teams || [])
    setClients(asRecordList(snapshot.clients))
    setComplianceClients(asRecordList(snapshot.complianceClients))
    setLeads(snapshot.leads || [])
    setCalendarItems(snapshot.calendarItems || [])
    setQuotations(snapshot.quotations || [])
    setAnnualReturns(snapshot.annualReturns || [])
    setPendingClients(snapshot.pendingClients || [])
    setPendingQuotations(snapshot.pendingQuotations || [])
  }

  async function loadDashboard(options = {}) {
    if (dashboardRequestInFlightRef.current && options.silent) return
    dashboardRequestInFlightRef.current = true
    const cacheKey = `${DASHBOARD_CACHE_KEY}:${location.pathname}`
    const cached = !options.force ? readSessionCache(cacheKey) : null
    const retained = cached || dashboardDataRef.current || {}
    const retainStableList = (next, previous) => (
      options.silent && Array.isArray(previous) && previous.length > 0 && (!Array.isArray(next) || next.length === 0)
        ? previous
        : (Array.isArray(next) ? next : (previous || []))
    )
    const requestConfig = { timeout: DASHBOARD_REQUEST_TIMEOUT_MS }
    if (cached) {
      applyDashboardData(cached)
      setLoading(false)
    } else if (!currentUser) {
      setLoading(true)
    }
    setError('')

    try {
      const meResponse = await api.get(API_ENDPOINTS.auth.me, requestConfig)
      const user = meResponse.data.user
      setCurrentUser(user)
      storeSessionUser(user)
      setLoading(false)

      const authenticatedRole = normalizeKey(user.role)
      if (adminRoles.includes(authenticatedRole)) {
        api.get(API_ENDPOINTS.auth.roles, requestConfig)
          .then(response => setAvailableRoles(response.data.roles || []))
          .catch(() => setAvailableRoles(defaultRoles))
      }

      if (isUserManagementView) {
        if (adminRoles.includes(authenticatedRole)) {
          const [usersResponse, teamsResponse] = await Promise.all([
            api.get(API_ENDPOINTS.auth.adminUsers, requestConfig),
            api.get(API_ENDPOINTS.teams.list, requestConfig)
          ])
          const snapshot = {
            currentUser: user,
            users: usersResponse.data.users || [],
            teams: teamsResponse.data.teams || [],
            clients: [],
            leads: [],
            quotations: [],
            annualReturns: [],
            pendingClients: [],
            pendingQuotations: []
          }
          applyDashboardData(snapshot)
          writeSessionCache(cacheKey, snapshot)
        } else {
          const usersResponse = await api.get(API_ENDPOINTS.auth.users, requestConfig)
          const snapshot = {
            currentUser: user,
            users: usersResponse.data.users || [user],
            teams: [],
            clients: [],
            leads: [],
            quotations: [],
            annualReturns: [],
            pendingClients: [],
            pendingQuotations: []
          }
          applyDashboardData(snapshot)
          writeSessionCache(cacheKey, snapshot)
        }
        return
      }

      const directoryRequests = Promise.allSettled([
        api.get(adminRoles.includes(authenticatedRole) ? API_ENDPOINTS.auth.adminUsers : API_ENDPOINTS.auth.users, requestConfig),
        adminRoles.includes(authenticatedRole) ? api.get(API_ENDPOINTS.teams.list, requestConfig) : Promise.resolve({ data: { teams: [] } })
      ])

      const [clientsResult, complianceClientsResult, leadsResult, quotationsResult, annualReturnsResult, approvalsResult, calendarItemsResult] = await Promise.allSettled([
        fetchDashboardCollection(API_ENDPOINTS.clients.list, 'clients', requestConfig, { dashboard: true }),
        api.get(API_ENDPOINTS.clients.dashboardComplianceRecords, { ...requestConfig, timeout: 60000 }),
        fetchDashboardCollection(API_ENDPOINTS.leads.list, 'leads', requestConfig, { dashboard: true }),
        fetchDashboardCollection(API_ENDPOINTS.quotations.list, 'quotations', requestConfig, { compact: true, dashboard: true }),
        api.get(API_ENDPOINTS.annualReturns.list, { ...requestConfig, params: { dashboard: true } }),
        api.get(API_ENDPOINTS.clients.pendingApprovals, { ...requestConfig, params: { compact: true } }),
        api.get(API_ENDPOINTS.calendarItems.list, requestConfig)
      ])

      const crmClients = clientsResult.status === 'fulfilled' ? (clientsResult.value.data.clients || []) : []
      const kpiClients = complianceClientsResult.status === 'fulfilled' ? (complianceClientsResult.value.data.clients || []) : []
      console.groupCollapsed('[Dashboard KPI API] Lightweight Client Master fetch')
      if (complianceClientsResult.status === 'fulfilled') console.info('[Dashboard KPI API] Request succeeded', {
        recordsFetched: kpiClients.length,
        serverMs: complianceClientsResult.value.data.debug?.ms,
        source: complianceClientsResult.value.data.debug?.source
      })
      else console.error('[Dashboard KPI API] Request failed', {
        message: complianceClientsResult.reason?.message || 'Unknown request error',
        status: complianceClientsResult.reason?.response?.status,
        apiError: complianceClientsResult.reason?.response?.data?.error || complianceClientsResult.reason?.response?.data?.message
      })
      console.groupEnd()
      console.groupCollapsed('[Dashboard API] Client Master fetch')
      if (clientsResult.status === 'fulfilled') {
        console.info('[Dashboard API] Client Master request succeeded', { recordsFetched: crmClients.length })
        console.table(crmClients.slice(0, 100).map((client) => {
          const data = readClientData(client)
          const snapshot = data.selectedLeadSnapshot || {}
          return {
            clientMasterId: String(client._id || client.id || ''),
            assignedServiceId: String(client.assignedServiceId || data.assignedServiceId || snapshot.assignedServiceId || ''),
            service: complianceText(data.basic?.servicesOffered, snapshot.servicesOffered, snapshot.applicableService, client.servicesOffered) || '(empty)',
            eprCategory: data.basic?.eprCategory || snapshot.eprCategory || client.eprCategory || '(empty)',
            applicantType: data.basic?.applicantType || snapshot.applicantType || snapshot.piboParent || client.applicantType || '(empty)',
            subApplicantType: data.basic?.subApplicantType || data.basic?.piboCategory || snapshot.subApplicantType || snapshot.piboCategory || client.subApplicantType || client.piboCategory || '(empty)',
            nestedServices: Array.isArray(client.services) ? client.services.length : 0
          }
        }))
      } else {
        console.error('[Dashboard API] Client Master request failed', {
          message: clientsResult.reason?.message || 'Unknown request error',
          status: clientsResult.reason?.response?.status,
          apiError: clientsResult.reason?.response?.data?.error || clientsResult.reason?.response?.data?.message
        })
      }
      console.groupEnd()
      const clientRequestsSucceeded = clientsResult.status === 'fulfilled'
      const nextClients = retainStableList(
        asRecordList(clientRequestsSucceeded ? crmClients : retained.clients),
        retained.clients
      )
      const nextComplianceClients = retainStableList(
        complianceClientsResult.status === 'fulfilled' ? kpiClients : retained.complianceClients,
        retained.complianceClients
      )
      const freshLeads = mergeLeadSources(
        leadsResult.status === 'fulfilled' ? (leadsResult.value.data.leads || []) : [],
        []
      )
      const nextLeads = retainStableList(freshLeads, retained.leads)
      const nextQuotations = retainStableList(
        quotationsResult.status === 'fulfilled' ? quotationsResult.value.data.quotations : null,
        retained.quotations
      )
      const nextAnnualReturns = retainStableList(
        annualReturnsResult.status === 'fulfilled' ? annualReturnsResult.value.data.annualReturns : null,
        retained.annualReturns
      )
      const approvals = approvalsResult.status === 'fulfilled' ? approvalsResult.value.data : {}
      const nextPendingClients = retainStableList(approvals.pendingClients, retained.pendingClients)
      const nextPendingQuotations = retainStableList(approvals.pendingQuotations, retained.pendingQuotations)
      const nextCalendarItems = retainStableList(
        calendarItemsResult.status === 'fulfilled' ? calendarItemsResult.value.data.items : null,
        retained.calendarItems
      )

      const [usersResult, teamsResult] = await directoryRequests
      let usersResponse = usersResult.status === 'fulfilled' ? usersResult.value : null
      if (!usersResponse && adminRoles.includes(authenticatedRole)) {
        try { usersResponse = await api.get(API_ENDPOINTS.auth.users, requestConfig) } catch { /* Keep loaded records and report the failure below. */ }
      }
      const nextUsers = retainStableList(usersResponse?.data?.users, retained.users || [user])
      const nextTeams = retainStableList(teamsResult.status === 'fulfilled' ? teamsResult.value.data.teams : null, retained.teams)
      const failedSections = [
        clientsResult.status === 'rejected' && 'clients',
        !usersResponse && 'users'
      ].filter(Boolean)
      if (failedSections.length) setError(`Unable to refresh ${failedSections.join(' and ')}. Please retry using Refresh data.`)
      const snapshot = {
        currentUser: user,
        users: nextUsers,
        teams: nextTeams,
        clients: nextClients,
        complianceClients: nextComplianceClients,
        leads: nextLeads,
        quotations: nextQuotations,
        annualReturns: nextAnnualReturns,
        pendingClients: nextPendingClients,
        pendingQuotations: nextPendingQuotations,
        calendarItems: nextCalendarItems
      }
      applyDashboardData(snapshot)
      writeSessionCache(cacheKey, snapshot)
    } catch (err) {
      if (!cached) setError(err?.response?.data?.error || 'Unable to load dashboard')
    } finally {
      dashboardRequestInFlightRef.current = false
      setLoading(false)
    }
  }

  async function handleCreateUser(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')

    const name = `${form.firstName} ${form.lastName}`.trim()

    try {
      const response = await api.post(API_ENDPOINTS.auth.createUser, {
        name,
        email: form.email,
        password: form.password,
        avatarUrl: form.avatarUrl,
        role: form.role,
        roles: form.roles,
        team: form.team,
        teamId: form.teamId,
        managerId: form.managerId,
        operationHeadId: form.operationHeadId,
        isActive: form.isActive
      })
      setUsers((prevUsers) => [response.data.user, ...prevUsers])
      setForm(defaultUserForm)
      setModalOpen(false)
      setNotice('New user added successfully. They can login with OTP from the sign-in page.')
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to create user')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateTeam(teamForm) {
    setSaving(true)
    setError('')
    setNotice('')

    try {
      const response = await api.post(API_ENDPOINTS.teams.create, teamForm)
      setTeams((prevTeams) => [response.data.team, ...prevTeams])
      setTeamModalOpen(false)
      setNotice('Team created successfully. Manager can now see selected users plus their own data.')
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to create team')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateRole(label) {
    const response = await api.post(API_ENDPOINTS.auth.roles, { label })
    const role = response.data.role
    setAvailableRoles((current) => current.some((item) => item.name === role.name) ? current : [...current, role])
    setNotice(`${role.label} role added successfully.`)
    return role
  }

  async function handleUpdateUser(event) {
    event.preventDefault()
    if (!editingUser) return

    setSaving(true)
    setError('')
    setNotice('')

    const name = `${editForm.firstName} ${editForm.lastName}`.trim()
    const id = editingUser._id || editingUser.id

    try {
      const response = await api.put(API_ENDPOINTS.auth.adminUser(id), {
        name,
        email: editForm.email,
        avatarUrl: editForm.avatarUrl,
        role: editForm.role,
        roles: editForm.roles,
        team: editForm.team,
        teamId: editForm.teamId,
        managerId: editForm.managerId,
        operationHeadId: editForm.operationHeadId,
        isActive: editForm.isActive
      })
      const updatedUser = response.data.user
      setUsers((prevUsers) =>
        prevUsers.map((user) => ((user._id || user.id) === id ? { ...user, ...updatedUser, _id: updatedUser._id || updatedUser.id || id } : user))
      )
      setEditingUser(null)
      setEditForm(defaultUserForm)
      setNotice('User updated successfully.')
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to update user')
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdateProfile(profile) {
    setSaving(true)
    setError('')
    setNotice('')

    try {
      const response = await api.put(API_ENDPOINTS.auth.me, profile)
      const updatedUser = response.data.user
      setCurrentUser(updatedUser)
      setUsers((prevUsers) =>
        prevUsers.map((user) => ((user._id || user.id) === (updatedUser._id || updatedUser.id) ? { ...user, ...updatedUser } : user))
      )
      setNotice('Profile updated successfully.')
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to update profile')
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdatePassword(passwords) {
    setSaving(true)
    setError('')
    setNotice('')

    try {
      await api.put(API_ENDPOINTS.auth.password, passwords)
      setNotice('Password updated successfully.')
    } catch (err) {
      const message = err?.response?.data?.error || 'Unable to update password'
      setError(message)
      throw new Error(message)
    } finally {
      setSaving(false)
    }
  }

  function openDetails(user) {
    setActiveActionUser(null)
    setDetailsUser(user)
  }

  function openEdit(user) {
    const name = splitName(user.name)
    setActiveActionUser(null)
    setDetailsUser(null)
    setEditingUser(user)
    setEditForm({
      firstName: name.firstName === '-' ? '' : name.firstName,
      lastName: name.lastName === '-' ? '' : name.lastName,
      email: user.email || '',
      avatarUrl: user.avatarUrl || '',
      role: user.role || 'operation',
      roles: getUserRoles(user),
        team: user.team || 'No team assigned',
        teamId: user.teamId || '',
        managerId: user.managerId || '',
        operationHeadId: user.operationHeadId || '',
        isActive: Boolean(user.isActive)
    })
  }

  function handleLogout() {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    localStorage.removeItem('login_email')
    navigate('/', { replace: true })
  }

  function closeModal() {
    if (saving) return
    setModalOpen(false)
    setForm(defaultUserForm)
  }

  function openAnnualReturn(row = {}) {
    if (row.clientKey) {
      setAnnualReturnRow(row)
      return
    }
    navigate('/sales/annual-returns')
  }

  function openAnnualReturnYear(yearLabel) {
    if (!annualReturnRow?.clientKey || !yearLabel) return
    navigate(`/sales/client-data-processing/${encodeURIComponent(annualReturnRow.clientKey)}/${encodeURIComponent(yearLabel)}`)
  }

  function openQuotation(row = {}) {
    if (!row.hasQuotation) return
    setQuotationDetailsRow(row)
  }

  function openPoDetails(row = {}) {
    console.debug('[OperationsTable:po-view-click]', {
      atplCode: row.atplCode,
      companyName: row.companyName,
      hasPo: row.hasPo,
      poDetails: row.poDetails
    })
    setPoDetailsRow(row)
  }

  if (loading) {
    return <AdminDashboardSkeleton />
  }

  return (
    <main className="min-h-screen bg-[#eef7f5] pt-16 text-slate-900">
      <Topbar
        currentUser={currentUser}
        onOpenProfile={() => setProfileOpen(true)}
        onOpenSidebar={() => setSidebarOpen(true)}
        onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
        sidebarCollapsed={sidebarCollapsed}
        onLogout={handleLogout}
      />
      <div className="flex min-h-[calc(100vh-4rem)]">
        <aside
          className={`fixed bottom-0 left-0 top-16 z-40 w-[296px] border-r border-emerald-100 bg-white shadow-xl shadow-emerald-900/5 transition-all duration-300 ease-out lg:translate-x-0 ${
            sidebarCollapsed ? 'lg:w-[84px]' : 'lg:w-[296px]'
          } ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          <Sidebar
            currentUser={currentUser}
            collapsed={sidebarCollapsed}
            dashboardMode={dashboardMode}
            onDashboardModeChange={setDashboardMode}
            onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
            onClose={() => setSidebarOpen(false)}
            onLogout={handleLogout}
          />
        </aside>

        {sidebarOpen && (
          <button
            type="button"
            className="fixed bottom-0 left-0 right-0 top-16 z-30 bg-slate-950/30 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          />
        )}

        <section className={`min-w-0 flex-1 transition-all duration-300 ease-out ${sidebarCollapsed ? 'lg:ml-[84px]' : 'lg:ml-[296px]'}`}>
          <div className="px-4 py-6 sm:px-6 lg:px-8">
            <div className={isUserManagementView ? 'space-y-6' : 'operations-dashboard'}>
              {!isUserManagementView && (
                <>
                {isSalesDashboardView ? (
                  <SalesDashboard
                    leads={leads}
                    quotations={quotations}
                    clients={clients}
                    users={users}
                    calendarItems={calendarItems}
                    currentUser={currentUser}
                    onOpenTodayLeads={() => setTodayLeadsOpen(true)}
                    onOpenSalesValue={() => setSalesValueDrawerOpen(true)}
                    onRefresh={() => loadDashboard({ force: true })}
                    refreshing={loading}
                  />
                ) : (
                  <>
              <section className="operations-welcome-bar operations-welcome-premium">
                <div className="operations-welcome-copy">
                  <span className="operations-welcome-eyebrow">Operations intelligence</span>
                  <p>Good morning, <strong>{String(currentUser?.name || 'Team').split(/\s+/)[0]}!</strong> <motion.span className="operations-wave-hand" aria-label="Waving hand" animate={{ rotate: [0, 18, -8, 18, 0] }} transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 1.5, ease: 'easeInOut' }}>👋</motion.span></p>
                  <small>Your live EPR and purchase-order insights are ready.</small>
                </div>
                <div className="operations-welcome-actions">
                  <span><CalendarDays className="h-4 w-4" />{new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                  <button type="button" onClick={() => loadDashboard({ force: true })}><RefreshCw className="h-4 w-4" />Refresh</button>
                </div>
              </section>
              <EprAnalyticsDashboard
                rows={scopedOperationsRows}
                complianceRows={complianceOperationsRows}
                leads={leads}
                users={users}
                onRefresh={() => loadDashboard({ force: true })}
              />
              <div className="operations-hero" style={{ display: 'none' }}>
                <div className="flex min-w-0 items-center gap-4">
                  <span className="operations-hero-icon"><Activity className="h-6 w-6" /></span>
                  <div className="min-w-0">
                    <h1>Operations Dashboard</h1>
                    <div className="operations-hero-meta">
                      <span><Users className="h-3.5 w-3.5" /> {clients.length.toLocaleString('en-IN')} clients</span>
                      <span><FileText className="h-3.5 w-3.5" /> {quotations.length.toLocaleString('en-IN')} quotations</span>
                      <span><CalendarDays className="h-3.5 w-3.5" /> {operationsFollowUps.length.toLocaleString('en-IN')} follow-ups</span>
                    </div>
                  </div>
                </div>
                <div className="operations-hero-actions">
                  <button
                    type="button"
                    onClick={() => setClientAnalyticsOpen(true)}
                    className="operations-client-analytics-button btn-lift"
                  >
                    <BarChart3 className="h-4 w-4" />
                    Client Analytics
                  </button>
                  <button
                    type="button"
                    onClick={() => loadDashboard({ force: true })}
                    className="btn-lift inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-teal-200 bg-white px-4 font-black text-teal-700 shadow-sm transition hover:bg-teal-50"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                  </button>
                </div>
              </div>

              {error && <ToastMessage type="error" className="mt-5">{error}</ToastMessage>}
              {notice && <ToastMessage type="success" className="mt-5">{notice}</ToastMessage>}

              <div className="operations-legacy-layout" style={{ display: 'none' }}>
              <section className="operations-panel operations-snapshot-panel">
                <PanelHeader icon={PieChart} title="Operations Snapshot" note="Lead, conversion and annual return overview" />
                <div className="operations-snapshot-grid">
                  <article className="operations-kpi-card operations-kpi-card-blue">
                    <div className="operations-kpi-content">
                      <strong>{clients.length.toLocaleString('en-IN')}</strong>
                      <span>Total Clients</span>
                      <small>12% vs last month</small>
                    </div>
                    <div className="operations-kpi-icon"><Users className="h-5 w-5" /></div>
                    <i aria-hidden="true" />
                  </article>
                  <article className="operations-kpi-card operations-kpi-card-green">
                    <div className="operations-kpi-content">
                      <strong>{quotations.filter((quote) => !['approved', 'rejected', 'closed'].includes(String(quote.status || quote.approvalStatus || '').toLowerCase())).length.toLocaleString('en-IN')}</strong>
                      <span>Open Quotations</span>
                      <small>8% vs last month</small>
                    </div>
                    <div className="operations-kpi-icon"><FileText className="h-5 w-5" /></div>
                    <i aria-hidden="true" />
                  </article>
                  <article className="operations-kpi-card operations-kpi-card-cyan">
                    <div className="operations-kpi-content">
                      <strong>{operationsFollowUps.filter((item) => item.scheduledDate === dateKey()).length.toLocaleString('en-IN')}</strong>
                      <span>Today's Follow-ups</span>
                      <small>0% vs yesterday</small>
                    </div>
                    <div className="operations-kpi-icon"><CalendarDays className="h-5 w-5" /></div>
                    <i aria-hidden="true" />
                  </article>
                  <article className="operations-kpi-card operations-kpi-card-violet">
                    <div className="operations-kpi-content">
                      <strong>{activeUsers.toLocaleString('en-IN')}</strong>
                      <span>Active Users</span>
                      <small>6% vs last month</small>
                    </div>
                    <div className="operations-kpi-icon"><UserRound className="h-5 w-5" /></div>
                    <i aria-hidden="true" />
                  </article>
                </div>
              </section>

              <div className="operations-dashboard-row operations-dashboard-row-followup">
                <DashboardFollowUpTimeline
                  items={operationsFollowUps}
                  users={users}
                  onCalendar={() => navigate('/calendar')}
                  onView={() => setOperationsReportModal({
                    title: 'Follow-ups',
                    subtitle: `${operationsFollowUps.length} calendar follow-up records`,
                    columns: ['Date', 'Time', 'Title', 'Company', 'Owner', 'Priority', 'Status'],
                    rows: operationsFollowUps.map((item) => [
                      formatShortDate(item.scheduledDate),
                      item.scheduledTime || 'No time',
                      displayValue(item.title, '-'),
                      getCalendarFollowUpCompany(item),
                      getCalendarFollowUpOwner(item),
                      displayValue(item.priority, 'Medium'),
                      displayValue(item.status, 'open')
                    ]),
                    actionLabel: 'Open Calendar',
                    onAction: () => navigate('/calendar')
                  })}
                />

              </div>

              <OperationsLeadAnalytics
                analytics={operationsLeadAnalytics}
                piboCards={piboCards}
                convertedLeadCount={convertedOperationsLeadCount}
                annualReturnStats={operationsAnnualReturnStats}
                followUps={operationsFollowUps}
                onOpenCalendar={() => navigate('/calendar')}
                onViewFollowUps={() => setOperationsReportModal({
                  title: 'Follow-ups',
                  subtitle: `${operationsFollowUps.length} calendar follow-up records`,
                  columns: ['Date', 'Time', 'Title', 'Company', 'Owner', 'Priority', 'Status'],
                  rows: operationsFollowUps.map((item) => [
                    formatShortDate(item.scheduledDate),
                    item.scheduledTime || 'No time',
                    displayValue(item.title, '-'),
                    getCalendarFollowUpCompany(item),
                    getCalendarFollowUpOwner(item),
                    displayValue(item.priority, 'Medium'),
                    displayValue(item.status, 'open')
                  ]),
                  actionLabel: 'Open Calendar',
                  onAction: () => navigate('/calendar')
                })}
              />

              {canSeeTeamPerformance && (
                <div className="operations-dashboard-row operations-dashboard-row-annual">
                  <OperationsAnnualReturnProgress annualReturnStats={operationsAnnualReturnStats} />
                  <section className="operations-panel operations-performance-panel">
                    <PanelHeader icon={TrendingUp} title="Annual Return Performance" note="Team wise annual return completion" />
                    <div className="operations-performance-grid">
                      {userPerformanceCards.length ? userPerformanceCards.slice(0, 5).map((item) => (
                        <PerformanceCard
                          key={item.id}
                          item={item}
                          selected={String(selectedPerformanceUserId) === String(item.id)}
                          onClick={() => {
                            setSelectedPiboCategory('')
                            setSelectedPerformanceUserId((current) => String(current) === String(item.id) ? '' : item.id)
                          }}
                        />
                      )) : <EmptyOperationState label="No annual return ownership found" />}
                    </div>
                    {userPerformanceCards.length > 5 && (
                      <button
                        type="button"
                        className="operations-performance-more"
                        onClick={() => setOperationsReportModal({
                          title: 'Remaining Annual Return Users',
                          subtitle: `${userPerformanceCards.length - 5} users outside the top 5 performance cards`,
                          columns: ['User', 'Completed', 'Assigned Leads', 'Progress', 'Pending Compliance'],
                          rows: userPerformanceCards.slice(5).map((item) => [
                            item.name,
                            item.done,
                            item.total,
                            `${item.percent}%`,
                            item.pendingCompliance || 0
                          ])
                        })}
                      >
                        <strong>{userPerformanceCards.length - 5} more users</strong>
                        <span>{userPerformanceCards.slice(5).reduce((sum, item) => sum + (item.total || 0), 0)} leads in remaining team workload</span>
                      </button>
                    )}
                  </section>
                </div>
              )}

              {canSeeTeamPerformance && (
                <section className="operations-panel">
                  <PanelHeader icon={Users} title="Manager Workload" note="Manager wise users and annual return progress" />
                  <div className="operations-performance-grid">
                    {managerPerformanceCards.length ? managerPerformanceCards.map((item) => (
                      <PerformanceCard key={item.id} item={item} type="manager" />
                    )) : <EmptyOperationState label="No manager workload found" />}
                  </div>
                </section>
              )}

              {normalizeKey(currentUser?.role).includes('compliance') && (
                <section className="operations-panel">
                  <PanelHeader icon={ShieldAlert} title="Compliance Approval Required" note={`${compliancePendingRows.length} annual returns waiting for approval`} />
                  <div className="operations-approval-users">
                    {compliancePendingRows.length ? compliancePendingRows.map((row) => (
                      <div key={`${row.id}-approval`} className="operations-approval-user">
                        <span><UserRound className="h-4 w-4" /></span>
                        <strong>{row.userName}</strong>
                        <p>{row.companyName}</p>
                      </div>
                    )) : <EmptyOperationState label="No annual return approval pending" />}
                  </div>
                </section>
              )}
              </div>

              <section className="operations-panel" style={{ display: 'none' }}>
                <div className="operations-table-head">
                  <PanelHeader icon={ListChecks} title={selectedOperationsTitle} note={selectedOperationsNote} />
                  <div className="operations-table-controls">
                    {(selectedPiboCategory || selectedPerformanceUser) && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPiboCategory('')
                          setSelectedPerformanceUserId('')
                        }}
                        className="operations-view-button"
                      >
                        Clear filter
                      </button>
                    )}
                    <span>Rows</span>
                    <select
                      value={operationsRowsPerPage}
                      onChange={(event) => setOperationsRowsPerPage(event.target.value === 'all' ? 'all' : Number(event.target.value))}
                      className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-slate-900 outline-none focus:border-emerald-300"
                    >
                      <option value={5}>5</option>
                      <option value={10}>10</option>
                      <option value={15}>15</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                      <option value="all">All</option>
                    </select>
                  </div>
                </div>
                <div className="operations-table-wrap">
                  <table className="operations-table">
                    <thead>
                      <tr>
                        {['User', 'Clients', 'Company', 'Service Category', 'Applicant Type', 'Sub Applicant Type', 'FY Year', 'PO Status', 'PO Number'].map((header) => <th key={header}>{header}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleOperationsRows.length ? visibleOperationsRows.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <button type="button" className="operations-inline-view" onClick={() => {
                              const card = userPerformanceCards.find((item) => normalizeKey(item.name) === normalizeKey(row.userName));
                              if (card) {
                                setSelectedPiboCategory('');
                                setSelectedPerformanceUserId(card.id);
                              }
                            }}><UserRound className="h-3.5 w-3.5" /> {row.userName}</button>
                          </td>
                          <td><strong>{scopedOperationsRows.filter((item) => normalizeKey(item.userName) === normalizeKey(row.userName)).length}</strong></td>
                          <td><div className="operations-company-cell"><strong>{row.companyName}</strong><span>{row.atplCode}</span></div></td>
                          <td>{row.eprCategory}</td>
                          <td>{row.category}</td>
                          <td>{row.subApplicantType}</td>
                          <td>
                            <div className="operations-epr-year-cell">
                              <span><CalendarDays className="h-3.5 w-3.5" /></span>
                              <div>
                                <strong>{row.annualYear || '-'}</strong>
                                <small>April - March</small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="operations-po-cell">
                              <span className={`operations-status-pill ${row.hasPo ? 'operations-status-yes' : 'operations-status-no'}`}>
                                {row.hasPo ? 'Yes' : 'No'}
                              </span>
                              <button
                                type="button"
                                onClick={() => openPoDetails(row)}
                                className={`operations-inline-view ${!row.hasPo ? 'operations-inline-view-muted' : ''}`}
                                title="View Compliance PO details"
                              >
                                <Eye className="h-3.5 w-3.5" /> Details
                              </button>
                            </div>
                          </td>
                          <td><strong>{row.poDetails?.poNo || '-'}</strong></td>
                        </tr>
                      )) : (
                        <tr><td colSpan={9}><EmptyOperationState label="No PO status data found for this selection" /></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="operations-pagination">
                  <span>Page {operationsPage} of {operationsTotalPages}</span>
                  <div>
                    <button type="button" disabled={operationsPage <= 1} onClick={() => setOperationsPage((value) => Math.max(1, value - 1))}>Previous</button>
                    <button type="button" disabled={operationsPage >= operationsTotalPages} onClick={() => setOperationsPage((value) => Math.min(operationsTotalPages, value + 1))}>Next</button>
                  </div>
                </div>
              </section>
                  </>
                )}
                </>
              )}

              {isUserManagementView && (
                <>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 items-start gap-4">
                      <button
                        type="button"
                        onClick={() => navigate('/dashboard')}
                        className="btn-lift grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-emerald-100 bg-white text-emerald-700 shadow-sm hover:bg-emerald-50"
                        aria-label="Back to dashboard"
                        title="Back"
                      >
                        <ArrowLeft className="h-5 w-5" />
                      </button>
                      <div className="min-w-0">
                        <p className="text-xs font-black uppercase tracking-[0.28em] text-emerald-700">Admin User Master</p>
                        <h1 className="mt-1 text-3xl font-black leading-tight text-slate-950">Admin Users</h1>
                      </div>
                    </div>
                  {canManageUsers && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setTeamModalOpen(true)}
                        className="btn-lift inline-flex min-h-11 items-center justify-center rounded-xl border border-emerald-200 bg-white px-4 text-sm font-black text-emerald-700 shadow-sm hover:bg-emerald-50"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Create Team
                      </button>
                      <button
                        type="button"
                        onClick={() => setModalOpen(true)}
                        className="btn-lift inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-700 px-5 text-sm font-black text-white shadow-lg shadow-emerald-900/20 hover:bg-emerald-800"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Create Admin User
                      </button>
                    </div>
                  )}
                  </div>

                  <KpiSummary
                    metrics={[
                      { label: 'Active Users', value: users.filter((user) => isUserActive(user)).length, note: 'Ready for assignment', icon: CheckCircle2, valueClass: 'text-slate-900', iconClass: 'bg-emerald-50 text-emerald-700', active: statusFilter === 'active', onClick: () => { setStatusFilter('active'); setPage(1) } },
                      { label: 'Inactive Users', value: users.filter((user) => !isUserActive(user)).length, note: 'Needs attention', icon: ShieldAlert, valueClass: 'text-amber-600', iconClass: 'bg-amber-50 text-amber-600', active: statusFilter === 'inactive', onClick: () => { setStatusFilter('inactive'); setPage(1) } }
                    ]}
                  />

                  {error && <ToastMessage type="error">{error}</ToastMessage>}
                  {notice && <ToastMessage type="success">{notice}</ToastMessage>}

              <section id="user-management" className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm">
                <div className="flex flex-col gap-4 border-b border-emerald-100 p-4 sm:p-5 xl:flex-row xl:items-center xl:justify-between">
                  <label className="relative block w-full xl:max-w-sm">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      className="h-11 w-full rounded-2xl border border-transparent bg-slate-100 pl-11 pr-4 text-sm font-bold text-slate-700 outline-none transition focus:border-emerald-200 focus:bg-white focus:ring-4 focus:ring-emerald-50"
                      placeholder="Search user"
                    />
                  </label>

                  <div className="flex flex-wrap gap-3">
                    <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-11 rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-slate-900 outline-none focus:border-emerald-300">
                      <option value="all">All</option>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                    {canManageUsers && <button type="button" onClick={() => setUserLogsOpen(true)} className="btn-lift inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-black text-white"><Activity className="h-4 w-4"/>Logs</button>}
                    <button
                      type="button"
                      onClick={() => loadDashboard({ force: true })}
                      className="btn-lift inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 text-sm font-black text-emerald-700 hover:bg-emerald-50"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Refresh
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5">
                  <span className="text-sm font-black text-slate-900">Rows per page</span>
                  <select value={rowsPerPage} onChange={(event) => setRowsPerPage(Number(event.target.value))} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-slate-900 outline-none focus:border-emerald-300">
                    <option value={8}>8</option>
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                  </select>
                </div>

                <div className="grid gap-3 px-4 pb-5 sm:px-5 md:grid-cols-2 2xl:grid-cols-4">
                  {visibleUsers.length ? visibleUsers.map((user) => {
                    const id = user._id || user.id
                    const initial = (user.name || user.email || 'U').slice(0, 1).toUpperCase()
                    const assignedTeams = teams
                      .filter((team) => [team.manager, team.operationHead, ...(team.members || [])]
                        .some((entry) => String(entry?._id || entry?.id || entry || '') === String(id)))
                      .map((team) => team.name)
                    const department = assignedTeams.length ? assignedTeams.join(', ') : (user.team || 'No team assigned')
                    return (
                      <article key={id} className="relative overflow-visible rounded-xl border border-emerald-100 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-900/10">
                        <div className="min-h-24 rounded-t-xl bg-emerald-50 p-4">
                          <span className={`inline-flex rounded-lg px-4 py-2 text-sm font-black ${isUserActive(user) ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                            {isUserActive(user) ? 'Active' : 'Inactive'}
                          </span>
                          <div className="absolute right-5 top-4">
                            <UserActionsMenu
                              open={String(activeActionUser || '') === String(id)}
                              onToggle={() => setActiveActionUser((value) => (String(value || '') === String(id) ? null : id))}
                              onView={() => openDetails(user)}
                              onEdit={() => openEdit(user)}
                              onActivity={() => navigate(`/dashboard/activity-logs?userId=${encodeURIComponent(id)}`)}
                              label={`Actions for ${user.name || user.email || 'user'}`}
                            />
                          </div>
                        </div>
                        <div className="-mt-11 px-4 pb-4 text-center">
                          <div className="mx-auto grid h-24 w-24 place-items-center overflow-hidden rounded-3xl border-4 border-white bg-gradient-to-br from-teal-700 to-sky-700 text-3xl font-black text-white shadow-lg shadow-slate-900/20">
                            {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" /> : initial}
                          </div>
                          <h3 className="mt-4 truncate text-xl font-black text-slate-950">{user.name || 'Unnamed user'}</h3>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {getUserRoles(user).map((role, index) => <span key={role} className={`rounded-full px-2.5 py-1 text-xs font-black ${index === 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'}`}>{roleLabels[role] || role}</span>)}
                          </div>

                          <div className="mt-6 rounded-xl bg-slate-50 p-4 text-left">
                            <div className="grid grid-cols-2 gap-4 border-b border-slate-200 pb-3">
                              <div>
                                <p className="text-xs font-bold text-slate-500">Department</p>
                                <p className="mt-1 text-sm font-black text-slate-950" title={department}>{department}</p>
                              </div>
                              <div>
                                <p className="text-xs font-bold text-slate-500">Created Date</p>
                                <p className="mt-1 text-sm font-black text-slate-950">{formatShortDate(user.createdAt)}</p>
                              </div>
                            </div>
                            <div className="mt-3 grid gap-2 text-sm font-bold text-slate-600">
                              <p className="flex min-w-0 items-center gap-2">
                                <Mail className="h-4 w-4 shrink-0 text-indigo-600" />
                                <span className="truncate">{user.email || '-'}</span>
                              </p>
                              <p className="flex min-w-0 items-center gap-2">
                                <CalendarDays className="h-4 w-4 shrink-0 text-indigo-600" />
                                <span className="truncate">Last login: {formatDateTime(user.lastLogin)}</span>
                              </p>
                            </div>
                          </div>
                        </div>
                      </article>
                    )
                  }) : <EmptyOperationState label="No users match current filters" />}
                </div>

                <div className="flex flex-col gap-3 border-t border-emerald-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                  <p className="text-sm font-bold text-slate-500">
                    Page {page} of {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((value) => Math.max(1, value - 1))}
                      className="btn-lift min-h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                      className="btn-lift min-h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </section>
                </>
              )}
            </div>
          </div>
        </section>
      </div>

      {poDetailsRow && <PoDetailsModal row={poDetailsRow} onClose={() => setPoDetailsRow(null)} />}
      {quotationDetailsRow && <QuotationDetailsModal row={quotationDetailsRow} onClose={() => setQuotationDetailsRow(null)} />}
      <AnimatePresence>
        {operationsReportModal && <SalesReportModal report={operationsReportModal} onClose={() => setOperationsReportModal(null)} />}
      </AnimatePresence>
      <AnimatePresence>
        {todayLeadsOpen && <TodayLeadsModal leads={salesTodayLeads} onClose={() => setTodayLeadsOpen(false)} />}
      </AnimatePresence>
      {annualReturnRow && (
        <AnnualReturnYearModal
          row={annualReturnRow}
          onClose={() => setAnnualReturnRow(null)}
          onSelectYear={openAnnualReturnYear}
        />
      )}
      <AnimatePresence>
        {clientAnalyticsOpen && (
          <ClientOwnershipAnalyticsModal rows={scopedOperationsRows} onClose={() => setClientAnalyticsOpen(false)} />
        )}
      </AnimatePresence>
      {modalOpen && (
        <AddUserModal
          form={form}
          saving={saving}
          error={error}
          onChange={setForm}
          onClose={closeModal}
          onSubmit={handleCreateUser}
          teams={teams}
          roles={availableRoles}
          onAddRole={handleCreateRole}
          canAddRole={hasAnyRole(currentUser, adminRoles)}
        />
      )}
      {teamModalOpen && (
        <CreateTeamModal
          users={users}
          saving={saving}
          error={error}
          onClose={() => {
            if (saving) return
            setTeamModalOpen(false)
          }}
          onSubmit={handleCreateTeam}
        />
      )}
      {detailsUser && (
        <UserDetailsModal
          user={detailsUser}
          onClose={() => setDetailsUser(null)}
          onEdit={() => openEdit(detailsUser)}
        />
      )}
      {editingUser && (
        <EditUserModal
          form={editForm}
          saving={saving}
          roles={availableRoles}
          onAddRole={handleCreateRole}
          canAddRole={hasAnyRole(currentUser, adminRoles)}
          onChange={setEditForm}
          onClose={() => {
            if (saving) return
            setEditingUser(null)
            setEditForm(defaultUserForm)
          }}
          onSubmit={handleUpdateUser}
        />
      )}
      {userLogsOpen && <UserLogsModal onClose={() => setUserLogsOpen(false)} />}
      {profileOpen && (
        <ProfileModal
          user={currentUser}
          saving={saving}
          onClose={() => setProfileOpen(false)}
          onLogout={handleLogout}
          onSave={handleUpdateProfile}
          onUpdatePassword={handleUpdatePassword}
        />
      )}
    </main>
  )
}
