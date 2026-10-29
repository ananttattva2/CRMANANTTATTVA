const Client = require('../models/Client');
const Purchase = require('../models/PurchaseData');
const Sales = require('../models/SalesData');
const { STAGES, stageState, applicationDescriptor } = require('./clientUploadTracker');
const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function describeWorkflow(record, module, client) {
  const stages = STAGES.map(label => ({ label, state: stageState(record, label) }));
  const label = record.complianceVerificationStatus === 'Approved' ? 'Completed'
    : record.complianceVerificationStatus === 'Rejected' ? 'Compliance review: changes requested'
    : record.managerVerificationStatus === 'Rejected' ? 'Manager review: changes requested'
    : record.complianceVerificationStatus === 'Pending' || record.managerVerificationStatus === 'Approved' ? 'Compliance Review'
    : record.managerVerificationStatus === 'Pending' ? 'Manager Review'
    : stages.find(stage => stage.state !== 'complete')?.label || 'Completed';
  return { clientId: String(client._id), unit: client.data?.basic?.plantUnit || '', module, financialYear: record.financialYear, currentStage: label, stages, updatedAt: record.updatedAt, completed: stages.filter(stage => stage.state === 'complete').length, total: stages.length };
}
async function uploadWorkflows(rows, leads) {
  if (!rows.length) return new Map();
  const leadMap = new Map(leads.map(lead => [String(lead._id), lead]));
  const clients = await Client.find({ selectedLead: { $in: [...new Set(rows.map(row => String(row.lead)))] } }).select('selectedLead assignedServiceId data.basic data.selectedLeadSnapshot').lean();
  if (!clients.length) return new Map();
  const filter = { clientId: { $in: clients.map(client => client._id) } };
  const projection = 'clientId financialYear checklist baseUpload.importStatus portalUpload.importStatus managerVerificationStatus complianceVerificationStatus updatedAt';
  const [purchase, sales] = await Promise.all([Purchase.find(filter).select(projection).sort({ updatedAt: -1 }).lean(), Sales.find(filter).select(projection).sort({ updatedAt: -1 }).lean()]);
  const result = new Map();
  for (const row of rows) {
    const matches = clients.filter(client => String(client.selectedLead) === String(row.lead) && normalize(applicationDescriptor({ ...client, selectedLead: leadMap.get(String(row.lead)) }).category) === normalize(row.applicantType));
    const workflows = matches.flatMap(client => ['purchase','sales'].flatMap(module => (module === 'purchase' ? purchase : sales).filter(record => String(record.clientId) === String(client._id)).map(record => describeWorkflow(record, module, client))));
    result.set(String(row._id), workflows);
  }
  return result;
}
module.exports = { describeWorkflow, uploadWorkflows };
