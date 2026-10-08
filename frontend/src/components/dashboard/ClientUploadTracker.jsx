import React, { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, RefreshCw, Search, X, FileSpreadsheet, FileDown, LoaderCircle } from 'lucide-react'
import api from '../../services/api'
import './clientUploadTracker.css'
import { UPLOAD_TRACKER_STAGES, downloadUploadTrackerExcel, downloadUploadTrackerPdf } from '../../utils/uploadTrackerExports.mjs'
const stages = UPLOAD_TRACKER_STAGES
const colors = { pending: 'bg-slate-100 text-slate-500', progress: 'bg-amber-100 text-amber-800', complete: 'bg-emerald-100 text-emerald-800' }
function TrackerExportButtons({ users, financialYear, scope = 'All users', clientMode = false }) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const ready = users.some(user => user.clients.length)
  const download = async format => {
    if (busy || !ready) return
    setBusy(format); setError('')
    try {
      if (format === 'excel') await downloadUploadTrackerExcel(users, financialYear, scope)
      else await downloadUploadTrackerPdf(users, financialYear, { scope, clientMode })
    } catch { setError('Download failed. Please retry.') }
    finally { setBusy('') }
  }
  return <div className="tracker-export-actions">
    <button type="button" className="tracker-export-icon tracker-export-excel" title="Download Excel" aria-label="Download Excel" disabled={Boolean(busy) || !ready} onClick={() => download('excel')}>{busy === 'excel' ? <LoaderCircle className="animate-spin" size={17} /> : <FileSpreadsheet size={17} />}</button>
    <button type="button" className="tracker-export-icon tracker-export-pdf" title="Download PDF" aria-label="Download PDF" disabled={Boolean(busy) || !ready} onClick={() => download('pdf')}>{busy === 'pdf' ? <LoaderCircle className="animate-spin" size={17} /> : <FileDown size={17} />}</button>
    {error && <span role="alert" className="tracker-export-error">{error}</span>}
    {busy && <span role="status" className="sr-only">Preparing {busy === 'excel' ? 'Excel' : 'PDF'} download</span>}
  </div>
}
function UserAvatar({ name, total = false }) {
  const initials = total ? 'GT' : name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase()
  const tone = [...name].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 6
  return <span aria-hidden="true" className={`tracker-avatar tracker-avatar-${total ? 'total' : tone}`}>{initials || 'U'}</span>
}
function ProgressCell({ value, total, review = false }) {
  const tone = value.complete === total && total ? 'complete' : value.complete || value.progress ? 'progress' : 'pending'
  return <td className="tracker-progress-cell" data-state={tone}>
    <span className="tracker-ratio" title={`${value.complete} ${review ? 'approved' : 'completed'}, ${value.progress} in progress, ${value.pending} pending`}>{value.complete}</span>
    {review && <small className="tracker-review-note">{value.complete === total && total ? 'Approved' : `${value.pending} pending`}</small>}
    {value.progress > 0 && <small className="tracker-progress-note">{value.progress} in progress</small>}
  </td>
}
export default function ClientUploadTracker({ financialYear, refreshToken = 0 }) {
  const selectedYear = financialYear
  const [serviceType, setServiceType] = useState('annual')
  const serviceLabel = serviceType === 'annual' ? 'AR Return' : 'Registration'
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0), [query, setQuery] = useState(''), [selectedUser, setSelectedUser] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setLoading(true); setError(''); setData(previous => previous?.serviceType === serviceType ? previous : null)
      try { const response = await api.get('/dashboard-insights/upload-tracker', { params: { financialYear: selectedYear, serviceType }, signal: controller.signal }); if (!controller.signal.aborted) setData(response.data) }
      catch (err) { if (!controller.signal.aborted) { setData(null); setError(err.response?.data?.error || 'Could not load upload progress. Please retry.') } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }
    load()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load() }, 60000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [selectedYear, refresh, refreshToken, serviceType])
  const users = (data?.users || []).filter(row => `${row.userName} ${row.clients.map(client => client.clientName).join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  const total = users.reduce((sum, row) => sum + row.clients.length, 0)
  const totals = users.reduce((sum, row) => {
    sum.clients += row.clients.length; sum.slaReceived += row.slaReceived; sum.slaNotReceived += row.slaNotReceived
    for (const module of ['purchase','sales']) row[module].forEach((value,index) => { for (const state of ['complete','progress','pending']) sum[module][index][state] += value[state] })
    return sum
  }, { clients: 0, slaReceived: 0, slaNotReceived: 0, purchase: stages.map(() => ({ complete:0, progress:0, pending:0 })), sales: stages.map(() => ({ complete:0, progress:0, pending:0 })) })
  const popupUser = data?.users?.find(row => row.userId === selectedUser)

  return <section role="tabpanel" id="upload-tracker-panel" aria-labelledby="dashboard-tab-upload" className="upload-tracker-card">
    <header className="tracker-heading">
      <div className="tracker-heading-copy"><p>Operations overview</p><h2>Client Data &amp; Upload Tracker</h2><span>SLA receipt and upload progress by assigned user</span></div>
      <div className="tracker-tools">
        <div className="tracker-tools-top"><TrackerExportButtons users={users} financialYear={selectedYear} scope={`${serviceLabel} - All users`} /><span className="tracker-count">{total} clients <i>·</i> {users.length} users</span><button type="button" aria-label="Refresh upload tracker" title="Refresh live data" onClick={() => setRefresh(value => value + 1)} disabled={loading} className="tracker-refresh"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button></div>
        <div className="tracker-tools-bottom"><label className="tracker-search"><Search size={15} /><input aria-label="Search tracker users or clients" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search user or client" /></label><div className="tracker-legend">{[['pending','Pending'],['progress','In progress'],['complete','Completed']].map(([key,label]) => <span key={key}><i data-state={key} />{label}</span>)}</div></div>
      </div>
    </header>
    <div className="tracker-service-tabs" role="tablist" aria-label="Services Offered"><button type="button" role="tab" aria-selected={serviceType === 'annual'} onClick={() => { setSelectedUser(null); setServiceType('annual') }}>AR Return</button><button type="button" role="tab" aria-selected={serviceType === 'registration'} onClick={() => { setSelectedUser(null); setServiceType('registration') }}>Registration</button></div>
    {error && <p role="alert" className="m-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
    {loading && !data ? <p role="status" className="p-12 text-center text-sm text-slate-500">Loading live upload progress…</p> : data && <div className="tracker-table-scroll"><table className="upload-tracker-table"><caption className="sr-only">User-wise SLA, Purchase and Sales progress for {selectedYear}</caption><thead className="sticky top-0 z-20"><tr><th rowSpan={2} scope="col" className="min-w-48 border-b border-slate-200 bg-slate-50 p-4 text-left text-slate-700">User Name</th><th rowSpan={2} scope="col" className="tracker-allocated-column border-b border-slate-200 bg-slate-50 p-3 text-slate-700">Allocated Clients</th><th colSpan={2} scope="colgroup" className="border-l border-white bg-slate-50 p-3 text-slate-700">SLA Status</th><th colSpan={stages.length} scope="colgroup" className="border-l border-white bg-teal-50 p-3 text-teal-800">Purchase</th><th colSpan={stages.length} scope="colgroup" className="border-l border-white bg-blue-50 p-3 text-blue-800">Sales</th></tr><tr>{['Received','Not Received'].map(label => <th key={label} scope="col" className="bg-amber-50 p-3 text-amber-900">{label}</th>)}{['purchase','sales'].flatMap(module => stages.map(stage => <th key={`${module}-${stage}`} scope="col" className={`min-w-24 max-w-28 p-3 ${module === 'purchase' ? 'bg-teal-50 text-teal-900' : 'bg-blue-50 text-blue-900'}`}>{stage}</th>))}</tr></thead><tbody>{users.map(row => <React.Fragment key={row.userId}><tr data-active={row.purchase.concat(row.sales).some(value => value.complete || value.progress)}><th scope="row" className="border-b border-slate-100 p-4 text-left"><button type="button" aria-haspopup="dialog" onClick={() => setSelectedUser(row.userId)} className="group flex w-full items-center justify-between gap-3 text-left font-bold text-slate-800 hover:text-teal-700"><span className="tracker-user-label"><UserAvatar name={row.userName} /><span>{row.userName}</span></span><ArrowUpRight size={14} className="text-slate-400 group-hover:text-teal-700" /></button></th><td className="tracker-allocated-column border-b border-slate-100 text-center text-base font-bold text-slate-800">{row.clients.length}</td><td className="border-b border-slate-100 text-center font-bold text-emerald-700">{row.slaReceived}</td><td className="border-b border-slate-100 text-center font-bold text-amber-700">{row.slaNotReceived}</td>{['purchase','sales'].flatMap(module => row[module].map((value,index) => <ProgressCell key={`${module}-${index}`} value={value} total={row.clients.length} review={index >= 6} />))}</tr></React.Fragment>)}{!users.length && <tr><td colSpan={4 + stages.length * 2} className="p-12 text-center text-slate-500">No allocated clients match this view.</td></tr>}</tbody><tfoot className="sticky bottom-0 bg-white shadow-[0_-2px_8px_rgba(15,23,42,0.06)]"><tr><th scope="row" className="border-t-2 border-slate-200 p-4 text-left font-black text-slate-900"><span className="tracker-user-label"><UserAvatar name="Grand total" total /><span>{query ? 'Filtered total' : 'Grand Total'}</span></span></th><td className="tracker-allocated-column border-t-2 border-slate-200 text-center text-base font-black">{totals.clients}</td><td className="border-t-2 border-slate-200 text-center font-black text-emerald-700">{totals.slaReceived}</td><td className="border-t-2 border-slate-200 text-center font-black text-amber-700">{totals.slaNotReceived}</td>{['purchase','sales'].flatMap(module => totals[module].map((value,index) => <ProgressCell key={`${module}-${index}`} value={value} total={totals.clients} review={index >= 6} />))}</tr></tfoot></table></div>}
    {popupUser && <UserClientsPopup key={`${serviceType}-${popupUser.userId}`} user={popupUser} serviceLabel={serviceLabel} financialYear={selectedYear} onClose={() => setSelectedUser(null)} />}
    <footer className="tracker-footer">{serviceLabel} services only. Each company + PIBo category counts once per assigned user, using the same closed service classification as Application service Summary. Progress is completed when all assigned services are complete. Upload Complete requires both Excel imports.</footer>
  </section>
}

function UserClientsPopup({ user, financialYear, serviceLabel, onClose }) {
  const dialog = useRef(null)
  const [query, setQuery] = useState('')
  useEffect(() => {
    const element = dialog.current
    const previous = document.activeElement
    const overflow = document.body.style.overflow
    element.showModal(); document.body.style.overflow = 'hidden'
    return () => { element.close(); document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  const clients = user.clients.filter(client => client.clientName.toLowerCase().includes(query.toLowerCase()))
  return <dialog ref={dialog} onCancel={onClose} onClose={onClose} onClick={event => { if (event.target === dialog.current) onClose() }} aria-labelledby="upload-user-popup-title" className="m-auto w-[96vw] max-w-[1600px] overflow-hidden rounded-3xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-900/40 ">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 bg-white px-6 py-5"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-teal-700">Operations & Managers · Client upload progress</p><h2 id="upload-user-popup-title" className="mt-2 text-xl font-black text-slate-900">{user.userName}</h2><p className="mt-1 text-xs text-slate-500">{user.clients.length} allocated clients · SLA received {user.slaReceived} · Not received {user.slaNotReceived}</p></div><div className="flex items-center gap-3"><TrackerExportButtons users={[{ ...user, clients }]} financialYear={financialYear} scope={`${serviceLabel} - ${user.userName}`} clientMode /><button type="button" autoFocus aria-label="Close client details" onClick={onClose} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><X size={20} /></button></div></header>
    <div className="flex items-center justify-between gap-3 px-6 py-4"><label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2"><Search size={15} className="text-slate-400" /><input aria-label="Search allocated clients" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search allocated clients" className="text-sm outline-none" /></label><span className="text-xs text-slate-500">{clients.length} clients shown</span></div>
    <div className="max-h-[65vh] overflow-auto"><table className="w-full min-w-[1800px] border-separate border-spacing-0 text-xs"><thead className="sticky top-0 z-10"><tr><th rowSpan={2} className="min-w-64 border-b border-slate-200 bg-slate-50 px-6 py-4 text-left text-slate-700">Client name</th><th rowSpan={2} className="border-b border-slate-200 bg-slate-50 p-3 text-slate-700">SLA</th><th colSpan={stages.length} className="bg-teal-50 p-3 text-teal-800">Purchase</th><th colSpan={stages.length} className="bg-blue-50 p-3 text-blue-800">Sales</th></tr><tr>{['purchase','sales'].flatMap(module => stages.map(stage => <th key={`${module}-${stage}`} className={`min-w-24 p-3 ${module === 'purchase' ? 'bg-teal-50/60 text-teal-800' : 'bg-blue-50/60 text-blue-800'}`}>{stage}</th>))}</tr></thead><tbody>{clients.map(client => <tr key={client.clientId} className="hover:bg-slate-50"><th scope="row" className="border-b border-slate-100 px-6 py-4 text-left font-semibold text-slate-700">{client.clientName}{client.category && <small className="mt-1 block text-slate-500">{client.category} · {client.offered}</small>}</th><td className="border-b border-slate-100 p-3 text-center"><span className={`rounded-lg px-2 py-1.5 text-[10px] font-semibold ${client.slaReceived ? colors.complete : colors.pending}`}>{client.slaReceived ? 'Received' : 'Not received'}</span></td>{['purchase','sales'].flatMap(module => client[module].map((state,index) => <td key={`${module}-${index}`} className="border-b border-slate-100 p-2 text-center"><span className={`inline-block rounded-lg px-2 py-1.5 text-[10px] font-semibold ${colors[state]}`}>{state === 'complete' ? index >= 6 ? 'Approved' : 'Completed' : state === 'progress' ? 'In progress' : 'Pending'}</span></td>))}</tr>)}{!clients.length && <tr><td colSpan={2 + stages.length * 2} className="p-12 text-center text-slate-500">No clients match this search.</td></tr>}</tbody></table></div>
    <footer className="border-t border-slate-100 px-6 py-4 text-xs text-slate-500">Only this user’s allocated clients are shown. Press Escape to close.</footer>
  </dialog>
}
