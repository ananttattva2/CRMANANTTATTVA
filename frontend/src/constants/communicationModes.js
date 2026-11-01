export const COMMUNICATION_MODE_GROUPS = Object.freeze({
  'Digital Marketing': Object.freeze([
    'Web Database', 'Google Search', 'Google Ads / PPC', 'LinkedIn Ads',
    'Facebook Ads', 'Instagram Ads', 'SEO / Organic Search',
    'Social Media Campaign', 'Online Contact Form'
  ]),
  'Social Media': Object.freeze([
    'LinkedIn', 'Facebook', 'Instagram', 'YouTube', 'X (Twitter)', 'WhatsApp'
  ]),
  'Direct Marketing': Object.freeze([
    'TeleCalling', 'Cold Calling', 'Campaign', 'Bulk Email Marketing',
    'WhatsApp Marketing', 'SMS Campaign'
  ]),
  'Reference & Referral': Object.freeze([
    'Existing Client', 'Employee Reference', 'Referral', 'Associate Reference',
    'Consultant Reference', 'Industry Contact Reference',
    'Vendor / Supplier Reference'
  ]),
  'Industry Events': Object.freeze([
    'Seminar', 'Webinar', 'Industry Conference', 'Exhibition',
    'Business Networking Event', 'B2B Meeting', 'Industry Association Event'
  ]),
  'Business Development': Object.freeze([
    'Physical Visit', 'Corporate Meeting', 'Business Development Team',
    'Existing Business Network', 'Channel Partner', 'Strategic Alliance',
    'Market Research'
  ]),
  'Existing Client': Object.freeze([
    'Cross-Selling', 'Up-Selling', 'New Business Vertical',
    'Group Company Reference', 'Renewal / Additional Services'
  ]),
  'Tender & Procurement': Object.freeze([
    'Government', 'Private Corporate Tender', 'GeM Portal',
    'Vendor Registration', 'Procurement Portal', 'Direct Quotation Request'
  ]),
  'Online Business Platforms': Object.freeze([
    'IndiaMART', 'TradeIndia', 'Justdial', 'Sulekha', 'Other B2B Portals'
  ]),
  'Other Sources': Object.freeze([
    'Walk-in Enquiry', 'Market Intelligence', 'Other'
  ])
});

export const COMMUNICATION_MODE_PARENTS = Object.freeze(Object.keys(COMMUNICATION_MODE_GROUPS));

const LEGACY_MODE_ALIASES = Object.freeze({
  'tele calling': 'TeleCalling',
  telecalling: 'TeleCalling',
  'cold call': 'Cold Calling',
  'google ads': 'Google Ads / PPC',
  ppc: 'Google Ads / PPC',
  twitter: 'X (Twitter)',
  'x/twitter': 'X (Twitter)',
  indiamart: 'IndiaMART',
  tradeindia: 'TradeIndia',
  'walk in enquiry': 'Walk-in Enquiry',
  'walk-in inquiry': 'Walk-in Enquiry'
});

function key(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function canonicalCommunicationMode(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const alias = LEGACY_MODE_ALIASES[key(raw)];
  if (alias) return alias;
  for (const modes of Object.values(COMMUNICATION_MODE_GROUPS)) {
    const match = modes.find((mode) => key(mode) === key(raw));
    if (match) return match;
  }
  return raw;
}

export function communicationModeParent(value) {
  const canonical = canonicalCommunicationMode(value);
  return COMMUNICATION_MODE_PARENTS.find((parent) =>
    COMMUNICATION_MODE_GROUPS[parent].includes(canonical)
  ) || '';
}

export function hydrateCommunicationMode(lead = {}) {
  const communicationMode = canonicalCommunicationMode(lead.communicationMode);
  const inferredParent = communicationModeParent(communicationMode);
  return {
    ...lead,
    communicationMode,
    communicationModeParent: inferredParent || String(lead.communicationModeParent || '').trim() || (communicationMode ? 'Legacy / Unmapped' : '')
  };
}
