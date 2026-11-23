import { exportWithReason } from './dataExport.mjs'

const clean = (value) => String(value ?? '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim()
const number = (value) => Number(value || 0).toLocaleString('en-IN')
const money = (paise) => `INR ${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const breakdown = (items = []) => items.map((item) => `${clean(item.label)} (${number(item.count)})`).join('\n') || '-'

export function buildSalesDashboardPdfSummary(summary = {}) {
  return {
    hot: [
      ['Lead Open', number(summary.hotOpen)],
      ['Expected Revenue', money(summary.hotExpectedRevenuePaise)],
      ['Open Quotation Value', money(summary.hotQuotationValuePaise)],
      ['Lead Closed', number(summary.hotClosed)],
      ['PO Value', money(summary.hotPoValuePaise)]
    ],
    cold: [
      ['Lead Open', number(summary.coldOpen)],
      ['Expected Revenue', money(summary.coldExpectedRevenuePaise)]
    ]
  }
}

export const salesRepPerformancePdfHeaders = [
  'Sales Representative',
  'Total Leads',
  'Hot Closed',
  'Hot Open',
  'Hot Unassigned',
  'Cold Open',
  'Expected Revenue',
  'PO Value',
  'Traffic Source (Top 3)',
  'Major Service Interest'
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
    money(rep.poValuePaise),
    breakdown(rep.trafficSources),
    breakdown(rep.serviceInterests)
  ])
  rows.push([
    'Grand Total',
    number(totals.totalLeads),
    number(totals.hotClosed),
    number(totals.hotOpen),
    number(totals.hotUnassigned),
    number(totals.coldOpen),
    money(totals.expectedRevenuePaise),
    money(totals.poValuePaise),
    '-',
    '-'
  ])
  return rows
}

export async function createSalesRepPerformancePdf({ reps = [], totals = {}, summary = {}, range, comparisonLabel = '', previousRange } = {}) {
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
    doc.text('Summary Dashboard Report', margin + 5, 20)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(71, 85, 105)
    doc.text(`Lead creation date: ${currentRange} | ${comparison} | Generated ${generatedAt} IST`, margin + 5, 29)
  }

  drawHeading()
  const dashboardSummary = buildSalesDashboardPdfSummary(summary)
  const drawSummaryPanel = ({ title, subtitle, rows, x, y, width, fill, accent }) => {
    doc.setDrawColor(...accent); doc.setFillColor(...fill)
    doc.roundedRect(x, y, width, 36, 3, 3, 'FD')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...accent)
    doc.text(title, x + 4, y + 7)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(100, 116, 139)
    doc.text(subtitle, x + 4, y + 12)
    const slotWidth = (width - 8) / rows.length
    rows.forEach(([label, value], index) => {
      const metricX = x + 4 + slotWidth * index
      if (index) { doc.setDrawColor(218, 228, 232); doc.line(metricX - 2, y + 16, metricX - 2, y + 31) }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.2); doc.setTextColor(100, 116, 139)
      doc.text(clean(label), metricX, y + 21, { maxWidth: slotWidth - 4 })
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.6); doc.setTextColor(30, 41, 59)
      doc.text(clean(value), metricX, y + 29, { maxWidth: slotWidth - 4 })
    })
  }
  drawSummaryPanel({ title: 'Hot Leads', subtitle: 'High priority leads with active engagement', rows: dashboardSummary.hot, x: margin, y: 41, width: 178, fill: [255, 247, 237], accent: [234, 88, 12] })
  drawSummaryPanel({ title: 'Cold Leads', subtitle: 'Nurturing leads for future opportunities', rows: dashboardSummary.cold, x: margin + 184, y: 41, width: pageWidth - margin * 2 - 184, fill: [239, 246, 255], accent: [37, 99, 235] })
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(30, 41, 59)
  doc.text('Sales Rep Performance', margin, 84)
  autoTable(doc, {
    startY: 88,
    margin: { left: margin, right: margin, top: 41, bottom: 15 },
    head: [salesRepPerformancePdfHeaders],
    body: buildSalesRepPerformancePdfRows(reps, totals),
    theme: 'grid',
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    styles: { font: 'helvetica', fontSize: 6.8, cellPadding: 1.8, textColor: [30, 41, 59], lineColor: [218, 228, 232], lineWidth: 0.1, valign: 'middle' },
    headStyles: { fillColor: [7, 122, 97], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 36, fontStyle: 'bold' },
      1: { cellWidth: 16, halign: 'center' },
      2: { cellWidth: 16, halign: 'center' },
      3: { cellWidth: 16, halign: 'center' },
      4: { cellWidth: 18, halign: 'center' },
      5: { cellWidth: 16, halign: 'center' },
      6: { cellWidth: 34, halign: 'right' },
      7: { cellWidth: 34, halign: 'right' },
      8: { cellWidth: 45, fontSize: 6.4 },
      9: { cellWidth: 42, fontSize: 6.4 }
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
