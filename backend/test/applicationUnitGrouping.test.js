const test=require('node:test');
const assert=require('node:assert/strict');
const {buildUploadTracker}=require('../src/services/clientUploadTracker');
test('different units split application rows and counts while matching placeholders remain merged',async()=>{
 const {buildApplicationPortfolio,applicationSummaryRecords}=await import('../../frontend/src/utils/applicationPortfolio.mjs');
 const user={_id:'staff',name:'Staff',role:'operation'};
 const services=['Unit 1','Unit 2'].map((unit,i)=>({assignedServiceId:'service'+i,plantUnit:unit,subApplicantType:'Producer',servicesOffered:'Annual Return Filling'}));
 const clients=services.map(s=>({_id:s.assignedServiceId,assignedServiceId:s.assignedServiceId,selectedLead:{_id:'lead',company:'MANIKA',status:'Closed',serviceSelections:services,assignments:services.map(s=>({assignedServiceId:s.assignedServiceId,assignedStaff:'staff',assignedTo:'manager'}))},data:{basic:{piboCategory:'Producer'},cpcb:{status:'Approved'}}}));
 const placeholder={...clients[0],_id:'assignment:duplicate',assignmentOnly:true,data:{basic:{piboCategory:'Producer'}}};
 const groups=buildApplicationPortfolio([...clients,placeholder],[user]);
 assert.equal(groups[0].records.length,2);
 assert.deepEqual(applicationSummaryRecords(groups[0]).map(r=>r.unit),['Unit 1','Unit 2']);
 assert.ok(applicationSummaryRecords(groups[0]).every(r=>r.cpcb==='Approved'&&r.services.length===1));
 const tracker=buildUploadTracker(clients,[user],[],[],{groupBy:'application',serviceType:'annual'});
 assert.equal(tracker[0].clients.length,2);
 assert.deepEqual(tracker[0].clients.map(r=>r.unit),['Unit 1','Unit 2']);
});
