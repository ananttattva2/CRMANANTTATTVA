import { exportWithReason } from './dataExport.mjs'
const clean = (value) => String(value ?? '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim()
const teal = [15, 118, 110]
const slate = [51, 65, 85]
const scopeLabel = (visibility) => visibility === 'all' ? 'All users' : visibility === 'team' ? 'My team and my clients' : 'My clients'

function chart(doc, rows, { x, y, width, height, title, kind }) {
  doc.setDrawColor(226, 232, 240)
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(x, y, width, height, 3, 3, 'FD')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...slate)
  doc.text(title, x + 5, y + 8)
  const left = x + 13, top = y + 17, bottom = y + height - 19, plotWidth = width - 20
  const maximum = Math.max(1, ...rows.map((row) => Number(row.clients) || 0))
  const step = Math.max(1, Math.ceil(maximum / 4)), ceiling = step * 4
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
  for (let index = 0; index <= 4; index++) {
    const level = bottom - (bottom - top) * index / 4
    doc.setDrawColor(226, 232, 240); doc.line(left, level, left + plotWidth, level)
    doc.setTextColor(100, 116, 139); doc.text(String(step * index), left - 3, level + 1, { align: 'right' })
  }
  const slot = plotWidth / Math.max(rows.length, 1)
  const px = (index) => left + slot * (index + .5)
  const py = (count) => bottom - (bottom - top) * count / ceiling
  rows.forEach((row, index) => {
    const center = px(index)
    doc.setTextColor(...slate); doc.text(clean(row.year), center, bottom + 5, { align: 'center' })
    if (kind === 'bar') {
      const barWidth = Math.min(12, slot * .5)
      const activeHeight = (bottom - top) * row.active / ceiling
      const inactiveHeight = (bottom - top) * row.inactive / ceiling
      doc.setFillColor(...teal); if (activeHeight) doc.rect(center - barWidth / 2, bottom - activeHeight, barWidth, activeHeight, 'F')
      doc.setFillColor(245, 158, 11); if (inactiveHeight) doc.rect(center - barWidth / 2, bottom - activeHeight - inactiveHeight, barWidth, inactiveHeight, 'F')
      doc.setTextColor(...slate); doc.text(String(row.clients), center, py(row.clients) - 2, { align: 'center' })
    }
  })
  if (kind === 'line') {
    for (const [key, color] of [['clients', [79, 70, 229]], ['inactive', [245, 158, 11]]]) {
      doc.setDrawColor(...color); doc.setFillColor(...color); doc.setLineWidth(.6)
      rows.forEach((row, index) => {
        if (index) doc.line(px(index - 1), py(rows[index - 1][key]), px(index), py(row[key]))
        doc.circle(px(index), py(row[key]), .9, 'F')
      })
    }
  }
  doc.setLineWidth(.2); doc.setFontSize(7); doc.setTextColor(...slate)
  doc.setFillColor(...(kind === 'bar' ? teal : [79, 70, 229])); doc.circle(x + 7, y + height - 7, 1, 'F')
  doc.text(kind === 'bar' ? 'Active clients' : 'Unique clients', x + 10, y + height - 6)
  doc.setFillColor(245, 158, 11); doc.circle(x + 53, y + height - 7, 1, 'F'); doc.text('Inactive clients', x + 56, y + height - 6)
}

