import { PORTFOLIO_WASTE_CATEGORIES, portfolioGroupsForWasteCategory } from '../../utils/portfolioWasteCategories.mjs'
import { readPageSnapshot, savePageSnapshot } from '../../services/pageReadSnapshot'
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUpRight, FileSpreadsheet, Loader2, Minus, Plus, RefreshCw, Search, ShieldCheck, Users, X } from 'lucide-react'
import api from '../../services/api'
import { formatDisplayDate } from '../../utils/dateFormat'
import { buildApplicationPortfolio, applicationReportGroups, PIBO_CATEGORIES, STATUS_COLUMNS, PENDING_STATUS_KEYS, matchesPortfolioSearch, applicationServiceSummaryRecords as applicationSummaryRecords, matchesApplicationService, matchesDistributionSummary, matchesServiceSummary, matchesStatusSummary, matchesPortfolioSection, annualActionReasons, uniquePortfolioServiceDetails, annualReturnYearForDate } from '../../utils/applicationPortfolio.mjs'
import './applicationPortfolio.css'

function ClientRecordsPopup({ selection, onClose }) {
  const dialog = useRef(null)
  const [query, setQuery] = useState('')
  const [expandedRecord, setExpandedRecord] = useState('')
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
  const records = selection.records.filter(row => matchesPortfolioSearch(row, query)).map(row => ({
    ...row, services: uniquePortfolioServiceDetails(row.services)
  }))
  const columnCount = selection.key === 'annualActionRequired' ? 10 : 9
  return <dialog ref={dialog} className="portfolio-dialog" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose() }} aria-labelledby="portfolio-dialog-title">
    <header><div className="portfolio-heading"><span className="portfolio-icon"><Users size={23} /></span><div><small>ASSIGNED APPLICATIONS</small><h2 id="portfolio-dialog-title">{selection.name}</h2><p>{selection.label} · {selection.records.length} applications</p></div></div><button type="button" className="portfolio-icon-button" onClick={onClose} aria-label="Close client details"><X size={20} /></button></header>
    <div className="portfolio-toolbar"><label className="portfolio-search"><Search size={17} /><input aria-label="Search client name, lead ID or service" placeholder="Search client, lead ID or service" value={query} onChange={event => setQuery(event.target.value)} /></label><span>{records.length} records shown<button type="button" className="portfolio-icon-button" aria-label="Download Excel" title="Download Excel" disabled={exporting || !records.length} onClick={exportExcel}>{exporting ? <Loader2 size={18} className="animate-spin" /> : <FileSpreadsheet size={18} />}</button></span></div>
    {exportError && <p role="alert" className="portfolio-error">{exportError}</p>}
    <div className="portfolio-dialog-table"><table><thead><tr>{['Unique ID', 'Legal Name', ...(selection.key === 'annualActionRequired' ? ['Action Required'] : []), 'Client Status', 'Visibility', 'CPCB Status', 'PIBo Category', 'Unit', 'State', 'Created'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{records.map(row => {
      const rowKey = String(row.id || row.code)
      const expanded = expandedRecord === rowKey
      const services = row.services || []
      return <React.Fragment key={rowKey}><tr><td>{row.code}</td><td><div className="portfolio-client-name"><strong>{row.name}</strong>{services.length > 0 && <button type="button" className="portfolio-service-toggle" aria-expanded={expanded} aria-controls={`portfolio-services-${rowKey}`} aria-label={`${expanded ? 'Hide' : 'Show'} ${services.length} assigned service ${services.length === 1 ? 'record' : 'records'} for ${row.name}`} onClick={() => setExpandedRecord(current => current === rowKey ? '' : rowKey)}>{expanded ? <Minus size={16} /> : <Plus size={16} />}<span>{services.length} service{services.length === 1 ? '' : 's'}</span></button>}</div></td>{selection.key === 'annualActionRequired' && <td><ul className="portfolio-action-reasons">{annualActionReasons(row).map(reason => <li key={reason}>{reason}</li>)}</ul></td>}<td>{row.clientStatus}</td><td>{row.visibility}</td><td><span className={`portfolio-status portfolio-status-${row.bucket}`}>{row.cpcb}</span></td><td>{row.category}</td><td>{row.unit || 'Not recorded'}</td><td>{row.state}</td><td>{row.created ? formatDisplayDate(row.created) : 'Not recorded'}</td></tr>{expanded && <tr className="portfolio-service-detail-row"><td colSpan={columnCount}><section id={`portfolio-services-${rowKey}`} aria-label={`${row.name} assigned services`}><header><div><small>ASSIGNED SERVICE DETAILS</small><h3>{row.name}</h3></div><span>{services.length} record{services.length === 1 ? '' : 's'}</span></header><div className="portfolio-service-table"><table><thead><tr>{['Lead ID', 'Applicant', 'Industry', 'Service Category', 'Services Offered', 'Unit', 'CPCB Status'].map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{services.map(service => <tr key={service.id}><td>{service.leadCode || service.code}</td><td>{service.category}</td><td>{service.industry || 'Not recorded'}</td><td>{service.eprCategory || 'Not recorded'}</td><td>{service.offered || 'Not recorded'}</td><td>{service.unit || 'Not recorded'}</td><td><span className={`portfolio-status portfolio-status-${service.bucket || ''}`}>{service.cpcb}</span></td></tr>)}</tbody></table></div></section></td></tr>}</React.Fragment>
    })}</tbody></table>{!records.length && <p className="portfolio-empty">No matching applications.</p>}</div>
    <footer><ShieldCheck size={16} />Saved client and CPCB statuses · Only accessible assigned records are shown</footer>
  </dialog>
}

function portfolioSnapshotKey() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}')
    return `application-portfolio:${user._id || user.id || user.crmUserId || user.email || 'anonymous'}`
  } catch { return 'application-portfolio:anonymous' }
}

