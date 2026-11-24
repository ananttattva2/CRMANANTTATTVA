// Use physical A4 dimensions and an isolated document, independent of CRM CSS.
const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 10;
const CONTENT_WIDTH = 718; // 190 mm at 96 CSS pixels per inch.

export function quotationPageRanges(height, pageHeight, breakpoints = []) {
  const points = [...new Set(breakpoints)].filter((point) => point > 0 && point <= height).sort((a, b) => a - b);
  const ranges = [];
  let start = 0;
  while (start < height) {
    const limit = Math.min(height, start + pageHeight);
    let end = limit;
    if (limit < height) {
      const candidates = points.filter((point) => point > start && point <= limit);
      const candidate = candidates[candidates.length - 1];
      // An individual block taller than a page must still make forward progress.
      if (candidate > start + pageHeight * 0.25) end = candidate;
    }
    ranges.push({ start, end });
    start = end;
  }
  return ranges;
}

function pageBreakpoints(page) {
  const origin = page.getBoundingClientRect().top;
  const atomic = [...page.querySelectorAll('tr, .scope-row, .header, .top, .to, .footer, .important, .terms p')];
  const protectedRanges = atomic.map((element) => {
    let bottom = element.getBoundingClientRect().bottom;
    if (element.tagName === 'TR') {
      // Combined pricing cells span several rows and must stay on the same page.
      const span = Math.max(1, ...[...element.cells].map((cell) => cell.rowSpan));
      const rows = [...element.parentElement.rows];
      const lastRow = rows[Math.min(rows.length - 1, rows.indexOf(element) + span - 1)];
      bottom = lastRow.getBoundingClientRect().bottom;
    }
    return { top: element.getBoundingClientRect().top - origin, bottom: bottom - origin };
  });
  // Keep the breakpoint on the exact block boundary. Adding pixels here places
  // a row's boundary inside the following row, so every table-row candidate is
  // rejected by the protected-range check. The paginator then falls back to
  // the address block and leaves most of page one blank.
  return [...new Set(protectedRanges.map(({ bottom }) => bottom))]
    .filter((point) => !protectedRanges.some(({ top, bottom }) => point > top + 0.5 && point < bottom - 0.5));
}

function whitespaceBoundary(canvas, point, minimum, maximum) {
  const top = Math.max(minimum, Math.floor(point) - 16);
  const bottom = Math.min(maximum, canvas.height - 1, Math.ceil(point) + 16);
  if (bottom < top) return point;
  const pixels = canvas.getContext('2d').getImageData(0, top, canvas.width, bottom - top + 1).data;
  const clearRows = [];
  for (let y = top; y <= bottom; y += 1) {
    let clear = true;
    for (let x = 0; x < canvas.width; x += 1) {
      const index = ((y - top) * canvas.width + x) * 4;
      if (pixels[index + 3] && Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) < 245) { clear = false; break; }
    }
    if (clear) clearRows.push(y);
  }
  return clearRows.sort((a, b) => Math.abs(a - point) - Math.abs(b - point))[0] ?? point;
}

async function prepareLogo(image, processedLogo) {
  if (processedLogo) image.src = processedLogo;
  await image.decode();
  if (processedLogo) return;
  const canvas = image.ownerDocument.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < data.data.length; index += 4) {
    const red = data.data[index], green = data.data[index + 1], blue = data.data[index + 2];
    const dominance = green - Math.max(red, blue);
    if (green > 75 && dominance > 14) {
      data.data[index + 3] *= dominance >= 75 ? 0 : 1 - (dominance - 14) / 61;
      data.data[index + 1] = Math.min(green, Math.max(red, blue));
    }
  }
  context.putImageData(data, 0, 0);
  image.src = canvas.toDataURL('image/png');
  await image.decode();
}

export async function createQuotationPdf(html, processedLogo = '') {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const frame = document.createElement('iframe');
  frame.title = 'Quotation PDF rendering';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;visibility:hidden;pointer-events:none;zoom:1';
  try {
    const ready = new Promise((resolve, reject) => {
      frame.onload = resolve;
      frame.onerror = () => reject(new Error('Quotation print document failed to load'));
    });
    frame.srcdoc = html;
    document.body.appendChild(frame);
    await ready;
    const printDocument = frame.contentDocument;
    const style = printDocument.createElement('style');
    style.textContent = `html,body{width:${CONTENT_WIDTH}px!important;margin:0!important;min-height:0!important;zoom:1!important;background:white}.page{width:${CONTENT_WIDTH}px!important;min-height:0!important;margin:0!important;padding:0 0 8px!important}.scope-page{padding-top:0!important}.page tr,.scope-row{break-inside:avoid}.scope-page-title{break-after:avoid}`;
    printDocument.head.appendChild(style);
    await Promise.all([...printDocument.querySelectorAll('img')].map((image) => prepareLogo(image, processedLogo)));
    await printDocument.fonts.ready;
    // The iframe owns its fonts, image bounds, and viewport; CRM zoom stays intact.
    await new Promise((resolve) => frame.contentWindow.requestAnimationFrame(resolve));
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const printableWidth = PAGE_WIDTH - 2 * MARGIN;
    const printableHeight = PAGE_HEIGHT - 2 * MARGIN;
    let pageCount = 0;
    for (const page of printDocument.querySelectorAll('main.page')) {
      const bounds = page.getBoundingClientRect();
      const canvas = await html2canvas(page, {
        scale: 2,
        width: CONTENT_WIDTH,
        height: Math.ceil(Math.max(bounds.height, page.scrollHeight)),
        windowWidth: 794,
        windowHeight: Math.max(1123, Math.ceil(bounds.height)),
        scrollX: 0,
        scrollY: 0,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false
      });
      const pixelsPerMm = canvas.width / printableWidth;
      const pagePixels = Math.floor(printableHeight * pixelsPerMm);
      const breakpoints = pageBreakpoints(page).map((point) => Math.ceil(point * canvas.height / bounds.height));
      let start = 0;
      while (start < canvas.height) {
        const range = quotationPageRanges(canvas.height - start, pagePixels, breakpoints.map((point) => point - start))[0];
        let end = start + range.end;
        if (end < canvas.height) end = whitespaceBoundary(canvas, end, start + 1, start + pagePixels);
        if (pageCount++) pdf.addPage();
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = end - start;
        slice.getContext('2d').drawImage(canvas, 0, start, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
        pdf.addImage(slice.toDataURL('image/png'), 'PNG', MARGIN, MARGIN, printableWidth, slice.height / pixelsPerMm, undefined, 'FAST');
        start = end;
      }
    }
    if (!pageCount) throw new Error('Quotation has no printable pages');
    return pdf;
  } finally {
    frame.remove();
  }
}
