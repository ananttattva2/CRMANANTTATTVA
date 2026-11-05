function directQuotationApproval(actor = {}, quotation = {}) {
  const requestedAt = new Date();
  return {
    status: 'submitted',
    approvalDecision: {},
    // Every saved quotation immediately enters the final Super Admin queue.
    // Admin price approval is optional and may be recorded later without
    // blocking or replacing this final approval request.
    managementApproval: {
      status: 'PENDING',
      approverName: 'Super Admin Queue',
      approverRole: 'superadmin',
      amount: Number(quotation.grandTotal || 0),
      requestedBy: actor?._id,
      requestedByName: actor?.name || actor?.email || 'CRM User',
      requestedAt
    }
  };
}
module.exports = { directQuotationApproval };
