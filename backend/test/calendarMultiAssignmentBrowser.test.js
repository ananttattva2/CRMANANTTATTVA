const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('../../frontend/node_modules/esbuild');
test('Todo requires Reminder Time and saves multiple selected users', async () => {
  const bundle = await esbuild.build({ stdin: { resolveDir: path.resolve(__dirname, '../../frontend'), loader: 'jsx', contents: `import React from 'react';import{createRoot}from'react-dom/client';import Page from './src/pages/CalendarTodo.jsx';localStorage.setItem('user',JSON.stringify({_id:'507f1f77bcf86cd799439010',name:'Creator',role:'admin'}));createRoot(document.getElementById('root')).render(<Page/>);` }, bundle: true, write: false, outfile: 'calendar.js', platform: 'browser', format: 'iife', define: { 'import.meta.env': '{}' }, plugins: [{ name: 'calendar-fixture', setup(build) {
    build.onResolve({ filter: /DashboardShell$/ }, () => ({ path: 'shell', namespace: 'fixture' }));
    build.onResolve({ filter: /services\/api$/ }, () => ({ path: 'api', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'jsx', contents: args.path === 'shell' ? 'export default function Shell({children}){return children;}' : `export default {get:async url=>({data:url.includes('/auth/')?{users:[{_id:'507f1f77bcf86cd799439011',name:'User One',email:'one@example.test'},{_id:'507f1f77bcf86cd799439012',name:'User Two',email:'two@example.test'}]}:{items:[],clients:[],leads:[],temporaryLeads:[]}}),post:async(url,body)=>{window.savedTodo=body;return {data:{item:{...body,_id:'507f1f77bcf86cd799439099'}}}},put:async(url,body)=>({data:{item:body}})};` }));
  }}] });
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ headless: true, ...(process.env.QUOTATION_CHROME_PATH ? { executablePath: process.env.QUOTATION_CHROME_PATH } : {}), args: process.platform === 'linux' ? ['--no-sandbox'] : [] });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1440, height: 1100 });
    await page.setRequestInterception(true); page.on('request', request => request.respond({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }));
    await page.goto('http://calendar.test');
    const assets = path.resolve(__dirname, '../../frontend/dist/assets');
    if (fs.existsSync(assets)) { const css = fs.readdirSync(assets).find(name => /^index-.*\.css$/.test(name)); if (css) await page.addStyleTag({ content: fs.readFileSync(path.join(assets, css), 'utf8') }); }
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Add Todo'));
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Add Todo').click());
    await page.waitForSelector('.calendar-todo-modal');
    const textInput = await page.$('.calendar-todo-modal input:not([type=time])');
    await textInput.type('Shared team work');
    await page.type('.calendar-update-reason-field textarea', 'Coordinate with both users');
    assert.equal(await page.$eval('.calendar-modal-actions button:last-child', button => button.disabled), true);
    assert.equal(await page.$eval('input[aria-label="Reminder Time"]', input => input.required), true);
    await page.$eval('input[aria-label="Reminder Time"]', input => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '14:30'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('input[placeholder="Select users (multiple allowed)"]');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('User One')));
    for (const name of ['User One', 'User Two']) await page.evaluate(name => [...document.querySelectorAll('button')].find(button => button.textContent.includes(name)).click(), name);
    await page.click('input[aria-label="Reminder Time"]');
    await page.waitForFunction(() => !document.querySelector('.calendar-modal-actions button:last-child').disabled);
    if (process.env.CALENDAR_MULTI_SCREENSHOT) await page.screenshot({ path: process.env.CALENDAR_MULTI_SCREENSHOT, fullPage: true });
    await page.click('.calendar-modal-actions button:last-child');
    await page.waitForFunction(() => window.savedTodo);
    const saved = await page.evaluate(() => window.savedTodo);
    assert.equal(saved.scheduledTime, '14:30');
    assert.deepEqual(saved.assignees.map(user => user.name), ['User One', 'User Two']);
    assert.equal(saved.assignedTo, 'User One, User Two');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

