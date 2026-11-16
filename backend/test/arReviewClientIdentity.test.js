const { test } = require('node:test');
const assert = require('node:assert/strict');
const User = require('../src/models/User');
const { reviewClientIdentity, attachReviewClientIdentity } = require('../src/services/arReviewClientIdentity');
const producer = '507f1f77bcf86cd799439011', importer = '507f1f77bcf86cd799439012';
const lead = { serviceSelections: [{ assignedServiceId: 'producer', subApplicantType: 'Producer' }, { assignedServiceId: 'importer', subApplicantType: 'Importer' }], assignments: [{ assignedServiceId: 'importer', assignedStaff: importer }, { assignedServiceId: 'producer', assignedStaff: producer }] };
test('AR client identity keeps each applicant and assigned user together across reordered sibling assignments', () => {
  const users = new Map([[producer, 'Producer User'], [importer, 'Importer User']]);
  assert.deepEqual(reviewClientIdentity({ assignedServiceId: 'producer', selectedLead: lead }, users), { assignedUserName: 'Producer User', applicantType: 'Producer' });
  assert.deepEqual(reviewClientIdentity({ assignedServiceId: 'importer', selectedLead: lead }, users), { assignedUserName: 'Importer User', applicantType: 'Importer' });
  assert.deepEqual(reviewClientIdentity({ assignedServiceId: 'old-id', selectedLead: lead, data: { basic: { piboCategory: 'Importer' } } }, users), { assignedUserName: 'Importer User', applicantType: 'Importer' });
});
test('AR list resolves assigned user names in one batch', async t => {
  let calls = 0;
  t.mock.method(User, 'find', filter => { calls++; assert.deepEqual(new Set(filter._id.$in), new Set([producer, importer])); return { select() { return this; }, lean: async () => [{ _id: producer, name: 'Producer User' }, { _id: importer, name: 'Importer User' }] }; });
  const clients = ['producer','importer'].map(assignedServiceId => ({ assignedServiceId, selectedLead: lead }));
  await attachReviewClientIdentity(clients);
  assert.equal(calls, 1);
  assert.equal(clients[1].reviewIdentity.assignedUserName, 'Importer User');
});
test('legacy snapshots preserve applicant labels and do not display missing user IDs as names', () => {
  assert.deepEqual(reviewClientIdentity({ data: { basic: { piboCategory: 'Brand Owner' }, selectedLeadSnapshot: { assignedStaffText: 'Legacy User' } } }), { assignedUserName: 'Legacy User', applicantType: 'Brand Owner' });
  assert.equal(reviewClientIdentity({ selectedLead: { assignedStaff: producer } }).assignedUserName, 'Unassigned');
});
