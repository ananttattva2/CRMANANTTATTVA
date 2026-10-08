const test=require('node:test');
const assert=require('node:assert/strict');
const {buildUploadTracker}=require('../src/services/clientUploadTracker');
test('matched lead service category overrides stale Client Master category in every dashboard',async()=>{
 const {applicationRecord,buildApplicationPortfolio}=await import('../../frontend/src/utils/applicationPortfolio.mjs');
 const user={_id:'staff',name:'Staff',role:'operation'};
 const services=[{assignedServiceId:'brand',subApplicantType:'Brand Owner',servicesOffered:'Annual Return Filling',plantUnit:'Unit 1'},{assignedServiceId:'importer',subApplicantType:'Importer',servicesOffered:'Annual Return Filling',plantUnit:'Unit 1'}];
 const clients=services.map(s=>({_id:s.assignedServiceId,assignedServiceId:s.assignedServiceId,selectedLead:{_id:'lead',company:'Company',status:'Closed',serviceSelections:services,assignments:services.map(s=>({assignedServiceId:s.assignedServiceId,assignedStaff:'staff',assignedTo:'manager'}))},data:{basic:{piboCategory:'Importer'},cpcb:{status:'Approved'}}}));
 assert.equal(applicationRecord(clients[0]).category,'Brand Owner');
 assert.equal(applicationRecord(clients[1]).category,'Importer');
 const portfolio=buildApplicationPortfolio(clients,[user]);
 assert.deepEqual(portfolio[0].records.map(r=>r.category).sort(),['Brand Owner','Importer']);
 const tracker=buildUploadTracker(clients,[user],[],[],{groupBy:'application',serviceType:'annual'});
 assert.deepEqual(tracker[0].clients.map(r=>r.category).sort(),['Brand Owner','Importer']);
 const legacy={...clients[0],selectedLead:{company:'Company'}};
 assert.equal(applicationRecord(legacy).category,'Importer');
});
