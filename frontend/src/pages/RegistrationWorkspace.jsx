import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import DashboardShell from '../components/dashboard/DashboardShell';
import RegistrationTracker from '../features/clientMaster/RegistrationTracker';
import api from '../services/api';
export default function RegistrationWorkspace() {
  const { clientId } = useParams(), [params] = useSearchParams(), navigate = useNavigate();
  const [client,setClient] = useState(null), [error,setError] = useState('');
  useEffect(() => { const controller = new AbortController(); api.get(`/clients/${clientId}`, { signal:controller.signal }).then(({data}) => setClient(data.client)).catch(error => { if (!controller.signal.aborted) setError(error.response?.data?.error || 'Unable to load client.'); }); return () => controller.abort(); },[clientId]);
  const back = () => navigate('/sales/client-master', { state: { openClientMasterId:clientId,openClientMasterAssignedServiceId:params.get('assignedServiceId') } });
  return <DashboardShell><main className="p-4 md:p-6">{error ? <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-800">{error}</p> : client ? <RegistrationTracker client={client} service={{ assignedServiceId:params.get('assignedServiceId'),number:params.get('poNumber'),registrationYear:params.get('registrationYear'),service:params.get('service') }} onBack={back} /> : <p role="status">Loading registration workspace…</p>}</main></DashboardShell>;
}
