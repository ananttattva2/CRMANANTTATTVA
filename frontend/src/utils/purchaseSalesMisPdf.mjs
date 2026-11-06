import { exportWithReason } from './dataExport.mjs'

const clean = (value, fallback = '-') => {
  const text = String(value ?? '').replace(/[â€“â€”]/g, '-').replace(/\s+/g, ' ').trim()
  return text || fallback
}
const number = (value) => Number(value) || 0
const pct = (value, total) => total ? `${Math.round((number(value) / number(total)) * 1000) / 10}%` : '0%'

export function buildPurchaseSalesPdfModel(tracker = {}) {
  const summary = tracker.summary || {}
  const allocated = number(summary.allocated)
  const kpis = [
    ['Allocated Applications', allocated, 'Eligible Annual Return scope'],
    ['SLA Received', number(summary.slaReceived), pct(summary.slaReceived, allocated)],
    ['SLA Not Received', number(summary.slaNotReceived), pct(summary.slaNotReceived, allocated)],
    ['Purchase Complete', number(summary.purchaseComplete), pct(summary.purchaseComplete, allocated)],
    ['Sales Complete', number(summary.salesComplete), pct(summary.salesComplete, allocated)],
    ['Fully Completed', number(summary.fullyComplete), pct(summary.fullyComplete, allocated)]
  ]
  const stages = (module) => (tracker[module] || []).map((stage, index) => [
    index + 1,
    clean(stage.label),
    number(stage.complete),
    number(stage.progress),
    number(stage.pending),
    number(stage.rejected)
  ])
  const users = (tracker.users || []).map((user) => [
    clean(user.userName), number(user.allocated), number(user.slaReceived), number(user.slaNotReceived),
    number(user.purchaseManagerReviewed), number(user.salesManagerReviewed), number(user.purchaseComplete),
    number(user.salesComplete), number(user.fullyComplete), `${number(user.completion)}%`
  ])
  return { kpis, purchase: stages('purchase'), sales: stages('sales'), users }
}

async function loadLogo() {
  try {
    const response = await fetch('/ananttattva-logo.png')
    if (!response.ok) return null
    const blob = await response.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch { return null }
}

export async function downloadPurchaseSalesMisPdf({ tracker, year = '', filters = [], generatedAt = new Date() } = {}) {
  if (!tracker?.summary) throw new Error('Purchase and Sales dashboard data is not ready.')
  const [{ jsPDF }, autoTableModule, logo] = await Promise.all([import('jspdf'), import('jspdf-autotable'), loadLogo()])
  const autoTable = autoTableModule.default || autoTableModule.autoTable
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  const model = buildPurchaseSalesPdfModel(tracker)
  const teal = [8, 119, 93], blue = [37, 99, 235], slate = [30, 41, 59], muted = [100, 116, 139]
  const margin = 10
  const generated = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(generatedAt)
  const activeFilters = filters.filter((item) => item?.[1]).map(([label, value]) => `${clean(label)}: ${clean(value)}`).join('  |  ') || 'All authorised records'

  const header = (title, subtitle) => {
    doc.setFillColor(242, 251, 248); doc.rect(0, 0, 297, 27, 'F')
    if (logo) doc.addImage(logo, 'PNG', margin, 5, 31, 12, undefined, 'FAST')
    doc.setTextColor(...teal); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.text('OPERATIONS MIS', 47, 7)
    doc.setTextColor(...slate); doc.setFontSize(16); doc.text(clean(title), 47, 15)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...muted); doc.setFontSize(7.5); doc.text(clean(subtitle), 47, 21)
    doc.setDrawColor(249, 115, 22); doc.setLineWidth(.6); doc.line(margin, 26, 287, 26)
  }

  header('Purchase & Sales MIS', `FY ${clean(year, 'All Years')} | Generated ${generated} IST`)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8); doc.setTextColor(...muted)
  doc.text(doc.splitTextToSize(activeFilters, 277), margin, 32)

  model.kpis.forEach(([label, value, note], index) => {
    const x = margin + index * 46.25
    doc.setFillColor(index === 2 ? 255 : 255, index === 2 ? 250 : 255, index === 2 ? 235 : 255)
    doc.setDrawColor(218, 231, 227); doc.roundedRect(x, 38, 43, 18, 2, 2, 'FD')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(5.8); doc.setTextColor(...muted); doc.text(clean(label).toUpperCase(), x + 3, 44)
    const valueColor = index >= 3 ? teal : slate
    doc.setFontSize(11); doc.setTextColor(...valueColor); doc.text(String(value), x + 3, 50)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.setTextColor(...muted); doc.text(clean(note), x + 3, 54)
  })

  const stageTable = (title, rows, left, color) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...color); doc.text(title, left, 65)
    autoTable(doc, {
      startY: 68, margin: { left, right: 297 - left - 134 }, tableWidth: 134,
      head: [['#', 'Workflow Stage', 'Complete', 'Progress', 'Pending', 'Rejected']], body: rows,
      theme: 'grid', styles: { font: 'helvetica', fontSize: 6.5, cellPadding: 2, textColor: slate, lineColor: [226, 232, 240], lineWidth: .1 },
      headStyles: { fillColor: color, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 0: { cellWidth: 8, halign: 'center' }, 1: { cellWidth: 54 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } }
    })
  }
  stageTable('Purchase Workflow Summary', model.purchase, margin, teal)
  stageTable('Sales Workflow Summary', model.sales, 153, blue)

  doc.addPage()
  header('User-wise Purchase & Sales Summary', `${model.users.length} assigned users | FY ${clean(year, 'All Years')}`)
  autoTable(doc, {
    startY: 34, margin: { left: margin, right: margin, bottom: 15 },
    head: [['User Name', 'Allocated', 'SLA Received', 'SLA Not Received', 'Purchase Manager Reviewed', 'Sales Manager Reviewed', 'Purchase Complete', 'Sales Complete', 'Fully Complete', 'Completion']],
    body: model.users.length ? model.users : [['No matching users', 0, 0, 0, 0, 0, 0, 0, 0, '0%']],
    theme: 'grid', showHead: 'everyPage', rowPageBreak: 'avoid',
    styles: { font: 'helvetica', fontSize: 6.7, cellPadding: 2.3, overflow: 'linebreak', textColor: slate, lineColor: [226, 232, 240], lineWidth: .1 },
    headStyles: { fillColor: teal, textColor: 255, fontStyle: 'bold', halign: 'center', valign: 'middle' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { cellWidth: 44, fontStyle: 'bold', halign: 'left' }, 1: { cellWidth: 20, halign: 'right' }, 2: { cellWidth: 23, halign: 'right' }, 3: { cellWidth: 25, halign: 'right' }, 4: { cellWidth: 30, halign: 'right' }, 5: { cellWidth: 28, halign: 'right' }, 6: { cellWidth: 25, halign: 'right' }, 7: { cellWidth: 22, halign: 'right' }, 8: { cellWidth: 22, halign: 'right' }, 9: { cellWidth: 20, halign: 'right' } }
  })

  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setDrawColor(226, 232, 240); doc.line(margin, 198, 287, 198)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...muted)
    doc.text(`AnantTattva CRM | Purchase & Sales MIS | FY ${clean(year, 'All Years')}`, margin, 204)
    doc.text(`${page} / ${pages}`, 287, 204, { align: 'right' })
  }

  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(generatedAt)
  const filename = `Purchase-Sales-MIS-${clean(year, 'All-Years').replace(/\s+/g, '-')}-${day}.pdf`
  await exportWithReason(filename, () => doc.save(filename))
}
