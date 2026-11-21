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
  assert.match(controllerSource, /readIndex\(\{ type: \{ \$in: \['client', 'quotation'\] \}[\s\S]*?, 100\)/);
});

test('stored approvals and live client and quotation reconciliation run in parallel', () => {
  assert.match(controllerSource, /const storedApprovalsPromise = readStoredPendingApprovals\(listOnly\)/);
  assert.match(controllerSource, /const liveClientsPromise = isClientReviewer/);
  assert.match(controllerSource.match(/const liveClientsPromise[\s\S]*?: Promise\.resolve\(\[\]\);/)?.[0] || '', /closedPoClientFilter/);
  assert.match(controllerSource, /const \[storedFallback, liveClients, liveQuotations\] = await Promise\.all/);
  assert.match(controllerSource, /responseClients = mergePendingClients\(indexedLiveRows, liveClientRows\)/);
});

test('pending quotation rows expose and display their created or updated timestamp', () => {
  assert.match(controllerSource, /createdAt: payload\.createdAt \|\| record\.createdAt/);
  assert.match(controllerSource, /updatedAt: payload\.updatedAt \|\| record\.updatedAt/);
  assert.match(pageSource, /function quotationActivityDate/);
  assert.match(pageSource, /'Quotation Date'/);
  assert.match(pageSource, /pending-quotation-activity-date/);
});

test('Pending Approval client tab shows the unfiltered Client Master total', () => {
  assert.match(pageSource, /label: 'Clients', count: companyClients\.length/);
  assert.doesNotMatch(pageSource, /label: 'Clients', count: filteredClients\.length/);
  assert.match(pageSource, /applicant:\$\{applicantId\}:service:\$\{assignedServiceId \|\| 'legacy'\}/);
  assert.match(controllerSource, /assignedServiceId: row\.assignedServiceId \|\| row\.payload\?\.assignedServiceId \|\| ''/);
});
