const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _test } = require('../src/controllers/leadController');

const read = (relative) => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');

test('closing one service does not revalidate unchanged legacy approved PO rows', () => {
  const legacyApproved = {
    poStatus: 'received',
    closureRequestedBy: 'manager-id',
    poApprovalStatus: 'APPROVED',
    poYearRows: [{
      fy: '2026-27',
      poNumber: 'AT/26-27/360',
      poDate: '',
      poAmount: 35000,
      poFileUrl: 'https://example.com/legacy-po.pdf',
      services: ['New Registration']
    }]
  };
  const sanitized = _test.cleanBody({ assignments: [legacyApproved] }).assignments[0];

  assert.equal(_test.poClosureSubmissionChanged(legacyApproved, sanitized), false);
  assert.equal(_test.poClosureSubmissionChanged({}, sanitized), true);
  assert.equal(_test.poClosureSubmissionChanged(legacyApproved, {
    ...sanitized,
    poYearRows: [{ ...sanitized.poYearRows[0], poNumber: 'UPDATED-PO' }]
  }), true);
});

test('lead closure auto-fetches quotation fields and supports one or multiple POs', () => {
  const page = read('../../frontend/src/pages/LeadGeneration.jsx');
  assert.match(page, /Quotation details auto-fetched/);
  assert.match(page, /EPR \/ Service Period/);
  assert.match(page, /Basic Amount \(INR\)/);
  assert.match(page, /Enter PO details against every quotation service/);
  assert.match(page, /quotation service row/);
  assert.match(page, /Confirm & Save Closure/);
  assert.match(page, /Lead closed and PO details saved in the database/);
  assert.match(page, /api\.put\(API_ENDPOINTS\.leads\.detail\(editingLeadId\), payload, \{ headers: \{ 'X-PO-Debug-ID': poDebugId \} \}\)/);
  assert.match(page, /\[POProof:closure:submit\]/);
});

