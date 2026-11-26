const Lead = require('../models/Lead');
const { servicesClientFilter } = require('./financeApprovedClients');
const { serviceClosureSummary, serviceClosureRows, poClosed } = require('../../../shared/leadPoClosure.cjs');
async function closedPoClientFilter(LeadModel = Lead, { requireStaff = false } = {}) {
  const leads = await LeadModel.find({ $or: [
    { closedAt: { $exists: true, $ne: null } }, { closedBy: { $exists: true, $ne: null } },
    { permanentClosedAt: { $exists: true, $nin: ['', null] } },
    { closedByText: { $exists: true, $nin: ['', null] } },
    { 'assignments.closedAt': { $exists: true, $nin: ['', null] } },
    { 'assignments.closedBy': { $exists: true, $ne: null } },
    { 'assignments.closedByText': { $exists: true, $nin: ['', null] } },
    { 'assignments.permanentClosedAt': { $exists: true, $nin: ['', null] } },
    { 'serviceSelections.closedAt': { $exists: true, $nin: ['', null] } },
    { 'serviceSelections.closedByText': { $exists: true, $nin: ['', null] } },
    { 'serviceSelections.closedBy': { $exists: true, $ne: null } }
  ] }).select('assignedServiceId assignedTo assignedToText assignedToEmail assignedStaff assignedStaffText assignedStaffEmail assignments.assignedTo assignments.assignedToText assignments.assignedToEmail assignments.assignedStaff assignments.assignedStaffText assignments.assignedStaffEmail leadCode closedAt closedBy closedByText permanentClosedAt poStatus poApprovalStatus poYearRows.poNumber poYearRows.poFileUrl originalPoDetails serviceSelections.assignedServiceId serviceSelections.serviceAssignmentId serviceSelections.closedAt serviceSelections.closedBy serviceSelections.closedByText serviceSelections.poStatus serviceSelections.poApprovalStatus serviceSelections.poYearRows.poNumber serviceSelections.poYearRows.poFileUrl serviceSelections.originalPoDetails.poNumber assignments.assignedServiceId assignments.serviceAssignmentId assignments.closedAt assignments.closedBy assignments.closedByText assignments.permanentClosedAt assignments.poStatus assignments.poApprovalStatus assignments.poYearRows.poNumber assignments.poYearRows.poFileUrl assignments.poYearRows.poProofUrl assignments.originalPoDetails').lean();
  if (requireStaff) {
    return servicesClientFilter(leads.flatMap(lead => {
      const services = serviceClosureRows(lead);
      return services.filter(({ assignment }) => poClosed(assignment)
        && [assignment.assignedTo, assignment.assignedToText, assignment.assignedToEmail].some(value => String(value || '').trim())
        && [assignment.assignedStaff, assignment.assignedStaffText, assignment.assignedStaffEmail].some(value => String(value || '').trim())
      ).map(({ serviceId }) => ({ lead, serviceId, allowUnscoped: services.length === 1 }));
    }));
  }
  const eligible = leads.filter(lead => serviceClosureSummary(lead).closedCount > 0);
  const ids = eligible.map(lead => lead._id);
  const values = ids.flatMap(value => [value, String(value)]);
  const codes = eligible.map(lead => lead.leadCode).filter(Boolean);
  return { $or: [ { selectedLead: { $in: ids } }, { 'data.selectedLead': { $in: values } }, { 'data.selectedLeadSnapshot.id': { $in: values } }, { 'data.sourceLeadId': { $in: values } }, { 'data.importMeta.leadNumber': { $in: codes } }, { 'data.selectedLeadSnapshot.leadCode': { $in: codes } } ] };
}
module.exports = { closedPoClientFilter };
