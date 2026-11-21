const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
async function renderer() {
  const file = path.join(__dirname, '../src/utils/proformaPdf.js');
  const jspdf = pathToFileURL(require.resolve('../node_modules/jspdf/dist/jspdf.node.min.js')).href;
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

test('proforma shows explicitly selected Annual Return years instead of the derived service year', async () => {
  const build = await renderer();
  const pdf = build({
    ...sample,
    items: [{
      serviceCategory: 'EPR - Plastic Waste',
      servicesOffered: 'Annual Return',
      servicesForYear: '2025-26',
      annualReturnYears: ['2024-25'],
      basicAmount: 35000
    }]
  });
  const content = pdf.output();
  assert.ok(content.includes('Annual Return: 2024-25'));
  assert.ok(!content.includes('2025-26'));
});

test('PI view and download use the approved bank block instead of stale saved bank fields', async () => {
  const build = await renderer();
  const pdf = build({ ...sample, invoiceDetails: { bankName: 'OLD_BANK_MARKER', accountName: 'OLD_ACCOUNT_MARKER', accountNumber: 'OLD_NUMBER_MARKER', ifsc: 'OLD_IFSC_MARKER', pan: 'OLD_PAN_MARKER' } });
  const content = pdf.output();
  for (const line of ['AnantTattva Private Limited', 'BANK NAME- IDFC FIRST BANK', 'ACCOUNT NO.- 10160512998', 'IFS CODE- IDFB0040111', 'TYPE OF A/C.- CURRENT', 'BRANCH MUMBAI-BORIVALI-WEST']) assert.ok(content.includes(line), line);
  for (const marker of ['OLD_BANK_MARKER', 'OLD_ACCOUNT_MARKER', 'OLD_NUMBER_MARKER', 'OLD_IFSC_MARKER', 'OLD_PAN_MARKER', "Company's PAN:"]) assert.ok(!content.includes(marker), marker);
  assert.equal(pdf.getNumberOfPages(), 1);
});
