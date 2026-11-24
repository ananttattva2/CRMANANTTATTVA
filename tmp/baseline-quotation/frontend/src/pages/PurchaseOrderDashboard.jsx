import React, { useEffect, useMemo, useState } from 'react'
import { BarChart3, CheckCircle2, CircleDollarSign, Clock3, FileCheck2, RefreshCw, Search, UsersRound } from 'lucide-react'
import DashboardShell from '../components/dashboard/DashboardShell'
import api, { API_ENDPOINTS, readApiError, storeSessionUser } from '../services/api'

const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value) || 0)
const date = (value) => value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(value)) : '—'
const cachedUser = () => { try { return JSON.parse(localStorage.getItem('user') || '{}') } catch { return {} } }

function Metric({ icon: Icon, label, value, note, tone }) {
  return <article className="group relative overflow-hidden rounded-3xl border border-white/80 bg-white p-5 shadow-[0_18px_50px_-30px_rgba(15,118,110,.5)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_60px_-26px_rgba(15,118,110,.55)]">
    <div className={`absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-20 blur-2xl ${tone}`} />
    <div className="relative flex items-start justify-between gap-4"><div><p className="text-[11px] font-black uppercase tracking-[.2em] text-slate-400">{label}</p><p className="mt-2 text-3xl font-black tracking-tight text-slate-900">{value}</p><p className="mt-2 text-xs font-semibold text-slate-500">{note}</p></div><span className={`grid h-12 w-12 place-items-center rounded-2xl text-white shadow-lg ${tone}`}><Icon size={22}/></span></div>
  </article>
}

