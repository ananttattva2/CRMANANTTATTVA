const KEY = 'crm_license_session_v1'
export function readLicenseSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || 'null')
    if (!value?.licenseToken || !value.email || !['USR', 'ADM', 'SADM'].includes(value.roleTag) || (!Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now())) return null
    return { ...value, loginMode: value.roleTag === 'USR' ? 'user' : 'admin' }
  } catch { return null }
}
export function storeLicenseSession(value) { sessionStorage.setItem(KEY, JSON.stringify(value)) }
export function clearLicenseSession() { sessionStorage.removeItem(KEY) }
