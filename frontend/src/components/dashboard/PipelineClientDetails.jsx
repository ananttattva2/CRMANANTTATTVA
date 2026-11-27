import React, { useEffect, useId, useRef, useState } from 'react';
import { Building2, ChevronDown, FileText, X } from 'lucide-react';
import { formatDisplayDate } from '../../utils/quotationDocument.mjs';
import { revenueMoney } from '../leads/LeadRevenuePanel';

function ClientProfile({ profile, owner }) {
  const fields = [
    ['Contact person', profile.contactPerson], ['Designation', profile.designation],
    ['Phone', profile.phone], ['Email', profile.email], ['Lead owner', owner],
    ['Communication mode', profile.communicationMode], ['Industry / Sector', profile.industry],
    ['City / State / PIN', [profile.city, profile.state, profile.pinCode].filter(Boolean).join(', ')],
    ['Address', profile.address, true], ['Communication note', profile.communicationNote, true]
  ].filter(([, value]) => value);

  if (!fields.length) return null;

  return (
    <section aria-label="Client contact details">
      <h3 className="pipeline-client-section-title">Contact &amp; company</h3>
      <dl className="pipeline-client-profile">
        {fields.map(([label, value, wide]) => (
          <div key={label} className={wide ? 'pipeline-client-profile-wide' : undefined}>
            <dt>{label}</dt><dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ClientServices({ services }) {
  const id = useId();
  const [expandedService, setExpandedService] = useState(null);
  const closedCount = services.filter(service => service.closed).length;

  return (
    <section aria-label="Services and assignments">
      <div className="pipeline-client-section-header">
        <h3 className="pipeline-client-section-title">Services &amp; assignments</h3>
        {services.length > 0 && <div className="pipeline-client-service-counts">
          <span className="pipeline-badge closed">{closedCount} closed</span>
          <span className="pipeline-badge open">{services.length - closedCount} open</span>
        </div>}
      </div>
      {!services.length ? <p className="pipeline-empty">No accessible services recorded for this lead.</p> : (
        <div className="pipeline-table-wrap pipeline-services-table-wrap">
          <table className="pipeline-services-table" role="table">
            <thead role="rowgroup"><tr role="row">
              {['Service', 'Applicant', 'Financial year', 'Assigned team', 'Status', 'Quotations'].map(label => <th key={label} scope="col">{label}</th>)}
            </tr></thead>
            <tbody role="rowgroup">
              {services.map((service, index) => {
                const quotations = service.quotations || [];
                const expanded = expandedService === index;
                const quotesId = `${id}-quotes-${index}`;
                return (
                  <React.Fragment key={service.id || index}>
                    <tr role="row" className="pipeline-client-service-row" data-expanded={expanded}>
                      <td role="cell"><div className="pipeline-client-service-name">
                        <span className="pipeline-service-index-cell">{String(index + 1).padStart(2, '0')}</span>
                        <div><strong>{service.offering || 'Service'}</strong><small>{service.category || 'Category not recorded'}</small></div>
                      </div></td>
                      <td role="cell" data-label="Applicant">{service.applicant || '—'}</td>
                      <td role="cell" data-label="Financial year">{service.year || '—'}</td>
                      <td role="cell" data-label="Assigned team" className="pipeline-client-team">
                        <span><small>Manager</small>{service.manager || '—'}</span>
                        <span><small>Staff</small>{service.staff || '—'}</span>
                      </td>
                      <td role="cell" data-label="Status"><span className={`pipeline-badge ${service.closed ? 'closed' : 'open'}`}>{service.closed ? 'Closed' : 'Open'}</span></td>
                      <td role="cell" data-label="Quotations">{quotations.length > 0
                        ? <button type="button" className="pipeline-client-quote-toggle" aria-expanded={expanded}
                          aria-controls={expanded ? quotesId : undefined} onClick={() => setExpandedService(expanded ? null : index)}>
                          <FileText size={14} aria-hidden="true"/>{quotations.length} {quotations.length === 1 ? 'quotation' : 'quotations'}<ChevronDown size={14} aria-hidden="true"/>
                        </button>
                        : <span className="pipeline-client-no-quotes">None recorded</span>}
                      </td>
                    </tr>
                    {expanded && <tr role="row" className="pipeline-client-service-quotes"><td role="cell" colSpan={6}>
                      <ul id={quotesId} className="pipeline-details-quote-list" aria-label={`Quotations for ${service.offering || 'service'}`}>
                        {quotations.map((quote, quoteIndex) => <li key={quoteIndex}>
                          <strong>{quote.number || 'Unnumbered quotation'}</strong>
                          <span>{formatDisplayDate(quote.date)}</span>
                          <span className="pipeline-details-quote-status">{(quote.status || 'quotation').replaceAll('_', ' ')}</span>
                          <b>{revenueMoney(quote.amountPaise)}</b>
                        </li>)}
                      </ul>
                    </td></tr>}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function PipelineClientDetails({ view, onClose, onRetry }) {
  const dialog = useRef(null);

  useEffect(() => {
    if (!dialog.current.open) dialog.current.showModal();
  }, []);

  return (
    <dialog ref={dialog} className="pipeline-dialog pipeline-services-dialog pipeline-client-details"
      aria-labelledby="pipeline-client-details-title" onClose={onClose}>
      <header>
        <div className="pipeline-client-title">
          <span className="dashboard-quotation-header-icon"><Building2 size={20} aria-hidden="true"/></span>
          <div>
            <h2 id="pipeline-client-details-title">{view.row.company}</h2>
            <p>{[view.row.code, view.services && `${view.services.length} ${view.services.length === 1 ? 'service' : 'services'}`].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
        <button type="button" onClick={() => dialog.current.close()} aria-label="Close services" className="dashboard-quotation-icon-button"><X size={18}/></button>
      </header>
      <div className="pipeline-dialog-body">
        {view.loading ? <p role="status" className="pipeline-empty">Loading services…</p> : view.error ? (
          <div role="alert" className="pipeline-error">{view.error} <button type="button" onClick={onRetry}>Retry</button></div>
        ) : <>
          {view.clientDetails && <ClientProfile profile={view.clientDetails} owner={view.row.owner}/>}
          <ClientServices services={view.services || []}/>
          {view.purchaseOrders?.length > 0 && <section aria-label="Recorded purchase orders">
            <h3 className="pipeline-client-section-title">Recorded purchase orders</h3>
            <div className="pipeline-po-list">{view.purchaseOrders.map((po, index) => (
              <div key={index}><b>{po.number}</b><span>{po.date || 'Date not recorded'}</span><strong>{revenueMoney(po.amountPaise)}</strong></div>
            ))}</div>
          </section>}
        </>}
      </div>
    </dialog>
  );
}
