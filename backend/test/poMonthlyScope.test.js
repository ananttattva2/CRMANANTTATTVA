const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('monthly PO response retains role scope and excludes proof payloads', async () => {
  const source = fs.readFileSync('backend/src/controllers/dashboardInsightsController.js', 'utf8');
  const handler = source.slice(source.indexOf('exports.purchaseOrders ='), source.indexOf('exports.purchaseSales ='));
  const sandbox = {
    exports: {}, getVisibleUserScope: async () => ({ ids: ['allowed'], identities: [] }),
    cachedMonthlyPurchaseOrders: (_, load) => load(),
    ownerFilter: () => ({ scoped: true }), getAdminCreatedLeadReferences: async () => [],
    getAssignmentDashboardLeadReferences: async () => ({ assignmentScoped: true, ids: [] }),
    dashboardLeadExclusionFilter: () => ({}), combineFilters: () => ({ scoped: true }),
    Lead: {}, Client: {}, Quotation: {}, User: {}, text: value => String(value || ''), visibleUsers: async () => [],
    loadPurchaseOrders: async (_, filter) => {
      assert.equal(filter.scoped, true);
      return [{ id: 'one', ownerId: 'allowed', leadOwnerId: 'sales-owner', leadOwnerName: 'Sales Owner', applicantType: 'PIBO', subApplicantType: 'Importer', poAmount: 100, poProof: { url: 'data:large' } }, { id: 'two', ownerId: 'hidden', leadOwnerId: 'hidden-owner', poAmount: 500 }, { id: 'three', ownerId: 'other-executor', leadOwnerId: 'allowed', leadOwnerName: 'Visible Owner', poAmount: 200 }];
    }
  };
  vm.runInNewContext(handler, sandbox);
  let payload;
  await sandbox.exports.purchaseOrders({ user: {}, query: { view: 'monthly' } }, { json: value => { payload = value; } });
  assert.equal(payload.scope, 'role-scoped');
  assert.equal(payload.records.length, 2);
  assert.equal(payload.records[1].id, 'three');
  assert.equal(payload.records[1].ownerId, 'allowed');
  assert.equal(payload.records[0].id, 'one');
  assert.equal(payload.records[0].ownerId, 'sales-owner');
  assert.equal(payload.records[0].ownerName, 'Sales Owner');
  assert.equal(payload.records[0].applicantType, 'PIBO');
  assert.equal(payload.records[0].subApplicantType, 'Importer');
  assert.equal('poProof' in payload.records[0], false);
});

test('monthly PO dashboard retains allocated Admin-created work while excluding unassigned test leads', async () => {
  const source = fs.readFileSync('backend/src/controllers/dashboardInsightsController.js', 'utf8');
  const handler = source.slice(source.indexOf('exports.purchaseOrders ='), source.indexOf('exports.purchaseSales ='));
  const { dashboardLeadExclusionFilter } = require('../src/services/dashboardTestLeadExclusion');
  const sandbox = {
    exports: {}, getVisibleUserScope: async () => null,
    cachedMonthlyPurchaseOrders: (_, load) => load(), ownerFilter: () => ({}),
    getAdminCreatedLeadReferences: async () => ({ adminIds: ['admin'] }),
    getAssignmentDashboardLeadReferences: async () => ({ assignmentScoped: true, ids: ['test-lead'] }),
    dashboardLeadExclusionFilter, combineFilters: (_, exclusion) => exclusion,
    Lead: {}, Client: {}, Quotation: {}, User: {}, text: value => String(value || ''),
    loadPurchaseOrders: async (_, filter) => {
      const leads = [
        { id: 'real-po', leadId: 'allocated-lead', createdBy: 'admin', approvalStatus: 'APPROVED', poDate: '2026-06-25', poAmount: 35000 },
        { id: 'test-po', leadId: 'test-lead', createdBy: 'admin', approvalStatus: 'APPROVED', poAmount: 100 }
      ];
      return leads.filter(row => !filter._id?.$nin.includes(row.leadId) && !filter.createdBy?.$nin.includes(row.createdBy));
    }
  };
  vm.runInNewContext(handler, sandbox);
  let payload;
  await sandbox.exports.purchaseOrders({ user: {}, query: { view: 'monthly' } }, { json: value => { payload = value; } });
  assert.equal(payload.records.length, 1);
  assert.equal(payload.records[0].id, 'real-po');
  assert.equal(payload.records[0].approvalStatus, 'APPROVED');
  assert.equal(payload.records[0].poAmount, 35000);
});
