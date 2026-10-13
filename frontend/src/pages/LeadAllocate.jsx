import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, RefreshCw, Search, ShieldCheck, UserCheck, UserPlus, Users } from 'lucide-react'
import DashboardShell from '../components/dashboard/DashboardShell'
import ProfileModal from '../components/dashboard/ProfileModal'
import api, { API_ENDPOINTS } from '../services/api'

function idOf(value) {
  return String(value?._id || value?.id || value || '').trim()
}

function ownerId(lead) {
  return idOf(lead.generatedForUser) || idOf(lead.createdBy)
}

function ownerName(lead) {
  const owner = lead.generatedForUser?.name || lead.generatedForName || lead.createdBy?.name || lead.createdByName || lead.createdByEmail || lead.importedCreatedBy || 'Not allocated'
  return owner
}

function creatorName(lead) {
  return lead.createdBy?.name || lead.createdByName || lead.createdByEmail || lead.importedCreatedBy || 'Unknown creator'
}

function creatorId(lead) {
  return idOf(lead.createdBy)
}

function CreatorEditors({ lead, users, saving, onChange }) {
  return <div className="min-w-[220px] space-y-3">
    {['primary', 'secondary'].map((slot) => {
      const primary = slot === 'primary'
      const value = primary ? creatorId(lead) : idOf(lead.secondaryCreatedBy)
      const other = primary ? idOf(lead.secondaryCreatedBy) : creatorId(lead)
      const name = primary ? creatorName(lead) : lead.secondaryCreatedByName || 'Secondary user'
      return <label key={slot} className="block text-[10px] font-black uppercase tracking-wide text-violet-700">
        {primary ? 'Primary user' : 'Secondary user (optional)'}
        <select aria-label={`${primary ? 'Primary' : 'Secondary'} editor for ${lead.company || lead.leadCode}`} disabled={saving} value={value} onChange={(event) => onChange(lead, event.target.value, slot)} className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2.5 text-xs font-bold normal-case tracking-normal text-slate-800 outline-none focus:ring-4 focus:ring-violet-100">
          <option value="" disabled={primary}>{primary ? 'Select primary user' : 'No secondary user'}</option>
          {value && !users.some((user) => idOf(user) === value) && <option value={value}>{name} (inactive)</option>}
          {users.map((user) => <option key={idOf(user)} value={idOf(user)} disabled={idOf(user) === other}>{user.name || user.email}</option>)}
        </select>
      </label>
    })}
    <small className="block text-[10px] font-semibold text-slate-500">Both assigned users can view and edit this lead.</small>
  </div>
}

