const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  eligibleServiceIds,
  isLeadEligibleForClientMaster,
  isLeadServiceEligibleForClientMaster
} = require('../src/services/clientMasterEligibility');

test('open leads are ineligible while previously saved Client Master records stay untouched', () => {
  const lead = { serviceSelections: [{ assignedServiceId: 'legacy-open' }], assignments: [{}] };
  assert.equal(isLeadEligibleForClientMaster(lead), false);
  assert.equal(isLeadServiceEligibleForClientMaster(lead, 'legacy-open'), false);
  assert.deepEqual(eligibleServiceIds(lead), []);
});

test('new open leads are excluded from Client Master', () => {
  const lead = { serviceSelections: [{ assignedServiceId: 'service-open' }], assignments: [{}] };
  assert.equal(isLeadEligibleForClientMaster(lead), false);
  assert.equal(isLeadServiceEligibleForClientMaster(lead, 'service-open'), false);
  assert.deepEqual(eligibleServiceIds(lead), []);
});

test('only closed services on a new lead are eligible', () => {
  const lead = {
    serviceSelections: [{ assignedServiceId: 'service-closed' }, { assignedServiceId: 'service-open' }],
    assignments: [{ closedByText: 'Sales User', closedAt: '2026-09-08T10:00:00.000Z' }, {}]
  };
  assert.equal(isLeadEligibleForClientMaster(lead), true);
  assert.equal(isLeadServiceEligibleForClientMaster(lead, 'service-closed'), true);
  assert.equal(isLeadServiceEligibleForClientMaster(lead, 'service-open'), false);
  assert.deepEqual(eligibleServiceIds(lead), ['service-closed']);
});

test('Client Master search independently filters open leads in the Vercel frontend', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/ClientMaster.jsx'), 'utf8');
  assert.match(page, /function isLeadClosedForClientMaster\(lead = \{\}\)/);
  assert.match(page, /if \(item\.clientMasterId\) return true/);
  assert.match(page, /filterClientMasterSearchItems\(response\.data\.items \|\| \[\], \[\]\)/);
  assert.match(page, /if \(Number\(item\.closedServiceCount\) > 0\) return true/);
});

test('partially closed leads show every service but keep open services disabled', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/ClientMaster.jsx'), 'utf8');
  const controller = fs.readFileSync(path.resolve(__dirname, '../src/controllers/clientController.js'), 'utf8');
  assert.match(page, /_clientMasterEligible: isLeadServiceClosedForClientMaster/);
  assert.match(page, /Lead Not Closed/);
  assert.match(page, /disabled=\{!isEligible\}/);
  assert.match(page, /Close the PO for this service in Lead Generation to unlock Client Master/);
  assert.match(controller, /closedServiceCount/);
  assert.match(controller, /totalServiceCount/);
});
