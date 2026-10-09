import React, { useState } from 'react';
import { Check, ChevronDown, Clock3, Eye, FileText, Info, List, Upload, X } from 'lucide-react';
import PurchaseProofDropzone from './PurchaseProofDropzone';
import './uploadTracker.css';

const HIDDEN = new Set(['Partially Data received', 'Complete Data Received', 'Work In Process', 'Partially Complete']);
const DATA_STAGES = new Set(['Received from client', 'Ready to upload']);
const REQUIRED_NORMAL_ROWS = new Set(['Received from client', 'Ready to upload', 'Client Approval on data', 'Upload Complete']);
const SIMPLE = new Set(['Nil Upload', 'Client Approval on data']);
const isComplete = (row) => SIMPLE.has(row.particular) ? ['Yes', 'No'].includes(row.yesNo) : row.yesNo === 'Yes' && Boolean(row.date && row.files?.length);

export default function SalesUploadChecklist({ title = 'Sales Data Upload Checklist', checklist = [], canEdit, busy, onChange, onUploadProof, onRemoveProof, onPreview, onError }) {
  const [expanded, setExpanded] = useState(null);
  const nilUpload = checklist.find((row) => row.particular === 'Nil Upload')?.yesNo === 'Yes';
  const rows = checklist.map((row, index) => ({ row, index })).filter(({ row }) => !HIDDEN.has(row.particular));
  const completed = rows.filter(({ row }) => isComplete(row)).length;
  const editable = canEdit && !busy;
  const toggle = (name) => setExpanded((current) => current === name ? null : name);
  return <section className="upload-tracker" aria-label={title}>
    <header className="ut-heading">
      <div className="ut-heading-copy"><span className="ut-logo"><FileText size={28} /></span><div><h2>Client Data Upload Tracker</h2><p>{title.replace(' Upload Checklist', '')} · Track status, supporting documents and completion.</p></div></div>
      <div className="ut-counters" aria-label="Tracker summary">{[[Clock3, rows.length - completed, 'Pending', 'pending'], [Check, completed, 'Completed', 'complete'], [List, rows.length, 'Total', 'total']].map(([Icon, count, label, tone]) => <div className={`ut-counter ut-counter-${tone}`} key={label}><span><Icon size={20} /></span><div><strong>{count}</strong><small>{label}</small></div></div>)}</div>
    </header>
    <div className="ut-table-scroll"><table className="ut-table"><caption className="sr-only">{title}</caption><colgroup><col style={{ width: '5%' }} /><col style={{ width: '19%' }} /><col style={{ width: '10%' }} /><col style={{ width: '16%' }} /><col style={{ width: '15%' }} /><col style={{ width: '26%' }} /><col style={{ width: '9%' }} /></colgroup>
      <thead><tr>{['Sr. No.', 'Particular', 'Status', 'Upload Proof', 'Upload Date', 'Data Status', 'Actions'].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{rows.map(({ row, index }, position) => {
        const required = row.particular === 'Client Approval on data' || (!nilUpload && REQUIRED_NORMAL_ROWS.has(row.particular));
        const simple = SIMPLE.has(row.particular);
        const enabled = row.yesNo === 'Yes';
        const open = expanded === row.particular;
        const complete = isComplete(row);
        const detailsId = `tracker-${title.startsWith('Purchase') ? 'purchase' : 'sales'}-${index}`;
        return <React.Fragment key={row.particular}>
          <tr className={open ? 'ut-row-open' : ''}>
            <td className="ut-number">{position + 1}</td>
            <th scope="row"><strong>{row.particular}</strong>{required && <small className="block text-rose-600">Required</small>}</th>
            <td><select aria-label={`${row.particular} status`} disabled={!editable} value={row.yesNo || ''} onChange={(event) => onChange(index, { yesNo: event.target.value }, true)} className={`ut-select ${enabled ? 'ut-select-yes' : row.yesNo === 'No' ? 'ut-select-no' : ''}`}><option value="">Select</option><option>Yes</option><option>No</option></select></td>
            <td>{simple ? <span className="ut-na">—</span> : <button type="button" className={`ut-proof ${row.files?.length ? 'ut-proof-done' : 'ut-proof-pending'}`} disabled={!enabled && !row.files?.length} onClick={() => setExpanded(row.particular)} aria-label={`Manage ${row.particular} proof`}><span>{row.files?.length ? 'Uploaded' : 'Pending'}</span><small><Upload size={13} />{row.files?.length || 0} file{row.files?.length === 1 ? '' : 's'} uploaded</small></button>}</td>
            <td>{simple ? <span className="ut-na">—</span> : <input aria-label={`${row.particular} date`} disabled={!editable || !enabled} type="date" value={row.date || ''} onChange={(event) => onChange(index, { date: event.target.value })} className="ut-date" />}</td>
            <td>{DATA_STAGES.has(row.particular) ? <fieldset disabled={!editable || !enabled} className={`ut-data-status ${row.completeDataReceived ? 'ut-data-complete' : ''}`}><label><input type="checkbox" checked={Boolean(row.partialDataReceived)} onChange={(event) => onChange(index, { partialDataReceived: event.target.checked }, true)} />Partially Data received</label><label><input type="checkbox" checked={Boolean(row.completeDataReceived)} onChange={(event) => onChange(index, { completeDataReceived: event.target.checked }, true)} />Complete Data Received</label></fieldset> : <span className={`ut-applicability ${row.particular === 'Upload Complete' && complete ? 'ut-applicability-done' : ''}`}><Info size={16} />{row.particular === 'Upload Complete' ? complete ? 'Upload completed' : 'Awaiting completion' : 'Not applicable'}</span>}</td>
            <td>{simple ? <span className="ut-na">—</span> : <button type="button" className="ut-view" aria-expanded={open} aria-controls={detailsId} aria-label={`${open ? 'Hide' : 'View'} ${row.particular} details`} onClick={() => toggle(row.particular)}><Eye size={16} />{open ? 'Hide' : 'View'}<ChevronDown size={12} className={open ? 'ut-rotate' : ''} /></button>}</td>
          </tr>
          {open && !simple && <tr className="ut-detail-row"><td colSpan="7"><div className="ut-details" id={detailsId}>
            <div><div className="ut-detail-title"><strong>Supporting documents</strong><button type="button" onClick={() => setExpanded(null)} aria-label="Close row details"><X size={16} /></button></div><PurchaseProofDropzone files={row.files || []} required={enabled} disabled={!editable || !enabled} busy={busy === `proof-${index}`} onUpload={(files) => onUploadProof(index, files)} onRemove={(fileIndex, file) => onRemoveProof(index, fileIndex, file)} onPreview={onPreview} onError={onError} /></div>
            <label className="ut-remarks">Remarks<textarea disabled={!editable || !enabled} rows="3" maxLength="2000" value={row.remarks || ''} onChange={(event) => onChange(index, { remarks: event.target.value })} placeholder="Add a note for this stage…" />{enabled && (!row.date || !row.files?.length) && <small>Date and supporting proof are required.</small>}</label>
          </div></td></tr>}
        </React.Fragment>;
      })}</tbody>
    </table></div>
    <footer className="ut-footer"><div><Info size={18} /><p><strong>Upload Proof:</strong> Supporting documents for each stage. Select View to upload files or add remarks.<br /><span>Data checkboxes unlock when the stage status is Yes.</span></p></div><span className="ut-row-count">{rows.length ? `1–${rows.length} of ${rows.length}` : '0 rows'}</span></footer>
  </section>;
}
