const fs = require('node:fs');
const path = require('node:path');
const { __test: { htmlFor } } = require('../backend/src/services/postPoApprovalReminders');
(async () => {
  const { default: puppeteer } = await import('../backend/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js');
  const entries = [
    { lead: { _id: 'a', company: 'Example Industries Private Limited', leadCode: 'ATPL-001' }, tasks: ['manager', 'pi'], approvedAt: new Date('2026-11-21'), approval: { payload: { service: { servicesOffered: 'Annual Return Filing' }, poYearRows: [{ poNumber: 'PO-101' }] }, poReview: { terms: [{ paymentTerm: '50% advance and 50% after completion' }] } } },
    { lead: { _id: 'b', company: 'Example Manufacturing', leadCode: 'ATPL-002' }, tasks: ['pi'], approvedAt: new Date('2026-11-19'), approval: { payload: { service: { servicesOffered: 'New Registration' }, poYearRows: [{ poNumber: 'PO-102' }] }, poReview: { terms: [{ paymentTerm: '100% advance' }] } } }
  ];
  const browser = await puppeteer.launch({ headless: true, executablePath: 'C:/Users/Client/.cache/puppeteer/chrome/win64-156.0.8078.47/chrome-win64/chrome.exe' });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1100 });
    const html = htmlFor({ name: 'Super Admin' }, entries, 'weekly', new Date('2026-11-21T12:00:00Z'));
    fs.writeFileSync(path.join(__dirname, 'post-po-weekly-preview.html'), html);
    await page.setContent(html);
    await page.screenshot({ path: path.join(__dirname, 'post-po-weekly-preview.png'), fullPage: true });
    console.log('Weekly email layout rendered.');
  } finally { await browser.close(); }
})();
