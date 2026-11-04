import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readLicenseSession, storeLicenseSession, clearLicenseSession } from '../src/utils/licenseSession.mjs'

test('license verification survives a new tab/session and expires at its original deadline', () => {
  const storage = () => { const map = new Map(); return { getItem: key => map.get(key) || null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) } }
  globalThis.localStorage = storage(); globalThis.sessionStorage = storage()
  const license = { email: 'user@example.test', roleTag: 'USR', licenseToken: 'account-bound-token', expiresAt: Date.now() + 180 * 86400000 }
  storeLicenseSession(license)
  globalThis.sessionStorage = storage()
  assert.equal(readLicenseSession().licenseToken, license.licenseToken)
  storeLicenseSession({ ...license, expiresAt: Date.now() - 1 })
  assert.equal(readLicenseSession(), null)
  storeLicenseSession(license); clearLicenseSession(); assert.equal(readLicenseSession(), null)
  delete globalThis.localStorage; delete globalThis.sessionStorage
})
