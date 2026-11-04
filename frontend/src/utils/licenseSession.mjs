const KEY = 'crm_license_session_v1'
export function readLicenseSession() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || sessionStorage.getItem(KEY) || 'null')
    if (!value?.licenseToken || !value.email || !['USR', 'ADM', 'SADM'].includes(value.roleTag) || (!Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now())) return null
    return { ...value, loginMode: value.roleTag === 'USR' ? 'user' : 'admin' }
  } catch { return null }
}
export function storeLicenseSession(value) { localStorage.setItem(KEY, JSON.stringify(value)); sessionStorage.removeItem(KEY) }
export function clearLicenseSession() { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY) }
