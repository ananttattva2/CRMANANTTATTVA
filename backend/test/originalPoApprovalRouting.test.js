const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Lead = require('../src/models/Lead');
const Approval = require('../src/models/PendingApproval');
const User = require('../src/models/User');
const Activity = require('../src/models/LeadActivity');
const leadController = require('../src/controllers/leadController');
const financeController = require('../src/controllers/poFinanceController');
const freeze = require('../src/services/poReviewFreeze');
const cache = require('../src/services/crmCache');
const reminders = require('../src/services/postPoApprovalReminders');
const { hasReceivedOriginalPo } = require('../src/utils/provisionalClosureDeadline');
const { sourceSignature } = require('../src/services/poApprovalWorkflow');
const id = '507f1f77bcf86cd799439011';
const query = rows => ({ select(){return this;}, lean:async()=>rows });
const response = () => ({ statusCode:200, status(code){this.statusCode=code;return this;}, json(body){this.body=body;return this;} });

test('original PO endpoint creates separate pending approvals for both Annual Return years and preserves registration', async t => {
 const requests = [];
 const services = [
  {assignedServiceId:'registration',servicesOffered:'New Registration',firstAnnualReturnYearApplicable:'2026-27'},
  {assignedServiceId:'annual-26',servicesOffered:'Annual Return Filling',firstAnnualReturnYearApplicable:'2026-27'},
  {assignedServiceId:'annual-27',servicesOffered:'Annual Return Filling',firstAnnualReturnYearApplicable:'2027-28'}
 ];
 const registration = {assignedServiceId:'registration',poStatus:'received',poApprovalStatus:'APPROVED',closedBy:id,poYearRows:[{poNumber:'REG',poAmount:30000}]};
 const lead = {_id:id,leadCode:'ATPL-LEAD-0077',company:'JAINEEKET ENTERPRISE',serviceSelections:services,
  assignments:[registration,...services.slice(1).map(service=>({assignedServiceId:service.assignedServiceId,poStatus:'provisional',closedBy:id,poApprovalStatus:'APPROVED'}))],
  markModified(){},async save(){this.saved=true;},toObject(){return structuredClone({_id:this._id,leadCode:this.leadCode,company:this.company,serviceSelections:this.serviceSelections,assignments:this.assignments});}};
 t.mock.method(Lead,'findOne',async()=>lead);
 t.mock.method(Approval,'findOne',()=>query(null));
 t.mock.method(Approval,'findOneAndUpdate',async(filter,update)=>{requests.push({filter,update});return {_id:'review'+requests.length};});
 t.mock.method(User,'find',()=>query([]));
 t.mock.method(Activity,'create',async()=>({}));
 t.mock.method(freeze,'assertLeadPoEditable',async()=>{});
 const originalPoRows=[1,2].map(assignmentIndex=>({assignmentIndex,fy:services[assignmentIndex].firstAnnualReturnYearApplicable,poNumber:'AT/26-27/528',poDate:'2026-11-21',poAmount:30000,poFileUrl:'https://example.test/original.pdf',poFileName:'original.pdf',poFileType:'application/pdf',paymentTerm:'50% advance'}));
 const res=response();
 await leadController.permanentlyCloseProvisionalLead({params:{id},user:{_id:id,role:'admin',name:'Admin'},body:{originalPoReceived:true,originalPoRows}},res);
 assert.equal(res.statusCode,200,JSON.stringify(res.body));
 assert.equal(lead.saved,true);
 assert.equal(requests.length,2);
 assert.deepEqual(lead.assignments[0],registration);
 assert.deepEqual(requests.map(row=>row.filter.sourceClientId),[id+':po:annual-26',id+':po:annual-27']);
 for(const [index,request] of requests.entries()) {
  assert.equal(request.update.$set.approvalStatus,'PENDING');
  assert.equal(request.update.$set.payload.specialApprovalOrigin,true);
  assert.equal(request.update.$set.payload.service.firstAnnualReturnYearApplicable,services[index+1].firstAnnualReturnYearApplicable);
  assert.equal(request.update.$set.payload.poYearRows[0].fy,originalPoRows[index].fy);
  assert.equal(request.update.$set.payload.poYearRows[0].poFileUrl,originalPoRows[index].poFileUrl);
  assert.equal(lead.assignments[index+1].poApprovalStatus,'PENDING');
  assert.equal(lead.assignments[index+1].poStatus,'permanently_closed');
 }
 assert.equal(res.body.poApprovalSubmissions.length,2);
});

