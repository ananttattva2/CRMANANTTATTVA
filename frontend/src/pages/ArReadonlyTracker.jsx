import React, { useState } from 'react';
import { Check, Clock3, Eye, FileText, Info, List, Upload } from 'lucide-react';
import '../features/clientMaster/uploadTracker.css';
import ArProofLinks from './ArProofLinks';

export default function ArReadonlyTracker({ field, renderValue: Value }) {
  const [expanded, setExpanded] = useState(null);
  const rows = field.rows || [];
  const simple = row => ['Nil Upload', 'Client Approval on data'].includes(row.particular);
  const status = row => row.yesNo || row.status || '';
  const complete = row => simple(row) ? ['Yes', 'No'].includes(status(row)) : status(row) === 'Yes' && Boolean(row.date && row.files?.length);
  const completed = rows.filter(complete).length;
  return <section className="upload-tracker ar-readonly-tracker" aria-label={field.label}>
    <header className="ut-heading"><div className="ut-heading-copy"><span className="ut-logo"><FileText size={28} /></span><div><h2>Client Data Upload Tracker</h2><p>{field.label.replace(' Upload Tracker', ' Data')} · Saved client data and supporting documents.</p></div></div>
      <div className="ut-counters">{[[Clock3, rows.length - completed, 'Pending', 'pending'], [Check, completed, 'Completed', 'complete'], [List, rows.length, 'Total', 'total']].map(([Icon, count, label, tone]) => <div className={`ut-counter ut-counter-${tone}`} key={label}><span><Icon size={20} /></span><div><strong>{count}</strong><small>{label}</small></div></div>)}</div>
    </header>
    <div className="ut-table-scroll"><table className="ut-table"><caption className="sr-only">{field.label}</caption><colgroup>{['5%', '19%', '10%', '16%', '15%', '26%', '9%'].map(width => <col key={width} style={{ width }} />)}</colgroup><thead><tr>{['Sr. No.', 'Particular', 'Status', 'Upload Proof', 'Upload Date', 'Data Status', 'Actions'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <React.Fragment key={`${row.particular}:${index}`}><tr><td className="ut-number">{index + 1}</td><th scope="row"><strong>{row.particular}</strong></th><td><span className="ut-select ar-saved-status">{status(row) || 'Not provided'}</span></td>
        <td>{simple(row) ? '—' : <div className={`ut-proof ${row.files?.length ? 'ut-proof-done' : 'ut-proof-pending'}`}><span>{row.files?.length ? 'Uploaded' : 'Pending'}</span><small><Upload size={13} />{row.files?.length || 0} files uploaded</small></div>}</td>
        <td>{simple(row) ? '—' : <span className="ut-date ar-saved-date">{row.date ? String(row.date).slice(0, 10).split('-').reverse().join('-') : 'Not provided'}</span>}</td>
        <td>{['Received from client', 'Ready to upload'].includes(row.particular) ? <div className={`ut-data-status ${row.completeDataReceived ? 'ut-data-complete' : ''}`}><label><input type="checkbox" disabled checked={Boolean(row.partialDataReceived ?? row.partiallyDataReceived)} />Partially Data received</label><label><input type="checkbox" disabled checked={Boolean(row.completeDataReceived)} />Complete Data Received</label></div> : <span className={`ut-applicability ${row.particular === 'Upload Complete' && complete(row) ? 'ut-applicability-done' : ''}`}><Info size={16} />{row.particular === 'Upload Complete' ? complete(row) ? 'Upload completed' : 'Awaiting completion' : 'Not applicable'}</span>}</td>
        <td>{simple(row) ? '—' : <button type="button" className="ut-view" aria-expanded={expanded === index} aria-label={`View ${row.particular} documents and remarks`} onClick={() => setExpanded(current => current === index ? null : index)}><Eye size={16} />{expanded === index ? 'Hide' : 'View'}</button>}</td></tr>
        {expanded === index && <tr className="ut-detail-row"><td colSpan={7}><div className="ut-details"><div><strong>Supporting documents</strong><div className="grid gap-2 mt-2"><ArProofLinks files={row.files || []} /></div></div><div><strong>Remarks</strong><p className="mt-2"><Value value={row.remarks} /></p></div></div></td></tr>}
      </React.Fragment>)}</tbody></table></div>
    <footer className="ut-footer"><div><Info size={18} /><p>Read-only tracker. Select View to inspect supporting documents and remarks.</p></div><span className="ut-row-count">{rows.length} entries</span></footer>
  </section>;
}
