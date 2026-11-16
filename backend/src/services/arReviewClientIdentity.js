const User = require('../models/User');
const id = value => String(value?._id || value || '').trim();
function reviewClientIdentity(client = {}, users = new Map()) {
  const data = client.data || {}, basic = data.basic || {};
  const lead = client.selectedLead && typeof client.selectedLead === 'object' ? client.selectedLead : data.selectedLeadSnapshot || {};
  const serviceId = id(client.assignedServiceId || data.assignedServiceId || data.selectedLeadSnapshot?.assignedServiceId);
  const services = lead.serviceSelections || [];
  let index = services.findIndex(service => serviceId && id(service.assignedServiceId || service.serviceAssignmentId) === serviceId);
  if (index < 0) {
    const applicant = String(basic.subApplicantType || basic.piboCategory || data.selectedLeadSnapshot?.subApplicantType || data.selectedLeadSnapshot?.piboCategory || '').trim().toLowerCase();
    const matches = services.map((service, i) => ({ service, i })).filter(({ service }) => applicant && String(service.subApplicantType || service.piboCategory || service.applicantType || '').trim().toLowerCase() === applicant);
    if (matches.length === 1) index = matches[0].i;
  }
  if (index < 0 && services.length === 1) index = 0;
  const service = services[index] || {};
  const assignedServiceId = id(service.assignedServiceId || service.serviceAssignmentId) || serviceId;
  const assignments = lead.assignments || [];
  const assignment = assignments.find(row => assignedServiceId && id(row.assignedServiceId || row.serviceAssignmentId) === assignedServiceId)
    || (index >= 0 && !assignments[index]?.assignedServiceId ? assignments[index] : null)
    || (assignments.length === 1 && !serviceId ? assignments[0] : null) || {};
  const name = (value, text, email) => users.get(id(value)) || value?.name || value?.email || text || email || (typeof value === 'string' && !/^[a-f0-9]{24}$/i.test(value) ? value : '');
  return {
    assignedUserName: name(assignment.assignedStaff, assignment.assignedStaffText, assignment.assignedStaffEmail)
      || name(lead.assignedStaff, lead.assignedStaffText, lead.assignedStaffEmail)
      || name(client.adminControls?.assignedTo)
      || name(data.importMeta?.assignedTo, data.importMeta?.userName)
      || 'Unassigned',
    applicantType: service.subApplicantType || service.piboCategory || basic.subApplicantType || basic.piboCategory
      || data.selectedLeadSnapshot?.subApplicantType || data.selectedLeadSnapshot?.piboCategory || service.applicantType || lead.subApplicantType || lead.piboCategory || 'Not recorded'
  };
}
async function attachReviewClientIdentity(clients) {
  const ids = [...new Set(clients.flatMap(client => {
    const lead = client.selectedLead || {};
    return [lead.assignedStaff, client.adminControls?.assignedTo, client.data?.importMeta?.assignedTo, ...(lead.assignments || []).map(row => row.assignedStaff)].map(id);
  }).filter(value => /^[a-f0-9]{24}$/i.test(value)))];
  const rows = ids.length ? await User.find({ _id: { $in: ids } }).select('name email').lean() : [];
  const users = new Map(rows.map(user => [id(user), user.name || user.email]));
  clients.forEach(client => { client.reviewIdentity = reviewClientIdentity(client, users); });
}
module.exports = { reviewClientIdentity, attachReviewClientIdentity };
