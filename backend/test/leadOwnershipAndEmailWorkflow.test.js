const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Lead = require('../src/models/Lead');
const TemporaryLead = require('../src/models/TemporaryLead');
const User = require('../src/models/User');
const Receipt = require('../src/models/ReminderDelivery');
const Activity = require('../src/models/LeadActivity');
const mailer = require('../src/utils/mailer');
const workflow = require('../src/services/leadOwnershipAndEmailWorkflow').__test;
const { DAY } = workflow;
const now = Date.UTC(2026, 10, 4, 8);
const ownerId = '507f1f77bcf86cd799439011';
const query = value => ({ select() { return this; }, sort() { return this; }, limit() { return this; }, maxTimeMS() { return this; }, lean: async () => value, then: (yes, no) => Promise.resolve(value).then(yes, no) });
afterEach(() => require('node:test').mock.restoreAll());

function matches(row, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some(item => matches(row, item));
    if (key === '$and') return value.every(item => matches(row, item));
    const actual = row[key];
    if (value && typeof value === 'object' && !(value instanceof Date)) return Object.entries(value).every(([op, wanted]) => {
      if (op === '$in') return wanted.some(item => item == null ? actual == null : item === actual);
      if (op === '$lte') return actual != null && new Date(actual).getTime() <= new Date(wanted).getTime();
      if (op === '$ne') return actual !== wanted;
      throw new Error(`Unsupported fixture operator: ${op}`);
    });
    return value == null ? actual == null : actual === value;
  });
}
function reminderFixtures(t, rows) {
  const receipts = new Map(), messages = [], updates = [];
  t.mock.method(User, 'findById', () => query({ _id: ownerId, name: 'Sales Owner', email: 'owner@example.test', isActive: true }));
  t.mock.method(TemporaryLead, 'find', filter => query(rows.filter(row => matches(row, filter))));
  t.mock.method(TemporaryLead, 'exists', async filter => rows.find(row => matches(row, filter)) || null);
  t.mock.method(TemporaryLead, 'updateOne', async (filter, update) => {
    const row = rows.find(item => matches(item, filter));
    if (row) { updates.push(update); Object.assign(row, update.$set); }
    return { modifiedCount: row ? 1 : 0 };
  });
  t.mock.method(Receipt, 'create', async data => { if (receipts.has(data.key)) throw Object.assign(new Error('duplicate'), { code: 11000 }); const row = { ...data, _id: data.key }; receipts.set(data.key, row); return row; });
  t.mock.method(Receipt, 'findOne', filter => query([...receipts.values()].find(row => matches(row, filter)) || null));
  t.mock.method(Receipt, 'findOneAndUpdate', async (filter, update) => { const row = [...receipts.values()].find(item => matches(item, filter)); if (row) Object.assign(row, update.$set); return row || null; });
  t.mock.method(Receipt, 'updateOne', async (filter, update) => { const row = [...receipts.values()].find(item => matches(item, filter)); if (row) Object.assign(row, update.$set); return { modifiedCount: row ? 1 : 0 }; });
  t.mock.method(Receipt, 'deleteOne', async filter => { receipts.delete(filter.key); });
  t.mock.method(mailer, 'sendMail', async (...args) => { messages.push(args); });
  return { messages, receipts, updates };
}

test('no-owner threshold respects 30 days, current closure evidence and reassignment time', () => {
  const lead = { createdAt: new Date(now - 30 * DAY), status: 'Potential - Registered', createdBy: ownerId };
  assert.equal(workflow.eligibleForNoOwner(lead, now - 1), false);
  assert.equal(workflow.eligibleForNoOwner(lead, now), true);
  for (const change of [{ updatedAt: new Date(now - DAY) }, { closedAt: new Date() }, { assignments: [{ closedByText: 'Owner' }] }, { serviceSelections: [{ closedAt: new Date() }] }, { assignments: [{ poYearRows: [{ poNumber: 'PO-1' }] }] }, { noOwner: { active: true } }, { noOwner: { reassignedAt: new Date(now - DAY) } }]) assert.equal(workflow.eligibleForNoOwner({ ...lead, ...change }, now), false);
  assert.equal(workflow.eligibleForNoOwner({ ...lead, updatedAt: new Date(now - 30 * DAY) }, now), true);
  assert.equal(workflow.lastLeadActivityAt({ createdAt: new Date(now - 40 * DAY), updatedAt: new Date(now - 31 * DAY), noOwner: { reassignedAt: new Date(now - 35 * DAY) } }), now - 31 * DAY);
});

