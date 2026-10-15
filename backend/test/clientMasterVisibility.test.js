const assert = require('node:assert/strict');
const test = require('node:test');

const { clientMasterSourceRecordFilter } = require('../src/services/clientMasterVisibility');

test('directory includes a real linked Client Master even when an old approval override flag remains', () => {
  assert.deepEqual(clientMasterSourceRecordFilter(), {
    $or: [
      { 'data.importMeta.approvalOverride': { $ne: true } },
      { selectedLead: { $exists: true, $ne: null } },
      { assignedServiceId: { $exists: true, $nin: ['', null] } }
    ]
  });
});
