import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UploadCloud, FileText, CheckCircle2, X } from 'lucide-react';

export default function PortalUpload({ clients, kind, api, token }) {
  const [applicantType, setApplicantType] = useState(''), [draftType, setDraftType] = useState('');
  const [options, setOptions] = useState([]), [loadingTypes, setLoadingTypes] = useState(false);
  const [lead, setLead] = useState(String(clients[0]?._id || ''));
  const [file, setFile] = useState(null), [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [progress, setProgress] = useState(0), [modal, setModal] = useState(false), [pendingFile, setPendingFile] = useState(null);
  const input = useRef(null), dialog = useRef(null), trigger = useRef(null);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => {
    let active = true;
    api.get('/uploads', { headers }).then(({ data }) => { if (active) setRows(data); }).catch(() => { if (active) setError('Upload history could not be loaded. Refresh to retry.'); });
    return () => { active = false; };
  }, [api, token]);
  useEffect(() => {
    if (kind !== 'excel') return;
    let active = true;
    setOptions([]); setLoadingTypes(true);
    api.get('/applicant-types', { headers, params: { lead } }).then(({ data }) => { if (active) setOptions(data); }).catch(() => { if (active) setError('Applicant types could not be loaded. Refresh to retry.'); }).finally(() => { if (active) setLoadingTypes(false); });
    return () => { active = false; };
  }, [api, token, kind, lead]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    function keydown(event) {
      if (event.key === 'Escape') { setModal(false); setPendingFile(null); }
      if (event.key === 'Tab') {
        const controls = [...dialog.current.querySelectorAll('button:not(:disabled),select:not(:disabled),a[href]')];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', keydown); trigger.current?.focus(); };
  }, [modal]);
  function choose(next) {
    setError(''); setMessage(''); setFile(null);
    if (!next) return;
    const pattern = kind === 'excel' ? /\.(xlsx|xls)$/i : /\.(pdf|png|jpe?g|webp)$/i;
    if (!pattern.test(next.name) || next.size > 15 * 1024 * 1024 || !next.size) { setError('Choose a supported, non-empty file up to 15 MB.'); return; }
    setFile(next);
  }
  function openPicker(dropped) {
    if (busy) return;
    setError(''); setMessage('');
    if (kind === 'excel') { setPendingFile(dropped || null); setDraftType(''); setModal(true); }
    else if (dropped) choose(dropped); else { input.current.value = ''; input.current.click(); }
  }
  function confirmType() {
    if (!options.includes(draftType)) return;
    setApplicantType(draftType); setModal(false);
    if (pendingFile) { choose(pendingFile); setPendingFile(null); }
    else { input.current.value = ''; input.current.click(); }
  }
  async function submit(event) {
    event.preventDefault();
    if (!file || busy || (kind === 'excel' && !applicantType)) return;
    setBusy(true); setError(''); setMessage(''); setProgress(0);
    const body = new FormData(); if (kind === 'excel') body.append('applicantType', applicantType); body.append('file', file);
    try {
      const { data } = await api.post(`/uploads/${lead}/${kind}`, body, { headers, onUploadProgress: event => setProgress(Math.round(event.loaded * 100 / (event.total || file.size))) });
      setRows(current => [data, ...current]); setFile(null); setApplicantType(''); input.current.value = '';
      setMessage(kind === 'excel' ? (data.notificationStatus === 'sent' ? 'Excel file uploaded. Your account team has been notified by email.' : 'Excel file saved. Email notification could not reach every recipient; please contact your account team.') : 'File uploaded successfully and saved to your company account.');
    } catch (err) { setError(err.response?.data?.error || 'Upload failed. Please try again.'); }
    finally { setBusy(false); }
  }
  const history = rows.filter(row => row.kind === kind && String(row.lead) === lead);
  return <section className="cp-panel cp-upload-panel"><header className="cp-panel-heading"><div><h2>{kind === 'excel' ? 'Share your company Excel file' : 'Upload a purchase order'}</h2><p>{kind === 'excel' ? 'Send company information to your account team for review.' : 'Share your purchase order as a PDF or image.'}</p></div><span className="cp-stat-icon"><UploadCloud /></span></header>
    <form onSubmit={submit} className="cp-upload-form cp-upload-compact">
      <label className="cp-upload-company">Company<select value={lead} disabled={busy} onChange={event => { setLead(event.target.value); setMessage(''); setApplicantType(''); setFile(null); }}>{clients.map(client => <option key={client._id} value={client._id}>{client.company}</option>)}</select></label>
      <button ref={trigger} type="button" aria-haspopup={kind === 'excel' ? 'dialog' : undefined} disabled={busy} className="cp-dropzone" onClick={() => openPicker()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); openPicker(event.dataTransfer.files[0]); }}><UploadCloud size={20} /><strong>{file ? file.name : 'Choose a file or drop here'}</strong><span>{applicantType ? `${applicantType} · ` : ''}{kind === 'excel' ? 'Excel (.xlsx, .xls)' : 'PDF, PNG, JPG or WebP'} · Up to 15 MB</span></button>
      <input ref={input} type="file" hidden disabled={busy} accept={kind === 'excel' ? '.xlsx,.xls' : '.pdf,.png,.jpg,.jpeg,.webp'} onChange={event => choose(event.target.files[0])} />
      <button className="cp-button cp-upload-submit" disabled={!file || !lead || busy || (kind === 'excel' && !applicantType)}><UploadCloud size={17} />{busy ? 'Uploading…' : 'Upload file'}</button>
      {busy && <div className="cp-upload-feedback" role="status"><progress max="100" value={progress} /> {progress === 100 ? 'Saving file…' : `Uploading ${progress}%`}</div>}
      {error && <p role="alert" className="cp-error cp-upload-feedback">{error}</p>}{message && <p role="status" className="cp-upload-success cp-upload-feedback"><CheckCircle2 size={18} />{message}</p>}
    </form>
    {history.length > 0 && <div className="cp-upload-history"><h3>Submitted files</h3>{history.map(row => <div key={row._id}><FileText size={20} /><span><strong>{row.name}</strong><small>{row.applicantType && `${row.applicantType} · `}{new Date(row.uploadedAt).toLocaleDateString('en-IN')} · {(row.size / 1024).toFixed(0)} KB</small></span><a className="cp-button" href={row.url} target="_blank" rel="noopener noreferrer">{kind === 'excel' ? 'Download Excel' : 'Open file'}</a></div>)}</div>}
    {modal && createPortal(<div className="cp cp-applicant-overlay" onClick={event => { if (event.target === event.currentTarget) { setModal(false); setPendingFile(null); } }}><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="cp-applicant-title" className="cp-applicant-dialog"><header><span className="cp-stat-icon"><UploadCloud /></span><button type="button" className="cp-button" aria-label="Close Applicant Type selection" onClick={() => { setModal(false); setPendingFile(null); }}><X size={18} /></button></header><h2 id="cp-applicant-title">Select Applicant Type</h2><p>Choose the closed service this Excel file belongs to.</p>{loadingTypes ? <p role="status">Loading your closed services…</p> : options.length ? <label>Applicant Type<select value={draftType} onChange={event => setDraftType(event.target.value)}><option value="">Select Applicant Type</option>{options.map(option => <option key={option} value={option}>{option}</option>)}</select></label> : <p className="cp-error">No closed services are available for this company. Please contact your account team.</p>}<footer><button type="button" className="cp-button" onClick={() => { setModal(false); setPendingFile(null); }}>Cancel</button><button type="button" className="cp-button cp-upload-submit" disabled={!draftType || loadingTypes} onClick={confirmType}>{pendingFile ? 'Use this Applicant Type' : 'Continue to choose file'}</button></footer></section></div>, document.body)}
  </section>;
}
