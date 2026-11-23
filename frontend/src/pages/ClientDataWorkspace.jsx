import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import DashboardShell from '../components/dashboard/DashboardShell';
import PurchaseDataWorkspace from '../features/clientMaster/PurchaseDataWorkspace';
export default function ClientDataWorkspace() {
  const {clientId}=useParams(),[params]=useSearchParams(),navigate=useNavigate();
  const year=params.get('financialYear') || '';
  const [client,setClient]=useState(null);
  useEffect(()=>{const controller=new AbortController();api.get(`/clients/${clientId}`,{signal:controller.signal}).then(({data})=>setClient(data.client)).catch(()=>{});return()=>controller.abort();},[clientId]);
  let currentUser;try{currentUser=JSON.parse(localStorage.getItem('user') || 'null');}catch{}
  return <DashboardShell><main className="p-4 md:p-6"><header className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-white p-5"><div><p className="text-xs font-bold uppercase tracking-widest text-teal-700">Client Data Workspace</p><h1 className="mt-1 text-xl font-bold">{client?.data?.basic?.clientLegalName || client?.data?.basic?.tradeName || 'Client Data Upload Tracker'}</h1><p className="mt-1 text-sm text-slate-600">Annual Return · {year} · {client?.data?.basic?.piboCategory || ''}</p></div><button onClick={()=>navigate(`/sales/client-data-processing/${encodeURIComponent(clientId)}/${encodeURIComponent(year)}`)} className="rounded-xl border px-4 py-2 font-bold">Back to Annual Return</button></header><PurchaseDataWorkspace clientId={clientId} financialYear={year} currentUser={currentUser}/></main></DashboardShell>;
}
