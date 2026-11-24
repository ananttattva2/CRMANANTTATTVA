const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const esbuild = require('../../frontend/node_modules/esbuild');
const { serviceWorkspaces } = require('../src/services/clientPortalWorkspaces');
test('Producer cards select year and PO, send scoped purchase/sales files and isolate history', async () => {
  const lead = { _id: 'lead1', serviceSelections: [{ assignedServiceId: 'ar', subApplicantType: 'Producer', servicesOffered: 'Annual Return Filling' }], assignments: [{ assignedServiceId: 'ar', closedAt: '2026-01-01', poYearRows: ['2025-26','2026-27'].map(annualReturnYear => ({ fy: '2026-27', annualReturnYear, poNumber: '003' })) }] };
  const client = { ...lead, company: 'KHATRI PLASTIC INDUSTRIES PVT LTD', services: lead.serviceSelections, serviceWorkspaces: serviceWorkspaces(lead), spoc: { name: 'Assigned SPOC' } };
  const bundle = await esbuild.build({ stdin: { resolveDir: path.resolve(__dirname, '../../frontend'), loader: 'jsx', contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Workspace from './src/components/clientPortal/ApplicantWorkspace.jsx';const client=${JSON.stringify(client)};const api={get:async()=>({data:window.files||[]}),post:async(url,body)=>{const context=client.serviceWorkspaces.find(row=>row.serviceKey===body.get('serviceKey'));const row={_id:String(Date.now()),lead:client._id,kind:url.split('/').at(-1),name:body.get('file').name,applicantType:body.get('applicantType'),dataType:body.get('dataType'),serviceKey:body.get('serviceKey'),serviceContext:context,notificationStatus:'sent',size:5,uploadedAt:new Date().toISOString(),url:'https://files.test/data.xlsx'};window.files=[...(window.files||[]),row];window.lastUpload=row;return {data:row}}};createRoot(document.getElementById('root')).render(<Workspace clients={[client]} api={api} token="test" onViewFile={()=>{}} Table={()=>null} Section={({children})=><section>{children}</section>}/>);` }, bundle: true, write: false, format: 'iife', platform: 'browser' });
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ headless: true, ...(process.env.QUOTATION_CHROME_PATH ? { executablePath: process.env.QUOTATION_CHROME_PATH } : {}), args: process.platform === 'linux' ? ['--no-sandbox'] : [] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-service-ui-'));
  const file = path.join(dir, 'purchase-sales.xlsx'); fs.writeFileSync(file, Buffer.from([80,75,3,4,1]));
  try {
    const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 1000 }); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="root" class="cp cp-portal"></div>'); await page.addStyleTag({ content: fs.readFileSync(path.resolve(__dirname, '../../frontend/src/styles/client-portal.css'), 'utf8') + fs.readFileSync(path.resolve(__dirname, '../../frontend/src/styles/client-workspace.css'), 'utf8') }); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.click('.cp-applicant-cards button'); await page.waitForSelector('.cp-service-card');
    assert.equal(await page.$$eval('.cp-service-card', cards => cards.length), 2);
    assert.ok(await page.$eval('.cp-service-picker', element => element.textContent.includes('2025-26') && element.textContent.includes('2026-27') && element.textContent.includes('003')));
    await page.screenshot({ path: path.resolve(__dirname, '../../reports/client-portal-service-cards.png'), fullPage: true });
    await page.click('.cp-service-card button'); await page.waitForSelector('.cp-upload-panel'); assert.equal(await page.$$('.cp-upload-panel').then(rows => rows.length), 2);
    const key = client.serviceWorkspaces[0].serviceKey;
    for (const [index, dataType] of ['purchase','sales'].entries()) {
      const inputs = await page.$$('input[type=file]'); await inputs[index].uploadFile(file);
      const buttons = await page.$$('.cp-upload-form .cp-upload-submit'); await buttons[index].click();
      await page.waitForFunction(type => window.lastUpload?.dataType === type, {}, dataType);
      const saved = await page.evaluate(() => window.lastUpload); assert.equal(saved.serviceKey, key); assert.equal(saved.serviceContext.annualReturnYear, '2025-26'); assert.equal(saved.serviceContext.poNumber, '003');
    }
    assert.equal(await page.evaluate(() => document.body.textContent.includes('PO Year')), false);
    await page.evaluate(() => [...document.querySelectorAll('.cp-workspace-tabs button')].find(button => button.textContent.includes('PO Upload')).click());
    await page.waitForFunction(() => document.querySelector('.cp-upload-panel')?.textContent.includes('Upload a purchase order'));
    assert.equal(await page.$$('.cp-upload-panel').then(rows => rows.length), 1);
    const poFile = path.join(dir, 'client-po.pdf'); fs.writeFileSync(poFile, '%PDF-1.7 test');
    await (await page.$('input[type=file]')).uploadFile(poFile); await page.click('.cp-upload-form .cp-upload-submit');
    await page.waitForFunction(() => window.lastUpload?.kind === 'po'); assert.equal((await page.evaluate(() => window.lastUpload)).serviceKey, key);
    await page.click('.cp-back-workspaces'); await page.waitForSelector('.cp-service-card'); const cards = await page.$$('.cp-service-card'); await (await cards[1].$('button')).click(); await page.waitForSelector('.cp-upload-panel');
    assert.equal(await page.$$('.cp-upload-history').then(rows => rows.length), 0);
    await page.setViewport({ width: 390, height: 844 }); await page.click('.cp-back-workspaces'); await page.waitForSelector('.cp-service-card'); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