test('ownership release preserves previous-owner audit and uses dotted updates without overwriting attachments', () => {
  const lead = { createdBy: ownerId, createdByName: 'Original Owner', assignments: [{ assignedTo: ownerId, poYearRows: [{ poFileUrl: 'private-proof-url' }] }] };
  const update = workflow.noOwnerUpdate(lead, now).$set;
  assert.equal(update.createdBy, null);
  assert.equal(update.generatedForUser, null);
  assert.equal(update['noOwner.previousOwner'].name, 'Original Owner');
  assert.equal(update['assignments.$[].assignedTo'], null);
  assert.equal(update.assignments, undefined);
  assert.equal(lead.assignments[0].poYearRows[0].poFileUrl, 'private-proof-url');
});

test('a concurrent lead edit prevents automatic ownership removal', async t => {
  const lead = { _id: 'lead-1', createdAt: new Date(now - 31 * DAY), updatedAt: new Date(now - DAY) };
  t.mock.method(Lead, 'find', () => query([lead]));
  t.mock.method(Lead, 'findOneAndUpdate', async filter => { assert.equal(filter.updatedAt, lead.updatedAt); return null; });
  t.mock.method(Activity, 'create', async () => assert.fail('No removal was committed'));
  assert.equal(await workflow.moveOldOpenLeads(now), 0);
});

test('an old open lead loses its current owner and records the resolved previous owner', async t => {
  const lead = { _id: 'lead-1', createdBy: ownerId, createdByName: 'Old name', createdAt: new Date(now - 35 * DAY), updatedAt: new Date(now - 31 * DAY), assignments: [{ closedBy: '', closedAt: '', assignedTo: ownerId }] };
  let saved, activity;
  t.mock.method(Lead, 'find', filter => {
    assert.deepEqual(filter.$and[0].$or[1], { updatedAt: { $lte: new Date(now - 30 * DAY) } });
    assert.equal(filter.assignments.$not.$elemMatch.$or.some(item => item.closedBy), false);
    assert.equal(filter.$expr.$and.length, 2);
    return query([lead]);
  });
  t.mock.method(User, 'findById', () => query({ name: 'Current Account Name', email: 'owner@example.test' }));
  t.mock.method(Lead, 'findOneAndUpdate', async (_filter, update) => { saved = update.$set; return lead; });
  t.mock.method(Activity, 'create', async record => { activity = record; });
  assert.equal(await workflow.moveOldOpenLeads(now), 1);
  assert.equal(saved['noOwner.active'], true); assert.equal(saved.createdBy, null);
  assert.equal(saved['noOwner.previousOwner'].name, 'Current Account Name');
  assert.equal(activity.metadata.previousOwner.email, 'owner@example.test');
  assert.equal(activity.metadata.lastActivityAt.getTime(), lead.updatedAt.getTime());
});

test('creating two temporary leads without emails never matches a blank email as a duplicate', async t => {
  const controller = require('../src/controllers/temporaryLeadController');
  let saved = 0, sequence = 0;
  t.mock.method(TemporaryLead, 'findOne', filter => { assert.ok(!filter.$or.some(item => 'emailIdentity' in item)); return query(null); });
  t.mock.method(Lead, 'find', filter => { assert.ok(!filter.$or.some(item => 'emails' in item)); return query([]); });
  t.mock.method(require('../src/models/Sequence'), 'findOneAndUpdate', async () => ({ value: ++sequence }));
  t.mock.method(TemporaryLead, 'create', async data => { assert.equal(data.email, ''); saved++; return data; });
  for (const companyName of ['Example One', 'Example Two']) {
    const response = { status(code) { assert.equal(code, 201); return this; }, json(data) { assert.equal(data.ok, true); } };
    await controller.create({ user: { _id: ownerId, name: 'Owner', email: 'owner@example.test' }, body: { companyName, personName: 'Client Representative', phone: '9876543210', sector: 'Manufacturing' } }, response);
  }
  assert.equal(saved, 2);
});

