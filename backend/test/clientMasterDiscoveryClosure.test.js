const test = require('node:test');
const assert = require('node:assert/strict');
const Lead = require('../src/models/Lead');
const Client = require('../src/models/Client');
const { listClientMasterServices } = require('../src/controllers/clientController');

// Honour the query's inclusion projection so dropping closure evidence reproduces
// the production failure instead of being hidden by an unprojected model stub.
function project(value, paths) {
  if (Array.isArray(value)) return value.map(item => project(item, paths));
  const result = value?._id ? { _id: value._id } : {};
  for (const key of new Set(paths.map(path => path.split('.')[0]))) {
    if (value?.[key] === undefined) continue;
    result[key] = paths.includes(key) ? value[key]
      : project(value[key], paths.filter(path => path.startsWith(`${key}.`)).map(path => path.slice(key.length + 1)));
  }
  return result;
}
const id = '6aa3dbe7d2543e144257cea2';
const admin = { _id: '507f1f77bcf86cd799439011', role: 'admin' };
async function discover(t, lead, user = admin) {
  const filters = [];
  t.mock.method(Lead, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  t.mock.method(Lead, 'findOne', filter => {
    filters.push(filter);
    return { select: fields => ({ lean: async () => project(lead, fields.split(/\s+/)) }) };
  });
  t.mock.method(Client.collection, 'find', () => ({ sort: () => ({ toArray: async () => [] }) }));
  const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await listClientMasterServices({ query: { identity: id }, user }, response);
  return { ...response, filters };
}
test('three assignment-closed services remain eligible in projected service discovery', async t => {
  const services = ['producer', 'brand-owner', 'importer'];
  const result = await discover(t, {
    _id: id, leadCode: 'ATPL-LEAD-TEST', company: 'Fixture company',
    serviceSelections: services.map(assignedServiceId => ({ assignedServiceId })),
    assignments: services.map(assignedServiceId => ({ assignedServiceId, closedAt: new Date(), poFiles: [{ url: 'private-fixture-file' }] }))
  });
  assert.equal(result.code, 200);
  assert.deepEqual(result.body.lead.clientMasterEligibleServiceIds, services);
  assert.equal(result.body.lead.assignments.length, 3);
  assert.ok(result.body.lead.assignments.every(row => row.closedAt && !row.poFiles));
});
test('partial closures unlock only the closed service and leave open services blocked', async t => {
  const result = await discover(t, {
    _id: id, serviceSelections: [{ assignedServiceId: 'closed' }, { assignedServiceId: 'open' }],
    assignments: [{ assignedServiceId: 'closed', closedByText: 'Fixture staff' }, { assignedServiceId: 'open' }]
  });
  assert.equal(result.code, 200);
  assert.deepEqual(result.body.lead.clientMasterEligibleServiceIds, ['closed']);
});
test('single-service legacy lead-level closure survives the discovery projection', async t => {
  const result = await discover(t, { _id: id, closedBy: 'fixture-staff', serviceSelections: [{ assignedServiceId: 'legacy' }] });
  assert.equal(result.code, 200);
  assert.deepEqual(result.body.lead.clientMasterEligibleServiceIds, ['legacy']);
});
test('an actually open lead still receives LEAD_NOT_CLOSED instead of bypassing eligibility', async t => {
  const result = await discover(t, { _id: id, serviceSelections: [{ assignedServiceId: 'open' }], assignments: [{}] });
  assert.equal(result.code, 409);
  assert.equal(result.body.code, 'LEAD_NOT_CLOSED');
});
test('ordinary discovery keeps ownership filtering when loading closure fields', async t => {
  const result = await discover(t, { _id: id, serviceSelections: [{ assignedServiceId: 'closed', closedAt: new Date() }] }, { ...admin, role: 'sales' });
  assert.equal(result.code, 200);
  assert.ok(result.filters[0].$and);
  assert.ok(result.filters[0].$and.some(filter => filter.$or));
});
