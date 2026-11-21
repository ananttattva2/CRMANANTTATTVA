const test = require('node:test');
const assert = require('node:assert/strict');
const { repairRequestedProforma } = require('../src/scripts/repairRequestedProforma');

function fixture(extra = []) {
  const rows = [{ _id: 'invoice-2', proformaNumber: 'PI/26-27/002', poNumber: 'ATPL-LEAD-0545', companyName: 'Shri Sagar Wovens Pvt. Ltd.', grandTotal: 16697, paymentPercentage: 50, updatedAt: '2026-11-21' }, ...extra];
  const backups = [];
  const Model = {
    findOne: filter => ({ lean: async () => rows.find(row => Object.entries(filter).every(([key, value]) => row[key] === value)) || null }),
    updateOne: async (filter, update) => {
      const row = rows.find(row => Object.entries(filter).every(([key, value]) => row[key] === value));
      if (!row) return { modifiedCount: 0 };
      Object.assign(row, update.$set);
      return { modifiedCount: 1 };
    }
  };
  return { Model, rows, backups, backup: async row => backups.push(structuredClone(row)) };
}

test('requested invoice is backed up, corrected and safe to rerun without changing amounts', async () => {
  const f = fixture();
  assert.equal((await repairRequestedProforma(f.Model, f.backup)).status, 'corrected');
  assert.equal(f.backups[0].proformaNumber, 'PI/26-27/002');
  assert.equal(f.rows[0].proformaNumber, 'PI/26-27/203');
  assert.equal(f.rows[0].poNumber, 'ATPL/Nov/01');
  assert.equal(f.rows[0].grandTotal, 16697);
  assert.equal(f.rows[0].paymentPercentage, 50);
  assert.equal((await repairRequestedProforma(f.Model, f.backup)).status, 'already-correct');
  assert.equal(f.backups.length, 1);
});

test('occupied number, different company and backup failure stop the correction', async () => {
  const occupied = fixture([{ _id: 'other', proformaNumber: 'PI/26-27/203' }]);
  await assert.rejects(repairRequestedProforma(occupied.Model, occupied.backup), /already occupied/);
  assert.equal(occupied.rows[0].proformaNumber, 'PI/26-27/002');
  const different = fixture();
  different.rows[0].companyName = 'Other Company';
  await assert.rejects(repairRequestedProforma(different.Model, different.backup), /identity differs/);
  const failedBackup = fixture();
  await assert.rejects(repairRequestedProforma(failedBackup.Model, async () => { throw new Error('Backup failed'); }), /Backup failed/);
  assert.equal(failedBackup.rows[0].proformaNumber, 'PI/26-27/002');
});
