const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { directQuotationApproval } = require('../src/services/directQuotationApproval');

const source = fs.readFileSync(path.join(__dirname, '../src/controllers/quotationController.js'), 'utf8');

for (const role of ['sales', 'operation', 'manager', 'franchise', 'admin', 'superadmin']) {
  for (const mode of ['create', 'update']) {
    test(`${role}: ${mode} quotation waits for Admin Approval details before entering the queue`, async () => {
      let queued = false;
      let removed = false;
      const data = { items: [], grandTotal: 25000 };
      const document = {
        _id: 'quotation', status: 'approved',
        managementApproval: { status: 'APPROVED', adminApprovalStatus: 'APPROVED' },
        approvalDecision: { status: 'APPROVED' }, items: [],
        toObject() { return { ...this }; }, markModified() {}, async save() {}, async populate() { return this; }
      };
      const context = {
        exports: {}, console, directQuotationApproval,
        validateGstNumber: () => '', quotationAccessFilter: async () => ({}), combineFilters: (...values) => values,
        cleanBody: () => data, refreshQuotationLeadDetails: async (value) => value, validatePaymentTerms: () => '',
        validateQuotationItemDates() {}, validateQuotationPiboItems: async () => {}, resolveCrmRelationships: async () => ({}),
        nextQuotationNumber: async () => 'AT/26-27/test',
        Quotation: { findOne: async () => document, create: async (fields) => Object.assign(document, fields) },
        PendingApproval: { deleteMany: async () => { removed = true; } },
        upsertQuotationPendingApproval: async () => { queued = true; },
        sendQuotationLifecycleEmail: async () => {}
      };
      const name = `${mode}Quotation`;
      const start = source.indexOf(`exports.${name} =`);
      const end = source.indexOf('\nexports.', start + 1);
      vm.runInNewContext(source.slice(start, end), context);
      let response;
      await context.exports[name](
        { body: { leadDetails: {} }, params: { id: 'quotation' }, user: { _id: 'user', role, name: 'User' } },
        { status() { return this; }, json(value) { response = value; } }
      );

      assert.equal(response.ok, true);
      assert.equal(document.status, 'submitted');
      assert.equal(Object.keys(document.managementApproval || {}).length, 0);
      assert.equal(Object.keys(document.approvalDecision || {}).length, 0);
      assert.equal(queued, false);
      if (mode === 'update') {
        assert.equal(removed, true);
        assert.equal(document.revisionHistory.length, 1);
      }
    });
  }
}
