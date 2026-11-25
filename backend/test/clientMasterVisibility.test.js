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


test('saved client records are visible before PO closure without adding empty placeholders', () => {
 const { savedClientDirectoryBranches } = require('../src/services/clientMasterVisibility');
 assert.deepEqual(savedClientDirectoryBranches(), [
  { workflowStatus: 'submitted' },
  { 'data.cte.plantWiseDetails.0': { $exists: true } },
  { 'data.compliance.pan': { $exists: true, $nin: ['', null] } }
 ]);
});
