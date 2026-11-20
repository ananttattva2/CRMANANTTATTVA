import React from 'react';
import creditPricing from '../../../../shared/eprCreditPricing.cjs';
export function CreditTargetSelect({ item, onChange }) {
  const enabled = creditPricing.isCredit(item);
  const rates = creditPricing.tariffs[creditPricing.tariffKey(item)];
  return <select aria-label="Expected Target" disabled={!enabled} value={enabled ? (item.creditRateBand || 'below100') : ''} onChange={event => onChange(event.target.value)} className="h-11 min-w-64 rounded-xl border border-teal-200 bg-teal-50 px-3 text-xs font-bold text-teal-800 outline-none transition focus:ring-4 focus:ring-teal-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400">
    {!enabled && <option value="">Not applicable</option>}
    <option value="below100">Up to 100 MT · ₹{rates?.[0]?.toFixed(2) || '—'} / kg</option>
    <option value="above100">Above 100 MT · ₹{rates?.[1]?.toFixed(2) || '—'} / kg</option>
  </select>;
}
export default creditPricing;
