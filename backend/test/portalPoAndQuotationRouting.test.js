const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../src/models/User');
const { requiredServiceOwners, quotationServiceRecipients } = require('../src/services/quotationServiceRecipients');
const { specialClosureRows } = require('../src/services/specialClosureFinance');
test('quotation routing copies Tushar for Plastic Waste, Suraj for Solid Waste, and Kshitij for separate CTO/CTE services', async () => {
  assert.deepEqual(requiredServiceOwners({ items: [{ servicesOffered: 'CTO/CCA Renewal and Amendment' }] }), ['KSHITIJ TRIMUKHE']);
  assert.deepEqual(requiredServiceOwners({ items: [{ servicesOffered: 'CTE' }] }), ['KSHITIJ TRIMUKHE']);
  assert.deepEqual(requiredServiceOwners({ items: [{ serviceCategory: 'Solid Waste Management' }, { servicesOffered: 'CTO' }] }), ['KSHITIJ TRIMUKHE', 'Suraj Shetty']);
  assert.deepEqual(requiredServiceOwners({ items: [{ servicesOffered: 'Annual Return Filling' }] }), []);
  const original = User.find;
  User.find = filter => { assert.ok(!filter.name.$in.some(regex => regex.test(' Kshitij Trimukhe '))); assert.ok(filter.name.$in.some(regex => regex.test('SURAJ SHETTY'))); return { select() { return this; }, lean: async () => [{ email: 'suraj@example.test' }, { email: 'SURAJ@example.test' }] }; };
  try { assert.deepEqual(await quotationServiceRecipients({ items: [{ serviceCategory: 'Solid Waste Management' }] }), ['suraj@example.test']); } finally { User.find = original; }
});
test('special-approval closures without POs appear in Finance without manufacturing a Finance decision', () => {
  const lead = { _id: 'lead1', company: 'JAINEEKET ENTERPRISE', leadCode: 'ATPL-LEAD-0077', serviceSelections: [{ assignedServiceId: 's1', servicesOffered: 'CTO' }, { assignedServiceId: 's2', servicesOffered: 'CTE' }], assignments: [{ assignedServiceId: 's1', poStatus: 'provisional', closedBy: 'u1', closureApprovalProofUrl: 'https://files.test/approval.pdf' }, { assignedServiceId: 's2', poStatus: 'received', closedBy: 'u1' }] };
  const rows = specialClosureRows([lead]); assert.equal(rows.length, 1); assert.equal(rows[0].clientName, lead.company); assert.equal(rows[0].approvalSource, 'Special Approval'); assert.equal(rows[0].poReview.stage, 'PO_AWAITED'); assert.equal(rows[0].payload.assignedServiceId, 's1');
  const existing = [{ _id: 'existing', payload: { leadId: 'lead1', assignedServiceId: 's1' } }]; assert.deepEqual(specialClosureRows([lead], existing), []); assert.equal(existing[0].approvalSource, 'Special Approval');
});

test('Plastic Waste matching tolerates case, dash variants and repeated quotation items',()=>{
 for(const category of ['EPR - PLASTIC WASTE','EPR – Plastic Waste','epr_plastic_waste'])assert.deepEqual(requiredServiceOwners({items:[{businessCategory:'EPR Consultancy',serviceCategory:category},{eprCategory:category}]}),['TUSHAR GAWAS']);
 assert.deepEqual(requiredServiceOwners({items:[{serviceCategory:'Solid Waste Management',servicesOffered:'CTO support',eprCategory:'EPR - Plastic Waste'}]}),['Suraj Shetty']);
 assert.deepEqual(requiredServiceOwners({items:[{serviceCategory:'EPR - E-Waste'}]}),[]);
});
