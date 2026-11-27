const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createDashboardCache, invalidateDashboardReads, loadDashboardAssignments } = require('../src/services/dashboardReadModel');
const { dashboardStatusClient, mergeManagerStaffAllocations } = require('../src/services/managerStaffAllocations');

test('assignment loader includes every legacy closed-owner snapshot, not only named examples', async () => {
  invalidateDashboardReads();
  let clientPipeline;
  const aggregate = (rows, capture) => (pipeline) => ({ option: async () => { capture?.(pipeline); return rows; } });
  await loadDashboardAssignments({
    Client: { aggregate: aggregate([], pipeline => { clientPipeline = pipeline; }) },
    Lead: { aggregate: aggregate([]), collection: { name: 'leads' } }
  }, {}, {});
  const pipeline = JSON.stringify(clientPipeline);
  for (const field of ['closedBy', 'closedByText', 'closedByEmail']) {
    assert.match(pipeline, new RegExp(`data\\.selectedLeadSnapshot\\.${field}`));
  }
});

test('legacy Balaji draft linked by lead code reaches the Unit 2 importer dashboard row as Approved', async () => {
  invalidateDashboardReads();
  const services = [
    { assignedServiceId: 'brand', subApplicantType: 'Brand Owner', plantUnit: 'Unit 1', eprCategory: 'EPR - Plastic Waste', servicesOffered: 'Annual Return Filling' },
    { assignedServiceId: 'raw-importer', subApplicantType: 'Importer of Raw Material', plantUnit: 'Unit 2', eprCategory: 'EPR - Plastic Waste', servicesOffered: 'Annual Return Filling' },
    { assignedServiceId: 'producer', subApplicantType: 'Producer', plantUnit: 'Unit 3', eprCategory: 'EPR - Plastic Waste', servicesOffered: 'New Registration' }
  ];
  const lead = {
    _id: 'mongo-balaji-id', leadCode: 'ATPL-LEAD-0464', company: 'Balaji Plastic Finishing & Trading',
    serviceSelections: services,
    assignments: services.map(service => ({ assignedServiceId: service.assignedServiceId, assignedStaff: 'sonal', closedAt: '2026-10-01' }))
  };
  const draft = {
    _id: 'balaji-draft', workflowStatus: 'draft', assignedServiceId: 'obsolete-importer-id', updatedAt: '2026-10-13',
    data: {
      assignedServiceId: 'obsolete-importer-id',
      selectedLeadSnapshot: { leadCode: 'ATPL-LEAD-0464', assignedServiceId: 'obsolete-importer-id', subApplicantType: 'SIMP - Importer', plantUnit: 'Unit 2', eprCategory: 'EPR Plastic Waste', servicesOffered: 'Annual Return Filing' },
      cpcbDataByAssignedServiceId: { 'obsolete-importer-id': { cpcb: { status: 'Approved' } } },
      importMeta: { leadNumber: 'ATPL-LEAD-0464', clientStatus: 'draft' }
    }
  };
  const aggregate = rows => () => ({ option: async () => rows });
  const loaded = await loadDashboardAssignments({
    Client: { aggregate: aggregate([draft]) },
    Lead: { aggregate: aggregate([lead]) }
  }, { testCase: 'balaji-lead-code' }, { testCase: 'balaji-lead-code' });
  assert.equal(loaded.clients.length, 1);
  assert.equal(loaded.clients[0].selectedLead._id, 'mongo-balaji-id');
  const rows = mergeManagerStaffAllocations(loaded.clients.map(dashboardStatusClient), loaded.leads).filter(row => row.assignmentOnly);
  assert.equal(rows.find(row => row.assignedServiceId === 'raw-importer').data.cpcb.status, 'Approved');
  assert.equal(rows.find(row => row.assignedServiceId === 'brand').data.cpcb.status, undefined);
  assert.equal(rows.find(row => row.assignedServiceId === 'producer').data.cpcb.status, undefined);
  const { buildApplicationPortfolio } = await import('../../frontend/src/utils/applicationPortfolio.mjs');
  const [sonal] = buildApplicationPortfolio([...loaded.clients.map(dashboardStatusClient), ...rows], [{ _id: 'sonal', name: 'Sonal More', role: 'operation' }]);
  const importer = sonal.records.find(record => record.category === 'Importer of Raw Material' && record.unit === 'Unit 2');
  assert.equal(importer.cpcb, 'Approved');
});

