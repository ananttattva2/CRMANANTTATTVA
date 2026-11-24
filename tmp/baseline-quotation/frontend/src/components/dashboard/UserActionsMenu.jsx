import React from 'react'
import { Activity, Edit3, Eye, MoreVertical } from 'lucide-react'

export default function UserActionsMenu({ open, onToggle, onView, onEdit, onActivity, label }) {
  return (
    <div className="relative inline-flex justify-center">
      <button
        type="button"
        onClick={onToggle}
        className="btn-lift inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-emerald-50 hover:text-emerald-700"
        aria-label={label}
        title="Actions"
      >
        <MoreVertical className="h-5 w-5" />
      </button>

      {open && (
        <div className="absolute right-5 top-8 z-30 flex items-center gap-1 rounded-xl bg-white p-2 shadow-xl shadow-slate-900/15 ring-1 ring-emerald-100">
          <button
            type="button"
            onClick={onView}
            className="btn-lift inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 transition hover:bg-emerald-50 hover:text-emerald-700"
            aria-label="View user"
            title="View user"
          >
            <Eye className="h-4 w-4" />
          </button>
          {onActivity && <button type="button" onClick={onActivity} className="btn-lift inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 transition hover:bg-violet-50 hover:text-violet-700" aria-label="View activity" title="View activity"><Activity className="h-4 w-4" /></button>}
          <button
            type="button"
            onClick={onEdit}
            className="btn-lift inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 transition hover:bg-sky-50 hover:text-sky-700"
            aria-label="Edit user"
            title="Edit user"
          >
            <Edit3 className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}
