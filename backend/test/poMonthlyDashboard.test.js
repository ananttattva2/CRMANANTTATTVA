const test = require('node:test');
const assert = require('node:assert/strict');

test('PO dashboard defaults to the current financial year and shows approved undated entries separately', async () => {
  const { dashboardPO } = await import('../../frontend/src/utils/poMonthly.mjs');
  const records = [
    { id: 'past', poDate: '2025-04-10', approvalStatus: 'APPROVED' },
    { id: 'current', poDate: '2026-04-10', approvalStatus: 'APPROVED' },
    { id: 'undated', approvalStatus: 'APPROVED' },
    { id: 'pending', poDate: '2026-04-10', approvalStatus: 'PENDING' }
  ];
  for (const view of ['month', 'pibo']) {
    const matrix = dashboardPO(records, undefined, '', view, new Date('2026-10-10'));
    assert.deepEqual(matrix.records.map(row => row.id), ['current', 'undated']);
    assert.equal(matrix.undated.length, 1);
    if (view === 'month') assert.equal(matrix.columns.at(-1), 'PO Date Not Recorded');
    assert.equal(matrix.rows[0].cells.flat().length, 2);
    assert.deepEqual(dashboardPO(records, '2025-26', '', view, new Date('2026-10-10')).records.map(row => row.id), ['past', 'undated']);

  }
});

test('six approved missing-date POs remain visible in totals, owner details and category cells', async () => {
  const { dashboardPO, poAmount } = await import('../../frontend/src/utils/poMonthly.mjs');
  const dated = Array.from({ length: 164 }, (_, i) => ({ id: `dated-${i}`, poDate: '2026-04-10', approvalStatus: 'APPROVED', poAmount: 100 }));
  const undated = Array.from({ length: 6 }, (_, i) => ({ id: `undated-${i}`, poDate: i % 2 ? 'invalid' : null, approvalStatus: 'APPROVED', poAmount: 200 }));
  for (const view of ['month', 'pibo']) {
    const matrix = dashboardPO([...dated, ...undated], '2026-27', '', view, new Date('2026-10-10'));
    assert.equal(matrix.records.length, 170);
    assert.equal(matrix.undated.length, 6);
    assert.equal(matrix.rows.flatMap(row => row.cells.flat()).length, 170);
    assert.equal(poAmount(matrix.records), 17600);
    if (view === 'month') assert.equal(matrix.rows[0].cells.at(-1).length, 6);
  }
});

test('PO columns advance at month boundaries in India and keep historical years complete', async () => {
  const { visiblePOMonths, PO_MONTHS } = await import('../../frontend/src/utils/poMonthly.mjs');
  assert.deepEqual(visiblePOMonths('2026-27', new Date('2026-10-10T12:00:00+05:30')), PO_MONTHS.slice(0, 7));
  assert.equal(visiblePOMonths('2026-27', new Date('2026-10-31T18:29:59Z')).at(-1), 'Oct');
  assert.equal(visiblePOMonths('2026-27', new Date('2026-10-31T18:30:00Z')).at(-1), 'Nov');
  assert.equal(visiblePOMonths('2026-27', new Date('2027-01-01T00:00:00+05:30')).at(-1), 'Jan');
  assert.deepEqual(visiblePOMonths('2025-26', new Date('2026-10-10')), PO_MONTHS);
  assert.deepEqual(visiblePOMonths('2027-28', new Date('2026-10-10')), []);
  assert.deepEqual(visiblePOMonths('2027-28', new Date('2027-03-31T18:30:00Z')), ['Apr']);
  assert.deepEqual(visiblePOMonths('2026-27', new Date('2027-03-31T18:30:00Z')), PO_MONTHS);
});

test('visible PO counts, amounts, category view and drill-downs use the same elapsed months', async () => {
  const { dashboardPO, poAmount, poDetailExportRows } = await import('../../frontend/src/utils/poMonthly.mjs');
  const records = [
    { id: 'apr', ownerId: '1', ownerName: 'Himanshu Parashar', approvalStatus: 'APPROVED', poDate: '2026-04-10', poAmount: 100, applicantType: 'Producer' },
    { id: 'oct', ownerId: '1', ownerName: 'Himanshu Parashar', approvalStatus: 'APPROVED', poDate: '2026-10-10', poAmount: 200, applicantType: 'Producer' },
    { id: 'nov', ownerId: '1', ownerName: 'Himanshu Parashar', approvalStatus: 'APPROVED', poDate: '2026-11-10', poAmount: 300, applicantType: 'Producer' },
    { id: 'undated', ownerId: '1', ownerName: 'Himanshu Parashar', poDate: null, poAmount: 400 }
  ];
  const oct = new Date('2026-10-10T12:00:00+05:30');
  for (const view of ['month', 'pibo']) {
    const matrix = dashboardPO(records, '2026-27', 'himanshu', view, oct);
    assert.equal(matrix.records.length, 2);
    assert.equal(poAmount(matrix.records), 300);
    assert.equal(matrix.rows[0].name, 'HIMANSHU PARASHAR');
    assert.equal(matrix.rows[0].cells.flat().length, matrix.records.length);
    assert.deepEqual(matrix.rows[0].records.map(row => row.id), ['apr', 'oct']);
  }
  const november = dashboardPO(records, '2026-27', '', 'month', new Date('2026-11-01T00:00:00+05:30'));
  assert.equal(november.columns.length, 8);
  assert.equal(november.records.length, 3);
  assert.equal(november.rows[0].cells[7][0].id, 'nov');
  assert.equal(poDetailExportRows(records)[0]['Lead Owner'], 'HIMANSHU PARASHAR');
});

test('dashboard excludes pending, rejected and missing approval from all counts and amounts', async () => {
  const { dashboardPO, poAmount } = await import('../../frontend/src/utils/poMonthly.mjs');
  const records = ['APPROVED', ' approved ', 'PENDING', 'REJECTED', null].map((approvalStatus, index) => ({
    id: `po-${index}`, ownerId: 'owner', ownerName: 'Owner', poDate: '2026-10-01', poAmount: 100, applicantType: 'Producer', approvalStatus
  }));
  for (const view of ['month', 'pibo']) {
    const matrix = dashboardPO(records, '2026-27', '', view, new Date('2026-10-10'));
    assert.equal(matrix.records.length, 2);
    assert.equal(poAmount(matrix.records), 200);
    assert.deepEqual(matrix.rows[0].records.map(record => record.id), ['po-0', 'po-1']);
    assert.equal(matrix.rows[0].cells.flat().length, 2);
  }
});
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
