import React from 'react';
import { Eye } from 'lucide-react';
import creditPricing from '../../../../shared/eprCreditPricing.cjs';

export function CreditRequestButton({ quotation, onRequest }) {
  if (!quotation.items?.some(creditPricing.isCredit)) return null;
  return <button type="button" onClick={() => onRequest(quotation)} className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700 transition hover:-translate-y-0.5 hover:bg-violet-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500">Request for Credit Change</button>;
}

export default function CompanyQuotationHistory({ quotations, onView, onEdit, onRequestCredit, renderApproval, canRevise, formatDate, formatAmount }) {
  return <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[1200px] text-left text-xs"><thead className="bg-slate-100 uppercase text-slate-500"><tr>{['Quotation No.', 'Date', 'Valid Until', 'Items', 'Amount', 'Lead Status', 'Quotation Status', 'Actions'].map(heading => <th key={heading} scope="col" className="p-3">{heading}</th>)}</tr></thead><tbody>{quotations.map((row, index) => <tr key={row._id || row.id} className={`border-t ${index === 0 ? 'bg-emerald-50/60' : ''}`}>
    <td className="p-3 font-black text-orange-600"><span className="inline-flex items-center gap-2">{row.quotationNumber || '-'}{index === 0 && <em className="rounded-full bg-emerald-600 px-2 py-1 text-[9px] font-black uppercase not-italic tracking-wide text-white">Latest</em>}</span></td>
    <td className="p-3 font-bold">{formatDate(row.quotationDate || row.createdAt)}</td><td className="p-3 font-bold">{formatDate(row.validUntil)}</td><td className="p-3 font-black">{row.items?.length || 0}</td><td className="p-3 font-black text-orange-600">{formatAmount(Number(row.grandTotal) || 0)}</td>
    <td className="p-3"><span className={`font-black uppercase ${String(row.serviceState || 'open').toLowerCase() === 'closed' ? 'text-red-600' : 'text-emerald-700'}`}>{row.serviceState || 'open'}</span></td><td className="p-3 font-black uppercase">{row.status || 'draft'}</td>
    <td className="p-3"><div className="flex min-w-[340px] flex-wrap items-center gap-2"><button type="button" onClick={() => onView(row)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-white px-3 py-2 font-black text-emerald-700"><Eye className="h-3.5 w-3.5"/> View</button><CreditRequestButton quotation={row} onRequest={onRequestCredit}/>{renderApproval(row)}{canRevise(row) && <button type="button" onClick={() => onEdit(row)} className="rounded-lg border px-3 py-2 font-black text-orange-600">Edit</button>}</div></td>
  </tr>)}</tbody></table></div>;
}
