import { formatDisplayDate, formatDisplayDateTime } from './dateFormat'

function money(value) {
  return `INR ${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

function pdfDepartmentBreakdown(rows = []) {
  const grouped = new Map()
  for (const row of rows) {
    const sourceName = String(row.department || 'No team assigned').trim()
    const department = /^team\s*[ab]$/i.test(sourceName) ? 'Operation' : sourceName
    const current = grouped.get(department) || {
      department, leadCount: 0, convertedLeads: 0, closedDeals: 0,
      approvedQuotationValue: 0, actual: 0, target: null
    }
    current.leadCount += Number(row.leadCount) || 0
    current.convertedLeads += Number(row.convertedLeads) || 0
    current.closedDeals += Number(row.closedDeals) || 0
    current.approvedQuotationValue += Number(row.approvedQuotationValue) || 0
    current.actual += Number(row.actual) || 0
    if (row.target !== null && row.target !== undefined && Number.isFinite(Number(row.target))) {
      current.target = (current.target || 0) + Number(row.target)
    }
    grouped.set(department, current)
  }
  return [...grouped.values()].map((row) => ({
    ...row,
    conversionRate: row.leadCount ? Math.round((row.convertedLeads / row.leadCount) * 1000) / 10 : 0,
    avgDealValue: row.closedDeals ? Math.round((row.actual / row.closedDeals) * 100) / 100 : 0
  }))
}

function downloadBlob(buffer, type, fileName) {
  const blob = new Blob([buffer], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function safeDate(value) {
  return String(value || '').replace(/[^0-9-]/g, '')
}

function drawCarryForwardInfographic(pdf, rows, startY, meta = {}) {
  const activeRows = (rows || []).filter((row) => row.totalAvailable || row.closedThisMonth || row.closingPending)
  const latest = activeRows[activeRows.length - 1]
  if (!latest) return startY
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(15, 23, 42)
  pdf.setFontSize(10)
  pdf.text(`${latest.month} Lead Movement Snapshot`, 17, startY)
  const cards = [
    { label: 'OPENING PENDING', value: latest.openingPending, color: [245, 158, 11], text: [69, 26, 3], operator: '' },
    { label: 'NEW LEADS', value: latest.newLeads, color: [14, 165, 233], text: [255, 255, 255], operator: '+' },
    { label: 'TOTAL AVAILABLE', value: latest.totalAvailable, color: [99, 102, 241], text: [255, 255, 255], operator: '=' },
    { label: 'TOTAL CLOSED', value: latest.closedThisMonth, color: [16, 185, 129], text: [255, 255, 255], operator: '-' },
    { label: 'CLOSING PENDING', value: latest.closingPending, color: [239, 68, 68], text: [255, 255, 255], operator: '=' }
  ]
  const cardWidth = 46
  const cardHeight = 24
  const gap = 8
  const cardY = startY + 5
  cards.forEach((card, index) => {
    const x = 17 + (index * (cardWidth + gap))
    if (card.operator) {
      pdf.setTextColor(71, 85, 105)
      pdf.setFontSize(14)
      pdf.text(card.operator, x - (gap / 2), cardY + 14, { align: 'center' })
    }
    pdf.setFillColor(...card.color)
    pdf.roundedRect(x, cardY, cardWidth, cardHeight, 3, 3, 'F')
    pdf.setTextColor(...card.text)
    pdf.setFontSize(7)
    pdf.text(card.label, x + (cardWidth / 2), cardY + 7, { align: 'center' })
    pdf.setFontSize(16)
    pdf.text(String(card.value || 0), x + (cardWidth / 2), cardY + 18, { align: 'center' })
  })
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(71, 85, 105)
  pdf.setFontSize(7.5)
  pdf.text('Previous balance + new business - approved PO closures = balance carried to next month', 17, cardY + cardHeight + 5)
  if (meta.legacyBulkCutoff) {
    pdf.setTextColor(180, 83, 9)
    pdf.setFont('helvetica', 'bold')
    pdf.text(`Historical bulk uploads through ${meta.legacyBulkCutoff} are classified as old leads in opening pending.`, 17, cardY + cardHeight + 9)
  }
  return cardY + cardHeight + (meta.legacyBulkCutoff ? 13 : 9)
}

function drawCarryForwardChart(pdf, rows, startY) {
  const chartRows = (rows || []).filter((row) => row.totalAvailable || row.closedThisMonth || row.closingPending).slice(-12)
  if (!chartRows.length) {
    pdf.setFontSize(9)
    pdf.text('No lead movement recorded for the selected period.', 12, startY + 8)
    return startY + 14
  }
  const left = 18
  const top = startY + 8
  const width = 264
  const height = 62
  const bottom = top + height
  const maximum = Math.max(1, ...chartRows.flatMap((row) => [row.totalAvailable, row.closedThisMonth, row.closingPending]))
  pdf.setFontSize(7)
  pdf.setTextColor(100, 116, 139)
  for (let step = 0; step <= 4; step += 1) {
    const y = bottom - ((height / 4) * step)
    const value = Math.round((maximum / 4) * step)
    pdf.setDrawColor(226, 232, 240)
    pdf.line(left, y, left + width, y)
    pdf.text(String(value), left - 3, y + 1, { align: 'right' })
  }
  const slot = width / chartRows.length
  const barWidth = Math.min(7, slot * 0.28)
  const closingPoints = []
  const closedPoints = []
  chartRows.forEach((row, index) => {
    const center = left + (slot * index) + (slot / 2)
    const scale = (value) => (Number(value || 0) / maximum) * height
    const openingHeight = scale(row.openingPending)
    const newHeight = scale(row.newLeads)
    pdf.setFillColor(245, 158, 11)
    pdf.rect(center - (barWidth / 2), bottom - openingHeight, barWidth, openingHeight, 'F')
    pdf.setFillColor(14, 165, 233)
    pdf.rect(center - (barWidth / 2), bottom - openingHeight - newHeight, barWidth, newHeight, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(6.5)
    if (openingHeight > 7) {
      pdf.setTextColor(255, 255, 255)
      pdf.text(String(row.openingPending || 0), center, bottom - (openingHeight / 2) + 1, { align: 'center' })
    }
    if (newHeight > 7) {
      pdf.setTextColor(255, 255, 255)
      pdf.text(String(row.newLeads || 0), center, bottom - openingHeight - (newHeight / 2) + 1, { align: 'center' })
    }
    pdf.setTextColor(15, 23, 42)
    pdf.text(String(row.totalAvailable || 0), center, bottom - openingHeight - newHeight - 2, { align: 'center' })
    closedPoints.push([center, bottom - scale(row.closedThisMonth)])
    closingPoints.push([center, bottom - scale(row.closingPending)])
    pdf.setTextColor(71, 85, 105)
    pdf.text(String(row.month || '').slice(2), center, bottom + 5, { align: 'center' })
  })
  pdf.setDrawColor(5, 150, 105)
  pdf.setLineWidth(0.8)
  closedPoints.slice(1).forEach((point, index) => pdf.line(closedPoints[index][0], closedPoints[index][1], point[0], point[1]))
  closedPoints.forEach(([x, y], index) => {
    pdf.setFillColor(5, 150, 105)
    pdf.circle(x, y, 1.2, 'F')
    pdf.setTextColor(4, 120, 87)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(6.5)
    pdf.text(String(chartRows[index].closedThisMonth || 0), x, y - 2, { align: 'center' })
  })
  pdf.setDrawColor(239, 68, 68)
  closingPoints.slice(1).forEach((point, index) => pdf.line(closingPoints[index][0], closingPoints[index][1], point[0], point[1]))
  closingPoints.forEach(([x, y], index) => {
    pdf.setFillColor(239, 68, 68)
    pdf.circle(x, y, 1.2, 'F')
    pdf.setTextColor(220, 38, 38)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(6.5)
    pdf.text(String(chartRows[index].closingPending || 0), x, y + 4, { align: 'center' })
  })
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(71, 85, 105)
  pdf.setFontSize(7)
  pdf.text('Number of Leads', 7, top + (height / 2), { align: 'center', angle: 90 })
  pdf.text('Month', left + (width / 2), bottom + 9, { align: 'center' })
  const legendY = bottom + 15
  const legend = [
    ['Previous Pending', [245, 158, 11]], ['New Leads', [14, 165, 233]],
    ['Total Closed', [5, 150, 105]], ['Closing Pending', [239, 68, 68]]
  ]
  let legendX = left
  legend.forEach(([label, color]) => {
    pdf.setFillColor(...color)
    pdf.rect(legendX, legendY - 2.5, 3, 3, 'F')
    pdf.setTextColor(51, 65, 85)
    pdf.text(label, legendX + 5, legendY)
    legendX += 58
  })
  const latest = chartRows[chartRows.length - 1]
  const previous = chartRows[chartRows.length - 2]
  const available = Number(latest.totalAvailable) || 0
  const closureRate = available ? ((Number(latest.closedThisMonth) || 0) / available) * 100 : 0
  const insight = previous
    ? `Key insight: Total available leads ${available >= Number(previous.totalAvailable || 0) ? 'increased' : 'decreased'} from ${previous.totalAvailable || 0} in ${previous.month} to ${available} in ${latest.month}. Closure rate: ${closureRate.toFixed(1)}%; ${latest.closingPending || 0} carried forward.`
    : `Key insight: ${available} leads were available in ${latest.month}. Closure rate: ${closureRate.toFixed(1)}%; ${latest.closingPending || 0} carried forward.`
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(7.5)
  const insightLines = pdf.splitTextToSize(insight, width - 8)
  const insightHeight = Math.max(10, (insightLines.length * 4) + 4)
  pdf.setFillColor(240, 249, 255)
  pdf.roundedRect(left, legendY + 5, width, insightHeight, 2, 2, 'F')
  pdf.setTextColor(12, 74, 110)
  pdf.text(insightLines, left + 4, legendY + 11)
  return legendY + insightHeight + 9
}

function drawClosureBreakdown(pdf, rows, startY) {
  const chartRows = (rows || []).filter((row) => row.totalAvailable || row.closedThisMonth || row.closingPending).slice(-12)
  const latest = chartRows[chartRows.length - 1] || {}
  const left = 18
  const top = startY + 12
  const width = 170
  const height = 56
  const bottom = top + height
  const maximum = Math.max(1, ...chartRows.map((row) => Number(row.closedThisMonth) || 0))
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(15, 23, 42)
  pdf.setFontSize(14)
  pdf.text('Lead Closure Breakdown', 10, startY)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(100, 116, 139)
  pdf.setFontSize(8)
  pdf.text('Monthly closures split between carried-forward leads and newly generated leads.', 10, startY + 5)
  for (let step = 0; step <= 4; step += 1) {
    const y = bottom - ((height / 4) * step)
    pdf.setDrawColor(226, 232, 240)
    pdf.line(left, y, left + width, y)
    pdf.setFontSize(7)
    pdf.text(String(Math.round((maximum / 4) * step)), left - 3, y + 1, { align: 'right' })
  }
  const slot = width / Math.max(1, chartRows.length)
  const barWidth = Math.min(11, slot * 0.5)
  chartRows.forEach((row, index) => {
    const center = left + (slot * index) + (slot / 2)
    const scale = (value) => (Number(value || 0) / maximum) * height
    const openingHeight = scale(row.closedFromOpening)
    const newHeight = scale(row.closedFromNew)
    pdf.setFillColor(59, 130, 246)
    pdf.rect(center - (barWidth / 2), bottom - openingHeight, barWidth, openingHeight, 'F')
    pdf.setFillColor(101, 196, 123)
    pdf.rect(center - (barWidth / 2), bottom - openingHeight - newHeight, barWidth, newHeight, 'F')
    pdf.setTextColor(71, 85, 105)
    pdf.text(String(row.month || '').slice(2), center, bottom + 5, { align: 'center' })
  })
  pdf.setFillColor(59, 130, 246)
  pdf.rect(left, bottom + 10, 3, 3, 'F')
  pdf.setTextColor(51, 65, 85)
  pdf.text('Closed From Opening', left + 5, bottom + 12.5)
  pdf.setFillColor(101, 196, 123)
  pdf.rect(left + 48, bottom + 10, 3, 3, 'F')
  pdf.text('Closed From New', left + 53, bottom + 12.5)
  const available = Number(latest.totalAvailable) || 0
  const closureRate = available ? ((Number(latest.closedThisMonth) || 0) / available) * 100 : 0
  const pendingRate = available ? ((Number(latest.closingPending) || 0) / available) * 100 : 0
  pdf.setFillColor(240, 253, 250)
  pdf.roundedRect(202, top, 76, 25, 3, 3, 'F')
  pdf.setTextColor(4, 120, 87)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.text('CLOSURE RATE', 240, top + 8, { align: 'center' })
  pdf.setFontSize(17)
  pdf.text(`${closureRate.toFixed(1)}%`, 240, top + 19, { align: 'center' })
  pdf.setFillColor(255, 251, 235)
  pdf.roundedRect(202, top + 31, 76, 25, 3, 3, 'F')
  pdf.setTextColor(180, 83, 9)
  pdf.setFontSize(8)
  pdf.text('PENDING RATE', 240, top + 39, { align: 'center' })
  pdf.setFontSize(17)
  pdf.text(`${pendingRate.toFixed(1)}%`, 240, top + 50, { align: 'center' })
  pdf.setTextColor(71, 85, 105)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.text(`${latest.month || ''}: ${latest.closedThisMonth || 0} closed, ${latest.closingPending || 0} pending`, 240, top + 64, { align: 'center' })
  return bottom + 18
}

export async function exportSalesManagementExcel(data) {
  const module = await import('exceljs')
  const ExcelJS = module.default || module
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'AnantTattva CRM'
  workbook.created = new Date()

  const summary = workbook.addWorksheet('Executive Summary')
  summary.columns = [{ width: 32 }, { width: 24 }, { width: 60 }]
  summary.addRow(['Sales Team Management Details Report'])
  summary.mergeCells('A1:C1')
  summary.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } }
  summary.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF087A70' } }
  summary.addRow(['Period', `${formatDisplayDate(data.meta?.dateFrom)} to ${formatDisplayDate(data.meta?.dateTo)}`])
  summary.addRow([])
  summary.addRow(['Metric', 'Value', 'Definition'])
  summary.addRows([
    ['Total Leads', data.summary?.totalLeads || 0, 'Old Leads + New Leads in the selected period'],
    ['Old Leads', data.summary?.oldLeads || 0, data.meta?.definitions?.oldLead || ''],
    ['New Leads', data.summary?.newLeads || 0, data.meta?.definitions?.newLead || ''],
    ['Conversion Rate', `${data.summary?.conversionRate || 0}%`, data.meta?.definitions?.conversion || ''],
    ['Confirmed PO Revenue', Number(data.summary?.confirmedRevenue || 0), data.meta?.definitions?.revenue || ''],
    ['Old Business Leads', data.summary?.oldBusinessLeads || 0, data.meta?.definitions?.oldBusiness || ''],
    ['Old PO Value', Number(data.summary?.oldBusinessPoValue || 0), data.meta?.definitions?.oldBusiness || ''],
    ['New Business Leads', data.summary?.newBusinessLeads || 0, data.meta?.definitions?.newBusiness || ''],
    ['New CRM Quotation Value', Number(data.summary?.newBusinessQuotationValue || 0), data.meta?.definitions?.newBusiness || ''],
    ['New PO Value', Number(data.summary?.newBusinessPoValue || 0), data.meta?.definitions?.newBusiness || ''],
    ['Closed Service Deals', data.summary?.closedDeals || 0, data.meta?.definitions?.closedDeal || ''],
    ['Approved Quotation Value', Number(data.summary?.approvedQuotationValue || 0), data.meta?.definitions?.quotationValue || '']
  ])
  summary.addRow([])
  summary.addRow(['At-Risk Indicators'])
  summary.addRow(['Stalled Quotations', data.riskIndicators?.stalledQuotations || 0, 'Awaiting action for more than 30 days'])
  summary.addRow(['Low-Conversion Managers', data.riskIndicators?.lowConversionManagers || 0])
  summary.addRow(['Overdue Follow-Ups', data.riskIndicators?.overdueFollowUps || 0])
  summary.addRow([])
  summary.addRow(['Top 3 Performing Managers'])
  ;(data.insights?.topManagers || []).forEach((row, index) => summary.addRow([`${index + 1}. ${row.managerName}`, `${row.conversionRate}%`, money(row.confirmedRevenue)]))
  summary.addRow([])
  summary.addRow(['Recommendations'])
  ;(data.insights?.recommendations || []).forEach((item) => summary.addRow([item]))
  summary.getColumn(2).numFmt = '#,##0.00'

  const managers = workbook.addWorksheet('Lead Owner Performance')
  managers.columns = [
    { header: 'Lead Owner', key: 'leadOwnerName', width: 28 }, { header: 'Reporting Manager', key: 'reportingManagerName', width: 28 },
    { header: 'Role', key: 'role', width: 18 },
    { header: 'Department', key: 'department', width: 22 }, { header: 'Total Leads', key: 'totalLeads', width: 14 },
    { header: 'Old Leads', key: 'oldLeads', width: 14 }, { header: 'New Leads', key: 'newLeads', width: 14 },
    { header: 'Open Quotations', key: 'openQuotations', width: 18 }, { header: 'Approved Quotations', key: 'approvedQuotations', width: 20 },
    { header: 'Converted Leads', key: 'convertedToSale', width: 17 }, { header: 'Closed Service Deals', key: 'closedDeals', width: 20 },
    { header: 'Conversion %', key: 'conversionRate', width: 15 }, { header: 'Approved Quote Value', key: 'approvedQuotationValue', width: 22 },
    { header: 'Old Business Leads', key: 'oldBusinessLeads', width: 20 }, { header: 'Old PO Value', key: 'oldBusinessPoValue', width: 18 },
    { header: 'New Business Leads', key: 'newBusinessLeads', width: 20 }, { header: 'New CRM Quote Value', key: 'newBusinessQuotationValue', width: 22 },
    { header: 'New PO Value', key: 'newBusinessPoValue', width: 18 }, { header: 'Total Approved PO Value', key: 'confirmedRevenue', width: 22 },
    { header: 'Status', key: 'status', width: 14 }
  ]
  managers.addRows(data.managerPerformance || [])
  managers.getColumn('approvedQuotationValue').numFmt = '#,##0.00'
  managers.getColumn('oldBusinessPoValue').numFmt = '#,##0.00'
  managers.getColumn('newBusinessQuotationValue').numFmt = '#,##0.00'
  managers.getColumn('newBusinessPoValue').numFmt = '#,##0.00'
  managers.getColumn('confirmedRevenue').numFmt = '#,##0.00'

  const trend = workbook.addWorksheet('Monthly Trend')
  trend.columns = [
    { header: 'Month', key: 'month', width: 14 }, { header: 'Open', key: 'open', width: 12 },
    { header: 'Quotation Open', key: 'quotationOpen', width: 18 }, { header: 'Quotation Approved', key: 'quotationApproved', width: 21 },
    { header: 'Converted / Closed', key: 'converted', width: 20 }, { header: 'Quotation Closed', key: 'quotationClosed', width: 20 },
    { header: 'Conversion %', key: 'conversionRate', width: 16 }
  ]
  trend.addRows(data.monthlyTrend || [])

  const departments = workbook.addWorksheet('Department Breakdown')
  departments.columns = [
    { header: 'Department', key: 'department', width: 24 }, { header: 'Lead Count', key: 'leadCount', width: 14 },
    { header: 'Conversion %', key: 'conversionRate', width: 16 }, { header: 'Average Deal Value', key: 'avgDealValue', width: 21 },
    { header: 'Approved Quote Value', key: 'approvedQuotationValue', width: 22 }, { header: 'Target', key: 'target', width: 16 },
    { header: 'Actual Revenue', key: 'actual', width: 20 }
  ]
  departments.addRows(data.departmentBreakdown || [])
  ;[summary, managers, trend, departments].forEach((sheet) => {
    const headerRow = sheet === summary ? sheet.getRow(4) : sheet.getRow(1)
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF087A70' } }
    sheet.views = [{ state: 'frozen', ySplit: sheet === summary ? 4 : 1 }]
  })
  downloadBlob(
    await workbook.xlsx.writeBuffer(),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    `sales-management-${safeDate(data.meta?.dateFrom)}-${safeDate(data.meta?.dateTo)}.xlsx`
  )
}

export async function exportSalesManagementPdf(data) {
  const [{ jsPDF }, tableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const autoTable = tableModule.default || tableModule.autoTable
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  pdf.setFillColor(8, 122, 112)
  pdf.rect(0, 0, 297, 29, 'F')
  pdf.setTextColor(255, 255, 255)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(18)
  pdf.text('Sales Team Management Details Report', 10, 13)
  pdf.setFontSize(9)
  pdf.text(`${formatDisplayDate(data.meta?.dateFrom)} to ${formatDisplayDate(data.meta?.dateTo)} | Generated ${formatDisplayDateTime(new Date())}`, 10, 21)
  pdf.setTextColor(15, 23, 42)
  autoTable(pdf, {
    startY: 35,
    head: [['Total Leads', 'Conversion', 'Old Leads', 'Old PO Value', 'New Leads', 'New Quote Value', 'New PO Value', 'Total PO Value']],
    body: [[data.summary?.totalLeads || 0, `${data.summary?.conversionRate || 0}%`, data.summary?.oldLeads || 0, money(data.summary?.oldBusinessPoValue), data.summary?.newLeads || 0, money(data.summary?.newBusinessQuotationValue), money(data.summary?.newBusinessPoValue), money(data.summary?.confirmedRevenue)]],
    headStyles: { fillColor: [16, 185, 129] }
  })
  autoTable(pdf, {
    startY: pdf.lastAutoTable.finalY + 8,
    head: [
      [
        { content: 'Lead Owner', rowSpan: 2, styles: { valign: 'middle' } },
        { content: 'Reports To', rowSpan: 2, styles: { valign: 'middle' } },
        { content: 'Leads', colSpan: 4, styles: { halign: 'center' } },
        { content: 'Quotation Value', colSpan: 1, styles: { halign: 'center' } },
        { content: 'PO Value', colSpan: 3, styles: { halign: 'center' } }
      ],
      ['Total', 'Converted', 'Old', 'New', 'New', 'Old', 'New', 'Total']
    ],
    body: (data.managerPerformance || []).map((row) => [
      row.leadOwnerName || row.managerName, row.reportingManagerName || '-',
      row.totalLeads, row.convertedToSale, row.oldLeads, row.newLeads,
      money(row.newBusinessQuotationValue), money(row.oldBusinessPoValue),
      money(row.newBusinessPoValue), money(row.confirmedRevenue)
    ]),
    headStyles: { fillColor: [8, 122, 112], halign: 'center' },
    columnStyles: { 0: { halign: 'left' }, 1: { halign: 'left' } },
    styles: { fontSize: 8 }, alternateRowStyles: { fillColor: [240, 253, 250] }
  })
  pdf.addPage()
  pdf.setFontSize(15)
  pdf.setFont('helvetica', 'bold')
  pdf.text('Monthly Lead Carry-Forward', 10, 14)
  const infographicEnd = drawCarryForwardInfographic(pdf, data.monthlyCarryForward || [], 20, data.meta || {})
  drawCarryForwardChart(pdf, data.monthlyCarryForward || [], infographicEnd)
  pdf.addPage()
  const closureBreakdownEnd = drawClosureBreakdown(pdf, data.monthlyCarryForward || [], 16)
  autoTable(pdf, {
    startY: closureBreakdownEnd + 4,
    head: [['Month', 'Opening Pending', 'New Leads', 'Total Available', 'Closed From Opening', 'Closed From New', 'Total Closed', 'Closing Pending']],
    body: (data.monthlyCarryForward || []).map((row) => [row.month, row.openingPending, row.newLeads, row.totalAvailable, row.closedFromOpening, row.closedFromNew, row.closedThisMonth, row.closingPending]),
    headStyles: { fillColor: [245, 158, 11], textColor: [69, 26, 3] }
  })
  pdf.setFontSize(13)
  pdf.text('Pipeline Trend', 10, pdf.lastAutoTable.finalY + 7)
  autoTable(pdf, {
    startY: pdf.lastAutoTable.finalY + 11,
    head: [['Month', 'Open', 'Quote Open', 'Quote Approved', 'Converted / Closed', 'Quote Closed', 'Conversion %']],
    body: (data.monthlyTrend || []).map((row) => [row.month, row.open, row.quotationOpen, row.quotationApproved, row.converted, row.quotationClosed, `${row.conversionRate}%`]),
    headStyles: { fillColor: [16, 185, 129] }
  })
  autoTable(pdf, {
    startY: pdf.lastAutoTable.finalY + 8,
    head: [['Department', 'Leads', 'Conversion %', 'Average Deal', 'Approved Quote Value', 'Actual Revenue', 'Target']],
    body: pdfDepartmentBreakdown(data.departmentBreakdown).map((row) => [row.department, row.leadCount, `${row.conversionRate}%`, money(row.avgDealValue), money(row.approvedQuotationValue), money(row.actual), row.target ?? 'Not configured']),
    headStyles: { fillColor: [8, 122, 112] }
  })
  const recommendationY = Math.min(190, pdf.lastAutoTable.finalY + 10)
  pdf.setFontSize(12)
  pdf.text('Recommendations', 10, recommendationY)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  ;(data.insights?.recommendations || []).forEach((item, index) => pdf.text(`- ${item}`, 12, recommendationY + 7 + (index * 6)))
  pdf.save(`sales-management-${safeDate(data.meta?.dateFrom)}-${safeDate(data.meta?.dateTo)}.pdf`)
}

export async function exportQuotationMisPdf(quotations = [], period = {}) {
  const [{ jsPDF }, tableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const autoTable = tableModule.default || tableModule.autoTable
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  const rows = [...quotations].sort((left, right) => new Date(right.quotationDate || right.createdAt || 0) - new Date(left.quotationDate || left.createdAt || 0))
  const approved = rows.filter((row) => String(row.status || '').toLowerCase() === 'approved')
  pdf.setFillColor(8, 122, 112)
  pdf.rect(0, 0, 297, 29, 'F')
  pdf.setTextColor(255, 255, 255)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(18)
  pdf.text('Quotation Management MIS', 10, 13)
  pdf.setFontSize(9)
  pdf.text(`${formatDisplayDate(period.dateFrom)} to ${formatDisplayDate(period.dateTo)} | Generated ${formatDisplayDateTime(new Date())}`, 10, 21)
  pdf.setTextColor(15, 23, 42)
  autoTable(pdf, {
    startY: 35,
    head: [['Total Quotations', 'Approved', 'Open', 'Rejected', 'Approved Quote Value']],
    body: [[
      rows.length,
      approved.length,
      rows.filter((row) => ['draft', 'submitted', 'sent'].includes(String(row.status || '').toLowerCase())).length,
      rows.filter((row) => String(row.status || '').toLowerCase() === 'rejected').length,
      money(approved.reduce((sum, row) => sum + (Number(row.grandTotal) || 0), 0))
    ]],
    headStyles: { fillColor: [16, 185, 129] }
  })
  autoTable(pdf, {
    startY: pdf.lastAutoTable.finalY + 8,
    head: [['Quotation', 'Company', 'Prepared By', 'Status', 'Date', 'Quote Value']],
    body: rows.map((row) => [
      row.quotationNumber || '-', row.companyName || row.leadDetails?.companyName || '-',
      row.preparedBy || row.createdByName || '-', row.status || 'draft',
      formatDisplayDate(row.quotationDate || row.createdAt),
      money(row.grandTotal)
    ]),
    headStyles: { fillColor: [8, 122, 112] }, styles: { fontSize: 8 }, alternateRowStyles: { fillColor: [240, 253, 250] }
  })
  pdf.save(`quotation-mis-${safeDate(period.dateFrom)}-${safeDate(period.dateTo)}.pdf`)
}
