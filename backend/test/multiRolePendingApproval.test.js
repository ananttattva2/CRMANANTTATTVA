const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controllerSource = fs.readFileSync(path.join(__dirname, '../src/controllers/clientController.js'), 'utf8');
const leadControllerSource = fs.readFileSync(path.join(__dirname, '../src/controllers/leadController.js'), 'utf8');
const pageSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/PendingApproval.jsx'), 'utf8');

test('pending client approval API checks every assigned role', () => {
  assert.match(controllerSource, /userHasAnyRole\(req\.user, \['compliance'\]\)/);
  assert.doesNotMatch(controllerSource, /const requesterRole = normalizeRoleName\(req\.user\?\.role\)/);
});

test('Pending Approval UI recognizes secondary Compliance role and invalidates old empty cache', () => {
  assert.match(pageSource, /hasAnyRole\(currentUser, \['compliance'\]\)/);
  assert.match(pageSource, /crm\.pendingApproval\.cache\.v7/);
  assert.match(pageSource, /cachedUserId === expectedUserId/);
  assert.doesNotMatch(pageSource, /isComplianceRole\(currentUser\?\.role\)/);
});

test('special approvals recognize Super Admin from every assigned role', () => {
  assert.match(leadControllerSource, /const admin = userHasAnyRole\(req\.user, ADMIN_ROLES\)/);
  assert.match(leadControllerSource, /const isAdmin = userHasAnyRole\(req\.user, ADMIN_ROLES\)/);
});

test('special approval history is bounded without dropping active approvals', () => {
  assert.match(leadControllerSource, /const \[activeApprovals, recentDecisions\] = await Promise\.all/);
  assert.match(leadControllerSource, /approvalStatus: \{ \$in: \['PENDING', 'PARTIALLY_APPROVED', 'REVISION_REQUIRED'\] \}/);
  assert.match(leadControllerSource, /\.sort\(\{ createdAt: -1 \}\)\.limit\(500\)\.lean\(\)/);
  assert.match(leadControllerSource, /\.sort\(\{ actionAt: -1, createdAt: -1 \}\)\.limit\(100\)\.lean\(\)/);
});

test('primary approvals render before waiting on the parallel special approval request', () => {
  const primaryLoad = pageSource.indexOf('setPendingQuotations(snapshot.pendingQuotations)');
  const auxiliaryLoad = pageSource.indexOf('api.get(API_ENDPOINTS.leads.duplicateApprovals, dataRequestConfig)');
  assert.ok(primaryLoad >= 0);
  assert.ok(auxiliaryLoad >= 0 && auxiliaryLoad < primaryLoad);
  assert.ok(pageSource.indexOf('await duplicatePromise') > primaryLoad);
});
