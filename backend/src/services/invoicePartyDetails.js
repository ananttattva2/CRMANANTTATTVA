const validGst = value => /^\d{2}[A-Z0-9]{13}$/.test(String(value || '').trim().toUpperCase());
function invoicePartyDetails(details = {}, client = {}, lead = {}) {
  details = details && typeof details === 'object' ? details : {};
  const data = client.data || {}, basic = data.basic || {}, compliance = data.compliance || {}, snapshot = data.selectedLeadSnapshot || {};
  const candidates = [details.gstNumber, details.gstin, details.gst, basic.gstNumber, basic.gstin, basic.gst, compliance.gst, compliance.gstin, snapshot.gstNumber, snapshot.gstin, lead.gstNumber, lead.gstin, lead.gst];
  return { ...details, gstNumber: String(candidates.find(validGst) || '').trim().toUpperCase() };
}
module.exports = { validGst, invoicePartyDetails };
