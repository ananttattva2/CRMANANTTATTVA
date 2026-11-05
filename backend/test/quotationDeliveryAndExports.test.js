const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const User = require('../src/models/User');
const Lead = require('../src/models/Lead');
const Quotation = require('../src/models/Quotation');
const DataExport = require('../src/models/DataExport');
const Notification = require('../src/models/Notification');
const mailer = require('../src/utils/mailer');
const delivery = require('../src/services/quotationDelivery');
const controller = require('../src/controllers/quotationController');
const { requireRoles } = require('../src/middleware/auth');
const query = value => ({ select() { return this; }, populate() { return this; }, lean: async () => value, then: (yes, no) => Promise.resolve(value).then(yes, no) });
const actor = { _id: '507f1f77bcf86cd799439011', name: 'Test User', email: 'user@example.test', role: 'operation' };
const quote = { _id: '507f1f77bcf86cd799439012', quotationNumber: 'AT-TEST-01', status: 'admin_approved', createdAt: new Date(), leadDetails: { companyName: 'Test Client' }, items: [{ serviceCategory: 'EPR', servicesOffered: 'Annual Return', unit: 1, basicAmount: 2000 }], subtotal: 2000, grandTotal: 2000, terms: ['Payment before work starts'], scopeOfWork: ['Prepare and file annual return'] };
function response() { return { code: 200, status(value) { this.code = value; return this; }, json(value) { this.body = value; return this; }, set() { return this; }, type() { return this; }, attachment(value) { this.filename = value; return this; }, send(value) { this.body = value; return this; } }; }
afterEach(() => require('node:test').mock.restoreAll());

test('only current approval enables delivery; revisions cannot reuse historical approval', () => {
  for (const status of ['draft', 'submitted', 'rejected']) assert.equal(delivery.isApproved({ status, managementApproval: { adminApprovalStatus: 'APPROVED' } }), false);
  for (const status of ['admin_approved', 'approved']) assert.equal(delivery.isApproved({ status }), true);
});

test('PDF permissions reject staff and accept both primary and secondary admin roles', () => {
  const gate = requireRoles(['admin', 'superadmin']);
  const denied = response(); gate({ user: actor }, denied, () => assert.fail('staff download allowed')); assert.equal(denied.code, 403);
  for (const user of [{ role: 'admin' }, { role: 'superadmin' }, { role: 'operation', roles: ['admin'] }]) { let passed = false; gate({ user }, response(), () => { passed = true; }); assert.equal(passed, true); }
});

test('approved client email uses server PDF, entered recipient, escaped message and inline company signature', async t => {
  let message, history;
  t.mock.method(Lead, 'find', () => query([]));
  t.mock.method(Quotation, 'findOne', filter => { assert.ok(filter.$and, 'staff access scope is applied'); return query(quote); });
  t.mock.method(Quotation, 'updateOne', async (_filter, update) => { history = update.$push.emailHistory; });
  t.mock.method(mailer, 'sendMail', async (...args) => { message = args; });
  const res = response();
  await controller.emailQuotation({ user: actor, params: { id: quote._id }, body: { email: 'Client@example.test', cc: 'Finance@example.test; manager@example.test, finance@example.test, client@example.test', subject: 'Your quotation', body: 'Hello <script>alert(1)</script>\nPlease review.' } }, res, error => { throw error; });
  assert.equal(res.code, 200); assert.equal(message[0], 'client@example.test');
  assert.match(message[2], /&lt;script&gt;/); assert.doesNotMatch(message[2], /<script>/);
  assert.match(message[2], /Thanks &amp; Regards/); assert.match(message[2], /आओ सब मिलकर/); assert.match(message[2], /whatsapp.com\/channel/);
  assert.equal(message[3].attachments.length, 2);
  assert.equal(message[3].attachments[0].filename, 'Test Client.pdf');
  assert.equal(message[3].attachments[0].content.subarray(0, 5).toString(), '%PDF-');
  assert.equal(message[3].attachments[1].contentDisposition, 'inline');
  assert.equal(history.to, 'client@example.test');
  assert.deepEqual(message[3].cc, ['finance@example.test', 'manager@example.test']);
  assert.deepEqual(history.cc, message[3].cc);
});

test('invalid or excessive CC recipients are rejected before sending', async t => {
  t.mock.method(mailer, 'sendMail', async () => assert.fail('Invalid CC was sent'));
  for (const cc of ['invalid-email', 'bad@example.test\rBcc: secret@example.test', Array.from({ length: 11 }, (_, i) => `person${i}@example.test`)]) {
    const res = response();
    await controller.emailQuotation({ user: actor, params: { id: quote._id }, body: { email: 'client@example.test', cc, subject: 'Quote', body: 'Review' } }, res, error => { throw error; });
    assert.equal(res.code, 400);
  }
});

