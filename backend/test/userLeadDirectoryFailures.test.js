const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Lead = require('../src/models/Lead');
const { noOwnerEligibilityFilter, noOwnerWorkspaceFilter } = require('../src/services/leadOwnershipAndEmailWorkflow');
const { ownerFilter } = require('../src/utils/visibilityScope');

test('ordinary-user list, count and search scopes cast against the real Lead schema', () => {
 const id = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
 const owned = ownerFilter({ ids: [id], identities: ['Staff', 'staff@example.test'] }, 'createdBy', 'assignedTo', ['createdByName', 'assignedStaffText'], ['assignments.assignedStaff']);
 const scope = { $or: [owned, noOwnerWorkspaceFilter()] };
 for (const search of ['', 'el', 'elkay']) {
  const filter = { $and: [scope, { 'noOwner.active': { $ne: true } }, ...(search ? [{ $or: [{ company: new RegExp(search,'i') }, { leadCode: new RegExp(search,'i') }] }] : [])] };
  assert.doesNotThrow(() => Lead.countDocuments(filter).cast(Lead));
  assert.doesNotThrow(() => Lead.find(filter).cast(Lead));
 }
 assert.doesNotThrow(() => Lead.find(noOwnerEligibilityFilter()).cast(Lead));
});

test('nested legacy closure checks handle missing, blank, string and ObjectId owners without a cast predicate', () => {
 const filter = noOwnerEligibilityFilter();
 for (const key of ['assignments', 'serviceSelections']) assert.equal(filter[key].$not.$elemMatch.$or.some(row => row.closedBy), false);
 const checks = filter.$expr.$and;
 assert.equal(checks.length,2);
 for (const [i, path] of ['assignments','serviceSelections'].entries()) {
  const map = checks[i].$not[0].$anyElementTrue[0].$map;
  assert.equal(map.input.$cond[1], `$${path}`);
  assert.deepEqual(map.in, {$ne:[{$ifNull:['$$closureRow.closedBy','']},'']});
 }
 for (const value of [undefined, null, '', '507f1f77bcf86cd799439011', new mongoose.Types.ObjectId()]) {
  assert.equal((value ?? '') !== '', Boolean(value));
 }
});

test('lead query failures finish with a retryable JSON response instead of an unhandled rejection', async () => {
 const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
 const source = fs.readFileSync(path.resolve(__dirname,'../src/controllers/leadController.js'),'utf8');
 const code = source.slice(source.indexOf('exports.listLeads ='),source.indexOf('exports.getLead ='));
 const context = {exports:{},process, console:{error(){}},leadAccessFilter:async()=>({}),combineAccessFilters:(...filters)=>({$and:filters}), mongoose, escapeRegex:value=>value,
  require:name=>name.endsWith('crmCache')?{getCrmCache:()=>({remember:async (_key,load)=>load()})}:require(name.replace('../services/','../src/services/')),
  Lead:{aggregate(){return {option:async()=>{throw new Error('Database failure');}};},countDocuments:async()=>{throw new Error('Count failure');},populate:async rows=>rows}
 };
 vm.createContext(context);vm.runInContext(code,context);let status,body;
 await context.exports.listLeads({query:{paginated:'true',directory:'true',workspace:'leads'},user:{}},{status:value=>{status=value;return {json:value=>{body=value;}};}});
 assert.equal(status,503);assert.equal(body.code,'LEAD_DIRECTORY_UNAVAILABLE');
});

test('admin allocation directory includes released leads and staff cannot request allocation scope', async () => {
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const source=fs.readFileSync(path.resolve(__dirname,'../src/controllers/leadController.js'),'utf8');
 const code=source.slice(source.indexOf('exports.listLeads ='),source.indexOf('exports.getLead ='));
 let calls=0;const released={_id:'lead',company:'SOLTEX-SILVASSA',noOwner:{active:true}};
 const context={exports:{},process,console:{error(){}},ADMIN_ROLES:['admin'],userHasAnyRole:user=>user.role==='admin',leadAccessFilter:async()=>({}),combineAccessFilters:(...filters)=>({$and:filters}),mongoose,escapeRegex:value=>value,
 require:name=>name.endsWith('crmCache')?{getCrmCache:()=>({remember:async(_key,load)=>load()})}:require(name.replace('../services/','../src/services/')),
 Lead:{aggregate(pipeline){calls++;const page=!!pipeline.find(stage=>stage.$limit);if(page)assert.equal(JSON.stringify(pipeline[0]).includes('noOwner.active'),false);return{option:async()=>page?[released]:[{total:1,existing:0,allocated:0}]};},countDocuments:async()=>1,populate:async rows=>rows}};
 vm.createContext(context);vm.runInContext(code,context);let status=200,body;const res={set(){},status(value){status=value;return this;},json(value){body=value;}};
 await context.exports.listLeads({query:{paginated:'true',directory:'true',workspace:'allocation',search:'soltex'},user:{role:'admin'}},res);
 assert.equal(body.leads[0].company,'SOLTEX-SILVASSA');assert.equal(body.pagination.total,1);const reads=calls;
 await context.exports.listLeads({query:{paginated:'true',directory:'true',workspace:'allocation'},user:{role:'sales'}},res);
 assert.equal(status,403);assert.equal(calls,reads);
});
