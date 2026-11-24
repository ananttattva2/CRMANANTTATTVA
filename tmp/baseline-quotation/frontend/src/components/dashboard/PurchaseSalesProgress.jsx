import React, { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import api from '../../services/api'

export default function PurchaseSalesProgress({ groups, financialYear }) {
  const currentYear = () => { const now = new Date(); const start = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; return `${start}-${String(start + 1).slice(-2)}` }
  const [selectedYear, setSelectedYear] = useState(/^20\d{2}-\d{2}$/.test(financialYear) ? financialYear : currentYear())
  useEffect(() => { if (/^20\d{2}-\d{2}$/.test(financialYear)) setSelectedYear(financialYear) }, [financialYear])
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let cancelled = false
    setData(null); setError('')
    api.get('/clients/dashboard/purchase-sales-progress', { params: { financialYear: selectedYear } })
      .then(({ data: result }) => { if (!cancelled) setData(result) })
      .catch(() => { if (!cancelled) setError('Could not load Purchase & Sales status. Please retry.') })
    return () => { cancelled = true }
  }, [selectedYear, refresh])
  const state = (row, section) => {
    const statuses = (row.serviceRows || [row]).map(service => data?.[section]?.[String(service.client?._id || service.id)] || { complete: false, status: 'Pending' })
    return { complete: statuses.every(status => status.complete), status: [...new Set(statuses.map(status => status.status))].join(' · ') }
  }
  return <div className="operations-client-details">
    <header><strong>Purchase &amp; Sales</strong><label className="flex items-center gap-2">Data Financial Year<select aria-label="Data Financial Year" value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)} className="rounded border px-2 py-1">{[...new Set([selectedYear, ...Array.from({ length: 12 }, (_, index) => { const start = Number(currentYear().slice(0, 4)) + 1 - index; return `${start}-${String(start + 1).slice(-2)}` })])].sort().reverse().map((year) => <option key={year}>{year}</option>)}</select></label><button type="button" className="operations-user-view" aria-label="Refresh Purchase and Sales" onClick={() => setRefresh((value) => value + 1)}><RefreshCw /></button></header>
    <p className="px-4 py-3 text-xs text-slate-500">Fully filled / assigned clients. All mandatory checklist controls, dates, proofs and required uploads must be complete.</p>
    {error ? <p role="alert" className="operations-export-error">{error}</p> : !data ? <p role="status" className="p-6">Loading Purchase &amp; Sales status…</p> : <div className="operations-user-status-scroll"><table className="operations-user-status-table" style={{ minWidth: 720 }}>
      <thead><tr><th rowSpan={2}>User Name</th><th rowSpan={2}>Client Name / Assigned Clients</th><th colSpan={2}>Data Status</th></tr><tr><th>Purchase</th><th>Sales</th></tr></thead>
      <tbody>{groups.map((group) => {
        const open = expanded === group.id
        return <React.Fragment key={group.id}>
          <tr className="operations-user-summary-row"><td><button type="button" className="operations-user-toggle" aria-expanded={open} onClick={() => setExpanded(open ? '' : group.id)}>{open ? <ChevronDown /> : <ChevronRight />}<strong>{group.name}</strong></button></td><td><b>{group.total} assigned clients</b></td>{['purchase', 'sales'].map((section) => {
            const done = group.rows.filter((row) => state(row, section).complete).length
            const percent = group.total ? Math.round(done / group.total * 100) : 0
            return <td key={section}><div className="operations-user-progress operations-user-progress-green"><strong>{done} / {group.total}</strong><span><i style={{ width: `${percent}%` }} /></span><small>{percent}%</small></div><small>{group.total - done} pending</small></td>
          })}</tr>
          {open && group.rows.map((row) => <tr key={row.id}><td>{group.name}</td><td><div className="operations-client-name"><span><strong>{row.companyName}</strong><small>{row.atplCode}</small></span></div></td>{['purchase', 'sales'].map((section) => <td key={section}><em className={state(row, section).complete ? 'status-received' : 'status-partial'}>{state(row, section).complete ? 'Fully filled' : 'Pending / Incomplete'}</em><small className="operations-status-date">{state(row, section).status}</small></td>)}</tr>)}
          {open && !group.total && <tr><td colSpan={4}>No clients allocated to this Operations user.</td></tr>}
        </React.Fragment>
      })}</tbody>
    </table>{!groups.length && <p className="p-6">No users or clients match this search.</p>}</div>}
  </div>
}
