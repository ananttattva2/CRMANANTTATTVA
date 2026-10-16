import { buildOperationsProgressGroups, assignedCompanyKey } from './operationsUserProgress.mjs'

export const PIBO_CATEGORIES = ['Producer', 'Brand Owner', 'PWP', 'Importer', 'Producer (Small & Micro)', 'Importer of Raw Material', 'Recycler']
export const STATUS_COLUMNS = [
  ['total', 'Total'],
  ['annual:2025-26', '2025-26'], ['annual:2026-27', '2026-27'], ['annual:2027-28', '2027-28'], ['annual:unrecorded', 'Not Recorded'],
  ['annualActionRequired', 'AR Action Required'],
  ['otherServicesApproved', 'Approved'],
  ['applied', 'Applied'], ['underReview', 'Under Review'],
  ['notStarted', 'Not Started'], ['rejected', 'Rejected']
]
export function applicationSummaryRecords(group) {
  return group.records.map(record => {
    const summaryService = applicationSummaryService(record)
    const matchingServices = record.services.filter(service => service.closed && service.offeredServices[0] === summaryService)
    const statusServices = matchingServices.length ? matchingServices : record.services
    const priority = ['rejected', 'underReview', 'applied', 'notStarted', 'approved']
    const bucket = priority.find(status => statusServices.some(service => service.bucket === status))
    const labels = { rejected: 'Rejected', underReview: 'Under Review', applied: 'Applied', notStarted: 'Not Started', approved: 'Approved' }
    const annual = summaryService === 'Annual Return Filling' && bucket === 'approved' && statusServices.some(service => service.annualEligiblePo)
    const recordedYears = annual ? [...new Set(statusServices.filter(service => service.closed && service.annual && service.annualWorkflowReady).flatMap(service => service.annualYears || []))]
      .sort((left, right) => financialYearStart(left) - financialYearStart(right)) : []
    const annualYears = recordedYears.length ? [recordedYears[0]] : []
    return { ...record, bucket, cpcb: labels[bucket], summaryService, annual, annualYears,
      offered: summaryService === 'unclassified' ? 'Not Closed / Service Not Recorded' : summaryService }
  })
}
export function applicationServiceSummaryRecords(group) {
  const records = group.records.flatMap(record => {
    const byService = new Map()
    for (const service of record.services) {
      // Blank service placeholders are not applications and must not create a
      // synthetic "Not recorded" service/status row.
      for (const offered of service.offeredServices) {
        if (!byService.has(offered)) byService.set(offered, [])
        byService.get(offered).push({ ...service, offeredServices: [offered], offered })
      }
    }
    return [...byService].map(([offered, services]) => ({
      ...record, ...services[0], id: `${record.id}:${offered}`, services,
      sourceIds: services.map(service => service.id)
    }))
  })
  return applicationSummaryRecords({ records })
}
export function applicationReportGroups(groups) {
  // Every tab counts the same company/category/unit/service applications.
  // Keep category-level grouping internal, then expand services for reporting.
  return groups.map(group => ({
    ...group,
    records: applicationServiceSummaryRecords(group).map(record => ({
      ...record,
      spocId: group.id,
      spocName: group.name,
      services: (record.services || []).map(service => ({
        ...service,
        spocId: group.id,
        spocName: group.name
      }))
    }))
  }))
}
export function matchesApplicationService(record, key) {
  if (key === 'total') return true
  return applicationSummaryService(record) === key
}
export function matchesServiceSummary(record, key, date = new Date()) {
  const summary = record.annualYears ? record : applicationSummaryRecords({ records: [record] })[0]
  const representativeService = rawApplicationSummaryService(summary)
  const annualForYear = summary.annual && summary.annualYears.length > 0
  if (key === 'Annual Return Filling') return annualForYear
  if (key === 'annualActionRequired') return representativeService === 'Annual Return Filling' && !annualForYear
  if (key === 'total') return true
  return matchesApplicationService(summary, key)
}
export function matchesStatusSummary(record, key, date = new Date()) {
  const approvedRegistration = record.bucket === 'approved'
    && ((record.services || []).some(service => isRegistrationService(service.offeredServices))
      || isRegistrationService(rawApplicationSummaryService(record)))
  // Approved Registration is a completed commercial/PO outcome, not an
  // outstanding application-status item. Other registration statuses remain.
  if (key === 'total') return !approvedRegistration
  const actionRequired = matchesServiceSummary(record, 'annualActionRequired', date)
  if (key === 'annualActionRequired') return actionRequired
  if (key === 'registrationApproved') return false
  if (key === 'otherServicesApproved') return !actionRequired
    && record.bucket === 'approved'
    && (record.services || []).some(service => service.offeredServices?.some(offered => (
      !isAnnualReturnService(offered) && !isRegistrationService(offered)
    )))
  if (key.startsWith('annual:')) return !actionRequired && record.annual
    && (key === 'annual:unrecorded' ? !record.annualYears.length : record.annualYears.includes(key.slice(7)))
  return !actionRequired && record.bucket === key
}

