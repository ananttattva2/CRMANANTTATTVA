const fs = require('node:fs');
const path = require('node:path');
const { invoicePdf } = require('../backend/src/services/proformaEmail');
(async () => {
  const directory = path.join(__dirname, 'pdfs'); fs.mkdirSync(directory, { recursive: true });
  const row = { proformaNumber: 'ATPI/26-27/203', poNumber: 'ATPL/Nov/01', invoiceDate: '2026-11-23', companyName: 'Example Industries Private Limited', paymentPercentage: 50, paymentStage: 'advance', terms: ['50% advance and 50% after completion of work.'], leadDetails: { companyName: 'Example Industries Private Limited', addressLine1: 'Industrial Estate, Phase II', city: 'Ahmedabad', pinCode: '382729', state: 'Gujarat', gstNumber: '24AAPCS0723A1ZT' }, items: [{ businessCategory: 'EPR Consultancy', serviceCategory: 'EPR - Plastic Waste', servicesOffered: 'EPR AR Filing Services', annualReturnYears: ['2025-26'], unit: 1, basicAmount: 22500 }, { businessCategory: 'EPR Consultancy', serviceCategory: 'EPR - Plastic Waste', servicesOffered: 'EPR New Registration', piboCategory: 'Importer of Raw Material', servicesForYear: '2026-27', unit: 1, basicAmount: 25000 }] };
  for (const [name, data] of [['reference-igst', row], ['reference-cgst', { ...row, leadDetails: { ...row.leadDetails, state: 'Maharashtra', gstNumber: '27AAZCA6657R1ZB' } }], ['reference-multipage', { ...row, items: Array.from({ length: 24 }, (_, i) => ({ ...row.items[i % 2], servicesOffered: `Annual Return Filing Service ${i + 1}` })) }]]) {
    fs.writeFileSync(path.join(directory, `${name}.pdf`), await invoicePdf(data));
    console.log(`${name}.pdf generated`);
  }
})();
