// Applicant type, service and financial year do not change a company's identity.
function assignedCompanyKey(client = {}) {
  const data = client.data || {};
  const lead = client.selectedLead || data.selectedLeadSnapshot || {};
  const name = lead.company || lead.companyName || data.basic?.clientLegalName || data.importMeta?.companyName || data.basic?.tradeName;
  const normalized = String(name || '').normalize('NFKC').toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]/gu, '');
  return normalized && !['untitledclient', 'unnamedclient'].includes(normalized) ? `company:${normalized}` : `client:${String(client._id || client.id || '')}`;
}
module.exports = { assignedCompanyKey };
