import React, { useEffect, useState } from 'react';
import { FileText, LoaderCircle } from 'lucide-react';
import api from '../../services/api';
import { API_ENDPOINTS } from '../../services/apiEndpoints';
import { formatDisplayDate, formatInr } from '../../utils/quotationDocument.mjs';

export default function PipelineLeadQuotations({ leadId, company, id }) {
  const [result, setResult] = useState({ loading: true });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const request = new AbortController();
    api.get(API_ENDPOINTS.quotations.list, { params: { leadId, limit: 100 }, signal: request.signal })
      .then(({ data }) => {
        if (request.signal.aborted) return;
        const rows = Array.isArray(data?.quotations) ? data.quotations : data;
        if (!Array.isArray(rows)) throw new Error('Quotation list unavailable');
        setResult({ rows });
      })
      .catch(() => {
        if (!request.signal.aborted) setResult({ error: true });
      });
    return () => request.abort();
  }, [leadId, attempt]);

  function retry() {
    setResult({ loading: true });
    setAttempt(current => current + 1);
  }

  return (
    <section id={id} className="pipeline-details-quotes" aria-label={`Quotations for ${company}`}>
      <div className="pipeline-details-quotes-heading">
        <FileText size={16} aria-hidden="true"/>
        <strong>Quotations</strong>
        {result.rows?.length > 0 && <span>{result.rows.length}</span>}
      </div>
      {result.loading && <p className="pipeline-details-quote-message" role="status"><LoaderCircle size={15} aria-hidden="true"/>Loading quotations…</p>}
      {result.error && <div className="pipeline-details-quote-message" role="alert">Unable to load quotations. <button type="button" onClick={retry}>Retry</button></div>}
      {result.rows?.length === 0 && <p className="pipeline-details-quote-message">No quotations recorded for this lead.</p>}
      {result.rows?.length > 0 && (
        <ul className="pipeline-details-quote-list">
          {result.rows.map((row, index) => (
            <li key={row._id || row.id || index}>
              <strong>{row.quotationNumber || 'Unnumbered quotation'}</strong>
              <span>{formatDisplayDate(row.quotationDate || row.createdAt)}</span>
              <span className="pipeline-details-quote-status">{(row.status || 'draft').replaceAll('_', ' ')}{row.serviceState && ` · ${row.serviceState}`}</span>
              <b>{formatInr(Number(row.grandTotal) || 0)}</b>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
