import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTrackerClients } from '../src/utils/uploadTrackerSelection.mjs';
const users = [{ userId: 'u1', userName: 'User One', clients: [{ clientId: 'a', clientName: 'Alpha', slaReceived: true, purchase: ['complete','progress'], sales: ['pending','complete'] }, { clientId: 'b', clientName: 'Beta', slaReceived: false, purchase: ['pending','pending'], sales: ['complete','pending'] }] }, { userId: 'u2', userName: 'User Two', clients: [{ clientId: 'c', clientName: 'Gamma', slaReceived: false, purchase: ['complete','pending'], sales: ['pending','pending'] }] }];
test('tracker count drilldowns preserve allocated, SLA and stage membership', () => {
  assert.deepEqual(selectTrackerClients(users, { userId: 'u1' }).map(row => row.clientName), ['Alpha','Beta']);
  assert.deepEqual(selectTrackerClients(users, { kind: 'sla', received: false }).map(row => row.clientName), ['Beta','Gamma']);
  assert.deepEqual(selectTrackerClients(users, { userId: 'u1', kind: 'stage', module: 'purchase', index: 1, state: 'progress' }).map(row => row.clientName), ['Alpha']);
  assert.deepEqual(selectTrackerClients(users, { kind: 'stage', module: 'purchase', index: 0, state: 'complete' }).map(row => row.clientName), ['Alpha','Gamma']);
  assert.equal(selectTrackerClients(users, { userId: 'u2', kind: 'stage', module: 'sales', index: 0, state: 'complete' }).length, 0);
  assert.equal(selectTrackerClients(users, { kind: 'sla', received: true })[0].userName, 'User One');
});
