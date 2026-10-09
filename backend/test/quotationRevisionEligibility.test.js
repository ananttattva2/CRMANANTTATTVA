const test = require('node:test');
const assert = require('node:assert/strict');
test('admin-approved quotations can be revised before final management approval', async () => {
  const {canReviseQuotation}=await import('../../frontend/src/utils/quotationRevision.mjs');
  for(const row of [{status:'ADMIN_APPROVED',managementApproval:{status:'PENDING'}},{status:'approved'},{status:'rejected'},{status:'submitted',managementApproval:{adminApprovalStatus:'APPROVED'}},{status:'submitted',approvalDecision:{approvalKind:'ADMIN',status:'APPROVED'}}]) assert.equal(canReviseQuotation(row),true);
  for(const row of [{status:'draft'},{status:'submitted',managementApproval:{status:'PENDING'}},{approvalStatus:'not approved'},{approvalDecision:{approvalKind:'ADMIN',status:'PENDING'}}]) assert.equal(canReviseQuotation(row),false);
});
