import React, { useEffect, useRef } from 'react'
import { BarChart3, Download, Users, X } from 'lucide-react'

export default function PdfExportChoice({ canViewUsers, onChoose, onClose }) {
  const dialog = useRef(null)
  useEffect(() => { if (!dialog.current.open) dialog.current.showModal() }, [])
  return <dialog ref={dialog} aria-labelledby="pdf-export-title" onCancel={onClose} onClose={onClose} onClick={(event) => { if (event.target === dialog.current) onClose() }} className="m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-3xl border border-teal-100 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/40 backdrop:backdrop-blur-sm">
    <div className="p-6 sm:p-8"><div className="flex items-start justify-between gap-4"><div><span className="mb-4 inline-flex rounded-2xl bg-teal-50 p-3 text-teal-700"><Download size={24} /></span><h2 id="pdf-export-title" className="text-xl font-bold">Which dashboard would you like to download?</h2><p className="mt-2 text-sm text-slate-500">Choose a PDF report. All financial years and client details are included.</p></div><button type="button" aria-label="Close PDF choices" onClick={onClose} className="rounded-xl bg-slate-100 p-2 text-slate-500 hover:bg-slate-200"><X size={18} /></button></div>
      <div className="mt-6 space-y-3"><button type="button" onClick={() => onChoose('overall')} className="flex w-full items-center gap-4 rounded-2xl border border-teal-100 bg-teal-50/60 p-4 text-left transition hover:border-teal-400 hover:bg-teal-50"><BarChart3 className="shrink-0 text-teal-700" /><span><strong className="block text-teal-900">Application Dashboard</strong><span className="mt-1 block text-xs text-slate-600">Charts, applicant matrices and client service details.</span></span></button>{canViewUsers && <button type="button" onClick={() => onChoose('users')} className="flex w-full items-center gap-4 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 text-left transition hover:border-indigo-400 hover:bg-indigo-50"><Users className="shrink-0 text-indigo-700" /><span><strong className="block text-indigo-900">User-wise Dashboard</strong><span className="mt-1 block text-xs text-slate-600">Operations users, their managers and client service details.</span></span></button>}</div>
    </div>
  </dialog>
}
