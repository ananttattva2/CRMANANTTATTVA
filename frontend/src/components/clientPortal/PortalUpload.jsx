import React, { useEffect, useRef, useState } from 'react';
import { UploadCloud, FileText, CheckCircle2 } from 'lucide-react';

export default function PortalUpload({ clients, kind, api, token, onViewFile }) {
  const [lead, setLead] = useState(String(clients[0]?._id || ''));
  const [file, setFile] = useState(null), [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const input = useRef(null);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => {
    let active = true;
    api.get('/uploads', { headers }).then(({ data }) => { if (active) setRows(data); }).catch(() => { if (active) setError('Upload history could not be loaded. Refresh to retry.'); });
    return () => { active = false; };
  }, [api, token]);
  function choose(next) {
    setError(''); setMessage(''); setFile(null);
    if (!next) return;
    const pattern = kind === 'excel' ? /\.(xlsx|xls)$/i : /\.(pdf|png|jpe?g|webp)$/i;
    if (!pattern.test(next.name) || next.size > 15 * 1024 * 1024 || !next.size) { setError('Choose a supported, non-empty file up to 15 MB.'); return; }
    setFile(next);
  }
  async function submit(event) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true); setError(''); setMessage(''); setProgress(0);
    const body = new FormData(); body.append('file', file);
    try {
      const { data } = await api.post(`/uploads/${lead}/${kind}`, body, { headers, onUploadProgress: event => setProgress(Math.round(event.loaded * 100 / (event.total || file.size))) });
      setRows(current => [data, ...current]); setFile(null); input.current.value = '';
      setMessage('File uploaded successfully and saved to your company account.');
    } catch (err) { setError(err.response?.data?.error || 'Upload failed. Please try again.'); }
    finally { setBusy(false); }
  }
  const history = rows.filter(row => row.kind === kind && String(row.lead) === lead);
  return <section className="cp-panel cp-upload-panel"><header className="cp-panel-heading"><div><h2>{kind === 'excel' ? 'Share your company Excel file' : 'Upload a purchase order'}</h2><p>{kind === 'excel' ? 'Send company information to your account team for review.' : 'Share your purchase order as a PDF or image.'}</p></div><span className="cp-stat-icon"><UploadCloud /></span></header>
    <form onSubmit={submit} className="cp-upload-form">
      <label className="cp-upload-company">Company<select value={lead} disabled={busy} onChange={event => { setLead(event.target.value); setMessage(''); }}>{clients.map(client => <option key={client._id} value={client._id}>{client.company}</option>)}</select></label>
      <label className={`cp-dropzone ${busy ? 'cp-upload-busy' : ''}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) choose(event.dataTransfer.files[0]); }}><UploadCloud size={30} /><strong>{file ? file.name : 'Drop your file here, or click to browse'}</strong><span>{kind === 'excel' ? 'Excel (.xlsx, .xls)' : 'PDF, PNG, JPG or WebP'} · Up to 15 MB</span><input ref={input} type="file" disabled={busy} accept={kind === 'excel' ? '.xlsx,.xls' : '.pdf,.png,.jpg,.jpeg,.webp'} onChange={event => choose(event.target.files[0])} /></label>
      {busy && <div role="status"><progress max="100" value={progress} /> {progress === 100 ? 'Saving file…' : `Uploading ${progress}%`}</div>}
      {error && <p role="alert" className="cp-error">{error}</p>}{message && <p role="status" className="cp-upload-success"><CheckCircle2 size={18} />{message}</p>}
      <button className="cp-button cp-upload-submit" disabled={!file || !lead || busy}><UploadCloud size={17} />{busy ? 'Uploading…' : 'Upload file'}</button>
    </form>
    {history.length > 0 && <div className="cp-upload-history"><h3>Submitted files</h3>{history.map(row => <div key={row._id}><FileText size={20} /><span><strong>{row.name}</strong><small>{new Date(row.uploadedAt).toLocaleDateString('en-IN')} · {(row.size / 1024).toFixed(0)} KB</small></span><a className="cp-button" href={row.url} target="_blank" rel="noopener noreferrer">Open file ↗</a></div>)}</div>}
  </section>;
}
