const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('../../frontend/node_modules/esbuild');
test('Quotations supports credit requests, service status tabs, and an in-dashboard open quotation list',async()=>{
 const bundle=await esbuild.build({stdin:{resolveDir:path.resolve(__dirname,'../../frontend'),loader:'jsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter,useLocation,useNavigate} from 'react-router-dom';import Quotations from './src/pages/Quotations.jsx';import LeadPipeline from './src/pages/LeadPipeline.jsx';
 localStorage.setItem('user',JSON.stringify({_id:'staff',name:'Test user',email:'staff@example.test',role:'admin'}));
 function App(){const location=useLocation();const navigate=useNavigate();return <><output id="route">{location.pathname}</output><button id="fixture-dashboard" onClick={()=>{window.dashboardMode=true;navigate('/summary-dashboard')}}>Dashboard fixture</button>{location.pathname==='/summary-dashboard'?<LeadPipeline/>:<Quotations/>}</>}
 createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/sales/quotations']}><App/></MemoryRouter>);
 `},bundle:true,write:false,format:'iife',platform:'browser',define:{'import.meta.env':'{}'},loader:{'.css':'text'},plugins:[{name:'mocks',setup(build){
 build.onResolve({filter:/services\/api$/},()=>({path:'api',namespace:'fixture'}));
 build.onResolve({filter:/DashboardShell$/},()=>({path:'shell',namespace:'fixture'}));
 build.onResolve({filter:/useCrmRefresh$/},()=>({path:'refresh',namespace:'fixture'}));
 build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='shell'?'export default function Shell({children}){return children;}':args.path==='refresh'?'export default function useCrmRefresh(){};':`
 export const readApiError=async(error,fallback)=>fallback;export const getStoredToken=()=>'';export const clearStoredSession=()=>{};
 const quote={_id:'507f1f77bcf86cd799439011',_listOnly:true,quotationNumber:'AT/26-27/526',companyName:'TEST',leadDetails:{companyName:'TEST',contactPerson:'Test Contact'},status:'rejected',quotationDate:'2026-11-20',createdAt:'2026-11-20',items:[{businessCategory:'EPR Credit',servicesOffered:'Category 2 – Recycling',basicAmount:2.4}]};
 quote.items.push(...['Open service', 'Closed service A', 'Closed service B', 'Closed service C'].map(servicesOffered=>({servicesOffered,basicAmount:100})));
 quote.itemClosureStates=['open','open','closed','closed','closed'];
 quote.linkedLeadId='hot-1';
 const closedQuote={...quote,_id:'closed',itemClosureStates:quote.items.map(()=> 'closed')};
 const otherQuote={...quote,_id:'other',linkedLeadId:'hot-2',companyName:'Other company'};
 const unlinkedQuote={...quote,_id:'unlinked',linkedLeadId:null,companyName:'Unlinked company'};
 const leads=[
   {id:'hot-1',kind:'hot',state:'closed',company:'TEST',code:'LEAD-1',owner:'Sales One',createdAt:'2026-11-20',revenuePaise:0},
   {id:'hot-2',kind:'hot',state:'open',company:'Other company',code:'LEAD-2',owner:'Sales Two',createdAt:'2026-11-20',revenuePaise:0}
 ];
 export default {get:async url=>{
 if(url==='/auth/me')return {data:{user:{_id:'staff',role:'admin',email:'staff@example.test'}}};
 if(url==='/leads/summary-dashboard')return {data:{rows:leads}};
 if(url==='/quotations')return {data:{quotations:window.dashboardMode?[quote,closedQuote,otherQuote,unlinkedQuote]:[quote]}};
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
 const tabs = '[aria-label="Quotation list view"] button';
 await page.waitForFunction(selector => {
   const buttons = [...document.querySelectorAll(selector)];
   return buttons.length === 4 && buttons.every(button => button.querySelector('[aria-hidden="true"]')?.textContent === '1');
 }, {}, tabs);
 const ratio = await page.$eval('tbody [title="3 closed / 2 open services"]', el =>
   [...el.querySelectorAll('[aria-hidden="true"]')].map(span => [span.textContent, span.className]));
 assert.deepEqual(ratio, [['3', 'text-emerald-700'], ['/', 'text-slate-400'], ['2', 'text-red-600']]);
 for (const [tab, expected, excluded, status] of [
   ['Open Quotations', 'Open service', 'Closed service A', 'open'],
   ['Closed Quotations', 'Closed service A', 'Open service', 'closed']
 ]) {
   await page.evaluate(label => [...document.querySelectorAll('button')].find(button => button.textContent.trim().startsWith(label)).click(), tab);
   await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.includes('Click to view 1 quotation')).click());
   await page.waitForFunction(text => document.querySelector('table table')?.textContent.includes(text), {}, expected);
   const [text, serviceStatus] = await page.$eval('table table', table => [table.textContent, table.tBodies[0].rows[0].cells[5].textContent.trim()]);
   assert.ok(!text.includes(excluded));
   assert.equal(serviceStatus, status);
 }
 await page.click('#fixture-dashboard');
 await page.waitForFunction(() => document.querySelector('.sales-priority-open-row button:last-child strong')?.textContent === '3');
 await page.locator('.sales-priority-open-row button:last-child').click();
 const popup = 'dialog[open][aria-labelledby="dashboard-open-quotations-title"]';
 await page.waitForSelector(popup);
 await page.addStyleTag({ content: fs.readFileSync(path.resolve(__dirname, '../../frontend/src/styles/lead-pipeline.css'), 'utf8') });
 assert.equal(await page.$eval(popup, el => getComputedStyle(el).animationName), 'dashboard-quote-enter');
 await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
 assert.equal(await page.$eval(popup, el => getComputedStyle(el).animationName), 'none');
 for (const width of [1440, 390]) {
   await page.setViewport({ width, height: 900 });
   const bounds = await page.$eval(popup, el => {
     const { x, width } = el.getBoundingClientRect();
     return { x, width };
   });
   assert.ok(bounds.x > 0 && bounds.width <= Math.min(960, width - 16), JSON.stringify(bounds));
   assert.ok(Math.abs(bounds.x * 2 + bounds.width - width) < 2, JSON.stringify(bounds));
 }
 await page.setViewport({ width: 1440, height: 900 });
 await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
 assert.match(await page.$eval(popup, el => el.textContent), /3 open quotations.*Unlinked company/);
 await page.locator('[aria-label="Close open quotations"]').click();
 await page.waitForSelector(popup, { hidden: true });
 await page.type('input[aria-label="Search pipeline"]', 'LEAD-1');
 await page.waitForFunction(() => document.querySelector('.sales-priority-open-row button:last-child strong')?.textContent === '1');
 await page.locator('.sales-priority-open-row button:last-child').click();
 await page.waitForSelector(popup);
 assert.equal(await page.$eval('#route', el => el.textContent), '/summary-dashboard');
 assert.match(await page.$eval(popup, el => el.textContent), /1 open quotation.*TEST/);
 assert.doesNotMatch(await page.$eval(popup, el => el.textContent), /Other company|Unlinked company/i);
 await page.locator(`${popup} button[aria-expanded="false"]`).click();
 await page.waitForFunction(selector => document.querySelector(selector)?.textContent.includes('Open service'), {}, popup);
 assert.doesNotMatch(await page.$eval(popup, el => el.textContent), /Closed service A/);
 await page.locator(`${popup} li button`).click();
 await page.waitForFunction(() => window.detailsCalls === 3);
 await page.evaluate(() => window.resolveCreditDetails());
 await page.waitForSelector(`${popup} iframe[title="Full quotation document"]`);
 assert.equal(await page.$eval('#dashboard-open-quotations-title', el => el.textContent), 'AT/26-27/526');
 assert.equal(await page.$eval('#route', el => el.textContent), '/summary-dashboard');
 await page.locator('[aria-label="Back to open quotations"]').click();
 await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'View quotation AT/26-27/526');
 await page.locator(`${popup} button[aria-expanded="true"]`).click();
 await page.waitForSelector(`${popup} .dashboard-quotation-disclosure`, { hidden: true });
 await page.type('input[aria-label="Search open quotations"]', 'no results for this search');
 await page.waitForFunction(selector => document.querySelector(selector)?.textContent.includes('No open quotations found.'), {}, popup);
 await page.locator('[aria-label="Clear quotation search"]').click();
 await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Search open quotations');
 assert.deepEqual(errors, []);
 }finally{await browser.close();}
});
