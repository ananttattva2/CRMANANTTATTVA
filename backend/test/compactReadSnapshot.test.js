const {test}=require('node:test');const assert=require('node:assert/strict');
const {compactReadSnapshot}=require('../src/services/compactReadSnapshot');
test('compact snapshots refresh changed rows, exclude deletions and isolate populated results without stale TTLs',async()=>{
 const source=new Map([['1',{_id:'1',company:'One',updatedAt:new Date(1000)}],['2',{_id:'2',company:'Two',updatedAt:new Date(1000)}]]);const saved=new Map();let reads=0;
 const Model={modelName:'TestLead',collection:{createIndex:async()=> 'versions',find(){return{toArray:async()=>[...source.values()].filter(row=>!row.deletedAt).map(({_id,updatedAt})=>({_id,updatedAt}))};}},db:{collection:()=>({find:filter=>({toArray:async()=>[...saved.entries()].filter(([id])=>filter._id.$in.includes(id)).map(([,doc])=>doc)}),bulkWrite:async operations=>{for(const op of operations){const v=op.updateOne;saved.set(v.filter._id,{_id:v.filter._id,...v.update.$set});}}})},find(filter){reads++;const ids=filter.$and[1]._id.$in;return{select(){return this;},maxTimeMS(){return this;},lean:async()=>ids.map(id=>source.get(id)).filter(row=>!row.deletedAt).map(row=>({...row}))};}};
 const opts={filter:{deletedAt:null},versionIndex:{updatedAt:1,_id:1},selection:'company'};
 const first=await compactReadSnapshot(Model,opts);assert.equal(reads,1);first[0].company='Changed in UI';
 const second=await compactReadSnapshot(Model,opts);assert.equal(reads,1);assert.equal(second[0].company,'One');
 source.set('1',{_id:'1',company:'Updated',updatedAt:new Date(2000)});
 const third=await compactReadSnapshot(Model,opts);assert.equal(reads,2);assert.equal(third[0].company,'Updated');
 source.get('2').deletedAt=new Date();assert.equal((await compactReadSnapshot(Model,opts)).length,1);
 await compactReadSnapshot(Model,{...opts,selection:'company status'});assert.equal(reads,3);
});
test('gateway recovery retries only bounded safe GET failures',async()=>{
 const {gatewayRetryDelay}=await import('../../frontend/src/services/gatewayRetry.mjs');
 assert.equal(gatewayRetryDelay({config:{method:'get'},response:{status:502}}),1000);
 assert.equal(gatewayRetryDelay({config:{method:'get',_crmGatewayRetries:2},response:{status:503}}),5000);
 for(const method of ['post','put','patch','delete'])assert.equal(gatewayRetryDelay({config:{method},response:{status:502}}),null);
 for(const status of [400,401,403,404,500])assert.equal(gatewayRetryDelay({config:{method:'get'},response:{status}}),null);
 assert.equal(gatewayRetryDelay({config:{method:'get',_crmGatewayRetries:3},response:{status:504}}),null);
 assert.equal(gatewayRetryDelay({config:{method:'get',signal:{aborted:true}},response:{status:502}}),null);
});
