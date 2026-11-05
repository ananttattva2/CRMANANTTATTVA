const { test } = require('node:test');
const assert = require('node:assert/strict');

const template = () => import('../../frontend/src/utils/quotationDocument.mjs');

test('quotation preview and PDF template display Not Applicable variants as a dash', async () => {
  const shared = await template();
  for (const value of ['Not Applicable', 'NOT APPLICABLE', 'N/A', 'NA', ' n.a. ']) {
    assert.equal(shared.quotationDisplayValue(value), '-');
  }

  const html = shared.buildQuotationPrintHtml({
    quotationNumber: 'AT-TEST-NA',
    leadDetails: { companyName: 'Example Client', contactPerson: 'Client Representative', city: 'N/A' },
    items: [{
      businessCategory: 'Other Consultancy',
      serviceCategory: 'Consent Compliance Services',
      applicantType: 'NOT APPLICABLE',
      servicesOffered: 'Environment Statement Form V',
      unit: 1,
      unitName: 'Not Applicable',
      basicAmount: 15000
    }]
  });

  assert.doesNotMatch(html, /not\s*applicable/i);
  assert.doesNotMatch(html, />N\/?A</i);
  assert.match(html, /<td>-<\/td>/);
});
