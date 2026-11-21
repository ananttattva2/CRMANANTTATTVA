const test = require('node:test');
const assert = require('node:assert/strict');
const Approval = require('../src/models/PendingApproval');
const Lead = require('../src/models/Lead');
const Invoice = require('../src/models/ProformaInvoice');
const User = require('../src/models/User');
const Delivery = require('../src/models/ReminderDelivery');
const mailer = require('../src/utils/mailer');
const service = require('../src/services/postPoApprovalReminders');
const { TWO_DAYS, tasksFor, invoiceSent, weekKey, htmlFor } = service.__test;
const approvalId = '507f1f77bcf86cd799439011', leadId = '507f1f77bcf86cd799439012';
const query = value => ({ select() { return this; }, lean: async () => structuredClone(value) });
function fixture() {
  const approvedAt = '2026-11-16T04:00:00Z';
  const approval = { _id: approvalId, type: 'purchase_order', approvalStatus: 'PARTIALLY_APPROVED', clientName: 'Demo Company', poReview: { adminApproval: { at: approvedAt }, stage: 'FINANCE_READY', terms: [{ paymentTerm: '50% advance, 50% on completion' }] }, payload: { leadId, assignedServiceId: 'service-a', assignmentIndex: 0, poSubmittedById: 'owner', poSubmittedByEmail: 'owner@example.test', service: { servicesOffered: 'Annual Return' }, poYearRows: [{ poNumber: 'PO-A', quotationId: '507f1f77bcf86cd799439013' }] } };
  const lead = { _id: leadId, company: 'Demo Company', leadCode: 'ATPL-001', createdBy: 'owner', serviceSelections: [{ assignedServiceId: 'service-a' }, { assignedServiceId: 'service-b' }], assignments: [{ assignedServiceId: 'service-a' }, { assignedServiceId: 'service-b', assignedTo: 'manager' }] };
  const users = [{ _id: 'owner', name: 'Owner', email: 'owner@example.test', role: 'sales' }, { _id: 'admin', email: 'admin@example.test', role: 'admin' }, { _id: 'super', email: 'super@example.test', role: 'sales', roles: ['Super Admin'] }, { _id: 'other', email: 'other@example.test', role: 'sales' }];
  const sentInvoice = { _id: 'invoice', status: 'issued', leadId, poNumber: 'PO-A', items: [{ assignedServiceId: 'service-a' }], emailHistory: [{ to: ['client@example.test'], sentAt: approvedAt }] };
  return { approval, lead, users, invoices: [], sentInvoice, now: new Date(approvedAt) };
}
function setup(t, f, options = {}) {
  const sent = [], ledger = new Map();
  t.mock.method(Approval, 'find', filter => query(!filter._id || String(filter._id) === approvalId ? [f.approval] : []));
  t.mock.method(Lead, 'find', () => query([f.lead]));
  t.mock.method(Invoice, 'find', () => query(f.invoices));
  t.mock.method(User, 'find', () => query(f.users));
  t.mock.method(Delivery, 'create', async row => {
    if (ledger.has(row.key)) throw Object.assign(new Error('duplicate'), { code: 11000 });
    const saved = { ...row, _id: row.key }; ledger.set(row.key, saved);
    options.afterClaim?.(f);
    return saved;
  });
  t.mock.method(Delivery, 'findOneAndUpdate', async (filter, update) => {
    const row = ledger.get(filter.key);
    if (!row || row.status !== 'sending' || +row.leaseUntil > +filter.leaseUntil.$lte) return null;
    Object.assign(row, update.$set); return row;
  });
  t.mock.method(Delivery, 'updateOne', async (filter, update) => { const row = ledger.get(filter._id); if (row) Object.assign(row, update.$set); return {}; });
  t.mock.method(Delivery, 'deleteOne', async filter => { ledger.delete(filter._id); return {}; });
  t.mock.method(mailer, 'sendMail', async (email, subject, html) => {
    if (options.fail?.(email)) throw Object.assign(new Error('offline'), { code: 'TEST_MAIL_OFFLINE' });
    sent.push({ email, subject, html }); return {};
  });
  return { sent, ledger };
}

test('Admin approval sends two separate action emails to user, Admin and Super Admin', async t => {
  const f = fixture(), { sent } = setup(t, f);
  const result = await service.runPostPoApprovalReminders({ now: f.now, approvalId });
  assert.equal(result.emails, 6);
  assert.equal(sent.filter(mail => mail.subject.startsWith('Assign manager')).length, 3);
  assert.equal(sent.filter(mail => mail.subject.startsWith('Send PI')).length, 3);
  assert.deepEqual(new Set(sent.map(mail => mail.email)), new Set(['owner@example.test', 'admin@example.test', 'super@example.test']));
  assert.ok(sent.every(mail => mail.html.includes('50% advance, 50% on completion')));
  await service.runPostPoApprovalReminders({ now: new Date(+f.now + TWO_DAYS - 1), approvalId });
  assert.equal(sent.length, 6);
  await service.runPostPoApprovalReminders({ now: new Date(+f.now + TWO_DAYS), approvalId });
  assert.equal(sent.length, 12);
  await service.runPostPoApprovalReminders({ now: new Date(+f.now + TWO_DAYS + 3600000), approvalId });
  assert.equal(sent.length, 12, 'duplicate scans do not resend a delivered cycle');
});

