import React from 'react';
import closureRules from '../../../shared/leadPoClosure.cjs';
export default function LeadClosureStatus({ lead }) {
  const { closedCount, openCount } = closureRules.serviceClosureSummary(lead);
  return <div className="flex min-w-40 flex-wrap gap-2" aria-label={`${closedCount} Closed, ${openCount} Still Not Closed`}>
    {closedCount > 0 && <span className="whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">{closedCount} Closed</span>}
    {openCount > 0 && <span className="whitespace-nowrap rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold text-red-700">{openCount} Still Not Closed</span>}
  </div>;
}
