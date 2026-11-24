const { createHash } = require('node:crypto');
const { buildServiceHistory } = require('./annualReturnPoResolver');
const { provisionalState } = require('./provisionalFreeze');
const text = value => String(value || '').trim();
function serviceWorkspaces(lead = {}) {
  const services = lead.serviceSelections?.length ? lead.serviceSelections : [lead];
  const roles = [...new Set([...services, ...(lead.assignments || [])].map(row => text(row.subApplicantType || row.piboCategory || row.applicantType)).filter(Boolean))];
  const history = roles.flatMap(role => buildServiceHistory(lead, { data: { basic: { piboCategory: role } } }));
  (lead.assignments || []).forEach((assignment, index) => {
    if (assignment.poStatus !== 'provisional') return;
    const assignedServiceId = text(assignment.assignedServiceId || assignment.serviceAssignmentId);
    if (history.some(row => row.assignedServiceId === assignedServiceId)) return;
    const service = services.find(row => assignedServiceId && text(row.assignedServiceId || row.serviceAssignmentId) === assignedServiceId) || services[index] || {};
    const applicantType = text(service.subApplicantType || service.piboCategory || assignment.subApplicantType || service.applicantType);
    const offered = Array.isArray(service.servicesOffered) ? service.servicesOffered : [service.servicesOffered || assignment.servicesOffered || 'Service'];
    for (const name of offered) history.push({ assignedServiceId, applicantType, service: text(name), annual: /annual.*return/i.test(text(name)), annualYear: service.firstAnnualReturnYearApplicable || '', poYear: '', number: '', fileUrl: '', fileName: '' });
  });
  return history.map(row => {
    const context = { assignedServiceId: row.assignedServiceId, applicantType: row.applicantType, servicesOffered: row.service, annualReturnYear: row.annual ? row.annualYear : '', registrationYear: row.registrationYear || '', poYear: row.poYear || '', poNumber: row.number || '' };
    const serviceKey = createHash('sha256').update(JSON.stringify([text(lead._id), ...Object.values(context)])).digest('hex');
    const assignment = (lead.assignments || []).find(item => context.assignedServiceId && text(item.assignedServiceId || item.serviceAssignmentId) === context.assignedServiceId) || ((lead.assignments || []).length === 1 ? lead.assignments[0] : {});
    const state = provisionalState(assignment);
    return { ...context, frozen: state.frozen, freezeMessage: state.message, poDeadline: state.deadline, serviceKey, fileUrl: row.fileUrl, fileName: row.fileName };
  }).filter((row, index, all) => all.findIndex(other => other.serviceKey === row.serviceKey) === index);
}
module.exports = { serviceWorkspaces };