export function isRegistrationService(value) {
  return (Array.isArray(value) ? value : [value]).some((item) => {
    const service = normalize(item)
    return service === 'registration' || service === 'newregistration'
  })
}
export function annualActionReasons(record) {
  const services = (record.services || []).filter(service => service.offeredServices?.includes('Annual Return Filling'))
  const reasons = []
  if (!services.some(service => service.closed)) reasons.push('Service closure pending')
  if (!services.some(service => service.bucket === 'approved')) reasons.push('CPCB status is not Approved')
  if (!services.some(service => service.annualEligiblePo)) reasons.push(`Received PO for Annual Return ${annualReturnYearForDate()} is missing`)
  if (!services.some(service => service.annualWorkflowReady)) reasons.push('Manager or permanent staff assignment is incomplete')
  if (services.some(service => service.annualEligiblePo) && !services.some(service => service.annualYears?.length)) reasons.push('Annual Return Year is missing')
  return reasons.length ? reasons : ['Does not qualify for the selected Annual Return year']
}
export function applicationSummaryService(record) {
  const offered = rawApplicationSummaryService(record)
  const closed = record.services.filter(service => service.closed)
  if (offered === 'Annual Return Filling' && !closed.some(service => service.offeredServices[0] === offered && service.annualWorkflowReady)) return 'Assignment Pending'
  return offered
}
function rawApplicationSummaryService(record) {
  const closed = record.services.filter(service => service.closed)
  // Registration can be the saved master while Annual Return is a sibling
  // assignment. Annual eligibility and correction work must remain visible.
  const representative = closed.find(service => service.offeredServices.includes('Annual Return Filling'))
    || closed.find(service => service.id === record.id && service.offeredServices.length)
    || closed.find(service => service.offeredServices.length)
    || record.services.find(service => service.offeredServices.includes('Annual Return Filling'))
  return representative?.offeredServices.includes('Annual Return Filling') ? 'Annual Return Filling' : representative?.offeredServices[0] || 'unclassified'
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
  const services = rows.map(row => row?.client ? applicationRecord(row.client) : row).filter(Boolean)
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
const scopedCpcbStatus = (data, assignedServiceId) => {
  if (!assignedServiceId) return ''
  const serviceScope = data.serviceDetailsByAssignedServiceId?.[assignedServiceId]
  const cpcbScope = data.cpcbDataByAssignedServiceId?.[assignedServiceId]
  const statusFrom = scope => text(
    scope?.cpcb?.status,
    scope?.cpcb?.approvalStatus,
    scope?.cpcb?.applicationStatus,
    scope?.status,
    scope?.approvalStatus,
    scope?.applicationStatus
  )
  // Match Client Master resolution order: the complete service scope is most
  // specific, followed by the CPCB-only scope, then the legacy root section.
  return statusFrom(serviceScope) || statusFrom(cpcbScope)
}
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
  const selectedServiceId = String(client.assignedServiceId || data.assignedServiceId || data.selectedLeadSnapshot?.assignedServiceId || '')
  const serviceIndex = services.findIndex(item => selectedServiceId && String(item.assignedServiceId || item.serviceAssignmentId || '') === selectedServiceId)
  const service = serviceIndex >= 0 ? services[serviceIndex] : (services.length === 1 ? services[0] : {})
  const assignments = lead.assignments || []
  const exactAssignment = assignments.find(item => selectedServiceId && String(item.assignedServiceId || item.serviceAssignmentId || '') === selectedServiceId)
  const indexedAssignment = serviceIndex >= 0 && assignments[serviceIndex]
    && !String(assignments[serviceIndex].assignedServiceId || assignments[serviceIndex].serviceAssignmentId || '')
    ? assignments[serviceIndex] : null
  const assignment = exactAssignment || indexedAssignment || (assignments.length === 1 ? assignments[0] : {})
  const closed = Boolean(assignment.closedAt || assignment.closedBy || assignment.closedByText || assignment.permanentClosedAt || (services.length === 1 && (lead.closedAt || lead.closedBy)) || String(lead.status || '').toLowerCase() === 'closed')
  const hasMatchedLeadService = Boolean(Object.keys(service).length)
  // A matched lead service is authoritative, including when its service name
  // is blank. Falling back to Client Master in that case can copy a sibling
  // service (for example New Registration) into an Annual Return assignment.
  const selectedServiceOffering = service.servicesOffered ?? service.applicableService
  // Some legacy closed leads saved the service label on the matching
  // assignment, while leaving the service-selection label blank. This is a
  // same-service fallback; Client Master remains excluded because it can
  // contain a sibling service.
  const assignmentOffering = assignment.servicesOffered ?? assignment.applicableService
  const legacyOffering = [lead.servicesOffered, lead.applicableService, basic.servicesOffered, basic.applicableService, data.selectedLeadSnapshot?.servicesOffered, data.selectedLeadSnapshot?.applicableService]
    .find(value => canonicalOfferedServices(value).length) ?? []
  const offered = hasMatchedLeadService
    ? (canonicalOfferedServices(selectedServiceOffering).length ? selectedServiceOffering : assignmentOffering ?? [])
    : legacyOffering
  const annual = isAnnualReturnService(offered)
  const annualWorkflowReady = Boolean(assignment.assignedTo || assignment.assignedToText || assignment.assignedToEmail)
    && Boolean(assignment.assignedStaff || assignment.assignedStaffText || assignment.assignedStaffEmail)
  const poRows = [...(assignment.poYearRows || []), ...(assignment.originalPoDetails ? [assignment.originalPoDetails] : [])]
  const hasPoEvidence = po => [po.poNumber, po.poNo, po.poDate, po.poReceivedDate, po.poFileName, po.fileName, po.poFileUrl]
    .some(value => Boolean(String(value || '').trim()))
  const poReceived = String(assignment.poStatus || '').toLowerCase() === 'received' || poRows.some(hasPoEvidence)
  const annualPoRows = annual && poReceived ? poRows
    .filter(po => !po.services?.length || isAnnualReturnService(po.services))
    : []
  // PO financial year is commercial metadata. For dashboard placement, use the
  // earliest Annual Return year listed on the received PO, regardless of the PO
  // financial year. The summary layer reduces these years to that first year.
  const poAnnualYears = [...new Set(annualPoRows.map(po => String(po.annualReturnYear || '').trim()).filter(Boolean))]
  const dashboardAnnualYears = new Set(STATUS_COLUMNS.map(([key]) => key.startsWith('annual:') ? key.slice(7) : '').filter(year => year && year !== 'unrecorded'))
  const annualYears = poAnnualYears.filter(year => dashboardAnnualYears.has(year))
  const annualEligiblePo = annualYears.length > 0
  const category = applicantCategory(text(service.subApplicantType, service.piboCategory, lead.subApplicantType, lead.piboCategory, basic.piboCategory, basic.subApplicantType, service.applicantType, lead.applicantType, basic.applicantType))
  const scopedCpcb = scopedCpcbStatus(data, selectedServiceId)
  const registrationConfirmed = data.cpcbOnboarding?.cpcbPortalRegistered === true && isRegistrationService(offered)
  const rootCpcb = text(data.cpcb?.status, data.cpcb?.approvalStatus, data.cpcb?.applicationStatus, basic.cpcbStatus, meta.cpcbStatus, registrationConfirmed ? 'Registered' : '')
  // Older saves sometimes changed the matching root value but retained a
  // generated Not Started scope. A real scoped decision remains authoritative;
  // only a default placeholder yields to a meaningful same-master root edit.
  const cpcb = /^(notstarted|notrecorded|pending)?$/.test(normalize(scopedCpcb))
    && rootCpcb && !/^(notstarted|notrecorded|pending)$/.test(normalize(rootCpcb))
    ? rootCpcb : text(scopedCpcb, rootCpcb)
  const state = text(data.registeredAddress?.state, data.address?.state, data.addresses?.state, basic.state, meta.state)
  const clientStatus = text(meta.clientStatus, client.adminControls?.clientStatus, client.workflowStatus)
  const visibility = text(client.adminControls?.visibilityStatus, meta.visibilityStatus)
  const status = normalize(cpcb)
  const inactive = /suspend|discontinu|inactive/.test(normalize(`${clientStatus} ${visibility} ${cpcb}`))
  const bucket = cpcbStatusBucket(cpcb)
  return { id: String(client._id), assignmentOnly: Boolean(client.assignmentOnly), statusSourceClientId: client.statusSourceClientId || '', leadId: String(lead._id || ''), companyKey: assignedCompanyKey(client), name: text(lead.company, lead.companyName, basic.clientLegalName, meta.companyName) || 'Unnamed client', category, cpcb: cpcb || 'Not recorded', clientStatus: clientStatus || 'Not recorded', visibility: visibility || 'Not recorded', state: state || 'Not recorded', created: client.createdAt || null, code: text(meta.clientCode, meta.uniqueId, client.uniqueId, meta.leadNumber, lead.leadCode) || 'Not recorded', leadCode: text(lead.leadCode, meta.leadNumber), industry: text(service.industryType, lead.industryType, basic.companyIndustry, basic.industryType), eprCategory: text(service.eprCategory, lead.eprCategory, basic.eprCategory), offered: (Array.isArray(offered) ? offered : [offered]).filter(Boolean).join(' / '), unit: text(service.plantUnit, lead.plantUnit, basic.plantUnit, data.selectedLeadSnapshot?.plantUnit), offeredServices: canonicalOfferedServices(offered), closed, bucket, live: !inactive, annual, annualEligiblePo, annualWorkflowReady, annualYears, poAnnualYears, sourceIds: [String(client._id)] }
}
// Placeholders and blank drafts do not represent another application when
// this lead already has a submitted master for the same applicant/unit/service.
export function effectiveApplicationServices(services) {
  // Dashboard counts represent saved, non-draft applications with an actual
  // service. Draft Client Masters and blank assignment shells remain editable
  // elsewhere but never contribute to portfolio totals or drill-downs.
  services = services.filter(service => normalize(service.clientStatus) !== 'draft' && service.offeredServices?.length)
  const signature = service => [service.leadId, service.category, service.unit, service.industry, service.eprCategory, [...service.offeredServices].sort().join('|')].map(normalize).join(':')
  const sameDraftApplication = (draft, submitted) => {
    // A unitless draft without an offered service is an unfinished applicant
    // shell. Its provisional industry can differ from the submitted master.
    const incompleteShell = !draft.offeredServices.length && !normalize(draft.unit)
      && normalize(draft.leadId) === normalize(submitted.leadId)
      && normalize(draft.category) === normalize(submitted.category)
      && (!normalize(draft.eprCategory) || normalize(draft.eprCategory) === normalize(submitted.eprCategory))
    if (incompleteShell) return true
    const fieldsMatch = [draft.leadId, draft.category, draft.industry, draft.eprCategory, [...draft.offeredServices].sort().join('|')]
      .map(normalize).join(':') === [submitted.leadId, submitted.category, submitted.industry, submitted.eprCategory, [...submitted.offeredServices].sort().join('|')]
        .map(normalize).join(':')
    const draftUnit = normalize(draft.unit), submittedUnit = normalize(submitted.unit)
    return fieldsMatch && (!draftUnit || draftUnit === 'notrecorded' || !submittedUnit || draftUnit === submittedUnit)
  }
  const hydrated = new Map()
  services = services.filter(service => {
    if (!service.assignmentOnly) return true
    const key = `${service.statusSourceClientId || 'unlinked'}:${signature(service)}:${service.bucket}`
    const existing = hydrated.get(key)
    if (!existing) { hydrated.set(key, service); return true }
    existing.annualEligiblePo ||= service.annualEligiblePo
    existing.closed ||= service.closed
    existing.annualWorkflowReady ||= service.annualWorkflowReady
    existing.annualYears = [...new Set([...(existing.annualYears || []), ...(service.annualYears || [])])]
    existing.poAnnualYears = [...new Set([...(existing.poAnnualYears || []), ...(service.poAnnualYears || [])])]
    return false
  })
  const saved = services.filter(service => !service.assignmentOnly)
  return services.filter(service => {
    const draft = !service.assignmentOnly && normalize(service.clientStatus) === 'draft'
    const replaceableDraft = draft && ['notrecorded', 'approved'].includes(normalize(service.cpcb))
    if ((!service.assignmentOnly && !replaceableDraft) || !service.leadId) return true
    const master = saved.find(candidate => candidate.id !== service.id
      && (service.assignmentOnly ? signature(candidate) === signature(service) : sameDraftApplication(service, candidate))
      && (!replaceableDraft || normalize(candidate.clientStatus) === 'submitted'))
    if (!master) return true
    master.annualEligiblePo ||= service.annualEligiblePo
    master.annualYears = [...new Set([...(master.annualYears || []), ...(service.annualYears || [])])]
    master.poAnnualYears = [...new Set([...(master.poAnnualYears || []), ...(service.poAnnualYears || [])])]
    return false
  })
}

