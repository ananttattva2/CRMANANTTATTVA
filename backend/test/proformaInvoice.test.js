const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _test } = require('../src/controllers/proformaInvoiceController');
const { assignmentForService } = require('../src/services/proformaEligibility');
const ProformaInvoice = require('../src/models/ProformaInvoice');

test('proforma payload preserves quotation, PO and calculated item totals', () => {
  const payload = _test.cleanPayload({
    quotationNumber: 'AT/26-27/292', poNumber: 'AT/26-27/525',
    leadDetails: { companyName: 'Example Limited', contactPerson: 'Krishna' },
    items: [{ serviceCategory: 'CONSULTANCY FEE', unit: '2', basicAmount: '30000' }],
    poYearCount: 1,
    poYearRows: [{ fy: '2024-25', annualReturnYear: '2024-25', quotationNo: 'AT/26-27/292', compliancePoDate: '2026-07-31', compliancePoFile: { name: 'po.pdf', secureUrl: 'https://files.example/po.pdf', publicId: 'crm/po-1', type: 'application/pdf', size: 2048 }, serviceCategory: ['CONSULTANCY FEE'], value: '60000' }]
  });
  assert.equal(payload.quotationNumber, 'AT/26-27/292');
  assert.equal(payload.poNumber, 'AT/26-27/525');
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

test('proforma defaults to the lead PO but preserves a distinct invoice PO override', () => {
  const leadPoRows = [
    { poNumber: 'CUSTOMER-PO-203', quotationNumber: 'AT/26-27/525', fy: '2026-27' },
    { poNumber: '', quotationNumber: 'AT/26-27/526' }
  ];
  const payload = { poNumber: 'CUSTOMER-PO-EDITED', poYearRows: [] };
  const applied = _test.applyLeadPoRows(payload, leadPoRows, 'AT/26-27/525');
  assert.equal(applied, true);
  assert.equal(payload.poNumber, 'CUSTOMER-PO-EDITED');
  assert.equal(payload.poYearRows.length, 1);
  const defaulted = { poNumber: '' };
  assert.equal(_test.applyLeadPoRows(defaulted, leadPoRows, 'AT/26-27/525'), true);
  assert.equal(defaulted.poNumber, 'CUSTOMER-PO-203');
  assert.equal(_test.applyLeadPoRows({ poNumber: 'AT/26-27/525' }, [
    { poNumber: 'AT/26-27/525' }
  ], 'AT/26-27/525'), false);
});

test('quotation PO lookup selects rows linked to that quotation and supports unlinked legacy rows', () => {
  const rows = [
    { poNumber: 'PO-OLD', quotationId: 'quotation-a', quotationNumber: 'AT/26-27/100' },
    { poNumber: 'PO-CURRENT', quotationId: 'quotation-b', quotationNumber: 'AT/26-27/200' }
  ];
  assert.deepEqual(_test.poRowsForQuotation(rows, { _id: 'quotation-b', quotationNumber: 'AT/26-27/200' }), [rows[1]]);
  assert.deepEqual(_test.poRowsForQuotation([{ poNumber: 'PO-LEGACY' }], { _id: 'quotation-b' }), [{ poNumber: 'PO-LEGACY' }]);
});

test('quotation PO lookup does not fall back to a different service assignment by index', () => {
  const lead = {
    assignments: [
      { assignedServiceId: 'service-a', poYearRows: [{ poNumber: 'PO-A' }] },
      { assignedServiceId: 'service-b', poYearRows: [{ poNumber: 'PO-B' }] }
    ]
  };
  assert.equal(assignmentForService(lead, 'service-b', 0, 2), lead.assignments[1]);
  assert.deepEqual(assignmentForService(lead, 'service-c', 0, 2), {});
});

test('new Proforma invoice numbers start at 203 and continue after the highest number', async () => {
  const originalAggregate = ProformaInvoice.aggregate;
  const now = new Date();
  const start = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fy = `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
  let highestSequence = 2;
  ProformaInvoice.aggregate = async (pipeline) => {
    assert.ok(pipeline[0].$match.proformaNumber.test(`PI/${fy}/123`));
    assert.equal(pipeline[0].$match.proformaNumber.flags, 'i');
    assert.ok(pipeline[0].$match.proformaNumber.test(`ATPI/${fy}/123`));
    return [{ sequence: highestSequence }];
  };
  try {
    assert.equal(await _test.nextProformaNumber(), `ATPI/${fy}/203`);
    highestSequence = 203;
    assert.equal(await _test.nextProformaNumber(), `ATPI/${fy}/204`);
    highestSequence = 525;
    assert.equal(await _test.nextProformaNumber(), `ATPI/${fy}/526`);
  } finally {
    ProformaInvoice.aggregate = originalAggregate;
  }
});
