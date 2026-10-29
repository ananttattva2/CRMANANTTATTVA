const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const entry = path.resolve(__dirname, '../src/features/clientMaster/clientMaster.utils.js');
const compiled = new Module(entry); compiled.filename = entry; compiled.paths = Module._nodeModulePaths(path.dirname(entry));
compiled._compile(buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['xlsx'] }).outputFiles[0].text, entry);
const { getAssignedName, getAssignedStaffNames } = compiled.exports;
const people = [{ _id: 't', name: 'TUSHAR GAWAS', email: 't@example.com' }, { _id: 'n', name: 'NITIN NAWAR' }, { _id: 's', name: 'OTHER STAFF' }];
test('Assigned Staff / Current SPOC uses the permanent selected-service staff ahead of admin and imported metadata', () => {
  const client = { assignedServiceId: 'a', adminControls: { assignedTo: 'n' }, data: { importMeta: { assignedTo: 'NITIN NAWAR' } }, selectedLead: { assignments: [{ assignedServiceId: 'b', assignedStaff: 's' }, { assignedServiceId: 'a', assignedStaff: 't', assignedStaffText: 'TUSHAR GAWAS', assignedStaffEmail: 't@example.com' }] } };
  assert.equal(getAssignedName(client, people), 'TUSHAR GAWAS');
  assert.deepEqual(getAssignedStaffNames(client, people), ['TUSHAR GAWAS']);
});
test('staff display matches legacy assignments by service position without borrowing siblings', () => {
  const client = { assignedServiceId: 'b', selectedLead: { serviceSelections: [{ assignedServiceId: 'a' }, { assignedServiceId: 'b' }], assignments: [{ assignedStaff: 's' }, { assignedStaff: 't' }] } };
  assert.equal(getAssignedName(client, people), 'TUSHAR GAWAS');
  assert.deepEqual(getAssignedStaffNames({ assignedServiceId: 'missing', selectedLead: { serviceSelections: [{ assignedServiceId: 'a' }, { assignedServiceId: 'b' }], assignments: [{ assignedServiceId: 'a', assignedStaff: 's' }] } }, people), []);
});
