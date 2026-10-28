const aliases = { gst: 'GST Number', gstNumber: 'GST Number', cin: 'CIN', cinNumber: 'CIN', pan: 'PAN', panNumber: 'PAN', piboCategory: 'Applicant Category', eprCategory: 'EPR Category', cpcb: 'CPCB', cte: 'CTE', cto: 'CTO', pincode: 'PIN Code', pinCode: 'PIN Code', mobileNo1: 'Mobile', mobileNo2: 'Alternate Mobile', authorised: 'Authorised Contact', coordinating: 'Coordinating Contact', msmeRows: 'MSME', cteProductionRows: 'CTE Production', ctoProductRows: 'CTO Products' }
export const fieldLabel = key => aliases[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([a-zA-Z])(\d)/g, '$1 $2').replace(/^./, value => value.toUpperCase()).replace(/\b(Gst|Cin|Pan|Epr|Cpcb|Cte|Cto|Msme|Pibo)\b/g, value => value.toUpperCase())
export const hasValue = value => value !== null && value !== undefined && value !== '' && value !== 'â€”'
export function documentUrl(value) { const raw = typeof value === 'string' ? value : value?.secureUrl || value?.url; try { const url = new URL(raw); return ['https:', 'http:'].includes(url.protocol) ? url.href : '' } catch { return '' } }
export function collectDetails(value, path = [], result = { fields: [], documents: [] }) {
  if (!hasValue(value)) return result
  if (typeof value === 'object' && !Array.isArray(value) && documentUrl(value)) {
    result.documents.push({ name: value.name || path.map(fieldLabel).join(' / '), category: path.map(fieldLabel).join(' / '), url: documentUrl(value), uploadedAt: value.uploadedAt || '' }); return result
  }
  if (Array.isArray(value)) { value.forEach((entry, index) => collectDetails(entry, [...path, String(index + 1)], result)); return result }
  if (typeof value === 'object') {
    Object.entries(value).filter(([key]) => !/^(_id|id|url|secureUrl|bytes|width|height|duration|format|resourceType|size|type|uploadedAt)$/i.test(key)).forEach(([key, entry]) => collectDetails(entry, [...path, key], result)); return result
  }
  if (typeof value === 'string' && /^https?:\/\//i.test(value) && /file|document/i.test(path.join(' '))) {
    if (documentUrl(value)) result.documents.push({ name: fieldLabel(path.at(-1)), category: path.slice(0, -1).map(fieldLabel).join(' / '), url: documentUrl(value) }); return result
  }
  result.fields.push({ label: fieldLabel(path.at(-1) || 'Details'), group: path.slice(0, -1).map(fieldLabel).join(' / '), value: /date$/i.test(path.at(-1) || '') && /^\d{4}-\d{2}-\d{2}/.test(String(value)) && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleDateString('en-IN') : String(value) }); return result
}
export function uniqueRows(rows, key) { return [...new Map(rows.map(row => [key(row), row])).values()] }
export function companyDocuments(client) {
  return uniqueRows((client.clientMaster || []).flatMap(master => collectDetails(master).documents), row => row.url)
}
export function serviceName(service = {}) { return [service.serviceCategory || service.eprCategory, service.servicesOffered, service.subApplicantType || service.piboCategory].filter(Boolean).join(' Â· ') || 'Account support' }
export function handlingTeam(client) {
  const rows = (client.assignments?.length ? client.assignments : [{ spoc: client.spoc }]).map((row, index) => ({ ...row.spoc, service: serviceName(row.serviceCategory || row.eprCategory || row.servicesOffered ? row : client.services?.[index]), status: row.poStatus }))
  const grouped = new Map()
  rows.forEach(row => { const key = `${row.name}|${row.email}`; const saved = grouped.get(key) || { name: row.name, email: row.email, services: [] }; if (!saved.services.includes(row.service)) saved.services.push(row.service); grouped.set(key, saved) })
  return [...grouped.values()]
}
