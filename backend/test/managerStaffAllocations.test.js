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
  assert.equal(sanitized.data.cpcb.status,'Not Started');assert.equal(sanitized.data.cpcb.ceprPassword,undefined);
  assert.equal(sanitized.data.cpcbDataByAssignedServiceId.old.cpcb.status,status);
  assert.equal(sanitized.data.cpcbDataByAssignedServiceId.old.cpcb.ceprPassword,undefined);
  const placeholder=mergeManagerStaffAllocations([sanitized],[lead]).find(c=>c.assignmentOnly);
  assert.equal(placeholder.data.cpcb.status,status);assert.equal(placeholder.statusSourceClientId,'master');
  const unrelated={...lead,serviceSelections:[lead.serviceSelections[0],{...base,assignedServiceId:'new',subApplicantType:'Brand Owner'}]};
  assert.equal(mergeManagerStaffAllocations([sanitized],[unrelated]).find(c=>c.assignmentOnly).data.cpcb.status,undefined);
 }
});

test('staff placeholders carry current-FY PO rows from the same applicant, unit and annual service',()=>{
 const base={subApplicantType:'Importer',plantUnit:'Unit 1',eprCategory:'Plastic Waste',servicesOffered:'Annual Return Filling'};
 const lead={_id:'lead',company:'KANDUI',serviceSelections:[
  {...base,assignedServiceId:'current'},
  {...base,assignedServiceId:'future'}
 ],assignments:[
  {assignedServiceId:'current',poStatus:'received',poYearRows:[{poFinancialYear:'2026-27',annualReturnYear:'2025-26'}]},
  {assignedServiceId:'future',assignedTo:'manager',assignedStaff:'staff',poStatus:'received',poYearRows:[{poFinancialYear:'2027-28',annualReturnYear:'2026-27'}]}
 ]};
 const [placeholder]=mergeManagerStaffAllocations([], [lead]);
 assert.equal(placeholder.selectedLead.assignments[0].poStatus,'received');
 assert.deepEqual(placeholder.selectedLead.assignments[0].poYearRows.map(row=>row.annualReturnYear),['2025-26','2026-27']);
});

test('legacy closed assignments without permanent staff still create dashboard placeholders',()=>{
 const lead={_id:'legacy',company:'Thrishul Packaging Industries',serviceSelections:[{assignedServiceId:'service',subApplicantType:'Producer',servicesOffered:'Annual Return Filling'}],assignments:[{assignedServiceId:'service',closedBy:'tushar',closedByText:'Tushar Gawas',closedAt:'2026-10-01'}]};
 const [placeholder]=mergeManagerStaffAllocations([], [lead]);
 assert.equal(placeholder.assignmentOnly,true);
 assert.equal(placeholder.selectedLead.assignments[0].closedBy,'tushar');
});

test('draft Client Masters cannot suppress closed permanent staff assignments',async()=>{
 const {buildApplicationPortfolio}=await import('../../frontend/src/utils/applicationPortfolio.mjs');
 const users=[{_id:'sonal',name:'Sonal More',role:'operation'},{_id:'tushar',name:'Tushar Gawas',role:'operation'}];
 const cases=[
  ['nano','20 MICRONS NANO MINERALS LIMITED','sonal','Annual Return Filling','Importer'],
  ['thrishul','Thrishul Packaging Industries','tushar','New Registration','Producer (Small & Micro)']
 ];
 const dashboardRows=[];
 for(const [id,company,owner,offered,category] of cases){
  const serviceId=`${id}-service`;
  const lead={_id:`${id}-lead`,company,status:'Closed',serviceSelections:[{assignedServiceId:serviceId,subApplicantType:category,plantUnit:'Unit 1',servicesOffered:offered}],assignments:[{assignedServiceId:serviceId,assignedTo:'manager',assignedStaff:owner,closedBy:owner,closedAt:'2026-10-01'}]};
  const draft={_id:`${id}-draft`,selectedLead:lead,assignedServiceId:serviceId,workflowStatus:'draft',data:{basic:{piboCategory:category,servicesOffered:offered},cpcb:{status:'Approved'},importMeta:{clientStatus:'draft'}}};
  const merged=mergeManagerStaffAllocations([draft],[lead]);
  assert.equal(merged.length,2);
  assert.equal(merged.filter(row=>row.assignmentOnly).length,1);
  const placeholder=merged.find(row=>row.assignmentOnly);
  assert.equal(placeholder.data.cpcb.status,'Approved');
  assert.equal(placeholder.statusSourceClientId,`${id}-draft`);
  assert.equal(placeholder.workflowStatus,undefined);
  dashboardRows.push(...merged);
 }
 const groups=buildApplicationPortfolio(dashboardRows,users);
 assert.deepEqual(groups.map(group=>[group.name,group.records.map(record=>record.name)]),[
  ['Sonal More',['20 MICRONS NANO MINERALS LIMITED']],
  ['Tushar Gawas',['Thrishul Packaging Industries']]
 ]);
});

