const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const leadDeletionVisibility = require('../src/utils/leadDeletionVisibility');
const { userHasAnyRole } = require('../src/utils/userRoles');

function controller(update) {
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/controllers/leadDeletionController.js'), 'utf8'), {
    exports, Date,
    require(name) {
      if (name === 'mongoose') return { isValidObjectId: (id) => /^[a-f0-9]{24}$/.test(id) };
      if (name.endsWith('/Lead')) return { findOneAndUpdate: (...args) => ({ select: () => update(...args) }) };
      if (name.endsWith('/userRoles')) return { userHasAnyRole };
      if (name.endsWith('/roles')) return { ADMIN_ROLES: ['admin', 'superadmin'] };
      throw new Error(name);
    }
  });
  return exports.deleteLead;
}
async function request(handler, role = 'admin', id = '64b000000000000000000001') {
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ user: { _id: 'admin-id', role }, params: { id } }, response, (error) => { throw error; });
  return response;
}
test('only admin and superadmin can delete, with no mutation by sales or managers', async () => {
  let calls = 0;
  const handler = controller(async () => { calls++; return { _id: 'lead' }; });
  for (const role of ['sales', 'operation', 'manager']) assert.equal((await request(handler, role)).statusCode, 403);
  assert.equal(calls, 0);
  for (const role of ['admin', 'superadmin']) assert.equal((await request(handler, role)).statusCode, 200);
  assert.equal(calls, 2);
});
test('delete atomically records administrator and timestamp, and repeated deletion returns 404', async () => {
  let exists = true;
  const handler = controller(async (filter, update) => {
    assert.equal(filter.deletedAt, null);
    assert.equal(update.$set.deletedBy, 'admin-id');
    assert.ok(update.$set.deletedAt instanceof Date);
    if (!exists) return null;
    exists = false;
    return { _id: filter._id };
  });
  assert.equal((await request(handler)).body.ok, true);
  assert.equal((await request(handler)).statusCode, 404);
});
test('invalid lead ID cannot mutate a record', async () => {
  const handler = controller(() => { throw new Error('Unexpected mutation'); });
  assert.equal((await request(handler, 'admin', 'invalid')).statusCode, 400);
});
test('deleted leads stay out of lists, detail lookups, updates, counts and aggregates', () => {
  const hooks = new Map();
  leadDeletionVisibility({ pre(names, hook) { for (const name of Array.isArray(names) ? names : [names]) hooks.set(name, hook); } });
  for (const name of ['find', 'findOne', 'findOneAndUpdate', 'countDocuments', 'distinct', 'updateOne', 'updateMany']) {
    let filter;
    hooks.get(name).call({ getFilter: () => ({ $or: [{ company: 'Test' }, { deletedAt: { $ne: null } }] }), setQuery: (value) => { filter = value; } });
    assert.deepEqual(filter.$and[1], { deletedAt: null });
  }
  const pipeline = [{ $match: { status: 'Closed' } }, { $count: 'total' }];
  hooks.get('aggregate').call({ pipeline: () => pipeline });
  assert.deepEqual(pipeline[0], { $match: { deletedAt: null } });
  const geoPipeline = [{ $geoNear: {} }];
  hooks.get('aggregate').call({ pipeline: () => geoPipeline });
  assert.ok(geoPipeline[0].$geoNear);
  assert.deepEqual(geoPipeline[1], { $match: { deletedAt: null } });
});
