const { test } = require('node:test');
const assert = require('node:assert/strict');
const Client = require('../src/models/Client');
const PurchaseData = require('../src/models/PurchaseData');
const SalesData = require('../src/models/SalesData');
const Proof = require('../src/models/PurchaseProof');
const clientController = require('../src/controllers/clientController');
const proofService = require('../src/services/purchaseEmailProofService');
const activity = require('../src/services/activityLogService');
const { defaultChecklist } = require('../src/services/purchaseDataService');
const id = '507f1f77bcf86cd799439011';
const raw = 'From: client@example.test\r\nTo: staff@example.test\r\nSubject: Client approval\r\nDate: Wed, 04 Nov 2026 10:00:00 +0530\r\nMessage-ID: <proof@example.test>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\nPurchase and sales information is approved.';
const response = () => ({ code: 200, status(value) { this.code = value; return this; }, json(value) { this.body = value; return this; } });

test('ordinary staff and administrators can upload genuine email proof only within their client access scope', async t => {
  let allowClient = true, currentRole, savedProofs = [], stored = [];
  t.mock.method(clientController, 'clientAccessFilter', async user => ({ allowedFor: user._id, role: user.role }));
  t.mock.method(Client, 'findOne', async filter => {
    assert.deepEqual(filter.$and[1], { allowedFor: id, role: currentRole });
    return allowClient ? { _id: id } : null;
  });
  t.mock.method(proofService, 'uploadBuffer', async (buffer, name, type) => { stored.push({ buffer, name, type }); return { storageKey: 'spaces:proof-test', storageUrl: 'https://example.test/proof.eml' }; });
  t.mock.method(activity, 'logActivity', async () => ({}));
  t.mock.method(Proof, 'findOne', async () => null);
  t.mock.method(Proof, 'create', async data => { const proof = { ...data, _id: id, createdAt: new Date() }; savedProofs.push(proof); return proof; });
  for (const Model of [PurchaseData, SalesData]) t.mock.method(Model, 'findOne', async () => ({
    checklist: defaultChecklist(), markModified() {}, async save() {},
    toObject() { return { checklist: this.checklist }; }
  }));
  const controllerPath = require.resolve('../src/controllers/purchaseProofController');
  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  t.after(() => { delete require.cache[controllerPath]; });
  const request = section => ({ user: { _id: id, role: currentRole, name: 'CRM Staff', email: 'staff@example.test' }, params: { clientId: id }, body: { section, financialYear: '2026-27', progressParticular: 'Received from client' }, file: { buffer: Buffer.from(raw), size: Buffer.byteLength(raw), originalname: 'approval.eml', mimetype: 'message/rfc822' } });
  for (const role of ['operation', 'sales', 'manager', 'accounts', 'cte-cto', 'admin', 'superadmin']) {
    currentRole = role;
    for (const section of ['purchase', 'sales']) {
      const res = response();
      await controller.uploadEmailProof(request(section), res);
      assert.equal(res.code, 201, `${role}: ${section}`);
      assert.equal(res.body.proof.emailData.subject, 'Client approval');
      assert.equal(res.body.proof.emailData.decodeStatus, 'Decoded');
    }
  }
  assert.equal(savedProofs.length, 14);
  assert.equal(stored.length, 14);
  stored.forEach(item => { assert.equal(item.type, 'message/rfc822'); assert.match(item.buffer.toString(), /information is approved/); });
  allowClient = false; currentRole = 'operation';
  const denied = response(); await controller.uploadEmailProof(request('purchase'), denied);
  assert.equal(denied.code, 404); assert.equal(stored.length, 14);
  currentRole = 'compliance';
  const readOnly = response(); await controller.uploadEmailProof(request('purchase'), readOnly);
  assert.equal(readOnly.code, 403); assert.equal(stored.length, 14);
});
