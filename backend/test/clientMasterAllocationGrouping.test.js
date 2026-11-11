const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/ClientMasterAllocate.jsx'), 'utf8');
const clientController = fs.readFileSync(path.resolve(__dirname, '../src/controllers/clientController.js'), 'utf8');
const clientRoutes = fs.readFileSync(path.resolve(__dirname, '../src/routes/clients.js'), 'utf8');
const Lead = require('../src/models/Lead');

test('allocation modal groups sibling Client Masters by selected lead', () => {
  assert.match(page, /function clientAllocationGroupIdentity/);
  assert.match(page, /clientAllocationGroupIdentity\(candidate\) === groupIdentity/);
  assert.match(page, /groupedClients\.flatMap/);
  assert.match(page, /__allocationClientId/);
});

test('allocation list removes duplicate client masters and shows stable serial numbers', () => {
  assert.match(page, /function deduplicateClientMastersForAllocation\(clients = \[\]\)/);
  assert.match(page, /const uniqueClients = useMemo\(\(\) => deduplicateClientMastersForAllocation\(clients\)/);
  assert.match(page, />Sr\.No<\/th>/);
  assert.match(page, /\{absoluteIdx \+ 1\}<\/td>/);
});

test('duplicate service labels keep independent allocation state and database writes', () => {
  assert.match(page, /function allocationStateKey\(clientId, serviceKey\)/);
  assert.match(page, /allocationsByClient = new Map/);
  assert.match(page, /API_ENDPOINTS\.clients\.allocations\(clientId\)/);
  assert.match(page, /await Promise\.all\(requests\)/);
  assert.match(page, /Database verification failed for client/);
  assert.match(page, /row\.stateKey/);
});

test('staff-assigned leads without a Client Master appear as editable allocation placeholders', () => {
  assert.match(page, /function createAssignedLeadPlaceholder/);
  assert.match(page, /function mergeAssignedLeadPlaceholders/);
  assert.match(page, /API_ENDPOINTS\.clients\.allocationLeads/);
  assert.match(page, /client\.allocationLeadPlaceholder/);
  assert.match(page, /API_ENDPOINTS\.leads\.staffAssignment\(leadId, svc\.__leadAssignmentIndex\)/);
  assert.match(clientController, /exports\.listStaffAssignedLeadsForAllocation/);
  assert.match(clientRoutes, /allocation\/assigned-leads.*requireRoles\(CLIENT_ALLOCATION_ROLES\)/);
});

test('assigned-lead directory avoids invalid empty-string comparisons on ObjectId fields', () => {
  assert.doesNotThrow(() => Lead.find({ assignedStaff: { $exists: true, $ne: null } }).cast(Lead));
  assert.throws(
    () => Lead.find({ assignedStaff: { $exists: true, $nin: [null, ''] } }).cast(Lead),
    /Cast to ObjectId failed/
  );
  assert.match(clientController, /const assignedStaffId = \{ \$exists: true, \$ne: null \}/);
  assert.match(clientController, /const assignedStaffText = \{ \$exists: true, \$nin: \[null, ''\] \}/);
});
