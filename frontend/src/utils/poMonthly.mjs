export const PO_MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']
export const poOwnerName = value => String(value || 'Unassigned').trim().toUpperCase()
export function visiblePOMonths(year, date = new Date()) {
  const current = poPeriod(date)
  if (!current) return []
  if (Number(year.slice(0, 4)) < Number(current.year.slice(0, 4))) return [...PO_MONTHS]
  return year === current.year ? PO_MONTHS.slice(0, current.month + 1) : []
}
export function dashboardPO(records, year, search = '', view = 'month', date = new Date()) {
  const months = visiblePOMonths(year, date)
  const elapsed = filterPoApproval(records, 'APPROVED').filter(record => {
    const period = poPeriod(record.poDate)
    return period?.year === year && period.month < months.length
  })
  const result = view === 'pibo' ? piboPO(elapsed, year, search) : monthlyPO(elapsed, year, search)
  return { ...result, columns: view === 'pibo' ? result.columns : months,
    rows: result.rows.map(row => ({ ...row, name: poOwnerName(row.name), cells: view === 'pibo' ? row.cells : row.months.slice(0, months.length) })) }
}
export function poPeriod(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric' }).formatToParts(date)
  const year = Number(parts.find(p => p.type === 'year').value)
  const month = Number(parts.find(p => p.type === 'month').value)
  const start = month >= 4 ? year : year - 1
  return { year: `${start}-${String(start + 1).slice(-2)}`, month: (month + 8) % 12 }
}
export function monthlyPO(records, year, search = '') {
  const selected = records.filter(r => poPeriod(r.poDate)?.year === year && String(r.ownerName || 'Unassigned').toLowerCase().includes(search.trim().toLowerCase()))
  const groups = new Map()
  for (const record of selected) {
    const key = record.ownerId || record.ownerName || 'unassigned'
    if (!groups.has(key)) groups.set(key, { key, name: record.ownerName || 'Unassigned', months: Array.from({ length: 12 }, () => []), records: [] })
    const row = groups.get(key)
    row.months[poPeriod(record.poDate).month].push(record)
    row.records.push(record)
  }
  return { records: selected, rows: [...groups.values()].sort((a, b) => b.records.length - a.records.length || a.name.localeCompare(b.name)) }
}
export const poAmount = records => records.reduce((sum, r) => sum + (Number.isFinite(Number(r.poAmount)) ? Number(r.poAmount) : 0), 0)
export const poApproval = record => String(record.approvalStatus || 'PENDING').trim().toUpperCase()
export function filterPoApproval(records, status = 'ALL') {
  return status === 'ALL' ? records : records.filter(record => poApproval(record) === status)
}
export function poDetailExportRows(records) {
  return records.map(record => ({
    'Lead Owner': poOwnerName(record.ownerName),
    Client: record.clientName || '',
    'PO number': record.poNumber || '',
    'PO date': poPeriod(record.poDate) ? new Date(record.poDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '',
    'Amount (INR)': Number.isFinite(Number(record.poAmount)) ? Number(record.poAmount) : 0,
    'Applicant category': poApplicantCategory(record),
    Approval: poApproval(record)
  }))
}

export function poApplicantCategory(record) {
  const clean = value => String(value || '').trim().replace(/\s+/g, ' ')
  const missing = value => !value || /^(not specified|not provided|n\/?a|-)$/i.test(value)
  const parent = clean(record.applicantType)
  const child = clean(record.subApplicantType)
  const known = ['Brand Owner', 'Producer', 'Importer', 'Producer (Small & Micro)']
  const canonical = known.find(label => label.toLowerCase() === child.toLowerCase()) || child
  if (!missing(child)) return !missing(parent) && !/^pibo$/i.test(parent) && parent.toLowerCase() !== child.toLowerCase()
    ? `${parent.toUpperCase()} · ${canonical}` : canonical
  return missing(parent) ? 'Not specified' : known.find(label => label.toLowerCase() === parent.toLowerCase()) || parent.toUpperCase()
}
export function piboPO(records, year, search = '') {
  const matrix = monthlyPO(records, year, search)
  const standard = ['Brand Owner', 'Producer', 'Importer', 'Producer (Small & Micro)']
  const extra = [...new Set(matrix.records.map(poApplicantCategory))].filter(label => !standard.includes(label)).sort()
  const columns = [...standard, ...extra]
  return { ...matrix, columns, rows: matrix.rows.map(row => ({
    ...row, cells: columns.map(label => row.records.filter(record => poApplicantCategory(record) === label))
  })) }
}
