const test = require('node:test');
const assert = require('node:assert/strict');
const { salesConsentComparison } = require('../src/services/salesConsentComparison');
const { normalizePurchaseRows } = require('../src/services/purchaseDataService');

const portal = { importStatus: 'Imported', totalQuantity: 100 };
const product = (productName, quantity, uom = 'kg') => ({ productName, quantity, uom, period: 'month' });
const client = (products, piboCategory = 'Producer') => ({ data: {
  basic: { piboCategory },
  cte: { plantWiseDetails: [{ plantName: 'Plant 1', ctoProductRows: products }] }
} });

test('Producer comparison retains each CTO product and uses the combined annual quantity for status', () => {
  const result = salesConsentComparison(client([product('Spoons', '6000'), product('Cups', '8', 'mt')]), portal);
  assert.deepEqual(result.rows.map(row => row.annualMt), [72, 96]);
  assert.equal(result.salesMt, 100);
  assert.equal(result.consentMt, 168);
  assert.equal(result.status, 'neutral');
  for (const [annualQty, status] of [[80, 'red'], [100, 'green'], [119, 'green'], [120, 'amber'], [139, 'amber'], [140, 'neutral']]) {
    const yearly = { ...product('Spoons', annualQty, 'mt'), period: 'year' };
    assert.equal(salesConsentComparison(client([yearly]), portal).status, status);
  }
  assert.equal(salesConsentComparison(client([product('Spoons', '6000')], 'Importer'), portal), null);
});

test('unconvertible piece quantities stay visible without assigning an exceedance', () => {
  const result = salesConsentComparison(client([product('Spoons', '6000'), product('Cups', '2000', 'NOS')]), portal);
  assert.equal(result.rows[1].annualMt, null);
  assert.equal(result.consentMt, 72);
  assert.equal(result.status, 'incomplete');
});

test('Sales Portal total prefers Total Plastic Qty (Tons) when another quantity column is present', () => {
  const imported = normalizePurchaseRows([{
    'Financial Year': '2025-26', 'Name of Entity': 'Example', 'Registration Type': 'Unregistered',
    'Category of Plastic': 'CAT I', 'Plastic Material Type': 'PET', 'Total Invoice Value': 20,
    'Total Plastic Quantity': 999, 'Total Plastic Qty (Tons)': 100
  }], 'portal', '2025-26', 1, { salesPortal: true });
  assert.equal(imported.headerMap.portalQuantity, 'Total Plastic Qty (Tons)');
  assert.equal(imported.totalQuantity, 100);
});
