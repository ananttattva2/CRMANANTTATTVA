const test = require('node:test');
const assert = require('node:assert/strict');
const validate = async (form) => (await import('../../frontend/src/utils/proformaValidation.mjs')).validateProformaPoYears(form);
const complete = { fy: '2026-27', poNumber: 'PO-1', compliancePoFile: { name: 'po.pdf', url: 'https://example.com/po.pdf' }, serviceCategory: ['Consultancy'] };
test('proforma allows zero PO years including stale removed rows', async () => {
  assert.equal(await validate({ poYearCount: 0, poYearRows: [] }), '');
  assert.equal(await validate({ poYearCount: 0, poYearRows: [{}] }), '');
});
test('proforma checks each requested PO year including missing rows', async () => {
  assert.equal(await validate({ poYearCount: 1, poYearRows: [complete] }), '');
  assert.match(await validate({ poYearCount: 2, poYearRows: [complete] }), /PO year 2/);
  for (const key of ['fy', 'poNumber', 'compliancePoFile', 'serviceCategory']) {
    assert.match(await validate({ poYearCount: 1, poYearRows: [{ ...complete, [key]: '' }] }), /PO year 1/);
  }
});
