import React, { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, ChevronRight, FileCheck2, LockKeyhole, Upload, X } from 'lucide-react';
import api from '../../services/api';
import { API_ENDPOINTS } from '../../services/apiEndpoints';
import { uploadMediaBatch } from '../../services/mediaUpload';
import { readClientData } from './clientMaster.utils';
import './clientSla.css';

const blankSla = { status: '', remark: '', fromDate: '', toDate: '', proofs: [] };
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export default function ClientSlaPage({ client, onClose, onContinue, backLabel = 'Back to Client Master list' }) {
  const clientId = String(client?._id || client?.id || client?.clientMasterId || '');
  const data = readClientData(client);
  const clientName = data.basic?.clientLegalName || data.basic?.tradeName || data.companyOverview?.companyName || 'Client';
  const [sla, setSla] = useState(blankSla);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setLoadFailed(false);
    api.get(API_ENDPOINTS.clients.sla(clientId)).then(({ data: response }) => {
      if (active) setSla({ ...blankSla, ...response.sla, proofs: Array.isArray(response.sla?.proofs) ? response.sla.proofs : [] });
    }).catch((err) => { if (active) { setLoadFailed(true); setError(err.response?.data?.error || 'Unable to load SLA. Please retry.'); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [clientId, reload]);
  const datesValid = validDate(sla.fromDate) && validDate(sla.toDate) && sla.fromDate <= sla.toDate;
  const disabled = loading || Boolean(busy) || loadFailed;
  const change = (patch) => { setSla(current => ({ ...current, ...patch })); setError(''); };
  async function upload(files) {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    if (selected.length + sla.proofs.length > 20) return setError('You can upload up to 20 SLA proof files.');
    if (selected.some(file => file.size > 15 * 1024 * 1024)) return setError('Each proof file must be 15 MB or smaller.');
    setBusy('upload'); setError('');
    try { const proofs = await uploadMediaBatch(selected, 'crm/client-master/sla'); setSla(current => ({ ...current, proofs: [...current.proofs, ...proofs] })); }
    catch (err) { setError(err.message || 'Unable to upload SLA proof.'); }
    finally { setBusy(''); }
  }
  async function save(event) {
    event.preventDefault();
    if (disabled) return;
    if (!datesValid) return setError('Enter both valid SLA dates. To Date must be on or after From Date.');
    setBusy('save'); setError('');
    try {
      const { data: response } = await api.put(API_ENDPOINTS.clients.sla(clientId), sla);
      if (!response.ready || !validDate(response.sla?.fromDate) || !validDate(response.sla?.toDate) || response.sla.fromDate > response.sla.toDate) throw new Error('Save both valid SLA dates before continuing.');
      onContinue(response.sla);
    } catch (err) { setError(err.response?.data?.error || err.message || 'Unable to save SLA details.'); }
    finally { setBusy(''); }
  }
  return <main className="client-sla-page">
    <button type="button" className="sla-back" disabled={Boolean(busy)} onClick={onClose}><ArrowLeft size={16} />{backLabel}</button>
    <section className="sla-card">
      <header className="sla-header"><span className="sla-icon"><FileCheck2 size={28} /></span><div><p>CLIENT MASTER ACCESS</p><h1>SLA Details</h1><span>{clientName}</span></div><span className={`sla-access ${datesValid ? 'sla-access-ready' : ''}`}><LockKeyhole size={15} />{datesValid ? 'Ready to save' : 'Dates required to continue'}</span></header>
      <form onSubmit={save}>
        {loading && <p className="sla-message" role="status">Loading saved SLA details…</p>}
        {error && <div className="sla-error" role="alert">{error}{loadFailed && <button type="button" onClick={() => setReload(current => current + 1)}>Retry</button>}</div>}
        <fieldset disabled={disabled} className="sla-fields"><div className="sla-table-wrap"><table className="sla-table"><thead><tr><th scope="col">SLA Status</th><th scope="col">SLA Remark</th><th scope="col">SLA Validation</th></tr></thead><tbody><tr>
          <td><label className="sla-label">SLA Status<select aria-label="SLA Status" value={sla.status} onChange={event => change({ status: event.target.value })}><option value="">Select status</option><option>Yes</option><option>No</option></select></label>
            <label className="sla-upload"><Upload size={16} />{busy === 'upload' ? 'Uploading…' : 'Upload proof'}<input aria-label="Upload SLA proof" type="file" multiple onChange={event => { upload(event.target.files); event.target.value = ''; }} /></label>
            <p className="sla-hint">Supporting documents · up to 15 MB per file</p>
            <div className="sla-files">{sla.proofs.map((file, index) => <div key={`${file.publicId || file.url}-${index}`}><a href={file.secureUrl || file.url} target="_blank" rel="noreferrer">{file.name || `Proof ${index + 1}`}</a><button type="button" onClick={() => change({ proofs: sla.proofs.filter((_, i) => i !== index) })} aria-label={`Remove ${file.name || 'proof'}`}><X size={14} /></button></div>)}</div>
          </td>
          <td><label className="sla-label">SLA Remark<textarea aria-label="SLA Remark" rows="5" maxLength="2000" placeholder="Add SLA terms, notes or remarks…" value={sla.remark} onChange={event => change({ remark: event.target.value })} /></label><p className="sla-hint">{sla.remark.length}/2000 characters</p></td>
          <td><div className="sla-date-heading"><CalendarDays size={18} />Validity period</div><div className="sla-date-range"><label className="sla-label">From Date <span>*</span><input aria-label="SLA From Date" required type="date" value={sla.fromDate} onChange={event => change({ fromDate: event.target.value })} /></label><label className="sla-label">To Date <span>*</span><input aria-label="SLA To Date" required type="date" min={sla.fromDate || undefined} value={sla.toDate} onChange={event => change({ toDate: event.target.value })} /></label></div><p className="sla-hint">Both dates are mandatory. To Date cannot be before From Date.</p></td>
        </tr></tbody></table></div></fieldset>
        <footer className="sla-footer"><p><LockKeyhole size={16} />Save both dates to unlock Client Master selection.</p><button className="sla-continue" type="submit" disabled={disabled || !datesValid}>{busy === 'save' ? 'Saving…' : 'Save & Continue'}<ChevronRight size={17} /></button></footer>
      </form>
    </section>
  </main>;
}
