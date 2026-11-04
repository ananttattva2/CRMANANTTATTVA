const { createApprovedQuotationPdf } = require('../services/quotationDelivery');
(async () => {
  const pdf = await createApprovedQuotationPdf({
    status: 'approved', quotationNumber: 'RENDER-CHECK', createdAt: new Date(),
    leadDetails: { companyName: 'Renderer verification' },
    items: [{ serviceCategory: 'EPR', servicesOffered: 'Compliance', basicAmount: 1000 }],
    grandTotal: 1000, scopeOfWork: Array.from({ length: 25 }, (_, i) => `Scope ${i + 1}: Verify quotation document rendering.`)
  });
  if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid quotation PDF');
  const document = await require('pdf-lib').PDFDocument.load(pdf);
  if (document.getPageCount() !== 3) throw new Error('Quotation continuation page verification failed');
  console.log(`Quotation renderer ready (${pdf.length} bytes)`);
})().catch(error => { console.error('Quotation renderer verification failed:', error.message); process.exitCode = 1; });
