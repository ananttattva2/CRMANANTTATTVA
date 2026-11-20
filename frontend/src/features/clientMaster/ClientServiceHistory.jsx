import React, { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import api from '../../services/api';
import { API_ENDPOINTS } from '../../services/apiEndpoints';
import { normalizeDocumentUrl } from './ClientMasterAnnualReturn';

export default function ClientServiceHistory({ client, onContinue }) {
  const [state, setState] = useState({ loading: true, error: '', rows: [] });
  const [refresh, setRefresh] = useState(0);
  const clientId = client?._id || client?.id;
  useEffect(() => {
    if (!clientId) { setState({ loading: false, error: '', rows: [] }); return; }
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      controller.abort();
      setState({ loading: false, error: 'Purchase orders took too long to load. Please retry.', rows: [] });
    }, 15000);
    setState({ loading: true, error: '', rows: [] });
    api.get(API_ENDPOINTS.clients.serviceHistory(clientId), { signal: controller.signal }).then(response => {
      if (cancelled) return;
      clearTimeout(timeout);
      setState({ loading: false, error: '', rows: Array.isArray(response.data?.services) ? response.data.services : [] });
    }).catch(error => {
      if (cancelled) return;
      clearTimeout(timeout);
      setState({ loading: false, error: error?.response?.data?.error || 'Unable to load service purchase orders. Please retry.', rows: [] });
    });
    return () => { cancelled = true; clearTimeout(timeout); controller.abort(); };
  }, [clientId, refresh]);
  return <section className="mt-5 overflow-hidden rounded-xl border border-teal-100 bg-white">
    <div className="border-b border-teal-100 bg-teal-50/60 p-5"><p className="text-sm font-bold text-slate-700">Closed purchase orders for all services offered to the selected applicant</p></div>
    {state.loading ? <p className="p-8 text-center text-sm text-slate-500" role="status">Loading purchase orders...</p>
      : state.error ? <div className="p-6 text-sm text-red-600" role="alert">{state.error}<button type="button" onClick={() => setRefresh(value => value + 1)} className="ml-4 rounded-lg border px-3 py-2">Retry</button></div>
      : <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm">
        <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500"><tr>{['Sub Applicant Type', 'Services Offered', 'PO Year', 'PO Number', 'View PO', 'Action'].map(label => <th key={label} scope="col" className="px-5 py-4">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{state.rows.map((row, index) => <tr key={`${row.assignedServiceId}-${index}`} className="hover:bg-teal-50/40">
          <td className="px-5 py-5 font-semibold text-slate-800">{row.applicantType || client?.data?.basic?.piboCategory || 'Not recorded'}</td>
          <td className="px-5 py-5 text-slate-700">{row.service}</td>
          <td className="whitespace-nowrap px-5 py-5">{row.poYear || 'Not recorded'}</td>
          <td className="px-5 py-5 font-semibold">{row.number || 'Not recorded'}</td>
          <td className="px-5 py-5">{row.fileUrl ? <a href={normalizeDocumentUrl(row.fileUrl)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-teal-200 px-3 py-2 font-bold text-[#30737B]"><Eye className="h-4 w-4" />View PO</a> : <span className="text-slate-500">No document uploaded</span>}</td>
          <td className="px-5 py-5"><button type="button" onClick={() => onContinue(row)} className="whitespace-nowrap rounded-lg bg-[#30737B] px-4 py-2.5 font-bold text-white hover:bg-teal-800">Continue to Service</button></td>
        </tr>)}{!state.rows.length && <tr><td colSpan={6} className="px-5 py-12 text-center text-slate-500">No closed purchase orders found for this applicant.</td></tr>}</tbody>
      </table></div>}
  </section>;
}
