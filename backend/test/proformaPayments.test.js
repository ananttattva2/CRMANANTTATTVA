const test = require('node:test');
const assert = require('node:assert/strict');
const { eligibleItems } = require('../src/services/proformaEligibility');
const { _test } = require('../src/controllers/proformaInvoiceController');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const quote = { items: [
  { assignedServiceId: 'open', serviceCategory: 'Plastic', piboCategory: 'Importer', basicAmount: 50000 },
  { assignedServiceId: 'closed', serviceCategory: 'Plastic', piboCategory: 'Brand Owner', basicAmount: 75000 }
] };
const lead = { serviceSelections: [{ assignedServiceId: 'open' }, { assignedServiceId: 'closed' }], assignments: [
  { assignedServiceId: 'open' },
  { assignedServiceId: 'closed', closedAt: '2026-11-16', poStatus: 'received', poYearRows: [{ poNumber: 'PO-1', poFileUrl: 'https://example.com/po.pdf' }] }
] };
test('only the closed service with uploaded PO is eligible, even within the same category', () => {
  assert.deepEqual(eligibleItems(quote, lead).map(item => item.sourceItemIndex), [1]);
  const noProof = structuredClone(lead);
  noProof.assignments[1].poYearRows[0].poFileUrl = '';
  assert.deepEqual(eligibleItems(quote, noProof), []);
  const provisional = structuredClone(lead);
  provisional.assignments[1].poStatus = 'provisional';
  assert.deepEqual(eligibleItems(quote, provisional), []);
  const reordered = { ...lead, assignments: [...lead.assignments].reverse() };
  assert.deepEqual(eligibleItems(quote, reordered).map(item => item.sourceItemIndex), [1]);
});
test('50% advance and later payments each invoice 62500 basic plus GST without changing full prices', () => {
  for (const paymentStage of ['advance', 'later']) {
    const payload = _test.cleanPayload({ paymentPercentage: 50, paymentStage, items: [{ basicAmount: 125000, unit: '1', serviceCategory: 'Consultancy' }] });
    assert.equal(payload.fullSubtotal, 125000);
    assert.equal(payload.subtotal, 62500);
    assert.equal(payload.gstAmount, 11250);
    assert.equal(payload.grandTotal, 73750);
    assert.equal(payload.items[0].basicAmount, 125000);
    assert.equal(payload.paymentStage, paymentStage);
  }
});
test('PDF mirrors buyer details, removes delivery fields and calculates state-specific payment taxes', async () => {
  const stampPath = path.join(__dirname, '../../frontend/src/assets/proforma-authorized-stamp.png');
  const stampData = `data:image/png;base64,${fs.readFileSync(stampPath, 'base64')}`;
  const stampModule = `data:text/javascript,export%20default%20${encodeURIComponent(JSON.stringify(stampData))}`;
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/utils/proformaPdf.js'), 'utf8')
    .replace("from 'jspdf'", `from '${pathToFileURL(require.resolve('../../frontend/node_modules/jspdf')).href}'`)
    .replace("from '../assets/proforma-authorized-stamp.png?inline'", `from '${stampModule}'`);
  const { buildInvoicePdf } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const row = { proformaNumber: 'PI/26-27/001', poNumber: 'PO-1001', paymentPercentage: 50, paymentStage: 'advance', leadDetails: { companyName: 'BUYER LIMITED', gstNumber: '27ABCDE1234F1Z5', state: 'Maharashtra' }, invoiceDetails: { consignee: 'OLD SHIP NAME', dispatchDocument: 'REMOVE ME' }, items: [{ serviceCategory: 'Consultancy', basicAmount: 125000, unit: '1' }] };
  const local = buildInvoicePdf(row).output();
  assert.equal((local.match(/BUYER LIMITED/g) || []).length, 2);
  assert.match(local, /CGST OUTPUT 9%/);
  assert.match(local, /SGST OUTPUT 9%/);
  assert.match(local, /62,500.00/);
  assert.match(local, /5,625.00/);
  assert.match(local, /PO-1001/);
  assert.doesNotMatch(local, /IGST OUTPUT|Dispatch Doc|Other References|Buyer's Order|OLD SHIP NAME|REMOVE ME/);
  const interstate = buildInvoicePdf({ ...row, leadDetails: { ...row.leadDetails, gstNumber: '29ABCDE1234F1Z5', state: 'Karnataka' } }).output();
  assert.match(interstate, /IGST OUTPUT 18%/);
  assert.doesNotMatch(interstate, /CGST OUTPUT|SGST OUTPUT/);
  if (process.env.PROFORMA_PREVIEW_DIR) {
    fs.mkdirSync(process.env.PROFORMA_PREVIEW_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.PROFORMA_PREVIEW_DIR, 'advance-maharashtra.pdf'), Buffer.from(buildInvoicePdf(row).output('arraybuffer')));
  }
});

