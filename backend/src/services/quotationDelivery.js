const fs = require('fs');
const path = require('path');
const { buildCompanySignature, getIntroductionLogoAttachment } = require('./leadIntroductionEmail');
const documentTemplate = () => import('../../../frontend/src/utils/quotationDocument.mjs');

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function isApproved(quotation) {
  // The current status is authoritative: historical approval metadata survives revisions.
  return ['admin_approved', 'approved'].includes(String(quotation.status).toLowerCase());
}
function clientEmailContent(subject, body) {
  const signature = buildCompanySignature();
  return { subject, html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#111827;font-size:15px;line-height:1.7"><div>${escapeHtml(body).replace(/\r?\n/g, '<br/>')}</div>${signature}</div>`, logo: getIntroductionLogoAttachment() };
}
async function quotationFilename(quotation) {
  return (await documentTemplate()).quotationFilename(quotation);
}

let renderTail = Promise.resolve();
let pendingRenders = 0;
async function renderApprovedQuotation(quotation) {
  const [{ default: puppeteer }, template] = await Promise.all([import('puppeteer'), documentTemplate()]);
  const logo = fs.readFileSync(path.join(__dirname, '../../../frontend/public/ananttattva-logo.png')).toString('base64');
  const html = template.buildQuotationPrintHtml(quotation, { logoSource: `data:image/png;base64,${logo}` });
  const browser = await puppeteer.launch({
    headless: true,
    ...(process.env.QUOTATION_CHROME_PATH ? { executablePath: process.env.QUOTATION_CHROME_PATH } : {}),
    args: ['--disable-dev-shm-usage', ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
    timeout: 30000,
    protocolTimeout: 45000
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (/^(?:data:|about:blank$)/.test(request.url())) request.continue();
      else request.abort();
    });
    await page.emulateMediaType('print');
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode()));
    });
    await page.evaluate(template.paginateQuotationDocument);
    const sections = await page.evaluate(() => [...document.querySelectorAll('main.page')].map(section => section.outerHTML));
    const { PDFDocument } = require('pdf-lib');
    const output = await PDFDocument.create();
    output.setTitle(quotation.quotationNumber || 'Quotation');
    output.setAuthor('AnantTattva Private Limited');
    for (const section of sections) {
      // Render each designed sheet at the origin. This avoids Chromium grid
      // fragmentation clipping a continuation heading or the beginning of a row.
      await page.evaluate(markup => { document.body.innerHTML = markup; }, section);
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
      const bytes = await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true, timeout: 30000 });
      const sheet = await PDFDocument.load(bytes);
      const pages = await output.copyPages(sheet, sheet.getPageIndices());
      pages.forEach(sheetPage => output.addPage(sheetPage));
    }
    return Buffer.from(await output.save());
  } finally { await browser.close(); }
}
function createApprovedQuotationPdf(quotation) {
  if (!isApproved(quotation)) return Promise.reject(Object.assign(new Error('Admin approval is required before generating this PDF.'), { status: 403 }));
  if (pendingRenders >= 4) return Promise.reject(Object.assign(new Error('Quotation rendering is busy. Please retry shortly.'), { status: 503 }));
  pendingRenders++;
  const job = renderTail.then(() => renderApprovedQuotation(quotation)).finally(() => { pendingRenders--; });
  renderTail = job.catch(() => {});
  return job;
}
module.exports = { escapeHtml, isApproved, clientEmailContent, quotationFilename, createApprovedQuotationPdf };