test('unapproved quotations cannot be emailed or downloaded by staff', async t => {
  t.mock.method(Lead, 'find', () => query([]));
  let current = { ...quote, status: 'submitted' };
  t.mock.method(Quotation, 'findOne', () => query(current));
  t.mock.method(mailer, 'sendMail', async () => assert.fail('unapproved mail sent'));
  const req = { user: actor, params: { id: quote._id }, body: { email: 'client@example.test', subject: 'Quote', body: 'Review' } };
  for (const handler of [controller.emailQuotation, controller.downloadQuotation]) { const res = response(); await handler(req, res, error => { throw error; }); assert.equal(res.code, 403); }
  current = null;
  const res = response(); await controller.emailQuotation(req, res, error => { throw error; }); assert.equal(res.code, 404);
});

test('an approved admin download returns the client-named PDF attachment', async t => {
  t.mock.method(Quotation, 'findOne', () => query(quote));
  const res = response();
  await controller.downloadQuotation({ user: { ...actor, role: 'admin' }, params: { id: quote._id } }, res, error => { throw error; });
  assert.equal(res.code, 200);
  assert.equal(res.filename, 'Test Client.pdf');
  assert.equal(res.body.subarray(0, 5).toString(), '%PDF-');
});

test('Admin and Super Admin can download an unapproved quotation PDF', async t => {
  const submittedQuote = { ...quote, status: 'submitted' };
  t.mock.method(Quotation, 'findOne', () => query(submittedQuote));
  t.mock.method(delivery, 'createApprovedQuotationPdf', async (quotation, options) => {
    assert.equal(quotation.status, 'submitted');
    assert.deepEqual(options, { allowUnapproved: true });
    return Buffer.from('%PDF-test');
  });
  for (const user of [{ ...actor, role: 'admin' }, { ...actor, role: 'superadmin' }, { ...actor, roles: ['admin'] }]) {
    const res = response();
    await controller.downloadQuotation({ user, params: { id: quote._id } }, res, error => { throw error; });
    assert.equal(res.code, 200);
    assert.equal(res.filename, 'Test Client.pdf');
    assert.equal(res.body.subarray(0, 5).toString(), '%PDF-');
  }
});

test('email provider failure is returned without recording a successful send', async t => {
  t.mock.method(Lead, 'find', () => query([]));
  t.mock.method(Quotation, 'findOne', () => query(quote));
  t.mock.method(mailer, 'sendMail', async () => { throw new Error('provider unavailable'); });
  t.mock.method(Quotation, 'updateOne', async () => assert.fail('success logged'));
  let caught;
  await controller.emailQuotation({ user: actor, params: { id: quote._id }, body: { email: 'client@example.test', subject: 'Quote', body: 'Review' } }, response(), error => { caught = error; });
  assert.match(caught.message, /provider unavailable/);
});

test('export needs a reason, records IST timestamp and emails all active administrator recipients', async t => {
  let messages = [], record;
  t.mock.method(User, 'find', () => query([{ email: 'admin@example.test' }, { email: 'super@example.test' }]));
  t.mock.method(DataExport, 'create', async data => { record = { ...data, _id: 'export-1', createdAt: new Date('2026-11-04T05:00:00Z'), save: async () => {} }; return record; });
  t.mock.method(Notification, 'create', async data => ({ ...data, _id: 'notification-1' }));
  t.mock.method(mailer, 'sendMail', async (...args) => { messages.push(args); });
  // Load after mail mock because this router destructures the provider function.
  const routePath = require.resolve('../src/routes/dataExports'); delete require.cache[routePath];
  const handler = require(routePath).stack[0].route.stack.at(-1).handle;
  const req = { user: actor, body: { section: 'Lead Generation (/leads)', filename: 'leads.xlsx', reason: '' } };
  const invalid = response(); await handler(req, invalid, error => { throw error; }); assert.equal(invalid.code, 400); assert.equal(messages.length, 0);
  req.body.reason = 'Prepare the monthly client follow-up report';
  const res = response(); await handler(req, res, error => { throw error; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(res.code, 200); assert.equal(record.status, 'authorized');
  assert.deepEqual(record.notifiedEmails, ['admin@example.test', 'super@example.test']);
  assert.equal(messages.length, 2); assert.match(messages[0][2], /10:30:00/); assert.match(messages[0][2], /IST/); assert.match(messages[0][2], /monthly client follow-up report/);
});

test('email provider failure does not block an audited in-app administrator notification', async t => {
  let record;
  t.mock.method(User, 'find', () => query([{ email: 'admin@example.test' }]));
  t.mock.method(DataExport, 'create', async data => { record = { ...data, _id: 'export-2', createdAt: new Date(), save: async () => {} }; return record; });
  t.mock.method(Notification, 'create', async data => ({ ...data, _id: 'notification-2' }));
  t.mock.method(mailer, 'sendMail', async () => { throw new Error('offline'); });
  const routePath = require.resolve('../src/routes/dataExports'); delete require.cache[routePath];
  const handler = require(routePath).stack[0].route.stack.at(-1).handle;
  const res = response(); await handler({ user: actor, body: { section: 'Clients', filename: 'clients.xlsx', reason: 'Client review meeting' } }, res, error => { throw error; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(res.code, 200); assert.equal(record.status, 'authorized'); assert.equal(record.emailStatus, 'failed');
});
