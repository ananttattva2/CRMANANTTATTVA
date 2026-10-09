export const PO_MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']
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
