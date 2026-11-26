const test=require('node:test');const assert=require('node:assert/strict');
const {missingCtoFields,buildMissingCtoRows,digestEmail}=require('../src/services/missingCtoReminders');
const service={lead:{_id:'lead',leadCode:'L1',company:'Client <A>',generatedForUser:'sales',assignments:[{}]},assignment:{assignedTo:'manager',assignedStaff:'staff'},service:{servicesOffered:'Registration',firstAnnualReturnYearApplicable:'2026-27'},serviceId:'s1',index:0};
const users=[{_id:'admin',role:'admin',email:'admin@example.test',name:'Admin'},{_id:'sales',name:'Sales',email:'sales@example.test'},{_id:'manager',name:'Manager',email:'manager@example.test'},{_id:'staff',name:'Staff',email:'staff@example.test'},{_id:'other',name:'Other',email:'other@example.test'}];
const complete={cte:{plantWiseDetails:[{plantName:'Plant',ctoOrderNo:'CTO1',ctoIssueDate:'2026-01-01',ctoValidDate:'2027-01-01',ctoDocument:{url:'https://example.test/cto.pdf'},ctoProductRows:[{productName:'Cup',quantity:'0',uom:'kg',period:'month'}]}]}};
test('CTO completion requires all plant details and zero quantity is valid',()=>{
 assert.deepEqual(missingCtoFields(complete),[]);
 assert.ok(missingCtoFields({}).length);
 const data=structuredClone(complete);data.cte.plantWiseDetails.push({plantName:'Second'});assert.ok(missingCtoFields(data).some(field=>field.includes('Second')));
});
test('digest maps staff, manager and sales and only includes manager-assigned incomplete records',()=>{
 const rows=buildMissingCtoRows([service],[],users);assert.equal(rows.length,1);assert.equal(rows[0].staff,'Staff');assert.equal(rows[0].manager,'Manager');assert.equal(rows[0].sales,'Sales');
 assert.deepEqual(buildMissingCtoRows([{...service,assignment:{}}],[],users),[]);
 assert.deepEqual(buildMissingCtoRows([service],[{selectedLead:'lead',assignedServiceId:'s1',data:complete}],users),[]);
 assert.equal(buildMissingCtoRows([service],[{selectedLead:'lead',assignedServiceId:'sibling',data:complete}],users).length,1);
 const email=digestEmail(rows);assert.ok(email.html.includes('Client &lt;A&gt;'));assert.ok(email.html.includes('Assigned user'));assert.ok(email.csv.includes('Staff'));
});
