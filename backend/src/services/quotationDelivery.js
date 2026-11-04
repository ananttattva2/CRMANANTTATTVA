const PDFDocument = require('pdfkit');
const path = require('path');
const { buildCompanySignature, getIntroductionLogoAttachment } = require('./leadIntroductionEmail');

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
function quotationFilename(quotation) {
  return `${String(quotation.quotationNumber || 'quotation').replace(/[^a-z0-9-]/gi, '-')}.pdf`;
}
function createApprovedQuotationPdf(quotation) {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true, info: { Title: quotation.quotationNumber || 'Quotation', Author: 'AnantTattva Private Limited' } });
    const chunks = [];
    pdf.on('data', chunk => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    try {
      const width = 511;
      const text = value => String(value ?? '').replace(/₹/g, 'INR ');
      const section = title => { if (pdf.y + 75 > pdf.page.height - pdf.page.margins.bottom) pdf.addPage(); pdf.moveDown(); pdf.font('Helvetica-Bold').fontSize(12).fillColor('#ea580c').text(title); pdf.moveDown(.4); pdf.fillColor('#172033').font('Helvetica').fontSize(10); };
      pdf.image(path.join(__dirname, '../../../frontend/public/ananttattva-logo.png'), 42, 34, { fit: [145, 64] });
      pdf.font('Helvetica-Bold').fontSize(24).fillColor('#ea580c').text('QUOTATION', 310, 46, { width: 243, align: 'right' });
      pdf.fontSize(10).fillColor('#172033').text(text(quotation.quotationNumber), 310, 78, { width: 243, align: 'right' });
      pdf.y = 118; pdf.x = 42;
      pdf.font('Helvetica-Bold').fontSize(12).text('AnantTattva Private Limited');
      pdf.font('Helvetica').fontSize(9).text('1st Floor, A/25, Technocraft House, Road No.3, MIDC, Andheri East, Mumbai 400093', { width });
      pdf.text('GST Number: 27AAZCA6657R1ZB');
      if (quotation.fromName || quotation.leadGeneratedBy) pdf.text(`From: ${text(quotation.fromName || quotation.leadGeneratedBy)}`);
      const details = quotation.leadDetails || {};
      section('Prepared for');
      [details.companyName || quotation.companyName, [details.salutation, details.contactPerson, details.designation].filter(Boolean).join(' '), details.mobileNo1 && `Mobile: ${details.mobileNo1}`, details.addressLine1, details.addressLine2, details.addressLine3, [details.city, details.state, details.pinCode].filter(Boolean).join(', '), details.gstNumber && `GST Number: ${details.gstNumber}`].filter(Boolean).forEach(line => pdf.text(text(line), { width }));
      pdf.moveDown(.5).text(`Quotation date: ${new Date(quotation.quotationDate || quotation.createdAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' })}`);
      if (quotation.validUntil) pdf.text(`Valid until: ${text(quotation.validUntil)}`);
      section('Services & professional fees');
      for (const [index, item] of (quotation.items || []).entries()) {
        const name = [item.serviceCategory || item.eprCategory, item.servicesOffered || item.applicableService, item.subApplicantType || item.piboCategory, item.registrationYear || item.financialYear].filter(Boolean).join(' | ');
        const lines = [`${index + 1}. ${name}`, [item.serviceStartDate && `From ${item.serviceStartDate}`, item.serviceEndDate && `To ${item.serviceEndDate}`, item.annualReturnYears?.length && `Annual returns: ${item.annualReturnYears.join(', ')}`, item.unitName && `Unit: ${item.unitName}`].filter(Boolean).join(' | ')];
        if (quotation.pricingMode !== 'combined') lines.push(`Quantity: ${item.unit || 1}    Basic fee: INR ${Number(item.basicAmount || 0).toLocaleString('en-IN')}`);
        const block = lines.filter(Boolean).join('\n');
        const height = pdf.heightOfString(block, { width }) + 16;
        if (pdf.y + height > 750) pdf.addPage();
        pdf.fontSize(10).text(text(block), { width, paragraphGap: 4 }); pdf.moveDown(.7);
      }
      if (quotation.pricingMode === 'combined') {
        for (const group of quotation.combinedPricingGroups || []) pdf.text(`${text(group.name || 'Combined services')}: INR ${Number(group.basicAmount || 0).toLocaleString('en-IN')}`, { width });
      }
      section('Quotation value');
      pdf.font('Helvetica-Bold').fontSize(14).text(`Total professional fees: INR ${Number(quotation.grandTotal || quotation.subtotal || 0).toLocaleString('en-IN')}`, { width });
      pdf.font('Helvetica').fontSize(10).text('GST tax will be extra @ 18%.');
      pdf.text('Any Government Charges to be paid by Client directly.');
      if (quotation.paymentTerm) { section('Payment terms'); pdf.text(text(quotation.paymentTerm), { width }); }
      if (quotation.terms?.length) { section('Terms & conditions'); quotation.terms.forEach((line, i) => pdf.text(`${i + 1}. ${text(line)}`, { width, paragraphGap: 6 })); }
      if (quotation.scopeOfWork?.length) { section('Scope of work'); quotation.scopeOfWork.forEach((line, i) => pdf.text(`${i + 1}. ${text(line)}`, { width, paragraphGap: 6 })); }
      section('Prepared by'); pdf.text(text(quotation.preparedByName || quotation.fromName || quotation.createdByName || 'Team AnantTattva'));
      pdf.moveDown().fontSize(9).text('For more details: info@ananttattva.com | +91 8169727341 / 9004005520', { width });
      pdf.text('This is a computer-generated quotation and does not require a signature.', { width });
      const pages = pdf.bufferedPageRange();
      for (let page = 0; page < pages.count; page++) {
        pdf.switchToPage(page); pdf.fontSize(8).fillColor('#64748b').text(`AnantTattva Private Limited | ${text(quotation.quotationNumber)} | Page ${page + 1} of ${pages.count}`, 42, 790, { width, lineBreak: false, align: 'center' });
      }
      pdf.end();
    } catch (error) { pdf.destroy(); reject(error); }
  });
}
module.exports = { escapeHtml, isApproved, clientEmailContent, quotationFilename, createApprovedQuotationPdf };
