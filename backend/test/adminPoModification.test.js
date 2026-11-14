const test = require('node:test');
const assert = require('node:assert/strict');
const controller = require('../src/controllers/leadController')._test;
const PendingApproval = require('../src/models/PendingApproval');
const before = { assignedServiceId: 's1', poStatus: 'received', poApprovalStatus: 'APPROVED', closedBy: 'owner', closedByText: 'Owner', closedAt: '2026-10-01', closureRequestedBy: 'owner', poYearRows: [{ poNumber: 'PO1', poDate: '2026-10-01', poAmount: 100, poFileUrl: 'https://example.com/proof.pdf' }] };

test('Admin and Super Admin edits skip repeat initial approval only for existing received POs', () => {
  for (const role of ['admin', 'superadmin']) assert.equal(controller.canDirectlyApprovePoEdit({role}, true, before), true);
  for (const role of ['operation', 'manager', 'sales', 'compliance', 'accounts']) assert.equal(controller.canDirectlyApprovePoEdit({role}, true, before), false);
  assert.equal(controller.canDirectlyApprovePoEdit({role:'admin'}, false, before), false);
  assert.equal(controller.canDirectlyApprovePoEdit({role:'admin'}, true, {...before,poYearRows:[]}), false);
  assert.equal(controller.canDirectlyApprovePoEdit({role:'admin'}, true, {...before,poStatus:'provisional'}), false);
  assert.equal(controller.isAssignmentOnlyLeadUpdate({assignments:[before],modifyPoDetails:true}),true);
});

test('an Admin PO edit is approved directly and archives the completed Finance audit', async () => {
  const originalFind = PendingApproval.findOne, originalCreate = PendingApproval.findOneAndUpdate;
  const User = require('../src/models/User'), originalUsers = User.find;
  const requests=[];
  PendingApproval.findOne=()=>({select(){return this;},lean:async()=>({poReview:{stage:'FINALIZED',version:4}})});
  PendingApproval.findOneAndUpdate=async(...args)=>{requests.push(args);return {_id:'review1'};};
  User.find=()=>({select(){return this;},lean:async()=>[]});
  try {
    const row={...structuredClone(before),closedBy:'',poYearRows:[{...before.poYearRows[0],annualReturnYear:'2025-26',poAmount:200}]};
    const lead={_id:'lead1',leadCode:'ATPL-LEAD-1',assignments:[row],serviceSelections:[],markModified(){}};
    await controller.upsertPurchaseOrderApprovals({beforeLead:{assignments:[before]},lead,actor:{role:'admin',_id:'admin1',name:'Admin'},submittedAssignments:[row],modifyPoDetails:true});
    assert.equal(row.poApprovalStatus,'APPROVED');assert.equal(row.closedBy,'owner');assert.equal(row.closureRequestedBy,'owner');
    assert.equal(requests.length,1);assert.equal(requests[0][1].$set.approvalStatus,'APPROVED');
    assert.equal(requests[0][1].$set.poReview,null);assert.equal(requests[0][1].$push.poReviewHistory.stage,'FINALIZED');
    assert.equal(requests[0][1].$set.payload.poYearRows[0].poAmount,200);
    assert.ok(requests[0][0]['poReview.stage'].$nin.includes('MANAGEMENT_PENDING'));
  } finally {PendingApproval.findOne=originalFind;PendingApproval.findOneAndUpdate=originalCreate;User.find=originalUsers;}
});
const User = require('../src/models/User');
test('regular user PO edits still create a pending review even with modify flag', async () => {
  const originalCreate=PendingApproval.findOneAndUpdate, originalFind=PendingApproval.findOne, originalUpdate=PendingApproval.updateOne, originalUsers=User.find;
  const requests=[];
  PendingApproval.findOne=()=>({select(){return this;},lean:async()=>null});
  PendingApproval.findOneAndUpdate=async (...args)=>{requests.push(args);return {_id:'review1'};};
  PendingApproval.updateOne=async ()=>{throw Error('User must not directly approve');};
  User.find=()=>({select(){return this;},async lean(){return [];}});
  try {
    const row={...structuredClone(before),poYearRows:[{...before.poYearRows[0],poAmount:300}]};
    const lead={_id:'lead1',leadCode:'ATPL-LEAD-1',assignments:[row],serviceSelections:[],markModified(){}};
    await controller.upsertPurchaseOrderApprovals({beforeLead:{assignments:[before]},lead,actor:{role:'operation',name:'User'},modifyPoDetails:true});
    assert.equal(row.poApprovalStatus,'PENDING');
    assert.equal(requests.length,1);
    assert.equal(requests[0][1].$set.approvalStatus,'PENDING');
    assert.ok(requests[0][1].$set.payload.poSubmittedAt instanceof Date);
    assert.equal(requests[0][2].upsert,true);
  } finally {PendingApproval.findOne=originalFind;PendingApproval.findOneAndUpdate=originalCreate;PendingApproval.updateOne=originalUpdate;User.find=originalUsers;}
});

test('explicit regular-user Modify PO repairs a missing approval even when the saved row is already pending', async () => {
  const originalCreate=PendingApproval.findOneAndUpdate, originalFind=PendingApproval.findOne, originalUsers=User.find;
  const requests=[];
  PendingApproval.findOne=()=>({select(){return this;},lean:async()=>null});
  PendingApproval.findOneAndUpdate=async (...args)=>{requests.push(args);return {_id:'repaired-review'};};
  User.find=(query)=>({select(){return this;},async lean(){
    assert.deepEqual(query, {isActive:{$ne:false},email:{$exists:true,$ne:''}});
    return [];
  }});
  try {
    const pendingBefore={...structuredClone(before),poApprovalStatus:'PENDING'};
    const row=structuredClone(pendingBefore);
    const lead={_id:'lead1',leadCode:'ATPL-LEAD-1',assignments:[row],serviceSelections:[],markModified(){}};
    await controller.upsertPurchaseOrderApprovals({beforeLead:{assignments:[pendingBefore]},lead,actor:{role:'operation',name:'User'},modifyPoDetails:true});
    assert.equal(row.poApprovalStatus,'PENDING');
    assert.equal(requests.length,1);
    assert.equal(requests[0][1].$set.approvalStatus,'PENDING');
  } finally {PendingApproval.findOne=originalFind;PendingApproval.findOneAndUpdate=originalCreate;User.find=originalUsers;}
});