test('newest matching draft supplies CPCB status for every assigned service without counting as an application',()=>{
 const service={assignedServiceId:'service',subApplicantType:'Importer',plantUnit:'Unit 1',servicesOffered:'Annual Return Filling'};
 const lead={_id:'lead',company:'Any assigned client',serviceSelections:[service],assignments:[{assignedServiceId:'service',assignedTo:'manager',assignedStaff:'staff',closedAt:'2026-10-01'}]};
 const client=(id,status,workflowStatus,updatedAt)=>({
  _id:id,selectedLead:lead,assignedServiceId:'service',workflowStatus,updatedAt,
  data:{cpcb:{status},basic:{piboCategory:'Importer',servicesOffered:'Annual Return Filling'},importMeta:{clientStatus:workflowStatus}}
 });
 const merged=mergeManagerStaffAllocations([
  client('older-draft','Not Started','draft','2026-10-01'),
  client('latest-draft','Under Review','draft','2026-10-13')
 ],[lead]);
 const placeholder=merged.find(row=>row.assignmentOnly);
 assert.equal(placeholder.data.cpcb.status,'Under Review');
 assert.equal(placeholder.statusSourceClientId,'latest-draft');
 assert.equal(placeholder.workflowStatus,undefined);
});

test('legacy multi-service drafts resolve CPCB status by canonical applicant, unit and service without leaking to siblings',()=>{
 const {dashboardStatusClient}=require('../src/services/managerStaffAllocations');
 const services=[
  {assignedServiceId:'brand',subApplicantType:'Brand Owner',plantUnit:'Unit 1',eprCategory:'EPR - Plastic Waste',servicesOffered:'Annual Return Filling'},
  {assignedServiceId:'raw-importer',subApplicantType:'Importer of Raw Material',plantUnit:'Unit 2',eprCategory:'EPR - Plastic Waste',servicesOffered:'Annual Return Filling'},
  {assignedServiceId:'producer',subApplicantType:'Producer',plantUnit:'Unit 3',eprCategory:'EPR - Plastic Waste',servicesOffered:'New Registration'}
 ];
 const lead={_id:'balaji-lead',company:'Balaji Plastic Finishing & Trading',serviceSelections:services,assignments:services.map(service=>({assignedServiceId:service.assignedServiceId,assignedTo:'manager',assignedStaff:'sonal',closedAt:'2026-10-01'}))};
 const draft=dashboardStatusClient({_id:'balaji-draft',selectedLead:lead,assignedServiceId:'obsolete-importer-id',workflowStatus:'draft',data:{
  assignedServiceId:'obsolete-importer-id',selectedLeadSnapshot:{id:'balaji-lead',assignedServiceId:'obsolete-importer-id',subApplicantType:'SIMP - Importer',plantUnit:'Unit 2',eprCategory:'EPR Plastic Waste',servicesOffered:'Annual Return Filing'},
  cpcbDataByAssignedServiceId:{'obsolete-importer-id':{cpcb:{status:'Approved'}}},importMeta:{clientStatus:'draft'}
 }});
 const placeholders=mergeManagerStaffAllocations([draft],[lead]).filter(row=>row.assignmentOnly);
 assert.equal(placeholders.find(row=>row.assignedServiceId==='raw-importer').data.cpcb.status,'Approved');
 assert.equal(placeholders.find(row=>row.assignedServiceId==='brand').data.cpcb.status,undefined);
 assert.equal(placeholders.find(row=>row.assignedServiceId==='producer').data.cpcb.status,undefined);
});

