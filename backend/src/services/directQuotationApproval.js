function directQuotationApproval(actor = {}, quotation = {}) {
  return {
    status: 'submitted',
    approvalDecision: {},
    managementApproval: {
      status: 'PENDING', amount: Number(quotation.grandTotal || 0),
      requestedBy: actor._id, requestedByName: actor.name || actor.email || 'CRM User',
      requestedAt: new Date()
    }
  };
}
module.exports = { directQuotationApproval };