export function buildApplicationPortfolio(assignments, users) {
  const groups = buildOperationsProgressGroups(assignments.map(client => ({ id: String(client._id), client, companyName: applicationRecord(client).name })), users)
  return groups.map(group => {
    const records = new Map()
    const assignedServices = effectiveApplicationServices(group.rows.flatMap(company => (company.serviceRows || [company]).map(row => applicationRecord(row.client))))
    for (const record of assignedServices) {
      const identity = `${record.companyKey}:${normalize(record.category)}:${normalize(record.unit)}`
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
    for (const record of records.values()) {
      record.services = effectiveApplicationServices(record.services)
      const buckets = [...new Set(record.services.map(service => service.bucket))]
      record.bucket = buckets.length === 1 ? buckets[0] : 'mixed'
      record.cpcb = buckets.length === 1 ? record.services[0].cpcb : 'Mixed status — view individual services'
    }
    const companyServices = new Map()
    assignedServices.forEach(service => {
      if (!companyServices.has(service.companyKey)) companyServices.set(service.companyKey, [])
      companyServices.get(service.companyKey).push(service)
    })
    const companyRecords = [...companyServices.values()].map(companyStatusRecord)
    const closedCompanies = [...companyServices.values()].map(rows => rows.filter(row => row.closed)).filter(rows => rows.length).map(companyStatusRecord)
    return { ...group, records: [...records.values()], companyRecords, closedCompanies }
  }).filter(group => group.records.length)
}


export function matchesPortfolioSearch(row, query) {
  const normalizeSearch = value => String(value || '').toLowerCase().normalize('NFKC').replace(/corpration/g, 'corporation').replace(/[^a-z0-9]/g, '')
  const needle = normalizeSearch(query)
  return !needle || [row, ...(row.services || [])].some(service => [service.name, service.code, service.leadCode, service.category, service.cpcb, service.state, service.industry, service.eprCategory, service.offered].some(value => normalizeSearch(value).includes(needle)))
}

// Client Master and assignment snapshots can describe the same displayed
// service. Collapse identical detail rows without changing application counts.
export function uniquePortfolioServiceDetails(services = []) {
  const seen = new Set()
  return services.filter(service => {
    const key = JSON.stringify([
      service.leadId || service.leadCode || service.code,
      service.leadCode || service.code, service.name, service.category,
      service.industry, service.eprCategory, service.offered,
      service.unit, service.cpcb, service.clientStatus, service.visibility
    ].map(value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()))
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}


export function isAnnualReturnService(value) {
  return (Array.isArray(value) ? value : [value]).some(service => {
    const label = service && typeof service === 'object'
      ? service.name || service.label || service.servicesOffered || service.applicableService || service.service || ''
      : service
    const normalized = String(label || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    return /annual(?:return(?:fill?ing)?|fill?ing)/.test(normalized)
  })
}

export function financialYearForDate(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).formatToParts(date).map(part => [part.type, part.value]))
  const calendarYear = Number(parts.year)
  const startYear = Number(parts.month) >= 4 ? calendarYear : calendarYear - 1
  return `${startYear}-${String(startYear + 1).slice(-2)}`
}

export function annualReturnYearForDate(date = new Date()) {
  const startYear = Number(financialYearForDate(date).slice(0, 4)) - 1
  return `${startYear}-${String(startYear + 1).slice(-2)}`
}

function financialYearStart(value) {
  const match = String(value || '').trim().match(/^(20\d{2})-\d{2}$/)
  return match ? Number(match[1]) : Number.NEGATIVE_INFINITY
}


export function canonicalOfferedServices(value) {
  return [...new Set((Array.isArray(value) ? value : [value]).flatMap(item => {
    const label = item && typeof item === 'object'
      ? item.name || item.label || item.servicesOffered || item.applicableService || item.service || ''
      : item
    return String(label || '').split(/[,;\n]/)
  }).map(item => item.trim()).filter(Boolean).map(service => isAnnualReturnService(service) ? 'Annual Return Filling' : service))]
}

export function offeredServiceColumns(groups) {
  return [...new Set(groups.flatMap(group => group.closedCompanies.flatMap(company => company.services.flatMap(service => service.offeredServices))))].sort((a, b) => a === 'Annual Return Filling' ? -1 : b === 'Annual Return Filling' ? 1 : a.localeCompare(b))
}
