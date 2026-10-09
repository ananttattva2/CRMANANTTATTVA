const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('execution register keeps access scope and timeline fields while excluding client forms and PO files', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/controllers/clientController.js'), 'utf8');
  const start = source.indexOf('exports.listClients =');
  const end = source.indexOf('\nexports.', start + 1);
  let filter, projection, response;
  const populations = [];
  const query = {
    select(value) { projection = value; return this; },
    populate(...args) { populations.push(args); return this; },
    sort() { return this; },
    lean: async () => [{ _id: 'visible-client', adminControls: { approvalStatus: 'APPROVED' } }]
  };
  const context = {
    exports: {}, process, Client: { find(value) { filter = value; return query; } },
    clientAccessFilter: async () => ({ createdBy: 'scoped-user' }),
    combineAccessFilters: (...filters) => ({ $and: filters.filter(Boolean) })
  };
  vm.runInNewContext(source.slice(start, end), context);
  await context.exports.listClients({ user: { _id: 'scoped-user' }, query: { view: 'execution' } }, {
    set() {}, json(value) { response = value; }
  });
  assert.match(JSON.stringify(filter), /"createdBy":"scoped-user"/);
  assert.match(JSON.stringify(filter), /"adminControls.approvalStatus":"APPROVED"/);
  assert.equal(response.clients[0]._id, 'visible-client');
  assert.ok(projection.includes('data.clientLifecycle.workFollowUps'));
  assert.ok(!projection.split(' ').includes('data'));
  const leadProjection = populations.find(([field]) => field === 'selectedLead')[1];
  assert.ok(leadProjection.includes('assignments.poYearRows.poDate'));
  assert.ok(!leadProjection.includes('poFile'));
  for (const fields of [projection, leadProjection]) {
    const tokens = fields.split(' ');
    assert.ok(!tokens.some(field => tokens.some(parent => field.startsWith(`${parent}.`))));
  }
});
