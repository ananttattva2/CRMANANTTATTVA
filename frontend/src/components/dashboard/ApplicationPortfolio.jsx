import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUpRight, Building2, CheckCircle2, Layers3, Loader2, RefreshCw, Search, ShieldCheck, Users, X } from 'lucide-react'
import api from '../../services/api'
import { formatDisplayDate } from '../../utils/dateFormat'
import { buildApplicationPortfolio, PIBO_CATEGORIES, STATUS_COLUMNS } from '../../utils/applicationPortfolio.mjs'
import './applicationPortfolio.css'

function ClientRecordsPopup({ selection, onClose }) {
  const dialog = useRef(null)
  const [query, setQuery] = useState('')
  useEffect(() => { dialog.current?.showModal() }, [])
  const records = selection.records.filter(row => `${row.name} ${row.code} ${row.category} ${row.cpcb} ${row.state}`.toLowerCase().includes(query.toLowerCase()))
  return <dialog ref={dialog} className="portfolio-dialog" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose() }} aria-labelledby="portfolio-dialog-title">
    <header><div className="portfolio-heading"><span className="portfolio-icon"><Users size={23} /></span><div><small>ASSIGNED APPLICATIONS</small><h2 id="portfolio-dialog-title">{selection.name}</h2><p>{selection.label} · {selection.records.length} applications</p></div></div><button type="button" className="portfolio-icon-button" onClick={onClose} aria-label="Close client details"><X size={20} /></button></header>
    <div className="portfolio-toolbar"><label className="portfolio-search"><Search size={17} /><input aria-label="Search client details" placeholder="Search client, category or CPCB status" value={query} onChange={event => setQuery(event.target.value)} /></label><span>{records.length} records shown</span></div>
    <div className="portfolio-dialog-table"><table><thead><tr>{['Unique ID', 'Legal Name', 'Client Status', 'Visibility', 'CPCB Status', 'PIBo Category', 'State', 'Created'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{records.map(row => <tr key={row.id}><td>{row.code}</td><td><strong>{row.name}</strong>{row.services && <details><summary>View service statuses</summary>{row.services.map((service, index) => <p key={`${service.id}-${index}`}>{service.category}: {service.cpcb}</p>)}</details>}</td><td>{row.clientStatus}</td><td>{row.visibility}</td><td><span className={`portfolio-status portfolio-status-${row.bucket}`}>{row.cpcb}</span></td><td>{row.category}</td><td>{row.state}</td><td>{row.created ? formatDisplayDate(row.created) : 'Not recorded'}</td></tr>)}</tbody></table>{!records.length && <p className="portfolio-empty">No matching applications.</p>}</div>
    <footer><ShieldCheck size={16} />Saved client and CPCB statuses · Only accessible assigned records are shown</footer>
  </dialog>
}

export default function ApplicationPortfolio({ mode }) {
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
    api.get('/dashboard-insights/upload-tracker', { params: { assignmentsOnly: 'true' }, signal: controller.signal, timeout: 45000 }).then(response => { if (!controller.signal.aborted) setPayload(response.data) }).catch(err => { if (!controller.signal.aborted) setError(err.response?.data?.error || 'Unable to load application records. Please retry.') }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [refresh])
  useEffect(() => { setSelection(null) }, [mode])
  const groups = useMemo(() => buildApplicationPortfolio(payload?.assignments || [], payload?.users || []), [payload])
  const distribution = mode === 'spoc'
  const reportGroups = useMemo(() => distribution ? groups : groups.map(group => ({ ...group, records: group.companyRecords })), [groups, distribution])
  const shown = reportGroups.filter(group => `${group.name} ${group.records.map(row => row.name).join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  const allRecords = shown.flatMap(group => group.records)
  const categories = useMemo(() => [...PIBO_CATEGORIES, ...new Set(groups.flatMap(group => group.records.map(row => row.category)).filter(category => !PIBO_CATEGORIES.includes(category)))], [groups])
  const columns = distribution ? categories.map(category => [category, category]) : STATUS_COLUMNS
  const matches = (row, key) => distribution ? row.category === key : key === 'live' ? row.live : key === 'annual' ? row.annual : row.bucket === key
  const open = (name, records, label = 'All categories') => setSelection({ name, records, label })
  const title = distribution ? 'Application Distribution by SPOC & PIBo' : 'Application Status Summary'
  return <motion.section role="tabpanel" id={`portfolio-${mode}`} aria-labelledby={`dashboard-tab-${mode}`} initial={reducedMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .2 }} className="application-portfolio">
    <header><div className="portfolio-heading"><span className="portfolio-icon">{distribution ? <Layers3 size={25} /> : <ShieldCheck size={25} />}</span><div><small>APPLICATION INTELLIGENCE</small><h2>{title}</h2><p>Explore assigned applicants, ownership and saved CPCB statuses.</p></div></div><button type="button" className="portfolio-icon-button" aria-label="Refresh applications" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button></header>
    <div className="portfolio-metrics"><div><Users size={19} /><span>SPOCs<strong>{shown.length}</strong></span></div><div><Building2 size={19} /><span>{distribution ? 'Assigned applications' : 'Allocated clients'}<strong>{allRecords.length}</strong></span></div><div><CheckCircle2 size={19} /><span>CPCB approved<strong>{allRecords.filter(row => row.bucket === 'approved').length}</strong></span></div></div>
    <div className="portfolio-toolbar"><label className="portfolio-search"><Search size={17} /><input aria-label="Search SPOC or client" placeholder="Search SPOC or client" value={query} onChange={event => setQuery(event.target.value)} /></label><span>Click a SPOC or count to explore clients <ArrowUpRight size={14} /></span></div>
    {error && <div role="alert" className="portfolio-error">{error}<button type="button" onClick={() => setRefresh(value => value + 1)}>Retry</button></div>}
    {loading && !payload ? <div className="portfolio-empty" role="status"><Loader2 className="animate-spin" />Loading assigned applications…</div> : <div className="portfolio-matrix"><table><thead><tr><th>AnantTattva SPOC</th>{columns.map(([key, label]) => <th key={key}>{label}</th>)}<th>Total</th></tr></thead><tbody>{shown.map((group, index) => <tr key={group.id}><td><button type="button" className="portfolio-person" onClick={() => open(group.name, group.records)}><span className={`portfolio-avatar portfolio-avatar-${index % 4}`}>{group.name.split(' ').map(part => part[0]).slice(0, 2).join('')}</span><strong>{group.name}</strong><ArrowUpRight size={14} /></button></td>{columns.map(([key, label]) => { const records = group.records.filter(row => matches(row, key)); return <td key={key}><button type="button" className={`portfolio-count ${records.length ? 'has-records' : ''}`} aria-label={`${group.name}: ${records.length} ${label}`} onClick={() => open(group.name, records, label)}>{records.length}</button></td> })}<td><button type="button" className="portfolio-total" onClick={() => open(group.name, group.records)}>{group.records.length}</button></td></tr>)}</tbody><tfoot><tr><th>Grand Total</th>{columns.map(([key, label]) => <td key={key}><button type="button" onClick={() => open('All SPOCs', allRecords.filter(row => matches(row, key)), label)}>{allRecords.filter(row => matches(row, key)).length}</button></td>)}<td><button type="button" onClick={() => open('All SPOCs', allRecords)}>{allRecords.length}</button></td></tr></tfoot></table>{!shown.length && <p className="portfolio-empty">No assigned applications match this search.</p>}</div>}
    <footer>{distribution ? 'Each company + PIBo category counts once per assigned SPOC.' : 'Each company counts once per assigned SPOC, matching Purchase & Sales. CPCB summary follows the outstanding service: Rejected, Under Review, Applied, Not Started, then Approved. Missing status counts as Not Started; popup retains every saved service status.'}</footer>
    {selection && <ClientRecordsPopup selection={selection} onClose={() => setSelection(null)} />}
  </motion.section>
}
