import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Building2, Camera, CheckCircle2, ChevronRight, ExternalLink, Eye, EyeOff, FileCheck2, FileText, Image as ImageIcon, KeyRound, Loader2, MapPin, RotateCcw, Save, Scale, Settings, ShieldCheck, UserRound, XCircle } from 'lucide-react'
import DashboardShell from '../components/dashboard/DashboardShell'
import { getMsmeRows } from '../features/clientMaster/clientMaster.utils'
import api from '../services/api'
import { API_ENDPOINTS } from '../services/apiEndpoints'
import { formatDisplayDate } from '../utils/dateFormat'
import { ArComplianceWorkspace } from './ArCompliance'
import './arCompliance.css'
import { hasAnyRole } from '../constants/dashboard'

const sectionSources = {
  companyOverview: ['companyOverview'], basic: ['basic'], addressDetails: ['registeredAddress', 'communicationAddress'],
  documents: ['compliance'], cteCtoCca: ['cte', 'cteCtoCca'],
  cpcbCredentials: ['cpcb'], cpcbScreenshots: ['cpcbScreenshots'], processFlowDiagrams: ['processDiagrams', 'processFlowFiles'],
  authorizedPersons: ['otp', 'otpContacts', 'authorised', 'authorisedPersons', 'coordinating', 'coordinatingPersons']
}

const sectionIcons = {
  companyOverview: Building2,
  basic: UserRound,
  addressDetails: MapPin,
  documents: FileText,
  cteCtoCca: Scale,
  cpcbCredentials: KeyRound,
  cpcbScreenshots: Camera,
  processFlowDiagrams: Settings,
  authorizedPersons: UserRound
}

const removedReviewFields = new Set(['productManufacturer', 'numberOfEmployees'])

