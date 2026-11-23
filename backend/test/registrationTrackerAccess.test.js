const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('registration tracker persists against exact client, service and PO; rejects inaccessible and non-registration work', async () => {
  let accessible = true, service = 'New Registration', saved, observedFilter;
  const context = { exports: {}, require: name => {
    if (name === '../models/Client') return { findOne: filter => { observedFilter = filter; return { lean: async () => accessible ? { _id: 'client' } : null }; } };
    if (name === '../models/RegistrationTracker') return { findOne: () => ({ lean: async () => null }), findOneAndUpdate: async (filter, update) => { saved = { filter, update }; return update.$set; } };
    if (name === '../services/annualReturnPoResolver') return { resolveServiceHistory: async () => [{ assignedServiceId: 'reg', number: 'PO-1', registrationYear: '2026-27', service }] };
    if (name === './clientController') return { clientAccessFilter: async () => ({ createdBy: 'worker' }) };
    return require('../../shared/serviceYearAccess.cjs');
  } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/controllers/registrationTrackerController.js'), 'utf8'), context);
  const req = { method: 'PUT', params: { id: 'client' }, user: { _id: 'worker' }, body: { assignedServiceId: 'reg', poNumber: 'PO-1', registrationYear: '2026-27', dataExplained: 'no', dataReceived: 'no', registrationCompleted: 'no', proof: { name: 'registration.pdf', secureUrl: 'https://example.test/proof.pdf' } } };
  let result, failure;
  await context.exports.save(req, { json: value => { result = value; } }, error => { throw error; });
  assert.equal(result.ok, true); assert.equal(saved.filter.assignedServiceId, 'reg'); assert.equal(saved.filter.poNumber, 'PO-1');
  assert.equal(observedFilter.$and[1].createdBy, 'worker');
  accessible = false;
  await context.exports.save(req, {}, error => { failure = error; }); assert.equal(failure.status, 404);
  accessible = true; service = 'Renewal';
  await context.exports.save(req, {}, error => { failure = error; }); assert.equal(failure.status, 403);
});
