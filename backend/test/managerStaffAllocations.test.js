const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeManagerStaffAllocations } = require('../src/services/managerStaffAllocations');
const { buildUploadTracker } = require('../src/services/clientUploadTracker');
test('manager assignments preserve every service but tracker counts one company per staff user', () => {
  const lead = {_id:'lead',company:'CCL',serviceSelections:[{assignedServiceId:'producer'},{assignedServiceId:'importer'},{assignedServiceId:'brand'}],assignments:[{assignedStaff:'s',temporaryAssignedTo:'p'},{assignedStaff:'s'},{assignedStaff:'s'}]};
  const client = {_id:'client',assignedServiceId:'brand',selectedLead:lead};
  const assigned = mergeManagerStaffAllocations([client,{...client,_id:'duplicate-master'}],[lead]);
  assert.equal(assigned.length,3);
  const groups = buildUploadTracker(assigned,[{_id:'s',name:'Shubham',role:'operation'},{_id:'p',name:'Prachi',role:'operation'}],[],[]);
  assert.equal(groups.length,1); assert.equal(groups[0].userId,'s'); assert.equal(groups[0].clients.length,1);
  assert.equal(groups[0].clients[0].clientIds.length,3);
});
test('unassigned and sales-manager hints do not count as staff assignments', () => {
  const clients = [{_id:'c',adminControls:{assignedTo:'m'},data:{importMeta:{assignedTo:'s'}}}];
  const assigned = mergeManagerStaffAllocations(clients,[{_id:'lead',assignments:[{assignedTo:'m',temporaryAssignedTo:'s'}]}]);
  const groups = buildUploadTracker(assigned,[{_id:'s',name:'Staff',role:'operation'},{_id:'m',name:'Manager',role:'manager'}],[],[]);
  assert.equal(groups.reduce((sum,row)=>sum+row.clients.length,0),0);
});

test('new staff assignments inherit matching Client Master CPCB status across all status buckets',()=>{
 const {dashboardStatusClient}=require('../src/services/managerStaffAllocations');
 for(const status of ['Approved','Applied','Under Review','Not Started']) {
  const base={subApplicantType:'Importer',plantUnit:'Unit 1',eprCategory:'Plastic Waste',servicesOffered:'Annual Return Filling'};
  const lead={_id:'lead',company:'Client',serviceSelections:[{...base,assignedServiceId:'old'},{...base,assignedServiceId:'new'}],assignments:[{}, {assignedServiceId:'new',assignedTo:'manager',assignedStaff:'staff'}]};
  const client={_id:'master',assignedServiceId:'old',selectedLead:lead,workflowStatus:'submitted',data:{cpcb:{status:'Not Started'},cpcbDataByAssignedServiceId:{old:{cpcb:{status,ceprPassword:'private'}}}}};
  const sanitized=dashboardStatusClient(client);
  assert.equal(sanitized.data.cpcb.status,status);assert.equal(sanitized.data.cpcb.ceprPassword,undefined);assert.equal(sanitized.data.cpcbDataByAssignedServiceId,undefined);
  const placeholder=mergeManagerStaffAllocations([sanitized],[lead]).find(c=>c.assignmentOnly);
  assert.equal(placeholder.data.cpcb.status,status);assert.equal(placeholder.statusSourceClientId,'master');
  const unrelated={...lead,serviceSelections:[lead.serviceSelections[0],{...base,assignedServiceId:'new',subApplicantType:'Brand Owner'}]};
  assert.equal(mergeManagerStaffAllocations([sanitized],[unrelated]).find(c=>c.assignmentOnly).data.cpcb.status,undefined);
 }
});
