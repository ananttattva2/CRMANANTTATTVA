const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { closedPoClientFilter } = require('../src/services/clientClosedPoDirectory');

test('the staff-ready directory includes only the closed and staffed service of a multi-service lead', async () => {
  const closed = { poApprovalStatus: 'APPROVED', poStatus: 'received', closedAt: '2026-11-26' };
  const assignment = { assignedTo: 'manager', assignedStaff: 'staff' };
  const lead = { _id: 'lead', leadCode: 'ATPL-001', assignments: [
    { ...closed, ...assignment, assignedServiceId: 'ready' },
    { ...closed, assignedTo: 'manager', assignedServiceId: 'no-staff' },
    { ...assignment, poApprovalStatus: 'FINANCE_PENDING', poStatus: 'received', assignedServiceId: 'open' }
  ] };
  const model = { find: () => ({ select() { return this; }, lean: async () => [lead] }) };
  const filter = await closedPoClientFilter(model, { requireStaff: true });
  assert.equal(filter.$or.length, 1);
  const serviceBranches = filter.$or[0].$and[1].$or;
  assert.equal(serviceBranches.length, 3);
  assert.deepEqual(serviceBranches[0], { assignedServiceId: 'ready' });
});

test('Client Master and both Approval Center client paths share the directory eligibility rule', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/controllers/clientController.js'), 'utf8');
  const directory = fs.readFileSync(path.resolve(__dirname, '../src/services/clientDirectoryEligibility.js'), 'utf8');
  assert.equal(source.split("require('../services/clientDirectoryEligibility').clientDirectoryEligibilityFilter()").length - 1, 3);
  assert.match(directory, /closedPoClientFilter\(undefined, \{ requireStaff: true \}\)/);
});
