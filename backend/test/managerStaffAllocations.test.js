const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeManagerStaffAllocations } = require('../src/services/managerStaffAllocations');
const { buildUploadTracker } = require('../src/services/clientUploadTracker');
test('manager assignments count services before Client Master creation without double counting existing services', () => {
  const lead = {_id:'lead',company:'CCL',serviceSelections:[{assignedServiceId:'producer'},{assignedServiceId:'importer'},{assignedServiceId:'brand'}],assignments:[{assignedStaff:'s',temporaryAssignedTo:'p'},{assignedStaff:'s'},{assignedStaff:'s'}]};
  const client = {_id:'client',assignedServiceId:'brand',selectedLead:lead};
  const assigned = mergeManagerStaffAllocations([client,{...client,_id:'duplicate-master'}],[lead]);
  assert.equal(assigned.length,3);
  const groups = buildUploadTracker(assigned,[{_id:'s',name:'Shubham',role:'operation'},{_id:'p',name:'Prachi',role:'operation'}],[],[]);
  assert.equal(groups.length,1); assert.equal(groups[0].userId,'s'); assert.equal(groups[0].clients.length,3);
});
test('unassigned and sales-manager hints do not count as staff assignments', () => {
  const clients = [{_id:'c',adminControls:{assignedTo:'m'},data:{importMeta:{assignedTo:'s'}}}];
  const assigned = mergeManagerStaffAllocations(clients,[{_id:'lead',assignments:[{assignedTo:'m',temporaryAssignedTo:'s'}]}]);
  const groups = buildUploadTracker(assigned,[{_id:'s',name:'Staff',role:'operation'},{_id:'m',name:'Manager',role:'manager'}],[],[]);
  assert.equal(groups.reduce((sum,row)=>sum+row.clients.length,0),0);
});
