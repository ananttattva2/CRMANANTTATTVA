const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUploadTracker } = require('../src/services/clientUploadTracker');
const user = { _id: 'tushar', name: 'TUSHAR GAWAS', role: 'operation' };
const client = { _id: 'atul-brand', assignedServiceId: 'brand-service', workflowStatus: 'submitted', selectedLead: { _id: 'atul-lead', company: 'ATUL LTD', serviceSelections: [{ assignedServiceId: 'brand-service', subApplicantType: 'Brand Owner', servicesOffered: 'Annual Return Filling', plantUnit: 'Unit 1' }], assignments: [{ assignedServiceId: 'brand-service', assignedStaff: 'tushar', assignedStaffText: 'TUSHAR GAWAS', assignedTo: 'tushar', closedAt: '2026-01-01', poStatus: 'received', poYearRows: [{ poFinancialYear: '2025-26', annualReturnYear: '2025-26', poNumber: 'PO1' }] }] }, data: { basic: { piboCategory: 'Brand Owner' }, importMeta: { assignedTo: 'NITIN NAWAR' } } };
test('ATUL saved 2025-26 progress stays under Tushar despite current-year eligibility and Nitin import metadata', () => {
  const purchase = { clientId: 'atul-brand', financialYear: '2025-26', checklist: ['Data Explained','Data Format Sent','Received from client','Ready to upload'].map(particular => ({ particular, yesNo: 'Yes' })) };
  const result = buildUploadTracker([client], [user, { _id: 'nitin', name: 'NITIN NAWAR', role: 'admin' }], [purchase], [], { groupBy: 'application', serviceType: 'annual', financialYear: '2025-26' });
  const group = result.find(row => row.userId === 'tushar');
  assert.equal(group.clients.length, 1); assert.equal(group.clients[0].clientName, 'ATUL LTD');
  assert.deepEqual(group.purchase.slice(0,4).map(stage => stage.complete), [1,1,1,1]);
  assert.equal(group.purchase[5].complete, 0); assert.equal(group.purchase[6].complete, 0); assert.equal(group.sales[0].complete, 0);
  assert.ok(!result.some(row => row.userId === 'nitin'));
});
test('empty auto-created records and other-year progress do not bypass annual eligibility', () => {
  for (const purchase of [{ clientId: 'atul-brand', financialYear: '2025-26', checklist: [] }, { clientId: 'atul-brand', financialYear: '2026-27', checklist: [{ particular: 'Data Explained', yesNo: 'Yes' }] }]) {
    const result = buildUploadTracker([client], [user], [purchase], [], { groupBy: 'application', serviceType: 'annual', financialYear: '2025-26' });
    assert.equal(result.reduce((count, row) => count + row.clients.length, 0), 0);
  }
});
