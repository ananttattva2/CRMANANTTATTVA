const { test } = require('node:test');
const assert = require('node:assert/strict');
const Client = require('../src/models/Client');
const Lead = require('../src/models/Lead');
const { getAnnualReturnPoStatus, getServiceHistory } = require('../src/controllers/clientController');
const clientId = '6ac6116285b4217820c682a4';
const leadId = '507f1f77bcf86cd799439012';
const query = data => ({ select() { return this; }, lean: async () => data });
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
test('assigned staff can read the same Annual Return PO status as an admin', async t => {
  const filters = [];
  t.mock.method(Lead, 'find', () => query([{ _id: leadId, leadCode: 'ASSIGNED-LEAD' }]));
  t.mock.method(Lead, 'findById', () => query({ _id: leadId, assignments: [], serviceSelections: [] }));
  t.mock.method(Client, 'findOne', filter => {
    filters.push(filter);
    const isDirectAdmin = !filter.$and;
    const includesAssignedLead = JSON.stringify(filter).includes(`"selectedLead":{"$in":["${leadId}"]}`);
    return query(isDirectAdmin || includesAssignedLead ? { _id: clientId, selectedLead: leadId } : null);
  });
  const bodies = [];
  for (const role of ['operation', 'admin']) {
    const res = response();
    await getAnnualReturnPoStatus({ user: { _id: '507f1f77bcf86cd799439011', role, email: 'assigned@example.test' }, params: { id: clientId }, query: { years: '2023-24,2024-25,2025-26' } }, res);
    assert.equal(res.code, 200);
    bodies.push(res.body);
  }
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(filters[0].$and[0]._id, clientId);
  assert.equal(bodies[0].years.length, 3);
});
test('unassigned staff still receive 404 without exposing another client PO data', async t => {
  t.mock.method(Lead, 'find', () => query([]));
  t.mock.method(Client, 'findOne', filter => {
    assert.ok(filter.$and, 'restricted owner scope must remain applied');
    assert.equal(filter.$and[0]._id, clientId);
    return query(null);
  });
  const res = response();
  await getAnnualReturnPoStatus({ user: { _id: '507f1f77bcf86cd799439011', role: 'operation' }, params: { id: clientId }, query: { years: '2025-26' } }, res);
  assert.equal(res.code, 404);
});


test('Service History works without annual years and retains assigned-user access', async t => {
  t.mock.method(Lead, 'find', () => query([{_id:leadId}]));
  t.mock.method(Lead, 'findById', () => query({assignments:[],serviceSelections:[]}));
  t.mock.method(Client, 'findOne', filter => {
    assert.ok(filter.$and, 'service history must retain client access restrictions');
    return query({_id:clientId,selectedLead:leadId});
  });
  const res=response();
  await getServiceHistory({user:{_id:'507f1f77bcf86cd799439011',role:'operation'},params:{id:clientId},query:{}},res);
  assert.equal(res.code,200);assert.deepEqual(res.body.services,[]);
});
test('Service History does not expose inaccessible clients', async t => {
 t.mock.method(Lead,'find',()=>query([]));t.mock.method(Client,'findOne',()=>query(null));
 const res=response();await getServiceHistory({user:{_id:'507f1f77bcf86cd799439011',role:'operation'},params:{id:clientId},query:{}},res);
 assert.equal(res.code,404);
});
