const test=require('node:test'),assert=require('node:assert/strict');
const {readDashboardCollection}=require('../src/services/dashboardSnapshotCache');
test('validated snapshots fetch only changed documents and immediately remove deleted records',async()=>{
 let docs=[{_id:'one',value:10},{_id:'two',value:20}],fullReads=0,deltaReads=0;const cache=new Map();const store={get:async key=>cache.get(key),set:async(key,value)=>cache.set(key,value)};
 const Model={collection:{name:'snapshot-test'},aggregate(stages){return{option:async()=>{const p=stages[1].$project;if(p.signature)return docs.map(row=>({_id:row._id,signature:String(row.value)}));const ids=stages[0].$match.$and?.[1]?._id.$in;if(ids){deltaReads++;return docs.filter(row=>ids.includes(row._id)).map(row=>({...row}));}fullReads++;return docs.map(row=>({...row}));}};}};
 assert.equal((await readDashboardCollection(Model,{}, {value:1},{store})).length,2);assert.equal(fullReads,1);
 await readDashboardCollection(Model,{}, {value:1},{store});assert.equal(fullReads,1);assert.equal(deltaReads,0);
 docs[0].value=11;let rows=await readDashboardCollection(Model,{}, {value:1},{store});assert.equal(rows[0].value,11);assert.equal(deltaReads,1);
 docs=docs.slice(0,1);rows=await readDashboardCollection(Model,{}, {value:1},{store});assert.equal(rows.length,1);assert.equal(rows[0]._id,'one');assert.equal(fullReads,1);
 docs.push({_id:'three',value:30});rows=await readDashboardCollection(Model,{}, {value:1},{store});assert.equal(rows.length,2);assert.equal(deltaReads,2);
});

test('fingerprints include decimal PO amounts as strings, including original and legacy snapshot rows',()=>{const {fingerprintProjection}=require('../src/services/dashboardSnapshotCache');const source=JSON.stringify(fingerprintProjection);assert.ok(source.includes('$$po.poAmount'));assert.ok(source.includes('$$assignment.originalPoDetails.poAmount'));assert.ok(source.includes('$data.selectedLeadSnapshot.assignments'));assert.ok(source.includes('$toString'));});

test('shared source-row cache never returns rows outside the current Mongo scope',async()=>{
 const docs=[{_id:'alice-row',tenant:'alice',value:10},{_id:'bob-row',tenant:'bob',value:20}];const cache=new Map(),store={get:async k=>cache.get(k),set:async(k,v)=>cache.set(k,v)};
 const Model={collection:{name:'scoped-snapshot-test'},aggregate(stages){return{option:async()=>{const f=stages[0].$match;const tenant=f.tenant||f.$and?.[0]?.tenant;const rows=docs.filter(row=>!tenant||row.tenant===tenant);if(stages[1].$project.signature)return rows.map(row=>({_id:row._id,signature:String(row.value)}));return rows.map(row=>({...row}));}};}};
 await readDashboardCollection(Model,{}, {value:1},{store});
 for(const tenant of ['alice','bob','alice']){const rows=await readDashboardCollection(Model,{tenant},{value:1},{store});assert.deepEqual(rows.map(row=>row._id),[`${tenant}-row`]);}
});

test('aggregation snapshots revalidate joined collections before returning cached financial summaries',async()=>{
 const {readDashboardAggregation}=require('../src/services/dashboardSnapshotCache');let version=1,reads=0;const cache=new Map(),store={get:async k=>cache.get(k),set:async(k,v)=>cache.set(k,v)};
 const Model={collection:{name:'joined-source-test'},db:{name:'test',collection(){return{aggregate(){return{toArray:async()=>[{_id:'quote',signature:String(version)}]};}};}},aggregate(stages){return{option:async()=>{if(stages[0].$project?.signature)return[{_id:'lead',signature:'stable'}];reads++;return[{amount:version}];}};}};
 const pipeline=[{$lookup:{from:'joined-quotes-test',as:'quotes'}}];assert.equal((await readDashboardAggregation(Model,pipeline,{store}))[0].amount,1);await readDashboardAggregation(Model,pipeline,{store});assert.equal(reads,1);version=2;assert.equal((await readDashboardAggregation(Model,pipeline,{store}))[0].amount,2);assert.equal(reads,2);
});

test('an edit during cold population keeps stable rows so the next read reloads only the changed document',async()=>{
 let docs=[{_id:'editing',value:10},{_id:'stable',value:20}],full=0,delta=0;const cache=new Map(),store={get:async k=>cache.get(k),set:async(k,v)=>cache.set(k,v)};
 const Model={collection:{name:'cold-population-test'},aggregate(stages){return{option:async()=>{if(stages[1].$project.signature)return docs.map(row=>({_id:row._id,signature:String(row.value)}));const ids=stages[0].$match.$and?.[1]?._id.$in;if(ids){delta++;return docs.filter(row=>ids.includes(row._id)).map(row=>({...row}));}full++;const rows=docs.map(row=>({...row}));docs[0].value=11;return rows;}};}};
 await readDashboardCollection(Model,{}, {value:1},{store});const rows=await readDashboardCollection(Model,{}, {value:1},{store});assert.equal(rows[0].value,11);assert.equal(full,1);assert.equal(delta,1);
});
