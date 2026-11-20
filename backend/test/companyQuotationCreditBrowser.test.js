const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('../../frontend/node_modules/esbuild');
test('rejected EPR quotations in company history expose the amount request and reach Credit approvals',async()=>{
 const bundle=await esbuild.build({stdin:{resolveDir:path.resolve(__dirname,'../../frontend'),loader:'jsx',contents:`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
 import History from './src/features/eprCredit/CompanyQuotationHistory.jsx';
 import Approvals,{CreditRateRequestModal} from './src/features/eprCredit/CreditRateRequests.jsx';
 import {loadFullQuotation} from './src/utils/quotationDetail.mjs';
 const rows=[{_id:'507f1f77bcf86cd799439011',quotationNumber:'AT/26-27/526',status:'rejected',companyName:'TEST',items:[{businessCategory:'EPR Credit',servicesOffered:'Category 2 – Recycling',basicAmount:2.4},{businessCategory:'EPR Consultancy',basicAmount:2000}]},{_id:'507f1f77bcf86cd799439012',quotationNumber:'AT/26-27/501',status:'rejected',items:[{businessCategory:'EPR Credit',servicesOffered:'Category 2 – EOL',basicAmount:.95}]},{_id:'507f1f77bcf86cd799439013',quotationNumber:'CONSULTANCY',items:[{businessCategory:'EPR Consultancy',basicAmount:2000}]}];
 window.quotes=rows;
 function Harness(){const[quote,setQuote]=useState(null);const[submitted,setSubmitted]=useState(false);return <><History quotations={rows} onView={()=>{}} onEdit={()=>{}} onRequestCredit={async row=>setQuote(await loadFullQuotation(row,async id=>{window.fetched=id;return {data:{quotation:rows.find(row=>row._id===id)}}}))} renderApproval={()=>null} canRevise={()=>true} formatDate={()=>'20-11-2026'} formatAmount={amount=>'₹'+amount}/>{quote&&<CreditRateRequestModal quotation={quote} onClose={()=>setQuote(null)} onSubmitted={()=>{setQuote(null);setSubmitted(true);}}/>}{submitted&&<Approvals/>}</>}
 createRoot(document.getElementById('root')).render(<Harness/>);
 `},bundle:true,write:false,format:'iife',platform:'browser',define:{'import.meta.env':'{}'},plugins:[{name:'fixture',setup(build){build.onResolve({filter:/services\/api$/},()=>({path:'api',namespace:'mock'}));build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export default {post:async(url,body)=>{window.request={url,body};const quote=window.quotes[0];window.approvals=[{id:'request-1',quotationId:quote._id,quotationNumber:quote.quotationNumber,companyName:'TEST',requestedByName:'CRM user',status:'PENDING',changes:body.changes.map(change=>({...change,item:quote.items[change.itemIndex],currentAmount:quote.items[change.itemIndex].basicAmount}))}];return {data:{}}},get:async()=>({data:{requests:window.approvals||[],canDecide:false}})};`}));}}]});
 const{default:puppeteer}=await import('puppeteer');const browser=await puppeteer.launch({headless:true,...(process.env.QUOTATION_CHROME_PATH?{executablePath:process.env.QUOTATION_CHROME_PATH}:{}),args:process.platform==='linux'?['--no-sandbox']:[]});
 try{const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setRequestInterception(true);page.on('request',request=>request.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('http://company.test');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForSelector('tbody tr');
 assert.equal(await page.$$eval('tbody tr',rows=>rows.length),3);
 assert.equal(await page.evaluate(()=>[...document.querySelectorAll('button')].filter(button=>button.textContent==='Request for Credit Change').length),2);
 assert.equal(await page.$eval('tbody tr:nth-child(3)',row=>row.textContent.includes('Request for Credit Change')),false);
 await page.$eval('tbody tr:first-child',row=>[...row.querySelectorAll('button')].find(button=>button.textContent==='Request for Credit Change').click());await page.waitForSelector('[role=dialog]');assert.equal(await page.evaluate(()=>window.fetched),'507f1f77bcf86cd799439011');assert.equal(await page.$$eval('[role=dialog] tbody tr',rows=>rows.length),1);
 await page.$eval('input[aria-label="Requested amount for item 1"]',element=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,'1.10');element.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.evaluate(()=>[...document.querySelectorAll('[role=dialog] button')].find(button=>button.textContent==='Submit Credit Request').click());await page.waitForFunction(()=>document.body.innerText.includes('EPR Credit rate requests'));
 assert.equal(await page.evaluate(()=>window.request.url),'/quotations/507f1f77bcf86cd799439011/credit-rate-requests');assert.equal(await page.evaluate(()=>window.request.body.changes[0].requestedAmount),'1.10');assert.equal(await page.evaluate(()=>window.approvals[0].status),'PENDING');assert.ok(await page.evaluate(()=>document.body.innerText.includes('₹1.10 / kg')));assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
