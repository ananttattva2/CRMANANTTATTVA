const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../src/services/consentExpiryReminders');
const client = () => ({ _id:'client1', companyIdentity:'company1', selectedLead:{ emails:'client@example.com' }, data:{ basic:{ clientLegalName:'Example <Company>' }, cte:{ cteApplicable:'Yes', plantWiseDetails:[{ plantLocation:'Factory A', cteConsentNo:'CTE-1', cteValidDate:'2027-01-02', ctoOrderNo:'CTO-1', ctoValidDate:'2027-06-02' }] } } });
function ledger() {
 const records = new Map();
 return { records,
  async updateOne(filter, update, options = {}) {
   let row = records.get(filter.key);
   if (!row && options.upsert) { row = { ...update.$setOnInsert }; records.set(filter.key,row); }
   if (!row || (filter.claim && row.claim !== filter.claim)) return;
   Object.assign(row,update.$set || {});
   Object.keys(update.$unset || {}).forEach(key => delete row[key]);
  },
  async findOneAndUpdate(filter, update) {
   const row = records.get(filter.key);
   if (!row || row.status === 'sent' || (row.leaseUntil && row.leaseUntil > filter.$or[1].leaseUntil.$lte)) return null;
   Object.assign(row,update.$set); return { ...row };
  }
 };
}
test('two calendar months clamp month ends and handle leap years and year boundaries', () => {
 assert.equal(service.reminderDate('2026-08-31'),'2026-06-30');
 assert.equal(service.reminderDate('2024-04-30'),'2024-02-29');
 assert.equal(service.reminderDate('2027-01-02'),'2026-11-02');
 assert.equal(service.reminderDate('2026-02-30'),'');
 assert.equal(service.istToday(new Date('2026-11-01T20:00:00Z')),'2026-11-02');
});
test('events start at the reminder threshold, catch up once inside the window, and skip expired/not-applicable consents', () => {
 assert.equal(service.consentEvents(client(),'2026-11-01').length,0);
 assert.equal(service.consentEvents(client(),'2026-11-02').length,1);
 assert.equal(service.consentEvents(client(),'2026-12-15')[0].kind,'CTE');
 assert.equal(service.consentEvents(client(),'2027-01-03').length,0);
 const record = client(); record.data.cte.cteApplicable='No';
 assert.equal(service.consentEvents(record,'2026-11-02').length,0);
 assert.equal(service.consentEvents(record,'2027-04-02')[0].kind,'CTO/CCA');
});
test('email uses clear renewal wording, exact dates and escaped client fields', () => {
 const event=service.consentEvents(client(),'2026-11-02')[0];
 const email=service.consentEmail(event,'2026-11-02');
 assert.match(email.html,/validity ends in two months/);
 assert.match(email.html,/02 January 2027/);
 assert.match(email.html,/Example &lt;Company&gt;/);
 assert.doesNotMatch(email.html,/<Company>/);
 assert.match(service.consentEmail(event,'2026-12-02').html,/31 days remaining/);
});
test('daily scans send separately to client, active CTE role and secondary Super Admin role, only once per date', async () => {
 const deliveries=ledger(), sent=[];
 const users=[{ role:'CTE & CTO / CCA',email:'cte@example.com' },{ role:'manager',roles:['Super Admin'],email:'super@example.com' },{ role:'sales',email:'sales@example.com' },{ role:'cte-cto',email:'disabled@example.com',isActive:false }];
 const options={ now:new Date('2026-11-02T04:00:00Z'),clients:[client(),client()],users,deliveries,send:async (...args)=>sent.push(args) };
 const result=await service.runConsentExpiryReminders(options);
 assert.equal(result.sent,3);
 assert.deepEqual(sent.map(args=>args[0]).sort(),['client@example.com','cte@example.com','super@example.com']);
 assert.equal((await service.runConsentExpiryReminders(options)).sent,0);
 assert.equal(sent.length,3);
 const renewed=client();renewed.data.cte.plantWiseDetails[0].cteValidDate='2027-02-02';
 assert.equal((await service.runConsentExpiryReminders({...options,now:new Date('2026-12-02T04:00:00Z'),clients:[renewed]})).sent,3);
});
test('concurrent claims send one email; delivery failure releases the lease for retry', async () => {
 const event=service.consentEvents(client(),'2026-11-02')[0], deliveries=ledger(); let sent=0;
 const options={deliveries,send:async()=>{sent++;}};
 await Promise.all([service.deliverOnce(event,'one@example.com','2026-11-02',options),service.deliverOnce(event,'one@example.com','2026-11-02',options)]);
 assert.equal(sent,1);
 await assert.rejects(service.deliverOnce(event,'two@example.com','2026-11-02',{deliveries,send:async()=>{throw new Error('temporary mail failure');}}));
 assert.equal(await service.deliverOnce(event,'two@example.com','2026-11-02',options),true);
});

test('a renewed consent on the newest record suppresses an older duplicate expiry', async () => {
 const newer=client(); newer.data.cte.plantWiseDetails[0].cteValidDate='2027-08-02';
 let sent=0;
 const result=await service.runConsentExpiryReminders({now:new Date('2026-11-02T04:00:00Z'),clients:[newer,client()],users:[],deliveries:ledger(),send:async()=>{sent++;}});
 assert.equal(result.sent,0); assert.equal(sent,0);
});

test('latest not-applicable or cleared consent does not send an older saved expiry', async () => {
 for (const mode of ['not-applicable','cleared']) {
  const newer=client();
  if (mode === 'not-applicable') newer.data.cte.cteApplicable='No';
  else newer.data.cte.plantWiseDetails[0].cteValidDate='';
  const result=await service.runConsentExpiryReminders({now:new Date('2026-11-02T04:00:00Z'),clients:[newer,client()],users:[],deliveries:ledger(),send:async()=>assert.fail('Older duplicate consent must not send')});
  assert.equal(result.sent,0);
 }
});
