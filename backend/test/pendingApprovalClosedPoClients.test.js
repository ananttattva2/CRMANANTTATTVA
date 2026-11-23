const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { __test } = require('../src/controllers/clientController');

test('Compliance reviewers see the review queue independently of client ownership', async () => {
  const { clientApprovalAccessFilter } = require('../src/controllers/clientController');
  for (const user of [{ role: 'compliance' }, { role: 'operation', roles: ['Compliance Consultant'] }, { role: 'superadmin' }]) {
    assert.deepEqual(await clientApprovalAccessFilter(user), {});
  }
});

test('ordinary users retain their client ownership and assignment filters', async t => {
  const Lead = require('../src/models/Lead');
  t.mock.method(Lead, 'find', () => ({ select() { return this; }, lean: async () => [] }));
  const { clientApprovalAccessFilter } = require('../src/controllers/clientController');
  const filter = await clientApprovalAccessFilter({ _id: '507f1f77bcf86cd799439011', role: 'operation', name: 'Worker', email: 'worker@example.test' });
  assert.ok(filter.$or.length > 0);
  assert.match(JSON.stringify(filter), /507f1f77bcf86cd799439011/);
});

test('Approval Center reconciles only closed-PO clients and removes stale indexed clients', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/controllers/clientController.js'), 'utf8');
  const start = source.indexOf('exports.listPendingApprovals =');
  const end = source.indexOf('\nexports.', start + 1);
  const staffOneId = '507f1f77bcf86cd799439001';
  const staffTwoId = '507f1f77bcf86cd799439002';
  const assignedLead = {
    assignments: [
      { assignedServiceId: 'service-1', assignedStaff: staffOneId, assignedStaffText: 'Shubham Desai' },
      { assignedServiceId: 'service-2', assignedStaff: staffTwoId, assignedStaffText: 'Another Staff Member' }
    ],
    serviceSelections: [
      { assignedServiceId: 'service-1', servicesOffered: 'New Registration' },
      { assignedServiceId: 'service-2', servicesOffered: 'Annual Return' }
    ]
  };
  const eligible = Array.from({ length: 247 }, (_, i) => ({
    _id: `closed-${i}`,
    clientName: `Client ${i}`,
    createdBy: {},
    ...(i < 2 ? {
      assignedServiceId: `service-${i + 1}`,
      selectedLead: assignedLead,
      data: { basic: {} }
    } : {})
  }));
  const stale = Array.from({ length: 54 }, (_, i) => ({ id: `open-${i}`, approvalStatus: 'PENDING' }));
  const closedPoFilter = { selectedLead: { $in: ['closed-lead'] } };
  let observedFilter;
  let observedStaffIds = [];
  const context = {
    exports: {}, Date, console,
    mongoose: { isValidObjectId: value => /^[a-f\d]{24}$/i.test(String(value)) },
    userHasAnyRole: () => true,
    normalizeApprovalStatus: value => {
      const status = String(value || '').trim().toUpperCase();
      return ['PENDING', 'PARTIALLY_APPROVED', 'APPROVED', 'REJECTED'].includes(status) ? status : '';
    },
    readStoredPendingApprovals: async () => ({ pendingClients: [...eligible.map(row => ({ id: row._id, approvalStatus: 'APPROVED', serviceOffered: '-', assignedStaff: '-' })), ...stale], pendingQuotations: [] }),
    clientAccessFilter: async () => ({ assignedUser: 'reviewer' }),
    clientApprovalAccessFilter: async () => ({}),
    clientMasterSourceRecordFilter: () => ({ sourceRecord: true }),
    combineAccessFilters: (...filters) => ({ $and: filters }),
    require: (name) => {
      assert.equal(name, '../services/clientClosedPoDirectory');
      return { closedPoClientFilter: async () => closedPoFilter };
    },
    Client: { find(filter) {
      observedFilter = filter;
      return { select() { return this; }, populate() { return this; }, sort() { return this; },
        lean: async () => filter.$and.includes(closedPoFilter) ? eligible : [...eligible, ...stale.map(row => ({ _id: row.id, createdBy: {} }))] };
    } },
    User: { find(filter) {
      observedStaffIds = filter._id.$in;
      return { select() { return this; }, lean: async () => [
        { _id: staffOneId, name: 'Shubham Desai' },
        { _id: staffTwoId, name: 'Another Staff Member' }
      ] };
    } },
    Quotation: { find() { return { select() { return this; }, maxTimeMS() { return this; }, populate() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => [] }; } },
    mapClientPendingApprovalRow: row => ({ id: row._id, assignedServiceId: row.assignedServiceId, clientName: row.clientName, approvalStatus: 'PENDING', serviceOffered: '-', assignedStaff: '-' }),
    pendingClientAssignment: __test.pendingClientAssignment,
    pendingClientDisplayContext: __test.pendingClientDisplayContext,
    mergePendingClients: __test.mergePendingClients,
  };
  vm.runInNewContext(source.slice(start, end), context);
  let response;
  await context.exports.listPendingApprovals({ user: { role: 'admin' }, query: { listOnly: 'true', compact: 'true' } }, { json: value => { response = value; } });
  assert.ok(observedFilter.$and.includes(closedPoFilter));
  assert.ok(!observedFilter.$and.some(filter => filter.assignedUser === 'reviewer'));
  assert.equal(response.pendingClients.length, 247);
  assert.ok(response.pendingClients.every(row => row.id.startsWith('closed-')));
  assert.equal(response.pendingClients[0].approvalStatus, 'APPROVED');
  assert.equal(Array.from(observedStaffIds).sort().join(','), [staffOneId, staffTwoId].sort().join(','));
  assert.equal(response.pendingClients[0].serviceOffered, 'New Registration');
  assert.equal(response.pendingClients[0].assignedStaff, 'Shubham Desai');
  assert.equal(response.pendingClients[1].serviceOffered, 'Annual Return');
  assert.equal(response.pendingClients[1].assignedStaff, 'Another Staff Member');
});
