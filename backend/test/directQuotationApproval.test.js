const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {directQuotationApproval}=require('../src/services/directQuotationApproval');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/controllers/quotationController.js'),'utf8');
for(const role of ['sales', 'operation', 'manager', 'franchise', 'admin', 'superadmin']) for(const mode of ['create','update']) test(`${role}: ${mode} quotation automatically enters Super Admin pending approval without an Admin decision`,async()=>{
 let queued, removed=false;
 const data={items:[],grandTotal:25000};
 const document={_id:'quotation',status:'approved',managementApproval:{status:'APPROVED',adminApprovalStatus:'APPROVED'},approvalDecision:{status:'APPROVED'},items:[],toObject(){return {...this}},markModified(){},async save(){},async populate(){return this}};
 const context={exports:{},console,directQuotationApproval,validateGstNumber:()=>'',quotationAccessFilter:async()=>({}),combineFilters:(...x)=>x,
 cleanBody:()=>data,refreshQuotationLeadDetails:async x=>x,validatePaymentTerms:()=>'',validateQuotationItemDates(){},validateQuotationPiboItems:async()=>{},resolveCrmRelationships:async()=>({}),nextQuotationNumber:async()=> 'AT/26-27/test',
 Quotation:{findOne:async()=>document,create:async fields=>Object.assign(document,fields)},PendingApproval:{deleteMany:async()=>{removed=true}},
 upsertQuotationPendingApproval:async(q,type,automatic)=>{queued={status:q.status,managementStatus:q.managementApproval.status,decision:{...q.approvalDecision},adminApproval:q.managementApproval.adminApprovalStatus,type,automatic}},sendQuotationLifecycleEmail:async()=>{}};
 const name=mode+'Quotation',start=source.indexOf(`exports.${name} =`),end=source.indexOf('\nexports.',start+1);
 vm.runInNewContext(source.slice(start,end),context);
 let response;
 await context.exports[name]({body:{leadDetails:{}},params:{id:'quotation'},user:{_id:'user',role,name:'User'}},{status(){return this},json(x){response=x}});
 assert.equal(response.ok,true);
 assert.equal(queued.status,'submitted');assert.equal(queued.managementStatus,'PENDING');assert.equal(queued.adminApproval,undefined);
 assert.equal(Object.keys(queued.decision).length,0);assert.equal(queued.automatic,true);assert.equal(queued.type,mode==='create'?'CREATE':'UPDATE');
 if(mode==='update'){assert.equal(removed,true);assert.equal(document.revisionHistory.length,1);}
});