test('a blank-email lead with a duplicated phone reports the phone conflict rather than an email conflict', async t => {
  const controller = require('../src/controllers/temporaryLeadController');
  t.mock.method(TemporaryLead, 'findOne', () => query({ companyIdentity: 'different company', emailIdentity: '', phoneIdentity: '9876543210', tempLeadCode: 'ATPL-TEMP-0001' }));
  const response = { status(code) { assert.equal(code, 409); return this; }, json(data) { assert.equal(data.duplicate.match, 'phone number'); } };
  await controller.create({ user: { _id: ownerId }, body: { companyName: 'Example Company', personName: 'Client Representative', phone: '9876543210', sector: 'Manufacturing' } }, response);
});

test('temporary email is optional, but a nonempty invalid address is rejected', () => {
  const helpers = require('../src/controllers/temporaryLeadController').__test;
  const input = { companyName: 'Example Company', personName: 'Example Person', phone: '9876543210', sector: 'Manufacturing' };
  assert.equal(helpers.validateTemporaryLeadPayload(helpers.normalizeTemporaryLeadPayload(input)), '');
  assert.match(helpers.validateTemporaryLeadPayload(helpers.normalizeTemporaryLeadPayload({ ...input, email: 'invalid' })), /valid email/);
});

test('missing email gets one reminder at 48 hours and a red flag only after the next 24 hours', async t => {
  const row = { _id: 'temp-1', tempLeadCode: 'ATPL-TEMP-0001', clientName: 'Example Company', createdBy: ownerId, status: 'DRAFT', createdAt: new Date(now - 2 * DAY), email: '' };
  const { messages } = reminderFixtures(t, [row]);
  await workflow.remindMissingTemporaryEmails(now - 1); assert.equal(messages.length, 0);
  await workflow.remindMissingTemporaryEmails(now); assert.equal(messages.length, 1);
  assert.equal(row.emailReminderSentAt.getTime(), now);
  assert.equal(row.emailGraceExpiresAt.getTime(), now + DAY);
  await workflow.remindMissingTemporaryEmails(now + DAY - 1); assert.equal(messages.length, 1); assert.equal(row.emailRedFlagAt, undefined);
  await workflow.remindMissingTemporaryEmails(now + DAY); assert.equal(messages.length, 1); assert.equal(row.emailRedFlagAt.getTime(), now + DAY);
  await workflow.remindMissingTemporaryEmails(now + 2 * DAY); assert.equal(messages.length, 1);
});

test('email entered before reminder or during grace prevents further reminder and red flag', async t => {
  const completed = { _id: 'early', createdBy: ownerId, status: 'DRAFT', createdAt: new Date(now - 3 * DAY), email: 'client@example.test' };
  const grace = { _id: 'grace', createdBy: ownerId, status: 'DRAFT', createdAt: new Date(now - 3 * DAY), email: 'client@example.test', emailReminderSentAt: new Date(now - DAY), emailGraceExpiresAt: new Date(now) };
  const { messages, updates } = reminderFixtures(t, [completed, grace]);
  await workflow.remindMissingTemporaryEmails(now);
  assert.equal(messages.length, 0); assert.equal(updates.length, 0);
});

test('converted and closed temporary leads never receive missing-email reminders', async t => {
  const base = { createdBy: ownerId, createdAt: new Date(now - 4 * DAY), email: '' };
  const { messages } = reminderFixtures(t, [{ ...base, _id: 'converted', status: 'CONVERTED' }, { ...base, _id: 'closed', status: 'DRAFT', pipelineClosedAt: new Date() }]);
  await workflow.remindMissingTemporaryEmails(now); assert.equal(messages.length, 0);
});

