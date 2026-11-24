import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Trash2 } from 'lucide-react'

export default function LeadDeleteDialog({ lead, busy, error, onCancel, onConfirm }) {
  const dialogRef = useRef(null)
  const cancelRef = useRef(null)
  useEffect(() => {
    const previousFocus = document.activeElement
    cancelRef.current?.focus()
    return () => previousFocus?.focus?.()
  }, [])
  const handleKeyDown = (event) => {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); onCancel() }
    if (event.key !== 'Tab') return
    const buttons = [...dialogRef.current.querySelectorAll('button:not(:disabled)')]
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (!first) { event.preventDefault(); return }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  return createPortal(<div className="fixed inset-0 z-[220] grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm">
    <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="delete-lead-title" aria-describedby="delete-lead-description" aria-busy={busy} onKeyDown={handleKeyDown} className="w-full max-w-md rounded-2xl border border-rose-100 bg-white p-6 shadow-2xl">
      <span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-rose-100 text-rose-600"><Trash2 className="h-6 w-6" /></span>
      <h2 id="delete-lead-title" className="text-xl font-black text-slate-950">Delete lead?</h2>
      <p id="delete-lead-description" className="mt-3 text-sm leading-6 text-slate-600">Are you sure you want to delete this lead: <strong className="break-words text-slate-900">{lead.company || lead.leadCode || 'Unnamed lead'}</strong>?</p>
      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p>}
      <div className="mt-6 flex justify-end gap-3">
        <button ref={cancelRef} type="button" disabled={busy} onClick={onCancel} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
        <button type="button" disabled={busy} onClick={onConfirm} className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}{busy ? 'Deleting...' : 'Delete'}</button>
      </div>
    </div>
  </div>, document.body)
}
