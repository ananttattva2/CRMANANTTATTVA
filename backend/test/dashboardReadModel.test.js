const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createDashboardCache, invalidateDashboardReads } = require('../src/services/dashboardReadModel');

test('dashboard reads coalesce concurrent loads and expire without sharing scope keys', async () => {
  let now = 0, reads = 0;
  const cached = createDashboardCache({ ttl: 15, now: () => now });
  const load = async () => ++reads;
  assert.deepEqual(await Promise.all([cached('owner-a', load), cached('owner-a', load)]), [1, 1]);
  assert.equal(await cached('owner-b', load), 2);
  now = 16;
  assert.equal(await cached('owner-a', load), 3);
});

test('successful edits invalidate cached and in-flight dashboard snapshots', async () => {
  const cached = createDashboardCache();
  let finish;
  const old = cached('owner', () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  invalidateDashboardReads();
  assert.equal(await cached('owner', async () => 'edited'), 'edited');
  finish('old');
  assert.equal(await old, 'old');
  assert.equal(await cached('owner', async () => 'incorrect'), 'edited');
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
