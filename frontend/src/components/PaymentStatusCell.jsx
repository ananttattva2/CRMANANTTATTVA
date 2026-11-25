import React from 'react'
import { CheckCircle2, Clock3 } from 'lucide-react'

export default function PaymentStatusCell({ payment, canUpdate, onUpdate, companyName }) {
  const complete = payment?.status === 'COMPLETE_RECEIVED'
  const Icon = complete ? CheckCircle2 : Clock3
  return <div className="min-w-[180px] space-y-2">
    {payment ? <div className={`rounded-xl border p-3 ${complete ? 'border-emerald-100 bg-emerald-50' : 'border-blue-100 bg-blue-50'}`}>
      <span className={`flex items-center gap-1.5 text-[11px] font-bold ${complete ? 'text-emerald-800' : 'text-blue-800'}`}><Icon size={14} />{complete ? 'Complete received' : 'Advance received'}</span>
      <strong className="mt-1 block text-base text-slate-900">{Number(payment.amount || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</strong>
      {payment.paymentDate && <small className="mt-1 block text-slate-600">Receipt date {payment.paymentDate}</small>}
      {payment.paymentMode && <small className="block text-slate-600">{payment.paymentMode}</small>}
      {payment.referenceNumber && <small className="block break-words text-slate-600">Cheque / UTR No. {payment.referenceNumber}</small>}
      {payment.bank && <small className="block text-slate-600">{payment.bank}</small>}
      {payment.name && <small className="mt-1 block text-slate-600">By {payment.name}</small>}
      {payment.at && <small className="block text-[10px] text-slate-500">{new Date(payment.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</small>}
      {payment.remarks && <p className="mt-2 whitespace-pre-wrap break-words border-t border-current/10 pt-2 text-xs text-slate-600">{payment.remarks}</p>}
    </div> : !canUpdate && <span className="text-xs text-slate-400">Not recorded</span>}
    {canUpdate && <select aria-label={`Update payment status for ${companyName}`} value="" onChange={event => { if (event.target.value) onUpdate(event.target.value) }} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm focus:border-emerald-500">
      <option value="">{payment ? 'Update payment…' : 'Record payment…'}</option><option value="ADVANCE_RECEIVED">Advance received</option><option value="COMPLETE_RECEIVED">Complete received</option>
    </select>}
  </div>
}