export async function createOverallDashboardPdf(data, { generatedAt = new Date(), onProgress = () => {}, view = 'overall' } = {}) {
  if (!data?.yearSections?.length) throw new Error('Dashboard data is not ready. Please retry.')
  if (!['overall', 'users'].includes(view)) throw new Error('Please choose a dashboard to export.')
  if (view === 'users' && data.canViewUsers !== true) throw new Error('User-wise export is available only to Admin, Super Admin and Manager.')
  onProgress('Preparing PDF…')
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  const margin = 14, width = 269
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(generatedAt)
  const heading = (title, subtitle) => {
    doc.setFillColor(240, 253, 250); doc.roundedRect(margin, 12, width, 25, 3, 3, 'F')
    doc.setTextColor(...teal); doc.setFont('helvetica', 'bold'); doc.setFontSize(17)
    const titleWidth = doc.getTextWidth(clean(title))
    if (titleWidth > width - 10) doc.setFontSize(17 * (width - 10) / titleWidth)
    doc.text(clean(title), margin + 5, 22)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...slate); doc.text(clean(subtitle), margin + 5, 30)
  }
  const tableOptions = {
    margin: { left: margin, right: margin, top: 42, bottom: 16 },
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, overflow: 'linebreak', textColor: slate, lineColor: [226, 232, 240], lineWidth: .1 },
    headStyles: { fillColor: [225, 245, 240], textColor: teal, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    rowPageBreak: 'avoid', showHead: 'everyPage'
  }
  function applicantTables(section, ownerName = '') {
    onProgress(`Preparing FY ${section.year}…`)
    const serviceChunks = section.services.length ? Array.from({ length: Math.ceil(section.services.length / 6) }, (_, index) => section.services.slice(index * 6, index * 6 + 6)) : [[]]
    for (const [index, services] of serviceChunks.entries()) {
      doc.addPage()
      const title = `FY ${section.year}${ownerName ? ` - ${ownerName}` : ''} - Applicant / Sub-applicant service matrix`
      const subtitle = `${section.summary.clients} unique clients | ${section.services.length} closed services${serviceChunks.length > 1 ? ` | Service columns ${index + 1} of ${serviceChunks.length}` : ''}`
      heading(title, subtitle)
      if (!section.summary.clients) {
        doc.setFontSize(10); doc.setTextColor(100, 116, 139); doc.text('No clients with closed purchase orders in this financial year.', margin, 51)
        continue
      }
      autoTable(doc, { ...tableOptions, startY: 44, head: [['Applicant / Sub-applicant type', 'Service Count', ...services.map(clean)]], body: section.groups.map((group) => [clean(group.type), Object.values(group.services || {}).reduce((sum, count) => sum + Number(count || 0), 0), ...services.map((service) => group.services[service] || 0)]), columnStyles: { 0: { cellWidth: 58 }, 1: { cellWidth: 20, halign: 'center' }, ...Object.fromEntries(services.map((_, column) => [column + 2, { cellWidth: (width - 78) / services.length, halign: 'center' }])) }, didDrawPage: () => { heading(title, subtitle) } })
    }
    // PDFs intentionally stop at aggregate applicant/service tables. Client
    // names and lead references remain available only in the authenticated UI.
  }
  if (view === 'overall') {
    heading('Application Dashboard', `${scopeLabel(data.visibility)} | Closed POs only | Generated ${date} IST`)
    doc.setFontSize(8); doc.setTextColor(100, 116, 139)
    doc.text('Each company counts once per financial year. Inactive status reflects the current client status.', margin, 43)
    const trends = data.trends || []
    // Keep chart labels readable even with many financial years.
    const chartRows = trends.slice(0, 8)
    chart(doc, chartRows, { x: margin, y: 49, width: 131, height: 82, title: 'Client portfolio by financial year', kind: 'bar' })
    chart(doc, chartRows, { x: margin + 138, y: 49, width: 131, height: 82, title: 'Client growth trend', kind: 'line' })
    autoTable(doc, { ...tableOptions, startY: 139, head: [['Financial year', 'Unique clients with closed POs', 'Active clients', 'Inactive clients']], body: trends.map((row) => [row.year, row.clients, row.active, row.inactive]) })
    for (let start = 8; start < trends.length; start += 8) {
      doc.addPage(); heading('Financial year trends', `${scopeLabel(data.visibility)} | Closed POs only`)
      const rows = trends.slice(start, start + 8)
      chart(doc, rows, { x: margin, y: 46, width: 131, height: 100, title: 'Client portfolio by financial year', kind: 'bar' })
      chart(doc, rows, { x: margin + 138, y: 46, width: 131, height: 100, title: 'Client growth trend', kind: 'line' })
    }
    for (const section of data.yearSections) applicantTables(section)
  } else {
    const users = data.userSections || []
    heading('User-wise Dashboard', `${scopeLabel(data.visibility)} | Operations users and their managers | Generated ${date} IST`)
    doc.setFontSize(10); doc.setTextColor(...slate)
    doc.text(`${users.length} users | All financial years | Closed service POs only`, margin, 48)
    doc.setFontSize(9)
    doc.text('Includes every eligible user with aggregate applicant and service counts.', margin, 58)
    doc.text('Client names and lead references are intentionally excluded from this PDF.', margin, 68)
    if (!users.length) doc.text('No operations users or managers available in your scope.', margin, 82)
    for (const section of data.yearSections) {
      onProgress(`Preparing user-wise FY ${section.year}…`)
      const serviceChunks = section.services.length ? Array.from({ length: Math.ceil(section.services.length / 6) }, (_, index) => section.services.slice(index * 6, index * 6 + 6)) : [[]]
      for (const [index, services] of serviceChunks.entries()) {
        doc.addPage()
        const title = `FY ${section.year} - User-wise service matrix`
        const subtitle = `${users.length} operations users and managers${serviceChunks.length > 1 ? ` | Service columns ${index + 1} of ${serviceChunks.length}` : ''}`
        autoTable(doc, { ...tableOptions, startY: 44, head: [['Users', 'Allocated', 'PO Received', 'PO Pending', `Clients ${section.year}`, `PO Received ${section.year}`, 'Service Closed', ...services.map(clean)]],
          body: users.map((user) => {
            const owned = user.yearSections.find((entry) => entry.year === section.year)
            const closedClients = owned?.summary.clients || 0
            const selectedYearClients = Math.max(user.allocatedClientsByYear?.[section.year] || 0, closedClients)
            const allocatedClients = Math.max(user.allocatedClients || 0, selectedYearClients)
            const poReceivedInYear = Math.min(selectedYearClients, Math.max(user.poReceivedClientsByYear?.[section.year] || 0, closedClients))
            const poReceivedClients = Math.min(allocatedClients, Math.max(user.poReceivedClients || 0, poReceivedInYear))
            const poPendingClients = Math.max(0, allocatedClients - poReceivedClients)
            return [clean(user.userName), allocatedClients, `${poReceivedClients} / ${allocatedClients}`, `${poPendingClients} / ${allocatedClients}`, `${selectedYearClients} / ${allocatedClients}`, `${poReceivedInYear} / ${selectedYearClients}`, `${closedClients} / ${poReceivedInYear}`, ...services.map((service) => (owned?.clients || []).reduce((total, client) => total + (client.services[service] || 0), 0))]
          }),
          columnStyles: { 0: { cellWidth: 44 }, 1: { cellWidth: 18, halign: 'center' }, 2: { cellWidth: 21, halign: 'center' }, 3: { cellWidth: 20, halign: 'center' }, 4: { cellWidth: 22, halign: 'center' }, 5: { cellWidth: 24, halign: 'center' }, 6: { cellWidth: 22, halign: 'center' }, ...Object.fromEntries(services.map((_, column) => [column + 7, { cellWidth: (width - 171) / services.length, halign: 'center' }])) },
          didDrawPage: () => heading(title, subtitle)
        })
      }
      for (const user of users) {
        const owned = user.yearSections.find((entry) => entry.year === section.year)
        if (owned?.summary.clients) applicantTables(owned, clean(user.userName))
      }
    }
  }
  const pages = doc.getNumberOfPages()
  for (let index = 1; index <= pages; index++) {
    doc.setPage(index); doc.setDrawColor(226, 232, 240); doc.line(margin, 198, 283, 198)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100, 116, 139)
    doc.text(`Anant Tattva CRM | ${scopeLabel(data.visibility)} | Closed POs only`, margin, 204)
    doc.text(`${index} / ${pages}`, 283, 204, { align: 'right' })
  }
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(generatedAt)
  return { doc, filename: `${view === 'users' ? 'User-wise-Dashboard' : 'Overall-Dashboard'}-${day}.pdf` }
}

export async function downloadOverallDashboardPdf(data, options = {}) {
  const { doc, filename } = await createOverallDashboardPdf(data, options)
  options.onProgress?.('Saving PDF…')
  await exportWithReason(filename, () => doc.save(filename))
}
