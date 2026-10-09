const headers = ['Unique ID', 'Legal Name', 'Client Status', 'Visibility', 'CPCB Status', 'PIBo Category', 'State', 'Created', 'Lead ID', 'Industry', 'Service Category', 'Services Offered', 'Unit']
export async function createApplicationPortfolioWorkbook(records, name, label) {
  const imported = await import('exceljs')
  const ExcelJS = imported.default || imported
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'AnantTattva CRM'
  const safe = value => { const text = String(value ?? ''); return /^[=+\-@]/.test(text) ? `'${text}` : text }
  const values = row => [row.code, row.name, row.clientStatus, row.visibility, row.cpcb, row.category, row.state, row.created ? new Date(row.created).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }) : 'Not recorded', row.leadCode, row.industry, row.eprCategory, row.offered, row.unit].map(safe)
  const sheets = [['Clients', records], ['Service Statuses', records.flatMap(row => row.services || [row])]]
  for (const [title, rows] of sheets) {
    const sheet = workbook.addWorksheet(title, { views: [{ state: 'frozen', ySplit: 3 }] })
    sheet.addRow([safe(name), safe(label)])
    sheet.addRow([`${records.length} clients exported`, `${rows.length} records`])
    sheet.addRow(headers)
    rows.forEach(row => sheet.addRow(values(row)))
    sheet.columns.forEach((column, index) => { column.width = [23, 48, 20, 18, 30, 36, 25, 18, 25, 25, 30, 35, 20][index] })
    sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: sheet.rowCount, column: headers.length } }
    sheet.getRow(3).eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF187F80' } } })
    sheet.eachRow(row => { row.alignment = { vertical: 'top', wrapText: true } })
  }
  return workbook
}
export async function downloadApplicationPortfolioExcel(records, name, label) {
  const workbook = await createApplicationPortfolioWorkbook(records, name, label)
  const url = URL.createObjectURL(new Blob([await workbook.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${name}-${label}-${new Date().toISOString().slice(0, 10)}`.replace(/[^a-z0-9_-]/gi, '-') + '.xlsx'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
