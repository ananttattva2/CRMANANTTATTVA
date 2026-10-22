const test = require('node:test');
const assert = require('node:assert/strict');

test('Pending Clients Excel includes every approval status and user names', async () => {
  const { buildPendingClientApprovalExportRows, buildPendingClientApprovalSummary } = await import('../../frontend/src/utils/pendingClientApprovalExport.mjs');
  const clients = [
    { clientName: 'Pending Co', approvalStatus: 'PENDING', createdBy: 'Prachi' },
    { clientName: 'Partial Co', approvalStatus: 'PARTIALLY_APPROVED', createdBy: 'Sonal', decisionBy: 'Compliance A' },
    { clientName: 'Approved Co', approvalStatus: 'APPROVED', createdBy: 'Tushar', decisionBy: 'Compliance B' },
    { clientName: 'Rejected Co', approvalStatus: 'REJECTED', createdBy: 'Shubham', decisionBy: 'Compliance C' }
  ];

  const rows = buildPendingClientApprovalExportRows(clients);
  assert.deepEqual(rows.map((row) => row['Approval Status']), ['Pending', 'Partially Approved', 'Approved', 'Rejected']);
  assert.deepEqual(rows.map((row) => row['User Name']), ['Prachi', 'Sonal', 'Tushar', 'Shubham']);
  assert.equal(rows[0]['Decision By'], '-');
  assert.equal(rows[1]['Decision By'], 'Compliance A');
  assert.deepEqual(buildPendingClientApprovalSummary(clients).map((row) => row.Count), [1, 1, 1, 1]);
});
