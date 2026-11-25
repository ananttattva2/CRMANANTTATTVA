const test=require('node:test');const assert=require('node:assert/strict');
const {missingCtoFields,buildMissingCtoRows,digestEmail,runMissingCtoReminders}=require('../src/services/missingCtoReminders');
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
test('daily digests go only to responsible staff, manager, sales and admins; delivery is deduplicated',async()=>{
 const sent=[],records=new Map();
 const deliveries={async updateOne(filter,update){let row=records.get(filter.key)||{key:filter.key,status:'pending'};if(update.$set)Object.assign(row,update.$set);if(update.$unset)for(const key of Object.keys(update.$unset))delete row[key];records.set(filter.key,row);},async findOneAndUpdate(filter,update){const row=records.get(filter.key);if(row.status==='sent')return null;Object.assign(row,update.$set);return row;}};
 const options={services:[service],clients:[],users,deliveries,now:new Date('2026-11-25T05:00:00Z'),send:async(email,subject,html)=>{sent.push(email);assert.ok(html.includes('Client &lt;A&gt;'));}};
 const first=await runMissingCtoReminders(options);assert.equal(first.sent,4);assert.ok(!sent.includes('other@example.test'));
 assert.equal((await runMissingCtoReminders(options)).sent,0);
 assert.equal((await runMissingCtoReminders({...options,now:new Date('2026-11-26T05:00:00Z')})).sent,4);
});
