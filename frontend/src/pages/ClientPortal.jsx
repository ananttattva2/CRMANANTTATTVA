import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ArrowRight, Building2, FileText, LayoutDashboard, LogOut, RefreshCw, UserRound, Mail, Phone, Users, HelpCircle, Paperclip, Coins, Search, ChevronLeft, ChevronRight, X } from 'lucide-react';
import api from '../services/api';
import { buildInvoicePdf } from '../utils/proformaPdf';
import FilePreview from '../components/clientPortal/FilePreview';
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
export function Table({
  columns,
  rows,
  empty = 'No records available yet.',
  kind = ''
}) {
  const [search, setSearch] = useState(''),
    [fy, setFy] = useState(''),
    [page, setPage] = useState(1);
  const filtered = rows.filter(row => (!fy || row.financialYear === fy) && (!search || Object.values(row).flatMap(value => Array.isArray(value) ? value.filter(entry => typeof entry === 'string') : typeof value === 'string' || typeof value === 'number' ? [value] : []).join(' ').toLowerCase().includes(search.toLowerCase())));
  const pages = Math.max(1, Math.ceil(filtered.length / 10)),
    activePage = Math.min(page, pages),
    start = (activePage - 1) * 10;
  const years = [...new Set(rows.map(row => row.financialYear).filter(Boolean))].sort();
  const document = kind === 'quotations' || kind === 'pi';
  return <div className={`cp-table-container ${document ? 'cp-document-table' : ''}`}>
  {(kind || rows.length > 4 || search) && <div className="cp-table-tools"><span>{filtered.length} {document ? 'documents' : 'records'}</span><div className="cp-table-filters"><label><Search size={17} /><input aria-label="Search table" placeholder={kind === 'po' ? 'Search purchase orders…' : kind === 'quotations' ? 'Search quotations…' : kind === 'pi' ? 'Search invoices…' : 'Search records…'} value={search} onChange={event => {
            setSearch(event.target.value);
            setPage(1);
          }} /></label>{kind === 'po' && <select aria-label="Financial year" value={fy} onChange={event => {
          setFy(event.target.value);
          setPage(1);
        }}><option value="">All financial years</option>{years.map(year => <option key={year}>{year}</option>)}</select>}</div></div>}
  <div className="cp-table-scroll"><table className="cp-table"><thead><tr>{columns.map(column => <th scope="col" key={column.label}>{column.label}</th>)}</tr></thead><tbody>{filtered.slice(start, start + 10).map((row, index) => <tr key={row._id || index}>{columns.map(column => <td key={column.label}>{column.render ? column.render(row, index) : readable(row[column.key])}</td>)}</tr>)}</tbody></table></div>
  {!filtered.length && <div className="cp-empty"><div className="cp-empty-art"><FileText size={48} />{kind === 'pi' ? <span>₹</span> : <FileText size={35} />}</div><strong>{search || fy ? 'No matching records' : empty}</strong><p>{search || fy ? 'Try another search term or financial year.' : `Your ${kind === 'pi' ? 'invoices' : kind === 'quotations' ? 'quotations' : 'records'} will appear here once shared by your account team.`}</p>{document && <Link className="cp-support-button" to="/client/info?section=services"><Mail size={17} />Contact account team</Link>}</div>}
  {(kind || filtered.length > 10) && <div className="cp-table-footer"><span>{filtered.length ? `Showing ${start + 1}–${Math.min(start + 10, filtered.length)} of ${filtered.length} ${kind === 'po' ? 'purchase orders' : 'documents'}` : `0 ${kind === 'pi' ? 'invoices' : kind === 'quotations' ? 'quotations' : 'records'}`}</span>{filtered.length > 0 && <div><button aria-label="Previous page" disabled={activePage === 1} onClick={() => setPage(activePage - 1)}><ChevronLeft size={17} /></button><span>{activePage}</span><button aria-label="Next page" disabled={activePage === pages} onClick={() => setPage(activePage + 1)}><ChevronRight size={17} /></button></div>}</div>}
  </div>;
}
function SupportBanner({
  kind
}) {
  return <div className="cp-support-banner"><span><HelpCircle size={26} /></span><div><h3>{kind === 'pi' ? 'Need help with an invoice?' : kind === 'po' ? 'Need help with a purchase order?' : 'Need assistance with a quotation?'}</h3><p>Your account team is here to help with your {kind === 'pi' ? 'invoice' : kind === 'po' ? 'purchase order' : 'quotation'} queries.</p></div><Link to="/client/info?section=services">Contact your account team <ArrowRight size={18} /></Link></div>;
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
  return <div className="cp cp-login-page"><header><Brand /></header><main className="cp-login-layout"><div className="cp-login-intro"><span className="cp-login-kicker"><Building2 size={19} />CLIENT WORKSPACE</span><h1>Your business.<br /><span>One clear view.</span></h1><p>See your company details, purchase orders, quotations and invoices. Connect with the team member handling your account.</p><div className="cp-login-benefits">{[[FileText, 'All your documents'], [Users, 'Dedicated support'], [LayoutDashboard, 'One workspace']].map(([Icon, title]) => <span key={title}><i><Icon size={23} /></i>{title}</span>)}</div><div className="cp-login-illustration" aria-hidden="true"><div className="cp-illustration-workspace"><img src="/ananttattva-logo.png" alt="" /><aside><span>Documents</span><span>Purchase orders</span><span>Quotations</span><span>Invoices</span></aside></div>{['Purchase Order', 'Quotation', 'Invoice'].map((title, index) => <div className={`cp-floating-document cp-floating-${index}`} key={title}><FileText /><strong>{title}</strong><small>Client workspace</small><i /><i /><i /><i /></div>)}</div></div><div className="cp-login-form-area"><form onSubmit={submit} className="cp-login-card"><span className="cp-login-user"><UserRound size={32} /></span><h2>Welcome back</h2><p>Sign in to your client workspace.</p><label>Contact email<div className="cp-email-input"><Mail size={21} /><input type="email" required maxLength={254} disabled={busy} autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com" /></div></label><small>Use the email registered with your company.</small>{error && <p role="alert" className="cp-error">{error}</p>}<button className="cp-login-submit" disabled={busy}>{busy ? 'Signing in…' : 'Open Dashboard'}<ArrowRight size={20} /></button></form><p className="cp-login-help"><HelpCircle size={20} />Need help? <a href="mailto:info@ananttattva.com">Contact support ↗</a></p></div></main><footer className="cp-login-footer"><span>© {new Date().getFullYear()} Anant Tattva. All rights reserved.</span><a href="mailto:info@ananttattva.com">Contact support</a></footer></div>;
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
  const [filePreview, setFilePreview] = useState(null);
  const closeFilePreview = useCallback(() => setFilePreview(null), []);
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
    render: row => row.fileUrl ? <button className="cp-action" onClick={() => setFilePreview({ url: row.fileUrl, name: row.fileName || row.poNumber || 'Purchase order', category: 'Purchase order' })}>View PO</button> : <span className="cp-badge cp-pending">Awaiting upload</span>
  }];
  const summary = data?.summary;
  return <div className="cp cp-portal"><header className="cp-topbar"><Brand /><div className="cp-breadcrumb">Client Portal <span>/</span> <strong>{tabs.find(([key]) => key === tab)?.[1]}</strong></div><div className="cp-topbar-account"><span className="cp-user-avatar"><UserRound size={16} /></span><span>{data?.email || 'Client account'}</span><button className="cp-button" onClick={logout}><LogOut size={15} />Sign out</button></div></header><div className="cp-shell"><aside className="cp-sidebar"><p className="cp-nav-label">CLIENT WORKSPACE</p><nav>{tabs.map(([key, title, Icon]) => <NavLink key={key} to={`/client/${key}`} className={({
            isActive
          }) => isActive ? 'active' : ''}><Icon size={18} /><span>{title}</span>{data && ['po', 'quotations', 'pi'].includes(key) && <small>{key === 'po' ? summary.purchaseOrders : key === 'pi' ? summary.invoices : summary.quotations}</small>}</NavLink>)}</nav><div className="cp-sidebar-bottom"><Building2 size={18} /><div><strong>{data?.clients?.[0]?.company || 'Your account'}</strong><span>Connected to Anant Tattva</span></div></div></aside><main className="cp-main"><div className="cp-page-heading"><div><p className="cp-eyebrow">ANANT TATTVA / CLIENT PORTAL</p><h1>{tab === 'dashboard' ? 'Account overview' : tabs.find(([key]) => key === tab)?.[1]}</h1><p>{tab === 'info' ? 'Your company, contacts, services and documents — clearly organised.' : 'Your company records, together in one place.'}</p></div><button className="cp-button" disabled={loading} onClick={load}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />{loading ? 'Updating…' : 'Refresh'}</button></div>{error && <p role="alert" className="cp-error">{error}</p>}{loading && !data && <div role="status" className="cp-loading">Loading your account…</div>}{data && <>
  {tab === 'dashboard' && <><div className="cp-stats">{[['Companies', summary.companies, 'info', Building2], ['Purchase orders', summary.purchaseOrders, 'po', FileText], ['Quotations', summary.quotations, 'quotations', FileText], ['Proforma invoices', summary.invoices, 'pi', FileText]].map(([title, value, target, Icon]) => <Link key={title} to={`/client/${target}`}><span className="cp-stat-icon"><Icon size={19} /></span><div><p>{title}</p><strong>{value}</strong></div><ArrowRight size={16} /></Link>)}</div><div className="cp-two-columns cp-dashboard-columns"><Section title="Your account team" description="Your points of contact at Anant Tattva."><div className="cp-team-grid">{data.clients.flatMap(client => handlingTeam(client).map((person, index) => <article className="cp-person" key={`${client._id}-${index}`}><span className="cp-avatar">{(person.name || 'AT').split(' ').map(word => word[0]).slice(0, 2).join('')}</span><div><h3>{person.name || 'Not assigned'}{person.contactNumber && <a className="cp-phone" href={`tel:${person.contactNumber.replace(/[^+0-9]/g, '')}`}>{person.contactNumber}</a>}</h3><p>{client.company}</p>{person.email && <a href={`mailto:${person.email}`}>{person.email}</a>}<small>{person.services.length} assigned service{person.services.length === 1 ? '' : 's'}</small></div></article>))}</div></Section><Section title="Document centre" description="Your shared quotations and invoices."><div className="cp-document-shortcuts"><Link to="/client/quotations"><FileText /><div><strong>Quotations</strong><small>{summary.quotations} shared documents</small></div><ArrowRight size={16} /></Link><Link to="/client/pi"><FileText /><div><strong>Proforma invoices</strong><small>{summary.invoices} issued invoices</small></div><ArrowRight size={16} /></Link></div></Section></div><Section title="Recent purchase orders" action={<Link className="cp-action" to="/client/po">View all →</Link>}><Table columns={poColumns} rows={data.purchaseOrders.slice(0, 5)} empty="No purchase orders yet" /></Section>{data.quotations.length > 0 && <Section title="Latest quotations"><Table columns={documentColumns} rows={data.quotations.slice(0, 5)} /></Section>}</>}
  {tab === 'info' && <div className="cp-stack">{data.clients.map(client => <ClientPortalInfo key={client._id} initialTab={new URLSearchParams(location.search).get('section') || 'overview'} client={client} onViewFile={setFilePreview} Table={Table} Section={Section} />)}</div>}
  {tab === 'po' && <><div className="cp-stats cp-po-stats">{[['Total purchase orders', summary.purchaseOrders, FileText], ['Uploaded files', summary.uploadedPurchaseOrders, Paperclip], ['Total order value', money(summary.poValue), Coins]].map(([title, value, Icon]) => <div className="cp-stat-card" key={title}><span className="cp-stat-icon"><Icon size={26} /></span><div><p>{title}</p><strong>{value}</strong></div></div>)}</div><Section title="All purchase orders" description={`${summary.purchaseOrders} records across your financial years`}><Table columns={poColumns} rows={data.purchaseOrders} kind="po" empty="No purchase orders yet" /></Section><SupportBanner kind="po" /></>}
  {(tab === 'quotations' || tab === 'pi') && <><Section title={tab === 'pi' ? 'Your proforma invoices' : 'Your quotations'} description={tab === 'pi' ? 'Issued invoices, organised in one place.' : 'All your shared quotations, in one place.'} action={<span className="cp-badge">{tab === 'pi' ? summary.invoices : summary.quotations} documents</span>}><Table columns={documentColumns} rows={tab === 'pi' ? data.invoices : data.quotations} kind={tab} empty={tab === 'pi' ? 'No proforma invoices shared yet' : 'No quotations shared yet'} /></Section><SupportBanner kind={tab} /></>}
  </>}<footer className="cp-footer"><span>© {new Date().getFullYear()} Anant Tattva. All rights reserved.</span><span>Anant Tattva · Client Portal</span></footer></main></div>{filePreview && <FilePreview file={filePreview} onClose={closeFilePreview} />}{document && <DocumentPreview row={document} onClose={() => setDocument(null)} />}</div>;
}
