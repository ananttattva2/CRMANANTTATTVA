const test = require('node:test');
const assert = require('node:assert/strict');
const Lead = require('../src/models/Lead');
const Approval = require('../src/models/PendingApproval');
const { deleteApprovalLead } = require('../src/controllers/leadDeletionController');
const leadId = '111111111111111111111111';
const approvalId = '222222222222222222222222';
function response() { return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
function request(role = 'admin') { return { params: { id: approvalId }, user: { _id: '333333333333333333333333', role } }; }
test('admin deletes linked lead and archives every linked PO approval while retaining audit snapshots', async t => {
  t.mock.method(Approval, 'findOne', filter => {
    assert.equal(filter.type, 'purchase_order');
    return { lean: async () => ({ _id: approvalId, clientName: 'Example Client', payload: { leadId } }) };
  });
  t.mock.method(Lead, 'findOneAndUpdate', (filter, update) => {
    assert.equal(filter._id, leadId);
    assert.ok(update.$set.deletedAt instanceof Date);
    return { select: async () => ({ _id: leadId, company: 'Example Client' }) };
  });
  const cleanup = t.mock.method(Approval, 'updateMany', async (filter, update) => {
    assert.equal(filter.type, 'purchase_order');
    assert.ok(filter.$or.some(entry => entry['payload.leadId'] === leadId));
    assert.ok(update.$set.deletedAt instanceof Date);
    assert.equal(update.$set.nextReminderAt, null);
  });
  const res = response();
  await deleteApprovalLead(request(), res, error => { throw error; });
  assert.equal(res.code, 200);
  assert.equal(res.body.leadId, leadId);
  assert.equal(cleanup.mock.callCount(), 1);
});
test('non-admin cannot delete and invalid or unlinked approvals never delete a lead', async t => {
  const findLead = t.mock.method(Lead, 'findOneAndUpdate', () => { throw Error('Must not delete'); });
  let res = response();
  await deleteApprovalLead(request('sales'), res, error => { throw error; });
  assert.equal(res.code, 403);
  res = response();
  await deleteApprovalLead({ ...request(), params: { id: 'bad' } }, res, error => { throw error; });
  assert.equal(res.code, 400);
  t.mock.method(Approval, 'findOne', () => ({ lean: async () => ({ _id: approvalId, payload: {} }) }));
  res = response();
  await deleteApprovalLead(request(), res, error => { throw error; });
  assert.equal(res.code, 409);
  assert.equal(findLead.mock.callCount(), 0);
});
test('legacy approval resolves only a valid source lead ID', async t => {
  t.mock.method(Approval, 'findOne', () => ({ lean: async () => ({ _id: approvalId, sourceClientId: `${leadId}:po:legacy` }) }));
  t.mock.method(Lead, 'findOneAndUpdate', filter => { assert.equal(filter._id, leadId); return { select: async () => null }; });
  t.mock.method(Approval, 'updateMany', async () => ({}));
  const res = response();
  await deleteApprovalLead(request('superadmin'), res, error => { throw error; });
  assert.equal(res.code, 200);
});
