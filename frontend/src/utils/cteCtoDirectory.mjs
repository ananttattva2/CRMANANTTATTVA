import productQuantity from '../../../shared/productQuantity.cjs'
const { splitProductQuantity } = productQuantity
import { exportWithReason } from './dataExport.mjs'
function text(value, fallback = '') {
  const result = String(value ?? '').trim()
  return result || fallback
}

export function documentUrl(value) {
  return text(value?.secureUrl || value?.url || value?.dataUrl || (typeof value === 'string' ? value : ''))
}

function people(primary, additional, fields) {
  return [primary || {}, ...(Array.isArray(additional) ? additional : [])]
    .filter((person) => fields.some((field) => text(person?.[field])))
}

function peopleValues(records, field, mapper = (item) => text(item?.[field])) {
  return records.map(mapper).filter(Boolean).join(' | ') || '-'
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
  const otpContacts = people(data.otp, data.otpContacts, ['mobile', 'personName', 'designation'])
  const authorisedPersons = people(data.authorised, data.authorisedPersons, ['name', 'designation', 'department', 'reporting', 'mobile', 'email', 'pan', 'panDocument', 'aadhaarNumber', 'aadhaarDocument'])
  const coordinatingPersons = people(data.coordinating, data.coordinatingPersons, ['name', 'designation', 'department', 'reporting', 'mobile', 'email'])
  return {
    ...record,
    id: text(record._id || record.id),
    companyName: text(data.basic?.clientLegalName || data.basic?.tradeName || lead.company, 'Untitled client'),
    tradeName: text(data.basic?.tradeName),
    leadCode: text(data.importMeta?.uniqueId || data.importMeta?.leadNumber || lead.leadCode, '-'),
    applicantType,
    subApplicantType,
    eprCategory: text(data.basic?.eprCategory || service.eprCategory || snapshot.eprCategory, '-'),
    assignedServiceId,
    plantUnit: text(data.basic?.plantUnit || service.plantUnit || snapshot.plantUnit),
    cte: data.cte || {},
    otpContacts,
    authorisedPersons,
    coordinatingPersons
  }
}

export function groupCteCtoClients(records = []) {
  const groups = new Map()
  records.map(describeCteCtoRecord).forEach((record) => {
    const companyKey = record.companyName.toLowerCase().replace(/[^a-z0-9]/g, '')
    const key = `company:${companyKey || text(record.companyIdentity, record.id).toLowerCase()}`
    const current = groups.get(key) || { key, companyName: record.companyName, tradeName: record.tradeName, leadCode: record.leadCode, leadCodes: [], records: [] }
    current.records.push(record)
    if (record.leadCode && record.leadCode !== '-' && !current.leadCodes.includes(record.leadCode)) current.leadCodes.push(record.leadCode)
    if (current.leadCode === '-' && record.leadCode !== '-') current.leadCode = record.leadCode
    groups.set(key, current)
  })
  for (const group of groups.values()) group.records = dedupeApplicantRecords(group.records)
  return [...groups.values()].sort((a, b) => a.companyName.localeCompare(b.companyName))
}

