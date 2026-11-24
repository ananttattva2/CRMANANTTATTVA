const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/
const DISPLAY_DATE = /^(\d{2})[\/-](\d{2})[\/-](\d{4})$/
const indiaDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric'
})
const indiaTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit'
})

function indiaParts(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = indiaDateFormatter.formatToParts(date)
  const pick = (type) => parts.find((part) => part.type === type)?.value || ''
  return { day: pick('day'), month: pick('month'), year: pick('year'), date }
}

/** Format user-facing dates only. Storage, API values and date inputs remain ISO YYYY-MM-DD. */
export function formatDisplayDate(value, fallback = '-') {
  if (value === undefined || value === null || value === '') return fallback
  const source = String(value).trim()
  const iso = source.match(DATE_ONLY)
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`
  const displayed = source.match(DISPLAY_DATE)
  if (displayed) return `${displayed[1]}-${displayed[2]}-${displayed[3]}`
  if (!(value instanceof Date)) return source
  const parts = indiaParts(value)
  return parts ? `${parts.day}-${parts.month}-${parts.year}` : source
}

export function formatDisplayDateTime(value, fallback = '-') {
  if (value === undefined || value === null || value === '') return fallback
  const parts = indiaParts(value)
  if (!parts) return String(value)
  const time = indiaTimeFormatter.format(parts.date)
  return `${parts.day}-${parts.month}-${parts.year}, ${time}`
}
