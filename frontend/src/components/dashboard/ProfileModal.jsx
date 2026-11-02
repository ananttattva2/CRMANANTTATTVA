import React, { useState } from 'react'
import { ArrowLeft, Edit3, Eye, EyeOff, KeyRound, LogOut, Save, ShieldCheck, X } from 'lucide-react'
import ToastMessage from '../ToastMessage'
import { roleLabels } from '../../constants/dashboard'

function splitName(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ') || ''
  }
}

const TEAM_THOUGHTS = {
  operations: [
    'Great operations turn every promise into a dependable result.',
    'Clarity, ownership and consistency create operational excellence.',
    'The best process is the one that makes quality repeatable.',
    'Small improvements, repeated daily, build exceptional operations.'
  ],
  sales: [
    'Great sales begin with trust and grow through genuine value.',
    'Listen deeply, solve clearly and relationships will follow.',
    'Every customer conversation is an opportunity to create value.',
    'Consistency builds the pipeline; credibility closes the relationship.'
  ],
  compliance: [
    'Strong compliance transforms responsibility into lasting trust.',
    'Accuracy today protects the organisation tomorrow.',
    'Good governance makes sustainable growth possible.'
  ],
  management: [
    'Leadership creates clarity, enables people and owns the outcome.',
    'Great teams grow where purpose and accountability meet.',
    'Measure what matters, support people and improve continuously.'
  ],
  technology: [
    'Build simply, secure deliberately and improve continuously.',
    'Reliable technology turns complex work into confident action.',
    'The best systems make the right work easier to do.'
  ]
}

function getTeamThought(user = {}, visitNumber = 1) {
  const teamText = `${user?.department || ''} ${user?.team?.name || user?.team || ''} ${user?.role || ''}`.toLowerCase()
  const key = teamText.includes('sale') ? 'sales'
    : teamText.includes('compliance') || teamText.includes('annual') ? 'compliance'
      : teamText.includes('manager') || teamText.includes('admin') || teamText.includes('head') ? 'management'
        : teamText.includes('tech') || teamText.includes('it') || teamText.includes('developer') ? 'technology'
          : 'operations'
  const thoughts = TEAM_THOUGHTS[key]
  return { label: `${key} thought`, text: thoughts[Math.floor((visitNumber - 1) / 5) % thoughts.length] }
}

