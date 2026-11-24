import React, { useEffect, useRef, useState } from 'react'
import api, { readApiError } from '../services/api'
import { eprCreditTotalAmount, quotationEprCreditCalculationRows } from '../utils/eprCreditCalculation.mjs'

const MAX_EMAIL_ATTACHMENTS = 5
const MAX_EMAIL_ATTACHMENT_SIZE = 5 * 1024 * 1024
const MAX_EMAIL_ATTACHMENT_TOTAL_SIZE = 15 * 1024 * 1024
const EMAIL_ATTACHMENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'])

export default function QuotationEmailDialog({ quotation, onClose }) {
  const ref = useRef(null)
  const creditRows = quotationEprCreditCalculationRows(quotation)
  const hasCreditRows = creditRows.length > 0
  const [email, setEmail] = useState('')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState(`Quotation ${quotation.quotationNumber || ''} - AnantTattva Private Limited`)
  const [body, setBody] = useState('Dear Sir/Madam,\n\nPlease find our approved quotation attached for your review. We look forward to hearing from you.')
  const [activeTab, setActiveTab] = useState('email')
  const [creditTargets, setCreditTargets] = useState(() => Object.fromEntries(
    creditRows.map(row => [row.itemIndex, row.targetMt === '' ? '' : String(row.targetMt)])
  ))
  const [busy, setBusy] = useState(false)
  const [savingCalculation, setSavingCalculation] = useState(false)
  const [error, setError] = useState('')
  const [calculationError, setCalculationError] = useState('')
  const [calculationSaved, setCalculationSaved] = useState(false)
  const [imageAttachments, setImageAttachments] = useState([])
  const [attachmentError, setAttachmentError] = useState('')
  const [sent, setSent] = useState(false)
  useEffect(() => { ref.current.showModal() }, [])

  function addAttachments(event) {
    const selected = Array.from(event.currentTarget.files || [])
    event.currentTarget.value = ''
    if (!selected.length) return
    const combined = [...imageAttachments, ...selected]
    if (combined.length > MAX_EMAIL_ATTACHMENTS) {
      setAttachmentError(`Attach up to ${MAX_EMAIL_ATTACHMENTS} files.`)
      return
    }
    if (combined.some(file => !EMAIL_ATTACHMENT_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_EMAIL_ATTACHMENT_SIZE)) {
      setAttachmentError('Choose valid JPEG, PNG, GIF, WebP, or PDF files up to 5 MB each.')
      return
    }
    if (combined.reduce((total, file) => total + file.size, 0) > MAX_EMAIL_ATTACHMENT_TOTAL_SIZE) {
      setAttachmentError('The total size of attached files cannot exceed 15 MB.')
      return
    }
    setImageAttachments(combined)
    setAttachmentError('')
  }

  function creditTargetPayload() {
    return creditRows.map(row => {
      const rawTarget = String(creditTargets[row.itemIndex] ?? '').trim()
      return { itemIndex: row.itemIndex, targetMt: rawTarget ? Number(rawTarget) : null }
    })
  }

  function validateCreditTargets(targets, { requireComplete = false } = {}) {
    for (const target of targets) {
      if (target.targetMt === null) {
        if (requireComplete) return 'Enter a Target in MT for every EPR Credit item before sending.'
        continue
      }
      if (!Number.isFinite(target.targetMt) || target.targetMt < 0 || target.targetMt > 1e12) {
        return 'Targets must be non-negative numbers.'
      }
    }
    return ''
  }

  async function saveCreditCalculation({ requireComplete = false } = {}) {
    if (!hasCreditRows) return true
    const targets = creditTargetPayload()
    const validationError = validateCreditTargets(targets, { requireComplete })
    if (validationError) {
      setCalculationError(validationError)
      setActiveTab('credit')
      return false
    }
    setSavingCalculation(true)
    setCalculationError('')
    try {
      await api.patch(`/quotations/${quotation._id}/credit-calculations`, { targets })
      setCalculationSaved(true)
      return true
    } catch (err) {
      setCalculationError(readApiError(err, 'Unable to save EPR Credit calculations. Please retry.'))
      return false
    } finally {
      setSavingCalculation(false)
    }
  }

  async function send(event) {
    event.preventDefault()
    if (busy || sent) return
    setBusy(true); setError('')
    try {
      const targetsSaved = await saveCreditCalculation({ requireComplete: true })
      if (!targetsSaved) return
      const formData = new FormData()
      formData.append('email', email)
      formData.append('cc', cc)
      formData.append('subject', subject)
      formData.append('body', body)
      imageAttachments.forEach(file => formData.append('attachments', file))
      await api.post(`/quotations/${quotation._id}/email`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      setSent(true)
    } catch (err) {
      setError(err?.response?.status === 413
        ? 'The upload gateway rejected this request. Keep each attachment under 5 MB and all attachments under 15 MB; if a small file still fails, ask an administrator to check the upload limit.'
        : readApiError(err, 'Unable to email this quotation. Please retry.'))
    }
    finally { setBusy(false) }
  }
  return <dialog ref={ref} aria-labelledby="quotation-email-title" onCancel={event => { event.preventDefault(); if (!busy) onClose() }} className="m-auto max-h-[90vh] w-[min(580px,calc(100vw-32px))] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl backdrop:bg-slate-950/60">
    <h2 id="quotation-email-title" className="text-xl font-black">Email quotation to client</h2>
    {sent ? <div className="mt-5 space-y-5"><p role="status">Quotation email accepted for delivery to <strong>{email}</strong>, with the approved PDF{imageAttachments.length ? ' and selected files' : ''} attached.</p><button type="button" onClick={onClose} className="rounded-lg bg-emerald-700 px-5 py-3 font-bold text-white">Done</button></div> : <form onSubmit={send} className="mt-4 space-y-4">
      <p className="text-sm text-slate-500">The approved quotation PDF and AnantTattva email signature will be included automatically.</p>
      {hasCreditRows && <div role="tablist" aria-label="Quotation email sections" className="flex gap-2 rounded-[20px] bg-slate-100 p-1.5">
        <button type="button" role="tab" aria-selected={activeTab === 'email'} onClick={() => setActiveTab('email')} className={`flex-1 rounded-[14px] px-4 py-2.5 text-sm font-black transition ${activeTab === 'email' ? 'bg-gradient-to-r from-[#1a928b] to-[#0b7771] text-white shadow' : 'text-slate-600 hover:bg-white'}`}>Email</button>
        <button type="button" role="tab" aria-selected={activeTab === 'credit'} onClick={() => setActiveTab('credit')} className={`flex-1 rounded-[14px] px-4 py-2.5 text-sm font-black transition ${activeTab === 'credit' ? 'bg-gradient-to-r from-[#1a928b] to-[#0b7771] text-white shadow' : 'text-slate-600 hover:bg-white'}`}>Credit Calculation</button>
      </div>}
      {activeTab === 'email' && <>
        <label className="block text-sm font-bold">Client email<input autoFocus type="text" inputMode="email" required maxLength={3000} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} placeholder="client@company.com; accounts@company.com" className="mt-2 block w-full rounded-lg border border-slate-300 p-3" /><span className="mt-1 block text-xs font-normal text-slate-500">Separate multiple client addresses with commas, semicolons, spaces, or new lines. A copy with the quotation PDF is automatically sent to your registered email. CTO/CTE quotations also copy Kshitij Trimukhe; Solid Waste Management quotations copy Kshitij Trimukhe and Suraj Shetty.</span></label>
        <label className="block text-sm font-bold">CC <span className="font-normal text-slate-500">(optional)</span><input type="text" inputMode="email" maxLength={3000} value={cc} onChange={event => setCc(event.target.value)} disabled={busy} placeholder="name@company.com, colleague@company.com" className="mt-2 block w-full rounded-lg border border-slate-300 p-3" /><span className="mt-1 block text-xs font-normal text-slate-500">Separate addresses with commas or semicolons. Up to 10 recipients.</span></label>
        <label className="block text-sm font-bold">Subject<input required maxLength={200} value={subject} onChange={event => setSubject(event.target.value)} disabled={busy} className="mt-2 block w-full rounded-lg border border-slate-300 p-3" /></label>
        <label className="block text-sm font-bold">Message<textarea required maxLength={10000} rows={6} value={body} onChange={event => setBody(event.target.value)} disabled={busy} className="mt-2 block w-full rounded-lg border border-slate-300 p-3" /></label>
        <section aria-label="Optional attachments" className="space-y-2 rounded-xl border border-slate-200 p-3">
          <label htmlFor="quotation-email-attachments" className="block text-sm font-bold">Attach files <span className="font-normal text-slate-500">(optional, multiple)</span></label>
          <input id="quotation-email-attachments" type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp,application/pdf" onChange={addAttachments} disabled={busy} className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-teal-50 file:px-3 file:py-2 file:font-bold file:text-teal-800" />
          <p className="text-xs text-slate-500">Attach up to 5 JPEG, PNG, GIF, WebP, or PDF files (5 MB each; 15 MB total). Selected files will be sent with the quotation email.</p>
          {imageAttachments.length > 0 && <ul className="space-y-1">
            {imageAttachments.map((file, index) => <li key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs">
              <span className="min-w-0 truncate">{file.name} <span className="text-slate-500">({Math.max(1, Math.round(file.size / 1024))} KB)</span></span>
              <button type="button" disabled={busy} onClick={() => { setImageAttachments(current => current.filter((_, fileIndex) => fileIndex !== index)); setAttachmentError('') }} className="shrink-0 font-bold text-red-700">Remove</button>
            </li>)}
          </ul>}
          {attachmentError && <p role="alert" className="text-xs font-bold text-red-700">{attachmentError}</p>}
        </section>
        {hasCreditRows && <p className="text-xs font-bold text-teal-800">The saved EPR Credit calculation table will be added below your message in the email. The quotation PDF will remain unchanged.</p>}
      </>}
      {activeTab === 'credit' && <section role="tabpanel" aria-label="Credit Calculation" className="space-y-4">
        <div className="rounded-xl border border-teal-100 bg-teal-50 p-3 text-sm font-bold text-teal-900">Quoted rates are INR per kg. Basic Amount is converted to INR per MT (×1,000). Enter each Target in MT.</div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-black uppercase text-slate-600"><tr>{['Services Offered', 'Unit', 'Rate/kg', 'Basic Amount (INR)', 'Target (MT)', 'Total Amount (INR)'].map(heading => <th key={heading} className="border-b px-3 py-3">{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {creditRows.map(row => {
                const target = creditTargets[row.itemIndex] ?? ''
                const total = eprCreditTotalAmount(row.basicAmount, target)
                return <tr key={`${quotation._id}-${row.itemIndex}`}>
                  <td className="px-3 py-3 font-bold">{row.servicesOffered}</td>
                  <td className="px-3 py-3 font-black uppercase">{row.unit}</td>
                  <td className="px-3 py-3 font-black">{row.ratePerKg.toLocaleString('en-IN', { maximumFractionDigits: 3 })}</td>
                  <td className="px-3 py-3 font-black">₹{Number(row.basicAmount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<span className="block text-[10px] font-bold text-slate-500">per MT</span></td>
                  <td className="px-3 py-3"><input aria-label={`Target in MT for ${row.servicesOffered}`} type="number" min="0" max="1000000000000" step="any" value={target} disabled={busy || savingCalculation} onChange={event => { setCreditTargets(current => ({ ...current, [row.itemIndex]: event.target.value })); setCalculationSaved(false); setCalculationError('') }} className="h-10 w-32 rounded-lg border border-slate-300 px-3 font-bold outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-100" placeholder="Enter MT" /></td>
                  <td className="px-3 py-3 font-black text-teal-800">{total === null ? '-' : `₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
        {calculationSaved && <p role="status" className="text-sm font-bold text-emerald-700">EPR Credit targets saved to this quotation.</p>}
        {calculationError && <p role="alert" className="text-sm font-bold text-red-700">{calculationError}</p>}
      </section>}
      {error && <p role="alert" className="text-sm font-bold text-red-700">{error}</p>}
      {activeTab === 'email' ? <div className="flex justify-end gap-3"><button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-slate-300 px-5 py-3 font-bold">Cancel</button><button type="submit" disabled={busy || savingCalculation} className="rounded-lg bg-emerald-700 px-5 py-3 font-bold text-white disabled:opacity-60">{busy ? 'Sending…' : 'Send quotation'}</button></div> : <div className="flex justify-end gap-3"><button type="button" onClick={onClose} disabled={savingCalculation} className="rounded-lg border border-slate-300 px-5 py-3 font-bold">Cancel</button><button type="button" onClick={() => saveCreditCalculation()} disabled={savingCalculation || busy} className="rounded-lg border border-teal-700 px-5 py-3 font-bold text-teal-800 disabled:opacity-60">{savingCalculation ? 'Saving…' : 'Save calculation'}</button><button type="button" onClick={async () => { const saved = await saveCreditCalculation(); if (saved) setActiveTab('email') }} disabled={savingCalculation || busy} className="rounded-lg bg-emerald-700 px-5 py-3 font-bold text-white disabled:opacity-60">Continue to email</button></div>}
    </form>}
  </dialog>
}
