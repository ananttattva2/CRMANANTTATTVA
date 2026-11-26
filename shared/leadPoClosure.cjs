const text = value => String(value?._id || value || '').trim();
const rows = value => Array.isArray(value) ? value : [];
const id = value => text(value?.assignedServiceId || value?.serviceAssignmentId || value?.assignmentId);
const closure = row => Boolean(row?.closedAt || row?.closedBy || text(row?.closedByText) || row?.permanentClosedAt);
function poClosed(row = {}) {
  const approval = text(row.poApprovalStatus).toUpperCase();
  const po = [...rows(row.poYearRows), ...(row.originalPoDetails ? [row.originalPoDetails] : [])];
  const received = text(row.poStatus).toLowerCase() !== 'provisional' && (text(row.poStatus).toLowerCase() === 'received' || po.some(value => text(value.poNumber || value.poNo || value.poFileUrl || value.poProofUrl)));
  return received && closure(row) && (Boolean(row.permanentClosedAt) || !approval || approval === 'APPROVED');
}
function serviceClosureRows(lead = {}) {
  const assignments = rows(lead.assignments);
  const services = rows(lead.serviceSelections).length ? lead.serviceSelections : assignments.length > 1 ? assignments : [lead];
  return services.map((service, index) => {
    const serviceId = id(service);
    const assignment = assignments.find(value => serviceId && id(value) === serviceId)
      || (assignments[index] && (!serviceId || !id(assignments[index])) ? assignments[index] : null)
      || (services.length === 1 && !assignments.length ? lead : {});
    // Root compatibility fields must never close an unrelated sibling service.
    const own = { ...(services.length === 1 ? lead : {}), ...service, ...assignment };
    return { serviceId: serviceId || id(assignment) || (services.length === 1 ? id(lead) : ''), assignment: own };
  });
}
function staffedPoClosure(row) {
  return poClosed(row)
    && [row.assignedTo, row.assignedToText, row.assignedToEmail].some(value => text(value))
    && [row.assignedStaff, row.assignedStaffText, row.assignedStaffEmail].some(value => text(value));
}
function serviceClosureSummary(lead = {}) {
  const services = serviceClosureRows(lead);
  const closedCount = services.filter(({ assignment }) => poClosed(assignment)).length;
  return { total: services.length, closedCount, openCount: services.length - closedCount };
}
module.exports = { serviceClosureRows, serviceClosureSummary, poClosed, staffedPoClosure };
