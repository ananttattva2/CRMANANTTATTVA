const test = require('node:test');
const assert = require('node:assert/strict');
const { selectLatestPoQuotation, enrichPoRowsWithLatestQuotation } = require('../src/services/poQuotationResolver');
const PendingApproval = require('../src/models/PendingApproval');
const Quotation = require('../src/models/Quotation');
const leadController = require('../src/controllers/leadController');

const oldQuotation = {
  _id: '507f1f77bcf86cd799439001', quotationNumber: 'AT/26-27/334', pricingMode: 'individual',
  updatedAt: '2026-10-20T10:00:00.000Z',
  items: [{ assignedServiceId: 'service-1', applicantType: 'Producer', serviceCategory: 'EPR - Plastic Waste', unit: 1, basicAmount: 25000 }]
};
const latestQuotation = {
  ...oldQuotation, updatedAt: '2026-10-27T10:00:00.000Z',
  items: [25000, 25000, 25000, 25000, 30000].map((basicAmount) => ({ assignedServiceId: 'service-1', applicantType: 'Producer', serviceCategory: 'EPR - Plastic Waste', unit: 1, basicAmount }))
};

test('PO approval resolves the newest matching quotation revision', () => {
  const row = { quotationSent: 'yes', quotationId: oldQuotation._id, quotationNumber: oldQuotation.quotationNumber, quotationBasicAmount: 25000 };
  const selected = selectLatestPoQuotation([oldQuotation, latestQuotation], row, { assignedServiceId: 'service-1' });
  assert.equal(selected.quotation.updatedAt, latestQuotation.updatedAt);
  assert.equal(selected.items.length, 5);
});

test('PO approval replaces the submitted quotation snapshot amount with the latest live value', () => {
  const rows = enrichPoRowsWithLatestQuotation([
    { quotationSent: 'yes', quotationId: oldQuotation._id, quotationNumber: oldQuotation.quotationNumber, quotationBasicAmount: 25000 }
  ], [oldQuotation, latestQuotation], { assignedServiceId: 'service-1' });
  assert.equal(rows[0].quotationBasicAmount, 130000);
  assert.equal(rows[0].quotationNumber, 'AT/26-27/334');
});

test('manual earlier-quotation PO rows are not replaced by CRM quotation values', () => {
  const row = { quotationSent: 'no', quotationBasicAmount: 0, poAmount: 20000 };
  assert.deepEqual(enrichPoRowsWithLatestQuotation([row], [latestQuotation], {}), [row]);
});

test('PO review detail endpoint returns the latest live quotation amount instead of its old snapshot', async () => {
  const originalApprovalFind = PendingApproval.findOne;
  const originalQuotationFind = Quotation.find;
  const approvalId = '507f1f77bcf86cd799439099';
  PendingApproval.findOne = () => ({ lean: async () => ({
    _id: approvalId,
    sourceClientId: '507f1f77bcf86cd799439088:po:0',
    payload: {
      leadId: '507f1f77bcf86cd799439088', assignedServiceId: 'service-1', quotationSent: 'yes',
      poYearRows: [{ quotationSent: 'yes', quotationId: oldQuotation._id, quotationNumber: oldQuotation.quotationNumber, quotationBasicAmount: 25000 }]
    }
  }) });
  Quotation.find = () => ({ select() { return this; }, sort() { return this; }, lean: async () => [latestQuotation] });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  try {
    await leadController.getPurchaseOrderApproval({ params: { id: approvalId } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.approval.payload.poYearRows[0].quotationBasicAmount, 130000);
  } finally {
    PendingApproval.findOne = originalApprovalFind;
    Quotation.find = originalQuotationFind;
  }
});
