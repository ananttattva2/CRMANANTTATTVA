const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPurchaseOrders, monthlyLeadProjection } = require('../src/controllers/purchaseOrderController');
const { purchaseOrderLeadOwner } = require('../src/services/purchaseOrderLeadOwner');
const model = records => ({ find: () => ({ select() { return this; }, maxTimeMS() { return this; }, lean: async () => records }) });
test('PO rows share permanent lead owner even when different users close services', async () => {
  const lead = { _id: 'lead', createdBy: 'admin', createdByName: 'Admin', generatedForUser: '64b000000000000000000001', generatedForName: 'Old name', assignments: [
    { closedBy: 'staff1', closedByText: 'Executor 1', poYearRows: [{ poNumber: 'PO1', poDate: '2026-04-10', poAmount: 100 }] },
    { closedBy: 'staff2', closedByText: 'Executor 2', poYearRows: [{ poNumber: 'PO2', poDate: '2026-04-11', poAmount: 200 }] }
  ] };
  const records = await loadPurchaseOrders({ Lead: model([lead]), Client: model([]), Quotation: model([]), User: model([{ _id: lead.generatedForUser, name: 'Sales Owner' }]) }, {}, { monthly: true });
  assert.deepEqual(records.map(r => r.leadOwnerName), ['Sales Owner', 'Sales Owner']);
  assert.equal(records[0].ownerName, 'Executor 1');
  const { monthlyPO, poAmount, piboPO } = await import('../../frontend/src/utils/poMonthly.mjs');
  const dashboardRecords = records.map(r => ({ ...r, ownerId: r.leadOwnerId, ownerName: r.leadOwnerName }));
  const matrix = monthlyPO(dashboardRecords, '2026-27');
  assert.equal(matrix.rows.length, 1);
  assert.equal(matrix.rows[0].name, 'Sales Owner');
  assert.equal(matrix.rows[0].records.length, 2);
  assert.equal(poAmount(matrix.records), 300);
  assert.equal(piboPO(dashboardRecords, '2026-27').rows.length, 1);
  assert.equal(monthlyLeadProjection.generatedForUser, 1);
});
test('lead ownership precedence includes on-behalf, creator, and legacy names without actor fallback', () => {
  assert.deepEqual(purchaseOrderLeadOwner({ createdOnBehalfOfUser: 'sales', createdOnBehalfOfName: 'Owner', createdByName: 'Admin' }), { id: 'sales', name: 'Owner' });
  assert.equal(purchaseOrderLeadOwner({ createdBy: { _id: 'creator', name: 'Creator' }, closedByText: 'Executor' }).name, 'Creator');
  assert.equal(purchaseOrderLeadOwner({ importedCreatedBy: 'Imported Owner', assignedToText: 'Manager' }).name, 'Imported Owner');
  assert.equal(purchaseOrderLeadOwner({ assignedToText: 'Manager', closedByText: 'Executor' }).name, 'Unassigned');
});
