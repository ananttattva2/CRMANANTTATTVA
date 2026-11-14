const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { _test } = require('../src/controllers/leadController');

const read = (relative) => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');

test('staff assignment permission is limited to administrators and the row manager', () => {
  const assignment = { assignedTo: { _id: 'manager-mongo-id' }, assignedToEmail: 'manager@example.com' };

  assert.equal(_test.canAssignStaffToRow({ role: 'admin', _id: 'another-user' }, assignment), true);
  assert.equal(_test.canAssignStaffToRow({ role: 'manager', _id: 'manager-mongo-id' }, assignment), true);
  assert.equal(_test.canAssignStaffToRow({ roles: ['Manager'], email: 'MANAGER@example.com' }, assignment), true);
  assert.equal(_test.canAssignStaffToRow({ role: 'manager', _id: 'different-manager' }, assignment), false);
  assert.equal(_test.canAssignStaffToRow({ role: 'operation', _id: 'manager-mongo-id' }, assignment), false);
});

test('staff assignment permission matches unpopulated Mongoose ObjectIds', () => {
  const managerId = new mongoose.Types.ObjectId();
  assert.equal(_test.canAssignStaffToRow(
    { role: 'manager', _id: managerId },
    { assignedTo: managerId }
  ), true);
});

test('staff assignment stays locked until Finance gives final approval', () => {
  assert.equal(_test.isPoFinanceApproved({ poApprovalStatus: 'FINANCE_PENDING' }), false);
  assert.equal(_test.isPoFinanceApproved({ poApprovalStatus: 'APPROVED' }), true);
  const controller = read('../src/controllers/leadController.js');
  const handler = controller.slice(controller.indexOf('exports.assignLeadStaff'), controller.indexOf('exports.permanentlyCloseProvisionalLead'));
  assert.match(handler, /Finance must finally approve the Purchase Order before staff can be assigned/);
});

test('staff lookup supports Mongo IDs and CRM user IDs without accepting inactive users', () => {
  const mongoId = '6a7426233e6eb1b90295ee19';
  assert.deepEqual(_test.activeUserLookup(mongoId), {
    isActive: { $ne: false },
    $or: [{ crmUserId: mongoId }, { email: mongoId }, { _id: mongoId }]
  });
  assert.deepEqual(_test.activeUserLookup('CRM-STAFF-17'), {
    isActive: { $ne: false },
    $or: [{ crmUserId: 'CRM-STAFF-17' }, { email: 'crm-staff-17' }]
  });
});

test('frontend uses the row-scoped staff endpoint and handles rejected requests', () => {
  const routes = read('../src/routes/leads.js');
  const endpoints = read('../../frontend/src/services/apiEndpoints.js');
  const page = read('../../frontend/src/pages/LeadGeneration.jsx');

  assert.match(routes, /patch\('\/:id\/assignments\/:rowIndex\/staff', requireAuth, leadCtrl\.assignLeadStaff\)/);
  assert.match(endpoints, /staffAssignment: \(id, rowIndex\)/);
  assert.match(page, /api\.patch\(API_ENDPOINTS\.leads\.staffAssignment\(leadId, index\)/);
  assert.match(page, /Unable to assign the staff member/);
  assert.doesNotMatch(page.slice(page.indexOf('async function assignStaffFromDetail'), page.indexOf('function requestStaffAssignmentFromDetail')), /api\.put\(API_ENDPOINTS\.leads\.detail/);
});

test('API path encoding preserves the first assignment row index', () => {
  const endpoints = read('../../frontend/src/services/apiEndpoints.js');
  assert.match(endpoints, /String\(value \?\? ''\)/);
  assert.doesNotMatch(endpoints, /String\(value \|\| ''\)/);
});

test('staff assignment updates only the selected row and audit logging cannot fail the request', () => {
  const controller = read('../src/controllers/leadController.js');
  const handler = controller.slice(controller.indexOf('exports.assignLeadStaff'), controller.indexOf('exports.permanentlyCloseProvisionalLead'));

  assert.match(handler, /\[`assignments\.\$\{rowIndex\}`\]: updatedAssignment/);
  assert.match(handler, /Lead\.findByIdAndUpdate\(lead\._id, update/);
  assert.match(handler, /runValidators: false/);
  assert.match(handler, /Lead staff assignment activity log failed/);
  assert.doesNotMatch(handler, /await lead\.save\(\)/);
});
