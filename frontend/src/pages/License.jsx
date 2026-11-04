import React, { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Fingerprint, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react'
import AuthLayout from '../components/AuthLayout'
import ToastMessage from '../components/ToastMessage'
import api, { readApiError } from '../services/api'
import { API_ENDPOINTS } from '../services/apiEndpoints'
import { clearLicenseSession, readLicenseSession, storeLicenseSession } from '../utils/licenseSession.mjs'
import '../styles/license.css'

export default function License() {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  async function verify(event) {
    event.preventDefault()
    if (loading) return
    setLoading(true); setError(''); clearLicenseSession()
    try {
      const { data } = await api.post(API_ENDPOINTS.auth.validateLicense, { license: code })
      storeLicenseSession(data)
      navigate('/login', { replace: true })
    } catch (err) { setError(readApiError(err, 'Unable to verify your license. Please try again.')) }
    finally { setLoading(false) }
  }
  function updateCode(value) {
    const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)
    setCode([clean.slice(0, 4), clean.slice(4, 8), clean.slice(8, 12), clean.slice(12, 16), clean.slice(16)].filter(Boolean).join('-'))
  }
  if (readLicenseSession()) return <Navigate to="/login" replace />
  return <AuthLayout eyebrow="Your secure workspace" title="Access starts here." subtitle="One personal license. The right workspace, ready for you.">
    <div className="license-progress" aria-label="Step 1 of 3: License verification">
      <span className="is-current">01 <b>License</b></span><i /><span>02 <b>Sign in</b></span><i /><span>03 <b>Verify</b></span>
    </div>
    <div className="license-pass" aria-hidden="true">
      <div className="license-pass-top"><span>ANANT TATTVA</span><ShieldCheck size={20} /></div>
      <Fingerprint className="license-fingerprint" size={48} strokeWidth={1.2} />
      <p>YOUR PERSONAL ACCESS KEY</p>
      <div className="license-pass-code">•••• <span>—</span> •••• <span>—</span> ••••</div>
      <div className="license-pass-bottom"><span>CRM WORKSPACE</span><span><i /> SECURE ACCESS</span></div>
    </div>
    <form onSubmit={verify} className="mt-6 space-y-5">
      <label className="block" htmlFor="staff-license">
        <span className="text-sm font-black text-slate-700">Enter your license key</span>
        <div className="license-input-wrap"><KeyRound size={21} aria-hidden="true" /><input id="staff-license" name="license" type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="RIYA-8F2K-X9P4-M7Q3-USR" value={code} onChange={event => updateCode(event.target.value)} maxLength={24} required aria-describedby="license-help" disabled={loading} /></div>
      </label>
      <p id="license-help" className="text-sm leading-6 text-slate-500">Find your personal key in the license email sent to your registered work address.</p>
      {error && <div role="alert"><ToastMessage type="error">{error}</ToastMessage></div>}
      <button type="submit" disabled={loading || !/^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}-(USR|ADM|SADM)$/.test(code)} className="license-submit"><span>{loading ? 'Verifying your license…' : 'Unlock my workspace'}</span><ArrowRight size={19} aria-hidden="true" /></button>
    </form>
    <p className="license-security"><LockKeyhole size={14} aria-hidden="true" /> Protected access · Personal to your account</p>
    <div className="license-footer"><Link to="/"><ArrowLeft size={14} /> Back to website</Link><span>Missing your key? Contact your admin.</span></div>
  </AuthLayout>
}
