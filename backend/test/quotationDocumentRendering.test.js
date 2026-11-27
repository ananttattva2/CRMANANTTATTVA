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

test('EPR Credit fixed terms are exposed only when the quotation contains an EPR Credit item', async () => {
  const shared = await template();
  const eprQuote = { items: [{ businessCategory: 'EPR Credit', serviceCategory: 'EPR - Plastic Waste', servicesOffered: 'Category 1 - EOL' }] };
  const consultancyQuote = { items: [{ businessCategory: 'EPR Consultancy', serviceCategory: 'EPR - Plastic Waste', servicesOffered: 'Registration' }] };
  const mixedQuote = { items: [
    { businessCategory: 'EPR Consultancy', serviceCategory: 'EPR - Plastic Waste', servicesOffered: 'Registration' },
    { businessCategory: 'EPR Credit', serviceCategory: 'EPR - Plastic Waste', servicesOffered: 'Category 1 - Recycling' }
  ] };
  assert.equal(shared.quotationHasEprCredit(eprQuote), true);
  assert.equal(shared.quotationEprCreditFixedTerms(eprQuote).length, shared.EPR_CREDIT_FIXED_TERMS.length);
  assert.equal(shared.quotationHasEprCredit(consultancyQuote), false);
  assert.deepEqual(shared.quotationEprCreditFixedTerms(consultancyQuote), []);
  assert.equal(shared.quotationHasEprCredit(mixedQuote), true);
  assert.equal(shared.quotationEprCreditFixedTerms(mixedQuote).length, shared.EPR_CREDIT_FIXED_TERMS.length);
});

test('the canonical document lists the user-selected payment term first, then the frozen EPR Credit terms', async () => {
  const shared = await template();
  const eprQuote = {
    ...quote,
    items: [{ businessCategory: 'EPR Credit', serviceCategory: 'EPR - Plastic Waste', servicesOffered: 'Category 1 - EOL', unit: 1, basicAmount: 1.3, serviceStartDate: '2026-11-20', serviceEndDate: '2026-11-20' }],
    terms: ['100% after completion of work'],
    paymentTerm: '100% after completion of work'
  };
  const html = shared.buildQuotationPrintHtml(eprQuote);
  const fixedTerms = shared.EPR_CREDIT_FIXED_TERMS;
  // Every fixed term text must be present in the rendered document.
  fixedTerms.forEach((term) => assert.match(html, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
  // The first numbered term must be the user-selected payment term.
  assert.match(html, /1\.\s*100% after completion of work/);
  // The first fixed EPR Credit term follows as the second numbered term.
  assert.match(html, new RegExp(`2\\. ${fixedTerms[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  // The Terms & Conditions label is explicitly bold.
  assert.match(html, /<p class="label" style="font-weight: 900;">Terms &amp; Conditions:<\/p>/);
});

test('the canonical document omits EPR Credit fixed terms for non-EPR-Credit quotations', async () => {
  const shared = await template();
  const html = shared.buildQuotationPrintHtml(quote);
  const fixedTerm = shared.EPR_CREDIT_FIXED_TERMS[0];
  assert.doesNotMatch(html, new RegExp(fixedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('the client email lists the selected payment term first, then the EPR Credit terms below the calculation table', async () => {
  const eprQuote = {
    ...quote,
    items: [{ businessCategory: 'EPR Credit', serviceCategory: 'EPR - Plastic Waste', servicesOffered: 'Category 1 - EOL', unit: 1, basicAmount: 1.3, serviceStartDate: '2026-11-20', serviceEndDate: '2026-11-20' }],
    terms: ['100% after completion of work'],
    paymentTerm: '100% after completion of work'
  };
  const result = await delivery.clientEmailContent('Quotation', 'Please find the quotation attached.', eprQuote);
  assert.match(result.html, /Terms &amp; Conditions/);
  const shared = await template();
  shared.EPR_CREDIT_FIXED_TERMS.forEach((term) => assert.match(result.html, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
  // The selected payment term must appear in the email terms list.
  assert.match(result.html, /<li[^>]*>100% after completion of work<\/li>/);
});

test('the client email omits the EPR Credit terms block for non-EPR-Credit quotations', async () => {
  const result = await delivery.clientEmailContent('Quotation', 'Please find the quotation attached.', quote);
  assert.doesNotMatch(result.html, /Terms &amp; Conditions/);
});
