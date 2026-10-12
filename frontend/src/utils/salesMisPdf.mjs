import { buildSalesMisReport } from './salesMisReport.mjs'

const reportDate = (value) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value || '') : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(date)
}

async function loadLogo() {
  try {
    const response = await fetch('/ananttattva-logo.png')
    if (!response.ok) return null
    const blob = await response.blob()
    return new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => resolve(null); reader.readAsDataURL(blob) })
  } catch { return null }
}

export async function downloadSalesMisInfographicPdf({ rows = [], period = {} }) {
  const [{ jsPDF }, autoTableModule, logo] = await Promise.all([import('jspdf'), import('jspdf-autotable'), loadLogo()])
  const autoTable = autoTableModule.default || autoTableModule.autoTable
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  const { totals, groups, owners, ranked, openLeaders, focusOpen, focusPercent } = buildSalesMisReport(rows)
  const green = [7, 88, 72], orange = [249, 115, 22], slate = [51, 65, 85]

  pdf.setFillColor(247, 250, 249); pdf.rect(0, 0, 297, 29, 'F')
  if (logo) pdf.addImage(logo, 'PNG', 9, 6, 35, 13, undefined, 'FAST')
  pdf.setTextColor(...green); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.text('SALES MIS', 53, 8)
  pdf.setFontSize(17); pdf.text('Sales MIS', 53, 15)
  pdf.setTextColor(71, 85, 105); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
  pdf.text('Permanent Lead Owner Performance', 53, 21)
  pdf.text(`${reportDate(period.from)} - ${reportDate(period.to)}`, 288, 15, { align: 'right' })
  pdf.setDrawColor(...orange); pdf.setLineWidth(.8); pdf.line(9, 28, 288, 28)

  const cards = [
    ['TOTAL LEADS', totals.total, green], ['OPEN LEADS', totals.open, orange],
    ['CLOSED LEADS', totals.closed, [5, 150, 105]], ['CLOSE RATE', `${totals.closeRate}%`, green]
  ]
  cards.forEach(([label, value, color], index) => {
    const x = 9 + index * 70.5
    pdf.setFillColor(255, 255, 255); pdf.setDrawColor(226, 232, 240); pdf.roundedRect(x, 33, 67.5, 14, 2, 2, 'FD')
    pdf.setTextColor(100, 116, 139); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6); pdf.text(label, x + 3, 38)
    pdf.setTextColor(...color); pdf.setFontSize(12); pdf.text(String(value), x + 3, 44)
  })

  const panel = (x, title, subtitle) => {
    pdf.setFillColor(255, 255, 255); pdf.setDrawColor(226, 232, 240); pdf.roundedRect(x, 51, 136, 47, 2, 2, 'FD')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...green); pdf.text(title, x + 4, 58)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.2); pdf.setTextColor(100, 116, 139); pdf.text(subtitle, x + 4, 63)
  }
  panel(9, 'Team Comparison', 'Open and closed leads - common scale')
  const teamScale = Math.max(1, ...groups.map((group) => group.total))
  groups.forEach((group, index) => {
    const y = 71 + index * 13
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.8); pdf.setTextColor(...slate); pdf.text(group.name, 13, y)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(5.8); pdf.setTextColor(100, 116, 139); pdf.text(`${group.users} users | ${group.total} leads | ${group.closeRate}% close rate`, 141, y, { align: 'right' })
    pdf.setFillColor(241, 245, 249); pdf.roundedRect(13, y + 2, 128, 3, 1.5, 1.5, 'F')
    pdf.setFillColor(251, 146, 60); pdf.rect(13, y + 2, 128 * group.open / teamScale, 3, 'F')
    pdf.setFillColor(...green); pdf.rect(13 + 128 * group.open / teamScale, y + 2, 128 * group.closed / teamScale, 3, 'F')
    pdf.setFontSize(5.6); pdf.setTextColor(100, 116, 139); pdf.text(`${group.open} open | ${group.closed} closed`, 13, y + 8)
  })

  panel(152, 'Closed Leads by Owner', 'Ranked by closed lead count')
  const leaders = ranked.filter((row) => row.closedLeads > 0).slice(0, 4)
  const ownerScale = Math.max(1, ...leaders.map((row) => row.closedLeads))
  leaders.forEach((row, index) => {
    const y = 69 + index * 6
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6); pdf.setTextColor(...slate); pdf.text(String(row.name), 156, y)
    pdf.setFillColor(241, 245, 249); pdf.roundedRect(199, y - 2, 63, 2.3, 1.1, 1.1, 'F')
    pdf.setFillColor(...green); pdf.roundedRect(199, y - 2, 63 * row.closedLeads / ownerScale, 2.3, 1.1, 1.1, 'F')
    pdf.setFont('helvetica', 'normal'); pdf.setTextColor(71, 85, 105); pdf.text(`${row.closedLeads} closed | ${row.closeRate}%`, 284, y, { align: 'right' })
  })
  const zeroCount = ranked.filter((row) => row.closedLeads === 0).length
  if (zeroCount) { pdf.setFontSize(5.8); pdf.setTextColor(100, 116, 139); pdf.text(`Remaining ${zeroCount} owner${zeroCount === 1 ? '' : 's'}: 0 closed leads`, 156, 95) }

  const focusNames = openLeaders.map((row) => row.name).join(' and ') || 'The leading owners'
  pdf.setFillColor(255, 247, 237); pdf.setDrawColor(251, 146, 60); pdf.roundedRect(9, 102, 279, 10, 2, 2, 'FD')
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.4); pdf.setTextColor(...green); pdf.text('MANAGEMENT FOCUS', 13, 106)
  pdf.setFont('helvetica', 'normal'); pdf.setTextColor(71, 85, 105)
  pdf.text(`${totals.open} leads remain open. ${focusNames} together hold ${focusOpen} open leads, approximately ${focusPercent}% of the open pipeline.`, 13, 110)

  autoTable(pdf, {
    startY: 116, margin: { left: 9, right: 9, bottom: 13 },
    head: [['Lead Owner', 'Total Leads', 'Open', 'Closed', 'Close Rate', 'Temporary Leads']],
    body: [...owners.map((row) => [row.name, row.totalLeads, row.openLeads, row.closedLeads, `${row.closeRate}%`, row.temporaryLeads]), ['TOTAL', totals.total, totals.open, totals.closed, `${totals.closeRate}%`, totals.temporary]],
    theme: 'plain', pageBreak: 'avoid', rowPageBreak: 'avoid',
    headStyles: { fillColor: green, textColor: 255, fontStyle: 'bold', fontSize: 6.8, cellPadding: 1.6 },
    bodyStyles: { textColor: slate, fontSize: owners.length > 12 ? 5.5 : 6.5, cellPadding: owners.length > 12 ? .9 : 1.4, lineColor: [226, 232, 240], lineWidth: .1 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { cellWidth: 84, fontStyle: 'bold' }, 1: { halign: 'right' }, 2: { halign: 'right', textColor: [234, 88, 12] }, 3: { halign: 'right', textColor: [5, 150, 105] }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    didParseCell: (data) => { if (data.section === 'body' && data.row.index === owners.length) { data.cell.styles.fillColor = [236, 253, 245]; data.cell.styles.textColor = green; data.cell.styles.fontStyle = 'bold' } }
  })

  pdf.setDrawColor(226, 232, 240); pdf.line(9, 199, 288, 199)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(5.8); pdf.setTextColor(100, 116, 139)
  pdf.text(`Temporary leads (${totals.temporary}) are separate from Total Leads. | AnantTattva CRM`, 9, 204)
  pdf.text('1 / 1', 288, 204, { align: 'right' })
  pdf.save(`Sales_MIS_${period.from}_to_${period.to}.pdf`)
}
