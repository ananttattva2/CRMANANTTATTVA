function directQuotationApproval(actor = {}, quotation = {}) {
  return {
    status: 'submitted',
    approvalDecision: {},
    // Saving alone does not request approval. The quotation owner must first
    // enter the price-approval details using the Admin Approval action.
    managementApproval: {}
  };
}
module.exports = { directQuotationApproval };
