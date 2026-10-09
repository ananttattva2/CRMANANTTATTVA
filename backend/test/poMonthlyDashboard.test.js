const test = require('node:test');
const assert = require('node:assert/strict');
test('PO months use Indian fiscal boundaries and reject missing dates', async () => {
  const { poPeriod, PO_MONTHS } = await import('../../frontend/src/utils/poMonthly.mjs');
  assert.equal(PO_MONTHS.length, 12);
  assert.deepEqual(poPeriod('2026-03-31T18:29:59Z'), { year: '2025-26', month: 11 });
  assert.deepEqual(poPeriod('2026-03-31T18:30:00Z'), { year: '2026-27', month: 0 });
  assert.deepEqual(poPeriod('2027-01-15'), { year: '2026-27', month: 9 });
  assert.equal(poPeriod(null), null);
  assert.equal(poPeriod('bad'), null);
});
test('user matrix, monthly totals and search use only selected dated PO entries', async () => {
  const { monthlyPO, poAmount } = await import('../../frontend/src/utils/poMonthly.mjs');
  const records = [
    { ownerId: '1', ownerName: 'Sonal', poDate: '2026-04-01', poAmount: 100 },
    { ownerId: '1', ownerName: 'Sonal', poDate: '2026-05-01', poAmount: '250' },
    { ownerId: '2', ownerName: 'Prachi', poDate: '2026-04-01', poAmount: 50 },
    { ownerId: '1', ownerName: 'Sonal', poDate: '2025-04-01', poAmount: 999 },
    { ownerId: '1', ownerName: 'Sonal', poDate: null, poAmount: 999 }
  ];
  const matrix = monthlyPO(records, '2026-27');
  assert.equal(matrix.rows.length, 2);
  assert.equal(matrix.records.length, 3);
  assert.equal(matrix.rows[0].months[0].length, 1);
  assert.equal(matrix.rows[0].months[1].length, 1);
  assert.equal(poAmount(matrix.records), 400);
  assert.equal(monthlyPO(records, '2026-27', ' SONAL ').records.length, 2);
  assert.equal(poAmount([{ poAmount: 'bad' }]), 0);
});
const { loadPurchaseOrders, monthlyLeadProjection } = require('../src/controllers/purchaseOrderController');
test('monthly loader requests compact database projections and keeps proof-only entry ids', async () => {
  let pipeline;
  const selections = [];
  const lead = { _id: '64b000000000000000000001', createdBy: 'owner', assignments: [{ poYearRows: [null, { poNumber: '', poFileUrl: 'proof-present', poDate: '2026-04-01', poAmount: 100 }] }] };
  const projectedModel = rows => ({ find() { return { select(value) { selections.push(value); return this; }, maxTimeMS() { return this; }, async lean() { return rows; } }; } });
  const records = await loadPurchaseOrders({
    Lead: { aggregate(value) { pipeline = value; return { option: async () => [lead] }; } },
    Client: projectedModel([]), Quotation: projectedModel([])
  }, { scoped: true }, { monthly: true });
  assert.deepEqual(pipeline[0], { $match: { scoped: true } });
  assert.equal(pipeline[1].$project, monthlyLeadProjection);
  assert.deepEqual(selections, ['_id selectedLead', '_id leadRef leadId leadCode businessLeadCode quotationNumber grandTotal']);
  assert.equal(records.length, 1);
  assert.equal(records[0].poAmount, 100);
  assert.equal(records[0].poDate, '2026-04-01T00:00:00.000Z');
  assert.equal(records[0].id, require('../src/controllers/purchaseOrderController').stablePoId(lead._id, 0, 1));
  const proofExpression = monthlyLeadProjection.assignments.$map.in.poYearRows.$map.in.poFileUrl;
  assert.equal(proofExpression.$cond[1], 'proof-present');
});
test('legacy malformed assignments do not fail the entire PO dashboard', async () => {
  const model = rows => ({ find: () => ({ lean: async () => rows }) });
  const rows = await loadPurchaseOrders({
    Lead: model([{ _id: 'lead', assignments: [null, { poYearRows: 'legacy' }, { poYearRows: [null, { poNumber: 'PO1', poAmount: 25 }] }] }]),
    Client: model([]), Quotation: model([])
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].poNumber, 'PO1');
});
