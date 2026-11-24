import React from 'react'
import { CalendarDays, Edit3, Mail, ShieldCheck, UserRound, X } from 'lucide-react'
import { getUserRoles, roleLabels } from '../../constants/dashboard'

function formatValue(value) {
  if (!value) return 'Never'
  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value))
}

function splitName(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] || '-',
    lastName: parts.slice(1).join(' ') || '-'
  }
}

export default function UserDetailsModal({ user, onClose, onEdit }) {
  const name = splitName(user?.name)
  const fields = [
    ['First Name', name.firstName, UserRound],
    ['Last Name', name.lastName, UserRound],
    ['Email', user?.email, Mail],
    ['Roles', getUserRoles(user).map((role) => roleLabels[role] || role).join(' • '), ShieldCheck],
    ['Team', user?.team || 'No team assigned', UserRound],
    ['Enabled', user?.isActive ? 'Yes' : 'No', ShieldCheck],
    ['Account Status', user?.isActive ? 'Active' : 'Inactive', ShieldCheck],
    ['Login Attempts', '0', ShieldCheck],
    ['Lock Until', 'Not locked', CalendarDays],
    ['Removed', 'No', ShieldCheck],
    ['Last Login', formatValue(user?.lastLogin), CalendarDays],
    ['Created At', formatValue(user?.createdAt), CalendarDays]
  ]

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-[28px] border border-white bg-white p-5 shadow-2xl shadow-slate-950/25 sm:p-6">
        <div className="rounded-2xl bg-gradient-to-r from-emerald-700 via-teal-700 to-sky-700 p-5 text-white">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/15 text-xl font-black">
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt={user?.name || 'User'} className="h-full w-full rounded-2xl object-cover" />
                ) : (
                  (name.firstName || 'U').slice(0, 1).toUpperCase()
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-100">User Details</p>
                <h2 className="mt-1 truncate text-2xl font-black">{user?.name || 'CRM User'}</h2>
                <p className="truncate text-sm font-bold text-white/75">{user?.email}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="btn-lift inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white transition hover:bg-white/20"
              aria-label="Close details"
              title="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {fields.map(([label, value, Icon]) => (
            <div key={label} className="group rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 transition duration-300 hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-white hover:shadow-lg hover:shadow-emerald-900/5">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-emerald-700 shadow-sm transition duration-300 group-hover:bg-emerald-50 group-hover:scale-105">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.08em] text-slate-500">{label}</p>
                  <p className="mt-1 break-words font-black text-slate-900">{value || '-'}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="btn-lift min-h-11 rounded-xl border border-slate-200 px-7 font-black text-slate-700 transition hover:bg-slate-50">
            Close
          </button>
          <button type="button" onClick={onEdit} className="btn-lift inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-8 font-black text-white shadow-lg shadow-emerald-700/20 transition hover:bg-emerald-800">
            <Edit3 className="h-4 w-4" />
            Edit
          </button>
        </div>
      </div>
    </div>
  )
}
