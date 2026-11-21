const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('../../frontend/node_modules/esbuild');
test('Legal table renders grouped Yes/No headers, filters, search and empty results', async () => {
  const bundle = await esbuild.build({ stdin: { resolveDir: path.resolve(__dirname, '../../frontend'), loader: 'jsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Legal from './src/pages/Legal'; createRoot(document.getElementById('root')).render(<Legal/>);
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser', plugins: [{ name: 'legal-harness', setup(build) {
    build.onResolve({filter: /DashboardShell$|services\/api$|useCrmRefresh$/}, args => ({path: args.path, namespace:'mock'}));
    build.onLoad({filter: /.*/, namespace:'mock'}, args => ({contents: args.path.endsWith('DashboardShell') ? `import React from 'react'; export default function Shell({children}){return <div>{children}</div>}` : args.path.endsWith('useCrmRefresh') ? 'export default function useCrmRefresh(){}' : `export default {get:async()=>({data:{rows:[{id:'a',clientName:'Alpha Ltd',userName:'Sonal',slaStatus:'No'},{id:'b',clientName:'Beta Ltd',userName:'Siddhesh',slaStatus:'Yes'}]}})}` , loader:'jsx', resolveDir:path.resolve(__dirname,'../../frontend')}));
  }}] });
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({headless:true,args:['--no-sandbox']});
  try {
    const page = await browser.newPage();
    await page.setViewport({width:1280,height:850});
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await page.addScriptTag({content: bundle.outputFiles[0].text});
    await page.waitForSelector('tbody tr');
    assert.deepEqual(await page.$$eval('thead th', nodes=>nodes.map(node=>node.textContent)), ['Client Name','User Name','SLA Status','Yes','No']);
    assert.equal(await page.$$eval('tbody tr', nodes=>nodes.length),2);
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(button=>button.textContent.startsWith('SLA No')).click());
    await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===1);
    assert.match(await page.$eval('tbody', node=>node.textContent),/Alpha Ltd/);
    await page.evaluate(()=>{const input=document.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'missing');input.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.waitForFunction(()=>document.querySelector('tbody').textContent.includes('No clients match'));
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(button=>button.textContent.startsWith('All Clients')).click());
    await page.evaluate(()=>{const input=document.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Siddhesh');input.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.waitForFunction(()=>document.querySelector('tbody').textContent.includes('Beta Ltd'));
    assert.doesNotMatch(await page.$eval('tbody',node=>node.textContent),/Alpha Ltd/);
  } finally { await browser.close(); }
});
