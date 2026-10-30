const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const helpers=require('../src/controllers/temporaryLeadController').__test;
function harness(options={}){
 const timestamp=new Date('2026-10-30T08:00:00.000Z');
 const details=helpers.normalizeTemporaryLeadPayload({companyName:'Example Manufacturing',personName:'Demo Person',email:'demo@example.test',phone:'9876543210',sector:'Manufacturing'});
 const row={_id:'cold',status:'DRAFT',updatedAt:timestamp,...details,...options.row};
 const updates=[];
 const context={exports:{},mongoose:{Types:{ObjectId:{isValid:()=>true}}},TemporaryLead:{async findOne(){return options.denied?null:row},async findOneAndUpdate(filter,update){updates.push({filter,update});return options.conflict?null:{...row,...update.$set}}},combineFilters:(...filters)=>({$and:filters}),temporaryLeadAccessFilter:async()=>({createdBy:'actor'}),normalizeTemporaryLeadPayload:helpers.normalizeTemporaryLeadPayload,validateTemporaryLeadPayload:helpers.validateTemporaryLeadPayload,findTemporaryLeadDuplicate:async()=>options.duplicate||null};
 const source=fs.readFileSync(path.resolve(__dirname,'../src/controllers/temporaryLeadController.js'),'utf8');
 vm.runInNewContext(source.slice(source.indexOf('exports.update = async')),context);
 const req={params:{id:'cold'},user:{_id:'actor'},body:{companyName:'Example Manufacturing',personName:'Updated Person',email:'demo@example.test',phone:'9876543210',sector:'Manufacturing',expectedUpdatedAt:timestamp.toISOString(),...options.body}};
 const res={code:200,status(code){this.code=code;return this},json(body){this.body=body;return this}};
 return{update:context.exports.update,req,res,updates};
}
async function run(h){await h.update(h.req,h.res,e=>{throw e});return h}
test('Cold Lead edit saves normalized contact details with an optimistic timestamp guard',async()=>{
 const h=await run(harness());assert.equal(h.res.code,200);assert.equal(h.res.body.temporaryLead.personName,'Updated Person');assert.equal(h.updates[0].filter.updatedAt.toISOString(),'2026-10-30T08:00:00.000Z');
});
test('Cold Lead edit blocks inaccessible, converted, closed and stale records',async()=>{
 for(const options of [{denied:true},{row:{status:'CONVERTED'}},{row:{pipelineClosedAt:new Date()}},{body:{expectedUpdatedAt:'old'}}]){const h=await run(harness(options));assert.ok([404,409].includes(h.res.code));assert.equal(h.updates.length,0)}
});
test('Cold Lead edit rejects invalid contact details and duplicate identities',async()=>{
 const invalid=await run(harness({body:{email:'invalid'}}));assert.equal(invalid.res.code,400);
 const duplicate=await run(harness({body:{companyName:'Other Company'},duplicate:{code:'existing'}}));assert.equal(duplicate.res.code,409);assert.equal(duplicate.updates.length,0);
});
