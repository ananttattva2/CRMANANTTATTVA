import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Eye, FileQuestion, FileText, ImagePlus, LifeBuoy, Loader2, MessageSquareText, Plus, RefreshCw, Search, Send, Sparkles, Trash2, X } from 'lucide-react'
import DashboardShell from '../components/dashboard/DashboardShell'
import api from '../services/api'
import { API_ENDPOINTS } from '../services/apiEndpoints'
import { uploadMediaBatch } from '../services/mediaUpload'

const categories = [
  { name: 'Lead', caption: 'Lead creation & follow-up', icon: FileQuestion, tone: 'blue' },
  { name: 'Quotation', caption: 'Quotation & approval', icon: FileText, tone: 'violet' },
  { name: 'Client Master', caption: 'Client data & onboarding', icon: Sparkles, tone: 'amber' },
  { name: 'Proforma Invoice', caption: 'Invoice generation & sharing', icon: FileText, tone: 'rose' }
]
const statuses = ['All', 'Open', 'In Progress', 'Resolved', 'Closed']
const priorityStyles = { Low: 'bg-slate-100 text-slate-600', Medium: 'bg-blue-50 text-blue-700', High: 'bg-amber-50 text-amber-700', Urgent: 'bg-rose-50 text-rose-700' }
const statusStyles = { Open: 'bg-blue-50 text-blue-700 ring-blue-100', 'In Progress': 'bg-amber-50 text-amber-700 ring-amber-100', Resolved: 'bg-emerald-50 text-emerald-700 ring-emerald-100', Closed: 'bg-slate-100 text-slate-600 ring-slate-200' }
const emptyForm = { category: 'Lead', subject: '', description: '', referenceNumber: '', priority: 'Medium', attachments: [] }
const TICKETS_PER_PAGE = 10
const DEFAULT_STATUS_NOTE = 'Hi,\n\n\nRegards,\nIT Team'

