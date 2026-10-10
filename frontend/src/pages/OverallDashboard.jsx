import POMonthlyDashboard from '../components/dashboard/POMonthlyDashboard'
import ApplicationPortfolio from '../components/dashboard/ApplicationPortfolio'
import ClientUploadTracker from '../components/dashboard/ClientUploadTracker'
import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { ArrowUpRight, BarChart3, CalendarDays, ChevronDown, Download, Loader2, RefreshCw, Users, ListChecks } from 'lucide-react'
import DashboardShell from '../components/dashboard/DashboardShell'
import PdfExportChoice from '../components/dashboard/PdfExportChoice'
import UserServiceMatrix from '../components/dashboard/UserServiceMatrix'
import FinancialYearTimeline from '../components/dashboard/FinancialYearTimeline'
import OverallClientPopup from '../features/clientMaster/OverallClientPopup'
import InlineApplicantClients from '../features/clientMaster/InlineApplicantClients'
import api from '../services/api'
import { hasAnyRole } from '../constants/dashboard'

const card = 'rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6'
function PortfolioTooltip({ active, payload }) {
  const row = payload?.find((entry) => entry.payload?.year)?.payload
  if (!active || !row) return null
  return <div className="min-w-52 rounded-2xl border border-teal-100 bg-white p-4 shadow-xl"><p className="text-xs font-bold text-teal-700">Financial year {row.year}</p><div className="my-3 flex items-center justify-between gap-5"><span className="text-xs text-slate-600">Clients with closed POs</span><strong className="text-2xl text-slate-900">{row.clients}</strong></div><p className="text-xs text-emerald-700">Active clients: {row.active}</p><p className="mt-1 text-xs text-amber-700">Inactive clients: {row.inactive}</p><p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-400">Click to view & export clients</p></div>
}
function InteractiveDot({ cx, cy, payload, stroke, onSelect }) {
  if (!payload?.year) return null
  return <circle cx={cx} cy={cy} r={6} fill="white" stroke={stroke} strokeWidth={3} role="button" tabIndex={0} aria-label={`View clients for ${payload.year}`} className="cursor-pointer outline-none focus:stroke-slate-900" onClick={(event) => { event.stopPropagation(); onSelect(payload.year) }} onKeyDown={(event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); onSelect(payload.year) } }} />
}
function YearMatrix({ section, onOpen, reducedMotion }) {
  const [expandedType, setExpandedType] = useState('')
  const regionPrefix = useId()
  const toggle = (type) => setExpandedType((current) => current === type ? '' : type)
  return <motion.section initial={reducedMotion ? false : { opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-teal-100 bg-gradient-to-r from-teal-50 via-white to-indigo-50 px-5 py-5 sm:px-6"><div className="flex items-center gap-3"><span className="rounded-2xl bg-teal-700 p-3 text-white"><CalendarDays size={22} /></span><div><p className="text-xs font-bold uppercase tracking-widest text-teal-700">Financial year</p><h3 className="mt-1 text-2xl font-black text-slate-900">{section.year}</h3></div></div><div className="flex flex-wrap items-center gap-3"><span className="rounded-full bg-white px-3 py-2 text-xs font-bold text-slate-600">{section.summary.clients} unique clients · {section.summary.services || 0} service records · {section.services.length} service types</span><button type="button" onClick={() => onOpen(section.year)} className="flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-teal-800">View client list<ArrowUpRight size={16} /></button></div></header>
    {!section.summary.clients ? <p className="px-6 py-10 text-center text-sm text-slate-500">No clients with closed purchase orders in {section.year}.</p> : <div className="overflow-auto"><table className="w-full border-separate border-spacing-0 text-left text-sm"><thead><tr><th className="sticky left-0 z-20 min-w-64 border-b border-slate-200 bg-slate-100 px-5 py-4 text-xs text-slate-700">Applicant / Sub-applicant type</th><th className="min-w-24 border-b border-slate-200 bg-slate-100 px-4 py-4 text-xs text-slate-700">Service Count</th>{section.services.map((service) => <th key={service} className="min-w-36 max-w-48 border-b border-slate-200 bg-slate-100 px-4 py-4 text-xs text-slate-700">{service}</th>)}</tr></thead><tbody>{section.groups.map((group, index) => {
      const expanded = expandedType === group.type
      const regionId = `${regionPrefix}-${index}`
      const serviceCount = Object.values(group.services || {}).reduce((sum, count) => sum + Number(count || 0), 0)
      return <React.Fragment key={group.type}><tr className={`group transition-colors ${expanded ? 'bg-teal-50' : 'hover:bg-teal-50/60'}`}><td className={`sticky left-0 z-10 border-b border-slate-100 px-5 py-4 group-hover:bg-teal-50 ${expanded ? 'bg-teal-50' : 'bg-white'}`}><button type="button" aria-expanded={expanded} aria-controls={regionId} onClick={() => toggle(group.type)} className="flex w-full items-center justify-between gap-3 text-left font-semibold text-teal-700"><span>{group.type}</span><ChevronDown size={16} className={`shrink-0 transition-transform duration-300 motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} /></button></td><td className="border-b border-slate-100 px-4 py-4"><button type="button" aria-label={`View ${serviceCount} ${group.type} service records for ${section.year}`} aria-expanded={expanded} aria-controls={regionId} onClick={() => toggle(group.type)} className="min-w-10 rounded-lg bg-teal-50 px-3 py-1.5 font-bold text-teal-800">{serviceCount}</button></td>{section.services.map((service) => <td key={service} className="border-b border-slate-100 px-4 py-4 text-center"><span className={group.services[service] ? 'rounded-lg bg-indigo-50 px-3 py-1.5 font-bold text-indigo-700' : 'text-slate-400'}>{group.services[service]}</span></td>)}</tr>
      <tr><td colSpan={section.services.length + 2} className="p-0"><AnimatePresence initial={false}>{expanded && <motion.div key={group.type} id={regionId} role="region" aria-label={`${group.type} clients for ${section.year}`} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reducedMotion ? 0 : .3, ease: [.22, 1, .36, 1] }} className="overflow-hidden"><InlineApplicantClients group={group} section={section} /></motion.div>}</AnimatePresence></td></tr></React.Fragment>
    })}</tbody></table></div>}
  </motion.section>
}
export default function OverallDashboard() {
  const [user] = useState(() => { try { return JSON.parse(localStorage.getItem('user') || '{}') } catch { return {} } })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [popup, setPopup] = useState(null)
  const [matrixYear, setMatrixYear] = useState('')
  const [view, setView] = useState('status')
  const [refreshToken, setRefreshToken] = useState(0)
  const selectedView = ['status', 'services', 'spoc', 'upload', 'po'].includes(view) ? view : 'status'
  const matrixView = ['overall', 'users'].includes(selectedView)
  const [exporting, setExporting] = useState(false)
  const [showPdfChoice, setShowPdfChoice] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportProgress, setExportProgress] = useState('')
  const pendingRequest = useRef(null)
  const requestSequence = useRef(0)
  const reducedMotion = useReducedMotion()
  const load = useCallback(async (signal) => {
    if (pendingRequest.current && !pendingRequest.current.signal?.aborted) return
    const sequence = ++requestSequence.current
    pendingRequest.current = { signal }
    setLoading(true)
    try {
      const response = await api.get('/dashboard-insights/overall', { signal, timeout: 45000 })
      if (sequence === requestSequence.current && !signal?.aborted) { setData(response.data); setError('') }
    } catch (err) {
      if (sequence === requestSequence.current && err.code !== 'ERR_CANCELED') setError(err.response?.data?.error || 'Dashboard request timed out or could not load. Please refresh and retry.')
    } finally {
      if (sequence === requestSequence.current) { pendingRequest.current = null; if (!signal?.aborted) setLoading(false) }
    }
  }, [])
  useEffect(() => { if (!matrixView) { setLoading(false); return } const controller = new AbortController(); load(controller.signal); const timer = setInterval(() => { if (document.visibilityState === 'visible') load(controller.signal) }, 60000); return () => { controller.abort(); clearInterval(timer) } }, [load, matrixView])
  async function exportPdf(exportView) {
    if (!data || exporting || (exportView === 'users' && !canViewUsers)) return
    setShowPdfChoice(false)
    setExporting(true); setExportError('')
    try {
      const { downloadOverallDashboardPdf } = await import('../utils/overallDashboardPdf.mjs')
      await downloadOverallDashboardPdf(data, { view: exportView, onProgress: setExportProgress })
    } catch (err) { setExportError(err.message || 'PDF export could not complete. Please retry.') }
    finally { setExporting(false); setExportProgress('') }
  }
  const closePopup = useCallback(() => setPopup(null), [])
  const openYear = useCallback((year, type = '') => { if (year) setPopup({ year, type }) }, [])
  const canViewUsers = hasAnyRole(user, ['admin', 'superadmin', 'manager']) && data?.canViewUsers !== false
  const sections = data?.yearSections || []
  const trends = data?.trends || []
  const activeSection = sections.find((section) => section.year === matrixYear) || sections[0]
  const popupSection = popup?.section || sections.find((section) => section.year === popup?.year)
  const chartClick = (state) => { const year = state?.activeLabel || (state?.activeTooltipIndex != null ? trends[Number(state.activeTooltipIndex)]?.year : null); if (year) openYear(year) }
  const yearButtons = <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">{trends.map((row) => <button key={row.year} type="button" onClick={() => openYear(row.year)} aria-label={`Open ${row.year} client list`} className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-teal-50 hover:text-teal-800">{row.year}<span className="ml-2 text-teal-700">{row.clients}</span></button>)}</div>
  return <DashboardShell currentUser={user}><main className="min-h-full space-y-6 bg-slate-50 p-4 sm:p-6 lg:p-8">
    <motion.header initial={reducedMotion ? false : { opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="relative flex flex-wrap items-center justify-between gap-5 overflow-hidden rounded-3xl border border-teal-100 bg-gradient-to-br from-teal-50 via-white to-cyan-50 p-6 text-slate-900 shadow-sm sm:p-8"><div className="pointer-events-none absolute -right-14 -top-24 h-72 w-72 rounded-full border-[40px] border-teal-100/40" /><div className="relative"><p className="text-xs font-bold uppercase tracking-[.2em] text-teal-700">Portfolio intelligence</p><h1 className="mt-2 flex items-center gap-3 text-2xl font-black sm:text-3xl"><BarChart3 className="text-teal-700" />Application Dashboard</h1><p className="mt-3 max-w-2xl text-sm text-slate-600">{['spoc', 'status', 'services'].includes(selectedView) ? 'Assigned application insights by SPOC, PIBo category and saved CPCB status.' : selectedView === 'upload' ? 'Live SLA and Purchase / Sales progress for allocated clients, grouped by user and financial year.' : selectedView === 'po' ? 'Monthly purchase order counts and values by lead owner, through the current month.' : 'Closed purchase order insights from 2025-26. Each company counts once per financial year.'}</p><div className="mt-4 flex flex-wrap gap-2 text-xs"><span className="rounded-full border border-teal-100 bg-white/80 px-3 py-1.5 text-teal-800">{data?.visibility === 'all' ? 'All users' : data?.visibility === 'team' ? 'My team & my clients' : 'My clients'}</span><span className="rounded-full border border-teal-100 bg-white/80 px-3 py-1.5 text-teal-800">{selectedView === 'po' ? 'PO Count · Refreshes every minute' : !matrixView ? 'Allocated clients · Refreshes every minute' : 'Closed POs only · Refreshes every minute'}</span></div></div><div className="relative flex flex-wrap items-center gap-3">{matrixView && <button type="button" onClick={() => setShowPdfChoice(true)} disabled={!data || loading || exporting} className="flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60">{exporting ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}{exporting ? 'Preparing PDF…' : 'Download PDF'}</button>}<button type="button" onClick={() => matrixView ? load() : setRefreshToken(token => token + 1)} disabled={matrixView && loading} className="flex items-center gap-2 rounded-xl border border-teal-200 bg-white/80 px-4 py-3 text-sm font-bold text-teal-800 transition hover:bg-teal-50 disabled:opacity-60"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} />Refresh</button></div></motion.header>
    {exportProgress && <p role="status" className="px-1 text-sm text-teal-700">{exportProgress}</p>}
    {exportError && <p role="alert" className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">{exportError}</p>}
    {error && <div role="alert" className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}
    <div role="tablist" aria-label="Dashboard view" className="inline-flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2">{[['status', 'Application Status Summary'], ['services', 'Application servise Summary'], ['spoc', 'By SPOC & PIBo'], ['upload', 'Purchase & Sales Dashboard'], ['po', 'PO Dashboard']].map(([key, label]) => <button key={key} id={`dashboard-tab-${key}`} type="button" role="tab" aria-selected={selectedView === key} aria-controls={['spoc', 'status', 'services'].includes(key) ? `portfolio-${key}` : key === 'upload' ? 'upload-tracker-panel' : key === 'po' ? 'po-monthly-panel' : 'overall-year-matrix'} onClick={() => setView(key)} className={`rounded-xl px-5 py-3 text-sm font-bold transition ${selectedView === key ? 'bg-teal-700 text-white shadow-sm' : 'text-slate-600 hover:bg-teal-50'}`}>{key === 'spoc' && <Users size={16} className="mr-2 inline" />}{['status', 'services'].includes(key) && <ListChecks size={16} className="mr-2 inline" />}{label}</button>)}</div>
    {matrixView && <div className="flex flex-wrap items-center justify-between gap-3 px-1"><div><h2 className="text-xl font-black text-slate-900">Applicant / Sub-applicant service matrix</h2><p className="mt-2 text-xs text-slate-500">Select a financial year below. Only services with closed POs appear. Expand an applicant type for client details.</p></div><span className="rounded-full border border-teal-100 bg-teal-50 px-4 py-2 text-xs font-bold text-teal-700">From 2025-26 · {sections.length} financial years</span></div>}
    {matrixView && loading && !data && <div aria-label="Loading yearly matrices" className="h-64 animate-pulse rounded-3xl bg-slate-200/70" />}
    {matrixView && activeSection && <FinancialYearTimeline sections={sections} selectedYear={activeSection.year} onSelect={setMatrixYear} reducedMotion={reducedMotion} />}
    {['spoc', 'status', 'services'].includes(selectedView) && <ApplicationPortfolio mode={selectedView} refreshToken={refreshToken} />}
    {selectedView === 'po' && <POMonthlyDashboard refreshToken={refreshToken} />}
    {selectedView === 'upload' && <ClientUploadTracker financialYear={activeSection?.year || '2025-26'} refreshToken={refreshToken} />}
    {matrixView && <AnimatePresence mode="wait" initial={false}>{activeSection && <motion.div key={`${selectedView}-${activeSection.year}`} role="tabpanel" id="overall-year-matrix" aria-labelledby={`dashboard-tab-${selectedView} matrix-year-${activeSection.year}`} initial={reducedMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? {} : { opacity: 0, y: -8 }} transition={{ duration: reducedMotion ? 0 : .18 }}><div>{selectedView === 'overall' ? <YearMatrix section={activeSection} onOpen={openYear} reducedMotion={reducedMotion} /> : <UserServiceMatrix section={activeSection} users={data?.userSections || []} Matrix={YearMatrix} onOpen={(section, userId) => setPopup({ year: section.year, type: '', section, userId })} reducedMotion={reducedMotion} />}</div></motion.div>}</AnimatePresence>}
    {matrixView && <div className="grid gap-5 xl:grid-cols-2"><section className={card}><h2 className="font-black text-slate-900">Client portfolio by financial year</h2><p className="mb-6 mt-2 text-xs text-slate-500">Hover for closed PO client counts. Click a bar to view & export the full list.</p><div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={trends} accessibilityLayer onClick={chartClick}><defs><linearGradient id="overallActive" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#14b8a6" /><stop offset="100%" stopColor="#0f766e" /></linearGradient></defs><CartesianGrid strokeDasharray="3 6" stroke="#e2e8f0" vertical={false} /><XAxis dataKey="year" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} /><Tooltip content={<PortfolioTooltip />} cursor={{ fill: '#f0fdfa' }} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 16 }} /><Bar dataKey="active" name="Active clients" fill="url(#overallActive)" stackId="clients" maxBarSize={64} radius={[4, 4, 0, 0]} isAnimationActive={!reducedMotion} animationDuration={650} cursor="pointer" onClick={(entry) => openYear(entry.payload?.year || entry.year)} /><Bar dataKey="inactive" name="Inactive clients" fill="#f59e0b" stackId="clients" maxBarSize={64} radius={[4, 4, 0, 0]} isAnimationActive={!reducedMotion} animationDuration={650} cursor="pointer" onClick={(entry) => openYear(entry.payload?.year || entry.year)} /></BarChart></ResponsiveContainer></div>{yearButtons}</section>
    <section className={card}><h2 className="font-black text-slate-900">Client growth trend</h2><p className="mb-6 mt-2 text-xs text-slate-500">Unique clients with closed POs each year. Click a point to explore clients.</p><div className="h-72"><ResponsiveContainer width="100%" height="100%"><LineChart data={trends} accessibilityLayer onClick={chartClick}><CartesianGrid strokeDasharray="3 6" stroke="#e2e8f0" vertical={false} /><XAxis dataKey="year" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} /><Tooltip content={<PortfolioTooltip />} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 16 }} /><Line type="monotone" dataKey="clients" name="Unique clients" stroke="#4f46e5" strokeWidth={3} dot={<InteractiveDot onSelect={openYear} />} activeDot={<InteractiveDot onSelect={openYear} />} isAnimationActive={!reducedMotion} animationDuration={700} /><Line type="monotone" dataKey="inactive" name="Inactive clients" stroke="#f59e0b" strokeWidth={2} dot={<InteractiveDot onSelect={openYear} />} activeDot={<InteractiveDot onSelect={openYear} />} isAnimationActive={!reducedMotion} animationDuration={700} /></LineChart></ResponsiveContainer></div>{yearButtons}</section></div>}
    {showPdfChoice && <PdfExportChoice canViewUsers={canViewUsers} onChoose={exportPdf} onClose={() => setShowPdfChoice(false)} />}
    <AnimatePresence>{popupSection && <OverallClientPopup key={`${popup.year}-${popup.type}`} section={popupSection} type={popup.type} onClose={closePopup} />}</AnimatePresence>
  </main></DashboardShell>
}
