const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUploadTracker } = require('../src/services/clientUploadTracker');
const user = { _id: 'tushar', name: 'TUSHAR GAWAS', role: 'operation' };
const client = { _id: 'atul-brand', assignedServiceId: 'brand-service', workflowStatus: 'submitted', selectedLead: { _id: 'atul-lead', company: 'ATUL LTD', serviceSelections: [{ assignedServiceId: 'brand-service', subApplicantType: 'Brand Owner', servicesOffered: 'Annual Return Filling', plantUnit: 'Unit 1' }], assignments: [{ assignedServiceId: 'brand-service', assignedStaff: 'tushar', assignedStaffText: 'TUSHAR GAWAS', assignedTo: 'tushar', closedAt: '2026-01-01', poStatus: 'received', poYearRows: [{ poFinancialYear: '2026-27', annualReturnYear: '2025-26', poNumber: 'PO1' }] }] }, data: { basic: { piboCategory: 'Brand Owner' }, cpcb: { status: 'Approved' }, importMeta: { assignedTo: 'NITIN NAWAR' } } };
test('ATUL saved 2025-26 progress stays under Tushar despite current-year eligibility and Nitin import metadata', () => {
  const purchase = { clientId: 'atul-brand', financialYear: '2025-26', checklist: ['Data Explained','Data Format Sent','Received from client','Ready to upload'].map(particular => ({ particular, yesNo: 'Yes' })) };
  const result = buildUploadTracker([client], [user, { _id: 'nitin', name: 'NITIN NAWAR', role: 'admin' }], [purchase], [], { groupBy: 'application', serviceType: 'annual', financialYear: '2025-26' });
  const group = result.find(row => row.userId === 'tushar');
  assert.equal(group.clients.length, 1); assert.equal(group.clients[0].clientName, 'ATUL LTD');
  assert.deepEqual(group.purchase.slice(0,4).map(stage => stage.complete), [1,1,1,1]);
  assert.equal(group.purchase[5].complete, 0); assert.equal(group.purchase[6].complete, 0); assert.equal(group.sales[0].complete, 0);
  assert.ok(!result.some(row => row.userId === 'nitin'));
});
test('ATUL selected-year PO allocation appears under Tushar before upload progress begins', () => {
  const purchase = { clientId: 'atul-brand', financialYear: '2025-26', checklist: [] };
  const result = buildUploadTracker([client], [user], [purchase], [], { groupBy: 'application', serviceType: 'annual', financialYear: '2025-26' });
  const group = result.find(row => row.userId === 'tushar');
  assert.equal(group.clients.length, 1);
  assert.equal(group.clients[0].clientName, 'ATUL LTD');
  assert.equal(group.clients[0].purchase[0], 'pending');
});
test('progress saved only for another financial year does not bypass selected-year eligibility', () => {
  const otherYearClient = structuredClone(client);
  otherYearClient.selectedLead.assignments[0].poYearRows[0].poFinancialYear = '2026-27';
  otherYearClient.selectedLead.assignments[0].poYearRows[0].annualReturnYear = '2026-27';
  const purchase = { clientId: 'atul-brand', financialYear: '2026-27', checklist: [{ particular: 'Data Explained', yesNo: 'Yes' }] };
  const result = buildUploadTracker([otherYearClient], [user], [purchase], [], { groupBy: 'application', serviceType: 'annual', financialYear: '2025-26' });
  assert.equal(result.reduce((count, row) => count + row.clients.length, 0), 0);
});
