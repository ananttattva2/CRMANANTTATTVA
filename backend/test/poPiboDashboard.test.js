const test = require('node:test');
const assert = require('node:assert/strict');
test('PIBO matrix preserves fiscal/user filtering and counts every record exactly once', async () => {
  const { piboPO, poAmount } = await import('../../frontend/src/utils/poMonthly.mjs');
  const record = (child, amount, extra = {}) => ({ ownerId: 'owner', ownerName: 'Sonal', poDate: '2026-04-10', applicantType: 'PIBO', subApplicantType: child, poAmount: amount, ...extra });
  const records = [record('Brand Owner', 100), record(' importer ', 200), record('Producer', 50), record('Producer (Small & Micro)', 20, { applicantType: 'SIMP' }), record('Not specified', 30, { applicantType: 'Not specified' }), record('Brand Owner', 999, { poDate: '2025-04-10' }), record('Brand Owner', 999, { ownerId: 'other', ownerName: 'Prachi' })];
  const matrix = piboPO(records, '2026-27', ' sonal ');
  assert.equal(matrix.records.length, 5);
  assert.equal(matrix.rows.length, 1);
  const row = matrix.rows[0];
  assert.equal(row.cells[0].length, 1);
  assert.equal(row.cells[2].length, 1);
  assert.equal(poAmount(row.cells[2]), 200);
  assert.ok(matrix.columns.includes('SIMP · Producer (Small & Micro)'));
  assert.ok(matrix.columns.includes('Not specified'));
  assert.equal(row.cells.flat().length, 5);
  assert.equal(poAmount(row.cells.flat()), poAmount(matrix.records));
  assert.equal(poAmount(matrix.records), 400);
});
test('PO loader resolves category by service ID when assignments are reordered', async () => {
  const { loadPurchaseOrders, monthlyLeadProjection } = require('../src/controllers/purchaseOrderController');
  const model = data => ({ find: () => ({ lean: async () => data }) });
  const records = await loadPurchaseOrders({ Lead: model([{ _id: 'lead', serviceSelections: [
    { assignedServiceId: 'brand', applicantType: 'PIBO', subApplicantType: 'Brand Owner' },
    { assignedServiceId: 'import', applicantType: 'PIBO', subApplicantType: 'Importer' }
  ], assignments: [{ assignedServiceId: 'import', poYearRows: [{ poNumber: 'PO-1', poAmount: 200 }] }] }]), Client: model([]), Quotation: model([]) });
  assert.equal(records[0].subApplicantType, 'Importer');
  assert.equal(records[0].applicantType, 'PIBO');
  assert.equal(monthlyLeadProjection.serviceSelections.$map.in.subApplicantType, '$$service.subApplicantType');
});
