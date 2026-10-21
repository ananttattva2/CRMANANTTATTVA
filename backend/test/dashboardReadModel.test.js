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
});
