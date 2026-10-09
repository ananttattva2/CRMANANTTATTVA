const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOverall } = require('../src/services/overallDashboard');
const { overallRecordsFromLeads } = require('../src/services/overallDashboardData');
const { buildUserSections, eligibleOperationsUsers, buildAllocatedClientCounts, buildAllocatedClientStats } = require('../src/services/overallDashboardUsers');

test('dashboard hides credit, merges annual aliases and puts most used closed services first', () => {
  const row = (clientName, service, isClosed = true) => ({ clientName, financialYear: '2025-26', subApplicantType: 'Producer', isClosed, services: [{ name: service }] });
  const section = buildOverall([row('CCL', 'New Registration'), row('CCL', 'Annual Filling'), row('CCL', 'Annual Return Filling / Annual Filling'), row('20 Micron', 'Annual Return Filling'), row('CCL', 'Credit Procurement'), row('CCL', 'Consulting', false)]).yearSections[0];
  assert.deepEqual(section.services, ['Annual Return Filling', 'New Registration']);
  assert.equal(section.groups[0].services['Annual Return Filling'], 2);
  assert.equal(section.summary.clients, 2);
  assert.equal(section.summary.services, 3);
});

test('user matrix keeps service ownership separate and never includes users outside supplied scope', () => {
  const users = [{ _id: 'krishna', name: 'Krishna', role: 'operation', email: 'k@example.test' }, { _id: 'manager', name: 'Manager', role: 'operation' }];
  const leads = [{ _id: 'lead', company: 'CCL', createdBy: 'manager', serviceSelections: [
    { createdBy: 'krishna', subApplicantType: 'Producer', servicesOffered: 'New Registration' },
    { createdBy: 'outsider', subApplicantType: 'Brand Owner', servicesOffered: 'Consulting' }
  ], assignments: [{ closedAt: 'now', poYearRows: [{ fy: '2025-26', hasPoEvidence: true }] }, { closedAt: 'now', poYearRows: [{ fy: '2025-26', hasPoEvidence: true }] }] }];
  const records = overallRecordsFromLeads(leads);
  const rows = buildUserSections(records, [], users);
  assert.equal(rows.length, 2);
  const krishna = rows[0].yearSections[0];
  assert.equal(krishna.summary.clients, 1);
  assert.deepEqual(krishna.services, ['New Registration']);
  assert.equal(krishna.groups.find((group) => group.type === 'Producer').count, 1);
  assert.equal(krishna.groups.find((group) => group.type === 'Brand Owner').count, 0);
  assert.equal(rows[1].yearSections[0].summary.clients, 0);
});

test('user matrix supports on-behalf legacy owners and prefers stable IDs to identical names', () => {
  const leads = [{ _id: 'lead', company: '20 Micron', createdBy: 'admin', generatedForUser: 'intended', generatedForName: 'Same Name', serviceSelections: [{ subApplicantType: 'Importer', servicesOffered: 'Consulting' }], assignments: [{ closedAt: 'now', poYearRows: [{ fy: '2026-27', hasPoEvidence: true }] }] }];
  const rows = buildUserSections(overallRecordsFromLeads(leads), [], [{ _id: 'intended', name: 'Same Name', role: 'operation' }, { _id: 'other', name: 'Same Name', role: 'operation' }]);
  assert.equal(rows[0].yearSections[1].summary.clients, 1);
  assert.equal(rows[1].yearSections[0].summary.clients, 0);
});

test('overall and user-wise dashboards group records by PO Financial Year instead of service period', () => {
  const leads = [{ _id: 'lead', company: 'Tigi Industries', createdBy: 'owner',
    serviceSelections: [{ subApplicantType: 'Producer', servicesOffered: 'Annual Return Filling' }],
    assignments: [{ closedAt: 'now', poYearRows: [{ fy: '2025-26', poFinancialYear: '2026-27', poNumber: 'AT/26-27/101', hasPoEvidence: true }] }] }];
  const records = overallRecordsFromLeads(leads);
  assert.equal(records[0].financialYear, '2026-27');
  const overall = buildOverall(records);
  assert.equal(overall.yearSections.find((section) => section.year === '2025-26').summary.clients, 0);
  assert.equal(overall.yearSections.find((section) => section.year === '2026-27').summary.clients, 1);
  const users = buildUserSections(records, [], [{ _id: 'owner', name: 'Owner', role: 'operation' }]);
  assert.equal(users[0].yearSections.find((section) => section.year === '2026-27').summary.clients, 1);
});

