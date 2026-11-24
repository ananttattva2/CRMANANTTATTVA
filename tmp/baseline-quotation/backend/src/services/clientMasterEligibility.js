function text(value) {
  return String(value || '').trim();
}

function closureEvidence(row = {}) {
  return Boolean(row?.closedBy || text(row?.closedByText) || row?.closedAt);
}

function serviceRows(lead = {}) {
  return Array.isArray(lead.serviceSelections) && lead.serviceSelections.length ? lead.serviceSelections : [lead];
}

function assignmentRows(lead = {}) {
  return Array.isArray(lead.assignments) && lead.assignments.length ? lead.assignments : [lead];
}

function serviceIdAt(lead = {}, index = 0) {
  const service = serviceRows(lead)[index] || {};
  const assignment = assignmentRows(lead)[index] || {};
  return text(service.assignedServiceId || service.serviceAssignmentId || service.assignmentId
    || assignment.assignedServiceId || assignment.serviceAssignmentId || assignment.assignmentId);
}

function serviceClosedAt(lead = {}, index = 0) {
  const services = serviceRows(lead);
  const service = services[index] || {};
  const assignment = assignmentRows(lead)[index] || {};
  return closureEvidence(service) || closureEvidence(assignment) || (services.length === 1 && closureEvidence(lead));
}

function eligibleServiceIds(lead = {}) {
  return serviceRows(lead)
    .map((_, index) => serviceClosedAt(lead, index) ? serviceIdAt(lead, index) : '')
    .filter(Boolean);
}

function isLeadEligibleForClientMaster(lead = {}) {
  return serviceRows(lead).some((_, index) => serviceClosedAt(lead, index));
}

function isLeadServiceEligibleForClientMaster(lead = {}, assignedServiceId = '') {
  const requestedId = text(assignedServiceId);
  if (!requestedId) return false;
  const index = serviceRows(lead).findIndex((_, rowIndex) => serviceIdAt(lead, rowIndex) === requestedId);
  return index >= 0 && serviceClosedAt(lead, index);
}

module.exports = {
  eligibleServiceIds,
  isLeadEligibleForClientMaster,
  isLeadServiceEligibleForClientMaster,
  serviceClosedAt,
  serviceIdAt
};