function titleize(value) { return String(value || '').replace(/([A-Z])/g, ' $1').replace(/[_-]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase()) }
function present(value) { return value !== undefined && value !== null && String(value).trim() !== '' }
function populated(value) {
  if (Array.isArray(value)) return value.some(populated)
  if (value && typeof value === 'object') return Object.entries(value).some(([key, nested]) => !/^_/.test(key) && populated(nested))
  return present(value)
}
function displayValue(key, value) {
  if (/password|secret|token/i.test(key) && present(value)) return '••••••••'
  if (/date/i.test(key) && present(value)) return formatDisplayDate(value)
  if (Array.isArray(value)) return value.length ? value.map((item) => typeof item === 'object' ? (item.name || item.personName || item.productName || item.fileName || '') : String(item)).filter(Boolean).join(' · ') || `${value.length} records` : 'Data not filled'
  if (value && typeof value === 'object') return value.name || value.fileName || value.url || `${Object.keys(value).length} values`
  return present(value) ? String(value) : 'Data not filled'
}
function fileUrl(value) {
  if (typeof value === 'string' && /^(https?:|data:|blob:)/i.test(value)) return value
  if (!value || typeof value !== 'object') return ''
  return value.secureUrl || value.url || value.fileUrl || value.dataUrl || value.path || fileUrl(value.file) || fileUrl(value.document) || ''
}
function fileName(value, fallback = 'Uploaded file') {
  if (!value || typeof value !== 'object') return fallback
  return value.name || value.fileName || value.originalName || value.file?.name || fallback
}
function isImageFile(url, name = '', type = '') { return /^data:image\//i.test(url) || /^image\//i.test(type) || /\.(png|jpe?g|gif|webp|svg|bmp)(\?|$)/i.test(`${name} ${url}`) }
function attachmentsFrom(value, label, seen = new Set()) {
  if (!value) return []
  if (Array.isArray(value)) return value.flatMap((item, index) => attachmentsFrom(item, `${label} ${index + 1}`, seen))
  const url = fileUrl(value)
  const rows = []
  if (url && !seen.has(url)) {
    seen.add(url)
    const name = fileName(value, label)
    rows.push({ url, name, label, image: isImageFile(url, name, value?.type || value?.mimeType) })
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, nested]) => {
      if (!['url', 'secureUrl', 'fileUrl', 'dataUrl', 'path'].includes(key) && nested && typeof nested === 'object') rows.push(...attachmentsFrom(nested, `${label} · ${titleize(key)}`, seen))
    })
  }
  return rows
}
function reviewField(id, label, value) {
  return { id, label, value: displayValue(id, value), rawValue: value, sensitive: /password/i.test(id), filled: populated(value) }
}
function cpcbFieldsFor(data = {}) {
  const cpcb = data.cpcb || {}
  return [
    ['linkedToCommonPortal', 'Linked To Common Portal'],
    ['status', 'CPCB Status'],
    ['unitId', 'Unit ID'],
    ['registrationNumber', 'CPCB Registration Number'],
    ['applicationNumber', 'Application Number'],
    ['applicationDate', 'Date Of Application'],
    ['approvalDate', 'Date Of Application Approval'],
    ['ceprUserId', 'CEPR User ID'],
    ['ceprPassword', 'CEPR Password'],
    ['loginId', 'CPCB Login ID'],
    ['loginPassword', 'CPCB Login Password'],
    ['homePageFile', 'CPCB Home Page File'],
    ['processDiagramRequired', 'Process Diagram Required'],
    ['remark', 'Remark']
  ].map(([key, label]) => reviewField(`cpcb.${key}`, label, cpcb[key]))
}
function cteFieldsFor(data = {}) {
  const cte = data.cte || data.cteCtoCca || {}
  const inferredApplicability = cte.cteApplicable || (populated(cte.numberOfPlantsLocations) || populated(cte.plantWiseDetails) ? 'Yes' : '')
  const fields = [
    reviewField('cte.cteApplicable', 'CTE Applicable', inferredApplicability),
    reviewField('cte.numberOfPlantsLocations', 'Number Of Plant Locations', cte.numberOfPlantsLocations)
  ]
  const plantFields = [
    ['plantName', 'Plant Name'], ['cteConsentNo', 'CTE Consent No.'], ['cteCategory', 'CTE Category'],
    ['cteIssuedDate', 'CTE Issued Date'], ['cteValidDate', 'CTE Valid Upto'], ['plantLocation', 'Plant Location'],
    ['cteDocument', 'CTE Document'], ['ctoOrderNo', 'CTO/CCA Consent Order No.'],
    ['ctoIssueDate', 'CTO/CCA Date Of Issue'], ['ctoValidDate', 'CTO/CCA Valid Upto'], ['ctoDocument', 'CTO/CCA Document']
  ]
  const plants = Array.isArray(cte.plantWiseDetails) ? cte.plantWiseDetails : []
  plants.forEach((plant, plantIndex) => {
    plantFields.forEach(([key, label]) => fields.push(reviewField(`cte.plantWiseDetails.${plantIndex}.${key}`, `Plant ${plantIndex + 1} · ${label}`, plant?.[key])))
    ;(plant?.cteProductionRows || []).forEach((row, rowIndex) => {
      fields.push(reviewField(`cte.plantWiseDetails.${plantIndex}.cteProductionRows.${rowIndex}.productName`, `Plant ${plantIndex + 1} · CTE Product ${rowIndex + 1}`, row?.productName))
      fields.push(reviewField(`cte.plantWiseDetails.${plantIndex}.cteProductionRows.${rowIndex}.capacity`, `Plant ${plantIndex + 1} · CTE Capacity ${rowIndex + 1}`, row?.capacity))
    })
    ;(plant?.ctoProductRows || []).forEach((row, rowIndex) => {
      fields.push(reviewField(`cte.plantWiseDetails.${plantIndex}.ctoProductRows.${rowIndex}.productName`, `Plant ${plantIndex + 1} · CTO/CCA Product ${rowIndex + 1}`, row?.productName))
      fields.push(reviewField(`cte.plantWiseDetails.${plantIndex}.ctoProductRows.${rowIndex}.quantity`, `Plant ${plantIndex + 1} · CTO/CCA Quantity ${rowIndex + 1}`, row?.quantity))
    })
  })
  return fields.filter(Boolean)
}
function documentFieldsFor(data = {}) {
  const compliance = data.compliance || {}
  const groups = [
    ['gst', 'GST Number', 'GST Certificate Date'],
    ['cin', 'CIN', 'CIN Document Date'],
    ['pan', 'PAN', 'PAN Document Date'],
    ['factoryLicense', 'Factory License No.', 'Factory License Document Date'],
    ['eprCertificate', 'EPR Certificate No.', 'EPR Certificate File Date'],
    ['iec', 'IEC Certificate', 'IEC Certificate Date'],
    ['dicDcssi', 'DIC/DCSSI Certificate No.', 'DIC/DCSSI Certificate Date']
  ]
  const fields = []
  groups.forEach(([key, numberLabel, dateLabel]) => {
    const numberValue = compliance[`${key}Number`] || compliance[key]
    const dateValue = compliance[`${key}Date`]
    fields.push(reviewField(`compliance.${key}Number`, numberLabel, numberValue))
    fields.push(reviewField(`compliance.${key}Date`, dateLabel, dateValue))
  })
  fields.push(reviewField('compliance.brandOwnerProductionFacility', 'Brand Owner Production Facility', compliance.brandOwnerProductionFacility))
  fields.push(reviewField('compliance.msmeApplicable', 'MSME Applicable', compliance.msmeApplicable))
  return fields.filter(Boolean)
}
function fieldsFor(data, sectionKey) {
  if (sectionKey === 'documents') return documentFieldsFor(data)
  if (sectionKey === 'cteCtoCca') return cteFieldsFor(data)
  if (sectionKey === 'cpcbCredentials') return cpcbFieldsFor(data)
  return (sectionSources[sectionKey] || []).flatMap((sourceKey) => {
    const source = data?.[sourceKey]
    if (!source || typeof source !== 'object') return []
    return Object.entries(source)
      .filter(([key, value]) => !/^_/.test(key) && !removedReviewFields.has(key) && populated(value))
      .map(([key, value]) => ({ id: `${sourceKey}.${key}`, label: `${titleize(sourceKey)} · ${titleize(key)}`, value: displayValue(key, value), filled: true }))
  })
}

