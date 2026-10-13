const test = require('node:test');
const assert = require('node:assert/strict');
const Lead = require('../src/models/Lead');
const Approval = require('../src/models/PendingApproval');
const { removePoApproval } = require('../src/controllers/leadDeletionController');
const id = '222222222222222222222222';
function res() { return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
function req(role = 'admin', approvalId = id) { return { params: { id: approvalId }, user: { _id: '333333333333333333333333', role } }; }
test('removing approval changes only the selected row; lead and sibling approvals stay untouched', async t => {
  const leads = t.mock.method(Lead, 'findOneAndUpdate', () => { throw Error('Lead must not change'); });
  const siblings = t.mock.method(Approval, 'updateMany', () => { throw Error('Sibling approvals must not change'); });
  const update = t.mock.method(Approval, 'findOneAndUpdate', (filter, data) => {
    assert.deepEqual(filter, { _id: id, type: 'purchase_order', deletedAt: null });
    assert.ok(data.$set.deletedAt instanceof Date);
    assert.equal(data.$set.nextReminderAt, null);
    assert.equal(data.$set.approvalStatus, undefined);
    return { select: async () => ({ _id: id, clientName: 'Example Client' }) };
  });
  const result = res();
  await removePoApproval(req(), result, error => { throw error; });
  assert.equal(result.code, 200);
  assert.equal(result.body.approvalId, id);
  assert.match(result.body.message, /Example Client/);
  assert.equal(update.mock.callCount(), 1);
  assert.equal(leads.mock.callCount(), 0);
  assert.equal(siblings.mock.callCount(), 0);
});
test('non-admin and invalid IDs cannot mutate approvals', async t => {
  const mutation = t.mock.method(Approval, 'findOneAndUpdate', () => { throw Error('Must not mutate'); });
  for (const [request, expected] of [[req('sales'), 403], [req('manager'), 403], [req('admin', 'invalid'), 400]]) {
    const result = res();
    await removePoApproval(request, result, error => { throw error; });
    assert.equal(result.code, expected);
  }
  assert.equal(mutation.mock.callCount(), 0);
});
test('already removed approval returns 404 and Super Admin can use the action', async t => {
  t.mock.method(Approval, 'findOneAndUpdate', () => ({ select: async () => null }));
  const result = res();
  await removePoApproval(req('superadmin'), result, error => { throw error; });
  assert.equal(result.code, 404);
});
test('archived approvals stay hidden while same-source upserts match the archived record', () => {
  const hooks = [];
  require('../src/utils/approvalDeletionVisibility')({ pre: (operations, handler) => hooks.push({ operations, handler }) });
  const queryHook = hooks[0].handler;
  const filter = { sourceClientId: 'lead:po:service' };
  const query = { getOptions: () => ({}), getFilter: () => filter, setQuery(value) { this.filter = value; } };
  queryHook.call(query);
  assert.deepEqual(query.filter, { $and: [filter, { deletedAt: null }] });
  const upsert = { ...query, filter, getOptions: () => ({ upsert: true }) };
  queryHook.call(upsert);
  assert.deepEqual(upsert.filter, filter);
});
