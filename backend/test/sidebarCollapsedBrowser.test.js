const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('../../frontend/node_modules/esbuild');

test('collapsing and closing the sidebar flyout does not render a missing section icon', async () => {
  const frontendRoot = path.resolve(__dirname, '../../frontend');
  const bundle = await esbuild.build({
    stdin: {
      resolveDir: frontendRoot,
      loader: 'jsx',
      contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import { MemoryRouter } from 'react-router-dom'; import Sidebar from './src/components/dashboard/Sidebar.jsx'; function TestRoot() { const [collapsed, setCollapsed] = React.useState(false); return <MemoryRouter><Sidebar currentUser={{role:'superadmin'}} collapsed={collapsed} onToggleCollapsed={() => setCollapsed(value => !value)} onClose={() => {}} /></MemoryRouter>; } createRoot(document.getElementById('root')).render(<TestRoot />);`
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    plugins: [{
      name: 'sidebar-test-mocks',
      setup(build) {
        build.onResolve({ filter: /services\/api$/ }, () => ({ path: 'api', namespace: 'sidebar-test' }));
        build.onResolve({ filter: /Sidebar\.css$/ }, () => ({ path: 'css', namespace: 'sidebar-test' }));
        build.onLoad({ filter: /.*/, namespace: 'sidebar-test' }, args => ({
          loader: 'js',
          contents: args.path === 'css' ? '' : 'export default { get: async () => ({ data: { ok: true, count: 0, breakdown: {} } }) };'
        }));
      }
    }]
  });
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ headless: true, ...(process.env.QUOTATION_CHROME_PATH ? { executablePath: process.env.QUOTATION_CHROME_PATH } : {}), args: process.platform === 'linux' ? ['--no-sandbox'] : [] });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForSelector('button[aria-label="Collapse sidebar"]');

    await page.click('button[aria-label="Collapse sidebar"]');
    await page.waitForSelector('button[aria-label="Expand sidebar"]');
    assert.ok(await page.$('button[aria-label="Help & Support"] svg'));

    await page.click('button[aria-label="Help & Support"]');
    await page.waitForSelector('[role="region"][aria-label="Help & Support"]');
    await page.click('[aria-label="Close section"]');
    await page.waitForSelector('[role="region"][aria-label="Help & Support"]', { hidden: true });
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
  }
});
