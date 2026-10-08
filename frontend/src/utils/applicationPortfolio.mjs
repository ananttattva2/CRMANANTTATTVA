import { buildOperationsProgressGroups, assignedCompanyKey } from './operationsUserProgress.mjs'

export const PIBO_CATEGORIES = ['Producer', 'Brand Owner', 'PWP', 'Importer', 'Producer (Small & Micro)', 'Importer of Raw Material', 'Recycler']
export const STATUS_COLUMNS = [
  ['total', 'Total'],
  ['annual', 'Annual Return Applicable'],
  ['annual:2025-26', '2025-26'], ['annual:2026-27', '2026-27'], ['annual:2027-28', '2027-28'], ['annual:unrecorded', 'Not Recorded'],
  ['approved', 'Approved'], ['applied', 'Applied'], ['underReview', 'Under Review'],
  ['notStarted', 'Not Started'], ['rejected', 'Rejected']
]
export function applicationSummaryRecords(group) {
  return group.records.map(record => {
    const priority = ['rejected', 'underReview', 'applied', 'notStarted', 'approved']
    const bucket = priority.find(status => record.services.some(service => service.bucket === status))
    const labels = { rejected: 'Rejected', underReview: 'Under Review', applied: 'Applied', notStarted: 'Not Started', approved: 'Approved' }
    const summaryService = applicationSummaryService(record)
    const annual = summaryService === 'Annual Return Filling'
    const annualYears = annual ? [...new Set(record.services.filter(service => service.closed && service.annual).flatMap(service => service.annualYears || []))] : []
    return { ...record, bucket, cpcb: labels[bucket], summaryService, annual, annualYears,
      offered: summaryService === 'unclassified' ? 'Not Closed / Service Not Recorded' : summaryService }
  })
}
export function matchesApplicationService(record, key) {
  if (key === 'total') return true
  return applicationSummaryService(record) === key
}
export function applicationSummaryService(record) {
  const closed = record.services.filter(service => service.closed)
  // Keep the representative application used by the Clients export. Retain
  // sibling assignments in details rather than counting this application twice.
  const representative = closed.find(service => service.id === record.id && service.offeredServices.length)
    || closed.find(service => service.offeredServices.length)
  return representative?.offeredServices[0] || 'unclassified'
}
export function cpcbStatusBucket(value) {
  const status = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (status.includes('reject')) return 'rejected'
  if (/underreview|inprogress|underprocess|processing/.test(status)) return 'underReview'
  if (status.includes('applied')) return 'applied'
  if (/approved|registered|processed|annualreturnapplicable/.test(status)) return 'approved'
  return 'notStarted'
}
export function companyStatusRecord(rows) {
  const services = rows.map(row => applicationRecord(row.client))
  const first = services.find(row => row.cpcb !== 'Not recorded') || services[0]
  const buckets = services.map(row => row.bucket)
  const bucket = ['rejected', 'underReview', 'applied', 'notStarted', 'approved'].find(status => buckets.includes(status))
  const labels = { notStarted: 'Not Started', applied: 'Applied', underReview: 'Under Review', approved: 'Approved', rejected: 'Rejected' }
  return { ...first, category: [...new Set(services.map(row => row.category))].join(' / '), bucket, cpcb: labels[bucket],
    live: services.some(row => row.live), annual: services.some(row => row.annual), services,
    code: [...new Set(services.map(row => row.code))].join(' / '), leadCode: [...new Set(services.map(row => row.leadCode).filter(Boolean))].join(' / '),
    sourceIds: services.map(row => row.id) }
}
const text = (...values) => values.find(value => typeof value === 'string' && value.trim())?.trim() || ''
const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
export function applicantCategory(value) {
  const key = normalize(value)
  if (key.includes('rawmaterial') && key.includes('import')) return 'Importer of Raw Material'
  if (key.includes('simp') && key.includes('import')) return 'Importer of Raw Material'
  if ((key.includes('simp') || key.includes('smallmicro')) && key.includes('produc')) return 'Producer (Small & Micro)'
  if (key.includes('recycler')) return 'Recycler'
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
  const assignments = lead.assignments || []
  const assignment = assignments.find(item => String(item.assignedServiceId || item.serviceAssignmentId || '') === String(client.assignedServiceId || '')) || (assignments.length === 1 ? assignments[0] : {})
  const closed = Boolean(assignment.closedAt || assignment.closedBy || assignment.closedByText || assignment.permanentClosedAt || (services.length === 1 && (lead.closedAt || lead.closedBy)) || String(lead.status || '').toLowerCase() === 'closed')
  const offered = service.servicesOffered ?? basic.servicesOffered ?? data.selectedLeadSnapshot?.servicesOffered ?? []
  const annual = isAnnualReturnService(offered)
  const annualYears = annual ? [...new Set([...(assignment.poYearRows || []), ...(assignment.originalPoDetails ? [assignment.originalPoDetails] : [])].filter(po => !po.services?.length || isAnnualReturnService(po.services)).map(po => po.annualReturnYear).filter(Boolean))] : []
  const category = applicantCategory(text(basic.piboCategory, basic.subApplicantType, service.subApplicantType, service.piboCategory, basic.applicantType, service.applicantType))
  const cpcb = text(data.cpcb?.status, data.cpcb?.approvalStatus, data.cpcb?.applicationStatus, basic.cpcbStatus, meta.cpcbStatus)
  const state = text(data.registeredAddress?.state, data.address?.state, data.addresses?.state, basic.state, meta.state)
  const clientStatus = text(meta.clientStatus, client.adminControls?.clientStatus, client.workflowStatus)
  const visibility = text(client.adminControls?.visibilityStatus, meta.visibilityStatus)
  const status = normalize(cpcb)
  const inactive = /suspend|discontinu|inactive/.test(normalize(`${clientStatus} ${visibility} ${cpcb}`))
  const bucket = cpcbStatusBucket(cpcb)
  return { id: String(client._id), companyKey: assignedCompanyKey(client), name: text(lead.company, lead.companyName, basic.clientLegalName, meta.companyName) || 'Unnamed client', category, cpcb: cpcb || 'Not recorded', clientStatus: clientStatus || 'Not recorded', visibility: visibility || 'Not recorded', state: state || 'Not recorded', created: client.createdAt || null, code: text(meta.clientCode, meta.uniqueId, client.uniqueId, meta.leadNumber, lead.leadCode) || 'Not recorded', leadCode: text(lead.leadCode, meta.leadNumber), industry: text(service.industryType, basic.companyIndustry, basic.industryType), eprCategory: text(service.eprCategory, basic.eprCategory), offered: (Array.isArray(offered) ? offered : [offered]).filter(Boolean).join(' / '), unit: text(service.plantUnit, basic.plantUnit, data.selectedLeadSnapshot?.plantUnit), offeredServices: canonicalOfferedServices(offered), closed, bucket, live: !inactive, annual, annualYears, sourceIds: [String(client._id)] }
}
export function buildApplicationPortfolio(assignments, users) {
  const groups = buildOperationsProgressGroups(assignments.map(client => ({ id: String(client._id), client, companyName: applicationRecord(client).name })), users)
  return groups.map(group => {
    const records = new Map()
    for (const company of group.rows) for (const row of company.serviceRows || [company]) {
      const record = applicationRecord(row.client)
      const identity = `${record.companyKey}:${normalize(record.category)}`
      const existing = records.get(identity)
      if (!existing) records.set(identity, { ...record, services: [record] })
      else {
        existing.sourceIds.push(record.id)
        existing.live ||= record.live
        existing.annual ||= record.annual
        existing.services.push(record)
        existing.code = [...new Set(existing.services.map(service => service.code))].join(' / ')
        existing.leadCode = [...new Set(existing.services.map(service => service.leadCode).filter(Boolean))].join(' / ')
        if (existing.bucket !== record.bucket) { existing.bucket = 'mixed'; existing.cpcb = 'Mixed status — view individual services' }
      }
    }
    return { ...group, records: [...records.values()], companyRecords: group.rows.map(company => companyStatusRecord(company.serviceRows || [company])), closedCompanies: group.rows.map(company => (company.serviceRows || [company]).filter(row => applicationRecord(row.client).closed)).filter(rows => rows.length).map(companyStatusRecord) }
  }).filter(group => group.records.length)
}


