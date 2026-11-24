import React, { useEffect, useMemo, useState } from 'react'
import { ClipboardCheck, Eye, Loader2, Plus, RefreshCw, UserRoundCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import DashboardShell from '../components/dashboard/DashboardShell'
import SearchableSelect from '../components/form/SearchableSelect'
import api from '../services/api'
import { API_ENDPOINTS } from '../services/apiEndpoints'

export default function HealthReportCheck() {
  const currentUser = JSON.parse(localStorage.getItem('user') || 'null')
  const role = String(currentUser?.role || '').toLowerCase()
  const isManager = ['manager', 'admin', 'superadmin'].includes(role)
  const navigate = useNavigate()
  const [assignments, setAssignments] = useState([])
  const [users, setUsers] = useState([])
  const [selectedUsers, setSelectedUsers] = useState({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [error, setError] = useState('')

  async function load() {
    setLoading(true); setError('')
    try {
      const requests = [api.get(API_ENDPOINTS.healthReports.list)]
      if (isManager) requests.push(api.get(API_ENDPOINTS.auth.users))
      const [assignmentResponse, userResponse] = await Promise.all(requests)
      setAssignments(assignmentResponse.data?.assignments || [])
      setUsers((userResponse?.data?.users || userResponse?.data || []).filter((user) => user.isActive !== false && !['manager', 'admin', 'superadmin'].includes(String(user.role || '').toLowerCase())))
    } catch (requestError) { setError(requestError?.response?.data?.error || 'Unable to load Health Report assignments.') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])
  const userOptions = useMemo(() => users.map((user) => ({ value: user._id || user.id, label: `${user.name || user.email} (${user.role || 'User'})` })), [users])

  async function assignUser(item) {
    const userId = selectedUsers[item._id]
    if (!userId) return setError('Please select a user first.')
    setSavingId(item._id); setError('')
    try { await api.patch(API_ENDPOINTS.healthReports.assign(item._id), { userId }); await load() }
    catch (requestError) { setError(requestError?.response?.data?.error || 'Unable to assign user.') }
    finally { setSavingId('') }
  }

  return <DashboardShell currentUser={currentUser}>
    <main className="min-h-screen bg-[#f3f8f6] p-4 lg:p-6">
      <header className="flex flex-col gap-4 rounded-3xl border border-emerald-100 bg-gradient-to-r from-emerald-50 to-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-xs font-black uppercase tracking-[.2em] text-orange-500">Compliance workspace</p><h1 className="mt-1 text-3xl font-black text-slate-950">Health Report Check</h1><p className="mt-2 text-sm font-semibold text-slate-500">Managers assign the report; assigned users select the existing Health Report and complete it.</p></div>
        <div className="flex gap-2"><button type="button" onClick={load} className="inline-flex h-11 items-center gap-2 rounded-xl border bg-white px-4 font-black text-emerald-700"><RefreshCw className="h-4 w-4" />Refresh</button>{!isManager && <button type="button" onClick={() => document.getElementById('health-report-list')?.scrollIntoView({ behavior: 'smooth' })} className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-700 px-5 font-black text-white"><Plus className="h-4 w-4" />Health Report</button>}</div>
      </header>
      {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 font-bold text-red-700">{error}</div>}
      <section id="health-report-list" className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b p-5"><h2 className="text-xl font-black">Choose Existing Health Report</h2><p className="mt-1 text-sm text-slate-500">Only reports assigned to your account are shown.</p></div>
        <div className="max-h-[650px] overflow-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Lead ID','Company Name','Manager','Assigned User','Status','Assignment','Open'].map((label) => <th key={label} className="p-4">{label}</th>)}</tr></thead><tbody>
          {loading ? <tr><td colSpan="7" className="p-14 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></td></tr> : assignments.map((item) => <tr key={item._id} className="border-t"><td className="p-4 font-black text-emerald-700">{item.lead?.leadCode || item.leadCode || '-'}</td><td className="p-4 font-black">{item.lead?.company || item.companyName}</td><td className="p-4">{item.manager?.name || '-'}</td><td className="p-4">{item.assignedUser?.name || 'Not assigned'}</td><td className="p-4"><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">{String(item.status || '').replaceAll('_', ' ')}</span></td><td className="min-w-72 p-4">{isManager ? <div className="flex items-center gap-2"><div className="min-w-56 flex-1"><SearchableSelect value={selectedUsers[item._id] || item.assignedUser?._id || ''} options={userOptions} onChange={(value) => setSelectedUsers((current) => ({ ...current, [item._id]: value }))} placeholder="Please select user" /></div><button type="button" disabled={savingId === item._id} onClick={() => assignUser(item)} className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-700 text-white disabled:opacity-50"><UserRoundCheck className="h-4 w-4" /></button></div> : <span className="text-xs font-bold text-slate-500">Assigned by manager</span>}</td><td className="p-4"><button type="button" disabled={!item.assignedUser && !isManager} onClick={() => navigate(`/sales/compliance-health-report/${item.lead?._id || item.lead}`)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-200 px-4 font-black text-emerald-700 disabled:opacity-40"><Eye className="h-4 w-4" />Open</button></td></tr>)}
          {!loading && !assignments.length && <tr><td colSpan="7" className="p-16 text-center"><ClipboardCheck className="mx-auto h-10 w-10 text-slate-300" /><p className="mt-3 font-black text-slate-500">No Health Reports assigned.</p></td></tr>}
        </tbody></table></div>
      </section>
    </main>
  </DashboardShell>
}