test('legacy accounts are recovered through lead codes and matched to the correct applicant in the portfolio and Excel', async () => {
  const { applicationReportGroups, buildApplicationPortfolio, portfolioAccountIds } = await import('../../frontend/src/utils/applicationPortfolio.mjs');
  const { createApplicationPortfolioWorkbook } = await import('../../frontend/src/utils/applicationPortfolioExport.mjs');
  const ExcelJS = require('../../frontend/node_modules/exceljs');
  const lead = {
    _id: 'mongo-legacy-accounts',
    leadCode: 'ATPL-0190',
    company: 'Legacy Account Fixture',
    serviceSelections: [
      { assignedServiceId: 'new-brand', subApplicantType: 'Brand Owner', accountsRecordId: 'ATPL-LEAD-0142' },
      { assignedServiceId: 'new-importer', subApplicantType: 'Importer', accountsRecordId: 'ATPL-LEAD-0143' },
      { assignedServiceId: 'no-account', subApplicantType: 'Producer' }
    ].map(service => ({ ...service, servicesOffered: 'Annual Return Filling', eprCategory: 'EPR - Plastic Waste', plantUnit: 'Unit 1' }))
  };
  const clients = ['Brand Owner', 'Importer', 'Producer'].map((candidate, index) => ({
    _id: `account-fixture-${index}`, assignedStaff: 'sonal', workflowStatus: 'submitted',
    ...(index === 0 ? { assignedServiceId: 'obsolete-id' } : {}),
    data: {
      basic: { piboCategory: candidate, eprCategory: 'Plastic Waste', servicesOffered: 'Annual Return Filing', plantUnit: 'Unit 1' },
      importMeta: { uniqueId: 'ATPL-LEAD-0190' }, cpcb: { status: 'Approved' }
    }
  }));
  const leadFilter = { deletedAt: null };
  const leadQueries = [];
  const loaded = await loadDashboardAssignments({
    Client: { aggregate: () => ({ option: async () => clients }) },
    Lead: { aggregate: pipeline => {
      leadQueries.push(pipeline[0].$match);
      return { option: async () => leadQueries.length === 1 ? [] : [lead] };
    } }
  }, { fixture: 'legacy-accounts' }, leadFilter);
  assert.equal(leadQueries.length, 2);
  assert.equal(leadQueries[1].$and[0], leadFilter);
  assert.ok(leadQueries[1].$and[1].$or.find(filter => filter.leadCode).leadCode.$in.includes(lead.leadCode));
  const assignments = mergeManagerStaffAllocations(loaded.clients.map(dashboardStatusClient), loaded.leads);
  const [group] = applicationReportGroups(buildApplicationPortfolio(assignments, [{ _id: 'sonal', name: 'Sonal', role: 'operation' }]));
  const ids = records => Object.fromEntries(records.map(row => [row.category, portfolioAccountIds(row.services).join(', ')]));
  assert.deepEqual(ids(group.records), { 'Brand Owner': 'ATPL-LEAD-0142', Importer: 'ATPL-LEAD-0143', Producer: '' });
  const workbook = await createApplicationPortfolioWorkbook(group.records, 'All SPOCs', 'Total');
  const exported = new ExcelJS.Workbook();
  await exported.xlsx.load(await workbook.xlsx.writeBuffer());
  for (const sheetName of ['Clients', 'Service Statuses']) {
    const sheet = exported.getWorksheet(sheetName);
    const rows = sheet.getRows(4, 3).map(row => [row.getCell('F').value, [row.getCell('R').value, row.getCell('S').value]]);
    assert.deepEqual(Object.fromEntries(rows), {
      'Brand Owner': ['ATPL-LEAD-0142', 'Service'],
      Importer: ['ATPL-LEAD-0143', 'Service'],
      Producer: ['ATPL-LEAD-0142, ATPL-LEAD-0143', 'Linked lead']
    });
  }
});

test('portfolio displays both linked lead IDs when the saved Annual Return services have no account mapping', async () => {
  const { hydratePortfolioLeadAccounts } = require('../src/services/dashboardReadModel');
  const { applicationRecord, portfolioAccountDisplay, matchesPortfolioSearch } = await import('../../frontend/src/utils/applicationPortfolio.mjs');
  const { createApplicationPortfolioWorkbook } = await import('../../frontend/src/utils/applicationPortfolioExport.mjs');
  const ExcelJS = require('../../frontend/node_modules/exceljs');
  const recordedIds = ['ATPL-LEAD-0142', 'ATPL-LEAD-0143'];
  const liveLead = { leadCode: 'ATPL-0190', company: 'Legacy Plastics', serviceSelections: recordedIds.map(accountsRecordId => ({ accountsRecordId })) };
  const clients = ['Brand Owner', 'Importer', 'Producer'].map((piboCategory, index) => ({
    _id: `legacy-${index}`, workflowStatus: 'submitted', assignedServiceId: `annual-${index}`,
    data: { importMeta: { uniqueId: 'ATPL-LEAD-0190' }, basic: {
      clientLegalName: index === 2 ? 'Different Company' : liveLead.company,
      piboCategory, servicesOffered: 'Annual Return Filling'
    } },
    selectedLead: { serviceSelections: [{ assignedServiceId: `annual-${index}`, piboCategory, servicesOffered: 'Annual Return Filling' }] }
  }));
  const scope = { deletedAt: null };
  const Lead = { aggregate(pipeline) {
    assert.deepEqual(pipeline[0].$match.$and, [scope, { leadCode: { $in: ['ATPL-LEAD-0190', 'ATPL-0190'] } }]);
    return { option: async () => [liveLead] };
  } };
  const applications = (await hydratePortfolioLeadAccounts(Lead, clients, scope)).map(applicationRecord);
  for (const row of applications.slice(0, 2)) {
    assert.equal(row.accountId, '');
    assert.deepEqual(portfolioAccountDisplay([row]), { ids: recordedIds, source: 'Linked lead' });
    assert.equal(matchesPortfolioSearch(row, recordedIds[1]), true);
  }
  assert.equal(portfolioAccountDisplay([applications[2]]).source, '');
  const workbook = await createApplicationPortfolioWorkbook(applications, 'All SPOCs', 'Total');
  const exported = new ExcelJS.Workbook();
  await exported.xlsx.load(await workbook.xlsx.writeBuffer());
  for (const sheetName of ['Clients', 'Service Statuses']) {
    const sheet = exported.getWorksheet(sheetName);
    assert.deepEqual(sheet.getRows(4, 3).map(row => [row.getCell('R').value, row.getCell('S').value]),
      [[recordedIds.join(', '), 'Linked lead'], [recordedIds.join(', '), 'Linked lead'], ['', '']]);
  }
});

