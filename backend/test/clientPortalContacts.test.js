const test = require('node:test');
const assert = require('node:assert/strict');
const Lead = require('../src/models/Lead');
const User = require('../src/models/User');
const portal = require('../src/services/clientPortal');
const servicePath = require.resolve('../src/services/clientPortalContacts');
test('support contacts contain closing salesperson, assigned SPOC and both IT contacts only', async () => {
  const original = { lead: Lead.findOne, user: User.find, portal: portal.loadPortalData };
  Lead.findOne = () => ({ lean: async () => ({ _id: '012345678901234567890123', applicantType: 'Importer', closedAt: new Date(), closedByEmail: 'sales@example.com', closedByText: 'Closing salesperson', closedBy: '012345678901234567890456' }) });
  User.find = () => ({ select: () => ({ lean: async () => [{ name: 'Closing salesperson', email: 'sales@example.com' }] }) });
  portal.loadPortalData = async () => ({ clients: [{ _id: '012345678901234567890123', spoc: { name: 'SPOC', email: 'spoc@example.com' }, assignments: [{ spoc: { name: 'SPOC', email: 'spoc@example.com' } }] }] });
  delete require.cache[servicePath];
  try {
    const { portalContacts } = require(servicePath);
    const result = await portalContacts('client@example.com', '012345678901234567890123');
    assert.deepEqual(new Set(result.contacts.map(row => row.email)), new Set(['sales@example.com', 'spoc@example.com', 'it_support@ananttattva.com', 'it_admin@ananttattva.com']));
    assert.equal(await portalContacts('client@example.com', 'invalid'), null);
    Lead.findOne = () => ({ lean: async () => null });
    assert.equal(await portalContacts('client@example.com', '012345678901234567890123'), null);
  } finally { Lead.findOne = original.lead; User.find = original.user; portal.loadPortalData = original.portal; delete require.cache[servicePath]; }
});
