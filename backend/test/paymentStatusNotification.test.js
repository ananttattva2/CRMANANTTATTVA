const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../src/models/User');
const Notification = require('../src/models/Notification');
const { notifyPaymentStatus } = require('../src/services/paymentStatusNotification');

test('payment update creates an Admin and Super Admin notification with amount, actor and remarks', async t => {
  t.mock.method(User, 'find', () => ({ select() { return this; }, lean: async () => [{ _id: 'admin', role: 'admin' }, { _id: 'super', role: 'sales', roles: ['Super Admin'] }, { _id: 'sales', role: 'sales' }] }));
  let created;
  t.mock.method(Notification, 'create', async row => { created = row; return row; });
  await notifyPaymentStatus({ approval: { _id: 'approval', clientName: 'Demo Company' }, lead: { leadCode: 'ATPL-1' }, poAmount: 1000, paymentStatus: { status: 'ADVANCE_RECEIVED', amount: 500, name: 'Finance User', at: '2026-11-21T10:00:00Z', remarks: 'Bank receipt verified' } }, { _id: 'finance', name: 'Finance User' });
  assert.deepEqual(created.audience, ['admin', 'super']);
  assert.match(created.description, /500\.00/);
  assert.match(created.description, /Finance User/);
  assert.match(created.description, /Bank receipt verified/);
  assert.equal(created.metadata.actionUrl, '/finance-approval');
});
