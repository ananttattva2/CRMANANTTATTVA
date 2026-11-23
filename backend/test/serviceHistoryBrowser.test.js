const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('../../frontend/node_modules/esbuild');
test('service history loads registration, renewal and annual services without annual years', async () => {
 const bundle=await esbuild.build({stdin:{resolveDir:path.resolve(__dirname,'../../frontend'),loader:'jsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import History from './src/features/clientMaster/ClientServiceHistory.jsx';
 createRoot(document.getElementById('root')).render(<History client={{_id:'producer-client'}} onContinue={row=>window.continued=row}/>);
 `},bundle:true,write:false,format:'iife',platform:'browser',define:{'import.meta.env':'{}'},loader:{'.css':'text'},plugins:[{name:'fixtures',setup(build){
 build.onResolve({filter:/services\/api$/},()=>({path:'api',namespace:'fixture'}));
 build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export default {get:async(url)=>{window.requested=url;if(url.includes('registration-tracker'))return {data:{tracker:{dataReceived:'no',complianceCheck:'no',registrationCompleted:'no'}}};return {data:{services:['New Registration','Renewal','Annual Return Filling','Annual Return Filling'].map((service,index)=>({service,applicantType:'Producer',assignedServiceId:'service-'+index,poYear:'2026-27',number:'PO-'+index,fileUrl:'https://example.test/api/assets/file?key=crm%2Fleads%2Fpurchase-orders%2Fpo-'+index+'.pdf&signature=abc123',annual:index>=2,annualYear:index===2?'2025-26':index===3?'2026-27':''}))}}}};`}));
 }}]});
 const {default:puppeteer}=await import('puppeteer');
 const browser=await puppeteer.launch({headless:true,...(process.env.QUOTATION_CHROME_PATH?{executablePath:process.env.QUOTATION_CHROME_PATH}:{}),args:process.platform==='linux'?['--no-sandbox']:[]});
 try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}));
  await page.goto('http://history.test');await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===4);
  assert.equal(await page.evaluate(()=>window.requested),'/clients/producer-client/service-history');
  const services=await page.$$eval('tbody tr',rows=>rows.map(row=>row.cells[1].textContent));
  assert.deepEqual(services,['New Registration','Renewal','Annual Return Filling','Annual Return Filling']);
  await page.click('tbody tr:nth-child(1) button');await page.waitForFunction(()=>document.body.textContent.includes('Client Data Upload Tracker'));assert.equal(await page.$$eval('select',els=>els.length),3);await page.waitForFunction(()=>!document.querySelector('button[type=submit]').disabled);await page.click('header button');await page.waitForSelector('tbody tr:nth-child(4) button');await page.click('tbody tr:nth-child(4) button');await page.waitForFunction(()=>document.body.textContent.includes('2027-28'));assert.equal(await page.evaluate(()=>window.continued),undefined);
  await page.click('tbody tr:nth-child(3) button');assert.equal(await page.evaluate(()=>window.continued.annualYear),'2025-26');
  assert.equal(await page.$eval('tbody a',a=>a.href),'https://example.test/api/assets/file?key=crm%2Fleads%2Fpurchase-orders%2Fpo-0.pdf&signature=abc123');assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
