const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const delivery = require('../src/services/quotationDelivery');
const template = () => import('../../frontend/src/utils/quotationDocument.mjs');
const quote = {
  status: 'admin_approved', quotationNumber: 'AT/26-27/489', createdAt: new Date('2026-11-04T08:00:00Z'),
  leadDetails: { companyName: 'Example Client Private Limited', contactPerson: 'Client Representative', gstNumber: '27ABCDE1234F1Z5' },
  items: [{ businessCategory: 'Plastic', serviceCategory: 'Plastic Waste', servicesOffered: 'Registration', piboParent: 'PIBO', piboCategory: 'Brand Owner', unit: 1, basicAmount: 15000, registrationYear: '2026-27', serviceStartDate: '2026-04-01', serviceEndDate: '2027-03-31' }],
  terms: ['50% advance, balance on completion.'],
  scopeOfWork: Array.from({ length: 33 }, (_, i) => `Scope item ${i + 1}: Review regulatory documentation.`)
};

test('email and download filenames use the saved client name with safe characters and a single PDF extension', async () => {
  const shared = await template();
  for (const [input, expected] of [
    [quote, 'Example Client Private Limited.pdf'],
    [{ companyName: '  Client Name.pdf  ' }, 'Client Name.pdf'],
    [{ leadDetails: { companyName: ' ' }, companyName: 'Fallback Client' }, 'Fallback Client.pdf'],
    [{ companyName: '../ACME: India / Mumbai' }, 'ACME India Mumbai.pdf'],
    [{ companyName: 'Éco भारत Limited' }, 'Éco भारत Limited.pdf'],
    [{}, 'Client Quotation.pdf']
  ]) {
    assert.equal(shared.quotationFilename(input), expected);
    assert.equal(await delivery.quotationFilename(input), expected);
  }
});

test('the canonical document retains orange tables, year mapping, terms, GST and escaped client data', async () => {
  const shared = await template();
  const html = shared.buildQuotationPrintHtml({ ...quote, leadDetails: { ...quote.leadDetails, companyName: '<Client & Company>' } });
  assert.match(html, /background: #f97316/);
  assert.match(html, /&lt;Client &amp; Company&gt;/);
  assert.match(html, /2026-27/);
  assert.match(html, /27ABCDE1234F1Z5/);
  assert.match(html, /50% advance/);
  assert.match(html, /Scope item 33/);
  assert.doesNotMatch(html, /<Client & Company>/);
});

test('screen and print paginate the same scope rows with a heading/footer on every designed sheet', async () => {
  const [{ default: puppeteer }, shared] = await Promise.all([import('puppeteer'), template()]);
  const browser = await puppeteer.launch({ headless: true, ...(process.env.QUOTATION_CHROME_PATH ? { executablePath: process.env.QUOTATION_CHROME_PATH } : {}), args: ['--disable-dev-shm-usage', ...(process.platform === 'linux' && (process.getuid?.() === 0 || process.env.GITHUB_ACTIONS === 'true') ? ['--no-sandbox'] : [])] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123 });
    const logoSource = `data:image/png;base64,${fs.readFileSync(path.resolve(__dirname, '../../frontend/public/ananttattva-logo.png')).toString('base64')}`;
    let previous;
    for (const media of ['screen', 'print']) {
      await page.emulateMediaType(media);
      await page.setContent(shared.buildQuotationPrintHtml(quote, { logoSource }));
      await page.evaluate(shared.paginateQuotationDocument);
      const rows = await page.evaluate(() => [...document.querySelectorAll('main.scope-page')].map(sheet => ({
        heading: sheet.querySelector('.scope-page-title').textContent,
        footer: sheet.querySelector('.footer').textContent,
        numbers: [...sheet.querySelectorAll('.scope-number')].map(item => item.textContent),
        height: sheet.scrollHeight
      })));
      assert.deepEqual(rows.map(row => row.numbers.length), [22, 11]);
      assert.equal(rows.flatMap(row => row.numbers).join(','), Array.from({ length: 33 }, (_, i) => `${i + 1}.`).join(','));
      rows.forEach(row => { assert.equal(row.heading, 'Scope of Work'); assert.match(row.footer, /computer-generated quotation/); assert.ok(row.height <= 1048); });
      if (previous) assert.deepEqual(rows, previous);
      previous = rows;
      const dateCellFits = await page.evaluate(() => { const cell = document.querySelector('td.date-range'); return cell.scrollWidth <= cell.clientWidth + 1; });
      assert.equal(dateCellFits, true);
    }
  } finally { await browser.close(); }
});

test('the actual attached/downloaded PDF preserves one quote page and both scope continuation sheets', async () => {
  const bytes = await delivery.createApprovedQuotationPdf(quote);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 3);
  pdf.getPages().forEach(page => { assert.ok(Math.abs(page.getWidth() - 595.28) < 1); assert.ok(Math.abs(page.getHeight() - 841.89) < 1); });
});
