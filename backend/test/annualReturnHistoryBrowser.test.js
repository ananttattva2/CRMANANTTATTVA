const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('../../frontend/node_modules/esbuild');

test('history renders closed POs, previews the document and continues directly to Data', async () => {
  const bundle = await esbuild.build({
    stdin: { resolveDir: path.resolve(__dirname, '../../frontend'), loader: 'jsx', contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {MemoryRouter, useLocation} from 'react-router-dom';
      import {AnnualReturnHistory} from './src/features/clientMaster/ClientMasterAnnualReturn.jsx';
      const client={_id:'6a842adf38a334ba9d8c4ff7',data:{basic:{clientLegalName:'Example Importer',piboCategory:'IMPORTER',servicesOffered:'Annual Return Filling'}}};
      function Harness(){const [year,setYear]=useState('');const location=useLocation();return <><output id="route">{location.pathname}</output><AnnualReturnHistory client={client} years={['2023-24','2024-25','2025-26'].map(label=>({label}))} selectedYear={year} onSelectYear={setYear}/></>}
      createRoot(document.getElementById('root')).render(<MemoryRouter><Harness/></MemoryRouter>);
    ` }, bundle: true, write: false, format: 'iife', platform: 'browser', define: {'import.meta.env':'{}'}, loader: {'.css':'text'},
    plugins: [{name:'fixtures',setup(build){
      build.onResolve({filter:/services\/api$/},()=>({path:'api',namespace:'fixture'}));
      build.onResolve({filter:/PurchaseDataWorkspace$/},()=>({path:'workspace',namespace:'fixture'}));
      build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='workspace' ? 'export default function Workspace(){return null;}' : `export default {get:async()=>({data:{years:[
        {fy:'2023-24',poStatus:'pending'},
        {fy:'2024-25',poStatus:'received',po:{number:'OPEN-PO',isClosed:false}},
        {fy:'2025-26',poStatus:'received',po:{number:'CLOSED-PO',isClosed:true,poYear:'2026-27',service:'Annual Return Filling',fileUrl:'https://example.test/order.pdf'}}
      ]}})};` }));
    }}]
  });
  const {default:puppeteer}=await import('puppeteer');
  const browser=await puppeteer.launch({headless:true,...(process.env.QUOTATION_CHROME_PATH ? {executablePath:process.env.QUOTATION_CHROME_PATH}:{}),args:process.platform==='linux'?['--no-sandbox']:[]});
  try {
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request',request=>request.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}));
    await page.goto('http://history.test');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.waitForFunction(()=>document.body.innerText.includes('CLOSED-PO'));
    assert.equal(await page.$$eval('tbody tr',rows=>rows.length),1);
    const content=await page.$eval('tbody',el=>el.innerText);
    assert.match(content,/IMPORTER/);assert.match(content,/Annual Return Filling/);assert.match(content,/2026-27/);assert.doesNotMatch(content,/OPEN-PO/);
    assert.equal(await page.$eval('tbody a',el=>el.href),'https://example.test/order.pdf');
    await page.click('tbody button');
    await page.waitForFunction(()=>document.querySelector('#route').textContent.endsWith('/2025-26'));
    const steps=await page.$$eval('.annual-step',els=>els.map(el=>el.textContent));
    assert.deepEqual(steps,['Data','CPCB Letter']);
    assert.equal(await page.$eval('.annual-step-active',el=>el.textContent),'Data');
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
