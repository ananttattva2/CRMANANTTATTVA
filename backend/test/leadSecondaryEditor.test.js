const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Lead = require('../src/models/Lead');
const User = require('../src/models/User');
const LeadActivity = require('../src/models/LeadActivity');
const controller = require('../src/controllers/leadController');

const ids = { lead: '111111111111111111111111', primary: '222222222222222222222222', secondary: '333333333333333333333333', other: '444444444444444444444444' };
function response() {
  return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}
function fixture(t) {
  const lead = new Lead({ _id: ids.lead, company: 'Example', createdBy: ids.primary, createdByName: 'Primary', generatedForUser: ids.primary, workflowStatus: 'draft' });
  t.mock.method(lead, 'save', async () => lead);
  const query = { populate() { return this; }, then(resolve, reject) { return Promise.resolve(lead).then(resolve, reject); } };
  t.mock.method(Lead, 'findById', () => query);
  t.mock.method(User, 'findById', (id) => ({ select: async () => ({ _id: id, name: id === ids.secondary ? 'Secondary' : 'Primary', email: `${id}@example.com`, isActive: true }) }));
  t.mock.method(LeadActivity, 'create', async () => ({}));
  return lead;
}
async function assign(slot, userId) {
  const res = response();
  await controller.updateLeadCreator({ params: { id: ids.lead }, body: { slot, userId }, user: { _id: ids.other, role: 'admin', name: 'Admin' } }, res);
  return res;
}
function matches(lead, filter) {
  if (filter.$and) return filter.$and.every(value => matches(lead, value));
  if (filter.$or) return filter.$or.some(value => matches(lead, value));
  return Object.entries(filter).every(([key, condition]) => {
    const value = lead[key];
    if (condition?.$in) return condition.$in.some(id => String(id) === String(value));
    if (condition?.$regex) return new RegExp(condition.$regex, condition.$options).test(String(value || ''));
    return String(value) === String(condition);
  });
}

test('secondary assignment persists, leaves primary/owner intact, records audit and can be removed', async t => {
  const lead = fixture(t);
  let res = await assign('secondary', ids.secondary);
  assert.equal(res.code, 200);
  assert.equal(String(lead.secondaryCreatedBy), ids.secondary);
  assert.equal(lead.secondaryCreatedByName, 'Secondary');
  assert.equal(String(lead.createdBy), ids.primary);
  assert.equal(String(lead.generatedForUser), ids.primary);
  assert.equal(lead.creatorChangeHistory[0].slot, 'secondary');
  res = await assign('secondary', '');
  assert.equal(res.code, 200);
  assert.equal(lead.secondaryCreatedBy, null);
  assert.equal(lead.secondaryCreatedByName, '');
  assert.equal(lead.creatorChangeHistory.length, 2);
});

test('duplicate editors, inactive users, malformed IDs and empty primary are rejected', async t => {
  const lead = fixture(t);
  assert.equal((await assign('secondary', ids.primary)).code, 400);
  lead.secondaryCreatedBy = ids.secondary;
  assert.equal((await assign('primary', ids.secondary)).code, 400);
  assert.equal((await assign('primary', '')).code, 400);
  assert.equal((await assign('secondary', 'bad-id')).code, 400);
  assert.equal((await assign('invalid-slot', ids.secondary)).code, 400);
  t.mock.method(User, 'findById', () => ({ select: async () => ({ _id: ids.other, isActive: false }) }));
  assert.equal((await assign('secondary', ids.other)).code, 404);
});

test('primary changes retain secondary allocation and existing Lead Owner', async t => {
  const lead = fixture(t);
  lead.secondaryCreatedBy = ids.secondary;
  const res = await assign('primary', ids.other);
  assert.equal(res.code, 200);
  assert.equal(String(lead.createdBy), ids.other);
  assert.equal(String(lead.secondaryCreatedBy), ids.secondary);
  assert.equal(String(lead.generatedForUser), ids.primary);
  assert.equal(lead.creatorChangeHistory[0].slot, 'primary');
});

