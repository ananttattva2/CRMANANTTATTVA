import { formatDisplayDate, formatDisplayDateTime } from './dateFormat'
import { downloadSalesMisInfographicPdf } from './salesMisPdf.mjs'

const REPORT_TITLE = 'User Activity & Productivity Report'

export function formatDuration(seconds = 0) {
  const total = Math.max(0, Number(seconds) || 0)
  return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`
}

export function formatReportDate(value) {
  return formatDisplayDate(value)
}

export function formatDateTime(value) {
  return formatDisplayDateTime(value)
}

async function logoDataUrl() {
  const response = await fetch('/ananttattva-logo.png')
  if (!response.ok) throw new Error('Company logo could not be loaded')
  const blob = await response.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function drawKpiCards(pdf, cards, startY) {
  const margin = 9
  const gap = 3
  const cardWidth = (297 - margin * 2 - gap * 3) / 4
  const palettes = [
    { fill: [239, 250, 247], line: [167, 243, 208], value: [5, 150, 105] },
    { fill: [239, 246, 255], line: [191, 219, 254], value: [37, 99, 235] },
    { fill: [255, 247, 237], line: [254, 215, 170], value: [234, 88, 12] },
    { fill: [255, 241, 242], line: [254, 205, 211], value: [225, 29, 72] }
  ]
  cards.forEach((card, index) => {
    const column = index % 4
    const row = Math.floor(index / 4)
    const x = margin + column * (cardWidth + gap)
    const y = startY + row * 17
    const palette = palettes[index % palettes.length]
    pdf.setFillColor(...(card.fill || palette.fill))
    pdf.setDrawColor(...(card.line || palette.line))
    pdf.roundedRect(x, y, cardWidth, 13.5, 2, 2, 'FD')
    pdf.setTextColor(71, 85, 105)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(6.5)
    pdf.text(card.label.toUpperCase(), x + 3, y + 4.2)
    pdf.setTextColor(...(card.color || palette.value))
    pdf.setFontSize(12)
    pdf.text(String(card.value), x + 3, y + 10.5)
  })
}

export async function downloadProductivityPdf({ rows, summary, period, insights }) {
  const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const autoTable = autoTableModule.default || autoTableModule.autoTable
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  const teal = [7, 88, 72]
  const orange = [249, 115, 22]
  let logo = null
  try { logo = await logoDataUrl() } catch (error) { console.warn('PDF logo unavailable', error) }

  pdf.setFillColor(243, 248, 246)
  pdf.rect(0, 0, 297, 31, 'F')
  if (logo) {
    const image = pdf.getImageProperties(logo)
    const maxWidth = 42
    const maxHeight = 16
    const ratio = Math.min(maxWidth / image.width, maxHeight / image.height)
    pdf.addImage(logo, 'PNG', 10, 7, image.width * ratio, image.height * ratio, undefined, 'FAST')
  }
  pdf.setTextColor(...teal)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.text('ANANTTATTVA', 63, 8.5)
  pdf.setFontSize(18)
  pdf.text(REPORT_TITLE, 63, 15.5)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(71, 85, 105)
  pdf.setFontSize(8.5)
  pdf.text(`Report Period: ${formatReportDate(period.from)} - ${formatReportDate(period.to)}`, 63, 21.5)
  pdf.text(`Generated On: ${formatDateTime(new Date())}`, 63, 26)
  pdf.setDrawColor(...orange)
  pdf.setLineWidth(1)
  pdf.line(9, 30, 288, 30)

  const cards = [
    { label: 'Total Users', value: summary.totalUsers },
    { label: 'Online Now', value: summary.onlineNow },
    { label: 'Active CRM Time', value: formatDuration(summary.activeSeconds) },
    { label: 'Away Time', value: formatDuration(summary.awaySeconds) },
    { label: 'CRM Actions', value: Number(summary.actions || 0).toLocaleString('en-IN') },
    { label: 'Closed Leads', value: summary.closedLeads },
    { label: 'Support Tickets Raised', value: summary.supportTickets },
    { label: 'Total Sessions', value: summary.totalSessions }
  ]
  drawKpiCards(pdf, cards, 35)

  pdf.setFillColor(239, 250, 247)
  pdf.setDrawColor(167, 243, 208)
  pdf.roundedRect(9, 69, 279, 20, 2, 2, 'FD')
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(...teal)
  pdf.setFontSize(8)
  pdf.text('REPORT SUMMARY & KEY INSIGHTS', 12, 74)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(51, 65, 85)
  pdf.setFontSize(7.2)
  pdf.text(`Users ${summary.totalUsers}  |  Online ${summary.onlineNow}  |  CRM Actions ${Number(summary.actions || 0).toLocaleString('en-IN')}  |  Closed Leads ${summary.closedLeads}  |  Support Tickets ${summary.supportTickets}`, 12, 79)
  const insightText = [
    `Most Active: ${insights.mostActive?.name || '-'}`,
    `Most CRM Actions: ${insights.mostActions?.name || '-'}`,
    `Highest Score: ${insights.highestScore?.name || '-'}`,
    `Most Leads: ${insights.mostLeads?.name || '-'}`,
    `Most Tickets: ${insights.mostTickets?.name || '-'}`
  ]
  pdf.text(insightText.join('   |   '), 12, 85)

  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(15, 23, 42)
  pdf.setFontSize(10)
  pdf.text(REPORT_TITLE, 9, 96)
  if (rows.length) {
    autoTable(pdf, {
      startY: 99,
      margin: { top: 12, right: 9, bottom: 14, left: 9 },
      head: [['#', 'User Name', 'Role', 'Score', 'Leads', 'Closed', 'Active', 'Away', 'Sessions', 'CRM Actions', 'Tickets', 'Risk Level / Reason']],
      body: rows.map((row, index) => [
        index + 1, row.name, row.roleLabel, `${row.score}/100`, row.totalLeads, row.closedLeads,
        formatDuration(row.activeSeconds), formatDuration(row.awaySeconds), row.sessions,
        row.activityCount, row.tickets.total, `${row.risk.level}\n${row.risk.reason}`
      ]),
      theme: 'grid',
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      headStyles: { fillColor: teal, textColor: 255, fontStyle: 'bold', fontSize: 7, cellPadding: 2, valign: 'middle' },
      bodyStyles: { textColor: [51, 65, 85], fontSize: 6.8, cellPadding: 1.8, valign: 'middle', overflow: 'linebreak' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      styles: { lineColor: [203, 213, 225], lineWidth: 0.15, font: 'helvetica' },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' }, 1: { cellWidth: 42 }, 2: { cellWidth: 24 },
        3: { cellWidth: 17, halign: 'center' }, 4: { cellWidth: 14, halign: 'center' },
        5: { cellWidth: 15, halign: 'center' }, 6: { cellWidth: 21, halign: 'right' },
        7: { cellWidth: 21, halign: 'right' }, 8: { cellWidth: 17, halign: 'center' },
        9: { cellWidth: 22, halign: 'right' }, 10: { cellWidth: 17, halign: 'center' },
        11: { cellWidth: 61 }
      }
    })
  } else {
    pdf.setFillColor(248, 250, 252)
    pdf.roundedRect(9, 96, 279, 22, 2, 2, 'F')
    pdf.setTextColor(100, 116, 139)
    pdf.setFontSize(10)
    pdf.text('No user activity found for the selected period.', 148.5, 108, { align: 'center' })
  }

  const pages = pdf.internal.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page)
    pdf.setDrawColor(226, 232, 240)
    pdf.line(9, 200, 288, 200)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(100, 116, 139)
    pdf.setFontSize(7)
    pdf.text('Generated from AnantTattva CRM', 9, 205)
    pdf.text(`Page ${page} of ${pages}`, 288, 205, { align: 'right' })
  }
  pdf.save(`User_Activity_Productivity_Report_${period.to}.pdf`)
}

async function createMisPdf(title, subtitle, period) {
  const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const autoTable = autoTableModule.default || autoTableModule.autoTable
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  let logo = null
  try { logo = await logoDataUrl() } catch (error) { console.warn('PDF logo unavailable', error) }
  pdf.setFillColor(243, 248, 246); pdf.rect(0, 0, 297, 32, 'F')
  if (logo) pdf.addImage(logo, 'PNG', 10, 7, 38, 14, undefined, 'FAST')
  pdf.setTextColor(7, 88, 72); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18); pdf.text(title, 58, 14)
  pdf.setTextColor(71, 85, 105); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5)
  pdf.text(`${subtitle}  |  ${formatReportDate(period.from)} - ${formatReportDate(period.to)}`, 58, 20)
  pdf.text(`Generated: ${formatDateTime(new Date())}`, 58, 25)
  pdf.setDrawColor(249, 115, 22); pdf.setLineWidth(1); pdf.line(9, 31, 288, 31)
  return { pdf, autoTable }
}

function leadOwnershipPdfHead(includeStatus = false) {
  const fixed = (content) => ({ content, rowSpan: 2, styles: { valign: 'middle' } })
  return [[fixed('Department'), fixed('Lead Owner'), fixed('Role / CRM Team'),
    { content: 'Total Leads', colSpan: 2, styles: { halign: 'center' } },
    fixed('Lead Open'), fixed('Lead Close'), fixed('Close Rate'), ...(includeStatus ? [fixed('Status')] : [])],
    ['Temp Lead', 'Lead']]
}

async function downloadSalesMisPdfLegacy({ rows, period }) {
  const { pdf, autoTable } = await createMisPdf('Sales MIS', 'Permanent Lead Owner Performance', period)
  const grouped = managementSalesPdfGroups(rows)
  const pdfRows = grouped.flatMap((group) => group.members)
  const totals = pdfRows.reduce((sum, row) => ({ total: sum.total + Number(row.totalLeads || 0), open: sum.open + Number(row.openLeads || 0), closed: sum.closed + Number(row.closedLeads || 0), temporary: sum.temporary + Number(row.temporaryLeads || 0) }), { total: 0, open: 0, closed: 0, temporary: 0 })
  drawKpiCards(pdf, [{ label: 'Total Leads', value: totals.total }, { label: 'Open Leads', value: totals.open }, { label: 'Closed Leads', value: totals.closed }, { label: 'Close Rate', value: `${totals.total ? Math.round(totals.closed / totals.total * 100) : 0}%` }], 36)
  const body = grouped.flatMap((group) => [[group.name, 'TEAM TOTAL', `${group.members.length} users`, group.temporary, group.total, group.open, group.closed, `${group.total ? Math.round(group.closed / group.total * 100) : 0}%`], ...group.members.map((row) => ['', row.name, `${row.roleLabel || row.role || '-'} · ${row.team || '-'}`, Number(row.temporaryLeads || 0), row.totalLeads, row.openLeads, row.closedLeads, `${row.totalLeads ? Math.round(row.closedLeads / row.totalLeads * 100) : 0}%`])])
  autoTable(pdf, { startY: 55, margin: { left: 9, right: 9 }, head: leadOwnershipPdfHead(), body, theme: 'grid', headStyles: { fillColor: [7, 88, 72], fontStyle: 'bold' }, alternateRowStyles: { fillColor: [248, 250, 252] }, styles: { fontSize: 8, cellPadding: 2.5, lineColor: [203, 213, 225], lineWidth: 0.15 }, columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } }, didParseCell: (data) => { if (data.section === 'body' && data.row.raw?.[1] === 'TEAM TOTAL') { data.cell.styles.fillColor = [236, 253, 245]; data.cell.styles.fontStyle = 'bold' } } })
  pdf.save(`Sales_MIS_Report_${period.to}.pdf`)
}

export async function downloadSalesMisPdf(options) {
  return downloadSalesMisInfographicPdf(options)
}

export async function downloadOperationMisPdf({ groups, period }) {
  const { pdf, autoTable } = await createMisPdf('Operations & Compliance MIS', 'Team, Client Master and approval status counts', period)
  const totals = groups.reduce((sum, group) => ({ clients: sum.clients + Number(group.clientMasters || 0), approved: sum.approved + Number(group.approvedClients || 0), partial: sum.partial + Number(group.partiallyApprovedClients || 0), rejected: sum.rejected + Number(group.rejectedClients || 0) }), { clients: 0, approved: 0, partial: 0, rejected: 0 })
  drawKpiCards(pdf, [{ label: 'Total Clients', value: totals.clients }, { label: 'Approved', value: totals.approved }, { label: 'Partially Approved', value: totals.partial }, { label: 'Reject', value: totals.rejected }], 36)
  const body = groups.flatMap((group) => {
    const people = [...(group.manager ? [group.manager] : []), ...group.members]
    return [[group.name, 'TEAM TOTAL', group.manager?.name || '-', group.clientMasters, group.draftClients || 0, group.submittedClients || 0, group.approvedClients || 0, group.partiallyApprovedClients || 0, group.rejectedClients || 0], ...people.map((row) => ['', row === group.manager ? 'Manager' : 'User', row.name, row.clientMasters || 0, row.draftClients || 0, row.submittedClients || 0, row.approvedClients || 0, row.partiallyApprovedClients || 0, row.rejectedClients || 0])]
  })
  autoTable(pdf, { startY: 55, margin: { left: 9, right: 9 }, head: [[{ content: '', colSpan: 6 }, { content: 'COMPLIANCE STATUS', colSpan: 3, styles: { halign: 'center', fontSize: 10 } }], ['Team', 'Level', 'Reports To', 'Total Clients', 'Draft', 'Submitted', 'Approved', 'Partially Approved', 'Reject']], body, theme: 'grid', headStyles: { fillColor: [8, 126, 151], textColor: 255, fontStyle: 'bold' }, alternateRowStyles: { fillColor: [248, 250, 252] }, styles: { fontSize: 8, cellPadding: 2.5, lineColor: [203, 213, 225], lineWidth: 0.15 }, columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } }, didParseCell: (data) => { if (data.section === 'body' && data.row.raw?.[1] === 'TEAM TOTAL') { data.cell.styles.fillColor = [236, 254, 255]; data.cell.styles.fontStyle = 'bold' } } })
  pdf.save(`Operation_MIS_Report_${period.to}.pdf`)
}

function managementSalesGroups(rows = []) {
  const department = (row) => {
    const role = String(row.role || '').toLowerCase()
    const team = String(row.team || '').toLowerCase()
    if (['admin', 'super admin', 'superadmin', 'management'].includes(role) || team.includes('management')) return 'Management'
    if (role === 'sales' || team.includes('sales')) return 'Sales Team'
    if (['operation', 'manager', 'operation head', 'operations head'].includes(role) || team.includes('operation')) return 'Operations Team'
    return 'Other Departments'
  }
  return ['Sales Team', 'Operations Team', 'Management', 'Other Departments'].map((name) => {
    const members = rows.filter((row) => department(row) === name)
    const totals = members.reduce((sum, row) => ({ total: sum.total + Number(row.totalLeads || 0), open: sum.open + Number(row.openLeads || 0), closed: sum.closed + Number(row.closedLeads || 0), temporary: sum.temporary + Number(row.temporaryLeads || 0) }), { total: 0, open: 0, closed: 0, temporary: 0 })
    return { name, members, ...totals }
  }).filter((group) => group.members.length)
}

function managementSalesPdfGroups(rows = []) {
  const withoutAdminRole = rows.filter((row) => String(row.role || row.roleLabel || '')
    .trim().toLowerCase().replace(/[\s_-]+/g, ' ') !== 'admin')
  return managementSalesGroups(withoutAdminRole)
    .filter((group) => ['Sales Team', 'Management'].includes(group.name))
}

export async function downloadCompleteMisPdf({ salesRows = [], operationGroups = [], period }) {
  const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const autoTable = autoTableModule.default || autoTableModule.autoTable
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  let logo = null
  try { logo = await logoDataUrl() } catch (error) { console.warn('PDF logo unavailable', error) }
  const header = (title, subtitle, accent = [7, 88, 72]) => {
    pdf.setFillColor(243, 248, 246); pdf.rect(0, 0, 297, 31, 'F')
    if (logo) pdf.addImage(logo, 'PNG', 10, 6, 39, 15, undefined, 'FAST')
    pdf.setTextColor(...accent); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18); pdf.text(title, 58, 13)
    pdf.setTextColor(71, 85, 105); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
    pdf.text(subtitle, 58, 19); pdf.text(`${formatReportDate(period.from)} - ${formatReportDate(period.to)}  |  Generated ${formatDateTime(new Date())}`, 58, 24)
    pdf.setDrawColor(249, 115, 22); pdf.setLineWidth(0.9); pdf.line(9, 30, 288, 30)
  }
  const tableOptions = (head, body, startY, color) => ({ startY, margin: { left: 9, right: 9, top: 35, bottom: 13 }, head: Array.isArray(head[0]) ? head : [head], body, theme: 'grid', showHead: 'everyPage', rowPageBreak: 'avoid', headStyles: { fillColor: color, textColor: 255, fontStyle: 'bold', fontSize: 7.5, cellPadding: 2.2 }, bodyStyles: { textColor: [51, 65, 85], fontSize: 7.2, cellPadding: 2, overflow: 'linebreak', valign: 'middle' }, alternateRowStyles: { fillColor: [248, 250, 252] }, styles: { lineColor: [203, 213, 225], lineWidth: 0.15 } })
  const completeSalesGroups = managementSalesPdfGroups(salesRows)
  const completeSalesRows = completeSalesGroups.flatMap((group) => group.members)
  const salesTotals = completeSalesRows.reduce((sum, row) => ({ total: sum.total + Number(row.totalLeads || 0), open: sum.open + Number(row.openLeads || 0), closed: sum.closed + Number(row.closedLeads || 0), temporary: sum.temporary + Number(row.temporaryLeads || 0) }), { total: 0, open: 0, closed: 0, temporary: 0 })
  header('Sales MIS', 'Permanent Lead Owner Performance', [15, 118, 110])
  drawKpiCards(pdf, [{ label: 'Total Leads', value: salesTotals.total }, { label: 'Open Leads', value: salesTotals.open }, { label: 'Closed Leads', value: salesTotals.closed }, { label: 'Close Rate', value: `${salesTotals.total ? Math.round(salesTotals.closed / salesTotals.total * 100) : 0}%` }], 36)
  const completeSalesBody = completeSalesGroups.flatMap((group) => [[group.name, 'TEAM TOTAL', `${group.members.length} users`, group.temporary, group.total, group.open, group.closed, `${group.total ? Math.round(group.closed / group.total * 100) : 0}%`, ''], ...group.members.map((row) => ['', row.name, `${row.roleLabel || row.role || '-'} · ${row.team || '-'}`, Number(row.temporaryLeads || 0), Number(row.totalLeads || 0), Number(row.openLeads || 0), Number(row.closedLeads || 0), `${row.totalLeads ? Math.round(Number(row.closedLeads || 0) / Number(row.totalLeads) * 100) : 0}%`, row.presence || (row.active === false ? 'Inactive' : 'Active')])])
  autoTable(pdf, { ...tableOptions(leadOwnershipPdfHead(true), completeSalesBody, 55, [15, 118, 110]), didParseCell: (data) => { if (data.section === 'body' && data.row.raw?.[1] === 'TEAM TOTAL') { data.cell.styles.fillColor = [236, 253, 245]; data.cell.styles.fontStyle = 'bold' } } })
  pdf.addPage(); header('Operations & Compliance MIS', 'Team, user, Client Master and approval status counts', [14, 116, 144])
  const operationTotals = operationGroups.reduce((sum, group) => ({ clients: sum.clients + Number(group.clientMasters || 0), approved: sum.approved + Number(group.approvedClients || 0), partial: sum.partial + Number(group.partiallyApprovedClients || 0), rejected: sum.rejected + Number(group.rejectedClients || 0) }), { clients: 0, approved: 0, partial: 0, rejected: 0 })
  drawKpiCards(pdf, [{ label: 'Total Clients', value: operationTotals.clients }, { label: 'Approved', value: operationTotals.approved }, { label: 'Partially Approved', value: operationTotals.partial }, { label: 'Reject', value: operationTotals.rejected }], 36)
  const operationBody = operationGroups.flatMap((group) => [...(group.manager ? [group.manager] : []), ...(group.members || [])].map((row) => [group.name, row.name, row === group.manager ? 'Manager' : 'Operation User', row === group.manager ? '-' : group.manager?.name || 'Not Assigned', Number(row.clientMasters || 0), Number(row.draftClients || 0), Number(row.submittedClients || 0), Number(row.approvedClients || 0), Number(row.partiallyApprovedClients || 0), Number(row.rejectedClients || 0)]))
  autoTable(pdf, tableOptions([[{ content: '', colSpan: 7 }, { content: 'COMPLIANCE STATUS', colSpan: 3, styles: { halign: 'center', fontSize: 10 } }], ['Team', 'User Name', 'Level', 'Reports To', 'Total Clients', 'Draft', 'Submitted', 'Approved', 'Partially Approved', 'Reject']], operationBody, 55, [8, 126, 151]))
  const pages = pdf.internal.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) { pdf.setPage(page); pdf.setDrawColor(226, 232, 240); pdf.line(9, 200, 288, 200); pdf.setTextColor(100, 116, 139); pdf.setFontSize(7); pdf.text('AnantTattva CRM · Confidential Management Report', 9, 205); pdf.text(`Page ${page} of ${pages}`, 288, 205, { align: 'right' }) }
  pdf.save(`AnantTattva_Complete_MIS_${period.from}_to_${period.to}.pdf`)
}

export async function exportProductivityExcel({ rows, summary, period }) {
  const XLSX = await import('xlsx')
  const workbook = XLSX.utils.book_new()
  const summaryRows = [
    ['User Activity & Productivity Report'],
    ['Report Period', `${formatReportDate(period.from)} - ${formatReportDate(period.to)}`],
    ['Total Users', summary.totalUsers], ['Online Now', summary.onlineNow],
    ['Active CRM Time', formatDuration(summary.activeSeconds)], ['Away Time', formatDuration(summary.awaySeconds)],
    ['CRM Actions', summary.actions], ['Closed Leads', summary.closedLeads],
    ['Support Tickets Raised', summary.supportTickets], ['Total Sessions', summary.totalSessions]
  ]
  const reportRows = rows.map((row, index) => ({
    'Sr. No.': index + 1, 'User Name': row.name, Email: row.email, Role: row.roleLabel,
    'Productivity Score': row.score, 'Total Leads': row.totalLeads, 'Closed Leads': row.closedLeads,
    'Active Time': formatDuration(row.activeSeconds), 'Away Time': formatDuration(row.awaySeconds),
    Sessions: row.sessions, 'CRM Actions': row.activityCount, 'Support Tickets Raised': row.tickets.total,
    'Open Tickets': row.tickets.open, 'Resolved Tickets': row.tickets.resolved,
    'User Status': row.presence, 'Risk Level': row.risk.level, 'Risk Reason': row.risk.reason,
    'Last Activity': formatDateTime(row.lastActivity)
  }))
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows)
  summarySheet['!cols'] = [{ wch: 32 }, { wch: 34 }]
  const reportSheet = XLSX.utils.json_to_sheet(reportRows)
  reportSheet['!cols'] = [7, 24, 32, 18, 18, 12, 13, 15, 15, 11, 14, 23, 13, 16, 18, 18, 24, 24].map((wch) => ({ wch }))
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Report Summary')
  XLSX.utils.book_append_sheet(workbook, reportSheet, 'User Activity')
  XLSX.writeFile(workbook, `User_Activity_Productivity_Report_${period.to}.xlsx`)
}

const MIS_EXCEL_COLORS = {
  navy: 'FF102A43', teal: 'FF075848', emerald: 'FF0F766E', orange: 'FFF97316',
  rose: 'FFE11D48', cyan: 'FF0E7490', violet: 'FF6D28D9', white: 'FFFFFFFF',
  ink: 'FF172033', muted: 'FF64748B', line: 'FFDCE7E3', soft: 'FFF3F8F6', pale: 'FFF8FAFC'
}

function excelDisplayText(value, fallback = '-') {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'object') return String(value.name || value.email || value.label || value._id || value.id || fallback)
  return String(value)
}

function excelBorder(color = MIS_EXCEL_COLORS.line) {
  return { top: { style: 'thin', color: { argb: color } }, left: { style: 'thin', color: { argb: color } }, bottom: { style: 'thin', color: { argb: color } }, right: { style: 'thin', color: { argb: color } } }
}

function styleMisTitle(sheet, title, subtitle, period, accent) {
  sheet.mergeCells('D2:J3')
  const titleCell = sheet.getCell('D2')
  titleCell.value = title
  titleCell.font = { name: 'Aptos Display', size: 22, bold: true, color: { argb: MIS_EXCEL_COLORS.navy } }
  titleCell.alignment = { vertical: 'middle' }
  sheet.mergeCells('D4:J4')
  sheet.getCell('D4').value = subtitle
  sheet.getCell('D4').font = { name: 'Aptos', size: 10, color: { argb: MIS_EXCEL_COLORS.muted } }
  sheet.mergeCells('D5:J5')
  sheet.getCell('D5').value = `Report Period: ${formatReportDate(period.from)} - ${formatReportDate(period.to)}  |  Generated: ${formatDateTime(new Date())}`
  sheet.getCell('D5').font = { name: 'Aptos', size: 9, bold: true, color: { argb: accent } }
  sheet.getRow(1).height = 8
  sheet.getRow(2).height = 20
  sheet.getRow(3).height = 20
  for (let row = 1; row <= 6; row += 1) {
    for (let column = 1; column <= 10; column += 1) sheet.getCell(row, column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MIS_EXCEL_COLORS.soft } }
  }
  sheet.getRow(6).height = 5
  for (let column = 1; column <= 10; column += 1) sheet.getCell(6, column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: accent } }
}

function addMisKpis(sheet, cards, row, accent) {
  cards.forEach((card, index) => {
    const start = 1 + index * 2
    sheet.mergeCells(row, start, row, start + 1)
    sheet.mergeCells(row + 1, start, row + 2, start + 1)
    const label = sheet.getCell(row, start)
    const value = sheet.getCell(row + 1, start)
    label.value = String(card.label).toUpperCase()
    value.value = card.value
    label.font = { name: 'Aptos', size: 9, bold: true, color: { argb: MIS_EXCEL_COLORS.muted } }
    value.font = { name: 'Aptos Display', size: 18, bold: true, color: { argb: accent } }
    ;[label, value].forEach((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MIS_EXCEL_COLORS.white } }
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
      cell.border = excelBorder()
    })
  })
  sheet.getRow(row).height = 20
  sheet.getRow(row + 1).height = 20
  sheet.getRow(row + 2).height = 20
}

function addMisTable(sheet, startRow, headers, data, accent, widths) {
  const headerRow = sheet.getRow(startRow)
  headers.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1)
    cell.value = header
    cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: MIS_EXCEL_COLORS.white } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: accent } }
    cell.alignment = { vertical: 'middle', horizontal: index === 0 ? 'center' : 'left', wrapText: true }
    cell.border = excelBorder(accent)
  })
  headerRow.height = 28
  data.forEach((values, rowIndex) => {
    const row = sheet.getRow(startRow + rowIndex + 1)
    values.forEach((value, columnIndex) => {
      const cell = row.getCell(columnIndex + 1)
      cell.value = value === undefined || value === null || value === '' ? '-' : value
      cell.font = { name: 'Aptos', size: 10, color: { argb: MIS_EXCEL_COLORS.ink }, bold: columnIndex === 1 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowIndex % 2 ? MIS_EXCEL_COLORS.pale : MIS_EXCEL_COLORS.white } }
      cell.alignment = { vertical: 'middle', horizontal: typeof value === 'number' ? 'right' : 'left', wrapText: true }
      cell.border = excelBorder()
    })
    row.height = 23
  })
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width })
  sheet.autoFilter = { from: { row: startRow, column: 1 }, to: { row: startRow + data.length, column: headers.length } }
  sheet.views = [{ state: 'frozen', ySplit: startRow, activeCell: `A${startRow + 1}` }]
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } }
  sheet.headerFooter.oddFooter = '&LAnantTattva CRM&CConfidential MIS Report&RPage &P of &N'
}

export async function exportCompleteMisExcel({ salesRows = [], operationGroups = [], period }) {
  const ExcelJSModule = await import('exceljs')
  const ExcelJS = ExcelJSModule.default || ExcelJSModule
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'AnantTattva CRM'
  workbook.company = 'AnantTattva'
  workbook.subject = 'Complete Management Information System Report'
  workbook.created = new Date()
  workbook.calcProperties.fullCalcOnLoad = true

  let logoId = null
  try { logoId = workbook.addImage({ base64: await logoDataUrl(), extension: 'png' }) } catch (error) { console.warn('Excel logo unavailable', error) }
  const prepare = (name, title, subtitle, accent) => {
    const sheet = workbook.addWorksheet(name, { properties: { tabColor: { argb: accent }, defaultRowHeight: 22 } })
    styleMisTitle(sheet, title, subtitle, period, accent)
    if (logoId !== null) sheet.addImage(logoId, { tl: { col: 0.25, row: 1.15 }, ext: { width: 190, height: 68 }, editAs: 'oneCell' })
    return sheet
  }

  const salesTotals = salesRows.reduce((total, row) => ({ leads: total.leads + Number(row.totalLeads || 0), open: total.open + Number(row.openLeads || 0), closed: total.closed + Number(row.closedLeads || 0) }), { leads: 0, open: 0, closed: 0 })
  const operationPeople = operationGroups.flatMap((group) => [...(group.manager ? [group.manager] : []), ...(group.members || [])].map((row) => ({ group, row })))
  const clientTotal = operationGroups.reduce((sum, group) => sum + Number(group.clientMasters || 0), 0)

  const summary = prepare('Executive Summary', 'Complete MIS', 'Sales & Operations Management Report', MIS_EXCEL_COLORS.teal)
  addMisKpis(summary, [{ label: 'Total Leads', value: salesTotals.leads }, { label: 'Closed Leads', value: salesTotals.closed }, { label: 'Client Masters', value: clientTotal }, { label: 'Operations Teams', value: operationGroups.length }, { label: 'CRM Users', value: salesRows.length }], 8, MIS_EXCEL_COLORS.teal)
  addMisTable(summary, 13, ['#', 'Department', 'Primary Metric', 'Total', 'Open / Pending', 'Completed / Approved', 'Performance', 'Report Status'], [
    [1, 'Sales', 'Leads', salesTotals.leads, salesTotals.open, salesTotals.closed, `${salesTotals.leads ? Math.round(salesTotals.closed / salesTotals.leads * 100) : 0}% close rate`, 'Live'],
    [2, 'Operations', 'Client Masters', clientTotal, operationGroups.reduce((sum, group) => sum + Number(group.draftClients || 0), 0), operationGroups.reduce((sum, group) => sum + Number(group.submittedClients || 0), 0), `${operationGroups.length} teams`, 'Live']
  ], MIS_EXCEL_COLORS.teal, [7, 22, 24, 15, 18, 22, 24, 16])

  const sales = prepare('Sales MIS', 'Sales MIS', 'User-wise lead ownership and closure performance', MIS_EXCEL_COLORS.emerald)
  addMisKpis(sales, [{ label: 'Sales Users', value: salesRows.length }, { label: 'Total Leads', value: salesTotals.leads }, { label: 'Open Leads', value: salesTotals.open }, { label: 'Closed Leads', value: salesTotals.closed }, { label: 'Close Rate', value: `${salesTotals.leads ? Math.round(salesTotals.closed / salesTotals.leads * 100) : 0}%` }], 8, MIS_EXCEL_COLORS.emerald)
  addMisTable(sales, 13, ['#', 'User Name', 'Email', 'Role', 'Temp Lead', 'Lead', 'Open Leads', 'Closed Leads', 'Close Rate', 'User Status', 'Last Activity'], salesRows.map((row, index) => [index + 1, row.name, row.email, row.roleLabel || row.role, Number(row.temporaryLeads || 0), Number(row.totalLeads || 0), Number(row.openLeads || 0), Number(row.closedLeads || 0), `${row.totalLeads ? Math.round(Number(row.closedLeads || 0) / Number(row.totalLeads) * 100) : 0}%`, row.presence || (row.active ? 'Active' : 'Inactive'), formatDateTime(row.lastActivity)]), MIS_EXCEL_COLORS.emerald, [7, 24, 32, 16, 14, 14, 14, 15, 14, 16, 23])
  sales.mergeCells('E12:F12')
  sales.getCell('E12').value = 'TOTAL LEADS'
  sales.getCell('E12').alignment = { horizontal: 'center', vertical: 'middle' }

  const operations = prepare('Operations MIS', 'Operations MIS', 'Team, user, Client Master and approval status counts', MIS_EXCEL_COLORS.cyan)
  addMisKpis(operations, [{ label: 'Teams', value: operationGroups.length }, { label: 'Users', value: operationPeople.length }, { label: 'Client Masters', value: clientTotal }, { label: 'Draft', value: operationGroups.reduce((sum, group) => sum + Number(group.draftClients || 0), 0) }, { label: 'Submitted', value: operationGroups.reduce((sum, group) => sum + Number(group.submittedClients || 0), 0) }], 8, MIS_EXCEL_COLORS.cyan)
  addMisTable(operations, 13, ['#', 'Team', 'User Name', 'Level', 'Reports To', 'Total Clients', 'Draft', 'Submitted', 'Approved', 'Partially Approved', 'Reject'], operationPeople.map(({ group, row }, index) => [index + 1, group.name, row.name, row === group.manager ? 'Manager' : 'Operation User', row === group.manager ? '-' : group.manager?.name || 'Not Assigned', Number(row.clientMasters || 0), Number(row.draftClients || 0), Number(row.submittedClients || 0), Number(row.approvedClients || 0), Number(row.partiallyApprovedClients || 0), Number(row.rejectedClients || 0)]), MIS_EXCEL_COLORS.cyan, [7, 23, 24, 18, 24, 15, 12, 14, 14, 21, 13])
  operations.mergeCells('I12:K12')
  const complianceHeader = operations.getCell('I12')
  complianceHeader.value = 'COMPLIANCE STATUS'
  complianceHeader.font = { name: 'Aptos', size: 11, bold: true, color: { argb: MIS_EXCEL_COLORS.white } }
  complianceHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MIS_EXCEL_COLORS.cyan } }
  complianceHeader.alignment = { horizontal: 'center', vertical: 'middle' }
  complianceHeader.border = excelBorder(MIS_EXCEL_COLORS.cyan)
  operations.getRow(12).height = 23

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `AnantTattva_Complete_MIS_${period.from}_to_${period.to}.xlsx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function downloadSuperAdminGuidePdf() {
  const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const autoTable = autoTableModule.default || autoTableModule.autoTable
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const teal = [7, 88, 72]
  const orange = [249, 115, 22]
  let logo = null
  try { logo = await logoDataUrl() } catch (error) { console.warn('PDF logo unavailable', error) }
  const header = (title, subtitle) => {
    pdf.setFillColor(243, 248, 246); pdf.rect(0, 0, 210, 30, 'F')
    if (logo) pdf.addImage(logo, 'PNG', 10, 7, 38, 14, undefined, 'FAST')
    pdf.setTextColor(...teal); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.text(title, 55, 13)
    pdf.setTextColor(71, 85, 105); pdf.setFontSize(8); pdf.text(subtitle, 55, 19)
    pdf.setDrawColor(...orange); pdf.setLineWidth(0.8); pdf.line(10, 28, 200, 28)
  }
  const table = (title, rows, startY) => {
    pdf.setTextColor(...teal); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.text(title, 10, startY)
    autoTable(pdf, { startY: startY + 3, margin: { left: 10, right: 10 }, head: [['Dashboard Item', 'Meaning / Calculation']], body: rows,
      theme: 'grid', headStyles: { fillColor: teal, fontSize: 8 }, bodyStyles: { fontSize: 8, textColor: [51, 65, 85], cellPadding: 2.5, overflow: 'linebreak' },
      columnStyles: { 0: { cellWidth: 48, fontStyle: 'bold' }, 1: { cellWidth: 132 } } })
    return pdf.lastAutoTable.finalY
  }
  header('Super Admin Dashboard Guide', 'AnantTattva CRM - metrics, charts, filters and user drill-down')
  let y = table('Top Summary Cards', [
    ['Total Users', 'Applied filters ke baad report me included CRM users. Note me active account count show hota hai.'],
    ['Online Now', 'Open session aur pichhle 15 minutes ke andar latest heartbeat wale users.'],
    ['Active CRM Time', 'Selected date range me CRM tab active/focused rehne ka total tracked time.'],
    ['Away Time', 'Session open duration minus Active CRM Time; idle window, inactive tab ya away state ka time.'],
    ['CRM Actions', 'Audit Log me recorded business actions, jaise lead, client, quotation, follow-up, approval aur support create/update. Har mouse click count nahi hota.'],
    ['Closed Leads', 'Selected period me user ke created leads me Closed status, closedBy ya closedAt wale leads.'],
    ['Support Tickets Raised', 'Selected period me user dwara create tickets; user row me Open aur Resolved breakup milta hai.'],
    ['Total Sessions', 'Selected period me recorded CRM login sessions ka total.']
  ], 38)
  pdf.setTextColor(100, 116, 139); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.text('Report selected From/To date aur applied filters par recalculate hota hai.', 10, y + 8)
  pdf.addPage(); header('Scores, Status & Risk', 'How productivity and attention signals are calculated')
  table('Productivity & Presence', [
    ['Productivity Score', 'Maximum 100: Focus up to 50 points (Active/Open ratio), CRM Actions up to 25 points (log scale), Closed Leads up to 25 points (3 per closed lead).'],
    ['Active', 'User online hai aur latest session presence active hai.'], ['Away', 'User online session me hai, lekin latest presence heartbeat away hai.'],
    ['Offline', 'Login recorded hai, par 15-minute online window me active heartbeat nahi hai.'], ['Never Logged In', 'Successful CRM login record available nahi hai.'],
    ['Low Risk', 'Account active, login recent aur high-away condition detect nahi hui.'], ['Medium Risk', 'Last login ko 7 ya usse zyada din ho gaye.'],
    ['High Risk - Away', 'Open time 30 minutes se zyada aur Away ratio 70% ya usse zyada.'], ['Inactive Account', 'User account disabled/inactive; admin review required.']
  ], 38)
  pdf.addPage(); header('Charts, Filters & Drill-down', 'How to analyse and export the report')
  table('Page Controls and Reports', [
    ['Date / Role / User', 'From-To period, role ya individual user select karke Apply Filters karein.'], ['Risk / Online Status', 'Risk signal ya current presence se report narrow karta hai.'],
    ['Search', 'Name, email ya role se search; Enter ya Apply Filters se update.'], ['Insight Cards', 'Most Active, Highest Actions, Highest Score, Most Leads aur Most Tickets.'],
    ['Active vs Away Chart', 'Top users ke focused CRM minutes aur away minutes ka comparison.'], ['Actions & Tickets Chart', 'User-wise CRM Actions aur Support Tickets comparison.'],
    ['Admin Attention', 'Never logged in, stale, high-away aur inactive counts; click se filter apply.'],
    ['User Name Click', 'Detailed Work Report: leads, client masters, completion analysis, company data aur sections.'],
    ['Eye Details', 'Daily timeline, recent actions, latest IP/device aur exact risk reason.'], ['Download PDF', 'Current filtered productivity report. Guide PDF button ye explanation download karta hai.'],
    ['Export Excel', 'Summary aur filtered user table separate Excel sheets me.'], ['Refresh', 'Latest sessions, actions, leads aur tickets backend se reload.']
  ], 38)
  const pages = pdf.internal.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) { pdf.setPage(page); pdf.setFontSize(7); pdf.setTextColor(100, 116, 139); pdf.text('AnantTattva CRM - Super Admin Dashboard Guide', 10, 289); pdf.text(`Page ${page} of ${pages}`, 200, 289, { align: 'right' }) }
  pdf.save('AnantTattva_Super_Admin_Dashboard_Guide.pdf')
}

export { REPORT_TITLE }
