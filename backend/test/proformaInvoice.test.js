const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _test } = require('../src/controllers/proformaInvoiceController');

test('proforma payload preserves quotation, PO and calculated item totals', () => {
  const payload = _test.cleanPayload({
    quotationNumber: 'AT/26-27/292', poNumber: 'PO-1001',
    leadDetails: { companyName: 'Example Limited', contactPerson: 'Krishna' },
    items: [{ serviceCategory: 'CONSULTANCY FEE', unit: '2', basicAmount: '30000' }],
    poYearCount: 1,
    poYearRows: [{ fy: '2024-25', annualReturnYear: '2024-25', quotationNo: 'AT/26-27/292', compliancePoDate: '2026-07-31', compliancePoFile: { name: 'po.pdf', secureUrl: 'https://files.example/po.pdf', publicId: 'crm/po-1', type: 'application/pdf', size: 2048 }, serviceCategory: ['CONSULTANCY FEE'], value: '60000' }]
  });
  assert.equal(payload.quotationNumber, 'AT/26-27/292');
  assert.equal(payload.poNumber, 'PO-1001');
  assert.equal(payload.companyName, 'Example Limited');
  assert.equal(payload.subtotal, 60000);
  assert.equal(payload.gstRate, 18);
  assert.equal(payload.gstAmount, 10800);
  assert.equal(payload.grandTotal, 70800);
  assert.equal(payload.poYearCount, 1);
  assert.deepEqual(payload.poYearRows[0].serviceCategory, ['CONSULTANCY FEE']);
  assert.equal(payload.poYearRows[0].value, 60000);
  assert.equal(payload.poYearRows[0].compliancePoDate, '2026-07-31');
  assert.equal(payload.poYearRows[0].compliancePoFile.name, 'po.pdf');
  assert.equal(payload.poYearRows[0].compliancePoFile.secureUrl, 'https://files.example/po.pdf');
  assert.equal(payload.poYearRows[0].compliancePoFile.publicId, 'crm/po-1');
});

test('proforma routes require CRM authentication and are mounted', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/proformaInvoices.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
  assert.match(routes, /router\.get\('\/', requireAuth/);
  assert.match(routes, /router\.post\('\/', requireAuth/);
  assert.match(app, /app\.use\('\/api\/proforma-invoices', proformaInvoiceRoutes\)/);
});


test('invoice delivery, consignee and bank fields survive cleaning with explicit blanks', () => {
  const payload = _test.cleanPayload({ invoiceDetails: { paymentTerms: '', consignee: ' Ship To Ltd ', bankName: 'IDFC', accountNumber: '001234', hsn: '998311', unexpected: 'discard' } });
  assert.deepEqual(payload.invoiceDetails, { paymentTerms: '', consignee: 'Ship To Ltd', bankName: 'IDFC', accountNumber: '001234', hsn: '998311' });
  assert.deepEqual(_test.cleanPayload({}).invoiceDetails, {});
});
