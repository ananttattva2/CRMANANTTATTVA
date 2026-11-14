import React, { useState } from 'react';
import { Check, ChevronDown, Clock3, Eye, FileText, Info, List, Plus, Upload, X } from 'lucide-react';
import PurchaseProofDropzone from './PurchaseProofDropzone';
import './uploadTracker.css';

const HIDDEN = new Set(['Partially Data received', 'Complete Data Received', 'Work In Process', 'Partially Complete']);
const DATA_STAGES = new Set(['Received from client', 'Ready to upload']);
const REQUIRED_NORMAL_ROWS = new Set(['Received from client', 'Ready to upload', 'Client Approval on data', 'Upload Complete']);
const SIMPLE = new Set(['Nil Upload']);
const isComplete = (row) => SIMPLE.has(row.particular) ? ['Yes', 'No'].includes(row.yesNo) : row.yesNo === 'Yes' && Boolean(row.date && row.files?.length);

export default function SalesUploadChecklist({ title = 'Sales Data Upload Checklist', checklist = [], canEdit, busy, onChange, onUploadProof, onRemoveProof, onPreview, onError }) {
  const [expanded, setExpanded] = useState(null);
  const [validation, setValidation] = useState('');
  const confirmReceipt = (index, row, stage, checked) => {
    if (checked && !(row.files || []).some(file => file.receiptStage === stage)) {
      const message = `Please upload a supporting document before selecting ${stage === 'partial' ? 'Partially Data received' : 'Complete Data Received'}.`;
      setValidation(message); onError?.(message); setExpanded(row.particular); return;
    }
    setValidation(''); onChange(index, { [`${stage}DataReceived`]: checked }, true);
  };
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
    {validation && <div role="alert" className="ut-toast">{validation}<button type="button" aria-label="Dismiss notification" onClick={() => setValidation('')}>×</button></div>}
    <div className="ut-table-scroll"><table className="ut-table"><caption className="sr-only">{title}</caption><colgroup><col style={{ width: '5%' }} /><col style={{ width: '19%' }} /><col style={{ width: '10%' }} /><col style={{ width: '16%' }} /><col style={{ width: '26%' }} /><col style={{ width: '15%' }} /><col style={{ width: '9%' }} /></colgroup>
      <thead><tr>{['Sr. No.', 'Particular', 'Status', 'Upload Proof', 'Data Status', 'Upload Date', 'Actions'].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{rows.map(({ row, index }, position) => {
        const required = row.particular === 'Client Approval on data' || (!nilUpload && REQUIRED_NORMAL_ROWS.has(row.particular));
        const simple = SIMPLE.has(row.particular);
        const enabled = row.yesNo === 'Yes';
        const open = expanded === row.particular;
        const complete = isComplete(row);
        const detailsId = `tracker-${title.startsWith('Purchase') ? 'purchase' : 'sales'}-${index}`;
        return <React.Fragment key={row.particular}>
          <tr className={open ? 'ut-row-open' : ''}>
            <td className="ut-number"><span>{position + 1}</span>{DATA_STAGES.has(row.particular) && <button type="button" className={`ut-expand ${open ? 'ut-expand-open' : ''}`} aria-expanded={open} aria-controls={detailsId} aria-label={`${open ? 'Collapse' : 'Expand'} ${row.particular} receipt tracking`} onClick={() => toggle(row.particular)}><Plus size={14} /></button>}</td>
            <th scope="row"><strong>{row.particular}</strong>{required && <small className="block text-rose-600">Required</small>}</th>
            <td><select aria-label={`${row.particular} status`} disabled={!editable} value={row.yesNo || ''} onChange={(event) => onChange(index, { yesNo: event.target.value }, true)} className={`ut-select ${enabled ? 'ut-select-yes' : row.yesNo === 'No' ? 'ut-select-no' : ''}`}><option value="">Select</option><option>Yes</option><option>No</option></select></td>
            <td>{simple ? <span className="ut-na">—</span> : <button type="button" className={`ut-proof ${row.files?.length ? 'ut-proof-done' : 'ut-proof-pending'}`} disabled={!enabled && !row.files?.length} onClick={() => setExpanded(row.particular)} aria-label={`Manage ${row.particular} proof`}><span>{row.files?.length ? 'Uploaded' : 'Pending'}</span><small><Upload size={13} />{row.files?.length || 0} file{row.files?.length === 1 ? '' : 's'} uploaded</small></button>}</td>

            <td>{DATA_STAGES.has(row.particular) ? <fieldset disabled={!editable || !enabled} className={`ut-data-status ${row.completeDataReceived ? 'ut-data-complete' : ''}`}><label><input type="checkbox" checked={Boolean(row.partialDataReceived)} onChange={(event) => confirmReceipt(index, row, 'partial', event.target.checked)} />Partially Data received</label><label><input type="checkbox" checked={Boolean(row.completeDataReceived)} onChange={(event) => confirmReceipt(index, row, 'complete', event.target.checked)} />Complete Data Received</label></fieldset> : <span className={`ut-applicability ${row.particular === 'Upload Complete' && complete ? 'ut-applicability-done' : ''}`}><Info size={16} />{row.particular === 'Upload Complete' ? complete ? 'Upload completed' : 'Awaiting completion' : 'Not applicable'}</span>}</td>
            <td>{simple ? <span className="ut-na">—</span> : <input aria-label={`${row.particular} date`} disabled={!editable || !enabled || DATA_STAGES.has(row.particular)} title={DATA_STAGES.has(row.particular) ? 'Recorded automatically when a data receipt checkbox is selected' : undefined} type="date" value={row.date || ''} onChange={(event) => onChange(index, { date: event.target.value })} className="ut-date" />}</td>
            <td>{simple ? <span className="ut-na">—</span> : <button type="button" className="ut-view" aria-expanded={open} aria-controls={detailsId} aria-label={`${open ? 'Hide' : 'View'} ${row.particular} details`} onClick={() => toggle(row.particular)}><Eye size={16} />{open ? 'Hide' : 'View'}<ChevronDown size={12} className={open ? 'ut-rotate' : ''} /></button>}</td>
          </tr>
          {!simple && <tr className={`ut-detail-row ${open ? 'ut-detail-open' : ''}`}><td colSpan="7"><div className="ut-collapse" aria-hidden={!open} inert={!open ? '' : undefined}><div className="ut-collapse-inner"><div className="ut-details" id={detailsId} style={DATA_STAGES.has(row.particular) ? { gridTemplateColumns: '1fr' } : undefined}>
            {!DATA_STAGES.has(row.particular) && <div><div className="ut-detail-title"><strong>Supporting documents</strong><button type="button" onClick={() => setExpanded(null)} aria-label="Close row details"><X size={16} /></button></div><PurchaseProofDropzone files={row.files || []} required={enabled} disabled={!editable || !enabled} busy={busy === `proof-${index}`} onUpload={(files) => onUploadProof(index, files)} onRemove={(fileIndex, file) => onRemoveProof(index, fileIndex, file)} onPreview={onPreview} onError={onError} /></div>}
            <label className="ut-remarks">Remarks<textarea disabled={!editable || !enabled} rows="3" maxLength="2000" value={row.remarks || ''} onChange={(event) => onChange(index, { remarks: event.target.value })} placeholder="Add a note for this stage…" />{enabled && (!row.date || !row.files?.length) && <small>Date and supporting proof are required.</small>}</label>
          </div>{DATA_STAGES.has(row.particular) && <div className="ut-receipt-grid">{['partial', 'complete'].map(stage => {
            const stageFiles = (row.files || []).filter(file => file.receiptStage === stage);
            const at = row[`${stage}ReceivedAt`];
            return <section className="ut-receipt-card" key={stage} aria-label={`${row.particular} ${stage} receipt evidence`}><h3>{stage === 'partial' ? 'Partially Data received' : 'Complete Data Received'}</h3><p className="ut-receipt-date"><Clock3 size={14} />{at ? new Date(at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' : 'Date recorded automatically when selected'}</p><PurchaseProofDropzone files={stageFiles} disabled={!editable || !enabled} busy={busy === `proof-${index}`} onUpload={files => onUploadProof(index, files, stage)} onRemove={(fileIndex, file) => onRemoveProof(index, row.files.indexOf(file), file)} onPreview={onPreview} onError={onError} /><small>Upload a document here, then select the matching checkbox above.</small></section>;
          })}{!!row.receiptHistory?.length && <section className="ut-receipt-history"><h3>Receipt activity</h3><ol>{row.receiptHistory.map((event, eventIndex) => <li key={`${event.at}-${eventIndex}`}><strong>{event.stage === 'partial' ? 'Partial' : 'Complete'} receipt {event.checked ? 'confirmed' : 'unchecked'}</strong><span>{new Date(event.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST · {event.userName || 'User'} · {event.files?.length || 0} document(s)</span></li>)}</ol></section>}</div>}</div></div></td></tr>}
        </React.Fragment>;
      })}</tbody>
    </table></div>
    <footer className="ut-footer"><div><Info size={18} /><p><strong>Upload Proof:</strong> Supporting documents for each stage. Select View to upload files or add remarks.<br /><span>Expand rows 3 and 4 to upload separate partial and complete receipt documents. Confirmation dates are recorded automatically.</span></p></div><span className="ut-row-count">{rows.length ? `1–${rows.length} of ${rows.length}` : '0 rows'}</span></footer>
  </section>;
}
