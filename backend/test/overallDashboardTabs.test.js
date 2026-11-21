const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('../../frontend/node_modules/esbuild');

test('Overall Dashboard restores all view tabs and switches to their panels', async () => {
  const frontendRoot = path.resolve(__dirname, '../../frontend');
  const mocks = {
    pageReadSnapshot: 'export const readPageSnapshot = () => null; export const savePageSnapshot = () => {};',
    useCrmRefresh: 'export default function useCrmRefresh() {}',
    api: 'export default { get: async () => ({ data: {} }) }',
    DashboardShell: 'import React from "react"; export default function Shell({ children }) { return <div>{children}</div> }',
    ApplicationPortfolio: 'import React from "react"; export default function Portfolio({ mode, pendingOnly }) { return <div id={`portfolio-${mode}`} data-pending-only={String(pendingOnly)}>{mode}</div> }',
    POMonthlyDashboard: 'import React from "react"; export default function PO() { return <div id="po-monthly-panel">PO Dashboard panel</div> }',
    ClientUploadTracker: 'import React from "react"; export default function Upload() { return <div id="upload-tracker-panel">Purchase and Sales panel</div> }',
    PdfExportChoice: 'import React from "react"; export default function PdfChoice() { return null }',
    UserServiceMatrix: 'import React from "react"; export default function Matrix() { return null }',
    FinancialYearTimeline: 'import React from "react"; export default function Timeline() { return null }',
    OverallClientPopup: 'import React from "react"; export default function Popup() { return null }',
    InlineApplicantClients: 'import React from "react"; export default function Clients() { return null }',
    recharts: 'import React from "react"; export const BarChart = () => null; export const Bar = () => null; export const LineChart = () => null; export const Line = () => null; export const XAxis = () => null; export const YAxis = () => null; export const CartesianGrid = () => null; export const Tooltip = () => null; export const Legend = () => null; export const ResponsiveContainer = () => null;'
  };
  const bundle = await esbuild.build({
    stdin: {
      resolveDir: frontendRoot,
      loader: 'jsx',
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom'; import OverallDashboard from './src/pages/OverallDashboard'; const mount=(id,entry)=>createRoot(document.getElementById(id)).render(<MemoryRouter initialEntries={[entry]}><OverallDashboard/></MemoryRouter>); mount('root','/overall-dashboard'); mount('pending-root','/overall-dashboard?view=pending-applications');`
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    plugins: [{
      name: 'dashboard-test-mocks',
      setup(build) {
        build.onResolve({ filter: /pageReadSnapshot|useCrmRefresh|\/api$|DashboardShell|ApplicationPortfolio|POMonthlyDashboard|ClientUploadTracker|PdfExportChoice|UserServiceMatrix|FinancialYearTimeline|OverallClientPopup|InlineApplicantClients|recharts$/ }, args => ({ path: args.path, namespace: 'dashboard-mock' }));
        build.onLoad({ filter: /.*/, namespace: 'dashboard-mock' }, args => ({ contents: mocks[path.basename(args.path)], loader: 'jsx', resolveDir: frontendRoot }));
      }
    }]
  });
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body><div id="root"></div><div id="pending-root"></div></body></html>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForSelector('#dashboard-tab-status');
    await page.waitForFunction(() => document.querySelector('#root #portfolio-status')?.getAttribute('data-pending-only') === 'false' && document.querySelector('#pending-root #portfolio-status')?.getAttribute('data-pending-only') === 'true');
    assert.equal(await page.$eval('#root h1', heading => heading.textContent), 'Application Dashboard');
    assert.equal(await page.$eval('#pending-root h1', heading => heading.textContent), 'Pending Applications');
    assert.deepEqual(await page.$$eval('#root [role="tablist"][aria-label="Dashboard view"] [role="tab"]', tabs => tabs.map(tab => tab.textContent.trim())), [
      'Application Status Summary',
      'Application Service Summary',
      'By SPOC & PIBo',
      'Purchase & Sales Dashboard',
      'PO Dashboard'
    ]);

    for (const [tab, panel] of [['services', '#portfolio-services'], ['spoc', '#portfolio-spoc'], ['upload', '#upload-tracker-panel'], ['po', '#po-monthly-panel'], ['status', '#portfolio-status']]) {
      await page.click(`#root #dashboard-tab-${tab}`);
      await page.waitForFunction((selectedTab, selectedPanel) => document.querySelector(`#root #${selectedTab}`).getAttribute('aria-selected') === 'true' && document.querySelector(`#root ${selectedPanel}`), {}, `dashboard-tab-${tab}`, panel);
    }
  } finally {
    await browser.close();
  }
});
