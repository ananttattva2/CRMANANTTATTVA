const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ownerFilter } = require('../src/utils/visibilityScope');
const source = fs.readFileSync(path.join(__dirname, '../src/controllers/clientController.js'), 'utf8');
const access = source.slice(source.indexOf('function combineAccessFilters'), source.indexOf('async function leadAccessFilter'));
const start = source.indexOf('exports.updateCpcbOnboarding =');
const action = source.slice(start, source.indexOf('\nexports.', start + 1));
const clientId = '6a7427653e6eb1b90295f6d1';
const leadId = '6a7427653e6eb1b90295f6d0';
function matches(record, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$and') return value.every(item => matches(record, item));
    if (key === '$or') return value.some(item => matches(record, item));
    const actual = key.split('.').reduce((obj, part) => obj?.[part], record);
    if (value && typeof value === 'object') {
      if ('$in' in value) return value.$in.includes(actual);
      if ('$regex' in value) return new RegExp(value.$regex, value.$options).test(actual || '');
      if ('$exists' in value) return (actual !== undefined) === value.$exists;
    }
    return actual === value;
  });
}
for (const exactId of [true, false]) {
  for (const assigned of [true, false]) {
    test(`CPCB ${exactId ? 'exact record' : 'lead/service'} update ${assigned ? 'allows assigned lead' : 'denies unrelated record'}`, async () => {
      let saved = 0, status = 200, body;
      const record = { _id: clientId, selectedLead: leadId, assignedServiceId: 'service-a', createdBy: 'admin', data: {}, markModified() {}, async save() { saved++; } };
      const context = { exports: {}, ownerFilter,
        getVisibleUserScope: async () => ({ ids: ['staff'], identities: [] }),
        Lead: { find: () => ({ select() { return this; }, lean: async () => assigned ? [{ _id: leadId }] : [] }) },
        Client: { findOne: async filter => matches(record, filter) ? record : null },
        mongoose: { Types: { ObjectId: { isValid: () => true } } },
        readSelectedLeadId: value => value,
        validateCpcbOnboardingInput: () => '',
        validateNewClientLeadEligibility: async () => 'Selected lead was not found.',
        CLIENT_MASTER_CLOSED_LEAD_ERROR: 'Lead not closed',
        readClientAssignedServiceId: item => item.assignedServiceId,
        validateClientMasterIdentity: () => '',
        applyCpcbOnboardingData: (_data, value) => ({ cpcbOnboarding: value }),
        syncStaffOnboardingCpcbStatus: async () => {},
        normalizeClientMaster: item => ({ clientMasterId: item._id }),
        resolveClientMasterData: item => item.data
      };
      vm.createContext(context);
      vm.runInContext(access + '\n' + action, context);
      const res = { status(value) { status = value; return this; }, json(value) { body = value; return this; } };
      await context.exports.updateCpcbOnboarding({ user: { _id: 'staff' }, body: {
        ...(exactId ? { clientMasterId: clientId } : {}), selectedLead: leadId,
        assignedServiceId: 'service-a', cpcbPortalRegistered: true
      } }, res);
      assert.equal(status, assigned ? 200 : exactId ? 404 : 409);
      assert.equal(saved, assigned ? 1 : 0);
      if (assigned) assert.equal(body.client.data.cpcbOnboarding.registered, true);
    });
  }
}
