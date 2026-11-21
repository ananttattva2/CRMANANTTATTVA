const test = require('node:test');
const assert = require('node:assert/strict');
const legal = require('../src/services/legalSla');
const reminder = require('../src/services/legalSlaReminders');
const Delivery = require('../src/models/ReminderDelivery');
const mailer = require('../src/utils/mailer');
const users = [
  { _id: 'staff', name: 'Staff', email: 'staff@example.test', role: 'operation' },
  { _id: 'other', name: 'Other', email: 'other@example.test', role: 'operation' },
  { _id: 'admin', email: 'admin@example.test', role: 'admin' },
  { _id: 'super', email: 'super@example.test', roles: ['operation', 'superadmin'] },
  { _id: 'inactive', email: 'inactive@example.test', role: 'admin', isActive: false }
];
const pending = { id: 'staff:company', clientName: '<Company>', userName: 'Staff', userId: 'staff', slaStatus: 'No' };
const monday = new Date('2026-11-23T04:30:00Z');
test('weekly Legal reminders start Monday 10 AM IST and do not run on other days', () => {
  assert.equal(reminder.weeklySlot(monday), '2026-11-23');
  assert.equal(reminder.weeklySlot(new Date(+monday - 1)), null);
  assert.equal(reminder.weeklySlot(new Date('2026-11-24T05:00:00Z')), null);
});
test('only No is emailed to owner, active admin roles and Legal, with deduplicated addresses', () => {
  const rows = [pending, { ...pending, id: 'other:yes', userId: 'other', slaStatus: 'Yes' }];
  const batches = reminder.recipientBatches(rows, [...users, { ...users[0], email: 'STAFF@example.test' }]);
  assert.deepEqual(batches.map(batch => batch.email).sort(), ['admin@example.test','legal@ananttattva.com','staff@example.test','super@example.test']);
  assert.ok(batches.every(batch => batch.rows.length === 1));
  assert.deepEqual(reminder.recipientBatches([{ ...pending, slaStatus: 'Yes' }], users), []);
  assert.match(reminder.emailHtml([pending]), /&lt;Company&gt;/);
});
test('Legal register groups company per owner and preserves saved Yes on sibling services', () => {
  const client = (id, owner, status) => ({ _id: id, selectedLead: { company: 'Company Ltd', assignedStaff: owner }, sla: { status }, data: { basic: { clientLegalName: 'Company Ltd' } } });
  const rows = legal.legalRows([client('one','staff','No'),client('two','staff','Yes'),client('three','other','')], users);
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.userId === 'staff').slaStatus, 'Yes');
  assert.equal(rows.find(row => row.userId === 'other').slaStatus, 'No');
});
function setup(t, { completeBeforeSend = false, fail = false } = {}) {
  const ledger = new Map(), sent = []; let loads = 0;
  t.mock.method(legal, 'loadLegalSla', async () => ({ rows: completeBeforeSend && loads++ > 0 ? [{ ...pending, slaStatus: 'Yes' }] : [pending], users }));
  t.mock.method(Delivery, 'create', async row => { if (ledger.has(row.key)) throw Object.assign(new Error('duplicate'), { code: 11000 }); const doc = { ...row, _id: row.key }; ledger.set(row.key, doc); return doc; });
  t.mock.method(Delivery, 'findOneAndUpdate', async (filter, update) => { const row = ledger.get(filter.key); if (!row || row.status !== 'sending' || +row.leaseUntil > +filter.leaseUntil.$lte) return null; Object.assign(row, update.$set); return row; });
  t.mock.method(Delivery, 'updateOne', async (filter, update) => { Object.assign(ledger.get(filter._id), update.$set); });
  t.mock.method(Delivery, 'deleteOne', async filter => ledger.delete(filter._id));
  t.mock.method(mailer, 'sendMail', async email => { if (fail) throw new Error('offline'); sent.push(email); });
  return { sent, ledger };
}
test('weekly delivery ledger prevents duplicates and allows the next week', async t => {
  const { sent } = setup(t);
  assert.equal((await reminder.runLegalSlaReminders({ now: monday })).emails, 4);
  assert.equal((await reminder.runLegalSlaReminders({ now: monday })).emails, 0);
  assert.equal((await reminder.runLegalSlaReminders({ now: new Date(+monday + 7 * 86400000) })).emails, 4);
  assert.equal(sent.length, 8);
});
test('Yes saved before sending cancels the reminder', async t => {
  const { sent } = setup(t, { completeBeforeSend: true });
  assert.equal((await reminder.runLegalSlaReminders({ now: monday })).emails, 0);
  assert.equal(sent.length, 0);
});
test('failed sends remain retryable rather than recorded as delivered', async t => {
  const { ledger } = setup(t, { fail: true });
  assert.equal((await reminder.runLegalSlaReminders({ now: monday })).failures, 4);
  assert.ok([...ledger.values()].every(row => row.status === 'sending'));
  assert.equal((await reminder.runLegalSlaReminders({ now: new Date(+monday + 6 * 60000) })).failures, 4);
});

test('Legal API scope excludes other users, supports manager teams and fails closed for missing scope', () => {
  const rows = [pending, { ...pending, id: 'other:company', userId: 'other' }];
  assert.deepEqual(legal.visibleLegalRows(rows, { ids: ['staff'] }), [pending]);
  assert.equal(legal.visibleLegalRows(rows, { ids: ['staff','other'] }).length, 2);
  assert.equal(legal.visibleLegalRows(rows, null).length, 2);
  assert.deepEqual(legal.visibleLegalRows(rows, undefined), []);
});
