const test = require('node:test');
const assert = require('node:assert/strict');
const records = [
  { id: '1', ownerName: 'Sonal', clientName: 'CCL', poNumber: 'PO-1', poDate: '2026-04-10', poAmount: 30000, applicantType: 'PIBO', subApplicantType: 'Producer', approvalStatus: 'APPROVED' },
  { id: '2', ownerName: 'Sonal', clientName: 'Other', poNumber: 'PO-2', poDate: '2026-04-11', poAmount: 25000, approvalStatus: 'pending' },
  { id: '3', poAmount: 5000, approvalStatus: 'REJECTED' }
];
test('popup approval filter isolates approved/pending records and totals', async () => {
  const { filterPoApproval, poAmount } = await import('../../frontend/src/utils/poMonthly.mjs');
  assert.equal(filterPoApproval(records, 'ALL').length, 3);
  assert.deepEqual(filterPoApproval(records, 'APPROVED').map(r => r.id), ['1']);
  assert.deepEqual(filterPoApproval(records, 'PENDING').map(r => r.id), ['2']);
  assert.equal(poAmount(filterPoApproval(records, 'PENDING')), 25000);
  assert.equal(filterPoApproval([], 'APPROVED').length, 0);
});
test('detail export contains only filtered popup rows and numeric amount', async () => {
  const { filterPoApproval, poDetailExportRows } = await import('../../frontend/src/utils/poMonthly.mjs');
  const rows = poDetailExportRows(filterPoApproval(records, 'APPROVED'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Client, 'CCL');
  assert.equal(rows[0]['Amount (INR)'], 30000);
  assert.equal(rows[0]['Applicant category'], 'Producer');
  assert.equal(rows[0].Approval, 'APPROVED');
});
