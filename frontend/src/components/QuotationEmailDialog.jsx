import React, { useEffect, useRef, useState } from 'react'
import api, { readApiError } from '../services/api'
import { eprCreditTotalAmount, quotationEprCreditCalculationRows } from '../utils/eprCreditCalculation.mjs'

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
    creditRows.map(row => [row.itemIndex, row.targetKg === '' ? '' : String(row.targetKg)])
  ))
  const [busy, setBusy] = useState(false)
  const [savingCalculation, setSavingCalculation] = useState(false)
  const [error, setError] = useState('')
  const [calculationError, setCalculationError] = useState('')
  const [calculationSaved, setCalculationSaved] = useState(false)
  const [sent, setSent] = useState(false)
  useEffect(() => { ref.current.showModal() }, [])

  function creditTargetPayload() {
    return creditRows.map(row => {
      const rawTarget = String(creditTargets[row.itemIndex] ?? '').trim()
      return { itemIndex: row.itemIndex, targetKg: rawTarget ? Number(rawTarget) : null }
    })
  }

  function validateCreditTargets(targets, { requireComplete = false } = {}) {
    for (const target of targets) {
      if (target.targetKg === null) {
        if (requireComplete) return 'Enter a Target in kg for every EPR Credit item before sending.'
        continue
      }
      if (!Number.isFinite(target.targetKg) || target.targetKg < 0 || target.targetKg > 1e12) {
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
      await api.post(`/quotations/${quotation._id}/email`, { email, cc, subject, body })
      setSent(true)
    } catch (err) { setError(readApiError(err, 'Unable to email this quotation. Please retry.')) }
    finally { setBusy(false) }
  }
  return <dialog ref={ref} aria-labelledby="quotation-email-title" onCancel={event => { event.preventDefault(); if (!busy) onClose() }} className="m-auto max-h-[90vh] w-[min(580px,calc(100vw-32px))] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl backdrop:bg-slate-950/60">
    <h2 id="quotation-email-title" className="text-xl font-black">Email quotation to client</h2>
    {sent ? <div className="mt-5 space-y-5"><p role="status">Quotation email accepted for delivery to <strong>{email}</strong>, with the approved PDF attached.</p><button type="button" onClick={onClose} className="rounded-lg bg-emerald-700 px-5 py-3 font-bold text-white">Done</button></div> : <form onSubmit={send} className="mt-4 space-y-4">
      <p className="text-sm text-slate-500">The approved quotation PDF and AnantTattva email signature will be included automatically.</p>
      {hasCreditRows && <div role="tablist" aria-label="Quotation email sections" className="flex gap-2 rounded-[20px] bg-slate-100 p-1.5">
        <button type="button" role="tab" aria-selected={activeTab === 'email'} onClick={() => setActiveTab('email')} className={`flex-1 rounded-[14px] px-4 py-2.5 text-sm font-black transition ${activeTab === 'email' ? 'bg-gradient-to-r from-[#1a928b] to-[#0b7771] text-white shadow' : 'text-slate-600 hover:bg-white'}`}>Email</button>
        <button type="button" role="tab" aria-selected={activeTab === 'credit'} onClick={() => setActiveTab('credit')} className={`flex-1 rounded-[14px] px-4 py-2.5 text-sm font-black transition ${activeTab === 'credit' ? 'bg-gradient-to-r from-[#1a928b] to-[#0b7771] text-white shadow' : 'text-slate-600 hover:bg-white'}`}>Credit Calculation</button>
      </div>}
      {activeTab === 'email' && <>
        <label className="block text-sm font-bold">Client email<input autoFocus type="text" inputMode="email" required maxLength={3000} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} placeholder="client@company.com; accounts@company.com" className="mt-2 block w-full rounded-lg border border-slate-300 p-3" /><span className="mt-1 block text-xs font-normal text-slate-500">Separate multiple client addresses with commas, semicolons, spaces, or new lines. A copy with the quotation PDF is automatically sent to your registered email.</span></label>
        <label className="block text-sm font-bold">CC <span className="font-normal text-slate-500">(optional)</span><input type="text" inputMode="email" maxLength={3000} value={cc} onChange={event => setCc(event.target.value)} disabled={busy} placeholder="name@company.com, colleague@company.com" className="mt-2 block w-full rounded-lg border border-slate-300 p-3" /><span className="mt-1 block text-xs font-normal text-slate-500">Separate addresses with commas or semicolons. Up to 10 recipients.</span></label>
        <label className="block text-sm font-bold">Subject<input required maxLength={200} value={subject} onChange={event => setSubject(event.target.value)} disabled={busy} className="mt-2 block w-full rounded-lg border border-slate-300 p-3" /></label>
        <label className="block text-sm font-bold">Message<textarea required maxLength={10000} rows={6} value={body} onChange={event => setBody(event.target.value)} disabled={busy} className="mt-2 block w-full rounded-lg border border-slate-300 p-3" /></label>
        {hasCreditRows && <p className="text-xs font-bold text-teal-800">The saved EPR Credit calculation table will be added below your message in the email. The quotation PDF will remain unchanged.</p>}
      </>}
      {activeTab === 'credit' && <section role="tabpanel" aria-label="Credit Calculation" className="space-y-4">
        <div className="rounded-xl border border-teal-100 bg-teal-50 p-3 text-sm font-bold text-teal-900">Quoted rates are treated as INR per gram and converted to INR per kg (×1,000). Enter each Target in kg.</div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-black uppercase text-slate-600"><tr>{['Services Offered', 'Unit', 'Basic Amount (INR)', 'Target (kg)', 'Total Amount (INR)'].map(heading => <th key={heading} className="border-b px-3 py-3">{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {creditRows.map(row => {
                const target = creditTargets[row.itemIndex] ?? ''
                const total = eprCreditTotalAmount(row.basicAmount, target)
                return <tr key={`${quotation._id}-${row.itemIndex}`}>
                  <td className="px-3 py-3 font-bold">{row.servicesOffered}</td>
                  <td className="px-3 py-3 font-black uppercase">{row.unit}</td>
                  <td className="px-3 py-3 font-black">₹{Number(row.basicAmount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<span className="block text-[10px] font-bold text-slate-500">converted per kg</span></td>
                  <td className="px-3 py-3"><input aria-label={`Target in kg for ${row.servicesOffered}`} type="number" min="0" max="1000000000000" step="any" value={target} disabled={busy || savingCalculation} onChange={event => { setCreditTargets(current => ({ ...current, [row.itemIndex]: event.target.value })); setCalculationSaved(false); setCalculationError('') }} className="h-10 w-32 rounded-lg border border-slate-300 px-3 font-bold outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-100" placeholder="Enter kg" /></td>
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