export default function ProfileModal({ user, saving, error = '', onClose, onLogout, onSave, onUpdatePassword }) {
  const name = splitName(user?.name)
  const [profileError, setProfileError] = useState('')
  const [editing, setEditing] = useState(false)
  const [securityOpen, setSecurityOpen] = useState(false)
  const [form, setForm] = useState({
    firstName: name.firstName,
    lastName: name.lastName,
    email: user?.email || ''
  })
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  })
  const [passwordMessage, setPasswordMessage] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [profileVisit] = useState(() => {
    const storageKey = `crm-profile-visits-${user?._id || user?.id || user?.email || 'current'}`
    try {
      const nextVisit = Number(window.localStorage.getItem(storageKey) || 0) + 1
      window.localStorage.setItem(storageKey, String(nextVisit))
      return nextVisit
    } catch { return 1 }
  })
  const teamThought = getTeamThought(user, profileVisit)

  async function submit(event) {
    event.preventDefault(); setProfileError('');
    try { await onSave({ name: `${form.firstName} ${form.lastName}`.trim(), email: form.email }); setEditing(false); }
    catch (error) { setProfileError(error.message || 'Unable to update your profile.'); }
  }

  async function submitPassword(event) {
    event.preventDefault()
    setPasswordMessage('')
    setPasswordError('')

    try {
      await onUpdatePassword(passwordForm)
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setPasswordMessage('Password updated successfully.')
    } catch (err) {
      setPasswordError(err.message || 'Unable to update password')
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="profile-settings-title" className="profile-modal-overlay fixed inset-0 z-[120] grid place-items-center bg-slate-950/50 px-4 py-6">
      <div className="profile-modal-card max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-3xl bg-white shadow-2xl shadow-slate-900/20">
        <div className="profile-modal-head flex items-center justify-between border-b border-slate-100 px-6 py-5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="profile-modal-icon-button inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-emerald-700"
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h2 id="profile-settings-title" className="text-2xl font-black text-slate-950">Profile Settings</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="profile-modal-close inline-flex h-10 w-10 items-center justify-center rounded-lg text-red-500 transition hover:bg-red-50"
            aria-label="Close profile"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {(profileError || error) && <p role="alert" className="mx-6 mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{profileError || error}</p>}
        <div className="profile-modal-body grid gap-8 p-6 lg:grid-cols-[280px_1fr] lg:p-10">
          <aside className="profile-identity-card rounded-2xl bg-gradient-to-br from-emerald-700 to-teal-600 p-6 text-white shadow-xl shadow-emerald-700/20">
            <div className="profile-summary-card">
              <div className="profile-summary-avatar">
                {user?.avatarUrl
                  ? <img src={user.avatarUrl} alt={`${user?.name || 'User'} profile`} />
                  : (user?.name || user?.email || 'U').slice(0, 1).toUpperCase()}
              </div>
              <p className="profile-summary-name">{user?.name || 'CRM User'}</p>
              <p className="profile-summary-email">{user?.email}</p>
              <span className="profile-summary-role">{roleLabels[user?.role] || user?.role}</span>
            </div>
            <div className="profile-id-lanyard" aria-hidden="true">
              <div className="profile-lanyard-strap"><span>ANANTTATTVA</span><i /></div>
              <div className="profile-lanyard-ring" />
              <div className="profile-lanyard-clip"><b /></div>
              <div className="profile-lanyard-hook" />
            </div>
            <div className="profile-id-card-inner">
            <div className="profile-id-face profile-id-front">
            <div className="profile-id-brand" aria-label="Anant Tattva Private Limited">
              <img src="/favicon.svg" alt="" />
              <div><strong><b>ANANT</b> TATTVA</strong><small>PRIVATE LIMITED</small></div>
            </div>
            <div className="profile-avatar-ring mx-auto grid h-28 w-28 place-items-center rounded-full bg-white/15 text-5xl font-black ring-8 ring-white/10">
              {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : (user?.name || user?.email || 'U').slice(0, 1).toUpperCase()}
            </div>
            <div className="mt-6 text-center">
              <p className="text-xl font-black">{user?.name || 'CRM User'}</p>
              <p className="mt-1 break-words text-sm font-bold text-emerald-50">{user?.email}</p>
              <span className="mt-4 inline-flex rounded-full bg-white/15 px-4 py-2 text-xs font-black uppercase tracking-[0.14em]">
                {roleLabels[user?.role] || user?.role}
              </span>
            </div>
            <div className="profile-id-meta">
              <div><i>ID</i><small>ID NO.</small><strong>{user?.employeeId || user?.crmUserId || user?.userId || `ATPL/${String(user?._id || user?.id || 'CRM').slice(-6).toUpperCase()}`}</strong></div>
              <div><i>D</i><small>DEPT.</small><strong>{user?.department || 'CRM Operations'}</strong></div>
              <div><i>@</i><small>EMAIL</small><strong>{user?.email || '-'}</strong></div>
            </div>
            <div className="profile-id-signature"><span>Authorised Signatory</span></div>
            </div>
            <div className="profile-id-face profile-id-back">
              <div className="profile-id-brand" aria-label="Anant Tattva Private Limited">
                <img src="/favicon.svg" alt="" />
                <div><strong><b>ANANT</b>TATTVA</strong><small>PRIVATE LIMITED</small></div>
              </div>
              <div className="profile-back-contact">
                <div className="profile-back-lines">
                  <p className="profile-contact-phone"><i>☎</i><span><b>Phone</b>{user?.mobile || user?.mobileNumber || user?.phone || user?.contactNumber || '+91 12345 67890'}</span></p>
                  <p><i>@</i><span><b>Email</b>{user?.email || 'info@ananttattva.com'}</span></p>
                  <p><i>⌖</i><span><b>Office Address</b>AnantTattva Private Limited<br />1st Floor, A/25, Technocraft House<br />Road No. 3, MIDC<br />Andheri East, Mumbai – 400093</span></p>
                </div>
              </div>
              <div className="profile-back-thought"><small>{teamThought.label}</small><p>“{teamThought.text}”</p><span>New thought every 5 profile visits</span></div>
              <div className="profile-back-web">◉ {user?.companyWebsite || 'www.ananttattva.com'}</div>
            </div>
            </div>
          </aside>

          <section className="profile-details-panel">
            <div className="profile-section-head flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black uppercase tracking-[0.16em] text-emerald-700">Account Settings</p>
                <h3 className="mt-1 text-2xl font-black text-slate-950">Personal Information</h3>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setEditing((value) => !value)}
                  className="profile-primary-button inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-4 font-black text-white shadow-lg shadow-emerald-700/20 transition hover:bg-emerald-800"
                >
                  <Edit3 className="h-4 w-4" />
                  {editing ? 'Cancel Edit' : 'Edit'}
                </button>
                <button
                  type="button"
                  onClick={() => setSecurityOpen((value) => !value)}
                  className="profile-secondary-button inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-4 font-black text-slate-700 transition hover:bg-slate-50"
                >
                  <KeyRound className="h-4 w-4" />
                  Update Password
                </button>
              </div>
            </div>

            {editing ? (
              <form onSubmit={submit} className="profile-edit-form mt-6 grid gap-5 sm:grid-cols-2">
                <Field label="First Name">
                  <input value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} className="form-input" required />
                </Field>
                <Field label="Last Name">
                  <input value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} className="form-input" />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Email">
                    <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="form-input" required />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-emerald-700 px-6 font-black text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <Save className="h-4 w-4" />
                    {saving ? 'Saving...' : 'Save Profile'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="profile-info-grid mt-6 grid gap-4 sm:grid-cols-2">
                <InfoTile label="First Name" value={name.firstName || '-'} />
                <InfoTile label="Last Name" value={name.lastName || '-'} />
                <InfoTile label="Email" value={user?.email} />
                <InfoTile label="Role" value={roleLabels[user?.role] || user?.role} />
              </div>
            )}

            {securityOpen && (
              <form onSubmit={submitPassword} className="profile-security-card mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-950 text-white">
                    <ShieldCheck className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-black text-slate-950">Update Password</p>
                    <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">Set a strong password for admin security. OTP login remains available.</p>
                  </div>
                </div>

                <div className="mt-5 grid gap-4">
                  <PasswordField
                    label="Old Password"
                    value={passwordForm.currentPassword}
                    placeholder="Enter your current password"
                    onChange={(value) => setPasswordForm({ ...passwordForm, currentPassword: value })}
                  />
                  <PasswordField
                    label="New Password"
                    value={passwordForm.newPassword}
                    placeholder="Enter new password"
                    onChange={(value) => setPasswordForm({ ...passwordForm, newPassword: value })}
                  />
                  <PasswordField
                    label="Confirm Password"
                    value={passwordForm.confirmPassword}
                    placeholder="Confirm new password"
                    onChange={(value) => setPasswordForm({ ...passwordForm, confirmPassword: value })}
                  />
                </div>

                {passwordError && <ToastMessage type="error" className="mt-4">{passwordError}</ToastMessage>}
                {passwordMessage && <ToastMessage type="success" className="mt-4">{passwordMessage}</ToastMessage>}

                <div className="mt-5 flex flex-wrap justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSecurityOpen(false)
                      setPasswordError('')
                      setPasswordMessage('')
                    }}
                    className="profile-ghost-button inline-flex min-h-11 items-center rounded-lg border border-slate-200 bg-white px-5 font-black text-slate-700 transition hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="profile-dark-button inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-950 px-5 font-black text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <KeyRound className="h-4 w-4" />
                    {saving ? 'Updating...' : 'Update Password'}
                  </button>
                </div>
              </form>
            )}

            <div className="profile-footer-actions mt-8 flex justify-end border-t border-slate-200 pt-6">
              <button
                type="button"
                onClick={onLogout}
                className="profile-logout-button inline-flex min-h-11 items-center gap-2 rounded-lg border border-red-200 px-5 font-black text-red-600 transition hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-sm font-black text-slate-700">{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  )
}

function InfoTile({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4">
      <p className="text-sm font-black text-slate-500">{label}</p>
      <p className="mt-1 break-words font-black text-slate-950">{value || '-'}</p>
    </div>
  )
}

function PasswordField({ label, value, placeholder, onChange }) {
  const [visible, setVisible] = useState(false)

  return (
    <label className="block">
      <span className="text-sm font-black text-slate-700">
        <span className="text-red-500">*</span> {label}
      </span>
      <div className="mt-2 flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 transition focus-within:border-teal-500 focus-within:ring-4 focus-within:ring-teal-100">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent font-bold text-slate-950 outline-none placeholder:text-slate-400"
          required={label !== 'Old Password'}
          minLength={label === 'New Password' ? 8 : undefined}
        />
        <button
          type="button"
          onClick={() => setVisible((state) => !state)}
          className="ml-3 inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
          title={visible ? `Hide ${label}` : `Show ${label}`}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </label>
  )
}
