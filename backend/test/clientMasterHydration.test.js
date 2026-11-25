const test=require('node:test');const assert=require('node:assert/strict');
const{hydrateClientData,resolveHydratedClientData}=require('../src/services/clientMasterHydration');
const legacy={_id:'old',selectedLead:'lead',workflowStatus:'submitted',data:{basic:{piboCategory:'Producer',eprCategory:'Plastic'},companyOverview:{companySummary:'Saved summary'},registeredAddress:{address1:'Saved address'},compliance:{gstNumber:'TEST-GST',gstFile:{url:'https://example.test/file.pdf'}},cte:{plantWiseDetails:[{plantName:'Plant',ctoOrderNo:'CTO'}]},msmeRows:[{status:'Small'}],cpcb:{ceprUserId:'producer-test-login'}}};
const draft={_id:'new',selectedLead:'lead',assignedServiceId:'annual',workflowStatus:'draft',data:{basic:{piboCategory:'Producer',eprCategory:'Plastic',servicesOffered:'Annual Return'},registeredAddress:{address1:''},companyOverview:{companySummary:''},compliance:{},msmeRows:[],adminControls:{approvalStatus:'PENDING'}}};
test('sparse service draft restores saved legacy form sections without changing record identity or service',()=>{
 const result=hydrateClientData(draft,[legacy],'annual');
 assert.equal(result.registeredAddress.address1,'Saved address');assert.equal(result.compliance.gstNumber,'TEST-GST');assert.equal(result.cte.plantWiseDetails[0].ctoOrderNo,'CTO');assert.equal(result.msmeRows.length,1);assert.equal(result.companyOverview.companySummary,'Saved summary');assert.equal(result.basic.servicesOffered,'Annual Return');assert.equal(result.adminControls.approvalStatus,'PENDING');assert.equal(draft.data.registeredAddress.address1,'');
});
test('another lead, applicant or service never supplies fallback data',()=>{
 for(const change of [{selectedLead:'other'},{assignedServiceId:'other-service'},{data:{...legacy.data,basic:{piboCategory:'Importer'}}}])assert.equal(hydrateClientData(draft,[{...legacy,...change}],'annual').compliance.gstNumber,undefined);
});
test('populated current values, zero and explicit false survive fallback',()=>{
 const target=structuredClone(draft);target.data.companyOverview={companySummary:'Current',numberOfEmployees:0};target.data.compliance={gstNumber:'CURRENT',msmeApplicable:false};
 const result=hydrateClientData(target,[legacy],'annual');assert.equal(result.companyOverview.companySummary,'Current');assert.equal(result.companyOverview.numberOfEmployees,0);assert.equal(result.compliance.gstNumber,'CURRENT');assert.equal(result.compliance.msmeApplicable,false);
});
test('pending CPCB onboarding does not restore locked legacy credentials or documents',()=>{
 const target=structuredClone(draft);target.data.cpcbOnboarding={cpcbPortalRegistered:false};const result=hydrateClientData(target,[legacy],'annual');assert.equal(result.cpcb,undefined);assert.equal(result.compliance.gstNumber,undefined);
});
test('exact API and review hydration share the candidate query and access filter',async()=>{
 let query;const access={createdBy:'allowed'};const result=await resolveHydratedClientData(draft,'annual',{accessFilter:access,ClientModel:{find(filter){query=filter;return{select(){return this},lean:async()=>[legacy]}}}});assert.ok(query.$and.includes(access));assert.equal(result.compliance.gstNumber,'TEST-GST');
});
