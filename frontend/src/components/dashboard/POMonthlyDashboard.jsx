import './poMonthlyDashboard.css'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, CalendarDays, Coins, Download, RefreshCw, UserRound, X } from 'lucide-react'
import api, { readApiError } from '../../services/api'
import { PO_MONTHS, poPeriod, monthlyPO, piboPO, poApplicantCategory, poAmount, poApproval, filterPoApproval, poDetailExportRows } from '../../utils/poMonthly.mjs'

const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value)
function Details({ selection, onClose }) {
  const dialog = useRef(null)
  const [status, setStatus] = useState('ALL')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const filtered = useMemo(() => filterPoApproval(selection.records, status), [selection.records, status])
  useEffect(() => { dialog.current?.showModal() }, [])
  async function exportDetails() {
    if (exporting || !filtered.length) return
    setExporting(true); setExportError('')
    try {
      const XLSX = await import('xlsx')
      const worksheet = XLSX.utils.json_to_sheet(poDetailExportRows(filtered))
      worksheet['!cols'] = [{ wch: 24 }, { wch: 40 }, { wch: 24 }, { wch: 16 }, { wch: 20 }, { wch: 32 }, { wch: 16 }]
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'PO Details')
      const name = selection.title.replace(/[^a-z0-9-]+/gi, '-').slice(0, 90)
      XLSX.writeFile(workbook, `PO-details-${name}-${status}.xlsx`)
    } catch { setExportError('Excel export could not complete. Please retry.') }
    finally { setExporting(false) }
  }
  return <dialog ref={dialog} aria-labelledby="po-details-title" onCancel={onClose} className="w-[min(1100px,95vw)] rounded-2xl p-0 backdrop:bg-slate-900/50">
    <header className="flex items-center justify-between gap-4 border-b p-5"><div><h3 id="po-details-title" className="text-lg font-bold">{selection.title}</h3><p className="text-sm text-slate-500">{filtered.length} of {selection.records.length} PO entries · {money(poAmount(filtered))}</p></div><button type="button" aria-label="Close PO details" onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100"><X size={20} /></button></header>
    <div className="flex flex-wrap items-end justify-between gap-4 border-b bg-orange-50/50 px-5 py-4"><label className="text-xs font-bold text-slate-600">Approval status<select value={status} onChange={event => setStatus(event.target.value)} className="mt-1 block min-w-44 rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-sm"><option value="ALL">All statuses</option><option value="APPROVED">APPROVED</option><option value="PENDING">PENDING</option></select></label><button type="button" onClick={exportDetails} disabled={!filtered.length || exporting} className="flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-50"><Download size={16} />{exporting ? 'Exporting…' : 'Export Excel'}</button></div>
    {exportError && <p role="alert" className="px-5 py-3 text-sm text-rose-700">{exportError}</p>}
    <div className="max-h-[60vh] overflow-auto"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-slate-100"><tr>{['User', 'Client', 'PO number', 'PO date', 'Amount', 'Applicant category', 'Approval'].map(h => <th scope="col" key={h} className="p-4">{h}</th>)}</tr></thead><tbody>{filtered.map(r => <tr key={r.id} className="border-b"><td className="p-4">{r.ownerName}</td><td className="p-4">{r.clientName}</td><td className="p-4">{r.poNumber || 'Not recorded'}</td><td className="p-4">{poPeriod(r.poDate) ? new Date(r.poDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Not recorded'}</td><td className="whitespace-nowrap p-4">{money(Number(r.poAmount) || 0)}</td><td className="p-4">{poApplicantCategory(r)}</td><td className="p-4"><span className={`rounded-full px-3 py-1 text-xs font-bold ${poApproval(r) === 'APPROVED' ? 'bg-emerald-50 text-emerald-700' : poApproval(r) === 'PENDING' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{poApproval(r)}</span></td></tr>)}{!filtered.length && <tr><td colSpan={7} className="p-10 text-center text-slate-500">No PO entries match this approval status.</td></tr>}</tbody></table></div>
  </dialog>
}
export default function POMonthlyDashboard({ refreshToken }) {
  const [data, setData] = useState(null)
  const [year, setYear] = useState(() => poPeriod(new Date())?.year)
  const [search, setSearch] = useState('')
  const [view, setView] = useState('month')
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
        if (!Array.isArray(response.data?.records)) throw new Error('Invalid PO dashboard response. Please refresh and retry.')
        if (!controller.signal.aborted) { setData(response.data); setError(''); setSelection(null) }
      } catch (err) { if (!controller.signal.aborted) setError(err.code === 'ECONNABORTED' ? 'PO data took too long to load. Please retry.' : readApiError(err, 'PO dashboard could not load. Please retry.')) }
      finally { pending = false; if (!controller.signal.aborted) setLoading(false) }
    }
    load()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load() }, 60000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [refreshToken, reload])
  const records = useMemo(() => data?.records || [], [data])
  const years = useMemo(() => [...new Set([poPeriod(new Date()).year, ...records.map(r => poPeriod(r.poDate)?.year).filter(Boolean)])].sort().reverse(), [records])
  const matrix = useMemo(() => {
    if (view === 'pibo') return piboPO(records, year, search)
    const result = monthlyPO(records, year, search)
    return { ...result, columns: PO_MONTHS, rows: result.rows.map(row => ({ ...row, cells: row.months })) }
  }, [records, year, search, view])
  const columns = matrix.columns
  const undated = records.filter(r => !poPeriod(r.poDate) && String(r.ownerName || 'Unassigned').toLowerCase().includes(search.trim().toLowerCase()))
  function open(title, rows) { if (rows.length) setSelection({ title, records: rows }) }
  function cell(rows, title, metric, total = false) {
    const value = metric === 'count' ? rows.length : money(poAmount(rows))
    if (!rows.length) return <span className={total ? 'po-zero-total' : 'po-empty-cell'}>{total ? value : '—'}</span>
    return <button type="button" onClick={() => open(title, rows)} aria-label={`${title}: ${rows.length} PO entries, ${money(poAmount(rows))}`} className={`po-value-button ${metric === 'amount' ? 'po-amount' : ''}`}>{value}</button>
  }
  function exportCSV() {
    const csvRows = [['User', ...columns.flatMap(m => [`${m} PO entries`, `${m} amount INR`]), 'Total entries', 'Total amount INR'], ...matrix.rows.map(r => [r.name, ...r.cells.flatMap(m => [m.length, poAmount(m)]), r.records.length, poAmount(r.records)]), ['Grand total', ...columns.flatMap((_, i) => { const rows = matrix.rows.flatMap(r => r.cells[i]); return [rows.length, poAmount(rows)] }), matrix.records.length, poAmount(matrix.records)]]
    const csv = csvRows.map(r => r.map(v => `"${String(v).replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `PO-dashboard-${view}-${year}.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  if (!data) return <section id="po-monthly-panel" role="tabpanel" aria-labelledby="dashboard-tab-po" className="rounded-2xl border bg-white p-8"><h2 className="text-xl font-bold">PO Dashboard</h2>{error ? <div role="alert" className="mt-4 text-rose-700"><p>{error}</p><button type="button" disabled={loading} onClick={() => setReload(v => v + 1)} className="mt-4 rounded-xl bg-teal-700 px-5 py-3 text-white disabled:opacity-50">{loading ? 'Retrying…' : 'Retry loading PO data'}</button></div> : <p role="status" className="mt-4 text-teal-700">Loading PO data…</p>}</section>
  return <section id="po-monthly-panel" role="tabpanel" aria-labelledby="dashboard-tab-po" className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-xl font-black text-slate-900">PO Dashboard</h2><p className="mt-1 text-sm text-slate-500">{view === 'pibo' ? 'User-wise purchase orders · Applicant / PIBO category · Based on PO date' : 'User-wise purchase orders · April to March · Based on PO date'}</p></div><div className="flex flex-wrap items-end gap-3"><label className="text-xs font-semibold text-slate-600">Financial year<select value={year} onChange={e => setYear(e.target.value)} className="mt-1 block rounded-xl border bg-white px-4 py-2.5">{years.map(y => <option key={y}>{y}</option>)}</select></label><div role="group" aria-label="PO dashboard grouping" className="flex rounded-xl border border-orange-200 bg-white p-1">{[['month', 'Month-wise'], ['pibo', 'PIBO-wise']].map(([key, label]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => { setView(key); setSelection(null) }} className={`rounded-lg px-3 py-2 text-xs font-bold transition ${view === key ? 'bg-orange-500 text-white' : 'text-slate-600 hover:bg-orange-50'}`}>{label}</button>)}</div><label className="text-xs font-semibold text-slate-600">Search user<input value={search} onChange={e => setSearch(e.target.value)} placeholder="User name…" className="mt-1 block rounded-xl border px-4 py-2.5" /></label><button type="button" onClick={exportCSV} disabled={!matrix.records.length} className="flex items-center gap-2 rounded-xl border bg-white p-3 text-sm disabled:opacity-40"><Download size={16} />Export CSV</button><button type="button" aria-label="Refresh PO dashboard" disabled={loading} onClick={() => setReload(v => v + 1)} className="rounded-xl border bg-white p-3"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /></button></div></div>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">{error}</p>}
    {loading && <p role="status" className="text-sm text-teal-700">{data ? 'Refreshing PO data…' : 'Loading PO data…'}</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['PO entries', matrix.records.length], ['PO value', money(poAmount(matrix.records))], ['Clients', new Set(matrix.records.map(r => r.clientId || r.leadId)).size], ['Approved entries', matrix.records.filter(r => r.approvalStatus === 'APPROVED').length]].map(([title, value]) => <div key={title} className="rounded-2xl border border-teal-100 bg-white p-5"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p><p className="mt-2 text-2xl font-black text-teal-800">{value}</p></div>)}</div>
    <div className="po-monthly-table-shell">
      <table className="po-monthly-table" style={view === 'pibo' ? { minWidth: Math.max(900, 320 + columns.length * 130) } : undefined}>
        <caption className="sr-only">{view === 'pibo' ? 'PIBO-wise' : 'Monthly'} PO entry count and amount by user for {year}. Select a number or amount to view PO details.</caption>
        <thead>
          <tr><th scope="col" rowSpan={2} className="po-user-header"><span><UserRound size={18} />User Name</span></th>
            {columns.map(month => <th scope="colgroup" colSpan={2} key={month} className="po-month-header"><span>{view === 'month' ? <CalendarDays size={13} /> : <UserRound size={13} />}{month}</span></th>)}
            <th scope="colgroup" colSpan={2} className="po-fy-header"><span><BarChart3 size={18} />FY Total</span></th>
          </tr>
          <tr>{[...columns, 'FY Total'].map(month => <Fragment key={month}><th scope="col" className={month === 'FY Total' ? 'po-fy-subheader' : 'po-subheader'}>Count</th><th scope="col" className={month === 'FY Total' ? 'po-fy-subheader' : 'po-subheader'}>Amount (₹)</th></Fragment>)}</tr>
        </thead>
        <tbody>{matrix.rows.map((row, index) => {
          const initials = row.name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase()
          return <tr key={row.key}><th scope="row" className="po-user-cell"><button type="button" onClick={() => open(`${row.name} · ${year}`, row.records)}><span className={`po-user-avatar po-avatar-${index % 5}`}>{initials}</span><span>{row.name}</span></button></th>
            {row.cells.map((rows, i) => <Fragment key={i}><td className="po-count-cell">{cell(rows, `${row.name} · ${columns[i]} · ${year}`, 'count')}</td><td className="po-amount-cell">{cell(rows, `${row.name} · ${columns[i]} · ${year}`, 'amount')}</td></Fragment>)}
            <td className="po-fy-cell">{cell(row.records, `${row.name} · ${year}`, 'count')}</td><td className="po-fy-cell">{cell(row.records, `${row.name} · ${year}`, 'amount')}</td>
          </tr>
        })}{!matrix.rows.length && !loading && <tr><td colSpan={3 + columns.length * 2} className="po-no-results">No PO entries found for this financial year and user search.</td></tr>}</tbody>
        <tfoot><tr><th scope="row" className="po-total-label"><span><BarChart3 size={22} />Total</span></th>{columns.map((month, i) => {
          const rows = matrix.rows.flatMap(row => row.cells[i])
          return <td colSpan={2} key={month} className="po-month-total"><div>{cell(rows, `${month} · ${year}`, 'count', true)}</div><div>{cell(rows, `${month} · ${year}`, 'amount', true)}</div></td>
        })}<td colSpan={2} className="po-fy-grand-total"><div>{cell(matrix.records, `All users · ${year}`, 'count', true)}</div><div>{cell(matrix.records, `All users · ${year}`, 'amount', true)}</div></td></tr></tfoot>
      </table>
    </div>
    <div className="flex items-center gap-3 rounded-xl border border-orange-100 bg-white px-4 py-3"><span className="rounded-full bg-orange-50 p-2 text-orange-600"><Coins size={17} /></span><div><p className="text-sm font-bold text-orange-600">GST included where recorded</p><p className="text-xs text-slate-500">Saved PO amounts are shown as entered. GST is not added again.</p></div></div>
    {!!undated.length && <button type="button" onClick={() => open('PO date not recorded · All years', undated)} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{undated.length} entries have no valid PO date · {money(poAmount(undated))} · View details</button>}
    <p className="text-xs text-slate-500">Amounts follow saved PO entries; separate service or financial-year entries count separately. Your account’s existing access rules apply. Entries without a PO date are excluded from monthly totals.</p>
    {selection && <Details selection={selection} onClose={() => setSelection(null)} />}
  </section>
}
