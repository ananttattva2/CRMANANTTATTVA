import React, { useEffect, useMemo, useState } from 'react'
import { Building2, Download, Eye, Factory, FileCheck2, FileText, Loader2, MapPin, RefreshCw, Search, ShieldCheck, X } from 'lucide-react'
import DashboardShell from '../components/dashboard/DashboardShell'
import api from '../services/api'
import { API_ENDPOINTS } from '../services/apiEndpoints'
import { documentUrl, downloadCteCtoExcel, groupCteCtoClients } from '../utils/cteCtoDirectory.mjs'

const value = (input, fallback = '-') => String(input ?? '').trim() || fallback

function DetailItem({ label, children }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[10px] font-black uppercase tracking-[.13em] text-slate-400">{label}</p><div className="mt-1 text-sm font-bold text-slate-800">{children || '-'}</div></div>
}

function DocumentLink({ document, label }) {
  const url = documentUrl(document)
  return url ? <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-emerald-700 hover:underline"><FileText className="h-4 w-4" />{label}</a> : <span className="text-slate-400">Not uploaded</span>
}

function RecordDetails({ record }) {
  const cte = record.cte || {}
  const plants = Array.isArray(cte.plantWiseDetails) ? cte.plantWiseDetails : []
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-3">
      <DetailItem label="CTE Applicable">{value(cte.cteApplicable, 'Yes')}</DetailItem>
      <DetailItem label="Plant Locations">{value(cte.numberOfPlantsLocations, String(plants.length))}</DetailItem>
      <DetailItem label="EPR Category">{record.eprCategory}</DetailItem>
    </div>
    {!plants.length && <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center"><Factory className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 font-black text-slate-600">No CTE or CTO/CCA details saved for this applicant.</p></div>}
    {plants.map((plant, index) => <section key={index} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-4"><span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 font-black text-emerald-700">{index + 1}</span><div><h3 className="font-black text-slate-950">{value(plant.plantName, `Plant ${index + 1}`)}</h3><p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-slate-500"><MapPin className="h-3 w-3" />{value(plant.plantLocation, 'Location not entered')}</p></div></header>
      <div className="grid gap-4 p-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-orange-100 bg-orange-50/50 p-4"><h4 className="mb-3 flex items-center gap-2 font-black text-orange-700"><FileCheck2 className="h-4 w-4" />CTE Details</h4><div className="grid gap-2 sm:grid-cols-2"><DetailItem label="Consent No.">{value(plant.cteConsentNo)}</DetailItem><DetailItem label="Category">{value(plant.cteCategory)}</DetailItem><DetailItem label="Issued Date">{value(plant.cteIssuedDate)}</DetailItem><DetailItem label="Valid Upto">{value(plant.cteValidDate)}</DetailItem><DetailItem label="Document"><DocumentLink document={plant.cteDocument} label="View CTE document" /></DetailItem><DetailItem label="Production / Year">{(plant.cteProductionRows || []).map((row, rowIndex) => <div key={rowIndex}>{value(row.productName, 'Product')} — {value(row.capacity)}</div>)}</DetailItem></div></div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4"><h4 className="mb-3 flex items-center gap-2 font-black text-emerald-700"><ShieldCheck className="h-4 w-4" />CTO / CCA Details</h4><div className="grid gap-2 sm:grid-cols-2"><DetailItem label="Order No.">{value(plant.ctoOrderNo)}</DetailItem><DetailItem label="Issue Date">{value(plant.ctoIssueDate)}</DetailItem><DetailItem label="Valid Upto">{value(plant.ctoValidDate)}</DetailItem><DetailItem label="Document"><DocumentLink document={plant.ctoDocument} label="View CTO/CCA document" /></DetailItem><DetailItem label="Product Quantity">{(plant.ctoProductRows || []).map((row, rowIndex) => <div key={rowIndex}>{value(row.productName, 'Product')} — {value(row.quantity)}</div>)}</DetailItem></div></div>
      </div>
    </section>)}
  </div>
}

function ClientModal({ group, onClose }) {
  const [selectedId, setSelectedId] = useState('')
  const selected = group.records.find((record) => record.id === selectedId)
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
      <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4 sm:px-7"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-emerald-600">CTE & CTO / CCA Details</p><h2 className="mt-1 text-xl font-black text-slate-950 sm:text-2xl">{group.companyName}</h2><p className="mt-1 text-xs font-semibold text-slate-500">{group.leadCode}</p></div><button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200"><X className="h-5 w-5" /></button></header>
      <div className="overflow-y-auto p-5 sm:p-7">
        <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><h3 className="font-black text-slate-950">Choose Applicant / Sub-applicant Type</h3><p className="mt-1 text-xs font-semibold text-slate-500">Select the Client Master application whose CTE and CTO/CCA details you want to view.</p><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{group.records.map((record) => <button key={record.id} onClick={() => setSelectedId(record.id)} className={`rounded-2xl border p-4 text-left transition ${selectedId === record.id ? 'border-emerald-600 bg-white ring-2 ring-emerald-100' : 'border-emerald-100 bg-white/70 hover:border-emerald-400'}`}><p className="text-[10px] font-black uppercase tracking-[.12em] text-slate-400">Applicant Type</p><p className="mt-1 font-black text-slate-950">{record.applicantType}</p><p className="mt-3 text-[10px] font-black uppercase tracking-[.12em] text-slate-400">Sub-applicant Type</p><p className="mt-1 font-bold text-emerald-700">{record.subApplicantType}</p></button>)}</div></div>
        {selected ? <RecordDetails record={selected} /> : <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center"><Eye className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 font-black text-slate-600">Select an applicant type above to view details.</p></div>}
      </div>
    </div>
  </div>
}

