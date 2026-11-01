const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  COMMUNICATION_MODE_GROUPS,
  canonicalCommunicationMode,
  communicationModeParent,
  normalizeCommunicationSelection
} = require('../src/utils/communicationModes');

const expected = {
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
};

test('communication hierarchy contains the approved parent and sub-category list', () => {
  assert.deepEqual(COMMUNICATION_MODE_GROUPS, expected);
  assert.equal(Object.values(COMMUNICATION_MODE_GROUPS).flat().length, 61);
});

test('legacy open-lead values resolve to their new parents without losing the sub-category', () => {
  const cases = [
    ['TeleCalling', 'Direct Marketing', 'TeleCalling'],
    ['Tele Calling', 'Direct Marketing', 'TeleCalling'],
    ['Referral', 'Reference & Referral', 'Referral'],
    ['Physical Visit', 'Business Development', 'Physical Visit'],
    ['Campaign', 'Direct Marketing', 'Campaign'],
    ['Existing Client', 'Reference & Referral', 'Existing Client'],
    ['Web Database', 'Digital Marketing', 'Web Database'],
    ['Webinar', 'Industry Events', 'Webinar'],
    ['Seminar', 'Industry Events', 'Seminar'],
    ['Exhibition', 'Industry Events', 'Exhibition'],
    ['Associate Reference', 'Reference & Referral', 'Associate Reference'],
    ['Government', 'Tender & Procurement', 'Government']
  ];
  cases.forEach(([oldValue, parent, subCategory]) => {
    assert.equal(canonicalCommunicationMode(oldValue), subCategory);
    assert.equal(communicationModeParent(oldValue), parent);
    assert.deepEqual(normalizeCommunicationSelection({ communicationMode: oldValue }), {
      communicationMode: subCategory,
      communicationModeParent: parent
    });
  });
});

test('unknown historical values remain intact for manual reclassification', () => {
  assert.deepEqual(normalizeCommunicationSelection({ communicationMode: 'Local Chamber Contact' }), {
    communicationMode: 'Local Chamber Contact',
    communicationModeParent: ''
  });
});

test('lead UI uses dependent parent and sub-category selectors and stores the parent', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/LeadGeneration.jsx'), 'utf8');
  const model = fs.readFileSync(path.join(__dirname, '../src/models/Lead.js'), 'utf8');
  assert.match(page, /Parent Communication Mode/);
  assert.match(page, /Select parent first/);
  assert.match(page, /COMMUNICATION_MODE_GROUPS\[resolvedCommunicationParent\]/);
  assert.match(page, /hydrateCommunicationMode\(item\)/);
  assert.match(page, /Legacy \/ Unmapped/);
  assert.match(model, /communicationModeParent/);
});
