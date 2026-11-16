const { test } = require('node:test');
const assert = require('node:assert/strict');
test('compact approval snapshots load the saved quotation before preview or revision', async () => {
  const { loadFullQuotation } = await import('../../frontend/src/utils/quotationDetail.mjs');
  const { buildQuotationPrintHtml } = await import('../../frontend/src/utils/quotationDocument.mjs');
  const id = '507f1f77bcf86cd799439012';
  const full = { _id: id, leadDetails: { companyName: 'SAVED CLIENT', addressLine1: 'Saved Address', state: 'Gujarat', city: 'Ahmedabad', pinCode: '380001', gstNumber: '24ABCDE1234F1Z5' }, items: [{ businessCategory: 'EPR Consultancy', serviceCategory: 'EPR - Plastic Waste', servicesOffered: 'Annual Return Filing', serviceStartDate: '2026-04-01', serviceEndDate: '2027-03-31', unitName: 'Main Plant', unit: '1', basicAmount: 100000 }] };
  const compact = { _id: '507f1f77bcf86cd799439099', quotationId: id, approvalRecordId: 'approval-id', leadDetails: { companyName: 'SAVED CLIENT' }, items: [{ basicAmount: 100000 }] };
  const row = await loadFullQuotation(compact, async sourceId => { assert.equal(sourceId, id); return { data: { quotation: full } }; });
  assert.equal(row.approvalRecordId, 'approval-id');
  const html = buildQuotationPrintHtml(row);
  for (const value of ['Saved Address', 'Gujarat', 'Ahmedabad', '380001', '24ABCDE1234F1Z5', 'EPR Consultancy', 'Annual Return Filing', 'Main Plant']) assert.ok(html.includes(value), value);
  assert.match(html, /td\.amount[^}]*white-space: nowrap/);
  await assert.rejects(loadFullQuotation(compact, async () => ({ data: {} })), /unavailable/);
  await assert.rejects(loadFullQuotation(compact, async () => { throw new Error('Not accessible'); }), /Not accessible/);
});

test('quotation amount stays on one line at the actual preview page width', async () => {
  const { buildQuotationPrintHtml } = await import('../../frontend/src/utils/quotationDocument.mjs');
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ headless: true, ...(process.env.QUOTATION_CHROME_PATH ? { executablePath: process.env.QUOTATION_CHROME_PATH } : {}), args: process.platform === 'linux' ? ['--no-sandbox'] : [] });
  try {
    const page = await browser.newPage();
    await page.setContent(buildQuotationPrintHtml({ items: [{ serviceCategory: 'EPR - Plastic Waste', piboCategory: 'Producer (Small & Micro)', basicAmount: 100000, unit: 1 }] }));
    const amount = await page.$eval('td.amount', cell => ({ width: cell.clientWidth, contentWidth: cell.scrollWidth, wrap: getComputedStyle(cell).whiteSpace, text: cell.textContent }));
    assert.equal(amount.wrap, 'nowrap');
    assert.ok(amount.contentWidth <= amount.width, JSON.stringify(amount));
    assert.ok(amount.text.includes('1,00,000.00'));
  } finally { await browser.close(); }
});