test('server rejects percentages above the remaining service balance and permits the later 50%', async () => {
  const Quotation = require('../src/models/Quotation');
  const Lead = require('../src/models/Lead');
  const Invoice = require('../src/models/ProformaInvoice');
  const original = { quote: Quotation.findById, exists: Quotation.exists, lead: Lead.findById, invoices: Invoice.find };
  Quotation.exists = async () => true;
  Quotation.findById = () => ({ lean: async () => ({ ...quote, quotationNumber: 'Q-1', leadRef: 'lead' }) });
  Lead.findById = () => ({ lean: async () => lead });
  Invoice.find = () => ({ select: () => ({ lean: async () => [{ paymentPercentage: 50, items: [{ sourceItemIndex: 1 }] }] }) });
  try {
    const payload = _test.cleanPayload({ quotationId: 'quote', paymentPercentage: 51, items: [{ ...quote.items[1], sourceItemIndex: 1 }] });
    const actor = { _id: 'admin', role: 'superadmin' };
    assert.match(await _test.validateInvoice(payload, null, actor), /Only 50% remains/);
    payload.paymentPercentage = 50;
    assert.equal(await _test.validateInvoice(payload, null, actor), '');
    payload.poNumber = 'CUSTOMER-PO-EDITED';
    assert.equal(await _test.validateInvoice(payload, null, actor), '');
    assert.equal(payload.poNumber, 'CUSTOMER-PO-EDITED');
    assert.equal(payload.poYearRows[0].poNumber, 'PO-1');
    payload.poNumber = 'Q-1';
    assert.match(await _test.validateInvoice(payload, null, actor), /different from the quotation number/);
    payload.poNumber = 'PO-1';
    payload.pricingMode = 'combined';
    payload.combinedBasicAmount = 75000;
    assert.equal(await _test.validateInvoice(payload, null, actor), '');
    payload.items[0].sourceItemIndex = 0;
    assert.equal(await _test.validateInvoice(payload, null, actor), '');
    payload.items[0].sourceItemIndex = 99;
    assert.match(await _test.validateInvoice(payload, null, actor), /Only services from the selected quotation/);
    payload.paymentPercentage = 0;
    assert.match(await _test.validateInvoice(payload, null, actor), /payment percentage/);
  } finally { Quotation.findById = original.quote; Quotation.exists = original.exists; Lead.findById = original.lead; Invoice.find = original.invoices; }
});

test('PO closure submissions and legacy proof formats remain eligible without final manager assignment', () => {
  const submitted = structuredClone(lead);
  delete submitted.assignments[1].closedAt;
  Object.assign(submitted.assignments[1], { closureRequestedBy: 'sales-user', poApprovalStatus: 'PENDING' });
  submitted.assignments[1].poYearRows[0] = { poNumber: 'PO-1', poFile: { secureUrl: 'https://example.com/po.pdf', name: 'po.pdf' } };
  assert.deepEqual(eligibleItems(quote, submitted).map(item => item.sourceItemIndex), [1]);
  submitted.assignments[1].poApprovalStatus = 'REJECTED';
  assert.deepEqual(eligibleItems(quote, submitted), []);
  submitted.assignments[1].poApprovalStatus = 'PENDING';
  delete submitted.assignments[1].closureRequestedBy;
  assert.deepEqual(eligibleItems(quote, submitted), []);
});

