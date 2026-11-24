import React from 'react'
import { ImagePlus, Trash2, X } from 'lucide-react'
import { defaultTeams } from '../../constants/dashboard'
import { uploadMedia } from '../../services/mediaUpload'
import RoleSelectManager from './RoleSelectManager'

export default function EditUserModal({ form, saving, roles, onAddRole, canAddRole, onChange, onClose, onSubmit }) {
  async function handleAvatarChange(event) {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) return

    const uploaded = await uploadMedia(file, 'crm/users/avatars')
    onChange({ ...form, avatarUrl: uploaded.secureUrl })
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 px-4 py-6">
      <form onSubmit={onSubmit} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-2xl font-black text-slate-950">Edit User</h2>
          <button type="button" onClick={onClose} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-red-500 transition hover:bg-red-50" aria-label="Close edit" title="Close">
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="mt-7 grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Profile Image">
              <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center">
                <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-700 to-sky-700 text-3xl font-black text-white shadow-lg shadow-emerald-900/15 ring-4 ring-white">
                  {form.avatarUrl ? (
                    <img src={form.avatarUrl} alt="Profile preview" className="h-full w-full object-cover" />
                  ) : (
                    (form.firstName || form.email || 'U').slice(0, 1).toUpperCase()
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-600">Upload PNG, JPG, JPEG, or WEBP under 2MB.</p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <label className="btn-lift inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 font-black text-white shadow-lg shadow-emerald-700/20">
                      <ImagePlus className="h-5 w-5" />
                      Upload Image
                      <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp" onChange={handleAvatarChange} className="sr-only" />
                    </label>
                    {form.avatarUrl && (
                      <button
                        type="button"
                        onClick={() => onChange({ ...form, avatarUrl: '' })}
                        className="btn-lift inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 px-5 font-black text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Field>
          </div>

          <Field label="First Name">
            <input value={form.firstName} onChange={(event) => onChange({ ...form, firstName: event.target.value })} required className="form-input" />
          </Field>
          <Field label="Last Name">
            <input value={form.lastName} onChange={(event) => onChange({ ...form, lastName: event.target.value })} className="form-input" />
          </Field>
        </div>

        <div className="mt-5">
          <Field label="Contact Number">
            <input type="tel" autoComplete="tel" maxLength={24} pattern="[+0-9 ()-]{7,24}" value={form.contactNumber || ''} onChange={(event) => onChange({ ...form, contactNumber: event.target.value })} placeholder="e.g. +91 98765 43210" className="form-input" />
          </Field>
          <p className="mt-2 text-xs text-slate-500">Shown beside the handling user in the client portal.</p>
        </div>
        <div className="mt-5">
          <Field label="Email">
            <input type="email" value={form.email} onChange={(event) => onChange({ ...form, email: event.target.value })} required className="form-input" />
          </Field>
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label="Roles (1–3)">
            <RoleSelectManager value={form.role} values={form.roles} roles={roles} saving={saving} canAddRole={canAddRole} onAddRole={onAddRole} onChange={(selectedRoles) => onChange({ ...form, role: selectedRoles[0], roles: selectedRoles })} />
          </Field>

          <Field label="Status">
            <div className="flex min-h-11 flex-wrap items-center gap-5">
              <label className="inline-flex items-center gap-2 font-bold text-slate-700">
                <input type="radio" checked={form.isActive} onChange={() => onChange({ ...form, isActive: true })} className="h-4 w-4 accent-emerald-700" />
                Active
              </label>
              <label className="inline-flex items-center gap-2 font-bold text-slate-700">
                <input type="radio" checked={!form.isActive} onChange={() => onChange({ ...form, isActive: false })} className="h-4 w-4 accent-emerald-700" />
                InActive
              </label>
            </div>
          </Field>
        </div>

        <div className="mt-5">
          <Field label="Team">
            <select value={form.team} onChange={(event) => onChange({ ...form, team: event.target.value })} className="form-input">
              {defaultTeams.map((team) => (
                <option key={team} value={team}>
                  {team}
                </option>
              ))}
              {form.team && !defaultTeams.includes(form.team) && <option value={form.team}>{form.team}</option>}
            </select>
          </Field>
        </div>

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={saving} className="min-h-11 rounded-lg border border-slate-200 px-7 font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="min-h-11 rounded-lg bg-emerald-700 px-8 font-black text-white shadow-lg shadow-emerald-700/20 transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-70">
            {saving ? 'Updating...' : 'Update'}
          </button>
        </div>
      </form>
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
