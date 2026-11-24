import { jsPDF } from 'jspdf'
export const invoiceFields = [
 ['deliveryNote','Delivery Note'], ['paymentTerms','Mode / Terms of Payment','50% ADVANCE'], ['reference','Reference No. & Date'], ['otherReferences','Other References','AS PER PO'], ['buyerOrder','BuyerÃ¢â‚¬â„¢s Order No.'], ['buyerOrderDate','BuyerÃ¢â‚¬â„¢s Order Date'], ['dispatchDocument','Dispatch Doc No.'], ['deliveryDate','Delivery Note Date'], ['dispatchedThrough','Dispatched Through'], ['destination','Destination'], ['deliveryTerms','Terms of Delivery'], ['consignee','Consignee (Ship To) Name'], ['consigneeAddress','Consignee Address'], ['consigneeGst','Consignee GSTIN / UIN'], ['consigneeState','Consignee State & Code'], ['buyerStateCode','Buyer State Code'], ['hsn','HSN / SAC','998311'], ['bankName','Bank Name'], ['accountName','Account Name','Ananttattva Private Limited'], ['accountNumber','Account Number'], ['ifsc','IFSC Code'], ['pan','Company PAN'], ['declaration','Declaration','We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.']
]
const small = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen']
function words(n) { n = Math.floor(n); if (!n) return 'Zero'; if(n<20)return small[n]; if(n<100)return ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'][Math.floor(n/10)]+(n%10?' '+words(n%10):''); for(const [v,t] of [[10000000,'Crore'],[100000,'Lakh'],[1000,'Thousand'],[100,'Hundred']])if(n>=v)return words(n/v)+' '+t+(n%v?' '+words(n%v):''); return '' }
const currencyWords = n => words(n)+(Math.round((n%1)*100)?' and '+words(Math.round((n%1)*100))+' Paise':'')+' Only'
export function buildInvoicePdf(row) {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const details = { ...Object.fromEntries(invoiceFields.map(([key, , value]) => [key, value || ''])), ...(row.invoiceDetails || {}) }
  const lead = row.leadDetails || {}
  const left = 26, right = 569, width = right - left, split = 342
  const cash = (value) => Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const date = (value) => {
    if (!value) return ''
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-')
  }
  function font(size = 8, style = 'normal') { pdf.setFont('helvetica', style); pdf.setFontSize(size); pdf.setTextColor(0) }
  function text(value, x, y, options = {}) {
    font(options.size || 8, options.style || 'normal')
    pdf.text(String(value ?? ''), x, y, { align: options.align || 'left' })
  }
  function line(x1, y1, x2, y2) { pdf.setDrawColor(110); pdf.setLineWidth(0.35); pdf.line(x1, y1, x2, y2) }
  function box(x, y, w, h) { pdf.setDrawColor(110); pdf.setLineWidth(0.35); pdf.rect(x, y, w, h) }
  function fitted(value, x, y, w, h, style = 'normal', maxSize = 8) {
    let size = maxSize, lines
    do {
      font(size, style)
      lines = pdf.splitTextToSize(String(value || ''), w)
      if (lines.length * size * 1.12 <= h) break
      size -= 0.25
    } while (size > 4)
    pdf.text(lines, x, y + size, { lineHeightFactor: 1.12 })
  }
  function cell(label, value, x, y, w, h) {
    box(x, y, w, h)
    text(label, x + 3, y + 8, { size: 7 })
    fitted(value, x + 3, y + 10, w - 6, h - 12, 'bold')
  }
  const buyerAddress = [lead.addressLine1, lead.addressLine2, lead.addressLine3, [lead.city, lead.pinCode].filter(Boolean).join(' ')].filter(Boolean).join('\n')
  function party(label, name, address, gst, state, y, h) {
    box(left, y, split - left, h)
    text(label, left + 3, y + 8, { size: 7 })
    fitted(name, left + 3, y + 11, split - left - 6, 13, 'bold', 9)
    fitted([address, 'GSTIN/UIN     : ' + (gst || ''), 'State Name    : ' + (state || '')].join('\n'), left + 3, y + 26, split - left - 6, h - 28)
  }
  function header() {
    text('PROFORMA INVOICE', (left + right) / 2, 20, { style: 'bold', size: 11, align: 'center' })
    box(left, 26, split - left, 96)
    text('ANANTTATTVA PRIVATE LIMITED', left + 3, 37, { style: 'bold', size: 9 })
    fitted('Office No. 14, Midas Building,\nSahar Plaza, J B Nagar, Andheri (East)\nMumbai - 400059\nUDYAM : UDYAM-MH-19-0252978 (Micro/Services)\nGSTIN/UIN: 27AAZCA6657R1ZB\nState Name: Maharashtra, Code: 27\nCIN: U39000MH2023PTC413566\nE-Mail: info@ananttattva.com', left + 3, 39, split - left - 6, 80)
    party('Consignee (Ship To)', details.consignee || lead.companyName || row.companyName, details.consigneeAddress || buyerAddress, details.consigneeGst || lead.gstNumber, details.consigneeState || lead.state, 122, 87)
    party('Buyer (Bill To)', lead.companyName || row.companyName, buyerAddress, lead.gstNumber, [lead.state, details.buyerStateCode && 'Code : ' + details.buyerStateCode].filter(Boolean).join(', '), 209, 87)
    const pairs = [
      ['Invoice No.', row.proformaNumber, 'Dated', date(row.invoiceDate)],
      ['Delivery Note', details.deliveryNote, 'Mode/Terms of Payment', details.paymentTerms],
      ['Reference No. & Date', details.reference || row.quotationNumber, 'Other References', details.otherReferences],
      ["Buyer's Order No.", details.buyerOrder || row.poNumber, 'Dated', date(details.buyerOrderDate)],
      ['Dispatch Doc No.', details.dispatchDocument, 'Delivery Note Date', date(details.deliveryDate)],
      ['Dispatched through', details.dispatchedThrough, 'Destination', details.destination]
    ]
    pairs.forEach(([a, b, c, d], index) => {
      cell(a, b, split, 26 + index * 23, 113, 23)
      cell(c, d, 455, 26 + index * 23, 114, 23)
    })
    cell('Terms of Delivery', details.deliveryTerms, split, 164, right - split, 132)
  }
  const columns = [26, 41, 350, 395, 440, 485, 505, 569]
  function tableHeader() {
    box(left, 296, width, 20)
    columns.slice(1, -1).forEach((x) => line(x, 296, x, 316))
    text('Sl', 29, 304, { size: 7 }); text('No.', 28, 312, { size: 7 })
    text('Description of', 195, 304, { size: 7, align: 'center' }); text('Services', 195, 312, { size: 7, align: 'center' })
    ;['HSN/SAC', 'Quantity', 'Rate', 'per', 'Amount'].forEach((label, index) => text(label, (columns[index + 2] + columns[index + 3]) / 2, 304, { size: 7, align: 'center' }))
  }
  function bodyBorders(bottom) {
    box(left, 316, width, bottom - 316)
    columns.slice(1, -1).forEach((x) => line(x, 316, x, bottom))
  }
  header(); tableHeader()
  let y = 329
  const items = row.items || []
  const combined = row.pricingMode === 'combined'
  const base = combined ? Number(row.combinedBasicAmount ?? row.subtotal ?? 0) : items.reduce((sum, item) => sum + (Number(item.unit) || 1) * Number(item.basicAmount || 0), 0)
  const tax = Math.round(base * 18) / 100
  items.forEach((item, index) => {
    const title = item.serviceCategory || item.piboCategory || 'Service'
    const description = [item.servicesOffered, item.servicesForYear, ...(item.annualReturnYears || []).map((value) => 'Annual Return: ' + value)].filter(Boolean).join('\n')
    font(8.5, 'bold')
    const titleLines = pdf.splitTextToSize(title, 302)
    font(8, 'italic')
    const detailLines = description ? pdf.splitTextToSize(description, 292) : []
    const lines = [...titleLines.map((value) => ({ value, title: true })), ...detailLines.map((value) => ({ value, title: false }))]
    let first = true
    for (const entry of lines) {
      if (y > 552) {
        bodyBorders(600)
        text('Continued on next page', 566, 594, { size: 7, align: 'right' })
        pdf.addPage(); header(); tableHeader(); y = 329
      }
      if (first) {
        text(index + 1, 30, y)
        text(details.hsn, 353, y, { size: 7 })
        if (!combined) {
          text(item.unit || '1', 417, y, { align: 'center', size: 7 })
          fitted(cash(item.basicAmount), 442, y - 8, 41, 12, 'normal', 7)
        }
        const value = combined ? (index === 0 ? cash(base) : '') : cash((Number(item.unit) || 1) * Number(item.basicAmount || 0))
        text(value, 566, y, { style: 'bold', size: 8, align: 'right' })
        first = false
      }
      text(entry.value, entry.title ? 44 : 54, y, { style: entry.title ? 'bold' : 'italic', size: entry.title ? 8.5 : 8 })
      y += 10
    }
    y += 7
  })
  bodyBorders(600)
  text('IGST OUTPUT 18%', 346, Math.min(582, y + 23), { style: 'bolditalic', size: 8, align: 'right' })
  text('18', 482, Math.min(582, y + 23), { style: 'italic', align: 'right' })
  text('%', 494, Math.min(582, y + 23), { size: 7 })
  text(cash(tax), 566, Math.min(582, y + 23), { style: 'bold', align: 'right' })
  box(left, 600, width, 12)
  columns.slice(1, -1).forEach((x) => line(x, 600, x, 612))
  text('Total', 347, 609, { size: 7, align: 'right' })
  font(9, 'bold')
  const symbolX = 566 - pdf.getTextWidth(cash(base + tax)) - 10
  // Draw the rupee sign as vectors so standard PDF fonts render it reliably.
  line(symbolX, 602, symbolX + 6, 602); line(symbolX, 604, symbolX + 6, 604)
  pdf.setDrawColor(0); pdf.setLineWidth(0.6)
  pdf.lines([[2, 1.5], [-0.5, 2], [-3, 0], [4, 4]], symbolX + 2, 602)
  text(cash(base + tax), 566, 609, { size: 9, style: 'bold', align: 'right' })
  box(left, 612, width, 24)
  text('Amount Chargeable (in words)', 29, 620, { size: 7 })
  text('E. & O.E.', 566, 620, { size: 7, style: 'italic', align: 'right' })
  fitted('INR ' + currencyWords(base + tax), 29, 622, width - 8, 13, 'bold', 8)
  const tx = [26, 390, 440, 485, 525, 569]
  box(left, 636, width, 38)
  tx.slice(1, -1).forEach((x) => line(x, x === 485 ? 646 : 636, x, 674))
  line(left, 656, right, 656); line(left, 665, right, 665)
  line(440, 646, 525, 646)
  text('HSN/SAC', 208, 644, { size: 7, align: 'center' })
  text('Taxable', 415, 644, { size: 7, align: 'center' }); text('Value', 415, 653, { size: 7, align: 'center' })
  text('IGST', 482, 644, { size: 7, align: 'center' }); text('Rate', 462, 653, { size: 7, align: 'center' }); text('Amount', 505, 653, { size: 7, align: 'center' })
  text('Total', 547, 644, { size: 7, align: 'center' }); text('Tax Amount', 547, 653, { size: 7, align: 'center' })
  text(details.hsn, 29, 663, { size: 7 })
  for (const [yy, bold] of [[663, false], [672, true]]) {
    text(cash(base), 438, yy, { size: 7, align: 'right', style: bold ? 'bold' : 'normal' })
    if (!bold) text('18%', 482, yy, { size: 7, align: 'right' })
    text(cash(tax), 523, yy, { size: 7, align: 'right', style: bold ? 'bold' : 'normal' })
    text(cash(tax), 567, yy, { size: 7, align: 'right', style: bold ? 'bold' : 'normal' })
  }
  text('Total', 387, 672, { size: 7, align: 'right', style: 'bold' })
  box(left, 674, width, 113)
  text('Tax Amount (in words):', 29, 687, { size: 7 })
  fitted('INR ' + currencyWords(tax), 117, 678, 445, 14, 'bold', 8)
  text('Remarks:', 29, 696, { size: 7 })
  const bank = [details.bankName && 'Bank Name: ' + details.bankName, details.accountName && 'Account Name: ' + details.accountName, details.accountNumber && 'Account No.: ' + details.accountNumber, details.ifsc && 'IFSC Code: ' + details.ifsc, details.pan && "Company's PAN: " + details.pan].filter(Boolean).join('\n')
  fitted(bank, 29, 698, 330, 51, 'normal', 8)
  text('Declaration', 29, 756, { size: 7 })
  fitted(details.declaration, 29, 759, 268, 25, 'normal', 7)
  box(298, 750, 271, 37)
  text('for ANANTTATTVA PRIVATE LIMITED', 566, 759, { size: 7, style: 'bold', align: 'right' })
  text('Authorised Signatory', 566, 783, { size: 7, align: 'right' })
  text('SUBJECT TO MUMBAI JURISDICTION', 297, 798, { size: 7, align: 'center' })
  text('This is a Computer Generated Invoice', 297, 811, { size: 7, align: 'center' })
  return pdf
}
