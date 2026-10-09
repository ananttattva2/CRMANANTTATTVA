const test = require('node:test');
const assert = require('node:assert/strict');
const Client = require('../src/models/Client');
const Proof = require('../src/models/PurchaseProof');
const Audit = require('../src/models/AuditLog');
const clientController = require('../src/controllers/clientController');
const controller = require('../src/controllers/purchaseProofController');
const id = '64b000000000000000000002';
function response() { return { statusCode:200, status(code) { this.statusCode=code; return this; }, json(body) { this.body=body; return this; } }; }
test('Compliance reads decoded proof for an AR client without changing the file', async t => {
  const proof = { _id:id, clientId:id, name:'Confirmation.msg', mimeType:'application/vnd.ms-outlook', emailData:{ subject:'Purchase confirmation', textBody:'Confirmed' } };
  t.mock.method(Proof, 'findById', async () => proof);
  t.mock.method(Client, 'findOne', async filter => { assert.deepEqual(filter.$and[1], {}); return {_id:id}; });
  t.mock.method(Audit, 'create', async () => ({}));
  t.mock.method(Proof, 'updateOne', () => assert.fail('Preview must not edit a proof'));
  const res = response();
  await controller.getProof({params:{proofId:id}, user:{_id:id,role:'compliance'},headers:{}}, res);
  assert.equal(res.statusCode,200);
  assert.equal(res.body.proof.emailData.textBody,'Confirmed');
  assert.equal(res.body.proof.url,`/api/purchase-proofs/${id}/download`);
});
test('Manager proof preview follows client access scope and denies unrelated clients', async t => {
  t.mock.method(Proof, 'findById', async () => ({_id:id,clientId:id,name:'Confirmation.msg'}));
  t.mock.method(clientController, 'clientAccessFilter', async user => ({managerScope:user._id}));
  t.mock.method(Client, 'findOne', async filter => { assert.deepEqual(filter.$and[1],{managerScope:id}); return null; });
  const res=response();
  await controller.getProof({params:{proofId:id},user:{_id:id,role:'manager'}},res);
  assert.equal(res.statusCode,404);
});
