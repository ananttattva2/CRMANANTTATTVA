const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcileLegacyPendingClients } = require('../src/services/pendingClientReconciliation');

test('legacy blank-service duplicate retains the actual decision and exports once', async () => {
  const base = { clientName: 'CAPITAL COLOURS', eprCategory: 'EPR - Plastic Waste', piboCategory: 'PWP', assignedStaff: 'SIDDHESH NIKAM' };
  const pending = { ...base, id: 'shell', serviceOffered: 'Annual Return Filling', approvalStatus: 'PENDING', createdAt: '2026-11-24' };
  const reviewed = { ...base, id: 'reviewed', serviceOffered: '-', approvalStatus: 'PARTIALLY_APPROVED', decisionBy: 'Khushboo Bhavsar', decisionAt: '2026-10-13', remarks: 'Upload CPCB screenshots' };
  const result = reconcileLegacyPendingClients([pending, reviewed]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'reviewed');
  assert.equal(result[0].serviceOffered, 'Annual Return Filling');
  assert.equal(result[0].approvalStatus, 'PARTIALLY_APPROVED');
  assert.equal(result[0].decisionBy, 'Khushboo Bhavsar');
  assert.equal(result[0].remarks, 'Upload CPCB screenshots');
  const { buildPendingClientApprovalExportRows } = await import('../../frontend/src/utils/pendingClientApprovalExport.mjs');
  assert.equal(buildPendingClientApprovalExportRows(result).length, 1);
  const resubmitted = reconcileLegacyPendingClients([{ ...pending, submittedAt: '2026-11-27' }, reviewed]);
  assert.equal(resubmitted[0].approvalStatus, 'PENDING');
  assert.equal(resubmitted[0].decisionBy, 'Khushboo Bhavsar');
  assert.equal(reconcileLegacyPendingClients([pending, { ...reviewed, piboCategory: 'Importer' }]).length, 2);
  assert.equal(reconcileLegacyPendingClients([pending, reviewed, { ...pending, id: 'registration', serviceOffered: 'Registration' }]).length, 3);
  assert.equal(reconcileLegacyPendingClients([pending, { ...reviewed, serviceOffered: 'Registration' }]).length, 2);
});

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
  assert.equal(rows[0]['Decision By'], 'Awaiting decision');
  assert.equal(rows[1]['Decision By'], 'Compliance A');
  assert.deepEqual(buildPendingClientApprovalSummary(clients).map((row) => row.Count), [1, 1, 1, 1]);
});
