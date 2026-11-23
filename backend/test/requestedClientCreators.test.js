const test = require('node:test');
const assert = require('node:assert/strict');
const { matchesCompany, correctRequestedClientCreators } = require('../src/services/requestedClientCreators');
test('only listed companies and their known spellings match the creator correction', () => {
  for (const name of ['SWISS PARENTALS LTD', 'SWISS PARENTERALS LIMITED', 'CCL FOOD AND BEVERAGES PVT LTD', 'ASHISH PLASTICS', 'ANAVEN LLP', 'TENNECO AUTOMOTIVE INDI PVT LTD', 'SOLTEX PETRO PRODUCTS LTD.', 'PERFECT CARBOUYS PVT LTD']) assert.equal(matchesCompany(name), true, name);
  assert.equal(matchesCompany('OTHER PLASTICS'), false); assert.equal(matchesCompany('CCL OTHER COMPANY'), false);
});
test('creator correction backs up source and approval snapshots and preserves assignments', async () => {
  const lead = { _id: 'lead1', company: 'ASHISH PLASTICS', createdBy: 'old', assignments: [{ assignedTo: 'manager1' }] };
  const client = { _id: 'client1', data: { basic: { clientLegalName: 'ASHISH PLASTICS' } } };
  const approval = { _id: 'approval1' }, updates = [], backups = [];
  const query = rows => ({ session() { return this; }, lean: async () => rows });
  const model = (type, rows) => ({ find: () => query(rows), updateOne: async (filter, update) => { updates.push({ type, filter, update }); return {}; } });
  const result = await correctRequestedClientCreators({
    User: { find: () => query([{ _id: 'krishna', name: 'KRISHNA Yadav', email: 'krishna@example.test' }]) },
    Lead: model('lead', [lead]), Client: model('client', [client]), Approval: model('approval', [approval]),
    connection: { startSession: async () => ({ withTransaction: async fn => fn(), endSession() {} }), collection: () => ({ deleteMany: async () => {} }) },
    backup: async data => backups.push(structuredClone(data))
  });
  assert.equal(result.clients, 1); assert.equal(backups.length, 1);
  assert.equal(updates.find(row => row.type === 'approval').update.$set.createdByName, 'KRISHNA Yadav');
  assert.equal(updates.find(row => row.type === 'client').update.$set.createdBy, 'krishna');
  assert.equal(updates.find(row => row.type === 'lead').update.$set.importedCreatedBy, 'KRISHNA Yadav');
  assert.deepEqual(lead.assignments, [{ assignedTo: 'manager1' }]);
});