test('Admin can pass a permanently closed original PO to Finance with the real proof and terms', async t => {
 const assignment={assignedServiceId:'annual-27',poStatus:'permanently_closed',originalPoConfirmed:true,poApprovalStatus:'PENDING',poYearRows:[{poNumber:'AT/26-27/528',poAmount:30000,fy:'2027-28',paymentTerm:'50% advance',poFileUrl:'https://example.test/original.pdf',poFileName:'original.pdf'}]};
 const service={assignedServiceId:'annual-27',servicesOffered:'Annual Return Filling',firstAnnualReturnYearApplicable:'2027-28'};
 const approval={_id:id,updatedAt:new Date('2026-11-25T06:15:00Z'),approvalStatus:'PENDING',payload:{leadId:id,assignedServiceId:'annual-27',assignmentIndex:0},markModified(){},async save(){}};
 const lead={_id:id,assignments:[assignment],serviceSelections:[service],markModified(){},async save(){}};
 const session={withTransaction:async work=>work(),endSession:async()=>{}};
 t.mock.method(mongoose,'startSession',async()=>session);
 t.mock.method(Approval,'findOne',()=>({session:async()=>approval}));
 t.mock.method(Lead,'findById',()=>({session:async()=>lead}));
 t.mock.method(cache,'invalidateCrmCache',async()=>{});
 let notified;
 t.mock.method(leadController,'notifyPurchaseOrderDecision',async notification=>{notified=notification;return {sent:1};});
 t.mock.method(reminders,'runPostPoApprovalReminders',async()=>({}));
 const res=response();
 await financeController.initialApproval({params:{id},user:{_id:id,role:'superadmin',name:'Super Admin'},body:{reviewedAt:approval.updatedAt.toISOString(),status:'APPROVED',remarks:'Original PO verified'}},res);
 assert.equal(res.statusCode,200,JSON.stringify(res.body));
 assert.equal(approval.poReview.stage,'FINANCE_READY');
 assert.equal(assignment.poApprovalStatus,'FINANCE_PENDING');
 assert.equal(assignment.poStatus,'permanently_closed');
 assert.equal(approval.poReview.sourceSignature,sourceSignature(assignment,service));
 assert.equal(approval.payload.poYearRows[0].poFileUrl,assignment.poYearRows[0].poFileUrl);
 assert.equal(approval.poReview.terms[0].paymentTerm,'50% advance');
 assert.equal(notified.initialApproval,true);
});

test('permanent closure is received PO evidence only when original PO is confirmed',()=>{
 assert.equal(hasReceivedOriginalPo({poStatus:'permanently_closed',originalPoConfirmed:true}),true);
 assert.equal(hasReceivedOriginalPo({poStatus:'permanently_closed'}),false);
 assert.equal(hasReceivedOriginalPo({poStatus:'provisional'}),false);
});


test('original PO recovers an overdue provisional service without bypassing an active Finance review',async t=>{
 const before={assignments:[{assignedServiceId:'annual-26',poStatus:'provisional',provisionalCloseExpiresAt:'2026-01-01T00:00:00Z'}],serviceSelections:[]};
 const next={assignments:[{assignedServiceId:'annual-26',poStatus:'permanently_closed',originalPoConfirmed:true,poYearRows:[{poNumber:'ORIGINAL',poFileUrl:'https://example.test/po.pdf'}]}]};
 t.mock.method(Approval,'find',()=>query([]));
 await freeze.assertLeadPoEditable(id,before,next);
 Approval.find=()=>query([{payload:{assignmentIndex:0,assignedServiceId:'annual-26'},poReview:{stage:'FINANCE_READY'}}]);
 await assert.rejects(freeze.assertLeadPoEditable(id,before,next),error=>error.status===409);
});
