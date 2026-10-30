const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');

test('quotation preview and PDF use the linked lead owner instead of a hard-coded sender', () => {
  assert.match(source, /function quotationOwnerName\(quotation = \{\}\)/);
  assert.match(source, /quotation\.fromName/);
  assert.match(source, /quotation\.leadGeneratedBy/);
  assert.doesNotMatch(source, /<p>Krunal Goda<\/p>/);
});

test('lead selection asks for and persists quotation From and Prepared By names', () => {
  const model = fs.readFileSync(path.resolve(__dirname, '../src/models/Quotation.js'), 'utf8');
  const controller = fs.readFileSync(path.resolve(__dirname, '../src/controllers/quotationController.js'), 'utf8');
  assert.match(source, /function requestLeadSelection\(leadId\)/);
  assert.match(source, /From Name and Prepared By Name are required/);
  assert.match(source, /These names will appear in the quotation preview and downloaded PDF/);
  assert.match(source, /preparedByName: String\(identity\?\.preparedByName/);
  assert.match(source, /applyToCurrent: true/);
  assert.match(source, /leadIdentityPrompt\.applyToCurrent/);
  assert.match(model, /fromName: \{ type: String/);
  assert.match(model, /preparedByName: \{ type: String/);
  assert.match(controller, /fromName: cleanString\(body\.fromName\)/);
  assert.match(controller, /preparedByName: cleanString\(body\.preparedByName\)/);
});

test('quotation AT/26-27/325 uses its requested view-only sender and preparer names', () => {
  assert.match(source, /quotation\.quotationNumber.*AT\/26-27\/325.*return 'ANAND PADHYA'/);
  assert.match(source, /function quotationPreparedByName\(quotation = \{\}\)/);
  assert.match(source, /quotation\.quotationNumber.*AT\/26-27\/325.*return 'SAURABH BHAT'/);
  assert.equal((source.match(/quotationPreparedByName\(quotation\)/g) || []).length, 2);
});

test('quotation valid-until dates use the same display formatter as quotation dates', () => {
  assert.match(source, /Quotation Valid Until: \{formatDisplayDate\(quotation\.validUntil\)\}/);
  assert.match(source, /Quotation Valid Until: \$\{escapeHtml\(formatDisplayDate\(quotation\.validUntil\)\)\}/);
});

test('new and revised quotations refresh lead-owned details from the latest lead record', () => {
  const controller = require('../src/controllers/quotationController');
  const refreshed = controller._test.mergeCurrentLeadDetails({
    leadId: 'lead-1',
    leadCode: 'ATPL-LEAD-0143',
    companyName: 'RAMSONS PERFUMES PRIVATE LIMITED',
    leadDetails: {
      companyName: 'RAMSONS PERFUMES PRIVATE LIMITED',
      addressLine1: 'Old address',
      city: 'Old city',
      gstNumber: '27AAZCA6657R1ZB'
    }
  }, {
    _id: 'lead-1',
    leadCode: 'ATPL-LEAD-0143',
    company: 'RAMSONS PERFUMES PRIVATE LIMITED',
    addressLine1: 'Updated address',
    city: 'Mumbai'
  });

  assert.equal(refreshed.leadDetails.addressLine1, 'Updated address');
  assert.equal(refreshed.leadDetails.city, 'Mumbai');
  assert.equal(refreshed.leadDetails.gstNumber, '27AAZCA6657R1ZB');
  assert.match(source, /leadDetails: latestLead\s*\? mergeQuotationLeadDetails\(row\.leadDetails, mapLeadToDetails\(latestLead\)\)/);
});
