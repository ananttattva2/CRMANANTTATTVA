const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '../src');
const frontendRoot = path.resolve(__dirname, '../../frontend/src');

test('management request requires an active Super Admin and creates a pending final decision', () => {
  const controller = fs.readFileSync(path.join(backendRoot, 'controllers/quotationController.js'), 'utf8');
  const routes = fs.readFileSync(path.join(backendRoot, 'routes/quotations.js'), 'utf8');

  assert.match(routes, /management-approvers/);
  assert.match(routes, /:id\/management-approval/);
  assert.match(routes, /:id\/management-approval\/finalize/);
  assert.match(controller, /MANAGEMENT_APPROVAL_SOURCES/);
  assert.match(controller, /The selected approver is not an active Super Admin/);
  assert.match(controller, /quotation\.status = 'submitted'/);
  assert.match(controller, /managementApprovalStatus: 'PENDING'/);
  assert.match(controller, /quotation\.status = 'admin_approved'/);
  assert.match(controller, /adminApprovalStatus: 'APPROVED'/);
  assert.match(controller, /&& !isSuperAdminReviewer/);
  assert.match(controller, /Only Super Admin can complete final approval/);
  assert.doesNotMatch(controller, /Admin approval must be completed before final Super Admin approval/);
  assert.match(controller, /approvalKind: 'MANAGEMENT_FINAL'/);
});

test('quotation actions expose the request modal and Pending Approval exposes final approve', () => {
  const quotationsPage = fs.readFileSync(path.join(frontendRoot, 'pages/Quotations.jsx'), 'utf8');
  const pendingPage = fs.readFileSync(path.join(frontendRoot, 'pages/PendingApproval.jsx'), 'utf8');
  const model = fs.readFileSync(path.join(backendRoot, 'models/PendingApproval.js'), 'utf8');

  assert.match(quotationsPage, /Management Approval/);
  assert.match(quotationsPage, /Send to Pending Approval/);
  assert.match(quotationsPage, /Auto-fetched from quotation/);
  assert.match(quotationsPage, /ApprovalSourceIcon/);
  assert.match(quotationsPage, /MessageCircle/);
  assert.match(quotationsPage, /VERBAL_CALL/);
  assert.match(pendingPage, /Super Admin Approval/);
  assert.match(pendingPage, /Final Approve/);
  assert.doesNotMatch(pendingPage, /Admin Approval Required/);
  assert.match(pendingPage, /pending-action-approve/);
  assert.match(pendingPage, /!isQuotationSuperAdmin && hasAnyRole\(currentUser, \['admin'\]\)/);
  assert.match(pendingPage, /managementApprovalFinalize/);
  assert.match(model, /managementApproverName/);
  assert.match(model, /managementApprovalSource/);
});
