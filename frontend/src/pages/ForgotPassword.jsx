import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Eye, EyeOff, KeyRound, Mail } from 'lucide-react'
import AuthLayout from '../components/AuthLayout'
import ToastMessage from '../components/ToastMessage'
import api, { readApiError } from '../services/api'
import { API_ENDPOINTS } from '../services/apiEndpoints'

const inputShell = 'group mt-2 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 shadow-sm transition focus-within:border-emerald-500 focus-within:bg-white focus-within:ring-4 focus-within:ring-emerald-100'

export default function ForgotPassword() {
  const [step, setStep] = useState('request')
  const [form, setForm] = useState({ email: '', otp: '', newPassword: '', confirmPassword: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })
  const update = (key) => (event) => setForm((value) => ({ ...value, [key]: event.target.value }))

  async function requestCode(event) {
    event.preventDefault(); setLoading(true); setMessage({ type: '', text: '' })
    try {
      const response = await api.post(API_ENDPOINTS.auth.forgotPassword, { email: form.email })
      if (import.meta.env.DEV && response.data?.devOtp) setForm((value) => ({ ...value, otp: response.data.devOtp }))
      setStep('reset'); setMessage({ type: 'success', text: response.data.message })
    } catch (error) { setMessage({ type: 'error', text: readApiError(error, 'Unable to send reset code') }) }
    finally { setLoading(false) }
  }

  async function resetPassword(event) {
    event.preventDefault(); setLoading(true); setMessage({ type: '', text: '' })
    try {
      const response = await api.post(API_ENDPOINTS.auth.resetPassword, form)
      setStep('done'); setMessage({ type: 'success', text: response.data.message })
    } catch (error) { setMessage({ type: 'error', text: readApiError(error, 'Unable to reset password') }) }
    finally { setLoading(false) }
  }

  return <AuthLayout eyebrow="Account recovery" title={step === 'done' ? 'Password updated' : 'Reset your password'} subtitle={step === 'request' ? 'Enter your registered work email to receive a secure reset code.' : step === 'reset' ? 'Enter the 6-digit code and choose a new password.' : 'Your new password is ready to use.'}>
    {message.text && <ToastMessage type={message.type} className="mt-6">{message.text}</ToastMessage>}
    {step === 'request' && <form onSubmit={requestCode} className="mt-7 space-y-5">
      <Field label="Work email" icon={Mail}><input type="email" required autoComplete="email" value={form.email} onChange={update('email')} className="min-w-0 flex-1 bg-transparent font-semibold outline-none" placeholder="name@company.com" /></Field>
      <Submit loading={loading} label="Send reset code" />
    </form>}
    {step === 'reset' && <form onSubmit={resetPassword} className="mt-7 space-y-4">
      <Field label="6-digit reset code" icon={KeyRound}><input inputMode="numeric" pattern="[0-9]{6}" maxLength="6" required value={form.otp} onChange={update('otp')} className="min-w-0 flex-1 bg-transparent font-semibold tracking-[.3em] outline-none" placeholder="000000" /></Field>
      <Field label="New password" icon={KeyRound}><input type={showPassword ? 'text' : 'password'} minLength="8" required autoComplete="new-password" value={form.newPassword} onChange={update('newPassword')} className="min-w-0 flex-1 bg-transparent font-semibold outline-none" placeholder="Minimum 8 characters" /><EyeButton shown={showPassword} toggle={() => setShowPassword((v) => !v)} /></Field>
      <Field label="Confirm password" icon={KeyRound}><input type={showPassword ? 'text' : 'password'} minLength="8" required autoComplete="new-password" value={form.confirmPassword} onChange={update('confirmPassword')} className="min-w-0 flex-1 bg-transparent font-semibold outline-none" placeholder="Repeat new password" /></Field>
      <Submit loading={loading} label="Reset password" />
      <button type="button" onClick={() => { setStep('request'); setMessage({ type: '', text: '' }) }} className="w-full text-sm font-black text-slate-600">Request another code</button>
    </form>}
    <Link to="/login" className="mt-6 flex items-center justify-center gap-2 text-sm font-black text-emerald-700"><ArrowLeft className="h-4 w-4" /> Back to sign in</Link>
  </AuthLayout>
}

function Field({ label, icon: Icon, children }) { return <label className="block"><span className="text-sm font-black text-slate-700">{label}</span><div className={inputShell}><Icon className="h-5 w-5 text-emerald-600" />{children}</div></label> }
function Submit({ loading, label }) { return <button disabled={loading} className="btn-lift flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-700 via-teal-700 to-sky-700 px-5 py-4 font-black text-white disabled:opacity-70"><span>{loading ? 'Please wait...' : label}</span><ArrowRight className="h-5 w-5" /></button> }
function EyeButton({ shown, toggle }) { return <button type="button" onClick={toggle} className="text-slate-500" aria-label={shown ? 'Hide password' : 'Show password'}>{shown ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button> }
