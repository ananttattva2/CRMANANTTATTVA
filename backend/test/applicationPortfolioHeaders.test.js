const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('../../frontend/node_modules/esbuild');

test('Application status summary shows approved Annual Return and Importer of Raw Material registration', async () => {
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
        basic: { eprCategory: 'EPR - Plastic Waste', piboCategory: 'Producer', servicesOffered: 'Annual Return Filling' },
        cpcb: { status: 'Approved' },
        importMeta: { visibilityStatus: 'LIVE' }
      }
    }]
  };
  for (const [id,name,category,status] of [['battery','Battery Client','EPR - Battery Waste','Under Review'],['ewaste','Electronic Client','EPR - E-Waste','Approved']]) {
    const record=structuredClone(data.assignments[0]);record._id=id;record.assignedServiceId=id;record.selectedLead.company=name;record.selectedLead.assignments[0].assignedServiceId=id;record.data.basic.eprCategory=category;record.data.cpcb.status=status;data.assignments.push(record);
  }
  const actionRequired = structuredClone(data.assignments[0]); actionRequired._id = 'action-required'; actionRequired.selectedLead.company = 'Action Required Client'; actionRequired.selectedLead.assignments[0].poYearRows = []; actionRequired.selectedLead.assignments[0].poStatus = ''; data.assignments.push(actionRequired);
  data.assignments.push({
    _id: 'assignment:raw-material-registration',
    assignmentOnly: true,
    assignedServiceId: 'raw-material-registration',
    selectedLead: {
      company: 'Raw Material Registration Client',
      serviceSelections: [{
        assignedServiceId: 'raw-material-registration', eprCategory: 'EPR - Plastic Waste',
        subApplicantType: 'Importer of Raw Material', servicesOffered: 'New Registration'
      }],
      assignments: [{
        assignedServiceId: 'raw-material-registration', assignedTo: 'manager',
        assignedStaff: 'sonal', closedAt: '2026-11-26', poApprovalStatus: 'APPROVED'
      }]
    },
    data: { cpcb: { status: 'Approved' } }
  });
  const mocks = {
    pageReadSnapshot: 'export const readPageSnapshot = () => null; export const savePageSnapshot = () => {};',
    api: `const data = ${JSON.stringify(data)}; export default { get: async () => ({ data }) };`
  };
  const bundle = await esbuild.build({
    stdin: {
      resolveDir: frontendRoot,
      loader: 'jsx',
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import ApplicationPortfolio from './src/components/dashboard/ApplicationPortfolio'; createRoot(document.getElementById('root')).render(<><div id="dashboard"><ApplicationPortfolio mode="status"/></div><div id="pending"><ApplicationPortfolio mode="status" pendingOnly/></div></>);`
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
  const browser = await puppeteer.launch({ headless: true, ...(process.env.QUOTATION_CHROME_PATH ? {executablePath:process.env.QUOTATION_CHROME_PATH} : {}), args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1536, height: 768 });
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForFunction(() => document.querySelector('#dashboard .portfolio-matrix tfoot') && document.querySelector('#pending .portfolio-matrix tfoot'));

    const headers = await page.$$eval('#dashboard .portfolio-matrix thead tr', rows => rows.map(row => [...row.children].map(cell => cell.textContent.trim())));
    assert.deepEqual(headers, [
      ['AnantTattva SPOC', 'Total', 'Annual Return Applicable', 'Registration', 'Approved', 'Pending'],
      ['2025-26', '2026-27', '2027-28', 'Not Recorded', 'Approved', 'Approved', 'AR Action Required', 'Applied', 'Under Review', 'Not Started', 'Rejected']
    ]);
    const counts = await page.$$eval('#dashboard .portfolio-matrix tfoot td button', buttons => buttons.map(button => button.textContent.trim()));
    assert.deepEqual(counts, [
      '3', '1', '0', '0', '0', '1', '0', '1', '0', '0', '0', '0'
    ]);
    assert.equal(await page.$eval('#dashboard .portfolio-matrix tbody .portfolio-person strong', node => node.textContent), 'Sonal');

    await page.click('#dashboard button[aria-label="Sonal: 1 Registration Approved"]');
    await page.waitForSelector('dialog[open]');
    const registrationDetails = await page.$eval('dialog[open]', dialog => dialog.textContent);
    assert.match(registrationDetails, /Raw Material Registration Client/);
    assert.match(registrationDetails, /Importer of Raw Material/);
    await page.click('dialog[open] .portfolio-service-toggle');
    assert.match(await page.$eval('dialog[open] .portfolio-service-detail-row', row => row.textContent), /New Registration/);
    await page.click('dialog[open] button[aria-label="Close client details"]');

    const pendingHeaders = await page.$$eval('#pending .portfolio-matrix thead tr', rows => rows.map(row => [...row.children].map(cell => cell.textContent.trim())));
    assert.deepEqual(pendingHeaders, [
      ['AnantTattva SPOC', 'AR Action Required', 'Applied', 'Under Review', 'Not Started', 'Rejected']
    ]);
    const pendingCounts = await page.$$eval('#pending .portfolio-matrix tfoot td button', buttons => buttons.map(button => button.textContent.trim()));
    assert.deepEqual(pendingCounts, ['1', '0', '0', '0', '0']);
    assert.deepEqual(await page.$$eval('#dashboard .portfolio-waste-tabs strong',nodes=>nodes.map(node=>node.textContent)),['1','1','1']);
    await page.click('#dashboard .portfolio-waste-tabs button[aria-label^="Battery:"]');
    await page.waitForFunction(()=>document.querySelector('#dashboard .portfolio-waste-tabs button[aria-selected=true]')?.textContent.includes('Battery'));
    assert.equal(await page.$eval('#dashboard .portfolio-matrix tfoot td button',button=>button.textContent),'1');
    await page.click('#dashboard .portfolio-person');await page.waitForSelector('dialog[open]');
    const details=await page.$eval('dialog[open]',dialog=>dialog.textContent);
    assert.ok(details.includes('Battery Client'));assert.ok(!details.includes('Annual Client'));assert.ok(!details.includes('Electronic Client'));
    await page.click('dialog[open] button[aria-label="Close client details"]');
    await page.click('#dashboard .portfolio-waste-tabs button[aria-label^="E-Waste:"]');
    await page.click('#dashboard .portfolio-person');await page.waitForSelector('dialog[open]');assert.ok(await page.$eval('dialog[open]',dialog=>dialog.textContent.includes('Electronic Client')));
    await page.click('dialog[open] button[aria-label="Close client details"]');
    await page.focus('#dashboard .portfolio-waste-tabs button[aria-selected=true]');await page.keyboard.press('Home');
    await page.waitForFunction(()=>document.querySelector('#dashboard .portfolio-waste-tabs button[aria-selected=true]')?.textContent.includes('Plastic'));
    if(process.env.PORTFOLIO_SCREENSHOT) {
      await page.addStyleTag({path:path.resolve(frontendRoot,'src/components/dashboard/applicationPortfolio.css')});
      await page.screenshot({path:process.env.PORTFOLIO_SCREENSHOT,fullPage:true});
      await page.setViewport({width:390,height:844});
      await page.screenshot({path:process.env.PORTFOLIO_SCREENSHOT.replace('.png','-mobile.png'),fullPage:true});
    }
    await page.type('#dashboard input[aria-label="Search SPOC or client"]','Battery Client');
    assert.deepEqual(await page.$$eval('#dashboard .portfolio-waste-tabs strong',nodes=>nodes.map(node=>node.textContent)),['0','1','0']);
  } finally {
    await browser.close();
  }
});
