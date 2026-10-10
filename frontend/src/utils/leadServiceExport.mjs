// Expand the canonical services instead of exporting only compatibility fields
// from the first service. Status and PO details belong to each assignment.
export function leadServiceExportRecords(lead = {}) {
  const services = lead.serviceSelections?.length ? lead.serviceSelections : [lead]
  return services.map((service, index) => {
    const id = String(service.assignedServiceId || service.serviceAssignmentId || '')
    const assignments = lead.assignments || []
    const assignment = assignments.find(row => id && String(row.assignedServiceId || row.serviceAssignmentId || '') === id)
      || (!assignments[index]?.assignedServiceId && !assignments[index]?.serviceAssignmentId ? assignments[index] : null)
      || (services.length === 1 && !assignments.length ? lead : {})
    const poRows = [...(assignment.poYearRows || [])]
    if (assignment.originalPoDetails && !poRows.some(row => row.poNumber === assignment.originalPoDetails.poNumber)) {
      poRows.push(assignment.originalPoDetails)
    }
    const received = String(assignment.poStatus || '').toLowerCase() === 'received'
      || Boolean(assignment.originalPoDetails)
      || (String(assignment.poStatus || '').toLowerCase() !== 'provisional'
        && poRows.some(row => row.poNumber || row.poFileUrl || row.poProofUrl))
    const closed = Boolean(assignment.closedAt || assignment.closedBy || assignment.closedByText || assignment.permanentClosedAt)
    const approval = String(assignment.poApprovalStatus || '').toUpperCase()
    const poClosed = received && closed && (approval === 'APPROVED' || Boolean(assignment.permanentClosedAt))
    const contact = (lead.contacts || []).find(row => id && row.assignedServiceId === id)
      || (lead.contacts || []).find(row => service.plantUnit && row.plantUnit === service.plantUnit) || {}
    return {
      ...lead, ...contact, ...service,
      subApplicantType: service.subApplicantType || service.piboCategory || '',
      closedBy: assignment.closedBy || '', closedByText: assignment.closedByText || '',
      closedAt: assignment.closedAt || '', closedOnBehalfOfName: assignment.closedOnBehalfOfName || '',
      assignments: [{ ...assignment, poYearRows: poRows }],
      exportServiceNumber: index + 1,
      exportLeadClosed: closed ? 'Yes' : 'No',
      exportPoReceived: received ? 'Yes' : 'No',
      exportPoClosed: poClosed ? 'Yes' : 'No',
      exportPoApprovalStatus: approval || 'Not Recorded'
    }
  })
}