export default function LeadAllocate() {
  const navigate = useNavigate()
  const [currentUser, setCurrentUser] = useState(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [leads, setLeads] = useState([])
  const [admins, setAdmins] = useState([])
  const [search, setSearch] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 })
  const [summary, setSummary] = useState({ total: 0, allocated: 0, unassigned: 0 })
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [message, setMessage] = useState(null)

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const [meResult, leadResult, userResult] = await Promise.all([
        api.get(API_ENDPOINTS.auth.me),
        api.get(API_ENDPOINTS.leads.list, { params: {
          paginated: true,
          page,
          limit: 25,
          search: search.trim() || undefined,
          allocationOwner: ownerFilter === 'all' ? undefined : ownerFilter
        } }),
        api.get(API_ENDPOINTS.auth.users)
      ])
      setCurrentUser(meResult.data?.user || meResult.data)
      setLeads(leadResult.data?.leads || [])
      setPagination(leadResult.data?.pagination || { page, total: 0, totalPages: 1 })
      setSummary(leadResult.data?.summary || { total: 0, allocated: 0, unassigned: 0 })
      const users = userResult.data?.users || userResult.data || []
      setAdmins(users.filter((user) => user.isActive !== false))
    } catch (error) {
      setMessage({ kind: 'error', text: error.response?.data?.error || 'Unable to load lead allocation data.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => load(), search.trim() ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [page, search, ownerFilter])

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return leads.filter((lead) => {
      const currentOwner = ownerId(lead)
      if (ownerFilter === 'unassigned' && currentOwner) return false
      if (ownerFilter !== 'all' && ownerFilter !== 'unassigned' && currentOwner !== ownerFilter) return false
      if (!query) return true
      return [lead.leadCode, lead.company, lead.contactPerson, lead.mobileNo1, lead.emails, ownerName(lead), lead.status]
        .some((value) => String(value || '').toLowerCase().includes(query))
    })
  }, [leads, ownerFilter, search])

  const counts = useMemo(() => ({
    total: Number(summary.total || pagination.total || 0),
    allocated: Number(summary.allocated || 0),
    unassigned: Number(summary.unassigned || 0)
  }), [pagination.total, summary])

  const allocate = async (lead, userId) => {
    if (!userId || savingId) return
    const leadId = idOf(lead)
    try {
      setSavingId(leadId)
      const result = await api.patch(API_ENDPOINTS.leads.allocation(leadId), { userId })
      setLeads((current) => current.map((item) => idOf(item) === leadId ? result.data.lead : item))
      const delivery = result.data.emailDelivery
      const emailNote = delivery?.sent ? ` Assignment email sent to ${delivery.recipient}.` : delivery?.requested ? ' Allocation saved, but the email could not be delivered.' : ' Allocation saved; this user has no email address.'
      setMessage({ kind: delivery?.requested && !delivery?.sent ? 'error' : 'success', text: `${result.data.message || 'Lead allocation saved in database.'}${emailNote}` })
    } catch (error) {
      setMessage({ kind: 'error', text: error.response?.data?.error || 'Unable to allocate this lead.' })
    } finally {
      setSavingId('')
    }
  }

  const updateCreator = async (lead, userId, slot = 'primary') => {
    if ((!userId && slot === 'primary') || savingId) return
    const leadId = idOf(lead)
    try {
      setSavingId(`creator-${leadId}`)
      const result = await api.patch(API_ENDPOINTS.leads.creator(leadId), { userId, slot })
      setLeads((current) => current.map((item) => idOf(item) === leadId ? result.data.lead : item))
      setMessage({ kind: 'success', text: result.data.message || 'Created By saved in database.' })
    } catch (error) {
      setMessage({ kind: 'error', text: error.response?.data?.error || 'Unable to update Created By.' })
    } finally {
      setSavingId('')
    }
  }

  const logout = async () => {
    await api.post(API_ENDPOINTS.auth.logout, {}).catch(() => {})
    localStorage.clear()
    navigate('/')
  }

  return <DashboardShell currentUser={currentUser} onOpenProfile={() => setProfileOpen(true)} onLogout={logout}>
    <main className="min-h-screen bg-[linear-gradient(180deg,#eef7ff_0%,#f8fafc_46%,#f1f5f9_100%)] px-4 py-6 sm:px-6 lg:px-8">
      <section className="overflow-hidden rounded-[28px] border border-white bg-white/90 p-6 shadow-[0_20px_70px_rgba(15,23,42,.08)] sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex items-center gap-4">
            <span className="grid h-16 w-16 place-items-center rounded-3xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white shadow-xl shadow-indigo-200"><UserPlus className="h-8 w-8" /></span>
            <div><div className="mb-2 inline-flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-[10px] font-black uppercase tracking-[.2em] text-indigo-700 ring-1 ring-indigo-200"><ShieldCheck className="h-3.5 w-3.5" /> Admin controlled</div><h1 className="text-3xl font-black tracking-tight text-slate-950">Lead <span className="text-indigo-600">Allocate</span></h1><p className="mt-2 text-sm font-semibold text-slate-500">Assign Primary and optional Secondary users to give both lead editing access. Lead Owner, manager and staff assignments are managed separately.</p></div>
          </div>
          <div className="flex gap-2"><button type="button" onClick={() => navigate(-1)} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700"><ArrowLeft className="h-4 w-4" /> Back</button><button type="button" onClick={() => load(true)} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-xs font-black text-white"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button></div>
        </div>
        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          {[[Users, 'Total leads', counts.total, 'from live database'], [UserCheck, 'Allocated', counts.allocated, 'admin owner assigned'], [UserPlus, 'Unassigned', counts.unassigned, 'needs an owner']].map(([Icon, label, value, hint]) => <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-indigo-600 shadow-sm"><Icon className="h-5 w-5" /></span><div><div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</div><div className="text-2xl font-black text-slate-950">{value}</div></div></div><div className="mt-2 text-xs font-semibold text-slate-400">{hint}</div></div>)}
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <label className="relative flex-1"><Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search lead code, company, contact or owner..." className="w-full rounded-2xl border border-slate-200 py-3 pl-11 pr-4 text-sm font-semibold outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" /></label>
          <select value={ownerFilter} onChange={(event) => { setOwnerFilter(event.target.value); setPage(1) }} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none"><option value="all">All owners</option><option value="unassigned">Unassigned</option>{admins.map((admin) => <option key={idOf(admin)} value={idOf(admin)}>{admin.name || admin.email}</option>)}</select>
        </div>
      </section>

      {message && <div className={`mx-auto mt-4 rounded-2xl border px-4 py-3 text-sm font-bold ${message.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>{message.text}</div>}
      <section className="mt-5 overflow-hidden rounded-[28px] border border-white bg-white shadow-[0_20px_70px_rgba(15,23,42,.08)]">
        <div className="border-b border-slate-200 px-5 py-4 text-sm font-black text-slate-700">Showing {rows.length} of {pagination.total} leads · {admins.length} active CRM users available</div>
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[1180px] table-fixed text-sm">
            <thead className="bg-indigo-50 text-left text-[10px] font-black uppercase tracking-[.16em] text-indigo-900"><tr><th className="px-5 py-4">Lead / Company</th><th className="px-5 py-4">Contact</th><th className="px-5 py-4">Status</th><th className="px-5 py-4">Lead Owner / Created For</th><th className="px-5 py-4">Edit Created By</th><th className="px-5 py-4">Allocate Lead Owner</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan="6" className="px-5 py-16 text-center font-bold text-indigo-600"><RefreshCw className="mr-2 inline h-4 w-4 animate-spin" />Loading live leads...</td></tr>}
              {!loading && !rows.length && <tr><td colSpan="6" className="px-5 py-16 text-center font-bold text-slate-500">No matching leads found.</td></tr>}
              {!loading && rows.map((lead) => <tr key={idOf(lead)} className="hover:bg-slate-50"><td className="px-5 py-4"><div className="font-black text-slate-950">{lead.company || 'Unnamed company'}</div><div className="mt-1 text-xs font-bold text-indigo-600">{lead.leadCode || '-'}</div></td><td className="px-5 py-4"><div className="font-bold text-slate-700">{lead.contactPerson || '-'}</div><div className="text-xs text-slate-500">{lead.mobileNo1 || lead.emails || '-'}</div></td><td className="px-5 py-4"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-600">{lead.status || lead.workflowStatus || 'Open'}</span></td><td className="px-5 py-4"><span className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black ${ownerId(lead) ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200' : 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'}`}>{ownerId(lead) && <CheckCircle2 className="h-3.5 w-3.5" />}{ownerName(lead)}</span></td><td className="px-5 py-4"><CreatorEditors lead={lead} users={admins} saving={Boolean(savingId)} onChange={updateCreator} /></td><td className="px-5 py-4"><select disabled={Boolean(savingId)} value={ownerId(lead)} onChange={(event) => allocate(lead, event.target.value)} className="w-full min-w-[210px] rounded-xl border border-indigo-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-800 outline-none focus:ring-4 focus:ring-indigo-100"><option value="">Select active CRM user</option>{admins.map((admin) => <option key={idOf(admin)} value={idOf(admin)}>{admin.name || admin.email} · {String(admin.role).toUpperCase()}</option>)}</select></td></tr>)}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 text-xs font-bold text-slate-500">
          <span>Page {pagination.page || page} of {pagination.totalPages || 1}</span>
          <div className="flex gap-2"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))} className="inline-flex items-center gap-1 rounded-xl border bg-white px-3 py-2 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> Previous</button><button type="button" disabled={page >= (pagination.totalPages || 1) || loading} onClick={() => setPage((value) => value + 1)} className="inline-flex items-center gap-1 rounded-xl border bg-white px-3 py-2 disabled:opacity-40">Next <ChevronRight className="h-4 w-4" /></button></div>
        </div>
      </section>
      {profileOpen && <ProfileModal user={currentUser} saving={false} onClose={() => setProfileOpen(false)} onLogout={logout} onSave={() => {}} onUpdatePassword={() => {}} />}
    </main>
  </DashboardShell>
}
