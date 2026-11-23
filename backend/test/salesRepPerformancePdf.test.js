const test = require('node:test');
const assert = require('node:assert/strict');

test('Summary Dashboard PDF includes lead summaries and Sales Rep breakdown columns', async () => {
  const {
    buildSalesDashboardPdfSummary,
    salesRepPerformancePdfHeaders
  } = await import('../../frontend/src/utils/salesRepPerformancePdf.mjs');

  assert.deepEqual(buildSalesDashboardPdfSummary({
    hotOpen: 12,
    hotClosed: 4,
    hotExpectedRevenuePaise: 125000,
    hotQuotationValuePaise: 95000,
    hotPoValuePaise: 72500,
    coldOpen: 8,
    coldExpectedRevenuePaise: 45000
  }), {
    hot: [
      ['Lead Open', '12'],
      ['Expected Revenue', 'INR 1,250.00'],
      ['Open Quotation Value', 'INR 950.00'],
      ['Lead Closed', '4'],
      ['PO Value', 'INR 725.00']
    ],
    cold: [
      ['Lead Open', '8'],
      ['Expected Revenue', 'INR 450.00']
    ]
  });
  assert.equal(salesRepPerformancePdfHeaders.includes('Major Service Interest'), true);
  assert.equal(salesRepPerformancePdfHeaders.includes('Traffic Source (Top 3)'), true);
});
