import React, { useEffect, useRef, useState } from 'react'
import api, { readApiError } from '../services/api'

export default function QuotationEmailDialog({ quotation, onClose }) {
  const ref = useRef(null)
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState(`Quotation ${quotation.quotationNumber || ''} - AnantTattva Private Limited`)
  const [body, setBody] = useState('Dear Sir/Madam,\n\nPlease find our approved quotation attached for your review. We look forward to hearing from you.')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  useEffect(() => { ref.current.showModal() }, [])
  async function send(event) {
    event.preventDefault()
    if (busy || sent) return
    setBusy(true); setError('')
    try {
      await api.post(`/quotations/${quotation._id}/email`, { email, subject, body })
      setSent(true)
    } catch (err) { setError(readApiError(err, 'Unable to email this quotation. Please retry.')) }
    finally { setBusy(false) }
  }
  return <dialog ref={ref} aria-labelledby="quotation-email-title" onCancel={event => { event.preventDefault(); if (!busy) onClose() }} className="m-auto w-[min(580px,calc(100vw-32px))] rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl backdrop:bg-slate-950/60">
    <h2 id="quotation-email-title" className="text-xl font-black">Email quotation to client</h2>
    {sent ? <div className="mt-5 space-y-5"><p role="status">Quotation email accepted for delivery to <strong>{email}</strong>, with the approved PDF attached.</p><button type="button" onClick={onClose} className="rounded-lg bg-emerald-700 px-5 py-3 font-bold text-white">Done</button></div> : <form onSubmit={send} className="mt-4 space-y-4">
      <p className="text-sm text-slate-500">The approved quotation PDF and AnantTattva email signature will be included automatically.</p>
      <label className="block text-sm font-bold">Client email<input autoFocus type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} className="mt-2 block w-full rounded-lg border border-slate-300 p-3" /></label>
      <label className="block text-sm font-bold">Subject<input required maxLength={200} value={subject} onChange={event => setSubject(event.target.value)} disabled={busy} className="mt-2 block w-full rounded-lg border border-slate-300 p-3" /></label>
      <label className="block text-sm font-bold">Message<textarea required maxLength={10000} rows={6} value={body} onChange={event => setBody(event.target.value)} disabled={busy} className="mt-2 block w-full rounded-lg border border-slate-300 p-3" /></label>
      {error && <p role="alert" className="text-sm font-bold text-red-700">{error}</p>}
      <div className="flex justify-end gap-3"><button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-slate-300 px-5 py-3 font-bold">Cancel</button><button type="submit" disabled={busy} className="rounded-lg bg-emerald-700 px-5 py-3 font-bold text-white disabled:opacity-60">{busy ? 'Sending…' : 'Send quotation'}</button></div>
    </form>}
  </dialog>
}
