const test=require('node:test');
const assert=require('node:assert/strict');
test('Summary Dashboard identifies Existing Client traffic sources without excluding leads merely marked as existing clients',async()=>{
 const {isExistingClientTrafficSource}=await import('../../frontend/src/utils/trafficSources.mjs');
 assert.equal(isExistingClientTrafficSource({communicationMode:'Existing Client'}),true);
 assert.equal(isExistingClientTrafficSource({communicationMode:'Cross-Selling'}),true);
 assert.equal(isExistingClientTrafficSource({communicationMode:'LinkedIn Ads',existingClient:'Yes'}),false);
 assert.equal(isExistingClientTrafficSource({communicationMode:'Referral',status:'Existing Client'}),false);
});
test('Traffic Source preserves all configured modes including zero counts and saved custom channels',async()=>{
 const {trafficSourceSummary,trafficSourceKey}=await import('../../frontend/src/utils/trafficSources.mjs');
 const rows=[{id:'a',kind:'hot',communicationMode:'Tele Calling'},{id:'b',kind:'hot',communicationMode:'WhatsApp'},{id:'c',kind:'cold',communicationMode:''}];
 const summary=trafficSourceSummary(rows,['LinkedIn','telecalling']);
 assert.equal(summary.find(r=>r.key===trafficSourceKey('TeleCalling')).count,1);
 assert.equal(summary.find(r=>r.label==='WhatsApp').count,1);
 assert.equal(summary.find(r=>r.label==='LinkedIn').count,0);
 assert.equal(summary.find(r=>r.label==='Government').count,0);
 assert.equal(summary.find(r=>r.label==='Other / Not specified').count,1);
 assert.equal(summary.reduce((n,r)=>n+r.count,0),3);
});
test('Traffic Source counts a converted Cold/Hot business lead once, preferring its current Hot mode',async()=>{
 const {trafficSourceSummary,trafficSourceKey}=await import('../../frontend/src/utils/trafficSources.mjs');
 const rows=[{id:'cold',kind:'cold',canonicalKey:'hot:a',communicationMode:''},{id:'a',kind:'hot',canonicalKey:'hot:a',communicationMode:'Referral'},{id:'b',kind:'cold',canonicalKey:'cold:b'}];
 const summary=trafficSourceSummary(rows);
 assert.equal(summary.find(r=>r.key===trafficSourceKey('Referral')).count,1);
 assert.equal(summary.find(r=>r.label==='Other / Not specified').count,1);
 assert.equal(summary.reduce((n,r)=>n+r.count,0),2);
 assert.equal(summary.find(r=>r.label==='Referral').percentage,50);
});
test('Traffic Source empty filters still show mode options with safe zero percentages',async()=>{
 const {trafficSourceSummary}=await import('../../frontend/src/utils/trafficSources.mjs');
 const summary=trafficSourceSummary([],['Partner Network']);
 assert.ok(summary.length>=14);assert.ok(summary.every(r=>r.count===0&&r.percentage===0));
});
test('Traffic Source groups sub-categories under expandable parent totals',async()=>{
 const {trafficSourceHierarchy}=await import('../../frontend/src/utils/trafficSources.mjs');
 const rows=[
  {id:'a',kind:'hot',communicationMode:'LinkedIn Ads'},
  {id:'b',kind:'hot',communicationMode:'Web Database'},
  {id:'c',kind:'hot',communicationMode:'LinkedIn'},
  {id:'d',kind:'cold',communicationMode:'Tele Calling'},
  {id:'e',kind:'cold',communicationMode:'Local Chamber',communicationModeParent:'Reference & Referral'}
 ];
 const groups=trafficSourceHierarchy(rows);
 const digital=groups.find(group=>group.label==='Digital Marketing');
 const social=groups.find(group=>group.label==='Social Media');
 const direct=groups.find(group=>group.label==='Direct Marketing');
 const referral=groups.find(group=>group.label==='Reference & Referral');
 assert.equal(digital.count,2);assert.equal(digital.percentage,40);
 assert.equal(digital.children.find(child=>child.label==='LinkedIn Ads').count,1);
 assert.equal(social.count,1);assert.equal(direct.count,1);assert.equal(referral.count,1);
 assert.ok(referral.children.some(child=>child.label==='Local Chamber'));
 assert.ok(digital.keys.includes(digital.children.find(child=>child.label==='Web Database').key));
});
test('client detail payload includes contact/source fields without unrelated private document fields',()=>{
 const {clientContactDetails}=require('../src/services/leadRevenue');
 const details=clientContactDetails({company:'Example',communicationMode:'Referral',password:'PRIVATE',contacts:[{contactPerson:'Demo Person',emails:'demo@example.test',mobileNo1:'9876543210'}],addresses:[{addressLine1:'Example address',city:'Mumbai'}]});
 assert.equal(details.contactPerson,'Demo Person');assert.equal(details.communicationMode,'Referral');assert.equal(details.city,'Mumbai');assert.equal(details.email,'demo@example.test');assert.ok(!JSON.stringify(details).includes('PRIVATE'));
 const cold=clientContactDetails({clientName:'Cold',personName:'Contact',email:'cold@example.test',phone:'9876543210',sector:'Manufacturing'});
 assert.equal(cold.company,'Cold');assert.equal(cold.industry,'Manufacturing');assert.equal(cold.communicationMode,'');
});
