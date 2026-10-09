const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildAppendOnlyServicePatchInternal } = require('../src/controllers/leadController');
const page = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/LeadGeneration.jsx'), 'utf8');

function functionSource(name, next) {
  const start = page.indexOf(`  function ${name}(`) >= 0
    ? page.indexOf(`  function ${name}(`) : page.indexOf(`  async function ${name}(`);
  return page.slice(start, page.indexOf(`  function ${next}(`, start));
}

test('opening Add Services appends an editable row while keeping all existing rows frozen', () => {
  const original = { _id: 'lead-1', leadCode: 'ATPL-1', company: 'Existing', serviceSelections: [{ assignedServiceId: 'old', servicesOffered: 'Registration' }] };
  const state = {};
  const source = functionSource('startAddServicesMode', 'openGeneratedForChooser');
  const context = {
    selectedSearchLead: original, emptyLead: {}, allCcpLeads: [],
    normalizeLegacyServiceSelections: lead => lead.serviceSelections,
    displayLeadId: lead => lead.leadCode, leadRecordId: lead => lead._id,
    createServiceSelection: () => ({ assignedServiceId: 'new', servicesOffered: '' }),
    createAddressRow: () => ({}), showToast() {}
  };
  for (const [, name] of source.matchAll(/\b(set\w+)\(/g)) context[name] = value => { state[name] = value; };
  vm.runInNewContext(`${source} startAddServicesMode();`, context);
  assert.equal(state.setFrozenServiceRowCount, 1);
  assert.equal(state.setLead.serviceSelections.length, 2);
  assert.equal(state.setLead.serviceSelections[0].assignedServiceId, 'old');
  assert.equal(state.setLead.serviceSelections[1].assignedServiceId, 'new');
  const payload = { ...state.setLead, serviceSelections: [state.setLead.serviceSelections[0], { ...state.setLead.serviceSelections[1], servicesOffered: 'Annual Return' }] };
  const patch = buildAppendOnlyServicePatchInternal(original, payload, { _id: 'contributor', name: 'Contributor' });
  assert.equal(patch.serviceSelections.length, 2);
  assert.equal(patch.serviceSelections[1].createdByCrmUserId, 'contributor');
});

test('no new services is caught before either final-submit dialog or draft save', () => {
  const source = functionSource('validateLeadForSubmit', 'requestLeadSubmit');
  for (const workflowStatus of ['draft', 'submitted']) {
    const error = vm.runInNewContext(`${source} validateLeadForSubmit(workflowStatus);`, {
      serviceOnlyMode: true, serviceRows: [{}], frozenServiceRowCount: 1, workflowStatus
    });
    assert.match(error, /Add at least one new service/);
  }
});

test('successful Add Services saves clear append mode for draft, final submit and health allocation', async () => {
  const source = functionSource('saveLead', 'updateHealthReport');
  for (const [workflowStatus, openHealthReport] of [['draft', false], ['submitted', false], ['submitted', true]]) {
    const state = {}, saved = { _id: 'lead-1', serviceSelections: [{}, {}] };
    const context = {
      saving: false, serviceOnlyMode: true, assignmentRows: [], introductionConsent: false,
      validateLeadForSubmit: () => '', buildLeadPayload: () => ({ addServicesMode: true }),
      editingLeadId: 'lead-1', API_ENDPOINTS: { leads: { detail: id => id } },
      api: { put: async () => ({ data: { lead: saved } }) },
      reportToDraft: () => ({}), leadRecordId: lead => lead._id, showToast() {},
      loadPage: async () => {}, emptyLead: {}, formStartedAtRef: { current: 'started' },
      workflowStatus, options: { openHealthReport }
    };
    for (const [, name] of source.matchAll(/\b(set\w+)\(/g)) context[name] = value => { state[name] = value; };
    await vm.runInNewContext(`${source} saveLead(workflowStatus, options);`, context);
    assert.equal(state.setServiceOnlyMode, false);
    assert.equal(state.setFrozenServiceRowCount, 0);
    assert.equal(state.setHealthPromptOpen, false);
    if (openHealthReport) {
      assert.equal(state.setEditingLeadId, 'lead-1');
      assert.equal(state.setHealthReportLead, saved);
    } else {
      assert.equal(state.setEditingLeadId, '');
      assert.equal(state.setViewMode, 'list');
    }
  }
});
