import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUpRight, FileSpreadsheet, Loader2, RefreshCw, Search, ShieldCheck, Users, X } from 'lucide-react'
import api from '../../services/api'
import { formatDisplayDate } from '../../utils/dateFormat'
import { buildApplicationPortfolio, PIBO_CATEGORIES, STATUS_COLUMNS, matchesPortfolioSearch, offeredServiceColumns, applicationServiceSummaryRecords as applicationSummaryRecords, matchesApplicationService, matchesServiceSummary, matchesStatusSummary, annualReturnYearForDate, annualActionReasons } from '../../utils/applicationPortfolio.mjs'
import './applicationPortfolio.css'

function ClientRecordsPopup({ selection, onClose }) {
  const dialog = useRef(null)
  const [query, setQuery] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  async function exportExcel() {
    if (exporting || !records.length) return
    setExporting(true); setExportError('')
    try {
      const { downloadApplicationPortfolioExcel } = await import('../../utils/applicationPortfolioExport.mjs')
      await downloadApplicationPortfolioExcel(records, selection.name, selection.label)
    } catch { setExportError('Excel download failed. Please retry.') } finally { setExporting(false) }
  }
  useEffect(() => { dialog.current?.showModal() }, [])
  const records = selection.records.filter(row => matchesPortfolioSearch(row, query))
  return <dialog ref={dialog} className="portfolio-dialog" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose() }} aria-labelledby="portfolio-dialog-title">
    <header><div className="portfolio-heading"><span className="portfolio-icon"><Users size={23} /></span><div><small>ASSIGNED APPLICATIONS</small><h2 id="portfolio-dialog-title">{selection.name}</h2><p>{selection.label} · {selection.records.length} applications</p></div></div><button type="button" className="portfolio-icon-button" onClick={onClose} aria-label="Close client details"><X size={20} /></button></header>
    <div className="portfolio-toolbar"><label className="portfolio-search"><Search size={17} /><input aria-label="Search client name, lead ID or service" placeholder="Search client, lead ID or service" value={query} onChange={event => setQuery(event.target.value)} /></label><span>{records.length} records shown<button type="button" className="portfolio-icon-button" aria-label="Download Excel" title="Download Excel" disabled={exporting || !records.length} onClick={exportExcel}>{exporting ? <Loader2 size={18} className="animate-spin" /> : <FileSpreadsheet size={18} />}</button></span></div>
    {exportError && <p role="alert" className="portfolio-error">{exportError}</p>}
    <div className="portfolio-dialog-table"><table><thead><tr>{['Unique ID', 'Legal Name', ...(selection.key === 'annualActionRequired' ? ['Action Required'] : []), 'Client Status', 'Visibility', 'CPCB Status', 'PIBo Category', 'Unit', 'State', 'Created'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{records.map(row => <tr key={row.id}><td>{row.code}</td><td><strong>{row.name}</strong>{row.services && <details className="portfolio-service-details"><summary>View {row.services.length} assigned service records</summary><div className="portfolio-service-table"><table><thead><tr>{['Lead ID', 'Saved Company Name', 'Applicant', 'Industry', 'Service Category', 'Services Offered', 'Unit', 'CPCB Status'].map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{row.services.map(service => <tr key={service.id}><td>{service.leadCode || service.code}</td><td>{service.name}</td><td>{service.category}</td><td>{service.industry || 'Not recorded'}</td><td>{service.eprCategory || 'Not recorded'}</td><td>{service.offered || 'Not recorded'}</td><td>{service.unit || 'Not recorded'}</td><td>{service.cpcb}</td></tr>)}</tbody></table></div></details>}</td>{selection.key === 'annualActionRequired' && <td><ul className="portfolio-action-reasons">{annualActionReasons(row).map(reason => <li key={reason}>{reason}</li>)}</ul></td>}<td>{row.clientStatus}</td><td>{row.visibility}</td><td><span className={`portfolio-status portfolio-status-${row.bucket}`}>{row.cpcb}</span></td><td>{row.category}</td><td>{row.unit || 'Not recorded'}</td><td>{row.state}</td><td>{row.created ? formatDisplayDate(row.created) : 'Not recorded'}</td></tr>)}</tbody></table>{!records.length && <p className="portfolio-empty">No matching applications.</p>}</div>
    <footer><ShieldCheck size={16} />Saved client and CPCB statuses · Only accessible assigned records are shown</footer>
  </dialog>
}

export default function ApplicationPortfolio({ mode, refreshToken = 0 }) {
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState(null)
  const reducedMotion = useReducedMotion()
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    api.get('/dashboard-insights/upload-tracker', { params: { assignmentsOnly: 'true', portfolioOnly: 'true' }, signal: controller.signal, timeout: 45000 }).then(response => { if (!controller.signal.aborted) setPayload(response.data) }).catch(err => { if (!controller.signal.aborted) setError(err.response?.data?.error || 'Unable to load application records. Please retry.') }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [refresh, refreshToken])
  useEffect(() => { const timer = setInterval(() => { if (document.visibilityState === 'visible') setRefresh(value => value + 1) }, 60000); return () => clearInterval(timer) }, [])
  useEffect(() => { setSelection(null) }, [mode])
  const groups = useMemo(() => buildApplicationPortfolio(payload?.assignments || [], payload?.users || []), [payload])
  const distribution = mode === 'spoc'
  const serviceSummary = mode === 'services'
  const reportGroups = useMemo(() => distribution ? groups : groups.map(group => ({ ...group, records: applicationSummaryRecords(group) })), [groups, distribution, serviceSummary])
  const shown = reportGroups.filter(group => group.name.toLowerCase().includes(query.toLowerCase()) || group.records.some(row => matchesPortfolioSearch(row, query)))
  const allRecords = shown.flatMap(group => group.records)
  const categories = PIBO_CATEGORIES
  const annualReturnYear = annualReturnYearForDate()
  const serviceColumns = useMemo(() => offeredServiceColumns(groups), [groups])
  const columns = distribution ? [['total', 'Total'], ...categories.map(category => [category, category])] : serviceSummary ? [['total', 'Total'], ...serviceColumns.flatMap(service => service === 'Annual Return Filling' ? [[service, `Annual Return Filling (${annualReturnYear})`], ['annualActionRequired', 'AR Action Required']] : [[service, service]]), ...(groups.some(group => group.records.some(row => matchesApplicationService(row, 'unclassified'))) ? [['unclassified', 'Not Closed / Service Not Recorded']] : [])] : [...STATUS_COLUMNS.slice(0, 6), ...[...new Set(groups.flatMap(group => applicationSummaryRecords(group).flatMap(row => row.annualYears)))].filter(year => !['2025-26', '2026-27', '2027-28'].includes(year)).sort().map(year => [`annual:${year}`, year]), ...STATUS_COLUMNS.slice(6)]
  const matches = (row, key) => distribution ? key === 'total' || row.category === key : serviceSummary ? matchesServiceSummary(row, key) : matchesStatusSummary(row, key)
  const open = (name, records, label = 'All categories', key = '') => setSelection({ name, records, label, key })
  const title = distribution ? 'Application Distribution by SPOC & PIBo' : serviceSummary ? 'Application servise Summary' : 'Application Status Summary'
  const annualStatusColumns = columns.filter(([key]) => key.startsWith('annual:'))
  const registrationStatusColumns = columns.filter(([key]) => key === 'registrationApproved')
  const otherServicesStatusColumns = columns.filter(([key]) => key === 'otherServicesApproved')
  const groupedStatusKeys = new Set(['total', 'registrationApproved', 'otherServicesApproved'])
  const otherStatusColumns = columns.filter(([key]) => !key.startsWith('annual:') && !groupedStatusKeys.has(key))
  const registrationColumnIndex = columns.findIndex(([key]) => key === 'registrationApproved')
  const leadingStatusColumns = otherStatusColumns.filter(([key]) => columns.findIndex(([columnKey]) => columnKey === key) < registrationColumnIndex)
  const otherServicesColumnIndex = columns.findIndex(([key]) => key === 'otherServicesApproved')
  const trailingStatusColumns = otherStatusColumns.filter(([key]) => columns.findIndex(([columnKey]) => columnKey === key) > otherServicesColumnIndex)
  const popupLabel = (key, label) => key === 'registrationApproved' ? 'Registration Approved' : key === 'otherServicesApproved' ? 'Other Services Approved' : label
  return <motion.section role="tabpanel" id={`portfolio-${mode}`} aria-labelledby={`dashboard-tab-${mode}`} initial={reducedMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .2 }} className="application-portfolio">
    <h2 className="sr-only">{title}</h2>
    <div className="portfolio-toolbar"><label className="portfolio-search"><Search size={17} /><input aria-label="Search SPOC or client" placeholder="Search SPOC or client" value={query} onChange={event => setQuery(event.target.value)} /></label><span>Click a SPOC or count to explore clients <ArrowUpRight size={14} /><button type="button" className="portfolio-icon-button" aria-label="Refresh applications" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button></span></div>
    {error && <div role="alert" className="portfolio-error">{error}<button type="button" onClick={() => setRefresh(value => value + 1)}>Retry</button></div>}
    {loading && !payload ? <div className="portfolio-empty" role="status"><Loader2 className="animate-spin" />Loading assigned applications…</div> : <div className="portfolio-matrix"><table><thead>{distribution || serviceSummary ? <tr><th>AnantTattva SPOC</th>{columns.map(([key, label]) => <th key={key} className={key === 'total' ? 'portfolio-live-column' : key === 'annualActionRequired' ? 'portfolio-action-column' : undefined}>{label}</th>)}</tr> : <><tr><th rowSpan={2}>AnantTattva SPOC</th><th rowSpan={2} className="portfolio-live-column">Total</th><th colSpan={annualStatusColumns.length}>Annual Return Applicable</th>{leadingStatusColumns.map(([key, label]) => <th key={key} rowSpan={2} className={key === 'annualActionRequired' ? 'portfolio-action-column' : undefined}>{label}</th>)}{registrationStatusColumns.length > 0 && <th colSpan={registrationStatusColumns.length}>Registration</th>}{otherServicesStatusColumns.length > 0 && <th colSpan={otherServicesStatusColumns.length}>Other Services</th>}{trailingStatusColumns.map(([key, label]) => <th key={key} rowSpan={2}>{label}</th>)}</tr><tr>{annualStatusColumns.map(([key, label]) => <th key={key}>{label}</th>)}{registrationStatusColumns.map(([key, label]) => <th key={key}>{label}</th>)}{otherServicesStatusColumns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></>}</thead><tbody>{shown.map((group, index) => <tr key={group.id}><td><button type="button" className="portfolio-person" onClick={() => open(group.name, group.records)}><span className={`portfolio-avatar portfolio-avatar-${index % 4}`}>{group.name.split(' ').map(part => part[0]).slice(0, 2).join('')}</span><strong>{group.name}</strong><ArrowUpRight size={14} /></button></td>{columns.map(([key, label]) => { const records = group.records.filter(row => matches(row, key)); return <td key={key} className={key === 'total' ? 'portfolio-live-column' : key === 'annualActionRequired' ? 'portfolio-action-column' : undefined}><button type="button" className={`portfolio-count ${records.length ? 'has-records' : ''}`} aria-label={`${group.name}: ${records.length} ${popupLabel(key, label)}`} onClick={() => open(group.name, records, popupLabel(key, label), key)}>{records.length}</button></td> })}</tr>)}</tbody><tfoot><tr><th>Grand Total</th>{columns.map(([key, label]) => <td key={key} className={key === 'total' ? 'portfolio-live-column' : key === 'annualActionRequired' ? 'portfolio-action-column' : undefined}><button type="button" onClick={() => open('All SPOCs', allRecords.filter(row => matches(row, key)), popupLabel(key, label), key)}>{allRecords.filter(row => matches(row, key)).length}</button></td>)}</tr></tfoot></table>{!shown.length && <p className="portfolio-empty">No assigned applications match this search.</p>}</div>}
    <footer>{distribution ? 'Each company + PIBo category + unit counts once per assigned SPOC.' : serviceSummary ? `Annual Return Filling shows ${annualReturnYear} applications only: CPCB Approved, received PO in the current financial year, closed service, manager assignment and permanent staff assignment. Annual Return and Annual Filing/Filling are grouped together.` : 'Annual Return year columns include only qualifying CPCB Approved Annual Return/Filling applications. Registration > Approved shows approved Registration services; Other Services > Approved shows every other approved recorded service. AR Action Required highlights excluded Annual Return records. Other CPCB statuses remain in Applied, Under Review, Not Started or Rejected.'}</footer>
    {selection && <ClientRecordsPopup selection={selection} onClose={() => setSelection(null)} />}
  </motion.section>
}
