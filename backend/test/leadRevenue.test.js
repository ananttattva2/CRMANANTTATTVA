const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { amountPaise, serviceRows, groupsFrom, hotClosed } = require('../src/services/leadRevenue');

test('revenue uses exact paise and rejects invalid, negative, infinite or overprecision amounts', () => {
  assert.equal(amountPaise('10000'), 1000000);
  assert.equal(amountPaise('10.29'), 1029);
  for (const value of ['-1', '0', '1.001', 'Infinity', '', '1e3', '10000000000']) assert.throws(() => amountPaise(value));
});
test('adding revenue preserves history while separate groups retain separate totals', () => {
  const entries = [{ _id: '1', groupId: 'a', amountPaise: 1000000 }, { _id: '2', groupId: 'a', amountPaise: 500000 }, { _id: '3', groupId: 'b', amountPaise: 200000 }];
  const result = groupsFrom(entries);
  assert.deepEqual(result.map(g => g.amountPaise), [1500000, 200000]);
  assert.equal(entries[0].amountPaise, 1000000);
  assert.equal(result[0].contributions.length, 2);
});
test('service keys survive unrelated edits and partial closure stays open', () => {
  const lead = { createdBy: 'owner', serviceSelections: [{ assignedServiceId: 'a', servicesOffered: 'Annual Return' }, { assignedServiceId: 'b' }], assignments: [{ assignedServiceId: 'a', closedBy: 'user' }, { assignedServiceId: 'b' }] };
  assert.deepEqual(serviceRows(lead, 'hot').map(s => s.key), ['a', 'b']);
  assert.equal(hotClosed(lead), false);
  lead.assignments[1].closedAt = new Date();
  assert.equal(hotClosed(lead), true);
  assert.equal(serviceRows({ createdBy: 'owner' }, 'cold')[0].key, 'cold-base');
});