test('dashboard reads coalesce concurrent loads and expire without sharing scope keys', async () => {
  let now = 0, reads = 0;
  const cached = createDashboardCache({ ttl: 15, now: () => now });
  const load = async () => ++reads;
  assert.deepEqual(await Promise.all([cached('owner-a', load), cached('owner-a', load)]), [1, 1]);
  assert.equal(await cached('owner-b', load), 2);
  now = 16;
  assert.equal(await cached('owner-a', load), 3);
});

test('production dashboard loaders never retain completed or in-flight stale snapshots', async () => {
  const cached = createDashboardCache();
  let finish;
  const old = cached('owner', () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  invalidateDashboardReads();
  assert.equal(await cached('owner', async () => 'edited'), 'edited');
  finish('old');
  assert.equal(await old, 'old');
  assert.equal(await cached('owner', async () => 'latest'), 'latest');
});

test('a failed dashboard read can be retried immediately', async () => {
  const cached = createDashboardCache();
  await assert.rejects(cached('owner', async () => { throw new Error('database unavailable'); }));
  assert.equal(await cached('owner', async () => 'recovered'), 'recovered');
});

test('assignment endpoint hydrates compact leads, isolates staff visibility and emits timing', async () => {
  invalidateDashboardReads();
  const file = path.resolve(__dirname, '../src/controllers/dashboardInsightsController.js');
  const actualRequire = createRequire(file);
  const user = { _id: 'staff', name: 'Operator', role: 'operation' };
  const foreign = { _id: 'outsider', name: 'Other Operator', role: 'operation' };
  const leads = [user, foreign].map(owner => ({ _id: `lead-${owner._id}`, company: `Company ${owner._id}`, serviceSelections: [{ assignedServiceId: 'service', servicesOffered: 'Registration' }], assignments: [{ assignedServiceId: 'service', assignedStaff: owner._id, closedAt: new Date() }] }));
  const clients = leads.map(lead => ({ _id: `client-${lead._id}`, assignedServiceId: 'service', selectedLead: lead._id, workflowStatus: 'submitted', data: { basic: { clientLegalName: lead.company } } }));
  const query = value => ({ select() { return this; }, sort() { return this; }, maxTimeMS() { return this; }, populate() { return this; }, lean: async () => value });
  const mocks = {
    '../models/Lead': { aggregate: () => ({ option: async () => leads }) },
    '../models/Client': { aggregate: () => ({ option: async () => clients }) },
    '../models/User': { find: () => query([user]) },
    '../models/ClientComplianceReview': { find: () => query([]) },
    '../models/PendingApproval': { find: () => query([]) },
    '../utils/visibilityScope': { getVisibleUserScope: async () => ({ ids: [user._id], identities: [user.name] }), ownerFilter: () => ({}) },
    '../services/dashboardTestLeadExclusion': { getAssignmentDashboardLeadReferences: async () => ({}), dashboardClientExclusionFilter: () => ({}), dashboardLeadExclusionFilter: () => ({}) }
  };
  const exported = {};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { exports: exported, require: name => mocks[name] || actualRequire(name), console, Date, Set, Map });
  let payload;
  const headers = {};
  await exported.uploadTracker({ user, query: { assignmentsOnly: 'true' } }, {
    set(key, value) { headers[key] = value; }, status(code) { assert.fail(`Unexpected HTTP ${code}`); }, json(value) { payload = value; }
  });
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.assignments.map(client => client._id), ['client-lead-staff']);
  assert.equal(payload.assignments[0].selectedLead.company, 'Company staff');
  assert.match(headers['Server-Timing'], /assignments;dur=\d+$/);
  assert.equal(headers['Cache-Control'], 'private, no-store');

  let portfolioPayload;
  await exported.uploadTracker({ user, query: { assignmentsOnly: 'true', portfolioOnly: 'true' } }, {
    set() {}, status(code) { assert.fail(`Unexpected HTTP ${code}`); }, json(value) { portfolioPayload = value; }
  });
  assert.equal(portfolioPayload.visibility, 'own');
  assert.deepEqual(portfolioPayload.assignments.map(client => client._id), ['client-lead-staff']);
  assert.deepEqual(portfolioPayload.users.map(entry => entry._id), ['staff']);
});
