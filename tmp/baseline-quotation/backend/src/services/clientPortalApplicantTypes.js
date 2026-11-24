const Lead = require('../models/Lead');
const { contactEmailFilter } = require('./clientPortal');
const closed = row => Boolean(row?.closedBy || row?.closedByText || row?.closedAt);
const serviceId = row => String(row?.assignedServiceId || row?.serviceAssignmentId || row?.assignmentId || '');
function closedServices(lead = {}) {
  const services = lead.serviceSelections?.length ? lead.serviceSelections : [lead];
  const assignments = lead.assignments || [];
  return services.flatMap((service, index) => {
    const key = serviceId(service);
    const assignment = key ? assignments.find(row => serviceId(row) === key) || {} : assignments[index] || {};
    if (!closed(service) && !closed(assignment) && !(services.length === 1 && closed(lead))) return [];
    const applicantType = String(service.subApplicantType || service.piboCategory || assignment.subApplicantType || assignment.piboCategory || service.applicantType || assignment.applicantType || (services.length === 1 ? lead.subApplicantType || lead.applicantType : '') || '').trim();
    return applicantType ? [{ ...service, ...assignment, applicantType }] : [];
  });
}
async function applicantTypes(email, leadId) {
  if (!email || !leadId) return [];
  const leads = await Lead.find({ $and: [contactEmailFilter(email), { _id: leadId }] }).select('applicantType subApplicantType serviceSelections assignments closedBy closedByText closedAt').lean();
  return [...new Set(leads.flatMap(closedServices).map(row => row.applicantType))].sort();
}
module.exports = { applicantTypes, closedServices };
