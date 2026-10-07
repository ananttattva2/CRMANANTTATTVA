const value = input => String(input?._id || input || '');
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
      result.push({ _id: `assignment:${key}`, assignedServiceId: serviceId,
        selectedLead: { ...lead, assignments: [{ ...assignment, assignedServiceId: serviceId }], serviceSelections: [services[index] || {}] },
        data: { basic: { clientLegalName: lead.company || lead.companyName || lead.clientName || 'Untitled client' }, importMeta: { leadNumber: lead.leadCode || lead.sourceLeadId || '' } },
        adminControls: {}, sla: {}, assignmentOnly: true
      });
    });
  }
  return result;
}
module.exports = { mergeManagerStaffAllocations };
