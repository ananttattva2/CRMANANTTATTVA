const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
async function renderer() {
  const file = path.join(__dirname, '../../frontend/src/utils/proformaPdf.js');
  const jspdf = pathToFileURL(require.resolve('../../frontend/node_modules/jspdf/dist/jspdf.node.min.js')).href;
  const source = fs.readFileSync(file, 'utf8').replace("from 'jspdf'", `from '${jspdf}'`);
  return (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).buildInvoicePdf;
}
const sample = { proformaNumber: 'PI/26-27/001', invoiceDate: '2026-07-31', leadDetails: { companyName: 'Example Ltd' }, items: [{ serviceCategory: 'Consultancy fees', unit: '1', basicAmount: 35000 }], invoiceDetails: { deliveryDate: 'Invalid Date', buyerOrderDate: 'bad-date' }, scopeOfWork: ['HIDDEN_SCOPE_MARKER'] };
test('proforma reference layout fits one page, calculates totals and omits scope and invalid dates', async () => {
  const build = await renderer();
  const pdf = build(sample);
  assert.equal(pdf.getNumberOfPages(), 1);
  const content = pdf.output();
  assert.ok(content.includes('41,300.00'));
  assert.ok(content.includes('Forty One Thousand Three Hundred Only'));
  assert.ok(!content.includes('HIDDEN_SCOPE_MARKER'));
  assert.ok(!content.includes('Invalid Date'));
  assert.ok(content.includes('31-Jul-26'));
});
test('proforma supports multiple rows, combined prices and long invoice continuation', async () => {
  const build = await renderer();
  assert.equal(build({ ...sample, items: [sample.items[0], sample.items[0]] }).getNumberOfPages(), 1);
  const combined = build({ ...sample, pricingMode: 'combined', combinedBasicAmount: 100000 }).output();
  assert.ok(combined.includes('1,18,000.00'));
  const long = build({ ...sample, items: Array.from({ length: 35 }, () => sample.items[0]) });
  assert.ok(long.getNumberOfPages() > 1);
});
