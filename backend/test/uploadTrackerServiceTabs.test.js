const test = require('node:test');
const assert = require('node:assert/strict');
const { matchesTrackedService, buildUploadTracker } = require('../src/services/clientUploadTracker');
const user = { _id: 'sonal', name: 'Sonal', role: 'operation' };
function client(id, offered) {
  return { _id: id, assignedServiceId: id, selectedLead: { company: 'Example Ltd', assignments: [{ assignedServiceId: id, assignedStaff: user._id }], serviceSelections: [{ assignedServiceId: id, servicesOffered: offered }] }, data: { basic: {} } };
}
test('annual and registration tabs match saved service aliases and arrays', () => {
  for (const name of ['Annual Return', 'Annual Filling', 'Annual Filing', 'Annual Return Filling']) {
    assert(matchesTrackedService(client('a', name), 'annual'));
    assert(!matchesTrackedService(client('a', name), 'registration'));
  }
  for (const name of ['Registration', 'New Registration']) {
    assert(matchesTrackedService(client('a', name), 'registration'));
    assert(!matchesTrackedService(client('a', name), 'annual'));
  }
  assert(matchesTrackedService(client('a', ['Consulting', 'New Registration']), 'registration'));
  assert(!matchesTrackedService(client('a', 'Consulting'), 'registration'));
});
test('service filtering precedes company aggregation so registration does not dilute annual progress', () => {
  const annual = client('annual', 'Annual Filling'), registration = client('registration', 'New Registration');
  const clients = [annual, registration];
  const purchase = [{ clientId: 'annual', checklist: [{ particular: 'Data Explained', yesNo: 'Yes' }] }];
  const ar = buildUploadTracker(clients.filter(row => matchesTrackedService(row, 'annual')), [user], purchase, []);
  const reg = buildUploadTracker(clients.filter(row => matchesTrackedService(row, 'registration')), [user], purchase, []);
  assert.equal(ar[0].clients.length, 1);
  assert.equal(ar[0].purchase[0].complete, 1);
  assert.deepEqual(ar[0].clients[0].clientIds, ['annual']);
  assert.equal(reg[0].purchase[0].pending, 1);
  assert.deepEqual(reg[0].clients[0].clientIds, ['registration']);
});
test('assigned service controls the filter when sibling services and stale basic data disagree', () => {
  const row = client('registration', 'New Registration');
  row.selectedLead.serviceSelections.unshift({ assignedServiceId: 'annual', servicesOffered: 'Annual Return Filling' });
  row.data.basic.servicesOffered = 'Annual Return Filling';
  assert(matchesTrackedService(row, 'registration'));
  assert(!matchesTrackedService(row, 'annual'));
});
