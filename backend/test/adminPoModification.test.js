const test = require('node:test');
const assert = require('node:assert/strict');
const controller = require('../src/controllers/leadController')._test;
const PendingApproval = require('../src/models/PendingApproval');
const before = { assignedServiceId: 's1', poStatus: 'received', poApprovalStatus: 'APPROVED', closedBy: 'owner', closedByText: 'Owner', closedAt: '2026-10-01', closureRequestedBy: 'owner', poYearRows: [{ poNumber: 'PO1', poDate: '2026-10-01', poAmount: 100, poFileUrl: 'https://example.com/proof.pdf' }] };

test('only authenticated Admin/Super Admin edits of saved POs bypass review', () => {
  for (const role of ['admin', 'superadmin']) assert.equal(controller.canDirectlyApprovePoEdit({role}, true, before), true);
  for (const role of ['operation', 'manager', 'sales', 'compliance', 'accounts']) assert.equal(controller.canDirectlyApprovePoEdit({role}, true, before), false);
  assert.equal(controller.canDirectlyApprovePoEdit({role:'admin'}, false, before), false);
  assert.equal(controller.canDirectlyApprovePoEdit({role:'admin'}, true, {...before,poYearRows:[]}), false);
  assert.equal(controller.canDirectlyApprovePoEdit({role:'admin'}, true, {...before,poStatus:'provisional'}), false);
  assert.equal(controller.isAssignmentOnlyLeadUpdate({assignments:[before],modifyPoDetails:true}),true);
});

test('admin edit updates existing review snapshot without creating a request and preserves closure credit', async () => {
  const originalUpdate = PendingApproval.updateOne;
  const originalCreate = PendingApproval.findOneAndUpdate;
  const updates=[];
  PendingApproval.updateOne=async (...args)=>{updates.push(args);return {matchedCount:1};};
  PendingApproval.findOneAndUpdate=async ()=>{throw Error('Must not create or resubmit approval');};
  try {
    const row={...structuredClone(before),poApprovalStatus:'PENDING',closedBy:'',poYearRows:[{...before.poYearRows[0],annualReturnYear:'2025-26',poAmount:200}]};
    const lead={_id:'lead1',leadCode:'ATPL-LEAD-1',assignments:[row],serviceSelections:[],markModified(){}};
    await controller.upsertPurchaseOrderApprovals({beforeLead:{assignments:[before]},lead,actor:{role:'admin',_id:'admin1',name:'Admin'},submittedAssignments:[row],modifyPoDetails:true});
    assert.equal(row.poApprovalStatus,'APPROVED');
    assert.equal(row.closedBy,'owner');
    assert.equal(row.closedAt,'2026-10-01');
    assert.equal(updates.length,1);
    assert.equal(updates[0][1].$set.approvalStatus,'APPROVED');
    assert.equal(updates[0][1].$set['payload.poYearRows'][0].annualReturnYear,'2025-26');
    assert.equal(updates[0][1].$set['payload.poYearRows'][0].poAmount,200);
    assert.equal(updates[0][2],undefined);
  } finally { PendingApproval.updateOne=originalUpdate;PendingApproval.findOneAndUpdate=originalCreate; }
});
const User = require('../src/models/User');
test('regular user PO edits still create a pending review even with modify flag', async () => {
  const originalCreate=PendingApproval.findOneAndUpdate, originalUpdate=PendingApproval.updateOne, originalUsers=User.find;
  const requests=[];
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
    assert.equal(requests[0][2].upsert,true);
  } finally {PendingApproval.findOneAndUpdate=originalCreate;PendingApproval.updateOne=originalUpdate;User.find=originalUsers;}
});
