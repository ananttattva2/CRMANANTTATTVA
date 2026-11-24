const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('../../frontend/node_modules/esbuild');
const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/ClientMaster.jsx'), 'utf8');
let utilities;
async function utils() {
  if (!utilities) utilities = esbuild.build({ entryPoints: [path.resolve(__dirname, '../../frontend/src/features/clientMaster/clientMaster.utils.js')], bundle: true, write: false, format: 'cjs', platform: 'node' }).then(result => { const module = { exports: {} }; new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, require); return module.exports; });
  return utilities;
}
test('every saved form section survives nested and legacy hydration without inventing defaults', async () => {
  const { readClientData } = await utils();
  const sections = { companyOverview: { companyName: 'CAPITAL COLOURS', companySummary: 'Saved overview', overviewItems: ['Saved point'] }, basic: { clientLegalName: 'CAPITAL COLOURS', tradeName: 'Saved trade' }, registeredAddress: { address1: 'Saved street', city: 'Saved city' }, communicationAddress: { address1: 'Saved postal address' }, compliance: { gst: 'fixture-gst', gstFile: { name: 'gst.pdf', url: 'https://files.test/gst.pdf' } }, msmeRows: [{ udyamNumber: 'fixture-msme' }], cte: { numberOfPlantsLocations: '1', plantWiseDetails: [{ plantName: 'Saved plant' }] }, cpcb: { ceprUserId: 'fixture-login', ceprPassword: 'fixture-secret' }, cpcbScreenshots: [{ name: 'Saved screenshot', url: 'https://files.test/screen.png' }], processDiagrams: [{ name: 'flow.pdf' }], otp: { mobile: 'fixture-mobile' }, authorised: { name: 'Saved authorised person', email: 'person@example.test' }, coordinating: { name: 'Saved coordinator' }, authorisedPersons: [{ name: 'Second person' }] };
  for (const record of [{ data: sections }, { ...sections, data: { companyOverview: { companySummary: '' }, compliance: {}, cpcbScreenshots: [] } }]) {
    const actual = readClientData(record);
    function assertSavedValues(actualValue, savedValue, field) {
      if (savedValue && typeof savedValue === 'object' && !Array.isArray(savedValue)) {
        for (const [key, value] of Object.entries(savedValue)) assertSavedValues(actualValue?.[key], value, `${field}.${key}`);
      } else assert.deepEqual(actualValue, savedValue, field);
    }
    for (const [key, value] of Object.entries(sections)) assertSavedValues(actual[key], value, key);
  }
  const unrelated = readClientData({ data: { assignedServiceId: 'one', cpcbDataByAssignedServiceId: { two: { cpcb: { ceprUserId: 'other-service-login' } } } } });
  assert.notEqual(unrelated.cpcb?.ceprUserId, 'other-service-login');
});
test('partially saved scope fills blank fields from its own master across addresses, contacts and CPCB', async () => {
  const { mergeClientData } = await utils();
  const context = vm.createContext({ mergeClientData, readAssignedServiceId: row => row.assignedServiceId });
  vm.runInContext(page.slice(page.indexOf('function legacyServiceFingerprintCompatible'), page.indexOf('function uniqueClientMasterServices')), context);
  vm.runInContext(page.slice(page.indexOf('function activateAssignedService'), page.indexOf('const calendarTodoStorageKey')), context);
  const saved = { assignedServiceId: 'one', selectedLeadSnapshot: { assignedServiceId: 'one' }, companyOverview: { companySummary: 'Saved summary' }, compliance: { gst: 'fixture-gst' }, cte: { numberOfPlantsLocations: '2' }, registeredAddress: { address1: 'Saved street', city: 'Saved city' }, authorised: { name: 'Saved name', email: 'saved@example.test' }, cpcb: { ceprUserId: 'fixture-id', ceprPassword: 'fixture-secret' }, cpcbScreenshots: [{ name: 'saved.png' }], serviceDetailsByAssignedServiceId: { one: { registeredAddress: { state: 'Saved state', address1: '' }, authorised: { name: 'Saved name', email: '' } } }, cpcbDataByAssignedServiceId: { one: { cpcb: { linkedToCommonPortal: '' } } } };
  const result = context.activateAssignedService(saved, { assignedServiceId: 'one' }, 1);
  assert.equal(result.registeredAddress.address1, 'Saved street'); assert.equal(result.registeredAddress.state, 'Saved state'); assert.equal(result.authorised.email, 'saved@example.test'); assert.equal(result.cpcb.ceprPassword, 'fixture-secret'); assert.equal(result.cpcbScreenshots.length, 1); assert.equal(result.companyOverview.companySummary, 'Saved summary'); assert.equal(result.compliance.gst, 'fixture-gst'); assert.equal(result.cte.numberOfPlantsLocations, '2');
  const sibling = context.activateAssignedService(saved, { assignedServiceId: 'two' }, 2); assert.equal(sibling.cpcb.ceprPassword, undefined);
});
test('single-applicant form selects submitted master before the new exact-id blank draft', () => {
  const service = { assignedServiceId: 'annual-current', applicantType: 'PIBO', subApplicantType: 'Brand Owner', plantUnit: 'Unit 1', eprCategory: 'EPR - Plastic Waste', servicesOffered: 'Annual Return Filling' };
  const context = vm.createContext({ readAssignedServiceId: row => row.assignedServiceId || '', isLeadServiceClosedForClientMaster: () => true });
  vm.runInContext(page.slice(page.indexOf('function clientMasterGroupingIdentity'), page.indexOf('function activateAssignedService')), context);
  const start = page.indexOf('  function getVisibleServiceRows('), end = page.indexOf('\n  async function ', start);
  vm.runInContext(page.slice(start, end), context);
  const lead = { serviceSelections: [service], _clientMasterServices: [{ ...service, clientMasterId: 'blank-draft', workflowStatus: 'draft' }, { clientMasterId: 'saved-full-master', piboCategory: 'Brand Owner', eprCategory: 'EPR-PLASTIC', workflowStatus: 'submitted' }] };
  const result = context.getVisibleServiceRows(lead); assert.equal(result.length, 1); assert.equal(result[0].clientMasterId, 'saved-full-master');
});
test('server resolves exact service sections for every form tab', () => {
  const { resolveClientMasterData } = require('../src/services/clientMasterResolver');
  const result = resolveClientMasterData({ assignedServiceId: 'one', data: { compliance: { gst: 'saved-gst' }, serviceDetailsByAssignedServiceId: { one: { companyOverview: { companySummary: 'Scoped overview' }, basic: { tradeName: 'Scoped trade' }, compliance: { pan: 'scoped-pan' }, cte: { numberOfPlantsLocations: '3' }, msmeRows: [{ udyamNumber: 'scope-msme' }], processDiagrams: [{ name: 'scope-flow.pdf' }] } } } });
  assert.equal(result.companyOverview.companySummary, 'Scoped overview'); assert.equal(result.basic.tradeName, 'Scoped trade'); assert.equal(result.compliance.gst, 'saved-gst'); assert.equal(result.compliance.pan, 'scoped-pan'); assert.equal(result.cte.numberOfPlantsLocations, '3'); assert.equal(result.msmeRows.length, 1); assert.equal(result.processDiagrams.length, 1);
});
