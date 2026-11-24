const COMMUNICATION_MODE_GROUPS = Object.freeze({
  'Digital Marketing': ['Web Database', 'Google Search', 'Google Ads / PPC', 'LinkedIn Ads', 'Facebook Ads', 'Instagram Ads', 'SEO / Organic Search', 'Social Media Campaign', 'Online Contact Form'],
  'Social Media': ['LinkedIn', 'Facebook', 'Instagram', 'YouTube', 'X (Twitter)', 'WhatsApp'],
  'Direct Marketing': ['TeleCalling', 'Cold Calling', 'Campaign', 'Bulk Email Marketing', 'WhatsApp Marketing', 'SMS Campaign'],
  'Reference & Referral': ['Existing Client', 'Employee Reference', 'Referral', 'Associate Reference', 'Consultant Reference', 'Industry Contact Reference', 'Vendor / Supplier Reference'],
  'Industry Events': ['Seminar', 'Webinar', 'Industry Conference', 'Exhibition', 'Business Networking Event', 'B2B Meeting', 'Industry Association Event'],
  'Business Development': ['Physical Visit', 'Corporate Meeting', 'Business Development Team', 'Existing Business Network', 'Channel Partner', 'Strategic Alliance', 'Market Research'],
  'Existing Client': ['Cross-Selling', 'Up-Selling', 'New Business Vertical', 'Group Company Reference', 'Renewal / Additional Services'],
  'Tender & Procurement': ['Government', 'Private Corporate Tender', 'GeM Portal', 'Vendor Registration', 'Procurement Portal', 'Direct Quotation Request'],
  'Online Business Platforms': ['IndiaMART', 'TradeIndia', 'Justdial', 'Sulekha', 'Other B2B Portals'],
  'Other Sources': ['Walk-in Enquiry', 'Market Intelligence', 'Other']
});

const LEGACY_MODE_ALIASES = Object.freeze({
  'tele calling': 'TeleCalling', telecalling: 'TeleCalling', 'cold call': 'Cold Calling',
  'google ads': 'Google Ads / PPC', ppc: 'Google Ads / PPC', twitter: 'X (Twitter)',
  'x/twitter': 'X (Twitter)', indiamart: 'IndiaMART', tradeindia: 'TradeIndia',
  'walk in enquiry': 'Walk-in Enquiry', 'walk-in inquiry': 'Walk-in Enquiry'
});

const normalizeKey = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

function canonicalCommunicationMode(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (LEGACY_MODE_ALIASES[normalizeKey(raw)]) return LEGACY_MODE_ALIASES[normalizeKey(raw)];
  for (const modes of Object.values(COMMUNICATION_MODE_GROUPS)) {
    const match = modes.find((mode) => normalizeKey(mode) === normalizeKey(raw));
    if (match) return match;
  }
  return raw;
}

function communicationModeParent(value) {
  const canonical = canonicalCommunicationMode(value);
  return Object.keys(COMMUNICATION_MODE_GROUPS).find((parent) =>
    COMMUNICATION_MODE_GROUPS[parent].includes(canonical)
  ) || '';
}

function normalizeCommunicationSelection(data = {}) {
  const communicationMode = canonicalCommunicationMode(data.communicationMode);
  const inferredParent = communicationModeParent(communicationMode);
  return {
    ...data,
    communicationMode,
    communicationModeParent: inferredParent || String(data.communicationModeParent || '').trim()
  };
}

module.exports = {
  COMMUNICATION_MODE_GROUPS,
  canonicalCommunicationMode,
  communicationModeParent,
  normalizeCommunicationSelection
};
