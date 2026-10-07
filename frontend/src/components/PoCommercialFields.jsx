import React from 'react'
import { PO_FINANCIAL_YEARS, poYearField } from '../utils/poCommercialDetails.mjs'

export default function PoCommercialFields({ po = {}, index, onChange }) {
  const field = poYearField(po)
  const label = field === 'registrationYear' ? 'Registration Year' : 'Annual Return Year'
  return <>
    <td className="p-3"><input required type="date" aria-label={`PO End Date row ${index + 1}`} min={po.poDate || undefined} className="form-input min-w-40" value={po.poEndDate || ''} onChange={(event) => onChange({ poEndDate: event.target.value })} /></td>
    <td className="p-3"><select required aria-label={`PO Financial Year row ${index + 1}`} className="form-input min-w-40" value={po.poFinancialYear || ''} onChange={(event) => onChange({ poFinancialYear: event.target.value })}><option value="">Select PO Financial Year</option>{PO_FINANCIAL_YEARS.map((year) => <option key={year} value={year}>{year}</option>)}</select></td>
    <td className="p-3"><select aria-label={`${label} row ${index + 1}`} className="form-input min-w-40" value={po[field] || ''} onChange={(event) => onChange({ [field]: event.target.value })}><option value="">Not applicable / Select year</option>{PO_FINANCIAL_YEARS.map((year) => <option key={year} value={year}>{year}</option>)}</select></td>
    <td className="p-3"><input required aria-label={`Payment Term row ${index + 1}`} maxLength={1000} className="form-input min-w-56" value={po.paymentTerm || ''} onChange={(event) => onChange({ paymentTerm: event.target.value })} placeholder="e.g. 30 days from invoice date" /></td>
  </>
}
