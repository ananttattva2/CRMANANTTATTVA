import React, { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react'
import AuthLayout from '../components/AuthLayout'
import ToastMessage from '../components/ToastMessage'
import api, { readApiError, storeSessionUser } from '../services/api'
import { API_ENDPOINTS } from '../services/apiEndpoints'
import { readLicenseSession, clearLicenseSession } from '../utils/licenseSession.mjs'
import { defaultLandingPath } from '../utils/defaultLanding.mjs'

export default function VerifyOtp(){
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(60)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [otpFocused, setOtpFocused] = useState(false)
  const otpInputRef = useRef(null)
  const navigate = useNavigate()
  const location = useLocation()
  const license = readLicenseSession()
  const email = location.state?.email || localStorage.getItem('login_email') || ''
  const loginMode = location.state?.loginMode || localStorage.getItem('login_mode') || 'user'
  const [devOtp, setDevOtp] = useState(() => import.meta.env.DEV ? localStorage.getItem('dev_otp') || '' : '')
  const otpSlots = Array.from({ length: 6 }, (_, index) => otp[index] || '')

  useEffect(() => {
    if (resendCooldown <= 0) return undefined
    const timer = window.setTimeout(() => setResendCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [resendCooldown])

  async function handleVerify(e){
    e.preventDefault()
    setLoading(true)
    setError('')
    setNotice('')
    try{
      if (!email) {
        setError('Session expired. Please login again.')
        return
      }
      const res = await api.post(API_ENDPOINTS.auth.verifyOtp, { email, otp, loginMode, licenseToken: license.licenseToken })
      localStorage.setItem('token', res.data.token)
      storeSessionUser(res.data.user)
      localStorage.removeItem('login_email')
      localStorage.removeItem('login_mode')
      localStorage.removeItem('dev_otp')
      navigate(defaultLandingPath(res.data.user), { replace: true })
    }catch(err){
      if (err.response?.data?.code === 'LICENSE_REQUIRED') { clearLicenseSession(); navigate('/license', { replace: true }); return }
      const message = readApiError(err, 'Invalid OTP')
      setError(message)
      if (/invalid otp|expired|no active otp/i.test(message)) {
        setResendCooldown(0)
      }
    }finally{ setLoading(false) }
  }

  async function handleResend(){
    if (!email || resending || resendCooldown > 0) return
    setResending(true)
    setError('')
    setNotice('')
    try {
      const res = await api.post(API_ENDPOINTS.auth.resendOtp, { email, loginMode, licenseToken: license.licenseToken })
      setOtp('')
      setNotice(res.data?.message || 'A new OTP has been sent to your email.')
      setResendCooldown(60)
      if (import.meta.env.DEV && res.data?.devOtp) {
        localStorage.setItem('dev_otp', res.data.devOtp)
        setDevOtp(res.data.devOtp)
      } else {
        localStorage.removeItem('dev_otp')
        setDevOtp('')
      }
    } catch (err) {
      if (err.response?.data?.code === 'LICENSE_REQUIRED') { clearLicenseSession(); navigate('/license', { replace: true }); return }
      const message = readApiError(err, 'Unable to resend OTP')
      setError(message)
      const match = String(message).match(/(\d+)\s*seconds/i)
      if (match) setResendCooldown(Number(match[1]))
    } finally {
      setResending(false)
    }
  }

  if (!license) return <Navigate to="/license" replace />

  return (
    <AuthLayout
      eyebrow={loginMode === 'admin' ? 'Admin OTP verification' : 'User OTP verification'}
      title="Enter secure OTP"
      subtitle={`Enter the 6-digit code sent to ${email || 'your email address'} for ${loginMode === 'admin' ? 'Admin Login' : 'User Login'}.`}
    >
      <form onSubmit={handleVerify} className="mt-8 space-y-5">
        <label className="block">
          <span className="text-sm font-black text-slate-700">Login OTP</span>
          <div
            className={`auth-otp-field group mt-2 rounded-2xl border bg-slate-50 px-4 py-4 shadow-sm transition duration-300 ${otpFocused ? 'auth-otp-field-focused -translate-y-0.5 border-emerald-500 bg-white shadow-lg shadow-emerald-900/10 ring-4 ring-emerald-100' : 'border-slate-200'}`}
            onClick={() => otpInputRef.current?.focus()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-emerald-700">
                <LockKeyhole className="h-4 w-4" />
                Secure 6 digit code
              </span>
              <span className="auth-otp-progress">{otp.length}/6</span>
            </div>
            <div className="relative">
            <input
              ref={otpInputRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength="6"
              placeholder=""
              required
              value={otp}
              onFocus={() => setOtpFocused(true)}
              onBlur={() => setOtpFocused(false)}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
            />
              <div className="grid grid-cols-6 gap-2 sm:gap-3">
                {otpSlots.map((value, index) => {
                  const active = otpFocused && index === Math.min(otp.length, 5)
                  const filled = Boolean(value)
                  return (
                    <span
                      key={index}
                      className={`auth-otp-slot ${filled ? 'auth-otp-slot-filled' : ''} ${active ? 'auth-otp-slot-active' : ''}`}
                    >
                      {filled ? value : <i />}
                    </span>
                  )
                })}
              </div>
            </div>
          </div>
        </label>
        {devOtp && <ToastMessage type="warning">Development OTP: {devOtp}</ToastMessage>}
        {notice && <ToastMessage type="success">{notice}</ToastMessage>}
        {error && <ToastMessage type="error">{error}</ToastMessage>}
        <button className="btn-lift group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-700 via-teal-700 to-sky-700 px-5 py-4 font-black text-white shadow-xl shadow-emerald-900/20 transition disabled:cursor-not-allowed disabled:opacity-70" disabled={loading || !email || otp.length !== 6}>
          <span className="absolute inset-0 -translate-x-full bg-white/20 transition duration-700 group-hover:translate-x-full" />
          <CheckCircle2 className="relative h-5 w-5" />
          <span className="relative">{loading ? 'Verifying...' : 'Verify and login'}</span>
        </button>
        <button
          type="button"
          onClick={handleResend}
          disabled={!email || resending || resendCooldown > 0}
          className="btn-lift flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-white px-5 py-3.5 font-black text-emerald-700 shadow-sm transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${resending ? 'animate-spin' : ''}`} />
          {resending ? 'Resending OTP...' : resendCooldown > 0 ? `Resend OTP in ${resendCooldown}s` : 'Resend OTP'}
        </button>
        <Link to="/login" className="inline-flex items-center gap-2 text-sm font-bold text-teal-700 hover:text-teal-900">
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>
      </form>
    </AuthLayout>
  )
}
