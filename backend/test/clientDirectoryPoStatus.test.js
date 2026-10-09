const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = () => ({
  _id: 'client-1', assignedServiceId: 's1', data: { basic: { clientLegalName: 'CCL' } },
  selectedLead: { _id: 'lead-1', serviceSelections: [
    { assignedServiceId: 's1', subApplicantType: 'Brand Owner' },
    { assignedServiceId: 's2', subApplicantType: 'Importer' },
    { assignedServiceId: 's3', subApplicantType: 'Producer' }
  ], assignments: [
    { assignedServiceId: 's1', closedAt: '2026-10-09', poYearRows: [{ poNumber: 'PO-1' }] },
    { assignedServiceId: 's2' }, { assignedServiceId: 's3' }
  ] }
});
test('one closed service makes company Yes while export shows Yes, No, No', async () => {
  const { companyPoClosed, clientPoServices, clientPoExportEntries } = await import('../../frontend/src/features/clientMaster/clientPoStatus.mjs');
  const client = fixture();
  assert.equal(companyPoClosed(client), true);
  assert.deepEqual(clientPoServices(client).map(s => [s.closed, s.received]), [[true, true], [false, false], [false, false]]);
  const entries = clientPoExportEntries([client, { ...client, _id: 'client-2', assignedServiceId: 's2' }, { ...client, _id: 'client-3', assignedServiceId: 's3' }]);
  assert.equal(entries.length, 3);
  assert.equal(entries[1].item._id, 'client-2');
});
test('service IDs take precedence over array order and lead closure cannot close siblings', async () => {
  const { clientPoServices } = await import('../../frontend/src/features/clientMaster/clientPoStatus.mjs');
  const client = fixture();
  client.selectedLead.closedAt = '2026-10-09';
  client.selectedLead.assignments.reverse();
  assert.deepEqual(clientPoServices(client).map(s => s.closed), [true, false, false]);
});
test('received PO does not imply closure; old positional and single-service closure supported', async () => {
  const { companyPoClosed, clientPoServices } = await import('../../frontend/src/features/clientMaster/clientPoStatus.mjs');
  const client = fixture();
  delete client.selectedLead.assignments[0].closedAt;
  assert.equal(companyPoClosed(client), false);
  assert.equal(clientPoServices(client)[0].received, true);
  client.selectedLead.assignments[0] = { closedByText: 'User' };
  assert.deepEqual(clientPoServices(client).map(s => s.closed), [true, false, false]);
  assert.equal(companyPoClosed({ selectedLead: { closedByText: 'User', serviceSelections: [{}] } }), true);
});
