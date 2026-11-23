import { jsPDF } from 'jspdf'
import proformaStamp from '../assets/proforma-authorized-stamp.png?inline'
export const proformaBankDetails = [
  'Bank Name : IDFC FIRST BANK',
  'Account Name: AnantTattva Private Limited',
  'Account No. 10160512998',
  'IFSC code: IDFB0040111',
  "Company's PAN : AAZCA6657R"
].join('\n')
const CONSULTANCY_BUSINESS_CATEGORIES = new Set(['eprconsultancy', 'eprwastewater', 'otherconsultancy'])
function actualPoNumber(row = {}) {
  const quotationNumber = String(row.quotationNumber || '').trim().toUpperCase()
  const values = [row.poNumber, ...(Array.isArray(row.poYearRows) ? row.poYearRows.map((po) => po?.poNumber || po?.poNo) : [])]
  return values.map((value) => String(value || '').trim()).find((value) => value && value.toUpperCase() !== quotationNumber) || 'NA'
}
export const invoiceFields = [
 ['deliveryNote','Delivery Note'], ['paymentTerms','Mode / Terms of Payment','50% ADVANCE'], ['reference','Reference No. & Date'], ['otherReferences','Other References','AS PER PO'], ['buyerOrder','BuyerÃ¢â‚¬â„¢s Order No.'], ['buyerOrderDate','BuyerÃ¢â‚¬â„¢s Order Date'], ['dispatchDocument','Dispatch Doc No.'], ['deliveryDate','Delivery Note Date'], ['dispatchedThrough','Dispatched Through'], ['destination','Destination'], ['deliveryTerms','Terms of Delivery'], ['consignee','Consignee (Ship To) Name'], ['consigneeAddress','Consignee Address'], ['consigneeGst','Consignee GSTIN / UIN'], ['consigneeState','Consignee State & Code'], ['buyerStateCode','Buyer State Code'], ['hsn','HSN / SAC','999422'], ['bankName','Bank Name'], ['accountName','Account Name','Ananttattva Private Limited'], ['accountNumber','Account Number'], ['ifsc','IFSC Code'], ['pan','Company PAN'], ['declaration','Declaration','We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.']
]
const small = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen']
function words(n) { n = Math.floor(n); if (!n) return 'Zero'; if(n<20)return small[n]; if(n<100)return ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'][Math.floor(n/10)]+(n%10?' '+words(n%10):''); for(const [v,t] of [[10000000,'Crore'],[100000,'Lakh'],[1000,'Thousand'],[100,'Hundred']])if(n>=v)return words(n/v)+' '+t+(n%v?' '+words(n%v):''); return '' }
const currencyWords = n => words(n)+(Math.round((n%1)*100)?' and '+words(Math.round((n%1)*100))+' Paise':'')+' Only'
const itemMultiplier = item => String(item.businessCategory || '').toLowerCase().replace(/[^a-z0-9]/g, '') === 'eprcredit' ? 1 : (Number(item.unit) || 1)
export function buildInvoicePdf(row) {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const details = { ...Object.fromEntries(invoiceFields.map(([key, , value]) => [key, value || ''])), ...(row.invoiceDetails || {}) }
  details.hsn = '999422'
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
  const gstCode = String(lead.gstNumber || '').trim().slice(0, 2)
  const intraState = gstCode === '27'
  const buyerState = [lead.state, /^\d{2}$/.test(gstCode) && 'Code : ' + gstCode].filter(Boolean).join(', ')
  const percentage = row.paymentPercentage ?? 100
  const paymentLabel = `${row.paymentStage === 'later' ? 'Second Payment - Later' : 'First Payment - Advance'} (${percentage}%)`
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
    fitted('1st Floor, Technocraft House,\nA-25, Marol Industrial Estate,\nMIDC, Andheri (East)\nMumbai - 400093\nUDYAM : UDYAM-MH-19-0252978 (Micro/Services)\nGSTIN/UIN: 27AAZCA6657R1ZB\nState Name: Maharashtra, Code: 27\nCIN: U39000MH2023PTC413566\nE-Mail: info@ananttattva.com', left + 3, 39, split - left - 6, 80)
    party('Consignee (Ship To)', lead.companyName || row.companyName, buyerAddress, lead.gstNumber, buyerState, 122, 87)
    party('Buyer (Bill To)', lead.companyName || row.companyName, buyerAddress, lead.gstNumber, buyerState, 209, 87)
    const pairs = [
      ['Invoice No.', row.proformaNumber, 'Dated', date(row.invoiceDate)],
      ['PO Number', actualPoNumber(row), 'Mode/Terms of Payment', paymentLabel]
    ]
    pairs.forEach(([a, b, c, d], index) => {
      cell(a, b, split, 26 + index * 23, 113, 23)
      cell(c, d, 455, 26 + index * 23, 114, 23)
    })
    box(split, 72, right - split, 224)
    text('Terms & Conditions', split + 3, 83, { size: 7 })
    fitted([paymentLabel, ...(row.terms || [])].join('\n'), split + 3, 87, right - split - 6, 200)
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
  const fullBase = combined ? Number(row.combinedBasicAmount ?? row.subtotal ?? 0) : items.reduce((sum, item) => sum + itemMultiplier(item) * Number(item.basicAmount || 0), 0)
  const base = Math.round(fullBase * percentage) / 100
  const tax = Math.round(base * 18) / 100
  items.forEach((item, index) => {
    const title = item.serviceCategory || item.piboCategory || 'Service'
    const businessCategory = String(item.businessCategory || '').trim()
    const businessCategoryKey = businessCategory.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const subApplicantType = String(item.subApplicantType || item.piboCategory || '').trim()
    const specialService = businessCategoryKey === 'eprcredit'
      ? 'Service Charge for Waste Collection & Treatment of Non Hazardous Waste (AMC)'
      : CONSULTANCY_BUSINESS_CATEGORIES.has(businessCategoryKey)
        ? 'CONSULTANCY FEES FOR WASTE COLLECTION AND MANAGEMENT\nUNDER EPR'
        : ''
    const annualReturnService = /\bannual\s*returns?\b|\bAR\b/i.test([item.servicesOffered, item.applicableService].filter(Boolean).join(' '))
    const annualReturnYears = annualReturnService ? [...new Set((item.annualReturnYears || []).filter(Boolean))] : []
    const creditYears = businessCategoryKey === 'eprcredit' ? [...new Set((item.annualReturnEprCreditYears || []).filter(Boolean))] : []
    const serviceYears = creditYears.length ? creditYears.map(value => 'Annual Return EPR Credit: ' + value) : annualReturnYears.length
      ? annualReturnYears.map((value) => 'Annual Return: ' + value)
      : [item.servicesForYear]
    const hideBusinessCategory = CONSULTANCY_BUSINESS_CATEGORIES.has(businessCategoryKey)
    const offered = String(item.servicesOffered || item.applicableService || '').trim()
    const serviceDescription = specialService || offered
    const displayTitle = specialService && subApplicantType ? `${title} for ${subApplicantType}` : title
    font(8.5, 'bold')
    const titleLines = pdf.splitTextToSize(displayTitle, 302)
    const businessCategoryLines = businessCategory ? pdf.splitTextToSize(businessCategory, 302) : []
    font(specialService ? 8.5 : 8, specialService ? 'bold' : 'italic')
    const serviceDescriptionLines = serviceDescription ? pdf.splitTextToSize(serviceDescription, 292) : []
    const serviceYearLines = serviceYears.filter(Boolean).flatMap((value) => pdf.splitTextToSize(String(value), 292))
    const offeredLines = offered ? pdf.splitTextToSize(`FOR ${offered}${subApplicantType ? ' - ' + subApplicantType : ''}`, 292) : []
    const lines = specialService
      ? [
          ...serviceDescriptionLines.map((value) => ({ value, bold: true })),
          ...(hideBusinessCategory ? [] : businessCategoryLines.map((value) => ({ value, bold: true }))),
          ...(hideBusinessCategory && offered ? [] : titleLines.map((value) => ({ value, bold: true }))),
          ...offeredLines.map((value) => ({ value, bold: false })),
          ...serviceYearLines.map((value) => ({ value, bold: false })),
          { value: `${percentage}% OF PO VALUE`, bold: false }
        ]
      : [
          ...businessCategoryLines.map((value) => ({ value, bold: true })),
          ...titleLines.map((value) => ({ value, bold: true })),
          ...serviceDescriptionLines.map((value) => ({ value, bold: false })),
          ...serviceYearLines.map((value) => ({ value, bold: false }))
        ]
    // Keep normal service blocks together instead of orphaning their heading.
    if (y > 329 && lines.length * 9 + 2 <= 229 && y + lines.length * 9 + 2 > 558) {
      bodyBorders(600)
      text('Continued on next page', 566, 594, { size: 7, align: 'right' })
      pdf.addPage(); header(); tableHeader(); y = 329
    }
    let first = true
    for (const entry of lines) {
      if (y > 558) {
        bodyBorders(600)
        text('Continued on next page', 566, 594, { size: 7, align: 'right' })
        pdf.addPage(); header(); tableHeader(); y = 329
      }
      if (first) {
        text(index + 1, 30, y)
        text(details.hsn, 353, y, { size: 7 })
        if (!combined) {
          const credit = businessCategoryKey === 'eprcredit'
          const rawQuantity = Number(String(item.unit || '1').replace(/,/g, '').replace(/[^0-9.]/g, ''))
          const quantityMt = /kg/i.test(String(item.unit)) ? rawQuantity / 1000 : rawQuantity
          text(credit ? quantityMt.toLocaleString('en-IN', { maximumFractionDigits: 3 }) : (item.unit || '1'), 417, y, { align: 'center', size: 7 })
          const rate = item.eprCreditRatePerKg ?? (quantityMt > 0 ? Number(item.basicAmount) / quantityMt / 1000 : 0)
          fitted(credit ? Number(rate).toLocaleString('en-IN', { maximumFractionDigits: 4 }) : cash(Number(item.basicAmount) * percentage / 100), 442, y - 8, 41, 12, 'normal', 7)
        }
        const value = combined ? (index === 0 ? cash(base) : '') : cash(Math.round(itemMultiplier(item) * Number(item.basicAmount || 0) * percentage) / 100)
        text(value, 566, y, { style: 'bold', size: 8, align: 'right' })
        first = false
      }
      text(entry.value, 44, y, { style: entry.bold ? 'bold' : 'italic', size: entry.bold ? 8.5 : 8 })
      y += 9
    }
    y += 2
  })
  bodyBorders(600)
  const taxes = intraState ? [['CGST OUTPUT 9%', 9, Math.round(base * 9) / 100], ['SGST OUTPUT 9%', 9, Math.round((tax - Math.round(base * 9) / 100) * 100) / 100]] : [['IGST OUTPUT 18%', 18, tax]]
  taxes.forEach(([label, rate, value], index) => {
    const yy = Math.min(567, y + 23) + index * 14
    text(label, 346, yy, { style: 'bolditalic', size: 8, align: 'right' })
    text(rate, 482, yy, { style: 'italic', align: 'right' })
    text('%', 494, yy, { size: 7 })
    text(cash(value), 566, yy, { style: 'bold', align: 'right' })
  })
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
  // Group tax rate and amount beneath IGST, or separate CGST / SGST groups.
  const taxStart = intraState ? 358 : 410
  const groupWidth = intraState ? 77 : 100
  const taxableX = intraState ? 305 : 350
  box(left, 636, width, 48)
  line(taxableX, 636, taxableX, 684); line(taxStart, 636, taxStart, 684)
  text('HSN/SAC', (left + taxableX) / 2, 646, { size: 7, align: 'center' })
  text('Taxable', (taxableX + taxStart) / 2, 645, { size: 7, align: 'center' }); text('Value', (taxableX + taxStart) / 2, 655, { size: 7, align: 'center' })
  taxes.forEach(([label, rate, value], index) => {
    const start = taxStart + index * groupWidth, end = start + groupWidth
    line(end, 636, end, 684); line(start + 30, 648, start + 30, 672)
    line(start, 648, end, 648)
    text(label.split(' ')[0], (start + end) / 2, 645, { size: 7, align: 'center' })
    text('Rate', start + 15, 657, { size: 7, align: 'center' }); text('Amount', (start + 30 + end) / 2, 657, { size: 7, align: 'center' })
    text(`${rate}%`, start + 15, 669, { size: 7, align: 'center' })
    text(cash(value), end - 3, 669, { size: 7, align: 'right' })
    text(cash(value), end - 3, 681, { size: 7, style: 'bold', align: 'right' })
  })
  const totalTaxX = taxStart + taxes.length * groupWidth
  text('Total', (totalTaxX + right) / 2, 644, { size: 7, align: 'center' }); text('Tax Amount', (totalTaxX + right) / 2, 655, { size: 7, align: 'center' })
  line(left, 660, right, 660); line(left, 672, right, 672)
  text(details.hsn, 29, 669, { size: 7 }); text(cash(base), taxStart - 3, 669, { size: 7, align: 'right' })
  text('Total', taxableX - 3, 681, { size: 7, style: 'bold', align: 'right' }); text(cash(base), taxStart - 3, 681, { size: 7, style: 'bold', align: 'right' })
  text(cash(tax), right - 3, 669, { size: 7, align: 'right' }); text(cash(tax), right - 3, 681, { size: 7, style: 'bold', align: 'right' })
  box(left, 684, width, 103)
  text('Tax Amount (in words):', 29, 695, { size: 7 })
  fitted('INR ' + currencyWords(tax), 117, 688, 445, 14, 'bold', 8)
  text('Remarks:', 29, 706, { size: 7 })
  proformaBankDetails.split('\n').forEach((value, index) => text(value, 29, 716 + index * 9, { size: 8, style: index === 4 ? 'bold' : 'normal' }))
  text('Declaration', 29, 763, { size: 7 })
  fitted(details.declaration, 29, 765, 268, 20, 'normal', 7)
  box(298, 750, 271, 37)
  pdf.addImage(proformaStamp, 'PNG', 510, 755, 28, 28)
  text('for ANANTTATTVA PRIVATE LIMITED', 566, 759, { size: 7, style: 'bold', align: 'right' })
  text('Authorised Signatory', 566, 783, { size: 7, align: 'right' })
  text('SUBJECT TO MUMBAI JURISDICTION', 297, 798, { size: 7, align: 'center' })
  text('This is a Computer Generated Invoice', 297, 811, { size: 7, align: 'center' })
  return pdf
}
