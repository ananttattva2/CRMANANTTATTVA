const test = require('node:test');
const assert = require('node:assert/strict');
test('lead owner follows generated-for ownership rather than client creator or execution assignee', async () => {
  const { clientLeadOwner } = await import('../../frontend/src/features/clientMaster/clientLeadOwner.mjs');
  assert.equal(clientLeadOwner({ createdBy: { name: 'Client Creator' }, selectedLead: {
    generatedForUser: { _id: 'owner', name: 'Sales Owner' }, createdBy: { name: 'Admin' }, assignedToText: 'Manager'
  } }), 'Sales Owner');
  assert.equal(clientLeadOwner({ selectedLead: { generatedForName: 'Sales Owner', createdByCrmUserId: 'admin' } }, [{ crmUserId: 'admin', name: 'Admin' }]), 'Sales Owner');
});
test('lead owner resolves primary creator, on-behalf user and legacy saved names', async () => {
  const { clientLeadOwner } = await import('../../frontend/src/features/clientMaster/clientLeadOwner.mjs');
  assert.equal(clientLeadOwner({ selectedLead: { createdOnBehalfOfUser: 'owner', createdByName: 'Admin' } }, [{ _id: 'owner', name: 'Sonal' }]), 'Sonal');
  assert.equal(clientLeadOwner({ selectedLead: { createdBy: { name: 'Prachi' } } }), 'Prachi');
  assert.equal(clientLeadOwner({ data: { selectedLeadSnapshot: { importedCreatedBy: 'Sales' } } }), 'Sales');
  assert.equal(clientLeadOwner({ selectedLead: { createdBy: 'unknown-id', assignedToText: 'Manager' }, createdBy: { name: 'Client Creator' } }), '-');
});
