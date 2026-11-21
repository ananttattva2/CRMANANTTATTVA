import React, { useEffect, useMemo, useState } from 'react'
import { FileText, RefreshCw, Search } from 'lucide-react'
import DashboardShell from '../components/dashboard/DashboardShell'
import api from '../services/api'
import useCrmRefresh from '../hooks/useCrmRefresh'

export default function Legal() {
  const [user] = useState(() => { try { return JSON.parse(localStorage.getItem('user') || '{}') } catch { return {} } })
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('All')
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    api.get('/dashboard-insights/legal', { signal: controller.signal, timeout: 45000 }).then(response => {
      if (!controller.signal.aborted) setRows(response.data.rows || [])
    }).catch(err => {
      if (!controller.signal.aborted) setError(err.response?.data?.error || 'Unable to load Legal SLA records. Please retry.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [refresh])
  useCrmRefresh(() => setRefresh(value => value + 1), true, loading)
  const counts = useMemo(() => ({ Yes: rows.filter(row => row.slaStatus === 'Yes').length, No: rows.filter(row => row.slaStatus === 'No').length }), [rows])
  const shown = useMemo(() => rows.filter(row => (status === 'All' || row.slaStatus === status) && `${row.clientName} ${row.userName}`.toLowerCase().includes(query.trim().toLowerCase())), [rows, query, status])
  return <DashboardShell currentUser={user}><main className="space-y-6 p-4 sm:p-7">
    <header className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-teal-100 bg-white p-6 shadow-sm"><div><p className="text-xs font-bold uppercase tracking-widest text-teal-700">Legal</p><h1 className="mt-2 flex items-center gap-3 text-2xl font-black text-slate-900"><FileText className="text-teal-700" />Client SLA Register</h1><p className="mt-2 text-sm text-slate-500">Track SLA receipt for each client and assigned user.</p></div><button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)} className="flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} />Refresh</button></header>
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm" aria-label="Client SLA status">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 p-5"><div className="flex flex-wrap gap-2" role="group" aria-label="Filter SLA status">{['All', 'Yes', 'No'].map(value => <button type="button" key={value} aria-pressed={status === value} onClick={() => setStatus(value)} className={`rounded-xl px-4 py-2 text-sm font-bold ${status === value ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`}>{value === 'All' ? 'All Clients' : `SLA ${value}`} <span className="ml-2">{value === 'All' ? rows.length : counts[value]}</span></button>)}</div><label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-slate-500"><Search size={17} /><input aria-label="Search client or user" placeholder="Search client or user" value={query} onChange={event => setQuery(event.target.value)} className="w-full bg-transparent text-sm outline-none" /></label></div>
      {error ? <div role="alert" className="p-6 text-rose-700">{error}<button type="button" onClick={() => setRefresh(value => value + 1)} className="ml-3 underline">Retry</button></div> : loading ? <p role="status" className="p-10 text-center text-slate-500">Loading SLA records…</p> : <div className="overflow-x-auto"><table className="w-full min-w-[640px] border-collapse text-left text-sm"><thead className="bg-teal-50 text-teal-900"><tr><th scope="col" rowSpan={2} className="px-6 py-4">Client Name</th><th scope="col" rowSpan={2} className="px-6 py-4">User Name</th><th scope="colgroup" colSpan={2} className="border-l border-teal-100 px-6 py-3 text-center">SLA Status</th></tr><tr>{['Yes', 'No'].map(value => <th scope="col" key={value} className={`px-6 py-3 text-center ${value === 'Yes' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{value}</th>)}</tr></thead><tbody>{shown.map(row => <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50"><td className="px-6 py-4 font-semibold text-slate-800">{row.clientName}</td><td className="px-6 py-4 text-slate-600">{row.userName}</td>{['Yes', 'No'].map(value => <td key={value} className="px-6 py-4 text-center">{row.slaStatus === value ? <span aria-label={`SLA ${value}`} className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${value === 'Yes' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{value}</span> : <span className="text-slate-300">—</span>}</td>)}</tr>)}{!shown.length && <tr><td colSpan={4} className="p-10 text-center text-slate-500">No clients match this filter.</td></tr>}</tbody><tfoot className="bg-slate-50 font-bold text-slate-700"><tr><th scope="row" colSpan={2} className="px-6 py-4">Total · {shown.length} client allocations</th><td className="px-6 py-4 text-center">{shown.filter(row => row.slaStatus === 'Yes').length}</td><td className="px-6 py-4 text-center">{shown.filter(row => row.slaStatus === 'No').length}</td></tr></tfoot></table></div>}
      <footer className="space-y-1 border-t border-slate-100 p-5 text-xs leading-relaxed text-slate-500"><p>Missing SLA receipt is shown as No until Yes is saved in Client Master.</p><p>Weekly reminders: Monday, 10:00 AM IST. Pending clients are emailed to their assigned user, Admin, Super Admin and legal@ananttattva.com.</p></footer>
    </section>
  </main></DashboardShell>
}
