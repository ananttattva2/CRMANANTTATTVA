const text = value => String(value?._id || value || '').trim()
const rows = value => Array.isArray(value) ? value : []
const serviceId = value => text(value?.assignedServiceId || value?.serviceAssignmentId || value?.assignmentId)
const closed = value => Boolean(value?.closedAt || value?.closedBy || text(value?.closedByText))
const received = value => closed(value) || String(value?.poStatus || '').toLowerCase() === 'received'
  || [...rows(value?.poYearRows), ...(value?.originalPoDetails ? [value.originalPoDetails] : [])].some(po => po && Boolean(text(po.poNumber || po.poNo || po.poFileUrl || po.poFileName || po.poReceivedDate)))

export function sumClientPoCounts(counts = []) {
  return counts.reduce((total, count) => {
    for (const key of Object.keys(total)) total[key] += count?.[key] || 0
    return total
  }, { approved: 0, pending: 0, rejected: 0, revision: 0, unrecorded: 0, total: 0 })
}

function approvalCounts(approvals, assignments) {
  const counts = sumClientPoCounts()
  const sources = approvals.length ? approvals.map(approval => ({
    status: approval.approvalStatus, poRows: rows(approval.payload?.poYearRows), request: true
  })) : assignments.map(assignment => ({ status: assignment.poApprovalStatus, poRows: rows(assignment.poYearRows), original: assignment.originalPoDetails }))
  for (const source of sources) {
    const poRows = [...source.poRows]
    if (source.original && !poRows.some(po => po.poNumber && po.poNumber === source.original.poNumber)) poRows.push(source.original)
    const status = String(source.status || '').trim().toUpperCase()
    const count = poRows.length || (source.request || status ? 1 : 0)
    const key = { APPROVED: 'approved', PENDING: 'pending', REJECTED: 'rejected', REVISION_REQUIRED: 'revision' }[status] || 'unrecorded'
    counts[key] += count
    counts.total += count
  }
  return counts
}

export function clientPoCounts(client) {
  return sumClientPoCounts(clientPoServices(client).map(service => service.poCounts))
}

export function clientPoServices(client = {}) {
  const data = client.data || {}
  const snapshot = data.selectedLeadSnapshot || {}
  // A populated current Lead takes precedence over a historical service snapshot.
  const lead = client.selectedLead && typeof client.selectedLead === 'object' ? client.selectedLead : snapshot
  const services = rows(lead.serviceSelections).length ? lead.serviceSelections : [{ ...lead, ...snapshot }]
  const assignments = rows(lead.assignments)
  return services.map((raw, index) => {
    const service = raw || {}
    const id = serviceId(service)
    const matches = id ? assignments.filter(a => serviceId(a) === id) : []
    const indexed = assignments[index]
    // Positional legacy rows are safe only when they carry no conflicting ID.
    const assignment = matches.length ? matches : indexed && (!id || !serviceId(indexed)) ? [indexed] : []
    const approvals = rows(client.poApprovals).filter(approval => {
      const approvedServiceId = text(approval.payload?.assignedServiceId)
      return approvedServiceId ? approvedServiceId === id : Number(approval.payload?.assignmentIndex) === index
    })
    const isClosed = closed(service) || assignment.some(closed) || (services.length === 1 && closed(lead))
    return {
      id: id || serviceId(indexed) || `service-${index + 1}`, index: index + 1,
      applicantType: service.applicantType || service.piboParent || data.basic?.applicantType || '',
      subApplicantType: service.subApplicantType || service.piboCategory || data.basic?.piboCategory || '',
      category: service.eprCategory || data.basic?.eprCategory || '',
      name: service.servicesOffered || service.applicableService || data.basic?.servicesOffered || '',
      poCounts: approvalCounts(approvals, assignment.length ? assignment : services.length === 1 ? [lead] : []),
      closed: isClosed,
      received: isClosed || received(service) || assignment.some(received) || (services.length === 1 && received(lead))
    }
  })
}
export function companyPoClosed(client = {}) {
  const lead = client.selectedLead && typeof client.selectedLead === 'object' ? client.selectedLead : client.data?.selectedLeadSnapshot || {}
  return clientPoServices(client).some(service => service.closed) || rows(lead.assignments).some(closed)
}

export function clientPoExportEntries(clients = []) {
  const entries = new Map()
  for (const item of clients) {
    const data = item.data || {}
    const companyKey = text(item.selectedLead?._id || item.selectedLead?.id || (typeof item.selectedLead === 'string' ? item.selectedLead : '')
      || data.importMeta?.leadNumber || data.importMeta?.uniqueId || item.companyIdentity || item._id || item.id)
    const assignedId = serviceId(item) || serviceId(data) || serviceId(data.selectedLeadSnapshot)
    for (const service of clientPoServices(item)) {
      const key = `${companyKey}:${service.id}`
      const current = entries.get(key)
      if (!current || assignedId === service.id) entries.set(key, { item, service })
    }
  }
  return [...entries.values()]
}