export function matchesPortfolioSearch(row, query) {
  const normalizeSearch = value => String(value || '').toLowerCase().normalize('NFKC').replace(/corpration/g, 'corporation').replace(/[^a-z0-9]/g, '')
  const needle = normalizeSearch(query)
  return !needle || [row, ...(row.services || [])].some(service => [service.name, service.code, service.leadCode, service.category, service.cpcb, service.state, service.industry, service.eprCategory, service.offered].some(value => normalizeSearch(value).includes(needle)))
}


export function isAnnualReturnService(value) {
  return (Array.isArray(value) ? value : [value]).some(service => {
    const normalized = String(service || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    return /annual(?:return(?:fill?ing)?|fill?ing)/.test(normalized)
  })
}


export function canonicalOfferedServices(value) {
  return [...new Set((Array.isArray(value) ? value : [value]).flatMap(item => String(item || '').split(/[,;\n]/)).map(item => item.trim()).filter(Boolean).map(service => isAnnualReturnService(service) ? 'Annual Return Filling' : service))]
}

export function offeredServiceColumns(groups) {
  return [...new Set(groups.flatMap(group => group.closedCompanies.flatMap(company => company.services.flatMap(service => service.offeredServices))))].sort((a, b) => a === 'Annual Return Filling' ? -1 : b === 'Annual Return Filling' ? 1 : a.localeCompare(b))
}