const ApplicationPortfolio = forwardRef(function ApplicationPortfolio({ mode, pendingOnly = false, refreshToken = 0, onPdfAvailabilityChange }, ref) {
  const snapshotKey = useMemo(portfolioSnapshotKey, [])
  const initialPayload = useMemo(() => readPageSnapshot(snapshotKey), [snapshotKey])
  const hasPayload = useRef(Boolean(initialPayload))
  const fetching = useRef(false)
  const [payload, setPayload] = useState(initialPayload)
  const [loading, setLoading] = useState(() => !initialPayload)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [query, setQuery] = useState('')
  const [wasteCategory, setWasteCategory] = useState('plastic')
  const [selection, setSelection] = useState(null)
  const [section, setSection] = useState('annualRegistration')
  const [exportingExcel, setExportingExcel] = useState(false)
  const [exportError, setExportError] = useState('')
  const reducedMotion = useReducedMotion()
  const pendingStatusSummary = pendingOnly && mode === 'status'
  useEffect(() => {
    const controller = new AbortController()
    if (!hasPayload.current) setLoading(true)
    fetching.current = true
    setError('')
    api.get('/dashboard-insights/upload-tracker', { params: { assignmentsOnly: 'true', portfolioOnly: 'true' }, signal: controller.signal, timeout: 45000 }).then(response => { if (!controller.signal.aborted) { hasPayload.current = true; savePageSnapshot(snapshotKey, response.data, response); setPayload(response.data) } }).catch(err => { if (!controller.signal.aborted) setError(err.response?.data?.error || 'Unable to load application records. Please retry.') }).finally(() => { if (!controller.signal.aborted) { fetching.current = false; setLoading(false) } })
    return () => { controller.abort(); fetching.current = false }
  }, [refresh, refreshToken, snapshotKey])
  useEffect(() => { setSelection(null) }, [mode, section, wasteCategory])
  const groups = useMemo(() => buildApplicationPortfolio(payload?.assignments || [], payload?.users || []), [payload])
  const distribution = mode === 'spoc'
  const serviceSummary = mode === 'services'
  const categoryGroups = useMemo(() => Object.fromEntries(PORTFOLIO_WASTE_CATEGORIES.map(({ key }) => [key,
    applicationReportGroups(portfolioGroupsForWasteCategory(groups, key)).map(group => ({
      ...group,
      records: group.records.filter(record => matchesPortfolioSection(record, section)
        && (!pendingStatusSummary || [...PENDING_STATUS_KEYS].some(status => matchesStatusSummary(record, status))))
    }))
  ])), [groups, section, pendingStatusSummary])
  const scopedGroups = categoryGroups[wasteCategory]
  const wasteLabel = PORTFOLIO_WASTE_CATEGORIES.find(item => item.key === wasteCategory).label
  const searchedGroups = list => list.map(group => group.name.toLowerCase().includes(query.toLowerCase()) ? group : { ...group, records: group.records.filter(record => matchesPortfolioSearch(record, query)) }).filter(group => group.name.toLowerCase().includes(query.toLowerCase()) || group.records.length)
  const shown = searchedGroups(scopedGroups)
  const allRecords = shown.flatMap(group => group.records)
  const categories = PIBO_CATEGORIES
  const serviceColumns = useMemo(() => [...new Set(scopedGroups.flatMap(group => group.records.flatMap(record => (record.services || []).flatMap(service => service.offeredServices || []))).filter(service => service && service !== 'unclassified'))]
    .sort((left, right) => left === 'Annual Return Filling' ? -1 : right === 'Annual Return Filling' ? 1 : left.localeCompare(right)), [scopedGroups])
  const annualRegistrationSection = section === 'annualRegistration'
  const baseAnnualColumns = STATUS_COLUMNS.filter(([key]) => key === 'total' || key.startsWith('annual:') || key === 'otherServicesApproved')
  const pendingColumns = STATUS_COLUMNS.filter(([key]) => PENDING_STATUS_KEYS.has(key))
  const dynamicAnnualYears = [...new Set(scopedGroups.flatMap(group => applicationSummaryRecords(group).flatMap(row => row.annualYears)))]
    .filter(year => !['2025-26', '2026-27', '2027-28'].includes(year)).sort().map(year => [`annual:${year}`, year])
  const statusColumns = pendingStatusSummary
    ? pendingColumns
    : annualRegistrationSection
    ? [...baseAnnualColumns, ...dynamicAnnualYears, ...pendingColumns]
    : [['total', 'Total'], ['otherServicesApproved', 'Approved'], ...pendingColumns]
  const columns = distribution ? [['total', 'Total'], ...categories.map(category => [category, category])] : serviceSummary ? [['total', 'Total'], ...serviceColumns.flatMap(service => service === 'Annual Return Filling' ? [[service, 'Annual Return Filling (First PO Year)'], ['annualActionRequired', 'AR Action Required']] : [[service, service]]), ...(scopedGroups.some(group => group.records.some(row => matchesApplicationService(row, 'unclassified'))) ? [['unclassified', 'Not Closed / Service Not Recorded']] : [])] : statusColumns
  const matches = (row, key) => distribution ? matchesDistributionSummary(row, key) : serviceSummary ? matchesServiceSummary(row, key) : matchesStatusSummary(row, key)
  const wasteCounts = Object.fromEntries(PORTFOLIO_WASTE_CATEGORIES.map(({ key }) => [key,
    searchedGroups(categoryGroups[key])
      .reduce((sum, group) => sum + group.records.filter(record =>
        key === 'plastic' && section === 'annualRegistration' && !pendingStatusSummary
          ? matchesStatusSummary(record, `annual:${annualReturnYearForDate()}`)
          : matchesServiceSummary(record, 'Annual Return Filling') || matchesServiceSummary(record, 'annualActionRequired')
      ).length, 0)
  ]))
  const excelRecords = allRecords.filter(row => matches(row, 'total'))
  const open = (name, records, label = 'All categories', key = '') => setSelection({ name, records, label: `${wasteLabel} · ${label}`, key })
  const sectionLabel = `${annualRegistrationSection ? 'Annual Return & Registration' : 'Other Services'} · ${wasteLabel}`
  const title = pendingStatusSummary
    ? `Pending Applications - ${sectionLabel}`
    : `${distribution ? 'Application Distribution by SPOC & PIBo' : serviceSummary ? 'Application Service Summary' : 'Application Status Summary'} - ${sectionLabel}`
  const annualStatusColumns = columns.filter(([key]) => key.startsWith('annual:'))
  const registrationStatusColumns = columns.filter(([key]) => key === 'registrationApproved')
  const otherServicesStatusColumns = columns.filter(([key]) => key === 'otherServicesApproved')
  const pendingStatusColumns = columns.filter(([key]) => PENDING_STATUS_KEYS.has(key))
  const popupLabel = (key, label) => key === 'registrationApproved' ? 'Registration Approved' : key === 'otherServicesApproved' ? 'Other Services Approved' : label
  async function downloadExcel() {
    if (exportingExcel || !excelRecords.length) return
    setExportingExcel(true); setExportError('')
    try {
      const { downloadApplicationPortfolioExcel } = await import('../../utils/applicationPortfolioExport.mjs')
      await downloadApplicationPortfolioExcel(excelRecords, 'All SPOCs', title)
    } catch {
      setExportError('Excel download failed. Please retry.')
    } finally {
      setExportingExcel(false)
    }
  }
  useEffect(() => {
    onPdfAvailabilityChange?.(!loading && !error && shown.length > 0)
    return () => onPdfAvailabilityChange?.(false)
  }, [error, loading, onPdfAvailabilityChange, shown.length])
  useImperativeHandle(ref, () => ({
    isLoading: () => fetching.current,
    async downloadPdf() {
      if (loading || !payload) throw new Error('Dashboard data is still loading. Please retry in a moment.')
      const { downloadApplicationPortfolioPdf } = await import('../../utils/applicationPortfolioPdf.mjs')
      await downloadApplicationPortfolioPdf({ title, columns, groups: shown, matches, query })
    }
  }), [columns, loading, matches, payload, query, shown, title])
  return <motion.section role="tabpanel" id={`portfolio-${mode}`} aria-labelledby={`dashboard-tab-${mode}`} initial={reducedMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .2 }} className="application-portfolio">
    <h2 className="sr-only">{title}</h2>
    <div className="portfolio-scope-note"><ShieldCheck size={15} /><span>{payload?.visibility === 'all' ? 'Showing applications for all users' : payload?.visibility === 'team' ? 'Showing applications assigned to you and your team' : 'Showing only applications assigned to you'}</span></div>
    <div className="portfolio-section-tabs" role="tablist" aria-label={`${title} section`}>
      {[['annualRegistration', 'Summary for Annual Return & Registration'], ['otherServices', 'Summary for Other Services']].map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={section === key} onClick={() => setSection(key)}>{label}</button>)}
    </div>
    <div className="portfolio-toolbar"><div className="portfolio-search-filters"><label className="portfolio-search"><Search size={17} /><input aria-label="Search SPOC or client" placeholder="Search SPOC or client" value={query} onChange={event => setQuery(event.target.value)} /></label><div className="portfolio-waste-tabs" role="tablist" aria-label="Application service category">{PORTFOLIO_WASTE_CATEGORIES.map(({ key, label, abbreviation }) => <button key={key} type="button" role="tab" id={`portfolio-${mode}-${key}-tab`} tabIndex={wasteCategory === key ? 0 : -1} aria-selected={wasteCategory === key} onKeyDown={event => { const keys = PORTFOLIO_WASTE_CATEGORIES.map(item => item.key); let index = keys.indexOf(key); if (event.key === 'ArrowRight') index = (index + 1) % keys.length; else if (event.key === 'ArrowLeft') index = (index + keys.length - 1) % keys.length; else if (event.key === 'Home') index = 0; else if (event.key === 'End') index = keys.length - 1; else return; event.preventDefault(); setWasteCategory(keys[index]); event.currentTarget.parentElement.children[index].focus(); }} aria-controls={`portfolio-${mode}-matrix`} aria-label={`${label}: ${wasteCounts[key]} applicable Annual Returns`} onClick={() => setWasteCategory(key)}><span className="portfolio-waste-icon" aria-hidden="true">{abbreviation}</span><span>{label}</span><strong>{loading && !payload ? '…' : wasteCounts[key].toLocaleString('en-IN')}</strong></button>)}</div></div><span>Click a SPOC or count to explore clients <ArrowUpRight size={14} /><button type="button" onClick={downloadExcel} disabled={exportingExcel || loading || !excelRecords.length} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-700 px-4 text-xs font-black text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Download application summary Excel">{exportingExcel ? <Loader2 size={17} className="animate-spin" /> : <FileSpreadsheet size={17} />}{exportingExcel ? 'Preparing Excel...' : 'Download Excel'}</button><button type="button" className="portfolio-icon-button" aria-label="Refresh applications" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button></span></div>
    {exportError && <div role="alert" className="portfolio-error">{exportError}</div>}
    {error && <div role="alert" className="portfolio-error">{error}<button type="button" onClick={() => setRefresh(value => value + 1)}>Retry</button></div>}
    {loading && !payload ? <div className="portfolio-empty" role="status"><Loader2 className="animate-spin" />Loading assigned applications…</div> : <div id={`portfolio-${mode}-matrix`} role="tabpanel" aria-labelledby={`portfolio-${mode}-${wasteCategory}-tab`} className={`portfolio-matrix${pendingStatusSummary ? ' portfolio-matrix-pending' : ''}`}><table><thead>{distribution || serviceSummary || pendingStatusSummary ? <tr><th>AnantTattva SPOC</th>{columns.map(([key, label]) => <th key={key} className={key === 'total' ? 'portfolio-live-column' : key === 'annualActionRequired' ? 'portfolio-action-column' : undefined}>{label}</th>)}</tr> : <><tr><th rowSpan={2}>AnantTattva SPOC</th><th rowSpan={2} className="portfolio-live-column">Total</th>{annualStatusColumns.length > 0 && <th colSpan={annualStatusColumns.length}>Annual Return Applicable</th>}{registrationStatusColumns.length > 0 && <th colSpan={registrationStatusColumns.length}>Registration</th>}{otherServicesStatusColumns.length > 0 && <th colSpan={otherServicesStatusColumns.length}>Approved</th>}{pendingStatusColumns.length > 0 && <th colSpan={pendingStatusColumns.length}>Pending</th>}</tr><tr>{annualStatusColumns.map(([key, label]) => <th key={key}>{label}</th>)}{registrationStatusColumns.map(([key, label]) => <th key={key}>{label}</th>)}{otherServicesStatusColumns.map(([key, label]) => <th key={key}>{label}</th>)}{pendingStatusColumns.map(([key, label]) => <th key={key} className={key === 'annualActionRequired' ? 'portfolio-action-column' : undefined}>{label}</th>)}</tr></>}</thead><tbody>{shown.map((group, index) => <tr key={group.id}><td><button type="button" className="portfolio-person" onClick={() => open(group.name, group.records)}><span className={`portfolio-avatar portfolio-avatar-${index % 4}`}>{group.name.split(' ').map(part => part[0]).slice(0, 2).join('')}</span><strong>{group.name}</strong><ArrowUpRight size={14} /></button></td>{columns.map(([key, label]) => { const records = group.records.filter(row => matches(row, key)); return <td key={key} className={key === 'total' ? 'portfolio-live-column' : key === 'annualActionRequired' ? 'portfolio-action-column' : undefined}><button type="button" className={`portfolio-count ${records.length ? 'has-records' : ''}`} aria-label={`${group.name}: ${records.length} ${popupLabel(key, label)}`} onClick={() => open(group.name, records, popupLabel(key, label), key)}>{records.length}</button></td> })}</tr>)}</tbody><tfoot><tr><th>Grand Total</th>{columns.map(([key, label]) => <td key={key} className={key === 'total' ? 'portfolio-live-column' : key === 'annualActionRequired' ? 'portfolio-action-column' : undefined}><button type="button" onClick={() => open('All SPOCs', allRecords.filter(row => matches(row, key)), popupLabel(key, label), key)}>{allRecords.filter(row => matches(row, key)).length}</button></td>)}</tr></tfoot></table>{!shown.length && <p className="portfolio-empty">No assigned applications match this search.</p>}</div>}
    <footer>{annualRegistrationSection ? 'This view includes only Annual Return and Registration applications.' : 'This view includes only services other than Annual Return and Registration.'} {distribution ? 'Approved Registration and New Registration are excluded from this SPOC & PIBo summary and remain available in PO reporting.' : serviceSummary ? 'Approved Registration and New Registration are excluded from this service summary and remain available in PO reporting. Annual Return Filing uses the first Annual Return year recorded on the received PO.' : 'Approved Registration and New Registration are excluded from this status summary and remain available in PO reporting. Registration records in Applied, Under Review, Not Started or Rejected remain visible.'}</footer>
    {selection && <ClientRecordsPopup selection={selection} onClose={() => setSelection(null)} />}
  </motion.section>
})

export default ApplicationPortfolio
