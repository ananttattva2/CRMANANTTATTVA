export const UPLOAD_TRACKER_STAGES = ['Data Explained', 'Data Format Sent', 'Data Received from Client', 'Ready to Upload', 'Client Approval Received', 'Upload Complete', 'Manager Review', 'Compliance Review']
const modules = ['purchase', 'sales']
const stateLabel = (state, index) => state === 'complete' ? index >= 6 ? 'Approved' : 'Completed' : state === 'progress' ? 'In progress' : 'Pending'
const safe = value => /^[=+@-]/.test(String(value || '')) ? `'${value}` : String(value || '')
const ratio = (clients, module, index) => {
  const completed = clients.filter(client => client[module]?.[index] === 'complete').length
  const progress = clients.filter(client => client[module]?.[index] === 'progress').length
  return `${completed}${index >= 6 ? completed === clients.length && clients.length ? '\nApproved' : `\n${clients.length - completed} pending` : progress ? `\n${progress} in progress` : ''}`
}
export function buildUploadTrackerExport(users) {
  const clients = users.flatMap(user => user.clients.map(client => ({ ...client, userName: user.userName })))
  const summaryRow = (name, rows) => [safe(name), rows.length, rows.filter(client => client.slaReceived).length, rows.filter(client => !client.slaReceived).length, ...modules.flatMap(module => UPLOAD_TRACKER_STAGES.map((_, index) => ratio(rows, module, index)))]
  return {
    summaryHeaders: ['User Name', 'Allocated Clients', 'SLA Received', 'SLA Not Received', ...modules.flatMap(module => UPLOAD_TRACKER_STAGES.map(stage => `${module === 'purchase' ? 'Purchase' : 'Sales'} — ${stage}`))],
    summary: [...users.map(user => summaryRow(user.userName, user.clients)), summaryRow('Grand Total', clients)],
    clientHeaders: ['User Name', 'Client Name', 'SLA', ...modules.flatMap(module => UPLOAD_TRACKER_STAGES.map(stage => `${module === 'purchase' ? 'Purchase' : 'Sales'} — ${stage}`))],
    clients: clients.map(client => [safe(client.userName), safe(client.clientName), client.slaReceived ? 'Received' : 'Not received', ...modules.flatMap(module => UPLOAD_TRACKER_STAGES.map((_, index) => stateLabel(client[module]?.[index], index)))])
  }
}
const filename = (scope, year, extension) => `Client-Upload-Tracker-${String(scope || 'All-users').replace(/[^a-zA-Z0-9_-]+/g, '-')}-${year}.${extension}`
export async function createUploadTrackerWorkbook(users, year, scope = 'All users') {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Ananttattva CRM'
  const data = buildUploadTrackerExport(users)
  for (const [name, headers, rows, leading] of [['User Summary', data.summaryHeaders, data.summary, 4], ['Client Details', data.clientHeaders, data.clients, 3]]) {
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', xSplit: leading, ySplit: 5 }] })
    sheet.mergeCells(1, 1, 1, headers.length)
    sheet.getCell('A1').value = 'Client Data & Upload Tracker'
    sheet.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FF17365D' } }
    sheet.getRow(1).height = 32
    sheet.mergeCells(2, 1, 2, headers.length)
    sheet.getCell('A2').value = `${scope} | Data FY ${year} | Generated ${new Date().toISOString()}`
    sheet.getRow(2).height = 24
    sheet.mergeCells(4, leading + 1, 4, leading + 8)
    sheet.mergeCells(4, leading + 9, 4, leading + 16)
    sheet.getCell(4, leading + 1).value = 'Purchase'
    sheet.getCell(4, leading + 9).value = 'Sales'
    headers.forEach((header, index) => { sheet.getCell(5, index + 1).value = header.replace(/^(Purchase|Sales) — /, '') })
    rows.forEach(row => sheet.addRow(row))
    sheet.columns.forEach((column, index) => { column.width = index === 0 ? 27 : name === 'Client Details' && index === 1 ? 43 : 20 })
    sheet.getRow(5).height = 40
    sheet.eachRow((row, number) => {
      if (number < 4) return
      if (number > 5) row.height = 34
      row.eachCell({ includeEmpty: true }, (cell, index) => {
        cell.alignment = { vertical: 'middle', horizontal: index <= leading ? 'left' : 'center', wrapText: true }
        cell.font = { size: 10, color: { argb: 'FF334B6B' }, bold: number <= 5 || name === 'User Summary' && number === sheet.rowCount }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: number <= 5 ? index <= leading ? 'FFF1F5FB' : index <= leading + 8 ? 'FFE4F8F3' : 'FFE7F0FF' : number % 2 ? 'FFF8FAFD' : 'FFFFFFFF' } }
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFE3EAF3' } } }
      })
    })
    sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + rows.length - (name === 'User Summary' ? 1 : 0), column: headers.length } }
    sheet.pageSetup = { orientation: 'landscape', paperSize: 8, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '4:5' }
  }
  return workbook
}
export async function downloadUploadTrackerExcel(users, year, scope) {
  const workbook = await createUploadTrackerWorkbook(users, year, scope)
  const url = URL.createObjectURL(new Blob([await workbook.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const link = document.createElement('a')
  link.href = url; link.download = filename(scope, year, 'xlsx'); document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export async function createUploadTrackerPdf(users, year, { scope = 'All users', clientMode = false } = {}) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'landscape', format: 'a3', compress: true })
  const data = buildUploadTrackerExport(users)
  modules.forEach((module, moduleIndex) => {
    if (moduleIndex) doc.addPage()
    const moduleName = module === 'purchase' ? 'Purchase' : 'Sales'
    const leading = clientMode ? 3 : 4
    const rows = clientMode ? data.clients : data.summary
    const headers = clientMode ? data.clientHeaders : data.summaryHeaders
    const offset = leading + moduleIndex * 8
    const body = rows.map(row => [...row.slice(0, leading), ...row.slice(offset, offset + 8)])
    autoTable(doc, {
      startY: 36, margin: { top: 36, bottom: 20, left: 12, right: 12 },
      head: [[...headers.slice(0, leading), ...UPLOAD_TRACKER_STAGES]], body,
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 3, overflow: 'linebreak', valign: 'middle' },
      headStyles: { fillColor: moduleIndex ? [37, 99, 180] : [15, 118, 110], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [246, 249, 253] },
      columnStyles: clientMode ? { 0: { cellWidth: 36 }, 1: { cellWidth: 66 }, 2: { cellWidth: 26 } } : { 0: { cellWidth: 44 } },
      rowPageBreak: 'avoid', showHead: 'everyPage',
      didDrawPage() {
        doc.setTextColor(23, 47, 89); doc.setFont('helvetica', 'bold'); doc.setFontSize(18)
        doc.text(`Client Data & Upload Tracker - ${moduleName}`, 12, 17)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
        doc.text(`${scope} | Data FY ${year} | ${data.clients.length} assigned companies | Generated ${new Date().toISOString().slice(0, 10)}`, 12, 25)
      }
    })
  })
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFontSize(8); doc.setTextColor(110, 130, 155)
    doc.text('Each company counts once per assigned user. Review status reflects saved approvals.', 12, doc.internal.pageSize.getHeight() - 10)
    doc.text(`${page} / ${pages}`, doc.internal.pageSize.getWidth() - 20, doc.internal.pageSize.getHeight() - 10)
  }
  return doc
}
export async function downloadUploadTrackerPdf(users, year, options) {
  const doc = await createUploadTrackerPdf(users, year, options)
  doc.save(filename(options?.scope, year, 'pdf'))
}
