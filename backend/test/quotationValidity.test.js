const test = require('node:test');
const assert = require('node:assert/strict');
const { quotationValidityError } = require('../src/utils/quotationValidity');
test('quotation validity requires a real calendar date', () => {
  for (const value of ['', null, undefined, '   ', '2026-02-30', '2026-13-01', '02-11-2026', 'invalid']) assert.ok(quotationValidityError(value), String(value));
  for (const value of ['2026-11-02', '2024-02-29', '2026-12-31']) assert.equal(quotationValidityError(value), '');
});
test('create quotation rejects missing validity before writing to the database', async () => {
  const controller = require('../src/controllers/quotationController');
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await controller.createQuotation({ body: {}, user: {} }, res);
  assert.equal(res.code, 400);
  assert.match(res.body.error, /Quotation Valid Until is required/);
});

test('bulk quotation import reports missing validity without creating a quotation', async () => {
 const controller = require('../src/controllers/quotationController');
 const res = { json(body) { this.body = body; return this; }, status(code) { this.code = code; return this; } };
 await controller.bulkCreateQuotations({ body: { quotations: [{}] }, user: {} }, res);
 assert.equal(res.body.summary.failed, 1);
 assert.equal(res.body.summary.created, 0);
 assert.match(res.body.failures[0].error, /Quotation Valid Until is required/);
});
