import React, { useEffect, useRef, useState } from 'react'
import { FileText, Mail, Send, X } from 'lucide-react'
import api, { readApiError } from '../services/api'

export default function InvoiceEmailDialog({ invoice, onClose, onSent }) {
  const dialog = useRef(null)
  const [form, setForm] = useState({ to: '', cc: '', subject: '', body: '' })
  const [copies, setCopies] = useState([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal()
    const controller = new AbortController()
    api.get(`/proforma-invoices/${invoice._id}/email-options`, { signal: controller.signal }).then(({ data }) => {
      setForm({ to: data.to || '', cc: '', subject: data.subject, body: data.body })
      setCopies(data.mandatoryCc || [])
      setLoading(false)
    }).catch(failure => { if (!controller.signal.aborted) { setError(readApiError(failure, 'Unable to prepare email.')); setLoading(false) } })
    return () => controller.abort()
  }, [invoice._id])
  async function submit(event) {
    event.preventDefault()
    if (sending || loading) return
    setSending(true); setError('')
    try {
      const { data } = await api.post(`/proforma-invoices/${invoice._id}/email`, form, { timeout: 90000 })
      onSent(data.message)
    } catch (failure) { setError(readApiError(failure, 'Unable to send invoice.')); setSending(false) }
  }
  return <dialog ref={dialog} aria-labelledby="invoice-email-title" onCancel={event => { if (sending) event.preventDefault(); else onClose() }} className="max-h-[92vh] w-[min(760px,94vw)] overflow-auto rounded-2xl border-0 p-0 shadow-2xl backdrop:bg-slate-950/60">
    <form onSubmit={submit}>
      <header className="flex items-center justify-between border-b bg-emerald-50 p-5"><div className="flex items-center gap-3"><span className="rounded-xl bg-white p-3 text-emerald-700"><Mail /></span><div><h2 id="invoice-email-title" className="text-lg font-bold text-slate-900">Send Proforma Invoice</h2><p className="text-xs text-slate-600">{invoice.proformaNumber} · {invoice.companyName}</p></div></div><button type="button" aria-label="Close email" disabled={sending} onClick={onClose} className="rounded-lg p-2 hover:bg-white"><X /></button></header>
      <div className="space-y-4 p-5">
        {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        {loading ? <p role="status">Preparing email…</p> : <>
          <label className="block text-sm font-bold text-slate-700">To *<input autoFocus required disabled={sending} value={form.to} onChange={event => setForm(current => ({ ...current, to: event.target.value }))} placeholder="client@company.com, another@company.com" className="mt-1 w-full rounded-xl border p-3 font-normal" /></label>
          <label className="block text-sm font-bold text-slate-700">CC<input disabled={sending} value={form.cc} onChange={event => setForm(current => ({ ...current, cc: event.target.value }))} placeholder="person@company.com, colleague@company.com" className="mt-1 w-full rounded-xl border p-3 font-normal" /><small className="mt-1 block font-normal text-slate-500">Separate multiple To or CC addresses with commas.</small></label>
          <section className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3"><h3 className="text-xs font-bold text-emerald-900">Automatically copied</h3><p className="mt-1 text-xs text-slate-600">Invoice creator, you, Admin, Super Admin and Finance / Accounts team.</p><div className="mt-2 flex flex-wrap gap-1">{copies.map(email => <span key={email} className="break-all rounded-md border border-emerald-100 bg-white px-2 py-1 text-xs text-emerald-800">{email}</span>)}</div></section>
          <label className="block text-sm font-bold text-slate-700">Subject *<input required maxLength={200} disabled={sending} value={form.subject} onChange={event => setForm(current => ({ ...current, subject: event.target.value }))} className="mt-1 w-full rounded-xl border p-3 font-normal" /></label>
          <label className="block text-sm font-bold text-slate-700">Message *<textarea required rows={9} maxLength={10000} disabled={sending} value={form.body} onChange={event => setForm(current => ({ ...current, body: event.target.value }))} className="mt-1 w-full rounded-xl border p-3 font-normal leading-relaxed" /></label>
          <div className="flex items-center gap-3 rounded-xl border bg-slate-50 p-3"><FileText className="text-rose-600" /><div><strong className="block text-sm">{invoice.proformaNumber.replaceAll('/', '-')}.pdf</strong><small className="text-slate-500">Saved invoice PDF attached automatically</small></div></div>
        </>}
      </div>
      <footer className="sticky bottom-0 flex justify-end gap-2 border-t bg-white p-4"><button type="button" disabled={sending} onClick={onClose} className="rounded-xl border px-4 py-2 text-sm font-bold">Cancel</button><button type="submit" disabled={sending || loading || !form.to.trim() || !form.subject.trim() || !form.body.trim()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2 text-sm font-bold text-white disabled:opacity-40"><Send size={16} />{sending ? 'Sending…' : 'Send Email'}</button></footer>
    </form>
  </dialog>
}