function AttachmentGallery({ attachments }) {
  const [preview, setPreview] = useState(null)
  if (!attachments.length) return null
  return <aside className="rounded-2xl border border-cyan-100 bg-cyan-50/40 p-3"><div className="mb-3 flex items-center gap-2"><FileText className="h-4 w-4 text-cyan-700" /><div><h3 className="text-sm font-black text-slate-950">Documents</h3><p className="text-[10px] font-semibold text-slate-500">Preview inside this page</p></div></div><div className="space-y-2">{attachments.map((file, index) => <button type="button" key={`${file.url}-${index}`} onClick={() => setPreview(file)} className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 text-left shadow-sm hover:border-cyan-300 hover:bg-cyan-50"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-cyan-50 text-cyan-700">{file.image ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}</span><span className="min-w-0 flex-1"><strong className="block truncate text-xs text-slate-900">{file.name}</strong><small className="block truncate text-[10px] font-semibold text-slate-500">{file.label}</small></span><span className="rounded-lg bg-[#075848] px-2 py-1 text-[10px] font-black text-white">View</span></button>)}</div>{preview && <div className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/70 p-2 backdrop-blur-sm sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null) }}><section className="flex h-[94vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><header className="flex items-center justify-between gap-3 border-b px-5 py-3"><div className="min-w-0"><h3 className="truncate font-black text-slate-950">{preview.name}</h3><p className="truncate text-xs font-semibold text-slate-500">{preview.label}</p></div><div className="flex shrink-0 items-center gap-2"><a href={preview.url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#075848] px-3 text-xs font-black text-white"><ExternalLink className="h-4 w-4" />{preview.image ? 'View Full Image' : 'View Full Document'}</a><button type="button" onClick={() => setPreview(null)} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-600"><XCircle className="h-5 w-5" /></button></div></header><div className="min-h-0 flex-1 bg-slate-100 p-2">{preview.image ? <img src={preview.url} alt={preview.name} className="h-full w-full object-contain" /> : <iframe src={preview.url} title={preview.name} className="h-full w-full rounded-xl border-0 bg-white" />}</div></section></div>}</aside>
}

