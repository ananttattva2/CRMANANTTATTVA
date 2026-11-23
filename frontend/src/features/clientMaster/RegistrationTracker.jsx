import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { uploadMedia } from '../../services/mediaUpload';
export default function RegistrationTracker({ client, service, onBack }) {
  const [tracker, setTracker] = useState({ dataReceived: 'no', complianceCheck: 'no', registrationCompleted: 'no', proof: null });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const clientId = client._id || client.id;
  const identity = { assignedServiceId: service.assignedServiceId, poNumber: service.number, registrationYear: service.registrationYear || '' };
  useEffect(() => {
    const controller = new AbortController();
    api.get(`/clients/${clientId}/registration-tracker`, { params: identity, signal: controller.signal }).then(({ data }) => { setTracker(data.tracker); setLoaded(true); }).catch(failure => { if (!controller.signal.aborted) setError(failure.response?.data?.error || 'Unable to load registration tracker.'); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [clientId, service.assignedServiceId, service.number, service.registrationYear]);
  async function upload(file) {
    if (!file) return;
    setBusy(true); setError('');
    try { const proof = await uploadMedia(file, 'crm/client-master/registration-proof'); setTracker(current => ({ ...current, proof })); }
    catch (failure) { setError(failure.message || 'Proof upload failed.'); }
    finally { setBusy(false); }
  }
  async function save(event) {
    event.preventDefault(); if (!loaded) return; setError(''); setNotice('');
    if (tracker.registrationCompleted === 'yes' && !tracker.proof) { setError('Upload proof before marking registration completed.'); return; }
    setBusy(true);
    try { const { data } = await api.put(`/clients/${clientId}/registration-tracker`, { ...identity, ...tracker }); setTracker(data.tracker); setNotice('Registration tracker saved.'); }
    catch (failure) { setError(failure.response?.data?.error || 'Unable to save tracker.'); }
    finally { setBusy(false); }
  }
  return <section className="mt-5 overflow-hidden rounded-2xl border border-teal-100 bg-white"><header className="flex flex-wrap items-center justify-between gap-3 border-b bg-teal-50 p-5"><div><h2 className="text-lg font-bold">Client Data Upload Tracker</h2><p className="mt-1 text-sm text-slate-600">{service.service} · {service.number} {service.registrationYear && `· ${service.registrationYear}`}</p></div><button type="button" onClick={onBack} disabled={busy} className="rounded-xl border bg-white px-4 py-2 text-sm font-bold">Back to Service History</button></header><form onSubmit={save} className="space-y-4 p-5">{error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}{notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}{[['dataReceived','1. Data Received'],['complianceCheck','2. Compliance Check'],['registrationCompleted','3. Registration Completed']].map(([key,label]) => <label key={key} className="flex items-center justify-between gap-4 rounded-xl border p-4 font-bold text-slate-700">{label}<select aria-label={label} value={tracker[key]} disabled={busy || !loaded} onChange={event => setTracker(current => ({ ...current, [key]: event.target.value }))} className="min-w-28 rounded-lg border bg-white p-2"><option value="no">No</option><option value="yes">Yes</option></select></label>)}{tracker.registrationCompleted === 'yes' && <div className="rounded-xl border border-teal-100 bg-teal-50 p-4"><label className="block text-sm font-bold">Completion Proof *<input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" disabled={busy || !loaded} onChange={event => upload(event.target.files?.[0])} className="mt-3 block w-full text-sm" /></label>{tracker.proof && <a className="mt-3 block break-all text-sm font-bold text-teal-800 underline" href={tracker.proof.secureUrl || tracker.proof.url} target="_blank" rel="noopener noreferrer">{tracker.proof.name || 'View completion proof'}</a>}</div>}<button type="submit" disabled={busy || !loaded} className="rounded-xl bg-teal-700 px-5 py-3 text-sm font-bold text-white disabled:opacity-40">{busy ? 'Please wait…' : 'Save Tracker'}</button></form></section>;
}
