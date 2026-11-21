const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('../../frontend/node_modules/esbuild');

test('Annual Return status summary restores grouped headers and approved-year counts', async () => {
  const frontendRoot = path.resolve(__dirname, '../../frontend');
  const data = {
    users: [{ _id: 'sonal', name: 'Sonal', role: 'operation' }],
    assignments: [{
      _id: 'approved-annual',
      assignedServiceId: 'approved-annual',
      selectedLead: {
        company: 'Annual Client',
        assignedStaff: 'sonal',
        status: 'Closed',
        assignments: [{
          assignedServiceId: 'approved-annual',
          assignedStaff: 'sonal',
          assignedTo: 'manager',
          poStatus: 'received',
          poYearRows: [{ poFinancialYear: '2025-26', annualReturnYear: '2025-26' }]
        }]
      },
      data: {
        basic: { piboCategory: 'Producer', servicesOffered: 'Annual Return Filling' },
        cpcb: { status: 'Approved' },
        importMeta: { visibilityStatus: 'LIVE' }
      }
    }]
  };
  const mocks = {
    pageReadSnapshot: 'export const readPageSnapshot = () => null; export const savePageSnapshot = () => {};',
    api: `const data = ${JSON.stringify(data)}; export default { get: async () => ({ data }) };`
  };
  const bundle = await esbuild.build({
    stdin: {
      resolveDir: frontendRoot,
      loader: 'jsx',
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import ApplicationPortfolio from './src/components/dashboard/ApplicationPortfolio'; createRoot(document.getElementById('root')).render(<ApplicationPortfolio mode="status"/>);`
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    plugins: [{
      name: 'application-portfolio-test-mocks',
      setup(build) {
        build.onResolve({ filter: /pageReadSnapshot|services\/api|applicationPortfolio\.css$/ }, args => ({ path: args.path, namespace: 'portfolio-mock' }));
        build.onLoad({ filter: /.*/, namespace: 'portfolio-mock' }, args => ({
          contents: args.path.endsWith('.css') ? '' : mocks[path.basename(args.path)],
          loader: 'js',
          resolveDir: frontendRoot
        }));
      }
    }]
  });
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1536, height: 768 });
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForFunction(() => document.querySelector('.portfolio-matrix tfoot'));

    const headers = await page.$$eval('.portfolio-matrix thead tr', rows => rows.map(row => [...row.children].map(cell => cell.textContent.trim())));
    assert.deepEqual(headers, [
      ['AnantTattva SPOC', 'Total', 'Annual Return Applicable', 'Approved', 'Pending'],
      ['2025-26', '2026-27', '2027-28', 'Not Recorded', 'Approved', 'AR Action Required', 'Applied', 'Under Review', 'Not Started', 'Rejected']
    ]);
    const counts = await page.$$eval('.portfolio-matrix tfoot td button', buttons => buttons.map(button => button.textContent.trim()));
    assert.deepEqual(counts, [
      '1', '1', '0', '0', '0', '0', '0', '0', '0', '0', '0'
    ]);
    assert.equal(await page.$eval('.portfolio-matrix tbody .portfolio-person strong', node => node.textContent), 'Sonal');
  } finally {
    await browser.close();
  }
});
