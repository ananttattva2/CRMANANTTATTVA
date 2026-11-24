const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('client service chooser removes legacy duplicate applicant cards', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/ClientMaster.jsx'), 'utf8');

  assert.match(source, /function normalizeChooserServiceCategory/);
  assert.match(source, /token\.includes\('plastic'\).*return 'plastic-waste'/);
  assert.match(source, /function dedupeClientServiceChooserOptions/);
  assert.match(source, /optionsByApplicantAndCategory/);
  assert.match(source, /canonicalCategory \? 100 : 0/);
  assert.match(source, /return dedupeClientServiceChooserOptions\(persistedRecords\)/);
});
const vm = require('node:vm');
function chooserContext() {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/ClientMaster.jsx'), 'utf8');
  const context = vm.createContext({ readClientData: service => service.data || {}, getClientServiceViewKey: service => service._id || service.assignedServiceId || '' });
  vm.runInContext(source.slice(source.indexOf('function clientMasterGroupingIdentity'), source.indexOf('function legacyServiceFingerprintCompatible')), context);
  vm.runInContext(source.slice(source.indexOf('function normalizeChooserServiceCategory'), source.indexOf('function buildAssignedServiceChooserOptions')), context);
  return context;
}
const chooserOption = (id, applicantType, plantUnit, category = 'EPR - Plastic Waste') => ({ _id: id, workflowStatus: 'submitted', data: { selectedLeadSnapshot: { applicantType }, basic: { piboCategory: 'Brand Owner', plantUnit, eprCategory: category } } });
test('CAPITAL COLOURS legacy record merges with its sole current Brand Owner unit without losing saved data', () => {
  const context = chooserContext();
  const current = chooserOption('current', 'PIBO', 'Unit 1');
  const legacy = chooserOption('legacy', '', '', 'EPR-PLASTIC'); legacy.data.cpcb = { ceprUserId: 'fixture-login', ceprPassword: 'fixture-secret', registrationNumber: 'fixture-registration' };
  const snapshot = JSON.stringify([current, legacy]);
  for (const rows of [[current, legacy], [legacy, current]]) {
    const result = context.dedupeClientServiceChooserOptions(rows);
    assert.equal(result.length, 1); assert.equal(result[0]._id, 'legacy');
    assert.equal(result[0].data.selectedLeadSnapshot.applicantType, 'PIBO'); assert.equal(result[0].data.basic.plantUnit, 'Unit 1'); assert.equal(result[0].data.cpcb.ceprUserId, 'fixture-login');
  }
  assert.equal(JSON.stringify([current, legacy]), snapshot);
});
test('missing unit cannot arbitrarily absorb either of two real units', () => {
  const context = chooserContext();
  const rows = [chooserOption('unit1', 'PIBO', 'Unit 1'), chooserOption('unit2', 'PIBO', 'Unit 2'), chooserOption('legacy', '', '')];
  assert.equal(context.dedupeClientServiceChooserOptions(rows).length, 3);
  assert.equal(context.dedupeClientServiceChooserOptions(rows.slice(0, 2)).length, 2);
});
test('different waste categories and explicit applicant parents remain separate', () => {
  const context = chooserContext();
  const base = chooserOption('plastic', 'PIBO', 'Unit 1');
  assert.equal(context.dedupeClientServiceChooserOptions([base, chooserOption('battery', 'PIBO', 'Unit 1', 'EPR - Battery Waste')]).length, 2);
  assert.equal(context.dedupeClientServiceChooserOptions([base, chooserOption('pwp', 'PWP', 'Unit 1')]).length, 2);
});
test('a missing Client Master placeholder cannot replace the saved legacy master', () => {
  const context = chooserContext();
  const current = chooserOption('', 'PIBO', 'Unit 1'); current._clientMasterAvailable = false; current.workflowStatus = '';
  const legacy = chooserOption('saved-master', '', '', 'EPR-PLASTIC'); legacy.workflowStatus = '';
  assert.equal(context.dedupeClientServiceChooserOptions([current, legacy])[0]._id, 'saved-master');
});