test('dashboard keeps service-period fallback for legacy PO rows without PO Financial Year', () => {
  const records = overallRecordsFromLeads([{ _id: 'legacy', company: 'Legacy Client', serviceSelections: [{ servicesOffered: 'Consulting' }], assignments: [{ closedAt: 'now', poYearRows: [{ fy: '2025-26', hasPoEvidence: true }] }] }]);
  assert.equal(records[0].financialYear, '2025-26');
});

test('user list contains only operations staff and their direct or team managers', () => {
  const users = [
    { _id: 'op1', name: 'Operation One', role: 'operation', managerId: 'direct' },
    { _id: 'op2', name: 'Operation Two', role: 'operation', teamId: 'ops-team' },
    { _id: 'op3', name: 'Operation Three', role: 'accounts', roles: ['operation'] },
    { _id: 'direct', name: 'Direct Manager', role: 'manager' },
    { _id: 'team-manager', name: 'Team Manager', role: 'manager' },
    { _id: 'sales-manager', name: 'Sales Manager', role: 'manager' },
    { _id: 'sales', name: 'Sales', role: 'operation', roles: ['sales'] },
    { _id: 'super', name: 'Super Admin', role: 'operation', roles: ['super-admin'] },
    { _id: 'himanshu', name: '  HIMANSHU   PARASHAR ', role: 'operation' },
    { _id: 'admin', name: 'Admin', role: 'admin' },
    { _id: 'account', name: 'Accounts', role: 'accounts' }
  ];
  const teams = [{ _id: 'ops-team', manager: 'team-manager', members: [] }, { _id: 'sales-team', manager: 'sales-manager', members: ['sales'] }];
  assert.deepEqual(eligibleOperationsUsers(users, teams).map((user) => user._id), ['op1', 'op2', 'op3', 'direct', 'team-manager']);
  assert.deepEqual(eligibleOperationsUsers(users.slice(0, 3), teams).map((user) => user._id), ['op1', 'op2', 'op3']);
});

test('user matrix exposes total allocated clients using permanent service ownership', () => {
  const users = [{ _id: 'saurabh', name: 'Saurabh Bhat', email: 'saurabh@example.test', role: 'manager' }, { _id: 'tushar', name: 'Tushar Gawas', role: 'operation', managerId: 'saurabh' }];
  const clients = [
    { _id: 'one', assignedServiceId: 'service-a', selectedLead: { serviceSelections: [{ assignedServiceId: 'service-a', firstAnnualReturnYearApplicable: '2026-27' }], assignments: [{ assignedServiceId: 'service-a', assignedStaff: 'saurabh', poYearRows: [{ poNumber: 'PO-1', poFinancialYear: '2026-27' }, { poNumber: 'PO-2', poFinancialYear: '2026-27' }] }, { assignedServiceId: 'service-b', assignedStaff: 'tushar' }] } },
    { _id: 'two', selectedLead: { assignedStaffText: 'Saurabh Bhat', serviceSelections: [{ firstAnnualReturnYearApplicable: '2025-26' }], assignments: [{}] } },
    { _id: 'three', selectedLead: { assignedStaff: 'tushar' }, adminControls: { assignedTo: 'tushar' }, data: { basic: { firstAnnualReturnYear: '2026-27' } } }
  ];
  assert.deepEqual(buildAllocatedClientCounts(clients, users), { saurabh: 2, tushar: 1 });
  assert.deepEqual(buildAllocatedClientStats(clients, users), {
    saurabh: { total: 2, poReceived: 1, poPending: 1, byYear: { '2026-27': 1, '2025-26': 1 }, poReceivedByYear: { '2026-27': 1 } },
    tushar: { total: 1, poReceived: 0, poPending: 1, byYear: { '2026-27': 1 }, poReceivedByYear: {} }
  });
  const rows = buildUserSections([], [], users, [], clients);
  assert.equal(rows.find((row) => row.userId === 'saurabh').allocatedClients, 2);
  assert.equal(rows.find((row) => row.userId === 'saurabh').allocatedClientsByYear['2026-27'], 1);
  assert.equal(rows.find((row) => row.userId === 'saurabh').poReceivedClients, 1);
  assert.equal(rows.find((row) => row.userId === 'saurabh').poPendingClients, 1);
  assert.equal(rows.find((row) => row.userId === 'saurabh').poReceivedClientsByYear['2026-27'], 1);
  assert.equal(rows.find((row) => row.userId === 'tushar').allocatedClients, 1);
});
