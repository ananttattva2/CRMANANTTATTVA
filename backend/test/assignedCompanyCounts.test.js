const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUploadTracker } = require('../src/services/clientUploadTracker');
const { buildAllocatedClientStats, buildUserSections } = require('../src/services/overallDashboardUsers');
const { overallRecordsFromLeads } = require('../src/services/overallDashboardData');
const { assignedCompanyKey } = require('../src/services/assignedCompanyIdentity');
const users = [{ _id: 'sonal', name: 'Sonal', role: 'operation' }, { _id: 'krishna', name: 'Krishna', role: 'operation' }];
const client = (id, name, owner, year = '2025-26') => ({ _id: id, data: { basic: { clientLegalName: name } },
  selectedLead: { assignedStaff: owner, assignments: [{ assignedStaff: owner, poYearRows: [{ poNumber: id, poFinancialYear: year }] }] } });

test('assignment counts and client labels prefer the linked lead company over an incorrect Client Master contact name', async () => {
  const a = client('a', 'Contact person', 'sonal');
  const b = client('b', 'Contact person', 'sonal');
  a.selectedLead.company = 'UMIYA PLASTIC';
  b.selectedLead.company = 'KALYANI SALES CORPORATION';
  const tracker = buildUploadTracker([a, b], users, [], []);
  assert.equal(tracker[0].clients.length, 2);
  assert.deepEqual(new Set(tracker[0].clients.map(row => row.clientName)), new Set(['UMIYA PLASTIC', 'KALYANI SALES CORPORATION']));
  assert.equal(buildAllocatedClientStats([a, b], users).sonal.total, 2);
  const { assignedCompanyKey: frontendKey } = await import('../../frontend/src/utils/operationsUserProgress.mjs');
  assert.equal(frontendKey(a), assignedCompanyKey(a));
  assert.notEqual(frontendKey(a), frontendKey(b));
});

test('tracker merges same-user applicant types and retains every source ID for authorization and progress', () => {
  const clients = [client('importer', 'AMINES AND PLASTICIZERS LTD', 'sonal'), client('producer', 'Amines and Plasticizers Ltd.', 'sonal'), client('other', 'AMINES AND PLASTICIZERS LTD', 'krishna')];
  const record = clientId => ({ clientId, checklist: [{ particular: 'Data Explained', yesNo: 'Yes' }] });
  const groups = buildUploadTracker(clients, users, [record('importer'), record('other')], []);
  const sonal = groups.find(group => group.userId === 'sonal');
  assert.equal(sonal.clients.length, 1);
  assert.deepEqual(sonal.clients[0].clientIds, ['importer', 'producer']);
  assert.equal(sonal.clients[0].purchase[0], 'progress');
  assert.equal(sonal.purchase[0].progress, 1);
  assert.equal(groups.find(group => group.userId === 'krishna').purchase[0].complete, 1);
  const completed = buildUploadTracker(clients, users, [record('importer'), record('producer')], []).find(group => group.userId === 'sonal');
  assert.equal(completed.purchase[0].complete, 1);
});

test('allocated overall and FY counts deduplicate per user, while separate companies remain separate', () => {
  const stats = buildAllocatedClientStats([client('a', '20 MICRONS LIMITED', 'sonal'), client('b', '20 Microns Limited', 'sonal', '2026-27'), client('c', '20 MICRONS NANO MINERALS LIMITED', 'sonal'), client('d', '20 MICRONS LIMITED', 'krishna')], users);
  assert.equal(stats.sonal.total, 2);
  assert.equal(stats.sonal.poReceived, 2);
  assert.equal(stats.sonal.byYear['2025-26'], 2);
  assert.equal(stats.sonal.byYear['2026-27'], 1);
  assert.equal(stats.krishna.total, 1);
});

test('operations companies merge PO details, compliance and SLA without mixing another owner', async () => {
  const { buildOperationsProgressGroups, buildOperationsWorkbookData, assignedCompanyKey: frontendKey } = await import('../../frontend/src/utils/operationsUserProgress.mjs');
  const rows = [client('a', 'AMINES AND PLASTICIZERS LTD', 'sonal'), client('b', 'Amines and Plasticizers Ltd.', 'sonal'), client('c', 'AMINES AND PLASTICIZERS LTD', 'krishna')].map((c, index) => ({ id: c._id, companyName: c.data.basic.clientLegalName, hasPo: true, poDetails: { records: [{ poNo: c._id }] }, client: { ...c, operationsSla: { approvalStatus: index === 0 ? 'APPROVED' : 'PENDING', reminderFlag: index === 1 ? 'PERMANENT_RED' : '' }, complianceReview: { sections: [{ key: 'basic', label: 'Basic Info', remarks: `remarks-${c._id}` }] } } }));
  const groups = buildOperationsProgressGroups(rows, users, () => []);
  const sonal = groups.find(group => group.id === 'sonal');
  assert.equal(sonal.total, 1);
  assert.equal(sonal.poDone, 1);
  assert.equal(sonal.complianceDone, 0);
  assert.equal(sonal.milestones[48], 1);
  assert.equal(groups.find(group => group.id === 'krishna').total, 1);
  const workbook = buildOperationsWorkbookData(groups, '2025-26');
  assert.equal(workbook.clients.length, 2);
  assert.equal(workbook.poDetails.length, 3);
  assert.equal(workbook.tabRemarks.length, 3);
  assert.equal(frontendKey(rows[0].client), assignedCompanyKey(rows[0].client));
});

test('closed service matrix follows the permanent staff owner, rather than assigned manager', () => {
  const leads = [{ _id: 'lead', company: 'AMINES AND PLASTICIZERS LTD', serviceSelections: [{ subApplicantType: 'Importer' }, { subApplicantType: 'Producer' }], assignments: users.map(user => ({ assignedStaff: user._id, assignedTo: 'manager', closedAt: '2026-01-01', poYearRows: [{ poFinancialYear: '2025-26', hasPoEvidence: true, services: ['Annual Return Filling'] }] })) }];
  const sections = buildUserSections(overallRecordsFromLeads(leads), [], [...users, { _id: 'manager', role: 'operation' }]);
  assert.equal(sections[0].yearSections[0].summary.clients, 1);
  assert.equal(sections[1].yearSections[0].summary.clients, 1);
  assert.equal(sections[2].yearSections[0].summary.clients, 0);
});