test('completed manager assignment stops only that action; PI generation alone does not stop sending reminders', async t => {
  const f = fixture(), { sent } = setup(t, f);
  f.lead.assignments[0].assignedTo = 'manager';
  f.invoices.push({ ...f.sentInvoice, emailHistory: [] });
  await service.runPostPoApprovalReminders({ now: f.now, approvalId });
  assert.equal(sent.length, 3);
  assert.ok(sent.every(mail => mail.subject.startsWith('Send PI')));
  f.invoices[0] = f.sentInvoice;
  await service.runPostPoApprovalReminders({ now: new Date(+f.now + TWO_DAYS), approvalId });
  assert.equal(sent.length, 3);
});

test('PI email must belong to the exact lead/service and go to an external client', () => {
  const f = fixture();
  assert.equal(invoiceSent(f.approval, f.lead, f.sentInvoice, f.users), true);
  assert.equal(invoiceSent(f.approval, f.lead, { ...f.sentInvoice, items: [{ assignedServiceId: 'service-b' }] }, f.users), false);
  assert.equal(invoiceSent(f.approval, f.lead, { ...f.sentInvoice, leadId: 'another-lead' }, f.users), false);
  assert.equal(invoiceSent(f.approval, f.lead, { ...f.sentInvoice, status: 'cancelled' }, f.users), false);
  assert.equal(invoiceSent(f.approval, f.lead, { ...f.sentInvoice, emailHistory: [{ to: ['admin@example.test'], sentAt: f.now }] }, f.users), false);
  f.lead.assignments.reverse();
  assert.deepEqual(tasksFor(f.approval, [f.lead], [], f.users, f.now).tasks, ['manager', 'pi']);
});

test('weekly digest lists all remaining tasks with unique lead totals and recipient scoping', async t => {
  const f = fixture(), { sent } = setup(t, f);
  await service.runPostPoApprovalReminders({ now: f.now });
  const weekly = sent.filter(mail => mail.subject.startsWith('Weekly pending'));
  assert.equal(weekly.length, 3);
  assert.ok(weekly.every(mail => mail.subject.includes('1 leads · 2 actions') && mail.html.includes('Manager assignment pending') && mail.html.includes('PI not emailed to client')));
  await service.runPostPoApprovalReminders({ now: new Date(+f.now + 3600000) });
  assert.equal(sent.filter(mail => mail.subject.startsWith('Weekly pending')).length, 3);
  await service.runPostPoApprovalReminders({ now: new Date(+f.now + 7 * 86400000) });
  assert.equal(sent.filter(mail => mail.subject.startsWith('Weekly pending')).length, 6);
});

test('failed recipients retry without resending successful deliveries', async t => {
  const f = fixture(); let fail = true;
  const { sent } = setup(t, f, { fail: email => fail && email === 'owner@example.test' });
  assert.equal((await service.runPostPoApprovalReminders({ now: f.now, approvalId })).failures, 2);
  assert.equal(sent.length, 4); fail = false;
  assert.equal((await service.runPostPoApprovalReminders({ now: new Date(+f.now + 6 * 60000), approvalId })).emails, 2);
  assert.equal(sent.filter(mail => mail.email === 'admin@example.test').length, 2);
});

test('source recheck stops messages if both actions complete after a claim; rejected POs never send', async t => {
  const f = fixture();
  const { sent } = setup(t, f, { afterClaim: () => { f.lead.assignments[0].assignedTo = 'manager'; f.invoices.push(f.sentInvoice); } });
  await service.runPostPoApprovalReminders({ now: f.now, approvalId });
  assert.equal(sent.length, 0);
  f.approval.approvalStatus = 'REJECTED';
  assert.equal(tasksFor(f.approval, [f.lead], [], f.users, f.now), null);
});

test('dry run is read-only, weekly time uses Monday 09:00 IST, and email escapes HTML', async t => {
  const f = fixture(), { sent, ledger } = setup(t, f);
  const result = await service.runPostPoApprovalReminders({ now: f.now, dryRun: true });
  assert.equal(result.managerPending, 1); assert.equal(result.piPending, 1);
  assert.equal(sent.length, 0); assert.equal(ledger.size, 0);
  assert.equal(weekKey(new Date('2026-11-16T03:29:59Z')), '');
  assert.ok(weekKey(new Date('2026-11-16T03:30:00Z')));
  f.lead.company = '<script>alert(1)</script>';
  const html = htmlFor(f.users[0], [tasksFor(f.approval, [f.lead], [], f.users, f.now)], 'weekly', f.now);
  assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;script&gt;'));
});

test('scheduler starts once and checks pending work every fifteen minutes', t => {
  const timers = [];
  t.mock.method(global, 'setTimeout', (_fn, delay) => { timers.push(delay); return { unref() {} }; });
  t.mock.method(global, 'setInterval', (_fn, delay) => { timers.push(delay); return { unref() {} }; });
  service.startPostPoApprovalReminderScheduler(); service.startPostPoApprovalReminderScheduler();
  assert.deepEqual(timers, [60000, 900000]);
});