function dateLabel(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function TicketImageUpload({ attachments = [], uploading, onFiles, onRemove }) {
  return <div className={`rounded-2xl border border-dashed p-4 ${attachments.length ? 'border-emerald-200 bg-emerald-50/40' : 'border-rose-300 bg-rose-50/50'}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wider text-slate-600">Issue images <span className="text-rose-600">*</span></p><p className="mt-1 text-xs text-slate-500">Minimum 1 screenshot is required. Upload up to 5 JPG, PNG or WEBP images.</p></div><label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl bg-white px-4 text-xs font-black text-emerald-700 shadow-sm ring-1 ring-emerald-100"><input type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={uploading || attachments.length >= 5} onChange={onFiles} />{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}{uploading ? 'Uploading...' : 'Add images'}</label></div>{!attachments.length && <p className="mt-3 flex items-center gap-2 text-xs font-bold text-rose-700"><AlertCircle className="h-4 w-4" />Ticket cannot be submitted without an issue screenshot.</p>}{attachments.length > 0 && <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{attachments.map((image, index) => <div key={`${image.publicId || image.url}-${index}`} className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white"><img src={image.secureUrl || image.url} alt={image.name || `Ticket image ${index + 1}`} className="h-24 w-full object-cover" /><button type="button" onClick={() => onRemove(index)} className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-white/95 text-rose-600 shadow"><Trash2 className="h-4 w-4" /></button><p className="truncate px-2 py-2 text-[10px] font-bold text-slate-500">{image.name || `Image ${index + 1}`}</p></div>)}</div>}</div>
}

function TicketAttachments({ attachments = [], label = 'Issue screenshots in this ticket' }) {
  const [conversationTarget, setConversationTarget] = useState(null)
  useEffect(() => {
    setConversationTarget(document.querySelector('aside > div.flex-1.overflow-y-auto'))
  }, [attachments])
  if (!attachments.length || !conversationTarget) return null
  return createPortal(<div className="ml-auto w-full max-w-md rounded-2xl border border-emerald-100 bg-white p-3 shadow-sm"><p className="text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</p><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{attachments.map((image, index) => <a key={`${image.publicId || image.url}-${index}`} href={image.url} target="_blank" rel="noopener noreferrer" title="Open full image in a new tab" className="group overflow-hidden rounded-xl border border-slate-200 bg-white"><span className="relative block"><img src={image.url} alt={image.name || `Ticket image ${index + 1}`} loading="lazy" className="h-20 w-full object-cover" /><span className="absolute inset-0 grid place-items-center bg-slate-950/20 text-white transition group-hover:bg-slate-950/40"><Eye className="h-5 w-5" /></span></span><span className="block truncate px-2 pt-1.5 text-[10px] font-bold text-slate-600">{image.name || `Image ${index + 1}`}</span><span className="block px-2 pb-1.5 text-[10px] font-black text-emerald-700 underline">Open full image</span></a>)}</div></div>, conversationTarget)
}

function TicketOptionalImageUpload({ attachments = [], uploading, onFiles, onRemove }) {
  return <div className="mt-5 rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/40 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wider text-slate-600">Resolution screenshots <span className="font-bold normal-case tracking-normal text-slate-400">(optional)</span></p><p className="mt-1 text-xs text-slate-500">Upload proof or a final-state screenshot if necessary. Maximum 5 images.</p></div><label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl bg-white px-4 text-xs font-black text-emerald-700 shadow-sm ring-1 ring-emerald-100"><input type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={uploading || attachments.length >= 5} onChange={onFiles} />{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}{uploading ? 'Uploading...' : 'Add screenshots'}</label></div>{attachments.length > 0 && <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{attachments.map((image, index) => <div key={`${image.publicId || image.url}-${index}`} className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white"><img src={image.secureUrl || image.url} alt={image.name || `Resolution screenshot ${index + 1}`} className="h-24 w-full object-cover" /><button type="button" onClick={() => onRemove(index)} className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-white/95 text-rose-600 shadow"><Trash2 className="h-4 w-4" /></button><p className="truncate px-2 py-2 text-[10px] font-bold text-slate-500">{image.name || `Screenshot ${index + 1}`}</p></div>)}</div>}</div>
}

export default function SupportTickets() {
  const currentUser = JSON.parse(localStorage.getItem('user') || 'null')
  const isAdmin = ['admin', 'superadmin'].includes(String(currentUser?.role || '').toLowerCase())
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingImages, setUploadingImages] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [statusFilter, setStatusFilter] = useState('All')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [reply, setReply] = useState('')
  const [pendingStatus, setPendingStatus] = useState('')
  const [statusNote, setStatusNote] = useState('')
  const [statusAttachments, setStatusAttachments] = useState([])
  const [uploadingStatusImages, setUploadingStatusImages] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [page, setPage] = useState(1)

  async function loadTickets() {
    setLoading(true); setError('')
    try {
      const { data } = await api.get(API_ENDPOINTS.supportTickets.list)
      setTickets(data.tickets || [])
      setSelected((active) => active ? (data.tickets || []).find((item) => item._id === active._id) || null : null)
    } catch (err) { setError(err?.response?.data?.error || 'Unable to load support tickets.') }
    finally { setLoading(false) }
  }

  useEffect(() => { loadTickets() }, [])

  const filtered = useMemo(() => tickets.filter((ticket) => {
    const term = search.trim().toLowerCase()
    return (statusFilter === 'All' || ticket.status === statusFilter)
      && (categoryFilter === 'All' || ticket.category === categoryFilter)
      && (!term || [ticket.ticketNumber, ticket.subject, ticket.referenceNumber, ticket.createdByName].some((value) => String(value || '').toLowerCase().includes(term)))
  }), [tickets, statusFilter, categoryFilter, search])
  const totalPages = Math.max(1, Math.ceil(filtered.length / TICKETS_PER_PAGE))
  const visibleTickets = filtered.slice((page - 1) * TICKETS_PER_PAGE, page * TICKETS_PER_PAGE)

  useEffect(() => { setPage(1) }, [categoryFilter, search, statusFilter])
  useEffect(() => { setPage((current) => Math.min(current, totalPages)) }, [totalPages])

  const counts = useMemo(() => ({
    total: tickets.length,
    active: tickets.filter((t) => ['Open', 'In Progress'].includes(t.status)).length,
    resolved: tickets.filter((t) => t.status === 'Resolved').length,
    urgent: tickets.filter((t) => t.priority === 'Urgent' && !['Resolved', 'Closed'].includes(t.status)).length
  }), [tickets])

  async function createTicket(event) {
    event.preventDefault(); setError(''); setNotice('')
    if (!(form.attachments || []).length) { setError('Please upload at least one issue screenshot before submitting the ticket.'); return }
    setSaving(true)
    try {
      const { data } = await api.post(API_ENDPOINTS.supportTickets.create, form)
      setTickets((items) => [data.ticket, ...items]); setForm(emptyForm); setFormOpen(false)
      setNotice(`${data.ticket.ticketNumber} was submitted successfully.`)
    } catch (err) { setError(err?.response?.data?.error || 'Unable to create the support ticket.') }
    finally { setSaving(false) }
  }

  async function addTicketImages(event) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
    const invalid = files.find((file) => !allowedTypes.has(file.type) || file.size > 10 * 1024 * 1024)
    if (invalid) { setError('Only JPG, PNG or WEBP images up to 10 MB each are allowed.'); return }
    const remaining = Math.max(0, 5 - (form.attachments || []).length)
    if (!remaining) { setError('Maximum 5 images can be attached.'); return }
    setUploadingImages(true); setError('')
    try {
      const uploaded = await uploadMediaBatch(files.slice(0, remaining), 'crm/support-tickets')
      setForm((current) => ({ ...current, attachments: [...(current.attachments || []), ...uploaded] }))
    } catch (err) { setError(err?.message || 'Image upload failed.') }
    finally { setUploadingImages(false) }
  }

  async function addStatusImages(event) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
    const invalid = files.find((file) => !allowedTypes.has(file.type) || file.size > 10 * 1024 * 1024)
    if (invalid) { setError('Only JPG, PNG or WEBP images up to 10 MB each are allowed.'); return }
    const remaining = Math.max(0, 5 - statusAttachments.length)
    if (!remaining) { setError('Maximum 5 resolution screenshots can be attached.'); return }
    setUploadingStatusImages(true); setError('')
    try {
      const uploaded = await uploadMediaBatch(files.slice(0, remaining), 'crm/support-tickets/resolutions')
      setStatusAttachments((current) => [...current, ...uploaded])
    } catch (err) { setError(err?.message || 'Resolution screenshot upload failed.') }
    finally { setUploadingStatusImages(false) }
  }

  async function updateTicket(payload) {
    if (!selected) return
    if (['Resolved', 'Closed'].includes(payload.status) && !String(payload.message || '').trim()) {
      setPendingStatus(payload.status)
      setStatusNote(DEFAULT_STATUS_NOTE)
      setStatusAttachments([])
      return
    }
    setSaving(true); setError('')
    try {
      const { data } = await api.put(API_ENDPOINTS.supportTickets.detail(selected._id), payload)
      setTickets((items) => items.map((item) => String(item._id) === String(data.ticket._id) ? data.ticket : item)); setSelected(data.ticket); setReply(''); setPendingStatus(''); setStatusNote(''); setStatusAttachments([])
      setNotice(`Ticket ${data.ticket.status.toLowerCase()} successfully.`)
      await loadTickets()
    } catch (err) { setError(err?.response?.data?.error || 'Unable to update the support ticket.') }
    finally { setSaving(false) }
  }

  return (
    <DashboardShell currentUser={currentUser}>
      <div className="min-h-[calc(100vh-4rem)] bg-[#f4f8f7] px-3 py-5 sm:px-5 lg:px-7">
        <div className="w-full space-y-5">
          <section className="relative overflow-hidden rounded-[28px] border border-[#e8e2da] bg-gradient-to-r from-[#fff8ed] via-white to-[#fffaf2] p-6 text-slate-900 shadow-lg shadow-slate-900/5 sm:p-8">
            <div className="absolute -right-12 -top-16 h-60 w-60 rounded-full bg-orange-100/55 blur-2xl" />
            <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-3xl">
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-emerald-800"><LifeBuoy className="h-4 w-4" />Help desk</span>
                <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">How can we help you?</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">If you have a question, an access issue, or need help with any CRM process, raise a support ticket. Track every update and reply in one place.</p>
              </div>
              <button type="button" onClick={() => setFormOpen(true)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#f45b0b] px-5 font-black text-white shadow-lg shadow-orange-950/20 transition hover:-translate-y-0.5 hover:bg-orange-600"><Plus className="h-5 w-5" />Raise New Ticket</button>
            </div>
          </section>

          {(error || notice) && <div className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-sm font-bold ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}><span>{error || notice}</span><button onClick={() => { setError(''); setNotice('') }}><X className="h-4 w-4" /></button></div>}

          {selected && <TicketAttachments attachments={selected.attachments || []} />}
          {selected && <TicketAttachments label="Resolution screenshots" attachments={(selected.messages || []).flatMap((message) => message.attachments || [])} />}

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[[counts.total, 'Total tickets', MessageSquareText, 'text-slate-700 bg-slate-100'], [counts.active, 'Active tickets', Clock3, 'text-blue-700 bg-blue-50'], [counts.resolved, 'Resolved', CheckCircle2, 'text-emerald-700 bg-emerald-50'], [counts.urgent, 'Urgent attention', AlertCircle, 'text-rose-700 bg-rose-50']].map(([value,label,Icon,tone]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><div><p className="text-2xl font-black text-slate-900">{value}</p><p className="mt-1 text-xs font-bold text-slate-500">{label}</p></div><span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${tone}`}><Icon className="h-5 w-5" /></span></div></div>)}
          </section>

          <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div><p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">Quick categories</p><h2 className="mt-1 text-xl font-black text-slate-900">Select your issue area</h2></div>
              <div className="relative w-full lg:max-w-sm"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ticket or reference..." className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-50" /></div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {categories.map(({ name, caption, icon: Icon }) => <button key={name} type="button" onClick={() => { setCategoryFilter(categoryFilter === name ? 'All' : name); setForm((v) => ({ ...v, category: name })) }} className={`group rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${categoryFilter === name ? 'border-emerald-500 bg-emerald-50 ring-4 ring-emerald-50' : 'border-slate-200 bg-white hover:border-emerald-200'}`}><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${categoryFilter === name ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 group-hover:bg-emerald-50 group-hover:text-emerald-700'}`}><Icon className="h-5 w-5" /></span><p className="mt-3 text-sm font-black text-slate-900">{name}</p><p className="mt-1 text-[11px] leading-4 text-slate-500">{caption}</p></button>)}
            </div>
          </section>

          <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-100 p-5 lg:flex-row lg:items-center lg:justify-between"><div><h2 className="text-xl font-black text-slate-900">{isAdmin ? 'All support tickets' : 'My support tickets'}</h2><p className="mt-1 text-xs text-slate-500">{filtered.length} ticket{filtered.length === 1 ? '' : 's'} shown</p></div><div className="flex flex-wrap gap-2">{statuses.map((status) => <button key={status} onClick={() => setStatusFilter(status)} className={`rounded-xl px-3 py-2 text-xs font-black transition ${statusFilter === status ? 'bg-[#0f5d46] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{status}</button>)}<button onClick={loadTickets} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div></div>
            <div className="divide-y divide-slate-100">
              {loading ? <div className="flex min-h-56 items-center justify-center gap-3 text-sm font-bold text-slate-500"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" />Loading tickets...</div> : visibleTickets.length ? visibleTickets.map((ticket) => { const resolved = ['Resolved', 'Closed'].includes(ticket.status); return <button type="button" key={ticket._id} onClick={() => setSelected(ticket)} className={`group grid w-full gap-4 p-5 text-left transition lg:grid-cols-[140px_minmax(0,1fr)_150px_130px_32px] lg:items-center ${resolved ? 'bg-emerald-50/80 hover:bg-emerald-100/70' : 'hover:bg-emerald-50/40'}`}><div><p className="text-xs font-black text-emerald-700">{ticket.ticketNumber}</p><p className={`mt-1 text-[11px] ${resolved ? 'text-emerald-600' : 'text-slate-400'}`}>{dateLabel(ticket.createdAt)}</p></div><div className="min-w-0"><p className={`truncate font-black ${resolved ? 'text-emerald-950' : 'text-slate-900'}`}>{resolved && <CheckCircle2 className="mr-2 inline h-4 w-4 text-emerald-600" />}{ticket.subject}</p><p className={`mt-1 truncate text-xs ${resolved ? 'text-emerald-700' : 'text-slate-500'}`}>{ticket.category}{ticket.referenceNumber ? ` • Ref: ${ticket.referenceNumber}` : ''}{isAdmin && ticket.createdByName ? ` • ${ticket.createdByName}` : ''}</p></div><span className={`w-fit rounded-full px-3 py-1 text-[11px] font-black ${priorityStyles[ticket.priority]}`}>{ticket.priority}</span><span className={`w-fit rounded-full px-3 py-1 text-[11px] font-black ring-1 ${statusStyles[ticket.status]}`}>{ticket.status}</span><ArrowRight className={`h-4 w-4 transition group-hover:translate-x-1 ${resolved ? 'text-emerald-600' : 'text-slate-300 group-hover:text-emerald-600'}`} /></button> }) : <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center"><span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-50 text-emerald-700"><LifeBuoy className="h-8 w-8" /></span><h3 className="mt-4 text-lg font-black text-slate-900">No tickets found</h3><p className="mt-2 max-w-sm text-sm text-slate-500">No matching tickets were found. Raise a new ticket whenever you need help.</p></div>}
            </div>
            {filtered.length > TICKETS_PER_PAGE && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4"><p className="text-xs font-bold text-slate-500">Showing {(page - 1) * TICKETS_PER_PAGE + 1}-{Math.min(page * TICKETS_PER_PAGE, filtered.length)} of {filtered.length}</p><div className="flex items-center gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 px-3 text-xs font-black text-slate-600 disabled:opacity-40"><ChevronLeft className="h-4 w-4" />Previous</button><span className="text-xs font-black text-slate-700">Page {page} of {totalPages}</span><button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 px-3 text-xs font-black text-slate-600 disabled:opacity-40">Next<ChevronRight className="h-4 w-4" /></button></div></div>}
          </section>
        </div>
      </div>

      {formOpen && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-sm"><form onSubmit={createTicket} className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-[28px] bg-white shadow-2xl"><div className="flex items-start justify-between border-b border-slate-100 p-6"><div><p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">New support request</p><h2 className="mt-2 text-2xl font-black text-slate-900">Raise a Ticket</h2><p className="mt-1 text-sm text-slate-500">Describe the issue in detail so the support team can assist you.</p></div><button type="button" onClick={() => setFormOpen(false)} className="rounded-xl bg-slate-100 p-2 text-slate-500 hover:bg-slate-200"><X className="h-5 w-5" /></button></div><div className="space-y-5 p-6"><div><label className="text-xs font-black uppercase tracking-wider text-slate-500">Select section *</label><div className="mt-2 grid gap-2 sm:grid-cols-3">{categories.map((c) => <button type="button" key={c.name} onClick={() => setForm((v) => ({ ...v, category: c.name }))} className={`rounded-xl border px-3 py-3 text-left text-xs font-black ${form.category === c.name ? 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-100' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{c.name}</button>)}</div></div><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-black uppercase tracking-wider text-slate-500">Priority *<select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none focus:border-emerald-500">{['Low','Medium','High','Urgent'].map((x) => <option key={x}>{x}</option>)}</select></label><label className="text-xs font-black uppercase tracking-wider text-slate-500">Reference number<input value={form.referenceNumber} onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })} placeholder="Lead / Client / PI number" className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-3 text-sm font-medium normal-case tracking-normal outline-none focus:border-emerald-500" /></label></div><label className="block text-xs font-black uppercase tracking-wider text-slate-500">Subject *<input required maxLength={160} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Short summary of your issue" className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-4 text-sm font-medium normal-case tracking-normal outline-none focus:border-emerald-500" /></label><label className="block text-xs font-black uppercase tracking-wider text-slate-500">Describe the issue *<textarea required rows={6} maxLength={5000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What were you trying to do? What happened? Include any error message..." className="mt-2 w-full resize-none rounded-xl border border-slate-200 p-4 text-sm font-medium normal-case leading-6 tracking-normal outline-none focus:border-emerald-500" /></label><TicketImageUpload attachments={form.attachments} uploading={uploadingImages} onFiles={addTicketImages} onRemove={(index) => setForm((current) => ({ ...current, attachments: current.attachments.filter((_, itemIndex) => itemIndex !== index) }))} /></div><div className="flex flex-col-reverse gap-3 border-t border-slate-100 p-6 sm:flex-row sm:justify-end"><button type="button" onClick={() => setFormOpen(false)} className="h-12 rounded-xl border border-slate-200 px-5 text-sm font-black text-slate-600">Cancel</button><button disabled={saving || uploadingImages} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#f45b0b] px-6 text-sm font-black text-white disabled:opacity-60">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Submit Ticket</button></div></form></div>}

      {selected && <div className="fixed inset-0 z-[80] bg-slate-950/45 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null) }}><aside className={`ml-auto flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl ${['Resolved', 'Closed'].includes(selected.status) ? 'border-l-4 border-emerald-500' : ''}`}><div className={`border-b p-5 sm:p-6 ${['Resolved', 'Closed'].includes(selected.status) ? 'border-emerald-200 bg-emerald-50' : 'border-slate-100'}`}>{['Resolved', 'Closed'].includes(selected.status) && <div className="mb-4 flex items-center gap-3 rounded-2xl bg-emerald-600 px-4 py-3 text-white"><CheckCircle2 className="h-5 w-5" /><div><p className="text-sm font-black">Successfully {selected.status}</p><p className="text-xs text-emerald-50">The user has been notified by email.</p></div></div>}<div className="flex items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-black text-emerald-700">{selected.ticketNumber}</span><span className={`rounded-full px-2.5 py-1 text-[10px] font-black ring-1 ${statusStyles[selected.status]}`}>{selected.status}</span><span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${priorityStyles[selected.priority]}`}>{selected.priority}</span></div><h2 className="mt-3 text-xl font-black text-slate-900 sm:text-2xl">{selected.subject}</h2><p className="mt-2 text-xs text-slate-500">{selected.category} • Raised by {selected.createdByName || selected.createdByEmail} • {dateLabel(selected.createdAt)}</p></div><button onClick={() => setSelected(null)} className="rounded-xl bg-white/80 p-2 text-slate-500"><X className="h-5 w-5" /></button></div>{selected.referenceNumber && <div className="mt-4 rounded-xl bg-white/80 px-4 py-3 text-xs font-bold text-slate-600">Reference: <span className="text-slate-900">{selected.referenceNumber}</span></div>}{isAdmin && <div className="mt-4 flex flex-wrap gap-2">{['Open','In Progress','Resolved','Closed'].map((status) => <button key={status} disabled={saving || status === selected.status} onClick={() => updateTicket({ status })} className={`rounded-xl px-3 py-2 text-xs font-black ${status === selected.status ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 shadow-sm hover:bg-slate-100 disabled:opacity-50'}`}>{status}</button>)}</div>}</div><div className={`flex-1 space-y-4 overflow-y-auto p-5 sm:p-6 ${['Resolved', 'Closed'].includes(selected.status) ? 'bg-emerald-50/40' : 'bg-slate-50'}`}>{(selected.messages || []).map((message, index) => { const support = ['admin','superadmin'].includes(String(message.authorRole).toLowerCase()); return <div key={message._id || index} className={`flex ${support ? 'justify-start' : 'justify-end'}`}><div className={`max-w-[88%] rounded-2xl p-4 shadow-sm ${support ? 'rounded-tl-md border border-emerald-100 bg-emerald-50' : 'rounded-tr-md border border-slate-200 bg-white'}`}><div className="flex items-center gap-2"><span className="text-xs font-black text-slate-900">{message.authorName || 'CRM User'}</span>{support && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[9px] font-black uppercase text-white">Support</span>}</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{message.message}</p><p className="mt-2 text-[10px] text-slate-400">{dateLabel(message.createdAt)}</p></div></div>})}</div><div className="border-t border-slate-200 bg-white p-4 sm:p-5"><div className="flex items-end gap-3"><textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply..." className="min-h-[52px] flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-emerald-500 focus:bg-white" /><button disabled={saving || !reply.trim()} onClick={() => updateTicket({ message: reply })} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#0f5d46] text-white disabled:opacity-40"><Send className="h-4 w-4" /></button></div></div></aside></div>}

      {pendingStatus && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
        <div className="max-h-[94vh] w-full max-w-lg overflow-y-auto rounded-[28px] bg-white shadow-2xl">
          <div className="bg-gradient-to-br from-emerald-700 to-emerald-600 p-6 text-white">
            <div className="flex items-start justify-between"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15"><CheckCircle2 className="h-6 w-6" /></span><button onClick={() => { setPendingStatus(''); setStatusNote(''); setStatusAttachments([]) }} className="rounded-xl bg-white/10 p-2 hover:bg-white/20"><X className="h-5 w-5" /></button></div>
            <h2 className="mt-5 text-2xl font-black">{pendingStatus === 'Closed' ? 'Close this ticket' : 'Resolve this ticket'}</h2>
            <p className="mt-2 text-sm leading-6 text-emerald-50/90">Please explain what action you took. This note and any screenshot will be saved in the ticket conversation and emailed to the user.</p>
          </div>
          <div className="p-6">
            <label className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{pendingStatus === 'Closed' ? 'Closure note' : 'Resolution note'} *</label>
            <textarea autoFocus rows={6} maxLength={2000} value={statusNote} onChange={(e) => setStatusNote(e.target.value)} placeholder="Describe the issue found, action taken, and final outcome..." className="mt-3 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-50" />
            <div className="mt-2 flex justify-between text-[11px] text-slate-400"><span>This field is required.</span><span>{statusNote.length}/2000</span></div>
            <TicketOptionalImageUpload attachments={statusAttachments} uploading={uploadingStatusImages} onFiles={addStatusImages} onRemove={(index) => setStatusAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button onClick={() => { setPendingStatus(''); setStatusNote(''); setStatusAttachments([]) }} className="h-12 rounded-xl border border-slate-200 px-5 text-sm font-black text-slate-600">Cancel</button><button disabled={saving || uploadingStatusImages || !statusNote.trim()} onClick={() => updateTicket({ status: pendingStatus, message: statusNote, attachments: statusAttachments })} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 text-sm font-black text-white shadow-lg shadow-emerald-900/15 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Confirm {pendingStatus}</button></div>
          </div>
        </div>
      </div>}
    </DashboardShell>
  )
}
