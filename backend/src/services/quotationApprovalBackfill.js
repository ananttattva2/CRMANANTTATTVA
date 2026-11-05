const Quotation = require('../models/Quotation');

const OPEN_QUOTATION_STATUSES = ['draft', 'submitted', 'sent', 'admin_approved'];

/**
 * Older quotations were saved before every quotation was routed directly to
 * Super Admin. Make those open records discoverable by the same source-of-truth
 * query as newly created quotations. The filter makes this safe and idempotent:
 * approved/rejected quotations and existing approval requests are untouched.
 */
async function backfillDirectSuperAdminQuotationApprovals({ now = new Date() } = {}) {
  const result = await Quotation.updateMany(
    {
      status: { $in: OPEN_QUOTATION_STATUSES },
      $or: [
        { 'managementApproval.status': { $exists: false } },
        { 'managementApproval.status': '' },
        { managementApproval: null }
      ]
    },
    {
      $set: {
        'managementApproval.status': 'PENDING',
        'managementApproval.approverName': 'Super Admin Queue',
        'managementApproval.approverRole': 'superadmin',
        'managementApproval.requestedAt': now
      }
    }
  );

  return {
    matched: Number(result?.matchedCount || 0),
    updated: Number(result?.modifiedCount || 0)
  };
}

module.exports = {
  OPEN_QUOTATION_STATUSES,
  backfillDirectSuperAdminQuotationApprovals
};
