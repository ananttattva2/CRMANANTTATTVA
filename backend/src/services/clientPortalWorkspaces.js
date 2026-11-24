const { createHash } = require('node:crypto');
const { buildServiceHistory } = require('./annualReturnPoResolver');
const text = value => String(value || '').trim();
function serviceWorkspaces(lead = {}) {
  const services = lead.serviceSelections?.length ? lead.serviceSelections : [lead];
  const roles = [...new Set([...services, ...(lead.assignments || [])].map(row => text(row.subApplicantType || row.piboCategory || row.applicantType)).filter(Boolean))];
  return roles.flatMap(role => buildServiceHistory(lead, { data: { basic: { piboCategory: role } } })).map(row => {
    const context = { assignedServiceId: row.assignedServiceId, applicantType: row.applicantType, servicesOffered: row.service, annualReturnYear: row.annual ? row.annualYear : '', registrationYear: row.registrationYear || '', poYear: row.poYear || '', poNumber: row.number || '' };
    const serviceKey = createHash('sha256').update(JSON.stringify([text(lead._id), ...Object.values(context)])).digest('hex');
    return { ...context, serviceKey, fileUrl: row.fileUrl, fileName: row.fileName };
  }).filter((row, index, all) => all.findIndex(other => other.serviceKey === row.serviceKey) === index);
}
module.exports = { serviceWorkspaces };
