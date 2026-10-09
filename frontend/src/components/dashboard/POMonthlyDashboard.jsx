import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, RefreshCw, X } from 'lucide-react'
import api from '../../services/api'
import { PO_MONTHS, poPeriod, monthlyPO, poAmount } from '../../utils/poMonthly.mjs'

const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value)
function Details({ selection, onClose }) {
  const dialog = useRef(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} onCancel={onClose} className="w-[min(1100px,95vw)] rounded-2xl p-0 backdrop:bg-slate-900/50">
    <header className="flex items-center justify-between border-b p-5"><div><h3 className="text-lg font-bold">{selection.title}</h3><p className="text-sm text-slate-500">{selection.records.length} PO entries · {money(poAmount(selection.records))}</p></div><button type="button" aria-label="Close PO details" onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100"><X size={20} /></button></header>
    <div className="max-h-[65vh] overflow-auto"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-slate-100"><tr>{['User', 'Client', 'PO number', 'PO date', 'Amount', 'Approval'].map(h => <th key={h} className="p-4">{h}</th>)}</tr></thead><tbody>{selection.records.map(r => <tr key={r.id} className="border-b"><td className="p-4">{r.ownerName}</td><td className="p-4">{r.clientName}</td><td className="p-4">{r.poNumber || 'Not recorded'}</td><td className="p-4">{poPeriod(r.poDate) ? new Date(r.poDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Not recorded'}</td><td className="whitespace-nowrap p-4">{money(Number(r.poAmount) || 0)}</td><td className="p-4">{r.approvalStatus}</td></tr>)}</tbody></table></div>
  </dialog>
}
export default function POMonthlyDashboard({ refreshToken }) {
  const [data, setData] = useState(null)
  const [year, setYear] = useState(() => poPeriod(new Date())?.year)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [selection, setSelection] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    let pending = false
    async function load() {
      if (pending) return
      pending = true; setLoading(true)
      try {
        const response = await api.get('/dashboard-insights/purchase-orders', { params: { view: 'monthly' }, signal: controller.signal, timeout: 45000 })
        if (!controller.signal.aborted) { setData(response.data); setError(''); setSelection(null) }
      } catch (err) { if (!controller.signal.aborted) setError(err.response?.data?.error || 'PO dashboard could not load. Please retry.') }
      finally { pending = false; if (!controller.signal.aborted) setLoading(false) }
    }
    load()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load() }, 60000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [refreshToken, reload])
  const records = useMemo(() => data?.records || [], [data])
  const years = useMemo(() => [...new Set([poPeriod(new Date()).year, ...records.map(r => poPeriod(r.poDate)?.year).filter(Boolean)])].sort().reverse(), [records])
  const matrix = useMemo(() => monthlyPO(records, year, search), [records, year, search])
  const undated = records.filter(r => !poPeriod(r.poDate) && String(r.ownerName || 'Unassigned').toLowerCase().includes(search.trim().toLowerCase()))
  function open(title, rows) { if (rows.length) setSelection({ title, records: rows }) }
  function cell(rows, title) { return rows.length ? <button type="button" onClick={() => open(title, rows)} aria-label={`${title}: ${rows.length} PO entries, ${money(poAmount(rows))}`} className="w-full rounded-xl px-2 py-3 text-teal-800 hover:bg-teal-100 focus-visible:outline-teal-700"><strong className="block">{rows.length}</strong><span className="mt-1 block whitespace-nowrap text-[11px]">{money(poAmount(rows))}</span></button> : <span className="text-slate-300">—</span> }
  function exportCSV() {
    const csvRows = [['User', ...PO_MONTHS.flatMap(m => [`${m} PO entries`, `${m} amount INR`]), 'Total entries', 'Total amount INR'], ...matrix.rows.map(r => [r.name, ...r.months.flatMap(m => [m.length, poAmount(m)]), r.records.length, poAmount(r.records)]), ['Grand total', ...PO_MONTHS.flatMap((_, i) => { const rows = matrix.rows.flatMap(r => r.months[i]); return [rows.length, poAmount(rows)] }), matrix.records.length, poAmount(matrix.records)]]
    const csv = csvRows.map(r => r.map(v => `"${String(v).replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `PO-dashboard-${year}.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section id="po-monthly-panel" role="tabpanel" aria-labelledby="dashboard-tab-po" className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-xl font-black text-slate-900">PO Dashboard</h2><p className="mt-1 text-sm text-slate-500">User-wise purchase orders · April to March · Based on PO date</p></div><div className="flex flex-wrap items-end gap-3"><label className="text-xs font-semibold text-slate-600">Financial year<select value={year} onChange={e => setYear(e.target.value)} className="mt-1 block rounded-xl border bg-white px-4 py-2.5">{years.map(y => <option key={y}>{y}</option>)}</select></label><label className="text-xs font-semibold text-slate-600">Search user<input value={search} onChange={e => setSearch(e.target.value)} placeholder="User name…" className="mt-1 block rounded-xl border px-4 py-2.5" /></label><button type="button" onClick={exportCSV} disabled={!matrix.records.length} className="flex items-center gap-2 rounded-xl border bg-white p-3 text-sm disabled:opacity-40"><Download size={16} />Export CSV</button><button type="button" aria-label="Refresh PO dashboard" disabled={loading} onClick={() => setReload(v => v + 1)} className="rounded-xl border bg-white p-3"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /></button></div></div>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">{error}</p>}
    {loading && <p role="status" className="text-sm text-teal-700">{data ? 'Refreshing PO data…' : 'Loading PO data…'}</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['PO entries', matrix.records.length], ['PO value', money(poAmount(matrix.records))], ['Clients', new Set(matrix.records.map(r => r.clientId || r.leadId)).size], ['Approved entries', matrix.records.filter(r => r.approvalStatus === 'APPROVED').length]].map(([title, value]) => <div key={title} className="rounded-2xl border border-teal-100 bg-white p-5"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p><p className="mt-2 text-2xl font-black text-teal-800">{value}</p></div>)}</div>
    <div className="overflow-auto rounded-2xl border border-slate-200 bg-white"><table className="w-full text-center text-sm"><caption className="p-4 text-left text-xs text-slate-500">Each cell shows PO entry count and amount. Click any count to see the client and PO details.</caption><thead><tr className="bg-slate-100"><th scope="col" className="sticky left-0 z-10 min-w-52 bg-slate-100 p-4 text-left">User name</th>{PO_MONTHS.map(m => <th scope="col" key={m} className="min-w-28 p-4">{m}</th>)}<th scope="col" className="min-w-36 bg-teal-50 p-4">FY total</th></tr></thead><tbody>{matrix.rows.map(row => <tr key={row.key} className="border-t border-slate-100 even:bg-slate-50"><th scope="row" className="sticky left-0 bg-white p-4 text-left"><button type="button" onClick={() => open(`${row.name} · ${year}`, row.records)} className="text-teal-800 hover:underline">{row.name}</button></th>{row.months.map((rows, i) => <td key={i} className="p-1">{cell(rows, `${row.name} · ${PO_MONTHS[i]} · ${year}`)}</td>)}<td className="bg-teal-50 p-1">{cell(row.records, `${row.name} · ${year}`)}</td></tr>)}{!matrix.rows.length && !loading && <tr><td colSpan={14} className="p-10 text-slate-500">No PO entries found for this financial year and user search.</td></tr>}</tbody><tfoot><tr className="border-t bg-teal-50 font-bold"><th scope="row" className="sticky left-0 bg-teal-50 p-4 text-left">Grand total</th>{PO_MONTHS.map((m, i) => <td key={m} className="p-1">{cell(matrix.rows.flatMap(r => r.months[i]), `${m} · ${year}`)}</td>)}<td className="p-1">{cell(matrix.records, `All users · ${year}`)}</td></tr></tfoot></table></div>
    {!!undated.length && <button type="button" onClick={() => open('PO date not recorded · All years', undated)} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{undated.length} entries have no valid PO date · {money(poAmount(undated))} · View details</button>}
    <p className="text-xs text-slate-500">Amounts follow saved PO entries; separate service or financial-year entries count separately. Your account’s existing access rules apply. Entries without a PO date are excluded from monthly totals.</p>
    {selection && <Details selection={selection} onClose={() => setSelection(null)} />}
  </section>
}