test('email added while the delivery is being claimed cancels the outgoing reminder', async t => {
  const row = { _id: 'race', createdBy: ownerId, status: 'DRAFT', createdAt: new Date(now - 3 * DAY), email: '' };
  const { messages } = reminderFixtures(t, [row]);
  t.mock.method(TemporaryLead, 'exists', async () => { row.email = 'added@example.test'; return null; });
  await workflow.remindMissingTemporaryEmails(now); assert.equal(messages.length, 0); assert.equal(row.emailReminderSentAt, undefined);
});

test('delivery failure retries the same reminder without starting the grace deadline', async t => {
  const row = { _id: 'retry', createdBy: ownerId, status: 'DRAFT', createdAt: new Date(now - 3 * DAY), email: '' };
  const { receipts } = reminderFixtures(t, [row]);
  t.mock.method(mailer, 'sendMail', async () => { throw Object.assign(new Error('offline'), { code: 'TEST_OFFLINE' }); });
  await workflow.remindMissingTemporaryEmails(now);
  assert.equal(row.emailReminderSentAt, undefined); assert.equal(row.emailGraceExpiresAt, undefined);
  assert.equal(receipts.get('temporary-missing-email:retry').status, 'sending');
  assert.equal(row.emailWorkflowRetryAt.getTime(), now + 5 * 60000);
});

test('No Owner Leads remain readable for unrelated staff without granting access to other private leads', async () => {
  const filter = await require('../src/controllers/leadController').leadAccessFilter({ _id: ownerId, name: 'Other User', email: 'other@example.test', role: 'sales' }, { includeShared: true });
  assert.deepEqual(filter.$or[1].$or[0], { 'noOwner.active': true });
  assert.equal(filter.$or[1].$or[1]['noOwner.active'].$ne, true);
  assert.ok(filter.$or[1].$or[1].updatedAt === undefined);
  assert.ok(filter.$or[0].$or.some(condition => condition.createdBy));
});

test('no-owner notification identifies previous owner, escapes content, and only completes after all admins receive it', async t => {
  const lead = { _id: 'shared-1', leadCode: 'ATPL-0001', company: '<Example>', noOwner: { movedAt: new Date(now), previousOwner: { name: 'Previous Owner', email: 'previous@example.test' } } };
  const state = reminderFixtures(t, []);
  t.mock.method(Lead, 'find', () => query([lead]));
  t.mock.method(User, 'find', () => query([{ name: 'Admin', role: 'admin', email: 'admin@example.test' }, { name: 'Super', role: 'operation', roles: ['Super Admin'], email: 'super@example.test' }, { role: 'sales', email: 'sales@example.test' }]));
  let notified = 0;
  t.mock.method(Lead, 'updateOne', async () => { notified++; });
  await workflow.notifyNoOwnerLeads(now);
  assert.equal(state.messages.length, 2); assert.equal(notified, 1);
  assert.match(state.messages[0][1], /No Owner Leads summary: 1 lead released/);
  assert.match(state.messages[0][2], /Previous Owner/); assert.match(state.messages[0][2], /&lt;Example&gt;/); assert.match(state.messages[0][2], /No Owner Leads summary/);
  await workflow.notifyNoOwnerLeads(now + 60000); assert.equal(state.messages.length, 2);
});

test('summary recipient failure does not block the No Owner directory refresh', async t => {
  const service = require('../src/services/leadOwnershipAndEmailWorkflow');
  const lead = { _id: 'shared-2', noOwner: { movedAt: new Date(now), previousOwner: { name: 'Owner' } } };
  t.mock.method(Lead, 'find', filter => query(filter['noOwner.movedAt'] ? [lead] : []));
  t.mock.method(User, 'find', () => ({ select() { return this; }, lean: async () => { throw new Error('recipient lookup failed'); } }));
  const result = await service.refreshNoOwnerLeads(now);
  assert.equal(result.moved, 0);
  assert.equal(result.notificationPending, true);
});
