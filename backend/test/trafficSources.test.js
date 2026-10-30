const test=require('node:test');
const assert=require('node:assert/strict');
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
test('client detail payload includes contact/source fields without unrelated private document fields',()=>{
 const {clientContactDetails}=require('../src/services/leadRevenue');
 const details=clientContactDetails({company:'Example',communicationMode:'Referral',password:'PRIVATE',contacts:[{contactPerson:'Demo Person',emails:'demo@example.test',mobileNo1:'9876543210'}],addresses:[{addressLine1:'Example address',city:'Mumbai'}]});
 assert.equal(details.contactPerson,'Demo Person');assert.equal(details.communicationMode,'Referral');assert.equal(details.city,'Mumbai');assert.equal(details.email,'demo@example.test');assert.ok(!JSON.stringify(details).includes('PRIVATE'));
 const cold=clientContactDetails({clientName:'Cold',personName:'Contact',email:'cold@example.test',phone:'9876543210',sector:'Manufacturing'});
 assert.equal(cold.company,'Cold');assert.equal(cold.industry,'Manufacturing');assert.equal(cold.communicationMode,'');
});