test('primary and secondary can load lead details; unrelated users cannot', async t => {
  const lead = fixture(t);
  lead.secondaryCreatedBy = ids.secondary;
  t.mock.method(Lead, 'findOne', filter => ({ populate() { return this; }, lean: async () => matches(lead, filter) ? lead.toObject() : null }));
  for (const id of [ids.primary, ids.secondary, ids.other]) {
    const res = response();
    await controller.getLead({ params: { id: ids.lead }, user: { _id: id, role: 'sales' } }, res);
    assert.equal(res.code, id === ids.other ? 404 : 200);
    if (res.code === 200) assert.equal(String(res.body.lead.secondaryCreatedBy), ids.secondary);
  }
});

test('secondary can edit existing services without taking their creator credit', () => {
  const service = { servicesOffered: 'Consulting', createdByCrmUserId: ids.primary };
  const lead = { createdBy: ids.primary, secondaryCreatedBy: ids.secondary, serviceSelections: [service] };
  assert.equal(controller._test.validateServiceRemovalPermission(lead, [], { _id: ids.secondary, role: 'sales' }), '');
  assert.equal(controller._test.validateServiceRemovalPermission(lead, [], { _id: ids.other, role: 'sales' }), 'You can remove only services that you created.');
  assert.equal(service.createdByCrmUserId, ids.primary);
});

test('both editors can save lead changes; unrelated users and removed secondary cannot', async t => {
  const lead = fixture(t);
  lead.secondaryCreatedBy = ids.secondary;
  t.mock.method(Lead, 'findOne', filter => Promise.resolve(matches(lead, filter) ? lead : null));
  for (const id of [ids.primary, ids.secondary]) {
    const res = response();
    await controller.updateLead({ params: { id: ids.lead }, body: { notes: `Updated by ${id}`, secondaryCreatedBy: ids.other }, get: () => '', user: { _id: id, role: 'sales', name: id } }, res);
    assert.equal(res.code, 200, res.body?.error);
    assert.equal(lead.notes, `Updated by ${id}`);
    assert.equal(String(lead.secondaryCreatedBy), ids.secondary, 'Ordinary edits cannot reassign editors');
  }
  for (const id of [ids.other, ids.secondary]) {
    if (id === ids.secondary) lead.secondaryCreatedBy = null;
    const res = response();
    await controller.updateLead({ params: { id: ids.lead }, body: { notes: 'Forbidden' }, get: () => '', user: { _id: id, role: 'sales' } }, res);
    assert.equal(res.code, 404);
  }
});

test('frontend exposes editing to both assigned users and hides it after secondary removal', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/LeadGeneration.jsx'), 'utf8');
  const start = source.indexOf('function normalizePersonName(');
  const end = source.indexOf('function leadStaffIdentityTokens(', start);
  const canEdit = vm.runInNewContext(`${source.slice(start, end)}; canUserEditLead`, { adminRoles: ['admin', 'superadmin'] });
  const lead = { createdBy: { _id: ids.primary }, secondaryCreatedBy: ids.secondary };
  assert.equal(canEdit(lead, { _id: ids.primary, role: 'sales' }), true);
  assert.equal(canEdit(lead, { _id: ids.secondary, role: 'sales' }), true);
  assert.equal(canEdit(lead, { _id: ids.other, role: 'sales' }), false);
  delete lead.secondaryCreatedBy;
  assert.equal(canEdit(lead, { _id: ids.secondary, role: 'sales' }), false);
});

test('creator allocation route restricts both slots to administrators', () => {
  const router = require('../src/routes/leads');
  const route = router.stack.find(layer => layer.route?.path === '/:id/creator').route;
  const rolesGuard = route.stack[1].handle;
  for (const role of ['sales', 'operation', 'admin', 'superadmin']) {
    const res = response();
    let allowed = false;
    rolesGuard({ user: { _id: ids.secondary, role } }, res, () => { allowed = true; });
    assert.equal(allowed, ['admin', 'superadmin'].includes(role));
  }
});