function Distribution({ title, rows, color }) {
  const max = Math.max(1, ...rows.map((row) => row.count))
  return <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
    <div className="mb-5 flex items-center justify-between"><div><p className="text-base font-black text-slate-900">{title}</p><p className="text-xs text-slate-500">Live PO distribution</p></div><BarChart3 className="text-slate-400" size={20}/></div>
    <div className="space-y-4">{rows.length ? rows.map((row) => <div key={row.label}><div className="mb-1.5 flex justify-between gap-3 text-xs font-bold"><span className="truncate text-slate-700">{row.label}</span><span className="text-slate-500">{row.count}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${Math.max(5, row.count / max * 100)}%` }}/></div></div>) : <p className="py-8 text-center text-sm text-slate-400">No PO classification data yet.</p>}</div>
  </section>
}

export default function PurchaseOrderDashboard() {
  const [currentUser, setCurrentUser] = useState(cachedUser)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('ALL')

  async function load() {
    setLoading(true); setError('')
    try {
      const [insights, me] = await Promise.all([api.get(API_ENDPOINTS.dashboardInsights.purchaseOrders), api.get(API_ENDPOINTS.auth.me).catch(() => null)])
      setData(insights.data)
      if (me?.data?.user) setCurrentUser(storeSessionUser(me.data.user))
    } catch (err) { setError(readApiError(err, 'PO dashboard could not be loaded.')) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  const records = useMemo(() => (data?.records || []).filter((row) => {
    const matchesText = `${row.poNumber} ${row.clientName} ${row.ownerName} ${row.financialYear}`.toLowerCase().includes(query.toLowerCase())
    const closed = row.approvalStatus === 'APPROVED'
    return matchesText && (status === 'ALL' || (status === 'CLOSED' ? closed : !closed))
  }), [data, query, status])
  const summary = data?.summary || {}

  return <DashboardShell currentUser={currentUser}><div className="min-h-full bg-[radial-gradient(circle_at_top_left,_#d1fae5_0,_transparent_32%),linear-gradient(135deg,#f8fafc,#ecfdf5)] p-4 sm:p-6 lg:p-8">
    <header className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-950 via-emerald-950 to-teal-700 px-6 py-7 text-white shadow-2xl shadow-emerald-900/20 sm:px-8">
      <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full border-[42px] border-white/5"/><div className="relative flex flex-wrap items-end justify-between gap-5"><div><p className="text-xs font-black uppercase tracking-[.3em] text-emerald-300">Purchase order intelligence</p><h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">PO Command Center</h1><p className="mt-2 max-w-2xl text-sm text-emerald-50/75">Your role-based view of received, open and closed purchase orders. Applicant categories expand automatically from live data.</p></div><button onClick={load} disabled={loading} className="flex items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-black backdrop-blur transition hover:bg-white/20 disabled:opacity-60"><RefreshCw size={17} className={loading ? 'animate-spin' : ''}/>Refresh data</button></div>
    </header>
    {error && <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div>}
    <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <Metric icon={FileCheck2} label="Total PO" value={summary.total || 0} note="PO records received" tone="bg-gradient-to-br from-violet-500 to-indigo-600"/>
      <Metric icon={Clock3} label="Open PO" value={summary.open || 0} note="Awaiting closure" tone="bg-gradient-to-br from-amber-400 to-orange-500"/>
      <Metric icon={CheckCircle2} label="Closed PO" value={summary.closed || 0} note="Approved / completed" tone="bg-gradient-to-br from-emerald-400 to-teal-600"/>
      <Metric icon={UsersRound} label="Clients" value={summary.clients || 0} note="Unique client count" tone="bg-gradient-to-br from-sky-400 to-blue-600"/>
      <Metric icon={CircleDollarSign} label="PO Value" value={money(summary.amount)} note="Combined visible value" tone="bg-gradient-to-br from-fuchsia-500 to-purple-600"/>
    </div>
    {loading && !data ? <div className="mt-6 h-72 animate-pulse rounded-3xl bg-white/70"/> : <>
      <div className="mt-6 grid gap-5 xl:grid-cols-2"><Distribution title="Applicant Types" rows={data?.applicantTypes || []} color="bg-gradient-to-r from-orange-400 to-rose-500"/><Distribution title="Sub-applicant Types" rows={data?.subApplicantTypes || []} color="bg-gradient-to-r from-sky-400 to-indigo-500"/></div>
      <section className="mt-6 overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-black text-slate-900">Team PO performance</h2><p className="text-xs text-slate-500">Client count is unique per user; PO columns are record totals.</p></div><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">User</th><th className="px-5 py-3">Clients</th><th className="px-5 py-3">Total PO</th><th className="px-5 py-3">Open</th><th className="px-5 py-3">Closed</th><th className="px-5 py-3">PO value</th></tr></thead><tbody className="divide-y divide-slate-100">{(data?.users || []).map((row) => <tr key={row.userId || row.userName} className="transition hover:bg-emerald-50/50"><td className="px-5 py-4"><p className="font-black text-slate-800">{row.userName}</p><p className="text-xs capitalize text-slate-400">{row.role || 'Team member'}</p></td><td className="px-5 py-4 font-bold">{row.clients}</td><td className="px-5 py-4 font-bold">{row.total}</td><td className="px-5 py-4 text-amber-600">{row.open}</td><td className="px-5 py-4 text-emerald-600">{row.closed}</td><td className="px-5 py-4 font-black">{money(row.amount)}</td></tr>)}</tbody></table></div></section>
      <section className="mt-6 overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div><h2 className="font-black text-slate-900">Purchase order register</h2><p className="text-xs text-slate-500">{records.length} visible records</p></div><div className="flex flex-wrap gap-2"><label className="flex min-w-56 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2"><Search size={16} className="text-slate-400"/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search PO, client or user" className="w-full bg-transparent text-sm outline-none"/></label><select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none"><option value="ALL">All status</option><option value="OPEN">Open</option><option value="CLOSED">Closed</option></select></div></div><div className="max-h-[520px] overflow-auto"><table className="min-w-[920px] w-full text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">PO number</th><th className="px-5 py-3">Client</th><th className="px-5 py-3">Owner</th><th className="px-5 py-3">Applicant</th><th className="px-5 py-3">FY</th><th className="px-5 py-3">Received</th><th className="px-5 py-3">Value</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{records.map((row) => <tr key={row.id} className="hover:bg-slate-50"><td className="px-5 py-4 font-black text-teal-700">{row.poNumber || '—'}</td><td className="px-5 py-4 font-bold text-slate-800">{row.clientName}</td><td className="px-5 py-4">{row.ownerName}</td><td className="px-5 py-4"><p>{row.applicantType}</p><p className="text-xs text-slate-400">{row.subApplicantType}</p></td><td className="px-5 py-4">{row.financialYear || '—'}</td><td className="px-5 py-4">{date(row.poReceivedDate)}</td><td className="px-5 py-4 font-bold">{money(row.poAmount)}</td><td className="px-5 py-4"><span className={`rounded-full px-3 py-1 text-xs font-black ${row.approvalStatus === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{row.approvalStatus === 'APPROVED' ? 'Closed' : 'Open'}</span></td></tr>)}</tbody></table>{!records.length && <p className="py-12 text-center text-sm text-slate-400">No purchase orders match this view.</p>}</div></section>
    </>}
  </div></DashboardShell>
}