// Client Masters can contain both an imported legacy record and a newer
// assignment draft. PO/assignment IDs do not represent a different applicant.
function dedupeApplicantRecords(records) {
  const normalize = value => text(value).toLowerCase().replace(/[^a-z0-9]/g, '')
  const known = value => !['', 'notprovided', 'notapplicable'].includes(normalize(value)) ? normalize(value) : ''
  const category = value => {
    const token = normalize(value).replace(/^epr/, '')
    return token.includes('plastic') ? 'plastic' : token.includes('ewaste') || token.includes('electronic') ? 'ewaste' : token.includes('battery') ? 'battery' : token.includes('tyre') || token.includes('tire') ? 'tyre' : token.includes('usedoil') ? 'usedoil' : token
  }
  const profile = row => [known(row.applicantType), known(row.subApplicantType), category(row.eprCategory), known(row.plantUnit)]
  const profiles = records.map(profile)
  const resolved = profiles.map(fields => fields.map((field, index) => {
    if (field) return field
    const candidates = profiles.filter(other => fields.every((value, position) => !value || !other[position] || value === other[position]))
    const values = [...new Set(candidates.map(other => other[index]).filter(Boolean))]
    return values.length === 1 ? values[0] : ''
  }))
  const richness = value => value && typeof value === 'object' ? Object.values(value).reduce((total, item) => total + richness(item), 0) : text(value) ? 1 : 0
  const merge = (primary, fallback) => {
    if (Array.isArray(primary) && Array.isArray(fallback)) return [...new Map([...primary, ...fallback].map(item => [JSON.stringify(item), item])).values()]
    if (primary && fallback && typeof primary === 'object' && typeof fallback === 'object') return Object.fromEntries([...new Set([...Object.keys(fallback), ...Object.keys(primary)])].map(key => [key, merge(primary[key], fallback[key])]))
    return primary !== undefined && primary !== null && primary !== '' ? primary : fallback
  }
  const grouped = new Map()
  records.forEach((record, index) => {
    // No applicant identity is insufficient evidence to collapse records.
    const key = resolved[index][0] || resolved[index][1] ? resolved[index].join('|') : `unknown:${record.id || index}`
    const prior = grouped.get(key)
    if (!prior) { grouped.set(key, record); return }
    const primary = richness(record.cte) > richness(prior.cte) ? record : prior
    const fallback = primary === record ? prior : record
    grouped.set(key, merge(primary, fallback))
  })
  return [...grouped.values()]
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
      'CTO/CCA Product Quantity': (plant.ctoProductRows || []).map((row) => `${text(row.productName, 'Product')}: ${[splitProductQuantity(row).quantity, splitProductQuantity(row).uom, splitProductQuantity(row).period].filter(Boolean).join(' ') || '-'}`).join('; ') || '-',
      'CTO/CCA Document': documentUrl(plant.ctoDocument) || '-',
      'OTP Person Name': peopleValues(record.otpContacts || [], 'personName'),
      'OTP Mobile No.': peopleValues(record.otpContacts || [], 'mobile'),
      'OTP Person Designation': peopleValues(record.otpContacts || [], 'designation'),
      'Authorised Person Name': peopleValues(record.authorisedPersons || [], 'name'),
      'Authorised Person Designation': peopleValues(record.authorisedPersons || [], 'designation'),
      'Authorised Person Department': peopleValues(record.authorisedPersons || [], 'department'),
      'Authorised Person Reporting Details': peopleValues(record.authorisedPersons || [], 'reporting'),
      'Authorised Person Mobile': peopleValues(record.authorisedPersons || [], 'mobile'),
      'Authorised Person Email': peopleValues(record.authorisedPersons || [], 'email'),
      'Authorised Person PAN': peopleValues(record.authorisedPersons || [], 'pan'),
      'Authorised Person PAN Document': peopleValues(record.authorisedPersons || [], 'panDocument', (person) => documentUrl(person?.panDocument)),
      'Authorised Person Aadhaar': peopleValues(record.authorisedPersons || [], 'aadhaarNumber'),
      'Authorised Person Aadhaar Document': peopleValues(record.authorisedPersons || [], 'aadhaarDocument', (person) => documentUrl(person?.aadhaarDocument)),
      'Coordinating Person Name': peopleValues(record.coordinatingPersons || [], 'name'),
      'Coordinating Person Designation': peopleValues(record.coordinatingPersons || [], 'designation'),
      'Coordinating Person Department': peopleValues(record.coordinatingPersons || [], 'department'),
      'Coordinating Person Reporting Details': peopleValues(record.coordinatingPersons || [], 'reporting'),
      'Coordinating Person Mobile': peopleValues(record.coordinatingPersons || [], 'mobile'),
      'Coordinating Person Email': peopleValues(record.coordinatingPersons || [], 'email')
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
  await exportWithReason(link.download, () => link.click())
  URL.revokeObjectURL(link.href)
}
