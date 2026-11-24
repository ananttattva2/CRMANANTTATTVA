from pathlib import Path
p=Path('frontend/src/features/clientMaster/SalesUploadChecklist.jsx');s=p.read_text(encoding='utf-8').replace('List, Upload, X','List, Plus, Upload, X')
s=s.replace("  const nilUpload", "  const [validation, setValidation] = useState('');\n  const confirmReceipt = (index, row, stage, checked) => {\n    if (checked && !(row.files || []).some(file => file.receiptStage === stage)) {\n      const message = `Please upload a supporting document before selecting ${stage === 'partial' ? 'Partially Data received' : 'Complete Data Received'}.`;\n      setValidation(message); onError?.(message); setExpanded(row.particular); return;\n    }\n    setValidation(''); onChange(index, { [`${stage}DataReceived`]: checked }, true);\n  };\n  const nilUpload")
s=s.replace('<div className="ut-table-scroll">', '{validation && <div role="alert" className="ut-toast">{validation}<button type="button" aria-label="Dismiss notification" onClick={() => setValidation(\'\')}>×</button></div>}\n    <div className="ut-table-scroll">')
s=s.replace("'Upload Proof', 'Upload Date', 'Data Status'", "'Upload Proof', 'Data Status', 'Upload Date'")
s=s.replace("width: '15%'", "width: '26%'").replace("width: '26%' }} /><col style={{ width: '9%'", "width: '15%' }} /><col style={{ width: '9%'")
s=s.replace('<td className="ut-number">{position + 1}</td>', '<td className="ut-number"><span>{position + 1}</span>{DATA_STAGES.has(row.particular) && <button type="button" className={`ut-expand ${open ? \'ut-expand-open\' : \'\'}`} aria-expanded={open} aria-controls={detailsId} aria-label={`${open ? \'Collapse\' : \'Expand\'} ${row.particular} receipt tracking`} onClick={() => toggle(row.particular)}><Plus size={14} /></button>}</td>')
start=s.index('            <td>{simple ? <span className="ut-na">—</span> : <input aria-label=');end=s.index('\n            <td>{DATA_STAGES',start);date=s[start:end];s=s[:start]+s[end:];end=s.index('\n            <td>{simple ?',start+1);s=s[:end]+'\n'+date+s[end:]
s=s.replace("onChange(index, { partialDataReceived: event.target.checked }, true)", "confirmReceipt(index, row, 'partial', event.target.checked)").replace("onChange(index, { completeDataReceived: event.target.checked }, true)", "confirmReceipt(index, row, 'complete', event.target.checked)")
s=s.replace('{open && !simple && <tr className="ut-detail-row"><td colSpan="7"><div className="ut-details" id={detailsId}>', '{!simple && <tr className={`ut-detail-row ${open ? \'ut-detail-open\' : \'\'}`}><td colSpan="7"><div className="ut-collapse" aria-hidden={!open} inert={!open ? \'\' : undefined}><div className="ut-collapse-inner"><div className="ut-details" id={detailsId}>')
s=s.replace('          </div></td></tr>}', '''          </div>{DATA_STAGES.has(row.particular) && <div className="ut-receipt-grid">{['partial', 'complete'].map(stage => {
            const stageFiles = (row.files || []).filter(file => file.receiptStage === stage);
            const at = row[`${stage}ReceivedAt`];
            return <section className="ut-receipt-card" key={stage} aria-label={`${row.particular} ${stage} receipt evidence`}><h3>{stage === 'partial' ? 'Partially Data received' : 'Complete Data Received'}</h3><p className="ut-receipt-date"><Clock3 size={14} />{at ? new Date(at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' : 'Date recorded automatically when selected'}</p><PurchaseProofDropzone files={stageFiles} disabled={!editable || !enabled} busy={busy === `proof-${index}`} onUpload={files => onUploadProof(index, files, stage)} onRemove={(fileIndex, file) => onRemoveProof(index, row.files.indexOf(file), file)} onPreview={onPreview} onError={onError} /><small>Upload a document here, then select the matching checkbox above.</small></section>;
          })}{!!row.receiptHistory?.length && <section className="ut-receipt-history"><h3>Receipt activity</h3><ol>{row.receiptHistory.map((event, eventIndex) => <li key={`${event.at}-${eventIndex}`}><strong>{event.stage === 'partial' ? 'Partial' : 'Complete'} receipt {event.checked ? 'confirmed' : 'unchecked'}</strong><span>{new Date(event.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST · {event.userName || 'User'} · {event.files?.length || 0} document(s)</span></li>)}</ol></section>}</div>}</div></div></td></tr>}''')
s=s.replace('Data checkboxes unlock when the stage status is Yes.', 'Expand rows 3 and 4 to upload separate partial and complete receipt documents. Confirmation dates are recorded automatically.')
p.write_text(s,encoding='utf-8')
p=Path('frontend/src/features/clientMaster/uploadTracker.css');s=p.read_text(encoding='utf-8');s+='''
/* Receipt tracking: mounted panels retain native upload state while animating. */
.upload-tracker .ut-detail-row > td { padding: 0; border: 0; }
.upload-tracker .ut-collapse { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows .25s ease, opacity .2s ease; }
.upload-tracker .ut-detail-open .ut-collapse { grid-template-rows: 1fr; opacity: 1; }
.upload-tracker .ut-collapse-inner { overflow: hidden; min-height: 0; }
.upload-tracker .ut-expand { display: inline-flex; align-items:center; justify-content:center; width:24px; height:24px; margin-top:6px; border:1px solid #fed7aa; background:#fff7ed; color:#c2410c; border-radius:7px; transition:transform .25s ease; }
.upload-tracker .ut-expand-open { transform:rotate(45deg); }
.upload-tracker .ut-receipt-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; padding:0 20px 20px; }
.upload-tracker .ut-receipt-card { border:1px solid #cbd5e1; border-radius:12px; padding:16px; background:white; }
.upload-tracker .ut-receipt-card h3, .upload-tracker .ut-receipt-history h3 { font-size:13px; font-weight:800; margin-bottom:8px; }
.upload-tracker .ut-receipt-date { display:flex; align-items:center; gap:6px; margin-bottom:12px; color:#475569; font-size:12px; }
.upload-tracker .ut-receipt-card > small { display:block; margin-top:8px; color:#64748b; }
.upload-tracker .ut-receipt-history { grid-column:1/-1; }
.upload-tracker .ut-receipt-history li { display:flex; justify-content:space-between; gap:12px; padding:8px; border-bottom:1px solid #e2e8f0; font-size:12px; }
.upload-tracker .ut-toast { position:sticky; top:12px; z-index:10; margin:12px; padding:14px; border:1px solid #fda4af; border-radius:10px; background:#fff1f2; color:#9f1239; display:flex; justify-content:space-between; gap:12px; }
@media(prefers-reduced-motion:reduce) { .upload-tracker .ut-collapse, .upload-tracker .ut-expand { transition:none; } }
''';p.write_text(s,encoding='utf-8')
