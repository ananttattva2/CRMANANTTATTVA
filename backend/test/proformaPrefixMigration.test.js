const test = require('node:test');
const assert = require('node:assert/strict');
const { migrateProformaPrefix } = require('../src/services/proformaPrefixMigration');
function setup(rows) {
  const backups = [];
  const Model = {
    find: filter => ({ session() { return this; }, lean: async () => rows.filter(row => filter.proformaNumber instanceof RegExp ? filter.proformaNumber.test(row.proformaNumber) : filter.proformaNumber.$in.includes(row.proformaNumber)) }),
    updateOne: async (filter, update) => { const row = rows.find(row => row._id === filter._id && row.proformaNumber === filter.proformaNumber); if (!row) return { modifiedCount: 0 }; Object.assign(row, update.$set); return { modifiedCount: 1 }; }
  };
  return { Model, backup: async data => backups.push(structuredClone(data)), backups, connection: { startSession: async () => ({ withTransaction: async fn => fn(), endSession: async () => {} }) } };
}
test('existing invoice numbers change only PI prefix and remain idempotent with backup', async () => {
  const rows = [{ _id: '1', proformaNumber: 'PI/26-27/203', poNumber: 'PO-1', grandTotal: 16697 }, { _id: '2', proformaNumber: 'PI/26-27/001', grandTotal: 147500 }];
  const deps = setup(rows);
  assert.equal((await migrateProformaPrefix(deps)).count, 2);
  assert.deepEqual(rows.map(row => row.proformaNumber), ['ATPI/26-27/203', 'ATPI/26-27/001']);
  assert.equal(rows[0].grandTotal, 16697); assert.equal(rows[0].poNumber, 'PO-1');
  assert.equal(deps.backups[0][0].proformaNumber, 'PI/26-27/203');
  assert.equal((await migrateProformaPrefix(deps)).count, 0);
});
test('occupied ATPI number prevents changes', async () => {
  const rows = [{ _id: '1', proformaNumber: 'PI/26-27/203' }, { _id: '2', proformaNumber: 'ATPI/26-27/203' }];
  await assert.rejects(migrateProformaPrefix(setup(rows)), /already exists/);
  assert.equal(rows[0].proformaNumber, 'PI/26-27/203');
});