function ReviewFieldCard({ field, index }) {
  const [passwordVisible, setPasswordVisible] = useState(false)
  const visibleValue = field.sensitive && passwordVisible ? String(field.rawValue || '') : field.value
  return <article className={`flex gap-3 rounded-2xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${field.filled ? 'border-slate-200 bg-white' : 'border-orange-300 bg-orange-50/70'}`}><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${field.filled ? index % 4 === 0 ? 'bg-emerald-50 text-emerald-700' : index % 4 === 1 ? 'bg-blue-50 text-blue-700' : index % 4 === 2 ? 'bg-violet-50 text-violet-700' : 'bg-orange-50 text-orange-700' : 'bg-orange-100 text-orange-700'}`}>{field.filled ? <FileText className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}</span><span className="min-w-0 flex-1"><span className="block text-[10px] font-black uppercase tracking-wider text-slate-500">{field.label}</span><span className="mt-2 flex min-w-0 items-center gap-2"><span className={`min-w-0 flex-1 break-all text-sm font-bold ${field.filled ? 'text-slate-900' : 'text-orange-700'}`}>{visibleValue}</span>{field.sensitive && field.filled && <button type="button" onClick={() => setPasswordVisible((visible) => !visible)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700" aria-label={`${passwordVisible ? 'Hide' : 'Show'} ${field.label}`} title={`${passwordVisible ? 'Hide' : 'Show'} ${field.label}`}>{passwordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>}</span></span></article>
}
function CteReviewTables({ data = {} }) {
  const cte = data.cte || data.cteCtoCca || {}
  const plants = Array.isArray(cte.plantWiseDetails) ? cte.plantWiseDetails : []
  if (!plants.length) return null
  const Cell = ({ children }) => <td className="border-b border-slate-100 px-3 py-3 text-xs font-bold text-slate-800">{formatDisplayDate(children, children || '-')}</td>
  return <div className="space-y-5">{plants.map((plant, plantIndex) => <section key={`plant-${plantIndex}`} className="overflow-hidden rounded-2xl border border-slate-200"><header className="bg-emerald-50 px-4 py-3"><p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Plant {plantIndex + 1}</p><h3 className="font-black text-slate-950">{plant.plantName || `Plant ${plantIndex + 1}`} · CTE & CTO/CCA Details</h3></header><div className="overflow-x-auto"><table className="min-w-[900px] w-full"><thead className="bg-[#eaf8f5] text-left text-[10px] uppercase tracking-wide text-slate-600"><tr><th className="px-3 py-3">Consent Type</th><th className="px-3 py-3">Consent / Order No.</th><th className="px-3 py-3">Category / Location</th><th className="px-3 py-3">Issue Date</th><th className="px-3 py-3">Valid Upto</th></tr></thead><tbody><tr><Cell>CTE</Cell><Cell>{plant.cteConsentNo}</Cell><Cell>{[plant.cteCategory, plant.plantLocation].filter(Boolean).join(' · ')}</Cell><Cell>{plant.cteIssuedDate}</Cell><Cell>{plant.cteValidDate}</Cell></tr><tr><Cell>CTO/CCA</Cell><Cell>{plant.ctoOrderNo}</Cell><Cell>{plant.plantLocation}</Cell><Cell>{plant.ctoIssueDate}</Cell><Cell>{plant.ctoValidDate}</Cell></tr></tbody></table></div>{[['CTE Production Quantity', plant.cteProductionRows, 'capacity'], ['CTO/CCA Product Quantity', plant.ctoProductRows, 'quantity']].map(([title, rows, quantityKey]) => Array.isArray(rows) && rows.length ? <div key={title} className="border-t border-slate-200"><h4 className="px-4 py-3 text-sm font-black text-slate-900">{title}</h4><div className="overflow-x-auto"><table className="w-full min-w-[620px]"><thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-600"><tr><th className="w-16 px-3 py-3">Sr.No</th><th className="px-3 py-3">Name Of Product</th><th className="px-3 py-3">Plant Name</th><th className="px-3 py-3">{quantityKey === 'capacity' ? 'Capacity' : 'Quantity'}</th></tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={`${title}-${rowIndex}`}><Cell>{rowIndex + 1}</Cell><Cell>{row.productName}</Cell><Cell>{plant.plantName}</Cell><Cell>{row[quantityKey]}</Cell></tr>)}</tbody></table></div></div> : null)}</section>)}</div>
}
function MsmeReviewTable({ data = {} }) {
  const rows = getMsmeRows(data)
  if (String(data?.compliance?.msmeApplicable || '').toLowerCase() !== 'yes' || !rows.length) return null
  const value = (entry) => populated(entry) ? entry : '-'
  return <section className="mb-4 overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm"><header className="flex items-center justify-between gap-3 bg-emerald-50 px-4 py-3"><div><p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">MSME Details</p><h3 className="font-black text-slate-950">Registered MSME / Udyam Records</h3></div><span className="rounded-full bg-emerald-700 px-3 py-1 text-[10px] font-black text-white">Applicable</span></header><div className="overflow-x-auto"><table className="w-full min-w-[980px]"><thead className="bg-[#eaf8f5] text-left text-[10px] uppercase tracking-wide text-slate-600"><tr>{['Sr.No', 'Classification Year', 'MSME Status', 'Major Activity', 'Udyam Number', 'Turnover (CR.)', 'Certificate'].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr></thead><tbody>{rows.map((row, index) => {
    const certificateUrl = fileUrl(row.file)
    const certificateName = fileName(row.file, 'Uploaded certificate')
    return <tr key={`msme-${index}`} className="border-t border-slate-100"><td className="px-3 py-3 text-xs font-black text-slate-800">{index + 1}</td><td className="px-3 py-3 text-xs font-bold text-slate-800">{value(row.classificationYear)}</td><td className="px-3 py-3"><span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">{value(row.status)}</span></td><td className="px-3 py-3 text-xs font-bold text-slate-800">{value(row.majorActivity)}</td><td className="px-3 py-3 text-xs font-black text-slate-950">{value(row.udyamNumber || row.value)}</td><td className="px-3 py-3 text-xs font-bold text-slate-800">{value(row.turnover)}</td><td className="px-3 py-3"><div className="flex min-w-[170px] items-center gap-2"><span className={`min-w-0 flex-1 truncate text-xs font-bold ${certificateUrl ? 'text-slate-700' : 'text-slate-400'}`} title={certificateName}>{certificateUrl ? certificateName : 'Not uploaded'}</span>{certificateUrl && <a href={certificateUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[10px] font-black text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100" aria-label={`View ${certificateName}`} title={`View ${certificateName}`}><Eye className="h-3.5 w-3.5" />View</a>}</div></td></tr>
  })}</tbody></table></div></section>
}
function PeopleReviewTable({ data = {} }) {
  const rows = [
    ...(populated(data.otp) ? [{ type: 'OTP Contact', ...data.otp }] : []),
    ...(data.otpContacts || []).map((row) => ({ type: 'Additional OTP Contact', ...row })),
    ...(populated(data.authorised) ? [{ type: 'Authorised Person', ...data.authorised }] : []),
    ...(data.authorisedPersons || []).map((row) => ({ type: 'Additional Authorised Person', ...row })),
    ...(populated(data.coordinating) ? [{ type: 'Coordinating Person', ...data.coordinating }] : []),
    ...(data.coordinatingPersons || []).map((row) => ({ type: 'Additional Coordinating Person', ...row }))
  ]
  if (!rows.length) return null
  const value = (row, ...keys) => keys.map((key) => row?.[key]).find(populated) || '-'
  return <div className="overflow-hidden rounded-2xl border border-slate-200"><div className="overflow-x-auto"><table className="w-full min-w-[1050px]"><thead className="bg-[#eaf8f5] text-left text-[10px] uppercase tracking-wide text-slate-600"><tr>{['Sr.No', 'Contact Type', 'Name', 'Designation', 'Department', 'Reporting', 'Mobile', 'Email', 'PAN'].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.type}-${index}`} className="border-t border-slate-100"><td className="px-3 py-3 text-xs font-black">{index + 1}</td><td className="px-3 py-3"><span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">{row.type}</span></td><td className="px-3 py-3 text-xs font-bold">{value(row, 'name', 'personName')}</td><td className="px-3 py-3 text-xs font-bold">{value(row, 'designation')}</td><td className="px-3 py-3 text-xs font-bold">{value(row, 'department')}</td><td className="px-3 py-3 text-xs font-bold">{value(row, 'reporting')}</td><td className="px-3 py-3 text-xs font-bold">{value(row, 'mobile')}</td><td className="px-3 py-3 text-xs font-bold">{value(row, 'email')}</td><td className="px-3 py-3 text-xs font-bold">{value(row, 'pan')}</td></tr>)}</tbody></table></div></div>
}
function statusStyle(status) {
  return { VERIFIED: 'bg-emerald-100 text-emerald-800', CHANGES_REQUIRED: 'bg-rose-100 text-rose-700', NOT_APPLICABLE: 'bg-slate-200 text-slate-700', NOT_REVIEWED: 'bg-amber-100 text-amber-800' }[status] || 'bg-cyan-100 text-cyan-800'
}

