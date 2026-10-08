const { resolveClientMasterData } = require('./clientMasterResolver');
const normalize = input => String(input || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const offering = input => (Array.isArray(input) ? input : [input]).map(v => /annual(?:return(?:fill?ing)?|fill?ing)/.test(normalize(v)) ? 'annualreturn' : normalize(v)).sort().join('|');
const value = input => String(input?._id || input || '');
function dashboardStatusClient(client) {
  const resolved = resolveClientMasterData(client);
  const data = { ...client.data, cpcb: Object.fromEntries(['status', 'approvalStatus', 'applicationStatus'].map(key => [key, resolved.cpcb?.[key]]).filter(([,v]) => v !== undefined)) };
  delete data.cpcbDataByAssignedServiceId;
  delete data.serviceDetailsByAssignedServiceId;
  return { ...client, data };
}
// Count permanent staff assignments per lead service, including services whose Client Master is not created yet.
function mergeManagerStaffAllocations(clients = [], leads = []) {
  const linked = new Set();
  const result = [];
  for (const client of clients) {
    const leadId = value(client.selectedLead || client.data?.selectedLeadSnapshot?.id);
    const serviceId = client.assignedServiceId || client.data?.selectedLeadSnapshot?.assignedServiceId || '';
    const key = leadId && serviceId ? `${leadId}:${serviceId}` : `client:${value(client._id)}`;
    if (linked.has(key)) continue;
    linked.add(key); result.push(client);
  }
  for (const lead of leads) {
    const services = lead.serviceSelections || [];
    (lead.assignments || []).forEach((assignment, index) => {
      if (!assignment.assignedStaff && !assignment.assignedStaffText && !assignment.assignedStaffEmail) return;
      const serviceId = value(assignment.assignedServiceId || assignment.serviceAssignmentId || services[index]?.assignedServiceId || services[index]?.serviceAssignmentId || `assignment-${index}`);
      const key = `${value(lead._id)}:${serviceId}`;
      if (linked.has(key)) return;
      linked.add(key);
      const service = services.find(s => value(s.assignedServiceId || s.serviceAssignmentId) === serviceId) || services[index] || {};
      const signature = row => [row.subApplicantType || row.piboCategory, row.plantUnit, row.eprCategory, offering(row.servicesOffered)].map(normalize).join(':');
      const matchingAssignments = (lead.assignments || []).flatMap((candidate, candidateIndex) => {
        const candidateId = value(candidate.assignedServiceId || candidate.serviceAssignmentId || services[candidateIndex]?.assignedServiceId || services[candidateIndex]?.serviceAssignmentId || `assignment-${candidateIndex}`);
        const candidateService = services.find(s => value(s.assignedServiceId || s.serviceAssignmentId) === candidateId) || services[candidateIndex] || {};
        return signature(candidateService) === signature(service)
          ? [{ ...candidate, assignedServiceId: candidateId }]
          : [];
      });
      const matchingPoRows = matchingAssignments.flatMap(candidate => [
        ...(Array.isArray(candidate.poYearRows) ? candidate.poYearRows : []),
        ...(candidate.originalPoDetails ? [candidate.originalPoDetails] : [])
      ]);
      const enrichedAssignment = {
        ...assignment,
        assignedServiceId: serviceId,
        ...(matchingPoRows.length ? { poYearRows: matchingPoRows } : {}),
        ...(matchingAssignments.some(candidate => normalize(candidate.poStatus) === 'received') ? { poStatus: 'received' } : {})
      };
      const master = clients.find(client => {
        if (value(client.selectedLead || client.data?.selectedLeadSnapshot?.id) !== value(lead._id)) return false;
        const selectedId = client.assignedServiceId || client.data?.selectedLeadSnapshot?.assignedServiceId;
        const selected = services.find(s => value(s.assignedServiceId || s.serviceAssignmentId) === value(selectedId));
        return selected && signature(selected) === signature(service)
          && Boolean(resolveClientMasterData(client, selectedId).cpcb?.status);
      });
      const masterData = master ? resolveClientMasterData(master) : {};
      result.push({ _id: `assignment:${key}`, assignedServiceId: serviceId,
        statusSourceClientId: master ? value(master._id) : undefined,
        workflowStatus: master?.workflowStatus,
        selectedLead: { ...lead, assignments: [enrichedAssignment], serviceSelections: [service] },
        data: { cpcb: masterData.cpcb?.status ? { status: masterData.cpcb.status } : {}, registeredAddress: masterData.registeredAddress?.state ? { state: masterData.registeredAddress.state } : {}, basic: { clientLegalName: lead.company || lead.companyName || lead.clientName || 'Untitled client' }, importMeta: { leadNumber: lead.leadCode || lead.sourceLeadId || '' } },
        adminControls: { visibilityStatus: master?.adminControls?.visibilityStatus }, sla: {}, assignmentOnly: true
      });
    });
  }
  return result;
}
module.exports = { mergeManagerStaffAllocations, dashboardStatusClient };
