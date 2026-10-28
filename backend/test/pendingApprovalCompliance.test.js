const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CLIENT_APPROVAL_ROLES } = require('../src/constants/roles');

test('client approval actions belong to admins and the compliance role family', () => {
  assert.deepEqual(CLIENT_APPROVAL_ROLES, ['admin', 'superadmin', 'compliance']);
  const routes = fs.readFileSync(path.resolve(__dirname, '../src/routes/clients.js'), 'utf8');
  assert.match(routes, /pending-approvals\/clients\/approve-all'.*requireRoles\(CLIENT_APPROVAL_ROLES\)/);
  assert.match(routes, /:\id\/approval'.*requireRoles\(CLIENT_APPROVAL_ROLES\)/);
});

test('pending approval lets compliance reviewers edit while users receive scoped read-only decisions', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/PendingApproval.jsx'), 'utf8');
  const controller = fs.readFileSync(path.resolve(__dirname, '../src/controllers/clientController.js'), 'utf8');
  assert.match(page, /isComplianceApprovalView = companyOnly \|\| hasAnyRole\(currentUser, \['compliance'\]\) && !canApprove/);
  assert.match(page, /canApproveClients = canApprove \|\| isComplianceApprovalView/);
  assert.match(page, /canViewClients && <Metric[^\n]+Client Decisions/);
  assert.match(page, /Decision remarks \(read-only\)/);
  assert.match(page, /cannot be edited by users/);
  assert.match(page, /if \(!isComplianceApprovalView\) \{[\s\S]*list\.push\(\{ id: 'quotations'/);
  assert.match(controller, /if \(!isClientReviewer && responseClients\.length\)/);
  assert.match(controller, /await clientAccessFilter\(req\.user\)/);
  assert.match(controller, /pendingClients: compact \? responseClients\.map\(compactRow\) : responseClients/);
  assert.match(controller, /remarks: record\.remarks \|\| ''/);
  assert.match(controller, /complianceReview: reviewByClient\.get/);
  assert.match(controller, /complianceReview: row\.complianceReview \|\| null/);
  assert.match(page, /Completed \/ Approved Tabs/);
  assert.match(page, /Pending \/ Action Required Tabs/);
  assert.match(page, /section\.remarks \|\| 'No tab remark recorded\.'/);
  assert.match(page, /client-decision-view-modal/);
  const styles = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/styles/modules/10-responsive-polish.css'), 'utf8');
  assert.match(styles, /\.pending-decision-modal\.client-decision-view-modal \{[\s\S]*?max-height: calc\(100dvh - 40px\);[\s\S]*?overflow-y: auto;/);
  assert.match(controller, /pendingQuotations: isAdministrativeReviewer \? \(compact \? responseQuotations\.map\(compactRow\) : responseQuotations\) : \[\]/);
});

test('pending approvals can be filtered by the responsible user', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/PendingApproval.jsx'), 'utf8');
  assert.match(page, /const \[userFilter, setUserFilter\]/);
  assert.match(page, /const userMatches = userFilter === 'all'/);
  assert.match(page, /aria-label="Filter by user"/);
  assert.match(page, /All Users/);
});

test('pending client rows clearly show compliance approval state', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/PendingApproval.jsx'), 'utf8');
  const controller = fs.readFileSync(path.resolve(__dirname, '../src/controllers/clientController.js'), 'utf8');
  assert.match(page, /const approvalState = getApprovalStatus\(client\)/);
  assert.match(page, /aria-label="Compliance approved"/);
  assert.match(page, /aria-label="Compliance approval pending"/);
  assert.doesNotMatch(page, /bg-rose-50\/80 hover:bg-rose-100/);
  assert.match(page, /fill-amber-100 text-amber-500/);
  assert.match(page, /fill-rose-100 text-rose-600/);
  assert.match(page, /aria-label="Compliance partially approved"/);
  assert.match(page, /Client approval status tabs/);
  assert.match(page, /client-status-tab-label/);
  assert.match(page, /PARTIALLY_APPROVED/);
  assert.match(page, /Partially Approved/);
  assert.match(page, /'Approval Status', 'Decision By', 'Decision Remarks', 'Applicant Type'/);
  assert.match(page, /formatApprovalValue\(client\.decisionBy\)/);
  assert.match(page, /client\.decisionAt/);
  assert.match(controller, /populate\('actionBy', 'name email'\)/);
  assert.match(controller, /decisionBy: record\.actionBy\?\.name \|\| record\.actionBy\?\.email/);
});

test('Pending Approval header is integrated without a white card background', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/PendingApproval.jsx'), 'utf8');
  const styles = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/styles/modules/11-final-overrides.css'), 'utf8');
  assert.match(styles, /\.pending-approval-hero \{[\s\S]*?background: transparent !important;/);
  assert.match(styles, /\.pending-table-head \.client-status-tab-label \{[\s\S]*?display: inline-flex !important;/);
  assert.match(page, /border-rose-200 bg-rose-100 text-rose-700/);
});

test('client approval list includes pending, partial and approved compliance records', () => {
  const controller = fs.readFileSync(path.resolve(__dirname, '../src/controllers/clientController.js'), 'utf8');
  const reviewController = fs.readFileSync(path.resolve(__dirname, '../src/controllers/clientComplianceReviewController.js'), 'utf8');
  const pendingApproval = fs.readFileSync(path.resolve(__dirname, '../src/models/PendingApproval.js'), 'utf8');
  assert.doesNotMatch(controller, /reviewStatusByClient/);
  assert.match(reviewController, /approvalStatus = decision === 'APPROVED'.*'PARTIALLY_APPROVED'/);
  assert.match(pendingApproval, /'PENDING', 'PARTIALLY_APPROVED', 'APPROVED'/);
  assert.match(controller, /PARTIALLY_APPROVED/);
});

test('duplicate Client Master services open an applicant type chooser', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/ClientMaster.jsx'), 'utf8');
  assert.match(page, /openDirectoryClientView/);
  assert.match(page, /getRelatedClientServices\(clients, selectedClient\)/);
  assert.match(page, /Which Client Master do you want to view/);
  assert.match(page, /View Client Master/);
});

test('legacy purchase order approvals recover the lead id from their source key', () => {
  const controller = fs.readFileSync(path.resolve(__dirname, '../src/controllers/leadController.js'), 'utf8');
  assert.match(controller, /sourceClientId \|\| ''\)\.split\(':po:'\)\[0\]/);
  assert.match(controller, /leadById\.get\(approvalLeadId\(approval\)\)/);
});

test('custom compliance roles pass compliance-family authorization', () => {
  const middleware = fs.readFileSync(path.resolve(__dirname, '../src/middleware/auth.js'), 'utf8');
  assert.match(middleware, /userHasAnyRole\(req\.user, roles\)/);
});

test('pending client company navigation preselects its lead in Client Master', () => {
  const approvals = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/PendingApproval.jsx'), 'utf8');
  const clientMaster = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/ClientMaster.jsx'), 'utf8');
  const quotations = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
  assert.match(approvals, /navigate\(`\/pending-approval\/clients\/\$\{service\.clientMasterId\}\/review`\)/);
  assert.match(quotations, /Back to Pending Approval/);
  assert.match(quotations, /onBackToPendingApproval=\{fromPendingApproval/);
  assert.match(clientMaster, /location\.state\?\.fromPendingApproval/);
  assert.match(clientMaster, /handleLeadSelect\(leadValue\)/);
});

test('client decisions require a 250-character note modal and backend validation', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/PendingApproval.jsx'), 'utf8');
  const controller = fs.readFileSync(path.resolve(__dirname, '../src/controllers/clientController.js'), 'utf8');
  const model = fs.readFileSync(path.resolve(__dirname, '../src/models/PendingApproval.js'), 'utf8');
  assert.match(page, /maxLength=\{250\}/);
  assert.match(page, /submitClientDecision/);
  assert.match(page, /remarks: decisionNote/);
  assert.match(controller, /Approval note.*Rejection reason.*is required/);
  assert.match(controller, /remarks\.length > 250/);
  assert.match(controller, /notifyClientApprovalDecision/);
  assert.match(model, /remarks:.*maxlength: 250/);
});

test('Client Master service choices show applicant and sub applicant types separately', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/ClientMaster.jsx'), 'utf8');
  assert.match(page, /piboCategory: row\.subApplicantType \|\| row\.piboCategory/);
  assert.match(page, /Applicant Type: \{applicantType\}/);
  assert.match(page, /Sub Applicant Type: \{subApplicantType\}/);
});

test('pending client approvals use the 24h, 24h, red flag and 48h compliance workflow', () => {
  const service = fs.readFileSync(path.resolve(__dirname, '../src/services/pendingApprovalNotifications.js'), 'utf8');
  const model = fs.readFileSync(path.resolve(__dirname, '../src/models/PendingApproval.js'), 'utf8');
  const controller = fs.readFileSync(path.resolve(__dirname, '../src/controllers/clientController.js'), 'utf8');
  assert.match(service, /TWENTY_FOUR_HOURS = 24 \* 60 \* 60 \* 1000/);
  assert.match(service, /Math\.max\(2, Number\(process\.env\.PENDING_APPROVAL_MAX_REMINDERS\)/);
  assert.match(service, /reminderFlag: 'RED'/);
  assert.match(service, /greenFlagDeadline: new Date\(now\.getTime\(\) \+ 48 \* 60 \* 60 \* 1000\)/);
  assert.match(service, /types\.has\('client'\) \? \['compliance'\]/);
  assert.match(model, /reminderFlag:.*GREEN.*RED/);
  assert.match(controller, /reminderFlag: 'GREEN'/);
  assert.match(controller, /greenFlagAt: new Date\(\)/);
});
