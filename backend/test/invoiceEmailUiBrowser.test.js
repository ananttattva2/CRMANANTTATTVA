const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('../../frontend/node_modules/esbuild');

test('invoice email composer supports multiple recipients, retry and payment summary UI', async () => {
  const bundle = await esbuild.build({
    stdin: { resolveDir: path.resolve(__dirname, '../../frontend'), loader: 'jsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom';
      import Sidebar from './src/components/dashboard/Sidebar.jsx';
      import InvoiceEmailDialog from './src/components/InvoiceEmailDialog.jsx';
      import PaymentStatusCell from './src/components/PaymentStatusCell.jsx';
      window.posts=[];window.failSend=true;
      function App(){const[open,setOpen]=React.useState(false);return <MemoryRouter><div style={{width:296,height:'100vh',position:'fixed',background:'#16805f'}}><Sidebar currentUser={{role:'superadmin'}} collapsed={false}/></div><main style={{marginLeft:320,padding:24}}><h1>Finance & Billing</h1><PaymentStatusCell companyName="Demo Company" payment={{status:'ADVANCE_RECEIVED',amount:5000,name:'Finance User',at:'2026-11-21T10:00:00Z',remarks:'Bank receipt verified'}}/><button onClick={()=>setOpen(true)}>Send Invoice</button>{open&&<InvoiceEmailDialog invoice={{_id:'invoice-1',proformaNumber:'PI/26-27/203',companyName:'Demo Company'}} onClose={()=>setOpen(false)} onSent={message=>{window.sent=message;setOpen(false)}}/>}</main></MemoryRouter>};createRoot(document.getElementById('root')).render(<App/>);` },
    bundle: true, write: false, outfile: 'fixture.js', format: 'iife', platform: 'browser',
    plugins: [{ name: 'mock-mail-api', setup(build) {
      build.onResolve({ filter: /services\/api$/ }, () => ({ path: 'api', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `export const readApiError=e=>e.message;export default {get:async url=>({data:url==='/auth/me'?{user:{role:'superadmin'}}:url.includes('pending-count')?{ok:true,count:71}:{mandatoryCc:['creator@example.test','admin@example.test','super@example.test','finance@example.test'],to:'client@example.test',subject:'Proforma Invoice PI/26-27/203',body:'Dear Client,\\nPlease find your invoice attached.'}}),post:async(url,body)=>{window.posts.push({url,body});if(window.failSend)throw new Error('Provider unavailable; please retry');return {data:{message:'Invoice accepted for delivery'}}}};` }));
    }}]
  });
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ headless: true, ...(process.env.QUOTATION_CHROME_PATH ? { executablePath: process.env.QUOTATION_CHROME_PATH } : {}), args: process.platform === 'linux' ? ['--no-sandbox'] : [] });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.setContent('<div id="root"></div>');
    const assets = path.resolve(__dirname, '../../frontend/dist/assets');
    if (fs.existsSync(assets)) {
      const mainCss = fs.readdirSync(assets).find(name => /^index-.*\.css$/.test(name));
      if (mainCss) await page.addStyleTag({ content: fs.readFileSync(path.join(assets, mainCss), 'utf8') });
    }
    for (const file of bundle.outputFiles.filter(file => file.path.endsWith('.css'))) await page.addStyleTag({ content: file.text });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
    await page.waitForSelector('main button');
    assert.ok((await page.$eval('main', element => element.textContent)).includes('Finance User'));
    assert.ok((await page.$eval('main', element => element.textContent)).includes('Bank receipt verified'));
    const nav = await page.$$eval('nav[aria-label="Main navigation"] > button, nav[aria-label="Main navigation"] > div > button', elements => elements.map(element => element.getAttribute('aria-label')));
    assert.ok(nav.indexOf('Lead Management') < nav.indexOf('Quotations & Billing'));
    assert.ok(nav.indexOf('Approvals') < nav.indexOf('Client Management'));
    if (process.env.BILLING_UI_SCREENSHOT) await page.screenshot({ path: process.env.BILLING_UI_SCREENSHOT, fullPage: true });
    await page.click('main button');
    await page.waitForFunction(() => document.querySelector('dialog[open] input')?.value === 'client@example.test');
    assert.ok((await page.$eval('dialog', element => element.textContent)).includes('finance@example.test'));
    assert.ok((await page.$eval('dialog', element => element.textContent)).includes('PI-26-27-203.pdf'));
    await page.type('dialog input', ', second@example.test');
    await page.type('dialog label:nth-of-type(2) input', 'copy1@example.test, copy2@example.test');
    if (process.env.INVOICE_EMAIL_SCREENSHOT) await page.screenshot({ path: process.env.INVOICE_EMAIL_SCREENSHOT, fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    const bounds = await page.$eval('dialog', element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right }; });
    assert.ok(bounds.left >= 0 && bounds.right <= 390, 'Email composer fits a mobile screen');
    await page.setViewport({ width: 1440, height: 1000 });
    await page.click('dialog button[type="submit"]');
    await page.waitForSelector('dialog [role="alert"]');
    assert.ok(await page.$('dialog[open]'));
    await page.evaluate(() => { window.failSend = false; });
    await page.click('dialog button[type="submit"]');
    await page.waitForFunction(() => window.sent === 'Invoice accepted for delivery');
    assert.equal(await page.evaluate(() => window.posts[1].body.cc), 'copy1@example.test, copy2@example.test');
    assert.equal(await page.$('dialog'), null);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
