const test = require('node:test');
const assert = require('node:assert/strict');

test('Pending Clients Excel includes every approval status, assigned staff, and service offered', async () => {
  const { buildPendingClientApprovalExportRows, buildPendingClientApprovalSummary } = await import('../../frontend/src/utils/pendingClientApprovalExport.mjs');
  const clients = [
    { clientName: 'Pending Co', approvalStatus: 'PENDING', assignedStaff: 'Prachi', serviceOffered: 'Registration' },
    { clientName: 'Partial Co', approvalStatus: 'PARTIALLY_APPROVED', assignedStaff: 'Sonal', serviceOffered: 'Annual Return', decisionBy: 'Compliance A' },
    { clientName: 'Approved Co', approvalStatus: 'APPROVED', assignedStaff: 'Tushar', serviceOffered: 'EPR Audit', decisionBy: 'Compliance B' },
    { clientName: 'Rejected Co', approvalStatus: 'REJECTED', assignedStaff: 'Shubham', serviceOffered: 'Consulting', decisionBy: 'Compliance C' }
  ];

  const rows = buildPendingClientApprovalExportRows(clients);
  assert.deepEqual(rows.map((row) => row['Approval Status']), ['Pending', 'Partially Approved', 'Approved', 'Rejected']);
  assert.deepEqual(rows.map((row) => row['Assigned Staff']), ['Prachi', 'Sonal', 'Tushar', 'Shubham']);
  assert.deepEqual(rows.map((row) => row['Service Offered']), ['Registration', 'Annual Return', 'EPR Audit', 'Consulting']);
  assert.equal(rows[0]['Decision By'], '-');
  assert.equal(rows[1]['Decision By'], 'Compliance A');
  assert.deepEqual(buildPendingClientApprovalSummary(clients).map((row) => row.Count), [1, 1, 1, 1]);
});
