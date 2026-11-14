const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('../../frontend/node_modules/esbuild');


test('receipt tracker accepts checkbox first, then enables matching proof upload', async () => {
 const bundle = await esbuild.build({stdin:{resolveDir:path.resolve(__dirname,'../../frontend'),loader:'jsx',contents:`
 import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
 import Tracker from './src/features/clientMaster/SalesUploadChecklist.jsx';
 function Harness(){const [rows,setRows]=useState(['Data Explained','Data Format Sent','Received from client','Ready to upload'].map(particular=>({particular,yesNo:'Yes',files:[]})));
 window.rows=rows;return <Tracker checklist={rows} canEdit onError={message=>window.error=message} onChange={(i,patch)=>{window.changed=patch;setRows(items=>items.map((r,j)=>j===i?{...r,...patch}:r));}} onUploadProof={(i,files,stage)=>setRows(items=>items.map((r,j)=>j===i?{...r,files:[...r.files,...files.map(f=>({name:f.name,url:'https://example.com/'+f.name,receiptStage:stage}))]}:r))} onRemoveProof={()=>{}} onPreview={()=>{}}/>;}
 createRoot(document.getElementById('root')).render(<Harness/>);`},bundle:true,write:false,format:'iife',platform:'browser',loader:{'.css':'text'},plugins:[{name:'preview',setup(build){build.onResolve({filter:/OutlookMsgViewer$/},()=>({path:'preview',namespace:'mock'}));build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const isEmailProof = () => false;'}));}}]});
 const {default:puppeteer}=await import('puppeteer');
 const browser=await puppeteer.launch({headless:true,...(process.env.QUOTATION_CHROME_PATH?{executablePath:process.env.QUOTATION_CHROME_PATH}:{}),args:process.platform==='linux'&&(process.getuid?.()===0||process.env.GITHUB_ACTIONS==='true')?['--no-sandbox']:[]});
 try {const page=await browser.newPage();await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles.find(f=>f.text.includes('createRoot')).text});await page.waitForSelector('.ut-table');await page.addStyleTag({content:require('node:fs').readFileSync(path.resolve(__dirname,'../../frontend/src/features/clientMaster/uploadTracker.css'),'utf8')});
 assert.deepEqual(await page.$$eval('thead th',els=>els.map(el=>el.textContent)),['Sr. No.','Particular','Status','Upload Proof','Data Status','Upload Date','Actions']);
 assert.equal(await page.$$eval('.ut-expand',els=>els.length),2);
 await page.evaluate(()=>document.querySelectorAll('input[type=checkbox]')[0].click());
 await page.waitForFunction(()=>window.rows[2].partialDataReceived===true);
 assert.equal(await page.$eval('input[type=checkbox]',el=>el.checked),true);
 assert.equal(await page.$eval('.ut-expand',el=>el.getAttribute('aria-expanded')),'true');
 await page.evaluate(()=>{const input=document.querySelector('section[aria-label="Received from client partial receipt evidence"] input[type=file]');const transfer=new DataTransfer();transfer.items.add(new File(['proof'],'partial.pdf',{type:'application/pdf'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.waitForFunction(()=>window.rows[2].files.length===1);
 await page.waitForFunction(()=>window.rows[2].partialDataReceived===true);
 if (process.env.RECEIPT_SCREENSHOT) { await page.setViewport({width:1500,height:1100}); await page.screenshot({path:process.env.RECEIPT_SCREENSHOT,fullPage:true}); }
 await page.evaluate(()=>document.querySelectorAll('input[type=checkbox]')[1].click());
 assert.equal(await page.$eval('input[type=checkbox]',el=>el.checked),true);
 assert.equal(await page.evaluate(()=>window.rows[2].completeDataReceived||false),true);
 await page.evaluate(()=>document.querySelector('.ut-expand').click());
 assert.equal(await page.$eval('.ut-expand',el=>el.getAttribute('aria-expanded')),'false');
 }finally{await browser.close();}
});