test('legacy service labels and stale IDs match only one closed applicant service', () => {
  const legacy = { items: [{ assignedServiceId: 'old-id', sourceServiceIndex: 0, serviceCategory: 'EPR - Plastic Waste', piboCategory: 'Brand Owner', servicesOffered: 'Annual Return Filing' }] };
  const saved = { serviceSelections: [{ assignedServiceId: 'importer', eprCategory: 'Plastic Waste', subApplicantType: 'Importer', servicesOffered: 'Annual Return Filling' }, { assignedServiceId: 'brand', eprCategory: 'Plastic Waste', subApplicantType: 'Brand Owner', servicesOffered: 'Annual Return Filling' }], assignments: [{ assignedServiceId: 'importer' }, { assignedServiceId: 'brand', closureRequestedBy: 'sender', poStatus: 'received', poYearRows: [{ poNumber: 'PO-2', poProofUrl: 'https://example.com/po.pdf' }] }] };
  assert.equal(eligibleItems(legacy, saved)[0]?.assignedServiceId, 'brand');
  assert.equal(eligibleItems(legacy, saved)[0]?.sourceServiceIndex, 1);
});

 test('PI can be created without PO and EPR Credit uses target MT and calculated total', async () => {
  const Quotation = require('../src/models/Quotation');
  const Lead = require('../src/models/Lead');
  const Invoice = require('../src/models/ProformaInvoice');
  const controller = require('../src/controllers/proformaInvoiceController');
  const original = { quote: Quotation.findById, exists: Quotation.exists, lead: Lead.findById, invoices: Invoice.find };
  const credit = { businessCategory: 'EPR Credit', serviceCategory: 'EPR - Plastic Waste', servicesOffered: 'Category 1 - EOL', unit: '1', basicAmount: 1.2, eprCreditTargetMt: 100 };
  Quotation.exists = async () => true;
  Quotation.findById = () => ({ lean: async () => ({ quotationNumber: 'Q-CREDIT', leadRef: 'lead', items: [credit] }) });
  Lead.findById = () => ({ lean: async () => ({ serviceSelections: [], assignments: [] }) });
  Invoice.find = () => ({ select: () => ({ lean: async () => [] }) });
  try {
    let loaded;
    await controller.eligibleQuotation({ params: { id: 'quote' }, user: { role: 'superadmin' } }, { json: data => { loaded = data; } });
    assert.equal(loaded.items[0].unit, '100');
    assert.equal(loaded.items[0].basicAmount, 120000);
    assert.deepEqual(loaded.poYearRows, []);
    const payload = _test.cleanPayload({ quotationId: 'quote', quotationNumber: 'Q-CREDIT', paymentPercentage: 50, items: loaded.items });
    assert.equal(payload.subtotal, 60000);
    assert.equal(payload.grandTotal, 70800);
    assert.equal(await _test.validateInvoice(payload, null, { role: 'superadmin' }), '');
    assert.equal(payload.poNumber, '');
    const { invoicePdf } = require('../src/services/proformaEmail');
    const pdf = (await invoicePdf({ ...payload, proformaNumber: 'ATPI/26-27/203' })).toString();
    assert.match(pdf, /\(NA\)/);
    assert.match(pdf, /60,000.00/);
    assert.doesNotMatch(pdf, /6,000,000/);
    if (process.env.PROFORMA_PREVIEW_DIR) fs.writeFileSync(path.join(process.env.PROFORMA_PREVIEW_DIR, 'credit-no-po.pdf'), await invoicePdf({ ...payload, proformaNumber: 'ATPI/26-27/203' }));
  } finally { Quotation.findById = original.quote; Quotation.exists = original.exists; Lead.findById = original.lead; Invoice.find = original.invoices; }
});
