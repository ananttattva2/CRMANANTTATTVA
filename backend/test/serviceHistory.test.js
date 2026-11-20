const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveServiceHistory } = require('../src/services/annualReturnPoResolver');
const client = {data:{selectedLead:'507f1f77bcf86cd799439011',assignedServiceId:'registration',basic:{piboCategory:'Producer'}}};
const model = lead => ({findById:()=>({select(){return this;},lean:async()=>lead})});
function source() {
  return {serviceSelections:[
    {assignedServiceId:'registration',subApplicantType:'Producer',servicesOffered:'New Registration'},
    {assignedServiceId:'renewal',subApplicantType:'Producer',servicesOffered:['Renewal','Amendment']},
    {assignedServiceId:'annual',subApplicantType:'Producer',servicesOffered:'Annual Return Filling'},
    {assignedServiceId:'importer',subApplicantType:'Importer',servicesOffered:'New Registration'},
    {assignedServiceId:'open',subApplicantType:'Producer',servicesOffered:'CTO'}
  ],assignments:['registration','renewal','annual','importer','open'].map(id=>({assignedServiceId:id,...(id==='open'?{}:{closedAt:'2026-01-01'}),poYearRows:[{fy:'2026-27',annualReturnYear:id==='annual'?'2025-26':'',poNumber:id+'-PO',poFileUrl:'https://example.test/'+id+'.pdf'}]}))};
}
test('all closed lead services for the applicant appear without an annual-year prerequisite',async()=>{
 const rows=await resolveServiceHistory({clientMaster:client,LeadModel:model(source())});
 assert.deepEqual(rows.map(row=>row.service).sort(),['Amendment','Annual Return Filling','New Registration','Renewal']);
 assert.ok(rows.every(row=>row.applicantType==='Producer' && row.poYear==='2026-27'));
 assert.equal(rows.find(row=>row.annual).annualYear,'2025-26');
 assert.equal(rows.find(row=>row.service==='New Registration').number,'registration-PO');
});
test('row services restrict which offered services share a PO and duplicate evidence is collapsed',async()=>{
 const lead=source();lead.assignments[1].poYearRows[0].services=['Renewal'];lead.assignments[1].poYearRows.push({...lead.assignments[1].poYearRows[0]});
 const rows=await resolveServiceHistory({clientMaster:client,LeadModel:model(lead)});
 assert.equal(rows.filter(row=>row.service==='Renewal').length,1);assert.ok(!rows.some(row=>row.service==='Amendment'));
});
test('unlinked and deleted leads return an empty history',async()=>{
 assert.deepEqual(await resolveServiceHistory({clientMaster:{data:{}},LeadModel:model(null)}),[]);
 assert.deepEqual(await resolveServiceHistory({clientMaster:client,LeadModel:model(null)}),[]);
});
