const test = require('node:test');
const assert = require('node:assert/strict');
const { provisionalState, FREEZE_MESSAGE } = require('../src/services/provisionalFreeze');
const Lead = require('../src/models/Lead');
const Approval = require('../src/models/PendingApproval');
const ctrl = require('../src/controllers/poFinanceController');
const cache = require('../src/services/crmCache');
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
test('deadline is enforced at the boundary and a timely uploaded PO prevents freezing', () => {
  const row = { poStatus: 'provisional', provisionalCloseExpiresAt: '2026-12-03T12:00:00Z' };
  assert.equal(provisionalState(row, new Date('2026-12-03T11:59:59Z')).frozen, false);
  assert.equal(provisionalState(row, new Date('2026-12-03T12:00:00Z')).frozen, true);
  assert.match(provisionalState(row, new Date('2026-12-04')).message, /7 working days/);
  assert.equal(provisionalState({ ...row, provisionalFinanceApproval: { name: 'Finance' } }, new Date('2026-12-04')).frozen, true);
  assert.equal(provisionalState({ ...row, clientPoReceivedAt: '2026-12-03T11:00:00Z' }, new Date('2026-12-04')).frozen, false);
  assert.equal(provisionalState({ ...row, clientPoReceivedAt: '2026-12-04T11:00:00Z' }, new Date('2026-12-04')).frozen, true);
  assert.equal(provisionalState({ ...row, poStatus: 'received' }, new Date('2026-12-04')).frozen, false);
});
test('Finance approves special closures without changing the PO deadline; overdue and unauthorized requests fail', async () => {
  const original = { find: Lead.findById, update: Lead.updateOne, invalidate: cache.invalidateCrmCache };
  const id = '012345678901234567890123';
  let assignment = { assignedServiceId: 's1', poStatus: 'provisional', provisionalCloseExpiresAt: '2099-01-01T00:00:00Z' }, update;
  Lead.findById = () => ({ select() { return this; }, lean: async () => ({ _id: id, assignments: [assignment] }) });
  Lead.updateOne = async (_filter, value) => { update = value; return { modifiedCount: 1 }; };
  cache.invalidateCrmCache = async () => {};
  try {
    for (const user of [{ _id: 'finance1', role: 'finance', name: 'Finance' }, { _id: 'finance2', role: 'sales', roles: ['finance'], name: 'Secondary Finance' }]) {
      const res = response(); await ctrl.approveSpecialClosure({ params: { id: `special:${id}:s1` }, body: { remarks: 'Approved pending PO' }, user }, res);
      assert.equal(res.code, 200); assert.ok(update.$set['assignments.0.provisionalFinanceApproval']); assert.equal(update.$set['assignments.0.provisionalCloseExpiresAt'], undefined);
    }
    let res = response(); await ctrl.approveSpecialClosure({ params: { id: `special:${id}:s1` }, body: { remarks: 'Approve' }, user: { role: 'sales' } }, res); assert.equal(res.code, 403);
    assignment = { ...assignment, provisionalCloseExpiresAt: '2020-01-01T00:00:00Z' }; res = response(); await ctrl.approveSpecialClosure({ params: { id: `special:${id}:s1` }, body: { remarks: 'Approve' }, user: { role: 'finance' } }, res); assert.equal(res.code, 423); assert.equal(res.body.error, FREEZE_MESSAGE);
  } finally { Lead.findById = original.find; Lead.updateOne = original.update; cache.invalidateCrmCache = original.invalidate; }
});
test('every Finance primary or secondary role receives the complete Finance list', async () => {
  const special = require('../src/services/specialClosureFinance');
  const original = { find: Approval.find, special: special.loadSpecialClosures };
  const rows = [{ _id: 'one', poReview: { stage: 'FINANCE_READY' } }, { _id: 'two', poReview: { stage: 'LEAD_CLOSURE_PENDING' } }];
  Approval.find = () => ({ select() { return this; }, sort() { return this; }, maxTimeMS() { return this; }, lean: async () => rows }); special.loadSpecialClosures = async () => [];
  try { for (const user of [{ role: 'finance' }, { role: 'operation', roles: ['finance'] }, { role: 'accounts' }]) { const res = response(); await ctrl.list({ user }, res); assert.equal(res.code, 200); assert.equal(res.body.approvals.length, 2); } } finally { Approval.find = original.find; special.loadSpecialClosures = original.special; }
});
test('client writes are blocked for the frozen service without locking sibling services', async () => {
  const Client = require('../src/models/Client');
  const { guard, clientAssignment } = require('../src/services/provisionalFreeze');
  const original = Client.findById;
  const lead = { assignments: [{ assignedServiceId: 'expired', poStatus: 'provisional', provisionalCloseExpiresAt: '2020-01-01' }, { assignedServiceId: 'active', poStatus: 'received' }] };
  const client = { assignedServiceId: 'expired', selectedLead: lead };
  assert.equal(clientAssignment(client, lead).assignedServiceId, 'expired');
  Client.findById = () => ({ select() { return this; }, lean: async () => client });
  try {
    let next = false; const res = response(); await guard({ method: 'PUT', params: { id: '012345678901234567890123' }, body: {}, query: {} }, res, () => { next = true; }); assert.equal(next, false); assert.equal(res.code, 423); assert.equal(res.body.code, 'SPECIAL_APPROVAL_PO_OVERDUE');
    client.assignedServiceId = 'active'; await guard({ method: 'PUT', params: { id: '012345678901234567890123' }, body: {}, query: {} }, response(), () => { next = true; }); assert.equal(next, true);
  } finally { Client.findById = original; }
});
