const clean = (value) => String(value ?? '').replace(/[â€“â€”]/g, '-').replace(/\s+/g, ' ').trim()

export function buildApplicationPortfolioPdfData({ columns = [], groups = [], matches }) {
  const count = (records, key) => records.filter((row) => matches(row, key)).length
  const allRecords = groups.flatMap((group) => group.records || [])
  return {
    head: ['AnantTattva SPOC', ...columns.map(([, label]) => clean(label))],
    body: groups.map((group) => [clean(group.name), ...columns.map(([key]) => count(group.records || [], key))]),
    total: ['Grand Total', ...columns.map(([key]) => count(allRecords, key))]
  }
}

export async function downloadApplicationPortfolioPdf({ title, columns, groups, matches, query = '', generatedAt = new Date() }) {
  if (!groups?.length) throw new Error('No dashboard records are available to export.')
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const table = buildApplicationPortfolioPdfData({ columns, groups, matches })
  const format = table.head.length > 10 ? 'a3' : 'a4'
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format, compress: true })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 12
  const generated = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(generatedAt)

  doc.setFillColor(240, 253, 250)
  doc.roundedRect(margin, 10, pageWidth - margin * 2, 27, 3, 3, 'F')
  doc.setTextColor(15, 118, 110)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.text(clean(title), margin + 5, 21)
  doc.setTextColor(71, 85, 105)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  const filter = query.trim() ? ` | Search: ${clean(query)}` : ''
  doc.text(`Assigned application summary | Generated ${generated} IST${filter}`, margin + 5, 30)

  autoTable(doc, {
    startY: 43,
    head: [table.head],
    body: [...table.body, table.total],
    margin: { left: margin, right: margin, bottom: 15 },
    styles: { font: 'helvetica', fontSize: table.head.length > 10 ? 6.5 : 8, cellPadding: 2.4, overflow: 'linebreak', textColor: [51, 65, 85], lineColor: [226, 232, 240], lineWidth: .1, halign: 'center' },
    headStyles: { fillColor: [225, 245, 240], textColor: [15, 118, 110], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { cellWidth: 44, halign: 'left', fontStyle: 'bold' } },
    didParseCell: (hook) => {
      if (hook.section === 'body' && hook.row.index === table.body.length) {
        hook.cell.styles.fillColor = [239, 246, 249]
        hook.cell.styles.fontStyle = 'bold'
      }
    },
    didDrawPage: () => {
      doc.setDrawColor(226, 232, 240)
      doc.line(margin, pageHeight - 10, pageWidth - margin, pageHeight - 10)
      doc.setFontSize(7)
      doc.setTextColor(100, 116, 139)
      doc.text('Anant Tattva CRM | Application Dashboard', margin, pageHeight - 5)
      doc.text(String(doc.getNumberOfPages()), pageWidth - margin, pageHeight - 5, { align: 'right' })
    }
  })

  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(generatedAt)
  doc.save(`${clean(title).replace(/[^a-z0-9]+/gi, '-')}-${day}.pdf`)
}