function harness({ lead = {}, entries = [], eligibleOwner = 'u', denied = false, duplicate = false, admin = false, conflict = false } = {}) {
  const inserted = [];
  const updates = [];
  const hot = { _id: 'lead', createdBy: 'u', serviceSelections: [{ assignedServiceId: 's1', createdByCrmUserId: eligibleOwner }], ...lead };
  const chain = value => ({ select() { return this; }, sort() { return this; }, async lean() { return value; } });
  const Revenue = { async findOneAndUpdate(filter, update) { if (conflict) return null; updates.push({filter,update}); return {_id: 'entry'}; }, find: () => chain(entries), findOne: ({ requestId }) => chain(entries.find(e => e.requestId === requestId)), async create(value) { if (duplicate) throw Object.assign(new Error('duplicate'), { code: 11000 }); inserted.push(value); } };
  const deps = {
    'node:crypto': require('node:crypto'), mongoose: { isValidObjectId: () => true },
    '../models/Lead': { findOne: () => chain(denied ? null : hot) },
    '../models/TemporaryLead': { findOne: () => chain(null) },
    '../models/LeadRevenue': Revenue,
    './leadController': { leadAccessFilter: async () => ({ scoped: true }) },
    './temporaryLeadController': { temporaryLeadAccessFilter: async () => ({ scoped: true }) },
    '../services/leadRevenue': require('../src/services/leadRevenue'),
    '../utils/userRoles': { userHasAnyRole: () => admin }
  };
  const context = { exports: {}, require: name => { if (!(name in deps)) throw new Error(name); return deps[name]; } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/controllers/leadRevenueController.js'), 'utf8'), context);
  const req = { params: { kind: 'hot', id: 'lead' }, user: { _id: 'u', name: 'User' }, body: { amount: '10000', mode: 'new', serviceKeys: ['s1'], requestId: '12345678-1234-1234-1234-123456789012' } };
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  return { add: context.exports.add, correct: context.exports.correct, services: context.exports.services, req, res, inserted, updates };
}
async function run(h) { await h.add(h.req, h.res, e => { throw e; }); return h; }
test('authorized author records revenue once for their new service', async () => {
  const h = await run(harness());
  assert.equal(h.res.code, 201);
  assert.equal(h.inserted[0].amountPaise, 1000000);
  assert.equal(h.inserted[0].createdBy, 'u');
});
test('other authors, inaccessible leads and already-priced services cannot overwrite revenue', async () => {
  for (const options of [{ eligibleOwner: 'other' }, { denied: true }, { entries: [{ leadKind: 'hot', leadId: 'lead', serviceKeys: ['s1'], groupId: 'a', amountPaise: 500 }] }]) {
    const h = await run(harness(options));
    assert.ok([404, 409].includes(h.res.code));
    assert.equal(h.inserted.length, 0);
  }
});
test('add-to-existing is an appended contribution, with invalid groups rejected', async () => {
  const old = { leadKind: 'hot', leadId: 'lead', serviceKeys: ['old-service'], groupId: 'group', amountPaise: 500 };
  const h = harness({ entries: [old] });
  h.req.body.mode = 'add'; h.req.body.groupId = 'group';
  await run(h);
  assert.equal(h.inserted[0].groupId, 'group');
  assert.equal(old.amountPaise, 500);
  const bad = harness(); bad.req.body.mode = 'add'; bad.req.body.groupId = 'foreign';
  await run(bad); assert.equal(bad.res.code, 400);
});
test('duplicate request retries are idempotent; unique-index races are reported as conflicts', async () => {
  const h = harness({ entries: [{ requestId: '12345678-1234-1234-1234-123456789012', leadKind: 'hot', leadId: 'lead', createdBy: 'u', amountPaise: 1000000, serviceKeys: ['s1'], groupId: 'a' }] });
  await run(h); assert.equal(h.res.body.alreadySaved, true); assert.equal(h.inserted.length, 0);
  const race = await run(harness({ duplicate: true })); assert.equal(race.res.code, 409);
});

test('converted cold leads remain in Cold Closed history and link to one unique Hot business lead', async () => {
 const chain = value => ({select(){return this},populate(){return this},sort(){return this},maxTimeMS(){return this},async lean(){return value}});
 const hot = [{_id:'h',leadCode:'H1',company:'Hot',generatedForUser:{_id:'owner',name:'Current Owner'},generatedForName:'Stale Owner',serviceSelections:[{assignedServiceId:'a'}],assignments:[]}];
 const cold = [{_id:'c',status:'CONVERTED',convertedLead:'h',clientName:'Origin'}, {_id:'c2',status:'DRAFT',tempLeadCode:'C2',clientName:'Cold'}];
 const own = {_id:'r1',leadKind:'hot',leadId:'h',groupId:'g1',amountPaise:1000000,serviceKeys:['a']};
 const inherited = {_id:'r2',leadKind:'cold',leadId:'c',groupId:'g2',amountPaise:500000,serviceKeys:['cold-base']};
 let coldReads=0,revenueReads=0;
 const deps={
  'node:crypto':require('node:crypto'),mongoose:{},'../models/Lead':{find:()=>chain(hot)},
  '../models/TemporaryLead':{find:()=>chain(++coldReads===1?cold:[cold[0]])},
  '../models/LeadRevenue':{find:()=>chain(++revenueReads===1?[own,inherited]:[inherited])},
  './leadController':{leadAccessFilter:async()=>({visible:'hot'})},
  './temporaryLeadController':{temporaryLeadAccessFilter:async()=>({visible:'cold'})},
  '../services/leadRevenue':require('../src/services/leadRevenue'), '../utils/userRoles':{}
 };
 const context={exports:{},require:name=>deps[name]};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/controllers/leadRevenueController.js'),'utf8'),context);
 const res={json(data){this.data=data}};
 await context.exports.pipeline({user:{_id:'u'}},res,e=>{throw e});
 assert.equal(res.data.rows.length,3);
 assert.equal(res.data.rows.find(r=>r.kind==='hot').revenuePaise,1500000);
 assert.equal(res.data.rows.find(r=>r.kind==='hot').owner,'Current Owner');
 assert.equal(res.data.rows.find(r=>r.kind==='cold'&&r.id==='c').state,'closed');
 assert.equal(res.data.rows.find(r=>r.kind==='cold'&&r.id==='c').canonicalKey,'hot:h');
 assert.equal(res.data.rows.find(r=>r.kind==='cold'&&r.id==='c2').state,'open');
 const {uniquePipelineRows}=await import('../../frontend/src/utils/leadPipeline.mjs');
 assert.equal(uniquePipelineRows(res.data.rows).reduce((n,r)=>n+r.revenuePaise,0),1500000);
 assert.equal(uniquePipelineRows(res.data.rows).length,2);
});


test('PO totals count repeated received POs once and exclude provisional/rejected amounts', () => {
 const {purchaseOrders}=require('../src/services/leadRevenue');
 const po={poNumber:'PO-1',poDate:'2026-10-01',poFinancialYear:'2026-27',poAmount:10000};
 const rows=purchaseOrders({assignments:[
  {poStatus:'received',poYearRows:[po]},
  {poStatus:'received',poYearRows:[po,{...po,poNumber:'PO-2',poAmount:3000}]},
  {poStatus:'provisional',poYearRows:[{...po,poNumber:'PENDING',poAmount:50000}]},
  {poStatus:'received',poApprovalStatus:'REJECTED',poYearRows:[{...po,poNumber:'REJECTED',poAmount:40000}]}
 ]});
 assert.equal(rows.length,2);
 assert.equal(rows.reduce((n,p)=>n+p.amountPaise,0),1300000);
});
test('service popup returns saved service details and each service closure state',()=>{
 const {serviceDetails}=require('../src/services/leadRevenue');
 const rows=serviceDetails({serviceSelections:[{assignedServiceId:'a',eprCategory:'Plastic',servicesOffered:'Annual Return'},{assignedServiceId:'b',servicesOffered:'Registration'}],assignments:[{assignedServiceId:'a',closedBy:'u',assignedStaffText:'Staff'}]});
 assert.equal(rows.length,2);assert.equal(rows[0].offering,'Annual Return');assert.equal(rows[0].closed,true);assert.equal(rows[1].closed,false);assert.equal(rows[0].staff,'Staff');
});


test('company service endpoint respects access and returns only display fields', async()=>{
 const denied=harness({denied:true});
 await denied.services(denied.req,denied.res,e=>{throw e});
 assert.equal(denied.res.code,404);
 const allowed=harness({lead:{password:'PRIVATE-MARKER',otp:'SECRET-OTP'}});
 await allowed.services(allowed.req,allowed.res,e=>{throw e});
 assert.equal(allowed.res.body.ok,true);
 assert.equal(allowed.res.body.services.length,1);
 assert.ok(!JSON.stringify(allowed.res.body).includes('PRIVATE-MARKER'));
 assert.ok(!JSON.stringify(allowed.res.body).includes('SECRET-OTP'));
});


test('saved revenue corrections require administrator role and preserve before/after audit',async()=>{
 const entry={_id:'entry',leadKind:'hot',leadId:'lead',serviceKeys:['s1'],groupId:'a',amountPaise:1000000};
 const user=harness({entries:[entry]});user.req.params.entryId='entry';
 await user.correct(user.req,user.res,e=>{throw e});assert.equal(user.res.code,403);assert.equal(user.updates.length,0);
 const admin=harness({admin:true,entries:[entry]});admin.req.params.entryId='entry';
 admin.req.body={amount:'12500',expectedPaise:1000000,expectedRevision:0,reason:'Correct approved estimate',requestId:'12345678-1234-1234-1234-123456789012'};
 await admin.correct(admin.req,admin.res,e=>{throw e});assert.equal(admin.res.code,200);
 assert.equal(admin.updates[0].filter.amountPaise,1000000);
 assert.equal(admin.updates[0].update.$set.amountPaise,1250000);
 assert.equal(admin.updates[0].update.$push.corrections.beforePaise,1000000);
 assert.equal(admin.updates[0].update.$push.corrections.afterPaise,1250000);
 assert.equal(admin.updates[0].update.$push.corrections.actor,'u');
 assert.equal(entry.amountPaise,1000000);
});
test('admin correction rejects stale amounts, missing reasons and concurrent changes',async()=>{
 const entry={_id:'entry',leadKind:'hot',leadId:'lead',serviceKeys:['s1'],groupId:'a',amountPaise:1000000};
 for(const options of [{expectedPaise:999,reason:'Fix'}, {expectedPaise:1000000,expectedRevision:0,reason:''}, {expectedPaise:1000000,expectedRevision:0,reason:'Fix',conflict:true}]){
  const h=harness({admin:true,entries:[entry],conflict:options.conflict});h.req.params.entryId='entry';
  h.req.body={amount:'12000',expectedPaise:options.expectedPaise,expectedRevision:0,reason:options.reason,requestId:'12345678-1234-1234-1234-123456789012'};
  await h.correct(h.req,h.res,e=>{throw e});assert.ok([400,409].includes(h.res.code));assert.equal(h.updates.length,0);
 }
});


test('administrator may correct an incorrect estimate to zero without deleting its audit trail',async()=>{
 const entry={_id:'entry',leadKind:'hot',leadId:'lead',serviceKeys:['s1'],groupId:'a',amountPaise:1000000};
 const h=harness({admin:true,entries:[entry]});h.req.params.entryId='entry';
 h.req.body={amount:'0',expectedPaise:1000000,expectedRevision:0,reason:'Incorrect original estimate',requestId:'12345678-1234-1234-1234-123456789012'};
 await h.correct(h.req,h.res,e=>{throw e});assert.equal(h.res.code,200);
 assert.equal(h.updates[0].update.$set.amountPaise,0);
 assert.equal(h.updates[0].update.$push.corrections.beforePaise,1000000);
 assert.equal(h.updates[0].update.$push.corrections.afterPaise,0);
});
