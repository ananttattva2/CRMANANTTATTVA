const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '../src');
const frontendRoot = path.resolve(__dirname, '../../frontend/src');

test('management request enters the Admin queue and preserves the Super Admin override', () => {
  const controller = fs.readFileSync(path.join(backendRoot, 'controllers/quotationController.js'), 'utf8');
  const routes = fs.readFileSync(path.join(backendRoot, 'routes/quotations.js'), 'utf8');

  assert.match(routes, /management-approvers/);
  assert.match(routes, /:id\/management-approval/);
  assert.match(routes, /:id\/management-approval\/finalize/);
  assert.match(controller, /MANAGEMENT_APPROVAL_SOURCES/);
  assert.match(controller, /const approverName = 'Admin Queue'/);
  assert.match(controller, /visibleToRoles: \['admin', 'superadmin'\]/);
  assert.doesNotMatch(controller, /The selected approver is not an active Super Admin/);
  assert.match(controller, /quotation\.status = 'submitted'/);
  assert.match(controller, /managementApprovalStatus: 'PENDING'/);
  assert.match(controller, /quotation\.status = 'admin_approved'/);
  assert.match(controller, /adminApprovalStatus: 'APPROVED'/);
  assert.match(controller, /&& !isSuperAdminReviewer/);
  assert.match(controller, /Only Super Admin can complete final approval/);
  assert.doesNotMatch(controller, /Admin approval must be completed before final Super Admin approval/);
  assert.match(controller, /approvalKind: 'MANAGEMENT_FINAL'/);
  assert.doesNotMatch(controller, /upsertQuotationPendingApproval\(quotation, 'CREATE', true\)/);
  assert.doesNotMatch(controller, /upsertQuotationPendingApproval\(quotation, 'UPDATE', true\)/);
  assert.match(controller, /Enter and submit the Admin Approval details before approving this quotation/);
});

test('quotation actions expose the request modal and Pending Approval exposes final approve', () => {
  const quotationsPage = fs.readFileSync(path.join(frontendRoot, 'pages/Quotations.jsx'), 'utf8');
  const pendingPage = fs.readFileSync(path.join(frontendRoot, 'pages/PendingApproval.jsx'), 'utf8');
  const model = fs.readFileSync(path.join(backendRoot, 'models/PendingApproval.js'), 'utf8');

  assert.match(quotationsPage, /Management Approval/);
  assert.match(quotationsPage, /> Admin Approval<\/button>/);
  assert.match(quotationsPage, /const canRequestManagementApproval = Boolean\(currentUser\)/);
  assert.match(quotationsPage, /Send to Admin/);
  assert.match(quotationsPage, /Auto-fetched from quotation/);
  assert.match(quotationsPage, /ApprovalSourceIcon/);
  assert.match(quotationsPage, /MessageCircle/);
  assert.doesNotMatch(quotationsPage, /value: 'VERBAL_CALL'/);
  assert.match(quotationsPage, /Admin Approve/);
  assert.match(quotationsPage, /const hasRequestDetails = Boolean/);
  assert.match(quotationsPage, /isSuperAdminQuotationUser/);
  assert.match(quotationsPage, /Super Admin Approve/);
  assert.match(pendingPage, /Super Admin Approval/);
  assert.match(pendingPage, /Final Approve/);
  assert.doesNotMatch(pendingPage, /Admin Approval Required/);
  assert.match(pendingPage, /pending-action-approve/);
  assert.match(pendingPage, /!isQuotationSuperAdmin && hasAnyRole\(currentUser, \['admin'\]\)/);
  assert.match(pendingPage, /managementApprovalFinalize/);
  assert.match(model, /managementApproverName/);
  assert.match(model, /managementApprovalSource/);
});