test('a status scoped to Balaji Unit 2 importer overrides a different root service',()=>{
 const {dashboardStatusClient}=require('../src/services/managerStaffAllocations');
 const services=[
  {assignedServiceId:'brand',subApplicantType:'Brand Owner',plantUnit:'Unit 1',servicesOffered:'Annual Return Filling'},
  {assignedServiceId:'raw-importer',subApplicantType:'Importer of Raw Material',plantUnit:'Unit 2',servicesOffered:'Annual Return Filling'}
 ];
 const lead={_id:'balaji',leadCode:'ATPL-LEAD-0464',company:'Balaji Plastic Finishing & Trading',serviceSelections:services,assignments:services.map(service=>({assignedServiceId:service.assignedServiceId,assignedStaff:'sonal',closedAt:'2026-10-01'}))};
 const master=dashboardStatusClient({_id:'multi-scope',selectedLead:lead,assignedServiceId:'brand',workflowStatus:'draft',updatedAt:'2026-10-12',data:{
  assignedServiceId:'brand',selectedLeadSnapshot:{id:'balaji',assignedServiceId:'brand',subApplicantType:'Brand Owner',plantUnit:'Unit 1',servicesOffered:'Annual Return Filling'},
  cpcb:{status:'Not Started'},cpcbDataByAssignedServiceId:{brand:{cpcb:{status:'Not Started'}},'raw-importer':{cpcb:{status:'Approved',ceprPassword:'private'}}}
 }});
 const newerInferred=dashboardStatusClient({_id:'newer-inferred',selectedLead:lead,assignedServiceId:'obsolete-importer',workflowStatus:'draft',updatedAt:'2026-10-13',data:{
  assignedServiceId:'obsolete-importer',selectedLeadSnapshot:{id:'balaji',assignedServiceId:'obsolete-importer',subApplicantType:'SIMP - Importer',plantUnit:'Unit 2',servicesOffered:'Annual Return Filing'},
  cpcbDataByAssignedServiceId:{'obsolete-importer':{cpcb:{status:'Not Started'}}}
 }});
 const rows=mergeManagerStaffAllocations([master,newerInferred],[lead]).filter(row=>row.assignmentOnly);
 assert.equal(rows.find(row=>row.assignedServiceId==='raw-importer').data.cpcb.status,'Approved');
 assert.equal(rows.find(row=>row.assignedServiceId==='brand').data.cpcb.status,'Not Started');
 assert.equal(JSON.stringify(master).includes('private'),false);
});

test('a directly saved Approved edit repairs an older Not Started snapshot for the same service',()=>{
 const {dashboardStatusClient}=require('../src/services/managerStaffAllocations');
 const service={assignedServiceId:'raw-importer',subApplicantType:'Importer of Raw Material',plantUnit:'Unit 2',servicesOffered:'Annual Return Filling'};
 const lead={_id:'balaji',leadCode:'ATPL-LEAD-0464',company:'Balaji Plastic Finishing & Trading',serviceSelections:[service],assignments:[{assignedServiceId:'raw-importer',assignedStaff:'sonal',closedAt:'2026-10-01'}]};
 const master=dashboardStatusClient({_id:'legacy-conflict',selectedLead:lead,assignedServiceId:'raw-importer',workflowStatus:'draft',data:{
  assignedServiceId:'raw-importer',selectedLeadSnapshot:{id:'balaji',assignedServiceId:'raw-importer',subApplicantType:'Importer of Raw Material',plantUnit:'Unit 2',servicesOffered:'Annual Return Filling'},
  cpcb:{status:'Approved'},cpcbDataByAssignedServiceId:{'raw-importer':{cpcb:{status:'Not Started'}}}
 }});
 const row=mergeManagerStaffAllocations([master],[lead]).find(item=>item.assignmentOnly);
 assert.equal(row.data.cpcb.status,'Approved');
});

