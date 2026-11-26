import React from 'react';
import { formatMetric } from './purchaseData.utils';

const statusLabels = {
  red: ['Sales exceed CTO/CCA quantity', 'bg-red-100 text-red-800'],
  green: ['Within 20% of Sales quantity', 'bg-emerald-100 text-emerald-800'],
  amber: ['20% to under 40% difference', 'bg-amber-100 text-amber-800'],
  neutral: ['Within CTO/CCA quantity', 'bg-slate-100 text-slate-700'],
  incomplete: ['CTO/CCA quantity incomplete', 'bg-slate-100 text-slate-700']
};

export default function SalesConsentComparison({ comparison }) {
  if (!comparison) return null;
  const { salesMt, consentMt, differenceMt, differencePercent, rows, status } = comparison;
  const [label, tone] = statusLabels[status];
  const formatMt = value => formatMetric(Math.abs(value));

  return <section aria-label="Sales vs CTO/CCA quantity" className="space-y-3 rounded-2xl border bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-black text-slate-900">Sales vs CTO/CCA Quantity</h3>
      <span className={`rounded-full px-3 py-1 text-xs font-bold ${tone}`}>{label}</span>
    </div>
    <dl className="grid gap-3 text-sm sm:grid-cols-3">
      <div><dt>Total Plastic Qty (Sales Portal)</dt><dd className="font-bold">{formatMt(salesMt)} MT</dd></div>
      <div><dt>{status === 'incomplete' ? 'CTO/CCA quantity calculated so far' : 'Total CTO/CCA quantity'}</dt><dd className="font-bold">{formatMt(consentMt)} MT/year</dd></div>
      {differenceMt != null && <div><dt>Difference</dt><dd className="font-bold">
        {formatMt(differenceMt)} MT{differenceMt !== 0 && (differenceMt > 0 ? ' above CTO/CCA' : ' below CTO/CCA')}
        {differencePercent != null && ` (${formatMetric(differencePercent)}% of Sales)`}
      </dd></div>}
    </dl>
    {rows.length > 0 && <div className="overflow-auto">
      <table className="w-full min-w-[480px] text-left text-sm">
        <thead><tr className="bg-slate-50"><th className="p-2">Plant</th><th className="p-2">Product</th><th className="p-2">CTO/CCA (MT/year)</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index} className="border-t">
          <td className="p-2">{row.plant || '—'}</td><td className="p-2">{row.product || '—'}</td>
          <td className="p-2">{row.annualMt === null ? 'Quantity incomplete' : formatMt(row.annualMt)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
