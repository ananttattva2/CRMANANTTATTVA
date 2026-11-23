import { exportWithReason } from './dataExport.mjs'

const clean = (value) => String(value ?? '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim()
const number = (value) => Number(value || 0).toLocaleString('en-IN')
const money = (paise) => `INR ${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const salesRepPerformancePdfHeaders = [
  'Sales Representative',
  'Total Leads',
  'Hot Closed',
  'Hot Open',
  'Hot Unassigned',
  'Cold Open',
  'Expected Revenue',
  'PO Value'
]

export function buildSalesRepPerformancePdfRows(reps = [], totals = {}) {
  const rows = reps.map((rep) => [
    clean(rep.owner),
    number(rep.totalLeads),
    number(rep.hotClosed),
    number(rep.hotOpen),
    number(rep.hotUnassigned),
    number(rep.coldOpen),
    money(rep.expectedRevenuePaise),
    money(rep.poValuePaise)
  ])
  rows.push([
    'Grand Total',
    number(totals.totalLeads),
    number(totals.hotClosed),
    number(totals.hotOpen),
    number(totals.hotUnassigned),
    number(totals.coldOpen),
    money(totals.expectedRevenuePaise),
    money(totals.poValuePaise)
  ])
  return rows
}

export async function createSalesRepPerformancePdf({ reps = [], totals = {}, range, comparisonLabel = '', previousRange } = {}) {
  if (!reps.length) throw new Error('No sales representative records are available for this report.')
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  const margin = 12
  const pageWidth = doc.internal.pageSize.getWidth()
  const generatedAt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date())
  const currentRange = clean(range?.label || 'All lead creation dates')
  const comparison = comparisonLabel && previousRange?.label
    ? `Comparison: previous ${clean(comparisonLabel)} (${clean(previousRange.label)})`
    : 'Current filtered values'

  function drawHeading() {
    doc.setFillColor(239, 250, 247)
    doc.roundedRect(margin, 10, pageWidth - margin * 2, 25, 3, 3, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(7, 88, 72)
    doc.text('Summary Dashboard - Sales Rep Performance', margin + 5, 20)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(71, 85, 105)
    doc.text(`Lead creation date: ${currentRange} | ${comparison} | Generated ${generatedAt} IST`, margin + 5, 29)
  }

  drawHeading()
  autoTable(doc, {
    startY: 41,
    margin: { left: margin, right: margin, top: 41, bottom: 15 },
    head: [salesRepPerformancePdfHeaders],
    body: buildSalesRepPerformancePdfRows(reps, totals),
    theme: 'grid',
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 2.6, textColor: [30, 41, 59], lineColor: [218, 228, 232], lineWidth: 0.1, valign: 'middle' },
    headStyles: { fillColor: [7, 122, 97], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 43, fontStyle: 'bold' },
      1: { cellWidth: 21, halign: 'center' },
      2: { cellWidth: 21, halign: 'center' },
      3: { cellWidth: 21, halign: 'center' },
      4: { cellWidth: 24, halign: 'center' },
      5: { cellWidth: 21, halign: 'center' },
      6: { cellWidth: 43, halign: 'right' },
      7: { cellWidth: 43, halign: 'right' }
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index === reps.length) {
        data.cell.styles.fillColor = [232, 247, 241]
        data.cell.styles.textColor = [7, 88, 72]
        data.cell.styles.fontStyle = 'bold'
      }
    },
    didDrawPage: drawHeading
  })

  const pageCount = doc.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(100, 116, 139)
    doc.text('Anant Tattva CRM | Summary Dashboard', margin, 202)
    doc.text(`${page} / ${pageCount}`, pageWidth - margin, 202, { align: 'right' })
  }
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return { doc, filename: `Sales-Rep-Performance-${day}.pdf` }
}

export async function downloadSalesRepPerformancePdf(data) {
  const { doc, filename } = await createSalesRepPerformancePdf(data)
  await exportWithReason(filename, () => doc.save(filename))
}
