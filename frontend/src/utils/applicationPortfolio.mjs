import { buildOperationsProgressGroups, assignedCompanyKey } from './operationsUserProgress.mjs'

export const PIBO_CATEGORIES = ['Producer', 'Importer', 'Brand Owner', 'SIMP Producer Small-Micro', 'PWP', 'SIMP Producer (Small & Micro)', 'SIMP Importer of Raw Material', 'SIMP Seller']
export const STATUS_COLUMNS = [
  ['live', 'Live Clients'], ['annual', 'Annual Return Applicable'], ['processed', 'Processed Clients'],
  ['pending', 'Pending Clients'], ['progress', 'Portal In Progress'], ['rejected', 'Portal Rejected'],
  ['inactive', 'Discontinued / Suspended'], ['mixed', 'Mixed Service Status'], ['unknown', 'Status Not Recorded']
]
const text = (...values) => values.find(value => typeof value === 'string' && value.trim())?.trim() || ''
const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
export function applicantCategory(value) {
  const key = normalize(value)
  if ((key.includes('simp') || key.includes('rawmaterial')) && key.includes('import')) return PIBO_CATEGORIES[6]
  if (key.includes('simp') && key.includes('seller')) return PIBO_CATEGORIES[7]
  if ((key.includes('simp') || key.includes('smallmicro')) && key.includes('produc')) return String(value).includes('(') ? PIBO_CATEGORIES[5] : PIBO_CATEGORIES[3]
  if (key.includes('brandowner')) return 'Brand Owner'
  if (key.includes('importer')) return 'Importer'
  if (key.includes('producer')) return 'Producer'
  if (key === 'pwp' || key.includes('plasticwasteprocessor')) return 'PWP'
  return text(value) || 'Not recorded'
}
export function applicationRecord(client) {
  const data = client.data || {}, basic = data.basic || {}, meta = data.importMeta || {}, lead = client.selectedLead || {}
  const services = lead.serviceSelections || []
  const service = services.find(item => String(item.assignedServiceId || item.serviceAssignmentId || '') === String(client.assignedServiceId || '')) || (services.length === 1 ? services[0] : {})
  const category = applicantCategory(text(basic.piboCategory, basic.subApplicantType, service.subApplicantType, service.piboCategory, basic.applicantType, service.applicantType))
  const cpcb = text(data.cpcb?.status, data.cpcb?.approvalStatus, data.cpcb?.applicationStatus, basic.cpcbStatus, meta.cpcbStatus)
  const state = text(data.registeredAddress?.state, data.address?.state, data.addresses?.state, basic.state, meta.state)
  const clientStatus = text(meta.clientStatus, client.adminControls?.clientStatus, client.workflowStatus)
  const visibility = text(client.adminControls?.visibilityStatus, meta.visibilityStatus)
  const status = normalize(cpcb)
  const inactive = /suspend|discontinu|inactive/.test(normalize(`${clientStatus} ${visibility} ${cpcb}`))
  const bucket = inactive ? 'inactive' : /reject/.test(status) ? 'rejected' : /inprogress|underprocess|processing|underreview|applied/.test(status) ? 'progress' : /annualreturnapplicable/.test(status) ? 'annual' : /processed|approved|registered/.test(status) ? 'processed' : /pending/.test(status) ? 'pending' : 'unknown'
  return { id: String(client._id), companyKey: assignedCompanyKey(client), name: text(lead.company, lead.companyName, basic.clientLegalName, meta.companyName) || 'Unnamed client', category, cpcb: cpcb || 'Not recorded', clientStatus: clientStatus || 'Not recorded', visibility: visibility || 'Not recorded', state: state || 'Not recorded', created: client.createdAt || null, code: text(meta.clientCode, meta.uniqueId, client.uniqueId, meta.leadNumber, lead.leadCode) || 'Not recorded', bucket, live: !inactive && normalize(visibility) === 'live', annual: Boolean(text(basic.firstAnnualReturnYear, basic.firstAnnualReturnYearApplicable, service.firstAnnualReturnYearApplicable).match(/20\d{2}/)) || /annualreturnapplicable/.test(status), sourceIds: [String(client._id)] }
}
export function buildApplicationPortfolio(assignments, users) {
  const groups = buildOperationsProgressGroups(assignments.map(client => ({ id: String(client._id), client, companyName: applicationRecord(client).name })), users)
  return groups.map(group => {
    const records = new Map()
    for (const company of group.rows) for (const row of company.serviceRows || [company]) {
      const record = applicationRecord(row.client)
      const identity = `${record.companyKey}:${normalize(record.category)}`
      const existing = records.get(identity)
      if (!existing) records.set(identity, record)
      else {
        existing.sourceIds.push(record.id)
        existing.live ||= record.live
        existing.annual ||= record.annual
        if (existing.bucket !== record.bucket) { existing.bucket = 'mixed'; existing.cpcb = 'Mixed status — view individual services'; existing.services = existing.services || [{ ...existing, services: undefined }]; existing.services.push(record) }
      }
    }
    return { ...group, records: [...records.values()] }
  }).filter(group => group.records.length)
}
