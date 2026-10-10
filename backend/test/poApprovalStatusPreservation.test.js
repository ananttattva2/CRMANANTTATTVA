const test = require('node:test');
const assert = require('node:assert/strict');
const { preserveExistingClosureEvidence } = require('../src/controllers/leadController')._test;

test('a stale lead form cannot replace Admin approval with Pending or rejection', () => {
  for (const incoming of ['PENDING', 'REJECTED', '']) {
    const result = preserveExistingClosureEvidence(
      { assignments: [{ assignedServiceId: 'brand', poApprovalStatus: 'APPROVED', closureRequestedBy: 'owner' }] },
      { assignments: [{ assignedServiceId: 'brand', poApprovalStatus: incoming, assignedTo: 'manager' }] }
    );
    assert.equal(result.assignments[0].poApprovalStatus, 'APPROVED');
    assert.equal(result.assignments[0].closureRequestedBy, 'owner');
    assert.equal(result.assignments[0].assignedTo, 'manager');
  }
});

test('an ordinary lead save cannot approve a rejected PO or copy a sibling approval', () => {
  const result = preserveExistingClosureEvidence(
    { assignments: [{ assignedServiceId: 'importer', poApprovalStatus: 'REJECTED' }, { assignedServiceId: 'brand', poApprovalStatus: 'APPROVED' }] },
    { assignments: [{ assignedServiceId: 'brand', poApprovalStatus: 'PENDING' }, { assignedServiceId: 'importer', poApprovalStatus: 'APPROVED' }] }
  );
  assert.equal(result.assignments[0].poApprovalStatus, 'APPROVED');
  assert.equal(result.assignments[1].poApprovalStatus, 'REJECTED');
});
