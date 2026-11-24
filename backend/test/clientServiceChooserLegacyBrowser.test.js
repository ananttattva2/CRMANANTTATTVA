const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('../../frontend/node_modules/esbuild');
test('single Brand Owner chooser card opens the saved master while retaining legacy credentials', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/ClientMaster.jsx'), 'utf8');
  const grouping = source.slice(source.indexOf('function clientMasterGroupingIdentity'), source.indexOf('function legacyServiceFingerprintCompatible'));
  const choices = source.slice(source.indexOf('function normalizeChooserServiceCategory'), source.indexOf('function getRelatedClientServices'));
  const modal = source.slice(source.indexOf('function getApplicantCardTheme'), source.indexOf('const emptyClient ='));
  const bundle = await esbuild.build({ stdin: { resolveDir: path.resolve(__dirname, '../../frontend'), loader: 'jsx', contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{Building2,Factory,ShieldCheck,Briefcase,X,MapPin,ChevronRight,Eye,EyeOff}from'lucide-react';const readClientData=r=>r.data||{};const readAssignedServiceId=r=>r.assignedServiceId||'';const getClientServiceViewKey=r=>r._serviceViewKey||r._id||r.clientMasterId;${grouping}\n${choices}\n${modal}\nconst service={assignedServiceId:'annual',applicantType:'PIBO',subApplicantType:'Brand Owner',plantUnit:'Unit 1',eprCategory:'EPR - Plastic Waste',servicesOffered:'Annual Return Filling'};const lead={serviceSelections:[service],clientMasterEligibleServiceIds:['annual']};const records=[{_id:'current-draft',assignedServiceId:'annual',workflowStatus:'draft',data:{}},{_id:'legacy-saved',assignedServiceId:'obsolete',workflowStatus:'submitted',data:{basic:{piboCategory:'Brand Owner',eprCategory:'EPR-PLASTIC'},cpcb:{ceprUserId:'fixture-id',ceprPassword:'fixture-secret'}}}];const options=buildAssignedServiceChooserOptions(records,lead);createRoot(document.getElementById('root')).render(<ClientServiceChooserModal selection={{services:options}} onClose={()=>{}} onSelect={row=>window.selectedMaster=row}/>);` }, bundle: true, write: false, format: 'iife', platform: 'browser' });
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ headless: true, ...(process.env.QUOTATION_CHROME_PATH ? { executablePath: process.env.QUOTATION_CHROME_PATH } : {}), args: process.platform === 'linux' ? ['--no-sandbox'] : [] });
  try {
    const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await page.waitForSelector('article');
    assert.equal((await page.$$('article')).length, 1); const text = await page.$eval('article', node => node.textContent); assert.ok(text.includes('PIBO')); assert.ok(text.includes('Brand Owner')); assert.ok(text.includes('Unit 1')); assert.ok(text.includes('fixture-id')); assert.ok(!text.includes('fixture-secret'));
    await page.click('article button[aria-label="View CEPR password"]'); assert.ok(await page.$eval('article', node => node.textContent.includes('fixture-secret')));
    await page.evaluate(() => [...document.querySelectorAll('article button')].find(button => button.textContent.includes('View Client Master')).click()); await page.waitForFunction(() => window.selectedMaster);
    assert.equal(await page.evaluate(() => window.selectedMaster._id), 'legacy-saved'); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
