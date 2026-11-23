const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('../../frontend/node_modules/esbuild');

test('Proforma Invoice view can be reopened and both download actions save a PDF', async () => {
  const frontendRoot = path.resolve(__dirname, '../../frontend');
  const stampData = `data:image/png;base64,${fs.readFileSync(path.join(frontendRoot, 'src/assets/proforma-authorized-stamp.png'), 'base64')}`;
  const invoice = {
    _id: 'pi-test',
    proformaNumber: 'PI/26-27/002',
    quotationNumber: 'AT/26-27/525',
    poNumber: 'PO-TEST',
    companyName: 'Test Buyer Pvt. Ltd.',
    invoiceDate: '2026-11-21',
    status: 'issued',
    paymentPercentage: 100,
    leadDetails: { companyName: 'Test Buyer Pvt. Ltd.', addressLine1: 'Test Street', state: 'Maharashtra', gstNumber: '27ABCDE1234F1Z5' },
    items: [{ serviceCategory: 'EPR - Plastic Waste', servicesOffered: 'New Registration', servicesForYear: '2026-27', basicAmount: 14150, unit: '1' }]
  };
  const bundle = await esbuild.build({
    stdin: {
      resolveDir: frontendRoot,
      loader: 'jsx',
      contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import { MemoryRouter } from 'react-router-dom'; import Page from './src/pages/ProformaInvoices.jsx'; createRoot(document.getElementById('root')).render(<MemoryRouter><Page /></MemoryRouter>);`
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    plugins: [{
      name: 'proforma-invoice-test-mocks',
      setup(build) {
        build.onResolve({ filter: /DashboardShell$/ }, () => ({ path: 'shell', namespace: 'proforma-test' }));
        build.onResolve({ filter: /services\/api$/ }, () => ({ path: 'api', namespace: 'proforma-test' }));
        build.onResolve({ filter: /dataExport\.mjs$/ }, () => ({ path: 'data-export', namespace: 'proforma-test' }));
        build.onResolve({ filter: /proforma-authorized-stamp\.png\?inline$/ }, () => ({ path: 'stamp', namespace: 'proforma-test' }));
        build.onLoad({ filter: /.*/, namespace: 'proforma-test' }, args => {
          if (args.path === 'shell') return { loader: 'jsx', contents: 'export default function Shell({children}) { return children }' };
          if (args.path === 'stamp') return { loader: 'js', contents: `export default ${JSON.stringify(stampData)};` };
          if (args.path === 'data-export') return {
            loader: 'js',
            contents: `export async function exportWithReason(filename, save) { window.proformaExports = [...(window.proformaExports || []), filename]; await save(); window.proformaSaves = (window.proformaSaves || 0) + 1; return true; }`
          };
          return {
            loader: 'js',
            contents: `
              const invoice = ${JSON.stringify(invoice)};
              export const readApiError = error => error.message;
              export const storeSessionUser = user => user;
              export default { get: async url => ({ data: url.includes('auth/me') ? { user: { role: 'superadmin', name: 'Test' } } : url.includes('quotations') ? { quotations: [] } : { proformaInvoices: [invoice] } }) };
            `
          };
        });
      }
    }]
  });
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ headless: true, ...(process.env.QUOTATION_CHROME_PATH ? { executablePath: process.env.QUOTATION_CHROME_PATH } : {}), args: process.platform === 'linux' ? ['--no-sandbox'] : [] });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForSelector('button[title="View details"]');

    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim().startsWith('Saved Proforma Invoices'))?.click());
    await page.click('button[title="View details"]');
    await page.waitForSelector('iframe[title="Proforma Invoice PDF preview"][src^="blob:"]');
    const firstUrl = await page.$eval('iframe[title="Proforma Invoice PDF preview"]', frame => frame.src);
    const firstPdf = await page.evaluate(async url => {
      const response = await fetch(url);
      const blob = await response.blob();
      return { type: blob.type, size: blob.size };
    }, firstUrl);
    assert.equal(firstPdf.type, 'application/pdf');
    assert.ok(firstPdf.size > 1000);

    await page.click('[aria-label="Close preview"]');
    await page.waitForSelector('iframe[title="Proforma Invoice PDF preview"]', { hidden: true });
    await page.click('button[title="View details"]');
    await page.waitForFunction(() => document.querySelector('iframe[title="Proforma Invoice PDF preview"]')?.src.startsWith('blob:'));
    const secondUrl = await page.$eval('iframe[title="Proforma Invoice PDF preview"]', frame => frame.src);
    assert.notEqual(secondUrl, firstUrl);
    const secondPdf = await page.evaluate(async url => {
      const response = await fetch(url);
      return { type: response.headers.get('content-type'), size: (await response.blob()).size };
    }, secondUrl);
    assert.equal(secondPdf.type, 'application/pdf');
    assert.ok(secondPdf.size > 1000);

    await page.click('[aria-label="Close preview"]');
    await page.waitForSelector('iframe[title="Proforma Invoice PDF preview"]', { hidden: true });
    await page.click('button[title="Download PDF"]');
    await page.waitForFunction(() => window.proformaSaves === 1);
    assert.equal(await page.evaluate(() => window.proformaExports[0]), 'PI-26-27-002.pdf');

    await page.click('button[title="View details"]');
    await page.waitForSelector('iframe[title="Proforma Invoice PDF preview"][src^="blob:"]');
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Download PDF').click());
    await page.waitForFunction(() => window.proformaSaves === 2);
    assert.equal(await page.evaluate(() => window.proformaExports[1]), 'PI-26-27-002.pdf');
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
  }
});
