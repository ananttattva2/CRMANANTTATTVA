const test=require('node:test');const assert=require('node:assert/strict');
const {finalFinanceApproval,financeApprovedServices,servicesClientFilter}=require('../src/services/financeApprovedClients');
const query=rows=>({select(){return this;},lean:async()=>rows});
test('only a final Finance approval qualifies; Admin and legacy approved statuses do not',()=>{
 assert.equal(finalFinanceApproval({approvalStatus:'APPROVED',poReview:{stage:'FINALIZED',finalStatus:'APPROVED'}}),true);
 for(const row of [{approvalStatus:'APPROVED'},{approvalStatus:'PARTIALLY_APPROVED',poReview:{stage:'FINANCE_READY'}},{approvalStatus:'APPROVED',poReview:{stage:'FINALIZED',finalStatus:'REJECTED'}}])assert.equal(finalFinanceApproval(row),false);
});
test('Finance approval follows the exact service ID after rows are reordered and excludes sibling services',async()=>{
 const approval={approvalStatus:'APPROVED',poReview:{stage:'FINALIZED',finalStatus:'APPROVED'},payload:{leadId:'lead',assignedServiceId:'approved',assignmentIndex:0}};
 const lead={_id:'lead',leadCode:'LEAD',assignments:[{assignedServiceId:'pending',poApprovalStatus:'FINANCE_PENDING',poStatus:'received'},{assignedServiceId:'approved',poApprovalStatus:'APPROVED',poStatus:'received',closureRequestedBy:'sales'}],serviceSelections:[{assignedServiceId:'approved',servicesOffered:'Annual Return'}]};
 const rows=await financeApprovedServices({ApprovalModel:{find:()=>query([approval,approval])},LeadModel:{find:()=>query([lead])}});
 assert.equal(rows.length,1);assert.equal(rows[0].index,1);assert.equal(rows[0].serviceId,'approved');
 const filter=servicesClientFilter(rows);assert.equal(filter.$or.length,1);
 assert.ok(!JSON.stringify(filter).includes('pending'));
 assert.deepEqual(servicesClientFilter([]),{_id:{$in:[]}});
});

test('manager assignment blocks Finance-pending, forged and sibling approvals, including root assignment',()=>{
 const {managerAssignmentError}=require('../src/services/financeApprovedClients');
 const before={_id:'lead',assignments:[{assignedServiceId:'s1'}]};
 const next={assignments:[{assignedServiceId:'s1',assignedTo:'manager',poApprovalStatus:'APPROVED'}]};
 assert.ok(managerAssignmentError(before,next,[]));
 assert.ok(managerAssignmentError(before,next,[{lead:{_id:'lead'},serviceId:'sibling',index:0}]));
 assert.equal(managerAssignmentError(before,next,[{lead:{_id:'lead'},serviceId:'s1',index:0}]),'');
 assert.ok(managerAssignmentError(before,{assignedTo:'manager'},[]));
 assert.equal(managerAssignmentError({...before,assignments:[{assignedServiceId:'s1',assignedTo:'manager'}]},next,[]),'');
});
