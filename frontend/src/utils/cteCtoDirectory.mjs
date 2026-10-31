function text(value, fallback = '') {
  const result = String(value ?? '').trim()
  return result || fallback
}

export function documentUrl(value) {
  return text(value?.secureUrl || value?.url || value?.dataUrl || (typeof value === 'string' ? value : ''))
}

export function describeCteCtoRecord(record = {}) {
  const data = record.data || {}
  const snapshot = data.selectedLeadSnapshot || {}
  const lead = record.selectedLead && typeof record.selectedLead === 'object' ? record.selectedLead : {}
  const assignedServiceId = text(record.assignedServiceId || data.assignedServiceId || snapshot.assignedServiceId)
  const service = (lead.serviceSelections || []).find((item) => text(item?.assignedServiceId) === assignedServiceId) || {}
  const applicantType = text(
    data.basic?.applicantType || service.applicantType || service.piboParent || service.piboCategoryParent
      || snapshot.applicantType || snapshot.piboParent || snapshot.piboCategoryParent
      || lead.applicantType || lead.piboParent,
    'Not provided'
  )
  const subApplicantType = text(
    data.basic?.subApplicantType || data.basic?.piboCategory || service.subApplicantType || service.piboCategory
      || snapshot.subApplicantType || snapshot.piboCategory
      || lead.subApplicantType || lead.piboCategory,
    'Not applicable'
  )
  return {
    ...record,
    id: text(record._id || record.id),
    companyName: text(data.basic?.clientLegalName || data.basic?.tradeName || lead.company, 'Untitled client'),
    tradeName: text(data.basic?.tradeName),
    leadCode: text(data.importMeta?.uniqueId || data.importMeta?.leadNumber || lead.leadCode, '-'),
    applicantType,
    subApplicantType,
    eprCategory: text(data.basic?.eprCategory || service.eprCategory, '-'),
    assignedServiceId,
    cte: data.cte || {}
  }
}

export function groupCteCtoClients(records = []) {
  const groups = new Map()
  records.map(describeCteCtoRecord).forEach((record) => {
    const companyKey = record.companyName.toLowerCase().replace(/[^a-z0-9]/g, '')
    const key = `company:${text(record.companyIdentity, companyKey).toLowerCase()}`
    const current = groups.get(key) || { key, companyName: record.companyName, tradeName: record.tradeName, leadCode: record.leadCode, records: [] }
    current.records.push(record)
    if (current.leadCode === '-' && record.leadCode !== '-') current.leadCode = record.leadCode
    groups.set(key, current)
  })
  return [...groups.values()].sort((a, b) => a.companyName.localeCompare(b.companyName))
}

export function cteCtoExportRows(groups = []) {
  return groups.flatMap((group) => group.records.flatMap((record) => {
    const plants = Array.isArray(record.cte?.plantWiseDetails) && record.cte.plantWiseDetails.length
      ? record.cte.plantWiseDetails : [{}]
    return plants.map((plant, index) => ({
      'Client Name': group.companyName,
      'Trade Name': record.tradeName || '-',
      'Lead ID': record.leadCode,
      'Applicant Type': record.applicantType,
      'Sub-applicant Type': record.subApplicantType,
      'EPR Category': record.eprCategory,
      'CTE Applicable': text(record.cte?.cteApplicable, 'Yes'),
      'Number of Plants': text(record.cte?.numberOfPlantsLocations, String(plants[0]?.plantName ? plants.length : 0)),
      'Plant No.': plants[0]?.plantName || plants[0]?.plantLocation ? index + 1 : '',
      'Plant Name': text(plant.plantName, '-'),
      'Plant Location': text(plant.plantLocation, '-'),
      'CTE Consent No.': text(plant.cteConsentNo, '-'),
      'CTE Category': text(plant.cteCategory, '-'),
      'CTE Issued Date': text(plant.cteIssuedDate, '-'),
      'CTE Valid Upto': text(plant.cteValidDate, '-'),
      'CTE Production / Year': (plant.cteProductionRows || []).map((row) => `${text(row.productName, 'Product')}: ${text(row.capacity, '-')}`).join('; ') || '-',
      'CTE Document': documentUrl(plant.cteDocument) || '-',
      'CTO/CCA Order No.': text(plant.ctoOrderNo, '-'),
      'CTO/CCA Issue Date': text(plant.ctoIssueDate, '-'),
      'CTO/CCA Valid Upto': text(plant.ctoValidDate, '-'),
      'CTO/CCA Product Quantity': (plant.ctoProductRows || []).map((row) => `${text(row.productName, 'Product')}: ${text(row.quantity, '-')}`).join('; ') || '-',
      'CTO/CCA Document': documentUrl(plant.ctoDocument) || '-'
    }))
  }))
}

export async function downloadCteCtoExcel(groups = []) {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'AnantTattva CRM'
  workbook.created = new Date()
  const worksheet = workbook.addWorksheet('CTE CTO CCA Details', { views: [{ state: 'frozen', ySplit: 1 }] })
  const rows = cteCtoExportRows(groups)
  const headers = Object.keys(rows[0] || cteCtoExportRows([{ companyName: '', records: [{ data: {}, cte: {} }] }])[0] || {})
  worksheet.columns = headers.map((header) => ({ header, key: header, width: Math.min(42, Math.max(15, header.length + 3)) }))
  rows.forEach((row) => worksheet.addRow(row))
  worksheet.getRow(1).height = 28
  worksheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF087F6B' } }
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.alignment = { vertical: 'top', wrapText: true }
      if (rowNumber % 2 === 0) row.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDFA' } } })
    }
  })
  worksheet.autoFilter = { from: 'A1', to: `${worksheet.getColumn(headers.length).letter}1` }
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `CTE-CTO-CCA-Details-${new Date().toISOString().slice(0, 10)}.xlsx`
  link.click()
  URL.revokeObjectURL(link.href)
}