export default function CteCtoDirectory() {
  const currentUser = JSON.parse(localStorage.getItem('user') || 'null')
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [selectedGroup, setSelectedGroup] = useState(null)

  async function load() {
    setLoading(true); setError('')
    try { const response = await api.get(API_ENDPOINTS.clients.cteCtoDirectory); setRecords(response.data?.clients || []) }
    catch (requestError) { setError(requestError?.response?.data?.error || 'Unable to load CTE and CTO/CCA details.') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  const groups = useMemo(() => groupCteCtoClients(records), [records])
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return !query ? groups : groups.filter((group) => [group.companyName, group.tradeName, group.leadCode, ...group.records.flatMap((record) => [record.applicantType, record.subApplicantType])].join(' ').toLowerCase().includes(query))
  }, [groups, search])
  const plantCount = groups.reduce((total, group) => total + group.records.reduce((sum, record) => sum + (record.cte?.plantWiseDetails?.length || 0), 0), 0)

  async function exportExcel() {
    setExporting(true); setError('')
    try { await downloadCteCtoExcel(filtered) }
    catch { setError('Unable to create the Excel file. Please retry.') }
    finally { setExporting(false) }
  }

  return <DashboardShell currentUser={currentUser}><main className="min-h-screen bg-[#f3f8f6] p-4 lg:p-6">
    <header className="rounded-3xl border border-emerald-100 bg-gradient-to-br from-white via-emerald-50/50 to-teal-50 p-6 shadow-sm"><div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-start gap-4"><span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-emerald-700 text-white shadow-lg shadow-emerald-700/20"><Factory className="h-7 w-7" /></span><div><p className="text-[10px] font-black uppercase tracking-[.22em] text-orange-500">Customer Hub</p><h1 className="mt-1 text-3xl font-black text-slate-950">CTO & CTE</h1><p className="mt-1 text-sm font-semibold text-slate-500">View plant-wise CTE and CTO/CCA details saved in Client Master.</p></div></div><div className="flex flex-wrap gap-2"><button onClick={load} disabled={loading} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 font-black text-slate-700"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button><button onClick={exportExcel} disabled={loading || exporting || !filtered.length} className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-700 px-5 font-black text-white shadow-lg shadow-emerald-700/20 disabled:opacity-50">{exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Download Excel</button></div></div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-white bg-white/80 p-4"><p className="text-xs font-black uppercase text-slate-400">Clients</p><p className="mt-1 text-2xl font-black text-slate-950">{groups.length}</p></div><div className="rounded-2xl border border-white bg-white/80 p-4"><p className="text-xs font-black uppercase text-slate-400">Applications</p><p className="mt-1 text-2xl font-black text-slate-950">{records.length}</p></div><div className="rounded-2xl border border-white bg-white/80 p-4"><p className="text-xs font-black uppercase text-slate-400">Plant Records</p><p className="mt-1 text-2xl font-black text-slate-950">{plantCount}</p></div></div>
    </header>
    {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 font-bold text-red-700">{error}</div>}
    <section className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-black text-slate-950">Client Master Directory</h2><p className="mt-1 text-xs font-semibold text-slate-500">Select View, then choose the required applicant or sub-applicant type.</p></div><label className="flex h-11 w-full items-center gap-2 rounded-xl border border-slate-200 px-4 sm:max-w-md"><Search className="h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search client, lead ID or applicant..." className="w-full border-0 bg-transparent text-sm font-semibold outline-none" /></label></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-slate-50 text-[11px] font-black uppercase tracking-[.1em] text-slate-500"><tr><th className="px-5 py-4">Client Name</th><th className="px-5 py-4">Lead ID</th><th className="px-5 py-4">Applicant / Sub-applicant</th><th className="px-5 py-4">Plants</th><th className="px-5 py-4 text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{loading ? <tr><td colSpan="5" className="p-16 text-center"><Loader2 className="mx-auto h-7 w-7 animate-spin text-emerald-700" /><p className="mt-3 font-bold text-slate-500">Loading Client Master records...</p></td></tr> : filtered.map((group) => { const plants = group.records.reduce((sum, record) => sum + (record.cte?.plantWiseDetails?.length || 0), 0); return <tr key={group.key} className="hover:bg-emerald-50/30"><td className="px-5 py-4"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Building2 className="h-4 w-4" /></span><div><p className="font-black text-slate-950">{group.companyName}</p>{group.tradeName && group.tradeName !== group.companyName && <p className="mt-0.5 text-xs font-semibold text-slate-400">{group.tradeName}</p>}</div></div></td><td className="px-5 py-4 font-bold text-emerald-700">{group.leadCode}</td><td className="px-5 py-4"><div className="flex flex-wrap gap-1.5">{group.records.slice(0, 3).map((record) => <span key={record.id} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-600">{record.subApplicantType !== 'Not applicable' ? record.subApplicantType : record.applicantType}</span>)}{group.records.length > 3 && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700">+{group.records.length - 3}</span>}</div></td><td className="px-5 py-4 font-black text-slate-700">{plants}</td><td className="px-5 py-4 text-right"><button onClick={() => setSelectedGroup(group)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 font-black text-emerald-700 hover:bg-emerald-50"><Eye className="h-4 w-4" />View</button></td></tr> })}{!loading && !filtered.length && <tr><td colSpan="5" className="p-16 text-center"><Factory className="mx-auto h-10 w-10 text-slate-300" /><p className="mt-3 font-black text-slate-500">No matching Client Master records found.</p></td></tr>}</tbody></table></div>
    </section>
    {selectedGroup && <ClientModal group={selectedGroup} onClose={() => setSelectedGroup(null)} />}
  </main></DashboardShell>
}