test('newer directly saved CPCB status outranks an older exact Not Started duplicate',()=>{
 const {dashboardStatusClient}=require('../src/services/managerStaffAllocations');
 const service={assignedServiceId:'annual',subApplicantType:'Importer',plantUnit:'Unit 1',eprCategory:'EPR - Plastic Waste',servicesOffered:'Annual Return Filling'};
 const lead={_id:'nuviashop',company:'NUVIASHOP PRIVATE LIMITED',serviceSelections:[service],assignments:[{assignedServiceId:'annual',assignedTo:'manager',assignedStaff:'prachi',closedAt:'2026-10-01'}]};
 const older=dashboardStatusClient({_id:'older-scope',selectedLead:lead,assignedServiceId:'annual',workflowStatus:'submitted',updatedAt:'2026-09-09',data:{
  assignedServiceId:'annual',selectedLeadSnapshot:{id:'nuviashop',assignedServiceId:'annual',subApplicantType:'Importer',plantUnit:'Unit 1',eprCategory:'EPR - Plastic Waste',servicesOffered:'Annual Return Filling'},
  cpcb:{status:'Not Started'},cpcbDataByAssignedServiceId:{annual:{cpcb:{status:'Not Started'}}}
 }});
 const newer=dashboardStatusClient({_id:'newer-edit',selectedLead:lead,assignedServiceId:'annual',workflowStatus:'draft',updatedAt:'2026-10-15',data:{
  assignedServiceId:'annual',selectedLeadSnapshot:{id:'nuviashop',assignedServiceId:'annual',subApplicantType:'Importer',plantUnit:'Unit 1',eprCategory:'EPR - Plastic Waste',servicesOffered:'Annual Return Filling'},
  cpcb:{status:'Approved'}
 }});
 const row=mergeManagerStaffAllocations([older,newer],[lead]).find(item=>item._id==='older-scope');
 assert.equal(row.data.cpcb.status,'Approved');
});

test('CPCB status is shared by registration and annual return for the same applicant unit',()=>{
 const {dashboardStatusClient}=require('../src/services/managerStaffAllocations');
 const registration={assignedServiceId:'registration',subApplicantType:'Importer',plantUnit:'Unit 1',eprCategory:'EPR - Plastic Waste',servicesOffered:'New Registration'};
 const annual={assignedServiceId:'annual',subApplicantType:'Importer',plantUnit:'Unit 1',eprCategory:'EPR - Plastic Waste',servicesOffered:'Annual Return Filling'};
 const lead={_id:'common-man',company:'Common Man Multiventures Pvt Ltd',serviceSelections:[registration,annual],assignments:[
  {assignedServiceId:'registration',assignedStaff:'prachi',closedAt:'2026-10-01'},
  {assignedServiceId:'annual',assignedStaff:'prachi',closedAt:'2026-10-01'}
 ]};
 const master=dashboardStatusClient({_id:'common-man-master',selectedLead:lead,assignedServiceId:'registration',workflowStatus:'submitted',updatedAt:'2026-10-14',data:{
  assignedServiceId:'registration',selectedLeadSnapshot:{id:'common-man',assignedServiceId:'registration',subApplicantType:'Importer',plantUnit:'Unit 1',eprCategory:'EPR - Plastic Waste',servicesOffered:'New Registration'},
  cpcb:{status:'Approved'}
 }});
 const rows=mergeManagerStaffAllocations([master],[lead]);
 const annualRow=rows.find(row=>row.assignmentOnly && row.assignedServiceId==='annual');
 assert.equal(annualRow.data.cpcb.status,'Approved');
 const unrelatedLead={...lead,serviceSelections:[registration,{...annual,assignedServiceId:'other-unit',plantUnit:'Unit 2'}],assignments:[
  lead.assignments[0],{assignedServiceId:'other-unit',assignedStaff:'prachi',closedAt:'2026-10-01'}
 ]};
 assert.equal(mergeManagerStaffAllocations([master],[unrelatedLead]).find(row=>row.assignmentOnly && row.assignedServiceId==='other-unit').data.cpcb.status,undefined);
});