function complianceHeaderMetadata(client = {}) {
  const data = client.data || {}
  const snapshot = data.selectedLeadSnapshot || {}
  const lead = client.selectedLead || {}
  const services = Array.isArray(lead.serviceSelections) ? lead.serviceSelections : []
  const unique = (values) => [...new Set(values.flatMap((value) => Array.isArray(value) ? value : [value]).map((value) => String(value || '').trim()).filter(Boolean))]
  return {
    applicantTypes: unique([snapshot.applicantType, snapshot.piboParent, snapshot.piboCategoryParent, lead.applicantType, lead.piboParent, lead.piboCategoryParent, ...services.flatMap((service) => [service.applicantType, service.piboParent, service.piboCategoryParent])]),
    subApplicantTypes: unique([data.basic?.piboCategory, snapshot.subApplicantType, snapshot.piboCategory, lead.subApplicantType, lead.piboCategory, ...services.flatMap((service) => [service.subApplicantType, service.piboCategory])]),
    applicationTypes: unique([data.cpcb?.applicationType, data.annualReturn?.applicationRenewal, data.basic?.applicationType, snapshot.applicationType, ...services.map((service) => service.applicationType)])
  }
}

export default function ClientComplianceReview({ defaultAr = false }) {
  const [workspaceTab, setWorkspaceTab] = useState(defaultAr ? 'ar' : 'company')
  const { clientId } = useParams(); const navigate = useNavigate()
  const [currentUser] = useState(() => JSON.parse(localStorage.getItem('user') || 'null'))
  const [payload, setPayload] = useState(null); const [activeKey, setActiveKey] = useState('companyOverview')
  const [draft, setDraft] = useState({ status: 'VERIFIED', remarks: '' }); const [finalRemarks, setFinalRemarks] = useState('')
  const [approvalPrompt, setApprovalPrompt] = useState(false)
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const load = async () => { setLoading(true); setError(''); try { const response = await api.get(API_ENDPOINTS.clients.complianceReview(clientId)); setPayload(response.data || response) } catch (err) { setError(err?.response?.data?.error || 'Unable to load compliance verification.') } finally { setLoading(false) } }
  const canCompanyReview = hasAnyRole(currentUser, ['admin', 'superadmin', 'compliance'])
  useEffect(() => { if (canCompanyReview) load(); else setLoading(false) }, [clientId, canCompanyReview])
  const activeSection = payload?.review?.sections?.find((item) => item.key === activeKey)
  useEffect(() => { setDraft({ status: activeSection?.status === 'NOT_REVIEWED' ? 'VERIFIED' : activeSection?.status || 'VERIFIED', remarks: activeSection?.remarks || '' }) }, [activeSection?.key, activeSection?.status, activeSection?.remarks])
  const fields = useMemo(() => fieldsFor(payload?.client?.data || {}, activeKey), [payload?.client?.data, activeKey])
  const attachments = useMemo(() => (sectionSources[activeKey] || []).flatMap((sourceKey) => attachmentsFrom(payload?.client?.data?.[sourceKey], titleize(sourceKey))), [payload?.client?.data, activeKey])
  const clientName = payload?.client?.data?.basic?.clientLegalName || payload?.client?.data?.basic?.tradeName || payload?.client?.selectedLead?.company || 'Client Master'
  const headerMetadata = useMemo(() => complianceHeaderMetadata(payload?.client || {}), [payload?.client])
  const allTabRemarksComplete = Boolean(payload?.review?.sections?.length) && payload.review.sections.every((section) => String(section.remarks || '').trim())
  async function saveSection() { setSaving('section'); setError(''); setNotice(''); try { const response = await api.put(API_ENDPOINTS.clients.complianceReviewSection(clientId, activeKey), draft); setPayload((current) => ({ ...current, review: response.data.review, progress: response.data.progress })); setNotice(`${activeSection?.label || 'Section'} review saved.`) } catch (err) { setError(err?.response?.data?.error || 'Unable to save this section review.') } finally { setSaving('') } }
  async function decide(decision, approvalMode = '') { setSaving(decision); setError(''); setNotice(''); try { await api.post(API_ENDPOINTS.clients.complianceReviewDecision(clientId), { decision, remarks: finalRemarks, approvalMode }); navigate('/pending-approval', { state: { approvalNotice: decision === 'APPROVED' ? `${clientName} received final approval.` : approvalMode === 'PARTIAL' ? `${clientName} partially approved and returned for pending tabs.` : `${clientName} returned with compliance remarks.` } }) } catch (err) { setError(err?.response?.data?.error || 'Unable to complete compliance review.') } finally { setSaving(''); setApprovalPrompt(false) } }
  if (loading && workspaceTab !== 'ar') return <DashboardShell currentUser={currentUser}><div className="grid min-h-screen place-items-center bg-slate-50"><Loader2 className="h-10 w-10 animate-spin text-emerald-700" /></div></DashboardShell>
  return <DashboardShell currentUser={currentUser}><div className="min-h-screen bg-[#f3f8f6] p-2 lg:p-3"><div className="w-full max-w-none space-y-4">
    <div className="ar-tabs" role="tablist" aria-label="Compliance review type">{[['company','Company Details'],['ar','AR Client']].map(([key,label]) => <button type="button" role="tab" id={`compliance-tab-${key}`} key={key} disabled={key === 'company' && !canCompanyReview} aria-controls="compliance-review-panel" tabIndex={workspaceTab === key ? 0 : -1} aria-selected={workspaceTab === key} onClick={() => setWorkspaceTab(key)} onKeyDown={(event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); if (!canCompanyReview) return; const next = event.key === 'Home' ? 'company' : event.key === 'End' ? 'ar' : key === 'company' ? 'ar' : 'company'; setWorkspaceTab(next); document.getElementById(`compliance-tab-${next}`)?.focus() } }}>{label}</button>)}</div>
    <div id="compliance-review-panel" role="tabpanel" className="space-y-4" aria-labelledby={`compliance-tab-${workspaceTab}`}>
    {workspaceTab === 'ar' ? <ArComplianceWorkspace clientId={clientId} /> : <>
    <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_12px_35px_rgba(15,23,42,.07)]"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex gap-3"><button type="button" onClick={() => navigate('/pending-approval')} className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white shadow-sm"><ArrowLeft className="h-5 w-5" /></button><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-emerald-700">Compliance Verification Workspace</p><h1 className="mt-1 text-2xl font-black text-slate-950">{clientName}</h1><p className="mt-1 text-sm font-semibold text-slate-500">{payload?.client?.selectedLead?.leadCode || 'Direct Client Master'} · Submitted by {payload?.client?.createdBy?.name || payload?.client?.createdBy?.email || '-'}</p></div></div><div className="flex min-w-72 items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-4"><span className="grid h-11 w-11 place-items-center rounded-xl bg-white text-emerald-700 shadow-sm"><ShieldCheck className="h-6 w-6" /></span><div className="min-w-0 flex-1"><div className="flex justify-between text-xs font-black text-emerald-900"><span>Verification Progress</span><span>{payload?.progress?.percentage || 0}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${payload?.progress?.percentage || 0}%` }} /></div><p className="mt-2 text-xs font-bold text-slate-600">{payload?.progress?.reviewed || 0}/{payload?.progress?.total || 9} tabs verified · {payload?.progress?.issues || 0} issues</p></div></div></div></header>
    <section className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-sm">{[['Applicant Type', headerMetadata.applicantTypes], ['Sub Applicant Type', headerMetadata.subApplicantTypes], ['Application Type', headerMetadata.applicationTypes]].map(([label, values]) => <span key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700"><b className="text-slate-950">{label}:</b> {values.join(', ') || '-'}</span>)}</section>
    {(error || notice) && <div className={`rounded-xl border p-3 text-sm font-bold ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{error || notice}</div>}
    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]"><aside className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_35px_rgba(15,23,42,.07)]"><div className="border-b bg-slate-50/70 p-4"><h2 className="font-black text-slate-950">Verification Tabs</h2><p className="text-xs font-semibold text-slate-500">Review every applicable section</p></div>{payload?.review?.sections?.map((section) => { const completion = payload?.completionBySection?.[section.key] ?? 0; const SectionIcon = sectionIcons[section.key] || FileText; return <button type="button" key={section.key} onClick={() => setActiveKey(section.key)} className={`relative flex w-full items-center gap-3 overflow-hidden border-b px-4 py-3.5 text-left transition ${activeKey === section.key ? 'bg-emerald-50 shadow-[inset_3px_0_0_#059669]' : 'hover:bg-slate-50'}`}><span className={`relative grid h-9 w-9 place-items-center rounded-xl ${statusStyle(section.status)}`}><SectionIcon className="h-4 w-4" />{section.status === 'CHANGES_REQUIRED' && <AlertTriangle className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-white text-rose-600" />}{section.status === 'VERIFIED' && <CheckCircle2 className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-white text-emerald-700" />}</span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><strong className="block truncate text-sm text-slate-900">{section.label}</strong><b className={`text-xs ${completion === 100 ? 'text-emerald-700' : completion >= 60 ? 'text-amber-600' : 'text-slate-500'}`}>{completion}%</b></span><small className="mt-0.5 block font-bold text-slate-500">{titleize(section.status)}</small><span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-slate-100"><span className={`block h-full rounded-full ${completion === 100 ? 'bg-emerald-600' : 'bg-gradient-to-r from-amber-400 to-teal-600'}`} style={{ width: `${completion}%` }} /></span></span><ChevronRight className="h-4 w-4 text-slate-400" /></button> })}</aside>
      <main className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><header className="flex flex-wrap items-center justify-between gap-3 border-b bg-slate-50 px-5 py-4"><div><h2 className="text-xl font-black text-slate-950">{activeSection?.label}</h2><p className="text-xs font-semibold text-slate-500">Compare entered information with uploaded supporting documents.</p></div><span className={`rounded-full px-3 py-1 text-xs font-black ${statusStyle(activeSection?.status)}`}>{titleize(activeSection?.status)}</span></header>
        <div className="p-5"><div className={`grid gap-4 ${attachments.length ? '2xl:grid-cols-[minmax(0,1fr)_280px]' : ''}`}><div>{activeKey === 'cteCtoCca' && (payload?.client?.data?.cte?.plantWiseDetails || payload?.client?.data?.cteCtoCca?.plantWiseDetails)?.length ? <CteReviewTables data={payload?.client?.data} /> : activeKey === 'authorizedPersons' && fields.length ? <PeopleReviewTable data={payload?.client?.data} /> : <div className="grid content-start gap-3 md:grid-cols-2">{fields.length ? fields.map((field, index) => <ReviewFieldCard key={field.id} field={field} index={index} />) : <div className="col-span-full rounded-xl border border-dashed p-10 text-center text-sm font-bold text-slate-400">No data stored in this section. Verify the available details or request changes.</div>}</div>}</div><AttachmentGallery attachments={attachments} /></div>
          {activeKey === 'documents' && <MsmeReviewTable data={payload?.client?.data} />}
          <section className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-5"><h3 className="flex items-center gap-2 font-black text-slate-950"><FileCheck2 className="h-5 w-5 text-emerald-700" />Compliance decision for this tab</h3><div className="mt-4 grid gap-3 sm:grid-cols-2">{[['VERIFIED','Verified',CheckCircle2],['CHANGES_REQUIRED','Changes Required',AlertTriangle]].map(([value,label,Icon]) => <button type="button" key={value} onClick={() => setDraft((current) => ({ ...current, status: value }))} className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-black ${draft.status === value ? value === 'CHANGES_REQUIRED' ? 'border-rose-500 bg-rose-600 text-white' : 'border-emerald-600 bg-emerald-700 text-white' : 'border-slate-200 bg-white text-slate-700'}`}><Icon className="h-4 w-4" />{label}</button>)}</div><label className="mt-4 block text-sm font-black text-slate-700">Tab remarks <span className="text-rose-600">*</span><textarea required rows={4} maxLength={1000} value={draft.remarks} onChange={(event) => setDraft((current) => ({ ...current, remarks: event.target.value }))} placeholder="Record verification notes or clearly explain required corrections..." className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-4 font-semibold outline-none focus:border-emerald-500" /></label><div className="mt-4 flex justify-end"><button type="button" onClick={saveSection} disabled={saving === 'section' || !draft.remarks.trim()} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#075848] px-5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">{saving === 'section' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save Tab Review</button></div></section>
        </div></main></div>
    <section className="sticky bottom-3 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur"><div className="grid gap-3 lg:grid-cols-[1fr_auto]"><label className="text-sm font-black text-slate-700">Final compliance remarks <span className="text-rose-600">*</span><textarea rows={2} maxLength={1000} value={finalRemarks} onChange={(event) => setFinalRemarks(event.target.value)} placeholder="Enter the final approval note or consolidated correction instructions..." className="mt-2 w-full rounded-xl border border-slate-200 p-3 font-semibold outline-none focus:border-emerald-500" /></label><div className="flex flex-wrap items-end gap-2"><button type="button" onClick={() => decide('CHANGES_REQUIRED')} disabled={!finalRemarks.trim() || Boolean(saving)} className="inline-flex h-11 items-center gap-2 rounded-xl border border-orange-300 px-4 font-black text-orange-700 disabled:opacity-50"><RotateCcw className="h-4 w-4" />Return for Correction</button><button type="button" onClick={() => decide('REJECTED', 'REJECTED')} disabled={!finalRemarks.trim() || Boolean(saving)} className="inline-flex h-11 items-center gap-2 rounded-xl border border-rose-300 px-4 font-black text-rose-700 disabled:opacity-50"><XCircle className="h-4 w-4" />Reject</button><button type="button" onClick={() => setApprovalPrompt(true)} disabled={!finalRemarks.trim() || !allTabRemarksComplete || Boolean(saving)} title={!allTabRemarksComplete ? 'Save remarks for every tab before approval' : ''} className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-700 px-5 font-black text-white disabled:cursor-not-allowed disabled:opacity-40"><ShieldCheck className="h-4 w-4" />Approve Client</button></div></div></section>
    {approvalPrompt && <div className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/65 p-4 backdrop-blur-sm"><section className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-emerald-700">Approval Confirmation</p><h2 className="mt-2 text-2xl font-black text-slate-950">Choose approval type</h2><p className="mt-2 text-sm font-semibold text-slate-500">The Client Master manager will receive an email showing completed and pending tabs.</p></div><button type="button" onClick={() => setApprovalPrompt(false)} className="grid h-10 w-10 place-items-center rounded-xl border"><XCircle className="h-5 w-5" /></button></div><div className="mt-6 grid gap-3 sm:grid-cols-2"><button type="button" onClick={() => decide('PARTIALLY_APPROVED', 'PARTIAL')} className="rounded-2xl border border-orange-200 bg-orange-50 p-5 text-left hover:border-orange-400"><strong className="block text-orange-800">Partially Approve</strong><span className="mt-2 block text-xs font-semibold leading-5 text-orange-700">Approve completed tabs and return remaining tabs to the manager with a 48-hour correction deadline.</span></button><button type="button" onClick={() => decide('APPROVED', 'FINAL')} disabled={payload?.progress?.reviewed !== payload?.progress?.total || payload?.progress?.issues > 0} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-left hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"><strong className="block text-emerald-800">Final Approve</strong><span className="mt-2 block text-xs font-semibold leading-5 text-emerald-700">Available after every applicable tab is verified and all issues are resolved.</span></button></div></section></div>}
    </>}
    </div>
  </div></div></DashboardShell>
}
