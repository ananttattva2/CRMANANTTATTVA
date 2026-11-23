const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {readPreviousClientDecisions,DECISION_ACTIONS}=require('../src/services/clientDecisionHistory');
const client='507f1f77bcf86cd799439099',krishna='507f1f77bcf86cd799439011',kamlesh='507f1f77bcf86cd799439012';
test('resubmission and a different current reviewer do not replace the last submitted decision',async()=>{
 const history=[{action:'CHANGES_REQUIRED',actionBy:krishna,actionAt:'2026-11-01T10:00:00Z'},{action:'RESUBMITTED',actionBy:kamlesh,actionAt:'2026-11-02T10:00:00Z'},{action:'SECTION_VERIFIED',actionBy:kamlesh,actionAt:'2026-11-03T10:00:00Z'}];
 const ReviewModel={aggregate:async pipeline=>{const allowed=pipeline[1].$project.lastDecision.$arrayElemAt[0].$filter.cond.$in[1];assert.deepEqual(allowed,DECISION_ACTIONS);assert.ok(!allowed.includes('RESUBMITTED'));return[{client,assignedReviewer:kamlesh,lastDecision:history.filter(event=>allowed.includes(event.action)).at(-1)}];}};
 const UserModel={find:filter=>{assert.deepEqual(filter._id.$in,[krishna]);return{select:()=>({lean:async()=>[{_id:krishna,name:'KRISHNA Yadav'}]})};}};
 const result=await readPreviousClientDecisions([{sourceClientId:client,approvalStatus:'PENDING',actionBy:null}],{ReviewModel,UserModel});
 assert.equal(result.get(client).decisionBy,'KRISHNA Yadav');assert.equal(result.get(client).decisionAt,'2026-11-01T10:00:00Z');
});
test('a new final decision updates Decision By; untouched first-time clients stay blank',async()=>{
 const ReviewModel={aggregate:async()=>[{client,lastDecision:{action:'APPROVED',actionBy:kamlesh,actionAt:'2026-11-04'}},{client:'507f1f77bcf86cd799439098'}]};
 const UserModel={find:()=>({select:()=>({lean:async()=>[{_id:kamlesh,name:'Kamlesh Zore'}]})})};
 const result=await readPreviousClientDecisions([{sourceClientId:client}],{ReviewModel,UserModel});assert.equal(result.get(client).decisionBy,'Kamlesh Zore');assert.equal(result.has('507f1f77bcf86cd799439098'),false);
 await readPreviousClientDecisions([{sourceClientId:client,actionBy:{name:'KRISHNA Yadav'}}],{ReviewModel:{aggregate:()=>assert.fail('Existing decision must not require history reads')}});
});
test('corrected Client Master returns to pending without clearing previous decision identity',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../src/controllers/clientController.js'),'utf8');const start=source.indexOf('async function queueCreatedClientApproval('),end=source.indexOf('\nasync function syncPendingApprovalRows(',start);
 const pending={actionBy:krishna,actionAt:'2026-11-01'},review={history:[],save:async()=>{}};
 const context={Date,console,PendingApproval:{findOneAndUpdate:async(filter,update)=>Object.assign(pending,update.$set)},ClientComplianceReview:{findOne:async()=>review},upsertPendingApproval:async()=>{},mapClientPendingApprovalRow:()=>({}),syncClientReviewReminderState:async()=>{},notifyComplianceClientSubmission:async()=>({sent:true})};
 const queue=vm.runInNewContext(source.slice(start,end)+';queueCreatedClientApproval',context);await queue({_id:client},{_id:kamlesh,name:'Kamlesh'},{resubmission:true,previousStatus:'PARTIALLY_APPROVED'});assert.equal(pending.approvalStatus,'PENDING');assert.equal(pending.actionBy,krishna);assert.equal(pending.actionAt,'2026-11-01');assert.equal(review.history[0].action,'RESUBMITTED');
});
test('pending client Excel retains the previous reviewer name',async()=>{
 const {buildPendingClientApprovalExportRows}=await import('../../frontend/src/utils/pendingClientApprovalExport.mjs');
 const rows=buildPendingClientApprovalExportRows([{clientName:'Corrected Client',approvalStatus:'PENDING',createdBy:'User',decisionBy:'KRISHNA Yadav',decisionAt:'2026-11-01'}]);assert.equal(rows[0]['Decision By'],'KRISHNA Yadav');
});
