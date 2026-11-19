const { afterEach, test } = require('node:test');
const assert = require('node:assert/strict');
const Quotation = require('../src/models/Quotation');
const Lead = require('../src/models/Lead');
const mailer = require('../src/utils/mailer');
const delivery = require('../src/services/quotationDelivery');
const controller = require('../src/controllers/quotationController');

const query = value => ({
  select() { return this; },
  populate() { return this; },
  lean: async () => value,
  then: (yes, no) => Promise.resolve(value).then(yes, no)
});

function response() {
  return {
    code: 200,
    status(value) { this.code = value; return this; },
    json(value) { this.body = value; return this; }
  };
}

afterEach(() => require('node:test').mock.restoreAll());

test('EPR Credit Target values are validated for every EPR Credit quotation item', () => {
  const { normalizeEprCreditTargetUpdates } = controller._test;
  const items = [
    { businessCategory: 'EPR Credit' },
    { businessCategory: 'EPR Consultancy' },
    { businessCategory: 'EPR Credit' }
  ];

  assert.deepEqual(normalizeEprCreditTargetUpdates(items, [
    { itemIndex: 0, targetKg: '10' },
    { itemIndex: 2, targetKg: 0.25 }
  ]), {
    values: [
      { itemIndex: 0, targetKg: 10 },
      { itemIndex: 2, targetKg: 0.25 }
    ]
  });
  assert.match(normalizeEprCreditTargetUpdates(items, [{ itemIndex: 0, targetKg: 10 }]).error, /every EPR Credit item/i);
  assert.match(normalizeEprCreditTargetUpdates(items, [
    { itemIndex: 0, targetKg: -1 },
    { itemIndex: 2, targetKg: 5 }
  ]).error, /non-negative number/i);
});

test('EPR Credit targets persist on approved quotation items', async t => {
  let saved = false;
  const quotation = {
    status: 'admin_approved',
    items: [
      { businessCategory: 'EPR Credit', basicAmount: 2 },
      { businessCategory: 'EPR Consultancy', basicAmount: 500 },
      { businessCategory: 'EPR Credit', basicAmount: 0.94 }
    ],
    markModified() {},
    async save() { saved = true; }
  };
  t.mock.method(Quotation, 'findOne', async () => quotation);
  const res = response();

  await controller.updateEprCreditCalculations({
    user: { role: 'admin' },
    params: { id: 'quotation-1' },
    body: { targets: [{ itemIndex: 0, targetKg: 10 }, { itemIndex: 2, targetKg: 5 }] }
  }, res);

  assert.equal(res.code, 200);
  assert.equal(saved, true);
  assert.equal(quotation.items[0].eprCreditTargetKg, 10);
  assert.equal(quotation.items[1].eprCreditTargetKg, undefined);
  assert.equal(quotation.items[2].eprCreditTargetKg, 5);
});

test('approved quotation email includes the converted EPR Credit calculation table', async t => {
  let sent;
  const quotation = {
    _id: '507f1f77bcf86cd799439012',
    quotationNumber: 'AT-TEST-CREDIT',
    status: 'admin_approved',
    leadDetails: { companyName: 'Test Client' },
    items: [{
      businessCategory: 'EPR Credit',
      servicesOffered: '<script>Annual Return</script>',
      unit: '1',
      unitLabel: 'KG',
      basicAmount: 2,
      eprCreditTargetKg: 10
    }]
  };
  t.mock.method(Lead, 'find', () => query([]));
  t.mock.method(Quotation, 'findOne', () => query(quotation));
  t.mock.method(Quotation, 'updateOne', async () => {});
  t.mock.method(delivery, 'createApprovedQuotationPdf', async () => Buffer.from('%PDF-test'));
  t.mock.method(mailer, 'sendMail', async (...args) => { sent = args; });

  const res = response();
  await controller.emailQuotation({
    user: { _id: '507f1f77bcf86cd799439011', email: 'sender@example.test', role: 'admin' },
    params: { id: quotation._id },
    body: { email: 'client@example.test', subject: 'Quotation', body: 'Please see the details.' }
  }, res, error => { throw error; });

  assert.equal(res.code, 200);
  assert.match(sent[2], /EPR Credit Calculation/);
  assert.match(sent[2], /Services Offered/);
  assert.match(sent[2], /Basic Amount \(INR\)/);
  assert.match(sent[2], /Target \(kg\)/);
  assert.match(sent[2], /Total Amount \(INR\)/);
  assert.match(sent[2], /₹2,000\.00/);
  assert.match(sent[2], /₹20,000\.00/);
  assert.match(sent[2], /&lt;script&gt;Annual Return&lt;\/script&gt;/);
  assert.doesNotMatch(sent[2], /<script>/);
});
