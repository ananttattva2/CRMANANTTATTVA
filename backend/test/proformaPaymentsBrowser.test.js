const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('../../frontend/node_modules/esbuild');
test('invoice page loads only eligible services and submits the selected payment percentage', async () => {
  const frontendRoot = path.resolve(__dirname, '../../frontend');
  const stampData = `data:image/png;base64,${fs.readFileSync(path.join(frontendRoot, 'src/assets/proforma-authorized-stamp.png'), 'base64')}`;
  const bundle = await esbuild.build({ stdin: { resolveDir: frontendRoot, loader: 'jsx', contents: `import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import Page from './src/pages/ProformaInvoices.jsx';createRoot(document.getElementById('root')).render(<MemoryRouter><Page/></MemoryRouter>);` }, bundle: true, write: false, format: 'iife', platform: 'browser', plugins: [{ name: 'fixture', setup(build) {
    build.onResolve({ filter: /DashboardShell$/ }, () => ({ path: 'shell', namespace: 'fixture' }));
    build.onResolve({ filter: /(^|\/)api$/ }, () => ({ path: 'api', namespace: 'fixture' }));
    build.onResolve({ filter: /proforma-authorized-stamp\.png\?inline$/ }, () => ({ path: 'stamp', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
      if (args.path === 'stamp') return { loader: 'js', contents: `export default ${JSON.stringify(stampData)};` };
      return { loader: 'jsx', contents: args.path === 'shell' ? 'export default function Shell({children}){return children}' : `
      const quote={_id:'507f1f77bcf86cd799439099',quotationNumber:'Q-TEST',pricingMode:'individual',leadDetails:{companyName:'TEST BUYER',gstNumber:'27ABCDE1234F1Z5'},items:[{serviceCategory:'OPEN SERVICE',basicAmount:50000},{serviceCategory:'CLOSED SERVICE',basicAmount:125000,unit:'1'}]};
      const eligible={...quote.items[1],sourceItemIndex:1,assignedServiceId:'closed'};
      let savedInvoices=[];
      export const readApiError=e=>e.message;export const storeSessionUser=user=>user;export const clearStoredSession=()=>{};
      export default {
        get:async url=>({data:url==='/auth/me'?{user:{role:'superadmin',name:'Test'}}:url==='/quotations'?{quotations:[quote]}:url.includes('eligible-quotation')?{items:window.credit?[{...eligible,businessCategory:"EPR Credit",unit:"100",basicAmount:120000}]:window.noEligible?[]:[eligible],poYearRows:window.credit?[]:[{fy:'2026-27',poNumber:'AT/26-27/525',compliancePoFile:{name:'po.pdf',secureUrl:'https://example.test/po.pdf'},serviceCategory:['CLOSED SERVICE']}]}:{proformaInvoices:savedInvoices}}),
        post:async(url,body)=>{window.savedPayload=body;const row={...body,_id:'pi-created',proformaNumber:'PI-TEST'};savedInvoices=[row];return{data:{proformaInvoice:row}}},
        put:async(url,body)=>{window.updatedPayload=body;savedInvoices=savedInvoices.map(row=>({...row,...body}));return{data:{proformaInvoice:savedInvoices[0]}}}
      };
    ` };
    });
  }}] });
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ headless: true, ...(process.env.QUOTATION_CHROME_PATH ? { executablePath: process.env.QUOTATION_CHROME_PATH } : {}), args: process.platform === 'linux' ? ['--no-sandbox'] : [] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1450, height: 1000 });
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('Select a quotation')));
    async function clickText(text) { await page.evaluate(text => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes(text)); if (!b) throw Error(text); b.click() }, text); }
    await clickText('Select a quotation');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('Q-TEST')));
    await clickText('Q-TEST');
    await page.waitForFunction(() => [...document.querySelectorAll('input')].some(i => i.value === 'CLOSED SERVICE'));
    const poInput = 'input[aria-label="PO Number"]';
    assert.equal(await page.$eval(poInput, input => input.placeholder), 'NA');
    assert.equal(await page.evaluate(() => document.body.textContent.includes('the saved value appears on the invoice and PDF')), true);
    assert.equal(await page.$eval(poInput, input => input.readOnly), false);
    await page.$eval(poInput, input => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'CUSTOMER-PO-EDITED');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector('input[aria-label="PO Number"]')?.value === 'CUSTOMER-PO-EDITED');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('input')].some(i => i.value === 'OPEN SERVICE')), false);
    assert.equal(await page.evaluate(() => document.body.textContent.includes('Invoice, Delivery & Bank Details')), false);
    assert.equal(await page.$$eval('[aria-label="Invoice pricing type"] button', buttons => buttons.length), 2);
    await clickText('Combined Price');
    await page.waitForFunction(() => document.querySelector('[aria-label="Invoice pricing type"] button[aria-pressed="true"]')?.textContent.includes('Combined Price'));
    await page.evaluate(() => { const input = document.querySelector('input[placeholder="50000"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '125000'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await clickText('Individual Price');
    await page.waitForFunction(() => [...document.querySelectorAll('input')].some(input => input.value === '125000'));
    await clickText('Combined Price');
    await page.waitForFunction(() => document.querySelector('input[placeholder="50000"]')?.value === '125000');
    await clickText('Individual Price');
    await page.evaluate(() => { const input = [...document.querySelectorAll('input')].find(i => i.max === '100' && i.step === '0.01'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, '30'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForFunction(() => document.body.textContent.includes('₹37,500'));
    await page.$eval('input[aria-label="Services Offered 1"]', input => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'New Registration - Importer of Raw Material');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await clickText('Save Proforma Invoice');
    await page.waitForFunction(() => window.savedPayload);
    const payload = await page.evaluate(() => window.savedPayload);
    assert.equal(Number(payload.paymentPercentage), 30);
    assert.equal(payload.subtotal, 37500);
    assert.equal(payload.grandTotal, 44250);
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].sourceItemIndex, 1);
    assert.equal(payload.items[0].servicesOffered, 'New Registration - Importer of Raw Material');
    assert.equal(payload.poNumber, 'CUSTOMER-PO-EDITED');
    await page.waitForFunction(() => document.body.textContent.includes('saved successfully'));
    await clickText('Saved Proforma Invoices');
    await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some(row => row.textContent.includes('CUSTOMER-PO-EDITED')));
    await clickText('Edit');
    await page.waitForFunction(() => document.querySelector('input[aria-label="PO Number"]')?.value === 'CUSTOMER-PO-EDITED');
    await page.$eval(poInput, input => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'CUSTOMER-PO-UPDATED');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector('input[aria-label="PO Number"]')?.value === 'CUSTOMER-PO-UPDATED');
    await clickText('Update Invoice');
    await page.waitForFunction(() => window.updatedPayload);
    assert.equal((await page.evaluate(() => window.updatedPayload)).poNumber, 'CUSTOMER-PO-UPDATED');
    await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some(row => row.textContent.includes('CUSTOMER-PO-UPDATED')));
    assert.equal(await page.evaluate(() => document.body.textContent.includes('PO Received For No Of Year')), false);
    await page.evaluate(() => { window.noEligible = true; });
    await clickText('Create Proforma Invoice');
    await clickText('Select a quotation');
    await clickText('Q-TEST');
    await page.waitForFunction(() => document.body.textContent.includes('No services found'));
    assert.equal(await page.$$eval('[aria-label="Invoice pricing type"] button', buttons => buttons.length), 2);
    await clickText('Combined Price');
    assert.ok(await page.evaluate(() => document.body.textContent.includes('No services found')));
    await page.evaluate(() => { window.credit = true; window.noEligible = false; window.savedPayload = null; });
    await clickText('Q-TEST');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('Q-TEST') && !button.textContent.includes('Selected quotation')));
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.includes('Q-TEST') && !button.textContent.includes('Selected quotation')).click());
    await page.waitForFunction(() => [...document.querySelectorAll('input')].some(input => input.value === '120000'));
    assert.equal(await page.$eval(poInput, input => input.value), '');
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('input')].some(input => input.value === '100')));
    await page.waitForFunction(() => document.body.textContent.includes('99,120'));
    assert.ok(await page.evaluate(() => document.body.textContent.includes('Previously Invoiced: 30% · Remaining: 70%')));
    await clickText('Save Proforma Invoice');
    await page.waitForFunction(() => window.savedPayload);
    const creditPayload = await page.evaluate(() => window.savedPayload);
    assert.equal(creditPayload.poNumber, '');
    assert.equal(Number(creditPayload.paymentPercentage), 70);
    assert.equal(creditPayload.paymentStage, 'later');
    assert.equal(creditPayload.items[0].unit, '100');
    assert.equal(creditPayload.items[0].basicAmount, 120000);
    assert.equal(creditPayload.grandTotal, 99120);
    await page.waitForFunction(() => document.body.textContent.includes('saved successfully'));
    await clickText('Saved Proforma Invoices');
    await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some(row => row.textContent.includes('NA')));
  } finally { await browser.close(); }
});

