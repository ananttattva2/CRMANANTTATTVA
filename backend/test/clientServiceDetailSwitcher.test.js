const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/ClientMaster.jsx'), 'utf8');

test('Client Master detail can switch between records for multiple assigned services', () => {
  assert.match(page, /function getRelatedClientServices\(/);
  assert.match(page, /serviceClients=\{getRelatedClientServices\(clients, viewClient\)\}/);
  assert.match(page, /View Assigned Service/);
  assert.match(page, /onServiceChange\?\.\(selected\)/);
  assert.match(page, /getClientServiceOptionLabel\(item, index\)/);
  assert.match(page, /api\.get\(API_ENDPOINTS\.clients\.detail\(clientMasterId\)/);
  assert.match(page, /requestId !== clientRecordRequestRef\.current/);
  assert.match(page, /onServiceChange=\{openClientView\}/);
});

test('Client Master directory hides PIBO and chooser prefers exact persisted company records', () => {
  const directory = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/features/clientMaster/ClientDirectoryView.jsx'), 'utf8');
  const table = directory.slice(directory.indexOf('client-directory-table-shell'), directory.indexOf('function ClientFilterSelect'));
  const chooser = page.slice(page.indexOf('function getRelatedClientServices'), page.indexOf('function getClientServiceViewKey'));

  assert.doesNotMatch(table, /['"]PIBO['"]/);
  assert.match(table, /colSpan=\{12\}/);
  assert.match(chooser, /persistedRecords\.length > 1/);
  assert.match(chooser, /clientMasterId: recordId/);
  assert.match(chooser, /assignedServiceId,/);
  assert.ok(chooser.indexOf('persistedRecords.length > 1') < chooser.indexOf('populatedLead'));
});

test('directory eye action always confirms applicant and sub-applicant type before opening details', () => {
  const handler = page.slice(page.indexOf('async function openDirectoryClientView'), page.indexOf("if (viewMode === 'list')"));

  assert.match(handler, /API_ENDPOINTS\.clients\.discoveryServices/);
  assert.match(handler, /identity = clientMasterId \? `client:\$\{clientMasterId\}` : selectedLeadId/);
  assert.match(handler, /clientMasterEligibleServiceIds/);
  assert.match(handler, /hydratedDiscoveredServices = discoveredServices\.map/);
  assert.match(handler, /selectedLead: chooserLead/);
  assert.match(handler, /hydratedDiscoveredServices\.length \? hydratedDiscoveredServices : clients/);
  assert.equal((handler.match(/const servicesToView = relatedServices\.length \? relatedServices : \[selectedClient\]/g) || []).length, 2);
  assert.equal((handler.match(/setPendingServiceView\(\{ client: selectedClient, services: servicesToView \}\)/g) || []).length, 2);
  assert.doesNotMatch(handler, /relatedServices\.length > 1/);
  assert.doesNotMatch(handler, /await openClientView/);
});

test('applicant chooser uses responsive applicant-specific premium cards', () => {
  const chooser = page.slice(page.indexOf('function getApplicantCardTheme'), page.indexOf('const emptyClient'));

  assert.match(chooser, /normalized\.includes\('brand'\)/);
  assert.match(chooser, /normalized\.includes\('producer'\)/);
  assert.match(chooser, /max-w-6xl/);
  assert.match(chooser, /md:grid-cols-3/);
  assert.doesNotMatch(chooser, /max-h-\[62vh\]/);
  assert.match(chooser, />Applicant Type</);
  assert.match(chooser, />Sub Applicant Type</);
  assert.match(chooser, />Plant Unit</);
  assert.match(chooser, /serviceData\.basic\?\.plantUnit \|\| serviceData\.selectedLeadSnapshot\?\.plantUnit \|\| service\.plantUnit/);
  assert.match(chooser, /service\.applicantType \|\| service\.piboParent/);
  assert.match(chooser, /service\.subApplicantType \|\| service\.piboCategory/);
  assert.match(chooser, /Confirm the applicant and sub-applicant type before opening this Client Master/);
  assert.match(chooser, /View Client Master/);
  assert.match(chooser, /Service-specific record available/);
  assert.match(chooser, /Assigned service found/);
  assert.match(chooser, /Client Master Not Available/);
  assert.match(chooser, /hasMultipleServices/);
  assert.match(chooser, /aria-labelledby="client-service-view-title"/);
});

test('service resolver never falls through to generic CPCB data for a mismatched assignment', () => {
  const resolver = page.slice(page.indexOf('function activateAssignedService'), page.indexOf('export default function ClientMaster'));
  assert.match(resolver, /allowLegacy && hasDataCpcb/);
  assert.match(resolver, /allowLegacy && hasDataScreenshots/);
  assert.doesNotMatch(resolver, /if \(hasData\) return dataFallback/);
});

test('legacy multi-service Client Master records remain separate and receive dropdown options from the lead', () => {
  const controller = fs.readFileSync(path.resolve(__dirname, '../src/controllers/clientController.js'), 'utf8');
  assert.match(page, /legacy-service:/);
  assert.match(page, /populatedLead\?\.serviceSelections/);
  assert.match(page, /activateAssignedService\(sourceData, service, services\.length\)/);
  assert.match(page, /function getClientServiceViewKey/);
  assert.match(page, /getClientServiceViewKey\(item\) === event\.target\.value/);
  assert.match(controller, /designation serviceSelections addresses contacts assignments/);
});

test('Add Client draft lookup never treats populated Lead service ids as record identity', () => {
  const lookup = page.slice(page.indexOf('function findClientDraftForLead'), page.indexOf('function handleLeadSelect'));
  assert.match(lookup, /getClientRecordAssignedServiceIds\(item\)/);
  assert.match(lookup, /record: matchedClient/);
  assert.doesNotMatch(lookup, /item\.selectedLead\.serviceSelections/);
});

test('Add Client clears stale form state and reloads the exact Client Master id', () => {
  const handler = page.slice(page.indexOf('async function handleLeadSelect'), page.indexOf('function setAdmin'));
  assert.match(handler, /setClient\(\{ \.\.\.emptyClient, selectedLead: leadValue \}\)/);
  assert.match(handler, /fetchExactClientMaster\(\{/);
  assert.match(handler, /existingDraft\.record/);
  assert.match(handler, /requestId !== clientRecordRequestRef\.current/);
  assert.match(handler, /setEditingClientId\(String\(exactDraft\.id/);
  assert.doesNotMatch(handler, /localAssignmentData|localServiceDetails/);
});

test('new-client defaults are calculated after service identity is initialized', () => {
  const handler = page.slice(page.indexOf('async function handleLeadSelect'), page.indexOf('function setAdmin'));
  assert.ok(handler.indexOf('const currentServicePibo') < handler.indexOf('const samePibo'));
});

test('Client Master service chooser removes business-identical duplicate services', () => {
  assert.match(page, /function clientMasterServiceFingerprint\(service = \{\}\)/);
  assert.match(page, /function uniqueClientMasterServices\(services = \[\]\)/);
  assert.match(page, /return uniqueClientMasterServices\(rows\)\.map/);
  assert.match(page, /service\.plantUnit/);
  const fingerprint = page.slice(page.indexOf('function clientMasterServiceFingerprint'), page.indexOf('function uniqueClientMasterServices'));
  assert.doesNotMatch(fingerprint, /firstAnnualReturnYearApplicable|servicesForYear|financialYear/);
});

test('Client Master chooser treats current Lead services as authoritative and drops stale stored cards', () => {
  const chooser = page.slice(page.indexOf('function getVisibleServiceRows'), page.indexOf('async function loadPage'));
  assert.match(chooser, /hasAuthoritativeLeadServices = Array\.isArray\(lead\?\.serviceSelections\)/);
  assert.match(chooser, /rows = uniqueClientMasterServices\(rows\)\.map\(\(currentService\)/);
  assert.match(chooser, /usedStoredIndexes/);
  assert.match(chooser, /readAssignedServiceId\(stored\) === assignedServiceId/);
  assert.match(chooser, /!assignedServiceId \|\| !readAssignedServiceId\(stored\)/);
  assert.match(chooser, /legacyServiceFingerprintCompatible\(stored, currentService\)/);
  const authoritativeBranch = chooser.slice(chooser.indexOf('if (hasAuthoritativeLeadServices)'), chooser.indexOf('} else {'));
  assert.doesNotMatch(authoritativeBranch, /rows = \[\.\.\.storedServices/);
  assert.match(page, /This Lead has no current assigned services/);
});
