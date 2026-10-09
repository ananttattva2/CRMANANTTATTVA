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
