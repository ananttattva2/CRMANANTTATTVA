// GST is editable on the quotation and belongs to that saved document.
// Refresh lead-owned contact/address fields without replacing its GST.
export function mergeQuotationLeadDetails(savedDetails = {}, currentLeadDetails = {}) {
  return {
    ...currentLeadDetails,
    gstNumber: savedDetails.gstNumber ?? currentLeadDetails.gstNumber ?? ''
  };
}
