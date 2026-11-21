const test = require('node:test');
const assert = require('node:assert/strict');
const Invoice = require('../src/models/ProformaInvoice');
const User = require('../src/models/User');
const mailer = require('../src/utils/mailer');
const delivery = require('../src/services/proformaEmail');
const controller = require('../src/controllers/proformaInvoiceController');

test('invoice email validates recipients and rejects header injection', () => {
  assert.deepEqual(delivery.emails('A@example.test, b@example.test; a@example.test'), ['a@example.test', 'b@example.test']);
  assert.throws(() => delivery.validateMessage({ to: 'bad', subject: 'Invoice', body: 'Hello' }), /valid email/);
  assert.throws(() => delivery.validateMessage({ to: 'a@example.test', subject: 'Invoice\nBcc: victim@example.test', body: 'Hello' }), /subject/);
  assert.throws(() => delivery.validateMessage({ to: '', subject: 'Invoice', body: 'Hello' }), /To recipients/);
});

test('server attaches saved invoice PDF and enforces creator, sender, admin and Finance CC', async t => {
  const row = { _id: '507f1f77bcf86cd799439099', status: 'issued', proformaNumber: 'PI/26-27/203', poNumber: 'ATPL/Nov/01', companyName: 'Demo Company', createdBy: { email: 'creator@example.test' }, invoiceDate: '2026-11-21', items: [{ serviceCategory: 'Consultancy', unit: 1, basicAmount: 1000 }] };
  const people = [
    { email: 'admin@example.test', role: 'admin' },
    { email: 'super@example.test', role: 'operation', roles: ['Super Admin'] },
    { email: 'finance@example.test', role: 'finance' },
    { email: 'accounts@example.test', role: 'operation', team: 'Accounts' },
    { email: 'unrelated@example.test', role: 'sales' }
  ];
  let sent, audit, filter;
  t.mock.method(User, 'find', () => ({ select() { return this; }, lean: async () => people }));
  t.mock.method(Invoice, 'findOne', value => { filter = value; return { populate() { return this; }, lean: async () => row }; });
  t.mock.method(Invoice, 'updateOne', async (query, update) => { audit = update; });
  t.mock.method(mailer, 'sendMail', async (to, subject, html, options) => { sent = { to, subject, html, options }; return {}; });
  const req = { params: { id: row._id }, user: { _id: 'sales-id', role: 'sales', email: 'sender@example.test', name: 'Sender' }, body: { to: 'client@example.test', cc: 'extra@example.test, client@example.test', subject: 'Your invoice', body: 'Dear Client,\nPlease review <attached>.' } };
  let response;
  await controller.sendEmail(req, { json: value => { response = value; } }, error => { throw error; });
  assert.deepEqual(filter.createdBy.$in, ['sales-id']);
  assert.deepEqual(sent.to, ['client@example.test']);
  assert.deepEqual(new Set(sent.options.cc), new Set(['extra@example.test', 'creator@example.test', 'sender@example.test', 'admin@example.test', 'super@example.test', 'finance@example.test', 'accounts@example.test']));
  assert.ok(sent.html.includes('&lt;attached&gt;'));
  const pdf = sent.options.attachments[0];
  assert.equal(pdf.contentType, 'application/pdf');
  assert.ok(pdf.content.subarray(0, 4).equals(Buffer.from('%PDF')));
  assert.ok(pdf.content.toString().includes('PI/26-27/203'));
  assert.ok(pdf.content.toString().includes('ATPL/Nov/01'));
  assert.equal(audit.$push.emailHistory.subject, 'Your invoice');
  assert.equal(response.ok, true);
  row.status = 'cancelled';
  let failure;
  await controller.sendEmail(req, {}, error => { failure = error; });
  assert.equal(failure.status, 400);
});

test('email endpoint rejects inaccessible invoices before PDF generation or sending', async t => {
  t.mock.method(Invoice, 'findOne', () => ({ populate() { return this; }, lean: async () => null }));
  t.mock.method(mailer, 'sendMail', () => { assert.fail('Must not email an inaccessible invoice'); });
  let failure;
  await controller.sendEmail({ params: { id: 'missing' }, user: { _id: 'sales-id', role: 'sales' }, body: { to: 'client@example.test', subject: 'Invoice', body: 'Hello' } }, {}, error => { failure = error; });
  assert.equal(failure.status, 404);
});
