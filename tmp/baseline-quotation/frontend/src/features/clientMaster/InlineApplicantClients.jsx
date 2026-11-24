import React, { useMemo, useState } from 'react'
import { Download, Search, Loader2 } from 'lucide-react'
import ServiceStatusIcon from './ServiceStatusIcon'
import { buildClientExportRows } from '../../utils/overallDashboardExports.mjs'

export default function InlineApplicantClients({ group, section }) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const clients = useMemo(() => group.clients.filter((client) => `${client.name} ${(client.references || []).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())), [group.clients, query])
  const pages = Math.max(1, Math.ceil(clients.length / 20))
  const currentPage = Math.min(page, pages)
  async function exportClients() {
    setExporting(true); setError('')
    try {
      const XLSX = await import('xlsx')
      const sheet = XLSX.utils.json_to_sheet(buildClientExportRows(clients, section.year, section.services))
      sheet['!cols'] = [{ wch: 8 }, { wch: 16 }, { wch: 40 }, { wch: 24 }, { wch: 32 }, { wch: 14 }, ...section.services.map(() => ({ wch: 24 }))]
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, section.year)
      XLSX.writeFile(book, `Closed-PO-clients-${section.year}-${group.type.replace(/[^a-z0-9]/gi, '-')}.xlsx`)
    } catch { setError('Export could not complete. Please retry.') }
    finally { setExporting(false) }
  }
  return <div className="border-y border-teal-100 bg-teal-50/50 p-3 sm:p-5">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-bold text-teal-900">{group.type} · {section.year}</h4><p className="mt-1 text-xs text-slate-500">Green check = closed PO service · Red cross = no closed PO</p></div><div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 rounded-xl border border-teal-100 bg-white px-3 py-2"><Search size={16} className="text-slate-400" /><input aria-label={`Search ${group.type} clients for ${section.year}`} placeholder="Search clients…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} className="min-w-0 bg-transparent text-sm outline-none" /></label><button type="button" onClick={exportClients} disabled={exporting || !clients.length} className="flex items-center gap-2 rounded-xl bg-teal-700 px-3 py-2 text-xs font-bold text-white transition hover:bg-teal-800 disabled:opacity-50">{exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}Export Excel ({clients.length})</button></div></div>
    {error && <p role="alert" className="mb-3 text-sm text-rose-700">{error}</p>}
    <div className="max-h-[480px] overflow-auto rounded-2xl border border-teal-100 bg-white"><table className="w-full border-separate border-spacing-0 text-left text-sm"><thead><tr><th className="sticky left-0 top-0 z-20 min-w-56 border-b bg-slate-100 px-4 py-3 text-xs text-slate-600">Client</th><th className="sticky top-0 z-10 min-w-24 border-b bg-slate-100 px-4 py-3 text-xs text-slate-600">Status</th>{section.services.map((service) => <th key={service} className="sticky top-0 z-10 min-w-36 border-b bg-slate-100 px-4 py-3 text-xs text-slate-600">{service}</th>)}</tr></thead><tbody>{clients.slice((currentPage - 1) * 20, currentPage * 20).map((client) => <tr key={client.key} className="group/client hover:bg-teal-50"><td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-4 py-3 font-semibold text-slate-800 group-hover/client:bg-teal-50">{client.name}{client.references?.length > 0 && <p className="mt-1 text-xs font-normal text-slate-400">{client.references.join(' · ')}</p>}</td><td className="border-b border-slate-100 px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${client.inactive ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{client.inactive ? 'Inactive' : 'Active'}</span></td>{section.services.map((service) => <td key={service} className="border-b border-slate-100 px-4 py-3 text-center"><ServiceStatusIcon taken={Boolean(client.services[service])} /></td>)}</tr>)}{!clients.length && <tr><td colSpan={section.services.length + 2} className="p-8 text-center text-slate-500">No clients match this selection.</td></tr>}</tbody></table></div>
    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500"><span>{clients.length} clients · Click {group.type} again to collapse</span>{pages > 1 && <div className="flex items-center gap-2"><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded-lg border bg-white px-3 py-2 disabled:opacity-40">Previous</button><span>{currentPage} / {pages}</span><button type="button" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)} className="rounded-lg border bg-white px-3 py-2 disabled:opacity-40">Next</button></div>}</div>
  </div>
}
