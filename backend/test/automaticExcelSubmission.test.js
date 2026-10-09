const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const service = require('../src/services/purchaseDataService');

for (const moduleName of ['purchase', 'sales']) {
  for (const failEmail of [false, true]) {
    test(`${moduleName}: second Excel saves pending submission before email${failEmail ? ' failure' : ''}`, async () => {
      const saved = [];
      const notifications = [];
      const record = { checklist: [], financialYear: '2025-26', dataVersion: 0, reviewHistory: [],
        markModified() {}, toObject() { return { ...this }; }, async save() { saved.push({ version: this.dataVersion, status: this.managerVerificationStatus }); } };
      const client = { _id: 'client-id', data: { basic: { clientLegalName: 'Example Client' } } };
      const dataModel = { async findOne() { return record; } };
      const rowsModel = { async insertMany() {}, async deleteMany() {}, find() { return { async lean() { return []; } }; } };
      const mocks = {
        mongoose: { Types: { ObjectId: Object.assign(function ObjectId() { this.value = Math.random(); }, { isValid: () => true }) } },
        '../models/Client': { async findOne() { return client; } },
        [`../models/${moduleName === 'purchase' ? 'Purchase' : 'Sales'}Data`]: dataModel,
        [`../models/${moduleName === 'purchase' ? 'Purchase' : 'Sales'}ImportRow`]: rowsModel,
        '../services/purchaseDataService': { ...service, normalizePurchaseRows: () => ({ acceptedRows: [{ quantity: 1 }], totalRows: 1, invalidRowCount: 0, duplicateRowCount: 0, validationErrors: [] }) },
        '../utils/visibilityScope': { async getVisibleUserScope() { return {}; }, ownerFilter: () => ({}) },
        [`../services/${moduleName}DataNotifications`]: { [moduleName === 'purchase' ? 'notifyPurchaseWorkflow' : 'notifySalesWorkflow']: async (args) => {
          assert.equal(saved.at(-1).status, 'Pending');
          notifications.push(args);
          if (failEmail) throw new Error('mail unavailable');
          return { ok: true, emailSent: 1 };
        } }
      };
      const exports = {};
      vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, `../src/controllers/${moduleName}DataController.js`), 'utf8'), { exports, require: name => { assert.ok(mocks[name], name); return mocks[name]; }, console: { error() {} }, Date });
      const handler = exports[moduleName === 'purchase' ? 'importPurchaseRows' : 'importSalesRows'];
      const user = { _id: 'user-id', name: 'Uploader', role: 'user' };
      let response;
      const res = { status(code) { assert.fail(`Unexpected HTTP ${code}`); }, json(value) { response = value; } };
      for (const source of ['base', 'portal']) {
        await handler({ params: { id: 'client-id', source }, user, body: { financialYear: '2025-26', file: { name: `${source}.xlsx`, url: `https://example.test/${source}.xlsx` }, rows: [{}] } }, res);
        assert.equal(response.ok, true);
        if (source === 'base') { assert.equal(notifications.length, 0); assert.equal(record.managerVerificationStatus, 'Not Submitted'); }
      }
      assert.equal(record.managerVerificationStatus, 'Pending');
      assert.equal(record.submittedBy, 'user-id');
      assert.equal(record.lastSubmissionVersion, 2);
      assert.equal(record.reviewHistory.at(-1).stage, 'User');
      assert.equal(response[`${moduleName}Data`].calculatedStatus, 'Manager Review Pending');
      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].stage, 'manager_pending');
      assert.equal(notifications[0].preventDuplicate, true);
      assert.match(notifications[0].message, /base.xlsx.*portal.xlsx/);
      assert.equal(service.purchaseReadiness(record).ready, false);
    });
  }
}
