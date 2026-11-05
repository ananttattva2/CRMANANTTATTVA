const test = require('node:test');
const assert = require('node:assert/strict');
const Quotation = require('../src/models/Quotation');
const { backfillDirectSuperAdminQuotationApprovals } = require('../src/services/quotationApprovalBackfill');

test('legacy quotation backfill only targets open records without an approval request', async () => {
  const originalUpdateMany = Quotation.updateMany;
  let capturedFilter;
  let capturedUpdate;
  Quotation.updateMany = async (filter, update) => {
    capturedFilter = filter;
    capturedUpdate = update;
    return { matchedCount: 3, modifiedCount: 3 };
  };

  try {
    const now = new Date('2026-11-05T08:00:00.000Z');
    const result = await backfillDirectSuperAdminQuotationApprovals({ now });
    assert.deepEqual(capturedFilter.status.$in, ['draft', 'submitted', 'sent', 'admin_approved']);
    assert.equal(capturedUpdate.$set['managementApproval.status'], 'PENDING');
    assert.equal(capturedUpdate.$set['managementApproval.approverRole'], 'superadmin');
    assert.equal(capturedUpdate.$set['managementApproval.requestedAt'], now);
    assert.deepEqual(result, { matched: 3, updated: 3 });
  } finally {
    Quotation.updateMany = originalUpdateMany;
  }
});
