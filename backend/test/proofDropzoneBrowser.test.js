const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('../../frontend/node_modules/esbuild');

test('real proof control handles Outlook virtual/native files for staff and administrators without duplicate uploads', async () => {
  const bundle = await esbuild.build({
    stdin: { resolveDir: path.resolve(__dirname, '../../frontend'), sourcefile: 'proof-dropzone-test.jsx', loader: 'jsx', contents: `
      import React, { useEffect } from 'react';
      import { createRoot } from 'react-dom/client';
      import Dropzone from './src/features/clientMaster/PurchaseProofDropzone.jsx';
      const root = createRoot(document.getElementById('root'));
      function Harness({ scenario, disabled }) {
        useEffect(() => { window.readyScenario = scenario; }, [scenario]);
        return <Dropzone required files={[]} disabled={disabled} onUpload={async files => {
          window.proofUploads.push(await Promise.all(files.map(async file => ({ name: file.name, type: file.type, text: await file.text() }))));
        }} onError={message => window.proofErrors.push(message)} onRemove={() => {}} onPreview={() => {}} />;
      }
      window.renderProof = (scenario, disabled = false) => {
        window.proofUploads = []; window.proofErrors = []; window.readyScenario = '';
        root.render(<Harness key={scenario} scenario={scenario} disabled={disabled} />);
      };
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'isolate-unrelated-preview', setup(build) {
      build.onResolve({ filter: /OutlookMsgViewer$/ }, () => ({ path: 'preview', namespace: 'test-preview' }));
      build.onLoad({ filter: /.*/, namespace: 'test-preview' }, () => ({ contents: 'export const isEmailProof = file => /\\.(eml|msg)$/i.test(file.name || "");' }));
    } }]
  });
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ headless: true, ...(process.env.QUOTATION_CHROME_PATH ? { executablePath: process.env.QUOTATION_CHROME_PATH } : {}), args: ['--disable-dev-shm-usage', ...(process.platform === 'linux' && (process.getuid?.() === 0 || process.env.GITHUB_ACTIONS === 'true') ? ['--no-sandbox'] : [])] });
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const render = async (scenario, disabled = false) => {
      await page.evaluate((scenario, disabled) => window.renderProof(scenario, disabled), scenario, disabled);
      await page.waitForFunction(scenario => window.readyScenario === scenario, {}, scenario);
    };
    for (const role of ['operation', 'sales', 'manager', 'accounts', 'admin', 'superadmin']) {
      await render(role);
      const nativeAllowed = await page.evaluate(() => {
        const file = new File(['Original Outlook email'], 'approval.eml', { type: 'message/rfc822' });
        const transfer = { files: [], types: ['Files'], items: [{ kind: 'file', getAsFile: () => null, getAsFileSystemHandle: async () => ({ kind: 'file', getFile: async () => file }) }] };
        const event = new Event('drop', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: transfer });
        document.querySelector('input[type=file]').dispatchEvent(event);
        return !event.defaultPrevented;
      });
      assert.equal(nativeAllowed, true);
      await page.waitForFunction(() => window.proofUploads.length === 1);
      const files = await page.evaluate(() => window.proofUploads);
      assert.equal(files[0][0].name, 'approval.eml', role);
      assert.equal(files[0][0].text, 'Original Outlook email', role);
    }

    await render('native-materialization');
    await page.evaluate(async () => {
      const input = document.querySelector('input[type=file]');
      const file = new File(['Native email'], 'native.eml', { type: 'message/rfc822' });
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { files: [], items: [{ kind: 'file', getAsFile: () => null, getAsFileSystemHandle: async () => ({ kind: 'file', getFile: () => new Promise(resolve => { window.finishVirtualFile = () => resolve(file); }) }) }] } });
      input.dispatchEvent(event);
      await Promise.resolve();
      const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      window.finishVirtualFile();
    });
    await page.waitForFunction(() => window.proofUploads.length === 1);
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
    assert.equal(await page.evaluate(() => window.proofUploads.length), 1);

    await render('zero-byte-native-placeholder');
    await page.evaluate(async () => {
      const input = document.querySelector('input[type=file]');
      const file = new File(['Complete email'], 'complete.eml', { type: 'message/rfc822' });
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { files: [], items: [{ kind: 'file', getAsFile: () => null, getAsFileSystemHandle: async () => ({ kind: 'file', getFile: () => new Promise(resolve => { window.finishZeroPlaceholder = () => resolve(file); }) }) }] } });
      input.dispatchEvent(event); await Promise.resolve();
      const transfer = new DataTransfer(); transfer.items.add(new File([], file.name, { type: file.type })); input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      window.finishZeroPlaceholder();
    });
    await page.waitForFunction(() => window.proofUploads.length === 1);
    assert.equal(await page.evaluate(() => window.proofUploads[0][0].text), 'Complete email');

    await render('manual-picker-supersedes-drop');
    await page.evaluate(async () => {
      const input = document.querySelector('input[type=file]');
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { files: [], items: [{ kind: 'file', getAsFile: () => null, getAsFileSystemHandle: async () => ({ kind: 'file', getFile: () => new Promise(resolve => { window.finishOldDrop = () => resolve(new File(['Old'], 'old.eml', { type: 'message/rfc822' })); }) }) }] } });
      input.dispatchEvent(event); await Promise.resolve();
      input.addEventListener('click', e => e.preventDefault(), { once: true });
      input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      const transfer = new DataTransfer(); transfer.items.add(new File(['Manual selection'], 'manual.eml', { type: 'message/rfc822' })); input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      window.finishOldDrop();
    });
    await page.waitForFunction(() => window.proofUploads.length === 1);
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
    assert.equal(await page.evaluate(() => window.proofUploads.length), 1);
    assert.equal(await page.evaluate(() => window.proofUploads[0][0].name), 'manual.eml');

    await render('unavailable-source');
    await page.evaluate(() => {
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { files: [], items: [], types: ['text/uri-list'], getData: () => 'https://outlook.office.com/mail/inbox/id/123' } });
      document.querySelector('input[type=file]').dispatchEvent(event);
    });
    await page.waitForSelector('[role=alert]');
    assert.match(await page.$eval('[role=alert]', node => node.textContent), /Outlook did not share/);
    assert.equal(await page.evaluate(() => window.proofUploads.length), 0);
    await page.evaluate(() => {
      const transfer = new DataTransfer(); transfer.items.add(new File(['Saved mail'], 'saved.eml', { type: 'message/rfc822' }));
      const input = document.querySelector('input[type=file]'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => window.proofUploads.length === 1);
    assert.equal(await page.$('[role=alert]'), null);

    await render('read-only', true);
    assert.equal(await page.$('input[type=file]'), null);
    await page.evaluate(() => {
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: new DataTransfer() });
      document.querySelector('[aria-label="Supporting document upload"]').dispatchEvent(event);
    });
    assert.equal(await page.evaluate(() => window.proofUploads.length), 0);
    assert.match(await page.$eval('[role=alert]', node => node.textContent), /permission/);
  } finally { await browser.close(); }
});
