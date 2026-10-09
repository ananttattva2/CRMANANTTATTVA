const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('monthly PO response retains role scope and excludes proof payloads', async () => {
  const source = fs.readFileSync('backend/src/controllers/dashboardInsightsController.js', 'utf8');
  const handler = source.slice(source.indexOf('exports.purchaseOrders ='), source.indexOf('exports.purchaseSales ='));
  const sandbox = {
    exports: {}, getVisibleUserScope: async () => ({ ids: ['allowed'], identities: [] }),
    ownerFilter: () => ({ scoped: true }), getAdminCreatedLeadReferences: async () => [],
    dashboardLeadExclusionFilter: () => ({}), combineFilters: () => ({ scoped: true }),
    Lead: {}, Client: {}, Quotation: {}, text: value => String(value || ''), visibleUsers: async () => [],
    loadPurchaseOrders: async (_, filter) => {
      assert.equal(filter.scoped, true);
      return [{ id: 'one', ownerId: 'allowed', poAmount: 100, poProof: { url: 'data:large' } }, { id: 'two', ownerId: 'hidden', poAmount: 500 }];
    }
  };
  vm.runInNewContext(handler, sandbox);
  let payload;
  await sandbox.exports.purchaseOrders({ user: {}, query: { view: 'monthly' } }, { json: value => { payload = value; } });
  assert.equal(payload.scope, 'role-scoped');
  assert.equal(payload.records.length, 1);
  assert.equal(payload.records[0].id, 'one');
  assert.equal('poProof' in payload.records[0], false);
});
