import { getCrmGeneration } from './crmFreshness'
const entries = new Map()
function context() { return `${localStorage.getItem('token') || ''}:${getCrmGeneration()}` }
export function readPageSnapshot(key) {
  const row = entries.get(key)
  if (!row || row.context !== context() || row.expires <= Date.now()) return null
  return row.data
}
export function savePageSnapshot(key, data, response) {
  const token = localStorage.getItem('token') || ''
  if (response?.config?._crmReadGeneration !== getCrmGeneration() || response?.config?.headers?.Authorization !== `Bearer ${token}`) return
  if (entries.size >= 12 && !entries.has(key)) entries.delete(entries.keys().next().value)
  entries.set(key, { context: context(), expires: Date.now() + 30000, data })
}
