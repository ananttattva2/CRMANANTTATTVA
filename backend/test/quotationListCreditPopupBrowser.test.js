const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('../../frontend/node_modules/esbuild');
test('the actual Quotations list opens its credit popup immediately without navigation',async()=>{
 const bundle=await esbuild.build({stdin:{resolveDir:path.resolve(__dirname,'../../frontend'),loader:'jsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter,useLocation} from 'react-router-dom';import Quotations from './src/pages/Quotations.jsx';
 localStorage.setItem('user',JSON.stringify({_id:'staff',name:'Test user',email:'staff@example.test',role:'admin'}));
 function App(){const location=useLocation();return <><output id="route">{location.pathname}</output><Quotations/></>}
 createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/sales/quotations']}><App/></MemoryRouter>);
 `},bundle:true,write:false,format:'iife',platform:'browser',define:{'import.meta.env':'{}'},loader:{'.css':'text'},plugins:[{name:'mocks',setup(build){
 build.onResolve({filter:/services\/api$/},()=>({path:'api',namespace:'fixture'}));
 build.onResolve({filter:/DashboardShell$/},()=>({path:'shell',namespace:'fixture'}));
 build.onResolve({filter:/useCrmRefresh$/},()=>({path:'refresh',namespace:'fixture'}));
 build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='shell'?'export default function Shell({children}){return children;}':args.path==='refresh'?'export default function useCrmRefresh(){};':`
 export const readApiError=async(error,fallback)=>fallback;export const getStoredToken=()=>'';export const clearStoredSession=()=>{};
 const quote={_id:'507f1f77bcf86cd799439011',_listOnly:true,quotationNumber:'AT/26-27/526',companyName:'TEST',leadDetails:{companyName:'TEST',contactPerson:'Test Contact'},status:'rejected',quotationDate:'2026-11-20',createdAt:'2026-11-20',items:[{businessCategory:'EPR Credit',servicesOffered:'Category 2 – Recycling',basicAmount:2.4}]};
 export default {get:async url=>{
 if(url==='/auth/me')return {data:{user:{_id:'staff',role:'admin',email:'staff@example.test'}}};
 if(url==='/quotations')return {data:{quotations:[quote]}};
 if(url==='/quotations/'+quote._id){window.detailsCalls=(window.detailsCalls||0)+1;return new Promise((resolve,reject)=>{window.resolveCreditDetails=()=>resolve({data:{quotation:{...quote,_listOnly:false}}});window.rejectCreditDetails=()=>reject(new Error('offline'));});}
 return {data:{}};
 },post:async(url,body)=>{window.creditSubmission={url,body};return {data:{}}}};
 `}));}}]});
 const{default:puppeteer}=await import('puppeteer');const browser=await puppeteer.launch({headless:true,...(process.env.QUOTATION_CHROME_PATH?{executablePath:process.env.QUOTATION_CHROME_PATH}:{}),args:process.platform==='linux'?['--no-sandbox']:[]});
 try{const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setRequestInterception(true);page.on('request',request=>request.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('http://quotations.test');await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.waitForFunction(()=>document.body.innerText.includes('Click to view 1 quotation'));await page.evaluate(()=>[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Click to view 1 quotation')).click());
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='Request for Credit Change'));await page.evaluate(()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Request for Credit Change').click());
 await page.waitForSelector('[role=dialog]');assert.ok(await page.$eval('[role=dialog]',el=>el.innerText.includes('Loading EPR Credit quotation items')));assert.equal(await page.$eval('#route',el=>el.textContent),'/sales/quotations');
 await page.evaluate(()=>window.rejectCreditDetails());await page.waitForSelector('[role=dialog] [role=alert]');await page.evaluate(()=>[...document.querySelectorAll('[role=dialog] button')].find(button=>button.textContent==='Retry').click());await page.waitForFunction(()=>window.detailsCalls===2);await page.evaluate(()=>window.resolveCreditDetails());
 await page.waitForSelector('input[aria-label="Requested amount for item 1"]');assert.equal(await page.$eval('#route',el=>el.textContent),'/sales/quotations');
 await page.$eval('input[aria-label="Requested amount for item 1"]',element=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,'1.80');element.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.evaluate(()=>[...document.querySelectorAll('[role=dialog] button')].find(button=>button.textContent==='Submit Credit Request').click());await page.waitForFunction(()=>window.creditSubmission?.body.changes[0].requestedAmount==='1.80');assert.equal(await page.$eval('#route',el=>el.textContent),'/sales/quotations');await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));assert.equal(await page.evaluate(()=>document.body.style.overflow),'');assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
