import React, { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ArrowRight, Building2, FileText, LayoutDashboard, LogOut, RefreshCw, UserRound, X } from 'lucide-react';
import api from '../services/api';
import { buildInvoicePdf } from '../utils/proformaPdf';
import ClientPortalInfo from '../components/clientPortal/ClientPortalInfo';
import { handlingTeam } from '../utils/clientPortalPresentation.mjs';
import '../styles/client-portal.css';
const clientApi = axios.create({
  baseURL: `${api.defaults.baseURL}/client-portal`
});
const sessionKey = 'crm.clientPortal.token';
const money = value => Number(value || 0).toLocaleString('en-IN', {
  style: 'currency',
  currency: 'INR'
});
const date = value => {
  const parsed = new Date(value);
  return value && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleDateString('en-IN') : '—';
};
const label = key => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, value => value.toUpperCase());
const readable = value => value === null || value === undefined || value === '' ? '—' : Array.isArray(value) ? value.map(readable).join(', ') : typeof value === 'object' ? Object.entries(value).filter(([key]) => !['_id', 'id'].includes(key)).map(([key, entry]) => `${label(key)}: ${readable(entry)}`).join(' · ') : String(value);
const errorText = error => error.response?.data?.error || 'Unable to connect. Please try again.';
const tabs = [['dashboard', 'Dashboard', LayoutDashboard], ['info', 'Client Info', Building2], ['po', 'Purchase Orders', FileText], ['quotations', 'Quotations', FileText], ['pi', 'Proforma Invoices', FileText]];
function Brand() {
  return <Link to="/" className="inline-flex items-center gap-3"><img src="/ananttattva-logo.png" alt="Anant Tattva" className="h-12 w-32 object-contain" /><span className="border-l border-slate-200 pl-3 text-xs font-bold uppercase tracking-widest text-teal-700">Client Portal</span></Link>;
}
function Table({
  columns,
  rows,
  empty = 'No records available yet.'
}) {
  const [search, setSearch] = useState('');
  const filtered = rows.filter(row => !search || Object.values(row).filter(value => typeof value === 'string' || typeof value === 'number').join(' ').toLowerCase().includes(search.toLowerCase()));
  return <div className="cp-table-container">{(rows.length > 4 || search) && <div className="cp-table-tools"><span>{filtered.length} records</span><input aria-label="Search table" placeholder="Search records…" value={search} onChange={event => setSearch(event.target.value)} /></div>}<div className="cp-table-scroll"><table className="cp-table"><thead><tr>{columns.map(column => <th scope="col" key={column.label}>{column.label}</th>)}</tr></thead><tbody>{filtered.map((row, index) => <tr key={row._id || index}>{columns.map(column => <td key={column.label}>{column.render ? column.render(row, index) : readable(row[column.key])}</td>)}</tr>)}</tbody></table></div>{!filtered.length && <div className="cp-empty"><FileText size={25} /><strong>{search ? 'No matching records' : empty}</strong><p>{search ? 'Try another search term.' : 'Shared records will appear here when available.'}</p></div>}</div>;
}
function Section({
  title,
  children,
  description,
  action
}) {
  return <section className="cp-panel"><header className="cp-panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</header>{children}</section>;
}
export function ClientLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const {
        data
      } = await clientApi.post('/login', {
        email
      });
      sessionStorage.setItem(sessionKey, data.token);
      navigate('/client/dashboard', {
        replace: true
      });
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return <div className="cp cp-login-page"><header className="flex flex-wrap items-center justify-between gap-4 border-b bg-white px-6 py-4"><Brand /><Link to="/login" className="text-sm font-semibold text-slate-600">Staff Login</Link></header><main className="cp-login-layout"><div><span className="inline-flex items-center gap-2 rounded-full bg-teal-100 px-4 py-2 text-xs font-bold uppercase tracking-widest text-teal-800"><Building2 className="h-4 w-4" />Client workspace</span><h1 className="mt-6 text-4xl font-bold leading-tight text-slate-900 sm:text-5xl">Your business.<br /><span className="text-teal-700">One clear view.</span></h1><p className="mt-5 max-w-md text-lg leading-relaxed text-slate-500">See your company details, purchase orders, quotations and invoices. Connect with the team member handling your account.</p><div className="mt-8 flex flex-wrap gap-3">{['Email login', 'Your documents', 'Your account SPOC'].map(value => <span key={value} className="rounded-xl border bg-white px-4 py-3 text-sm text-slate-600">{value}</span>)}</div></div><form onSubmit={submit} className="cp-login-card"><div className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-teal-50 text-teal-700"><UserRound /></div><h2 className="text-2xl font-bold">Client Login</h2><p className="mt-2 text-sm leading-relaxed text-slate-500">Enter the email registered in your company’s Contact information to open your dashboard.</p><label className="mt-7 block text-sm font-semibold">Contact email<input type="email" required maxLength={254} disabled={busy} autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com" className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-4 disabled:bg-slate-50" /></label>{error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<button disabled={busy} className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-700 font-bold text-white hover:bg-teal-800 disabled:opacity-50">{busy ? 'Signing in…' : 'Login & Open Dashboard'}<ArrowRight className="h-4 w-4" /></button></form></main></div>;
}
function DocumentPreview({
  row,
  onClose
}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (row.kind !== 'pi') return;
    const next = URL.createObjectURL(buildInvoicePdf(row).output('blob'));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [row]);
  return <div className="cp cp-dialog fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3"><section role="dialog" aria-modal="true" aria-label="Document details" className="flex max-h-[94vh] min-h-[60vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white"><header className="flex items-center justify-between gap-3 border-b p-5"><div><h2 className="font-bold">{row.proformaNumber || row.quotationNumber}</h2><p className="text-sm text-slate-500">{row.companyName}</p></div><div className="flex gap-4">{row.kind === 'pi' && <button onClick={() => buildInvoicePdf(row).save(`${row.proformaNumber.replace(/[^a-z0-9-]/gi, '-')}.pdf`)} className="font-semibold text-teal-700">Download PDF</button>}<button aria-label="Close document" onClick={onClose}><X /></button></div></header>{row.kind === 'pi' ? <iframe title="Proforma Invoice" src={url || undefined} className="h-[76vh] w-full" /> : <div className="space-y-5 overflow-y-auto p-5"><Table columns={[{
          label: 'Field',
          key: 'field'
        }, {
          label: 'Details',
          key: 'value'
        }]} rows={Object.entries(row.leadDetails || {}).map(([key, value]) => ({
          field: label(key),
          value
        }))} /><Table columns={[{
          label: 'Service',
          key: 'serviceCategory'
        }, {
          label: 'Services Offered',
          key: 'servicesOffered'
        }, {
          label: 'Year',
          render: item => item.financialYear || item.servicesForYear || '—'
        }, {
          label: 'Quantity',
          key: 'unit'
        }, {
          label: 'Basic Amount',
          render: item => row.pricingMode === 'combined' ? 'Combined pricing' : money(item.basicAmount)
        }]} rows={row.items || []} /><p className="text-right font-bold">Total: {money(row.grandTotal)}</p><p className="whitespace-pre-line text-sm text-slate-600">{[row.paymentTerm, ...(row.terms || [])].filter(Boolean).join('\n')}</p></div>}</section></div>;
}
export default function ClientPortal() {
  const navigate = useNavigate(),
    location = useLocation();
  const tab = location.pathname.split('/')[2] || 'dashboard';
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [document, setDocument] = useState(null);
  const token = sessionStorage.getItem(sessionKey);
  function logout() {
    sessionStorage.removeItem(sessionKey);
    setData(null);
    navigate('/client-login', {
      replace: true
    });
  }
  async function load() {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const response = await clientApi.get('/overview', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      setData(response.data);
    } catch (error) {
      if (error.response?.status === 401) logout();else {
        if (error.response?.status === 403) setData(null);
        setError(errorText(error));
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [token]);
  if (!token) return <Navigate to="/client-login" replace />;
  if (!tabs.some(([key]) => key === tab)) return <Navigate to="/client/dashboard" replace />;
  const documentColumns = [{
    label: 'Document',
    render: row => <div className="cp-cell-main"><strong>{row.proformaNumber || row.quotationNumber}</strong><small>{row.companyName}</small></div>
  }, {
    label: 'Issued on',
    render: row => date(row.invoiceDate || row.quotationDate)
  }, {
    label: 'Valid until',
    render: row => date(row.validUntil)
  }, {
    label: 'Amount',
    render: row => <strong className="cp-money">{money(row.grandTotal)}</strong>
  }, {
    label: 'Status',
    render: row => <span className="cp-badge">{label(row.status || 'Shared').replace(/_/g, ' ')}</span>
  }, {
    label: 'Action',
    render: row => <button className="cp-action" onClick={() => setDocument(row)}>View {row.kind === 'pi' ? 'invoice' : 'quotation'} →</button>
  }];
  const poColumns = [{
    label: 'Purchase order',
    render: row => <div className="cp-cell-main"><strong>{row.poNumber || 'PO document'}</strong><small>{row.company}</small></div>
  }, {
    label: 'Financial year',
    render: row => <span className="cp-year">{row.financialYear || '—'}</span>
  }, {
    label: 'PO date',
    render: row => date(row.date)
  }, {
    label: 'Amount',
    render: row => <strong className="cp-money">{money(row.amount)}</strong>
  }, {
    label: 'Services',
    render: row => <div className="cp-tag-list">{(row.services || []).map((service, index) => <span key={index}>{service}</span>)}</div>
  }, {
    label: 'Handled by',
    render: row => row.spoc?.name || 'Not assigned'
  }, {
    label: 'File',
    render: row => row.fileUrl ? <a className="cp-action" href={row.fileUrl} target="_blank" rel="noopener noreferrer">View PO ↗</a> : <span className="cp-badge cp-pending">Awaiting upload</span>
  }];
  const summary = data?.summary;
  return <div className="cp cp-portal"><header className="cp-topbar"><Brand /><div className="cp-topbar-account"><span className="cp-user-avatar"><UserRound size={16} /></span><span>{data?.email || 'Client account'}</span><button className="cp-button" onClick={logout}><LogOut size={15} />Sign out</button></div></header><div className="cp-shell"><aside className="cp-sidebar"><p className="cp-nav-label">CLIENT WORKSPACE</p><nav>{tabs.map(([key, title, Icon]) => <NavLink key={key} to={`/client/${key}`} className={({
            isActive
          }) => isActive ? 'active' : ''}><Icon size={18} /><span>{title}</span>{data && ['po', 'quotations', 'pi'].includes(key) && <small>{key === 'po' ? summary.purchaseOrders : key === 'pi' ? summary.invoices : summary.quotations}</small>}</NavLink>)}</nav><div className="cp-sidebar-bottom"><Building2 size={18} /><div><strong>{data?.clients?.[0]?.company || 'Your account'}</strong><span>Connected to Anant Tattva</span></div></div></aside><main className="cp-main"><div className="cp-page-heading"><div><p className="cp-eyebrow">ANANT TATTVA / CLIENT PORTAL</p><h1>{tab === 'dashboard' ? 'Account overview' : tabs.find(([key]) => key === tab)?.[1]}</h1><p>{tab === 'info' ? 'Your company, contacts, services and documents — clearly organised.' : 'Your company records, together in one place.'}</p></div><button className="cp-button" disabled={loading} onClick={load}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />{loading ? 'Updating…' : 'Refresh'}</button></div>{error && <p role="alert" className="cp-error">{error}</p>}{loading && !data && <div role="status" className="cp-loading">Loading your account…</div>}{data && <>
  {tab === 'dashboard' && <><div className="cp-stats">{[['Companies', summary.companies, 'info', Building2], ['POs uploaded', summary.uploadedPurchaseOrders, 'po', FileText], ['Quotations', summary.quotations, 'quotations', FileText], ['Proforma invoices', summary.invoices, 'pi', FileText]].map(([title, value, target, Icon]) => <Link key={title} to={`/client/${target}`}><span className="cp-stat-icon"><Icon size={19} /></span><div><p>{title}</p><strong>{value}</strong></div><ArrowRight size={16} /></Link>)}</div><div className="cp-overview-banner"><div><p>PURCHASE ORDER SUMMARY</p><h2>{money(summary.poValue)}<small>Total recorded value</small></h2></div><div className="cp-upload-progress"><strong>{summary.uploadedPurchaseOrders} of {summary.purchaseOrders} PO records uploaded</strong><progress value={summary.uploadedPurchaseOrders} max={summary.purchaseOrders || 1} /><Link to="/client/po">Browse purchase orders →</Link></div></div><div className="cp-two-columns cp-dashboard-columns"><Section title="Your account team" description="Your points of contact at Anant Tattva."><div className="cp-team-grid">{data.clients.flatMap(client => handlingTeam(client).map((person, index) => <article className="cp-person" key={`${client._id}-${index}`}><span className="cp-avatar">{(person.name || 'AT').split(' ').map(word => word[0]).slice(0, 2).join('')}</span><div><h3>{person.name || 'Not assigned'}</h3><p>{client.company}</p>{person.email && <a href={`mailto:${person.email}`}>{person.email}</a>}<small>{person.services.length} assigned service{person.services.length === 1 ? '' : 's'}</small></div></article>))}</div></Section><Section title="Document centre" description="Your shared quotations and invoices."><div className="cp-document-shortcuts"><Link to="/client/quotations"><FileText /><div><strong>Quotations</strong><small>{summary.quotations} shared documents</small></div><ArrowRight size={16} /></Link><Link to="/client/pi"><FileText /><div><strong>Proforma invoices</strong><small>{summary.invoices} issued invoices</small></div><ArrowRight size={16} /></Link></div></Section></div><Section title="Recent purchase orders" action={<Link className="cp-action" to="/client/po">View all →</Link>}><Table columns={poColumns} rows={data.purchaseOrders.slice(0, 5)} empty="No purchase orders yet" /></Section>{data.quotations.length > 0 && <Section title="Latest quotations"><Table columns={documentColumns} rows={data.quotations.slice(0, 5)} /></Section>}</>}
  {tab === 'info' && <div className="cp-stack">{data.clients.map(client => <ClientPortalInfo key={client._id} client={client} Table={Table} Section={Section} />)}</div>}
  {tab === 'po' && <Section title="Purchase orders" description={`${summary.uploadedPurchaseOrders} uploaded files · ${summary.purchaseOrders} records · ${money(summary.poValue)} total value`}><Table columns={poColumns} rows={data.purchaseOrders} empty="No purchase orders yet" /></Section>}
  {(tab === 'quotations' || tab === 'pi') && <Section title={tab === 'pi' ? 'Proforma invoices' : 'Quotations'} description={tab === 'pi' ? 'Issued invoices, ready to view and download.' : 'Quotations shared with your company.'}><Table columns={documentColumns} rows={tab === 'pi' ? data.invoices : data.quotations} empty={tab === 'pi' ? 'No proforma invoices shared yet' : 'No quotations shared yet'} /></Section>}
  </>}<footer className="cp-footer">Anant Tattva · Client workspace</footer></main></div>{document && <DocumentPreview row={document} onClose={() => setDocument(null)} />}</div>;
}