test('PO received closure asks whether quotation was sent and supports earlier quotation proof', () => {
  const leadPage = read('../../frontend/src/pages/LeadGeneration.jsx');
  const leadController = read('../src/controllers/leadController.js');
  const pendingApprovalPage = read('../../frontend/src/pages/PendingApproval.jsx');
  assert.match(leadPage, /Was a quotation sent to the customer\?/);
  assert.match(leadPage, /Yes — Quotation Sent/);
  assert.match(leadPage, /No — Use Earlier Quotation Proof/);
  assert.match(leadPage, /earlierQuotationProofUrl/);
  assert.match(leadPage, /function EarlierQuotationPoDetails/);
  assert.match(leadPage, /CRM quotation not used/);
  assert.match(leadPage, /selectClosureQuotationMode\('no'\)/);
  assert.match(leadPage, /No CRM quotation was found for this lead/);
  assert.match(leadPage, /closureDialog\.quotationSent === 'yes' && String\(closureDialog\.quotation\?\.approvalDecision/);
  assert.doesNotMatch(leadPage, /quotation=\{\{ quotationNumber: 'Earlier quotation proof attached' \}\}/);
  assert.match(leadController, /quotationBasicAmount: String\(row\?\.quotationSent \|\| ''\)\.toLowerCase\(\) === 'yes' \?/);
  assert.match(leadController, /closureRequestedBy/);
  assert.match(leadController, /closureRequestedBy: String\(row\?\.closureRequestedBy/);
  assert.match(leadController, /const poProofManifest = poRowsSnapshot\.map/);
  assert.match(leadController, /poFileUrl: String\(po\.poFileUrl/);
  assert.match(leadController, /poYearRows: poRowsSnapshot, poProofManifest/);
  assert.match(leadController, /submittedAssignments: data\.assignments/);
  assert.match(leadController, /const snapshotSource = Array\.isArray\(submittedRow\?\.poYearRows\)/);
  assert.match(leadController, /const proof = resolvePoProof\(po\)/);
  assert.match(leadController, /status === 'APPROVED'.*closureRequestedBy/s);
  assert.match(leadController, /approval\.payload\?\.closureRequestedBy/);
  assert.doesNotMatch(leadController, /status === 'APPROVED'[\s\S]{0,300}closureRequestedBy = ''/);
  assert.match(leadController, /poApprovalStatus[\s\S]*assignedTo[\s\S]*closureRequestedBy[\s\S]*closureFinalizedByManager/);
  assert.match(pendingApprovalPage, /View earlier quotation proof/);
  assert.match(pendingApprovalPage, /const poRows = normalizedPoRows\.length/);
  assert.match(pendingApprovalPage, /function NormalizedPoProof/);
  assert.match(pendingApprovalPage, /row\.quotationSent === 'no' \? 0/);
});

test('approved PO unlocks manager assignment and manager assignment closes the service', () => {
  const leadPage = read('../../frontend/src/pages/LeadGeneration.jsx');
  const leadController = read('../src/controllers/leadController.js');
  const managerNotifications = read('../src/services/leadAssignmentNotifications.js');
  const staffWorkflow = read('../src/services/staffOnboardingWorkflow.js');
  assert.match(leadPage, /managerAssignmentReady/);
  assert.match(leadPage, /Select manager to close service/);
  assert.match(leadController, /changedManagerRows/);
  assert.match(managerNotifications, /assignmentIndex/);
  assert.match(staffWorkflow, /A new client is assigned to you/);
  assert.match(staffWorkflow, /await sendMail\(/);
});

test('PO approval is persisted and restricted to Admin and Super Admin', () => {
  const model = read('../src/models/PendingApproval.js');
  const routes = read('../src/routes/leads.js');
  const controller = read('../src/controllers/leadController.js');
  assert.match(model, /'purchase_order'/);
  assert.match(model, /'REVISION_REQUIRED'/);
  assert.match(routes, /purchase-order-approvals.*requireRoles\(ADMIN_ROLES\)/);
  assert.match(routes, /purchase-order-approvals\/:id\/proof/);
  assert.match(controller, /exports\.uploadPurchaseOrderProof/);
  assert.match(controller, /approval\.markModified\('payload'\)/);
  assert.match(controller, /lead\.markModified\('assignments'\)/);
  assert.match(controller, /upsertPurchaseOrderApprovals/);
  assert.match(controller, /poApprovalStatus = status/);
  assert.match(controller, /attachments: screenshotAttachment \? \[screenshotAttachment\] : \[\]/);
  assert.match(controller, /poSubmittedByEmail/);
  assert.match(controller, /role: \{ \$in: ADMIN_ROLES \}/);
  assert.match(controller, /liveRows\.length \? liveRows : snapshotRows/);
  assert.match(controller, /Purchase Order submitted for review/);
  assert.match(controller, /New PO Approval/);
  assert.match(controller, /const poProofManifest = poRowsSnapshot\.map/);
  assert.match(controller, /payload: \{[\s\S]*poYearRows: poRowsSnapshot, poProofManifest/);
  assert.match(controller, /buildPurchaseOrderEmail/);
  assert.match(controller, /Purchase Order approved successfully/);
  assert.match(controller, /leadByCompany/);
});

test('Pending Approval exposes review details before approve reject and revision actions', () => {
  const page = read('../../frontend/src/pages/PendingApproval.jsx');
  assert.match(page, /label: 'PO Approval'/);
  assert.match(page, /Purchase Order Approvals/);
  for (const status of ['APPROVED', 'REJECTED', 'REVISION_REQUIRED']) {
    assert.ok(page.includes(`openPoDecision(row, '${status}')`));
  }
  assert.match(page, /function SubmittedPoReview/);
  for (const heading of ['EPR / Service Period', 'PO Number', 'PO Date', 'PO End Date', 'PO Financial Year', 'Payment Term', 'PO Amount (INR)', 'PO Proof', 'Service']) assert.ok(page.includes(`'${heading}'`));
  assert.match(page, /api\.get\(API_ENDPOINTS\.leads\.purchaseOrderApprovalDecision/);
  assert.match(page, /loadingDetails/);
  assert.match(page, /loadError/);
  assert.match(page, /openPoDetails\(row\)/);
  assert.match(page, /View Details/);
  assert.match(page, /Decision remarks/);
  assert.match(page, /target="_blank"/);
  assert.match(page, /payload\.poProofManifest/);
  assert.match(page, /payload\.poRows/);
  assert.match(page, /payload\.purchaseOrders/);
  assert.doesNotMatch(page, /Upload correction screenshot \(required\)/);
});

test('PO proof resolver preserves canonical, legacy, nested, and approval-level uploads', () => {
  const { resolvePoProof } = require('../src/services/poProofResolver');
  assert.deepEqual(resolvePoProof({ poFileUrl: 'https://example.com/current.pdf', poFileName: 'current.pdf' }), { url: 'https://example.com/current.pdf', name: 'current.pdf', mimeType: '', size: '' });
  assert.deepEqual(resolvePoProof({ poUpload: { secure_url: 'https://example.com/legacy.pdf', originalName: 'legacy.pdf' } }), { url: 'https://example.com/legacy.pdf', name: 'legacy.pdf', mimeType: '', size: '' });
  assert.deepEqual(resolvePoProof({}, { documentUrl: 'https://example.com/approval.pdf', documentName: 'approval.pdf' }), { url: 'https://example.com/approval.pdf', name: 'approval.pdf', mimeType: '', size: '' });
});

test('canonical PO resolver follows priority and never crosses approvals sharing a lead code', () => {
  const { resolveApprovalPoProof } = require('../src/services/poProofResolver');
  const firstApproval = {
    _id: 'approval-a',
    uniqueId: 'ATPL-LEAD-0456',
    payload: {
      poYearRows: [{ poNumber: 'OTHER', poFileUrl: 'https://example.com/wrong-index.pdf' }, { poNumber: 'PO_1234', poFileUrl: 'https://example.com/right.pdf', poFileName: 'right.pdf' }],
      poProofManifest: [{ poNumber: 'PO_1234', poFileUrl: 'https://example.com/manifest.pdf' }]
    }
  };
  const secondApproval = { _id: 'approval-b', uniqueId: 'ATPL-LEAD-0456', payload: { poYearRows: [{ poNumber: 'PO_1234', poFileUrl: 'https://example.com/other-approval.pdf' }] } };
  const resolved = resolveApprovalPoProof({ approval: firstApproval, normalizedRow: { poNumber: 'PO_1234' }, rowIndex: 0 });
  assert.equal(resolved.poFileUrl, 'https://example.com/right.pdf');
  assert.equal(resolved.poFileName, 'right.pdf');
  assert.equal(resolved.hasPoFileUrl, true);
  assert.equal(resolveApprovalPoProof({ approval: secondApproval, normalizedRow: { poNumber: 'PO_1234' }, rowIndex: 0 }).poFileUrl, 'https://example.com/other-approval.pdf');
  assert.equal(resolveApprovalPoProof({ approval: firstApproval, normalizedRow: { poNumber: 'PO_1234', poFileUrl: 'https://example.com/normalized.pdf' }, rowIndex: 0 }).poFileUrl, 'https://example.com/normalized.pdf');
});

test('Super Admin home omits MIS tables and Home navigation omits Activity Logs', () => {
  const dashboard = read('../../frontend/src/pages/SuperAdminDashboard.jsx');
  const navigation = read('../../frontend/src/constants/dashboard.js');
  assert.match(dashboard, /misPage && misAccess\.showSales/);
  assert.match(dashboard, /misPage && <section className="mt-4 overflow-hidden rounded-2xl border border-cyan-200/);
  assert.doesNotMatch(navigation, /label: 'Activity Logs'/);
});
