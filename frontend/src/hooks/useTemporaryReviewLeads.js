import { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { API_ENDPOINTS } from '../services/apiEndpoints';
import useCrmRefresh from './useCrmRefresh';
export default function useTemporaryReviewLeads(enabled = true) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const request = useRef(0);
  async function refresh() {
    if (!enabled) { setLoading(false); return; }
    const version = ++request.current;
    setLoading(true); setError('');
    try {
      const { data } = await api.get(API_ENDPOINTS.leads.temporaryLeads, { params: { status: 'DRAFT', view: 'review', snapshot: 'true' }, timeout: 30000 });
      if (version !== request.current) return;
      setRows(data.temporaryLeads || []);
    } catch (failure) { if (version === request.current) setError(failure.response?.data?.error || 'Unable to load Temp Leads. Counts may be incomplete; refresh to retry.'); }
    finally { if (version === request.current) setLoading(false); }
  }
  useEffect(() => { refresh(); return () => { request.current++; }; }, [enabled]);
  useCrmRefresh(refresh, enabled);
  return { rows, loading, error, refresh };
}
