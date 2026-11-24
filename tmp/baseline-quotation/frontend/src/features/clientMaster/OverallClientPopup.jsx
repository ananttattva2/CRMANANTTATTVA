import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { Download, Search, Users, X, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import ServiceStatusIcon from './ServiceStatusIcon'
import { buildClientExportRows } from '../../utils/overallDashboardExports.mjs'

export default function OverallClientPopup({ section, type, onClose }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const root = useRef(null)
  const reducedMotion = useReducedMotion()
  const source = type ? section.groups.find((group) => group.type === type)?.clients || [] : section.clients
  const clients = useMemo(() => source.filter((client) => `${client.name} ${(client.references || []).join(' ')} ${(client.types || []).join(' ')}`.toLowerCase().includes(search.toLowerCase()) && (status === 'all' || client.inactive === (status === 'inactive'))), [source, search, status])
  const totalPages = Math.max(1, Math.ceil(clients.length / 20))
  const currentPage = Math.min(page, totalPages)
  const visible = clients.slice((currentPage - 1) * 20, currentPage * 20)
  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    root.current?.querySelector('input')?.focus()
    function handleKey(event) {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab') return
      const controls = [...root.current.querySelectorAll('button:not([disabled]), input, select, [tabindex="0"]')]
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', handleKey); previousFocus?.focus?.() }
  }, [onClose])
  async function exportClients() {
    setExporting(true); setError('')
    try {
      const XLSX = await import('xlsx')
      const rows = buildClientExportRows(clients, section.year, section.services)
      const worksheet = XLSX.utils.json_to_sheet(rows)
      worksheet['!cols'] = Object.keys(rows[0] || {}).map((key) => ({ wch: key === 'Client' ? 38 : key === 'Applicant / Sub-applicant' ? 32 : 24 }))
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, section.year)
      XLSX.writeFile(workbook, `Closed-PO-clients-${section.year}${type ? `-${type.replace(/[^a-z0-9]/gi, '-')}` : ''}.xlsx`)
    } catch { setError('Export could not complete. Please retry.') }
    finally { setExporting(false) }
  }
  return createPortal(<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <motion.section ref={root} role="dialog" aria-modal="true" aria-labelledby="overall-client-list-title" initial={reducedMotion ? false : { y: 24, scale: .98 }} animate={{ y: 0, scale: 1 }} exit={reducedMotion ? {} : { y: 16, scale: .98 }} className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl border border-white/20 bg-white shadow-2xl">
      <header className="flex items-start justify-between gap-4 bg-gradient-to-r from-emerald-950 to-teal-800 px-6 py-5 text-white"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-teal-200">Closed PO portfolio · FY {section.year}</p><h2 id="overall-client-list-title" className="mt-2 flex items-center gap-2 text-xl font-black"><Users size={22} />{type || 'All clients'}<span className="ml-1 rounded-full bg-white/15 px-3 py-1 text-sm">{source.length}</span></h2><p className="mt-2 text-xs text-teal-100">Each company appears once. Only services with closed POs in this financial year are included.</p></div><button type="button" onClick={onClose} aria-label="Close client list" className="rounded-xl bg-white/10 p-2 transition hover:bg-white/20"><X size={22} /></button></header>
      <div className="flex flex-wrap items-center gap-3 border-b bg-slate-50 px-5 py-4"><label className="flex min-w-48 flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5"><Search size={17} className="text-slate-400" /><input aria-label="Search client list" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search client, number or applicant type…" className="w-full bg-transparent text-sm outline-none" /></label><select aria-label="Filter client status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="all">All clients</option><option value="active">Active clients</option><option value="inactive">Inactive clients</option></select><button type="button" disabled={exporting || !clients.length} onClick={exportClients} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50">{exporting ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}Export Excel ({clients.length})</button></div>
      {error && <p role="alert" className="bg-rose-50 px-5 py-3 text-sm text-rose-700">{error}</p>}
      <div className="min-h-0 flex-1 overflow-auto"><table className="w-full border-separate border-spacing-0 text-left text-sm"><thead><tr>{['No.', 'Client', 'Applicant / Sub-applicant', 'Status', ...section.services].map((name, index) => <th key={name} className={`sticky top-0 z-10 border-b bg-slate-100 px-4 py-4 text-xs font-bold text-slate-600 ${index === 1 ? 'min-w-56' : index > 3 ? 'min-w-40' : 'min-w-20'}`}>{name}</th>)}</tr></thead><tbody>{visible.map((client, index) => <tr key={client.key} className="hover:bg-teal-50/70"><td className="border-b border-slate-100 px-4 py-4 text-slate-400">{(currentPage - 1) * 20 + index + 1}</td><td className="border-b border-slate-100 px-4 py-4 font-bold text-slate-900">{client.name}{client.references?.length > 0 && <p className="mt-1 text-xs font-normal text-slate-400">{client.references.join(' · ')}</p>}</td><td className="border-b border-slate-100 px-4 py-4 text-slate-500">{client.types.join(', ')}</td><td className="border-b border-slate-100 px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${client.inactive ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{client.inactive ? 'Inactive' : 'Active'}</span></td>{section.services.map((service) => <td key={service} className="border-b border-slate-100 px-4 py-4 text-center"><ServiceStatusIcon taken={Boolean(client.services[service])} /></td>)}</tr>)}{!visible.length && <tr><td colSpan={section.services.length + 4} className="p-12 text-center text-slate-500">No clients match this selection.</td></tr>}</tbody></table></div>
      <footer className="flex items-center justify-between gap-3 border-t bg-slate-50 px-5 py-3 text-xs text-slate-500"><span>{clients.length} clients · {section.year} · Green check = closed service · Red cross = no closed PO</span><div className="flex items-center gap-3"><button type="button" aria-label="Previous clients" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded-lg border bg-white p-2 disabled:opacity-40"><ChevronLeft size={16} /></button><span>{currentPage} / {totalPages}</span><button type="button" aria-label="Next clients" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)} className="rounded-lg border bg-white p-2 disabled:opacity-40"><ChevronRight size={16} /></button></div></footer>
    </motion.section>
  </motion.div>, document.body)
}
