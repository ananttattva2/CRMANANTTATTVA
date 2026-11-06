const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controllerSource = fs.readFileSync(path.join(__dirname, '../src/controllers/clientController.js'), 'utf8');
const pageSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/PendingApproval.jsx'), 'utf8');

test('pending approval endpoint recovers quotations missing from the approval index', () => {
  assert.match(controllerSource, /status: \{ \$in: \['draft', 'submitted', 'sent', 'admin_approved'\] \}/);
  assert.match(controllerSource, /\{ 'managementApproval\.status': \{ \$exists: false \} \}/);
  assert.match(controllerSource, /const missingQuotationRows = liveQuotationRows\.filter/);
  assert.match(controllerSource, /backgroundSyncPendingApprovals\(\[\], missingQuotationRows\)/);
  assert.match(controllerSource, /pendingQuotations: isAdministrativeReviewer \? \(compact \? responseQuotations\.map\(compactRow\) : responseQuotations\) : \[\]/);
});

test('pending approval reads active rows separately from bounded decision history', () => {
  assert.match(controllerSource, /const \[pendingClientRecords, pendingQuotationRecords, recentDecisionRecords\] = await Promise\.all/);
  assert.match(controllerSource, /type: 'client',[\s\S]*?\.limit\(500\)/);
  assert.match(controllerSource, /type: 'quotation',[\s\S]*?\.limit\(500\)/);
  assert.match(controllerSource, /approvalStatus: \{ \$in: \['PENDING', 'PARTIALLY_APPROVED', 'REVISION_REQUIRED'\] \}/);
  assert.match(controllerSource, /approvalStatus: \{ \$in: \['APPROVED', 'REJECTED'\] \}/);
  assert.match(controllerSource, /\.limit\(100\)/);
});

test('stored approvals and live quotation reconciliation run in parallel', () => {
  assert.match(controllerSource, /const storedApprovalsPromise = readStoredPendingApprovals\(\)/);
  assert.match(controllerSource, /const \[storedFallback, liveQuotations\] = await Promise\.all/);
});

test('pending quotation rows expose and display their created or updated timestamp', () => {
  assert.match(controllerSource, /createdAt: payload\.createdAt \|\| record\.createdAt/);
  assert.match(controllerSource, /updatedAt: payload\.updatedAt \|\| record\.updatedAt/);
  assert.match(pageSource, /function quotationActivityDate/);
  assert.match(pageSource, /'Quotation Date'/);
  assert.match(pageSource, /pending-quotation-activity-date/);
});
