const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDashboardAssignments } = require('../src/services/dashboardReadModel');
const { directoryProjection } = require('../src/services/leadDirectoryReadModel');

test('batched dashboard reads preserve permanent and legacy eligibility without per-client lookups', async () => {
  const clients = [
    { _id: 'linked-staff', selectedLead: 'staff' },
    { _id: 'own-staff', selectedLead: 'unassigned', assignedStaffText: 'Operator' },
    { _id: 'legacy-snapshot', data: { selectedLeadSnapshot: { assignments: [{ closedByText: 'Operator' }] } } },
    { _id: 'unallocated', selectedLead: 'unassigned' }
  ];
  const permanent = [{ _id: 'staff', assignments: [{ assignedStaffText: 'Operator' }] }];
  let clientPipeline, leadCalls = 0;
  const result = await loadDashboardAssignments({
    Client: { aggregate(pipeline) { clientPipeline = pipeline; return { option: async () => clients }; } },
    Lead: { aggregate() { leadCalls++; return { option: async () => leadCalls === 1 ? permanent : [{ _id: 'unassigned', assignments: [] }] }; } }
  }, { scoped: true }, { scoped: true });
  assert.deepEqual(result.clients.map(row => row._id), ['linked-staff', 'own-staff', 'legacy-snapshot']);
  assert.equal(result.clients[0].selectedLead._id, 'staff');
  assert.equal(leadCalls, 2);
  assert.ok(!clientPipeline.some(stage => stage.$lookup));
  assert.deepEqual(clientPipeline[0].$match, { scoped: true });
});

test('directory projection retains PO closure evidence, amounts and owners without downloading proofs or quotation items', () => {
  const projection = directoryProjection('leadCode company createdBy assignments serviceSelections');
  const assignment = projection.assignments.$map.in;
  const po = assignment.poYearRows.$map.in;
  assert.equal(assignment.closedAt, '$$assignment.closedAt');
  assert.equal(assignment.assignedStaff, '$$assignment.assignedStaff');
  assert.equal(po.poAmount, '$$po.poAmount');
  assert.equal(po.poNumber, '$$po.poNumber');
  assert.equal(po.poFileUrl.$cond[1], 'proof-present');
  assert.ok(!po.quotationItems);
  assert.ok(!po.poFileSize);
  assert.equal(projection.serviceSelections.$map.in.servicesOffered, '$$service.servicesOffered');
  assert.equal(projection.company, 1);
});
