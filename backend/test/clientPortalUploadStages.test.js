const test = require('node:test');
const assert = require('node:assert/strict');
const { describeWorkflow } = require('../src/services/clientPortalUploadStages');
test('submission stages read saved progress and make rejected reviews explicit', () => {
  const record = { financialYear: '2025-26', checklist: [{ particular: 'Data Explained', yesNo: 'Yes' }, { particular: 'Data Format Sent', yesNo: 'Yes' }, { particular: 'Received from client', yesNo: 'Yes', partialDataReceived: true }], managerVerificationStatus: 'Not Submitted' };
  let workflow = describeWorkflow(record, 'purchase', { _id: 'client1', data: { basic: { plantUnit: 'Plant A' } } });
  assert.equal(workflow.currentStage, 'Received from client'); assert.equal(workflow.completed, 2); assert.equal(workflow.stages[2].state, 'progress'); assert.equal(workflow.financialYear, '2025-26'); assert.equal(workflow.unit, 'Plant A');
  workflow = describeWorkflow({ ...record, managerVerificationStatus: 'Rejected' }, 'purchase', { _id: 'client1' });
  assert.match(workflow.currentStage, /Manager review: changes requested/);
  workflow = describeWorkflow({ ...record, complianceVerificationStatus: 'Approved' }, 'sales', { _id: 'client1' });
  assert.equal(workflow.currentStage, 'Completed');
});
test('workflow enrichment matches the submission Applicant Type and keeps financial years separate', async () => {
  const Client = require('../src/models/Client');
  const Purchase = require('../src/models/PurchaseData');
  const Sales = require('../src/models/SalesData');
  const { uploadWorkflows } = require('../src/services/clientPortalUploadStages');
  const original = { client: Client.find, purchase: Purchase.find, sales: Sales.find };
  Client.find = () => ({ select: () => ({ lean: async () => [{ _id: 'c-importer', selectedLead: 'lead1', assignedServiceId: 's1' }, { _id: 'c-producer', selectedLead: 'lead1', assignedServiceId: 's2' }] }) });
  const records = [{ clientId: 'c-importer', financialYear: '2025-26', managerVerificationStatus: 'Pending' }, { clientId: 'c-importer', financialYear: '2026-27', complianceVerificationStatus: 'Approved' }, { clientId: 'c-producer', financialYear: '2026-27', managerVerificationStatus: 'Rejected' }];
  Purchase.find = () => ({ select: () => ({ sort: () => ({ lean: async () => records }) }) });
  Sales.find = () => ({ select: () => ({ sort: () => ({ lean: async () => [] }) }) });
  try {
    const result = await uploadWorkflows([{ _id: 'u1', lead: 'lead1', applicantType: 'Importer' }, { _id: 'u2', lead: 'lead1', applicantType: 'Recycler' }], [{ _id: 'lead1', serviceSelections: [{ assignedServiceId: 's1', subApplicantType: 'Importer' }, { assignedServiceId: 's2', subApplicantType: 'Producer' }] }]);
    assert.deepEqual(result.get('u1').map(row => row.financialYear), ['2025-26','2026-27']);
    assert.ok(result.get('u1').every(row => row.clientId === 'c-importer'));
    assert.deepEqual(result.get('u2'), []);
  } finally { Client.find = original.client; Purchase.find = original.purchase; Sales.find = original.sales; }
});
