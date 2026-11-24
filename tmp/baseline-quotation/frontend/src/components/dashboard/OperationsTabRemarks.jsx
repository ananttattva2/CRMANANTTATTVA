import React from 'react';
import { getOperationsTabRemarks } from '../../utils/operationsUserProgress.mjs';
import './operationsTabRemarks.css';
export default function OperationsTabRemarks({ rows = [], aggregate = false }) {
  const entries = rows.map(row => ({ row, tabs: getOperationsTabRemarks(row).filter(tab => tab.remarks) })).filter(entry => entry.tabs.length);
  if (!entries.length) return <span className="operations-remarks-empty">No tab remarks added</span>;
  if (aggregate) return <span className="operations-remarks-empty">{entries.reduce((count, entry) => count + entry.tabs.length, 0)} tab remarks · {entries.length} clients</span>;
  return <div className="operations-tab-remarks" tabIndex="0" aria-label="Compliance tab remarks">{entries.map(({row,tabs}) => <section key={row.id}>
    {rows.length > 1 && <header>{row.companyName}<small>{row.atplCode}</small></header>}
    {tabs.map(tab => <article key={tab.key}><div><strong>{tab.label}</strong><span className={tab.status === 'CHANGES_REQUIRED' ? 'needs-changes' : ''}>{tab.status.replace(/_/g, ' ')}</span></div><p>{tab.remarks}</p>{tab.reviewedBy && <small>By {tab.reviewedBy}</small>}</article>)}
  </section>)}</div>;
}
