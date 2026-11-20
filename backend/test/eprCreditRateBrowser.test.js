const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('../../frontend/node_modules/esbuild');
test('manual slabs, credit-only request popup and approval permissions work in the browser', async () => {
 const bundle=await esbuild.build({stdin:{resolveDir:path.resolve(__dirname,'../../frontend'),loader:'jsx',contents:`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
 import pricing,{CreditTargetSelect} from './src/features/eprCredit/CreditTargetSelect.jsx';
 import Approvals,{CreditRateRequestModal} from './src/features/eprCredit/CreditRateRequests.jsx';
 function Harness(){const [item,setItem]=useState({id:'credit',businessCategory:'EPR Credit',servicesOffered:'Category 1 – Recycling',creditRateBand:'below100'});const [open,setOpen]=useState(false);const [submitted,setSubmitted]=useState(false);
 const quote={_id:'507f1f77bcf86cd799439011',quotationNumber:'AT/26-27/TEST',companyName:'Example Industries',items:[item,{id:'normal',businessCategory:'EPR Consultancy',servicesOffered:'Annual Return Filling',basicAmount:20000},{id:'second',businessCategory:'EPR Credit',servicesOffered:'Category 2 – EOL',basicAmount:.95}]};quote.items[0]={...item,basicAmount:pricing.rate(item)};
 window.quote=quote;return <><CreditTargetSelect item={item} onChange={creditRateBand=>setItem(current=>({...current,creditRateBand}))}/><CreditTargetSelect item={{businessCategory:'EPR Consultancy'}} onChange={()=>{}}/><input aria-label="Locked amount" readOnly value={pricing.rate(item)}/><button onClick={()=>setOpen(true)}>Request for Credit Change</button>{open&&<CreditRateRequestModal quotation={quote} onClose={()=>setOpen(false)} onSubmitted={()=>{setOpen(false);setSubmitted(true);}}/>}{submitted&&<Approvals/>}</>}
 createRoot(document.getElementById('root')).render(<Harness/>);
 `},bundle:true,write:false,format:'iife',platform:'browser',define:{'import.meta.env':'{}'},loader:{'.css':'text'},plugins:[{name:'mock',setup(build){build.onResolve({filter:/services\/api$/},()=>({path:'api',namespace:'fixture'}));build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`
 export default {
 post:async(url,body)=>{window.submitted=body;window.requests=[{id:'request-1',quotationId:'507f1f77bcf86cd799439011',quotationNumber:'AT/26-27/TEST',companyName:'Example Industries',status:'PENDING',requestedByName:'Request User',changes:body.changes.map(c=>({...c,item:window.quote.items[c.itemIndex],currentAmount:window.quote.items[c.itemIndex].basicAmount}))}];return {data:{}}},
 get:async()=>({data:{requests:window.requests||[],canDecide:window.canDecide===true}}),
 patch:async(url,body)=>{window.decision=body;window.requests[0].status=body.decision;return {data:{}}}
 };`}));}}]});
 const {default:puppeteer}=await import('puppeteer');const browser=await puppeteer.launch({headless:true,...(process.env.QUOTATION_CHROME_PATH?{executablePath:process.env.QUOTATION_CHROME_PATH}:{}),args:process.platform==='linux'?['--no-sandbox']:[]});
 try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewport({width:1500,height:1000});await page.setRequestInterception(true);page.on('request',request=>request.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('http://credit.test');await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.waitForSelector('select');assert.equal(await page.$eval('select:nth-of-type(2)',el=>el.disabled),true);assert.equal(await page.$eval('input[aria-label="Locked amount"]',el=>el.readOnly),true);assert.equal(await page.$eval('input[aria-label="Locked amount"]',el=>el.value),'1.3');
  await page.select('select','above100');assert.equal(await page.$eval('input[aria-label="Locked amount"]',el=>el.value),'1.2');
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Request for Credit Change').click());await page.waitForSelector('[role=dialog]');assert.equal(await page.$$eval('[role=dialog] tbody tr',rows=>rows.length),2);
  await page.$eval('input[aria-label="Requested amount for item 1"]',el=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'1.10');el.dispatchEvent(new Event('input',{bubbles:true}));});
  const cssFile=fs.readdirSync(path.resolve(__dirname,'../../frontend/dist/assets')).find(name=>/^index-.*\.css$/.test(name));if(cssFile)await page.addStyleTag({content:fs.readFileSync(path.resolve(__dirname,'../../frontend/dist/assets',cssFile),'utf8')});
  if(process.env.CREDIT_REQUEST_SCREENSHOT)await page.screenshot({path:process.env.CREDIT_REQUEST_SCREENSHOT,fullPage:true});
  await page.evaluate(()=>[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='Submit Credit Request').click());await page.waitForFunction(()=>document.body.innerText.includes('EPR Credit rate requests'));
  assert.equal(await page.evaluate(()=>window.submitted.changes.length),2);assert.equal(await page.evaluate(()=>window.submitted.changes[0].requestedAmount),'1.10');
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Approve')),false);
  await page.evaluate(()=>{window.canDecide=true;[...document.querySelectorAll('button')].find(b=>b.textContent==='Refresh').click();});await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Approve'));
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Approve').click());await page.waitForSelector('[role=alertdialog]');await page.evaluate(()=>[...document.querySelectorAll('[role=alertdialog] button')].find(b=>b.textContent==='Confirm').click());await page.waitForFunction(()=>window.decision?.decision==='APPROVED');
  assert.deepEqual(errors,[]);
 } finally{await browser.close();}
});
