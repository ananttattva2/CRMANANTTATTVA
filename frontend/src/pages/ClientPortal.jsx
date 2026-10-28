import React, { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ArrowRight, Building2, FileText, LayoutDashboard, LogOut, RefreshCw, ShieldCheck, UserRound, X } from 'lucide-react';
import api from '../services/api';
import { buildInvoicePdf } from '../utils/proformaPdf';
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
  return <div className="overflow-x-auto rounded-2xl border border-slate-200"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{columns.map(column => <th key={column.label} className="whitespace-nowrap px-5 py-4">{column.label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100 bg-white">{rows.map((row, index) => <tr key={row._id || index} className="align-top hover:bg-teal-50/40">{columns.map(column => <td key={column.label} className="max-w-md whitespace-pre-line px-5 py-4 text-slate-700">{column.render ? column.render(row, index) : readable(row[column.key])}</td>)}</tr>)}</tbody></table>{!rows.length && <p className="bg-white p-10 text-center text-sm text-slate-500">{empty}</p>}</div>;
}
function Section({
  title,
  children,
  description
}) {
  return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><h2 className="text-lg font-bold text-slate-900">{title}</h2>{description && <p className="mt-1 text-sm text-slate-500">{description}</p>}<div className="mt-5">{children}</div></section>;
}
export function ClientLogin() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const { data } = await clientApi.post('/login', { email })
      sessionStorage.setItem(sessionKey, data.token)
      navigate('/client/dashboard', { replace: true })
    } catch (error) { setError(errorText(error)) }
    finally { setBusy(false) }
  }
  return <div className="min-h-screen bg-[#f3faf9]"><header className="flex flex-wrap items-center justify-between gap-4 border-b bg-white px-6 py-4"><Brand /><Link to="/login" className="text-sm font-semibold text-slate-600">Staff Login</Link></header><main className="mx-auto grid max-w-6xl gap-12 px-6 py-16 lg:grid-cols-2 lg:items-center"><div><span className="inline-flex items-center gap-2 rounded-full bg-teal-100 px-4 py-2 text-xs font-bold uppercase tracking-widest text-teal-800"><Building2 className="h-4 w-4" />Client workspace</span><h1 className="mt-6 text-4xl font-bold leading-tight text-slate-900 sm:text-5xl">Your business.<br /><span className="text-teal-700">One clear view.</span></h1><p className="mt-5 max-w-md text-lg leading-relaxed text-slate-500">See your company details, purchase orders, quotations and invoices. Connect with the team member handling your account.</p><div className="mt-8 flex flex-wrap gap-3">{['Email login', 'Your documents', 'Your account SPOC'].map(value => <span key={value} className="rounded-xl border bg-white px-4 py-3 text-sm text-slate-600">{value}</span>)}</div></div><form onSubmit={submit} className="rounded-3xl border border-teal-100 bg-white p-8 shadow-xl shadow-teal-900/5"><div className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-teal-50 text-teal-700"><UserRound /></div><h2 className="text-2xl font-bold">Client Login</h2><p className="mt-2 text-sm leading-relaxed text-slate-500">Enter the email registered in your company’s Contact information to open your dashboard.</p><label className="mt-7 block text-sm font-semibold">Contact email<input type="email" required maxLength={254} disabled={busy} autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com" className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-4 disabled:bg-slate-50" /></label>{error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<button disabled={busy} className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-700 font-bold text-white hover:bg-teal-800 disabled:opacity-50">{busy ? 'Signing in…' : 'Login & Open Dashboard'}<ArrowRight className="h-4 w-4" /></button></form></main></div>
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
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3"><section role="dialog" aria-modal="true" aria-label="Document details" className="flex max-h-[94vh] min-h-[60vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white"><header className="flex items-center justify-between gap-3 border-b p-5"><div><h2 className="font-bold">{row.proformaNumber || row.quotationNumber}</h2><p className="text-sm text-slate-500">{row.companyName}</p></div><div className="flex gap-4">{row.kind === 'pi' && <button onClick={() => buildInvoicePdf(row).save(`${row.proformaNumber.replace(/[^a-z0-9-]/gi, '-')}.pdf`)} className="font-semibold text-teal-700">Download PDF</button>}<button aria-label="Close document" onClick={onClose}><X /></button></div></header>{row.kind === 'pi' ? <iframe title="Proforma Invoice" src={url || undefined} className="h-[76vh] w-full" /> : <div className="space-y-5 overflow-y-auto p-5"><Table columns={[{
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
  const spocColumns = [{
    label: 'Company',
    key: 'company'
  }, {
    label: 'Lead Code',
    key: 'leadCode'
  }, {
    label: 'SPOC / Handling User',
    render: row => row.spoc?.name || 'Not assigned'
  }, {
    label: 'SPOC Email',
    render: row => row.spoc?.email ? <a className="text-teal-700" href={`mailto:${row.spoc.email}`}>{row.spoc.email}</a> : '—'
  }];
  const documentColumns = [{
    label: 'Number',
    render: row => row.proformaNumber || row.quotationNumber
  }, {
    label: 'Company',
    key: 'companyName'
  }, {
    label: 'Date',
    render: row => date(row.invoiceDate || row.quotationDate)
  }, {
    label: 'Valid Until',
    render: row => date(row.validUntil)
  }, {
    label: 'Amount',
    render: row => money(row.grandTotal)
  }, {
    label: 'Status',
    key: 'status'
  }, {
    label: 'Details',
    render: row => <button onClick={() => setDocument(row)} className="font-semibold text-teal-700">View {row.kind === 'pi' ? '/ Download' : 'Quotation'}</button>
  }];
  return <div className="min-h-screen bg-[#f4f8fa]"><header className="flex flex-wrap items-center justify-between gap-4 border-b bg-white px-5 py-4"><Brand /><div className="flex items-center gap-4"><span className="hidden text-sm text-slate-500 sm:block">{data?.email}</span><button onClick={logout} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold"><LogOut className="h-4 w-4" />Sign Out</button></div></header><div className="mx-auto flex max-w-[1800px] flex-col lg:flex-row"><aside className="shrink-0 border-b bg-white p-4 lg:min-h-[calc(100vh-81px)] lg:w-64 lg:border-r"><p className="mb-4 px-3 text-[10px] font-bold uppercase tracking-[.2em] text-slate-400">Your workspace</p><nav className="flex gap-2 overflow-x-auto lg:flex-col">{tabs.map(([key, title, Icon]) => <NavLink key={key} to={`/client/${key}`} className={({
            isActive
          }) => `flex items-center gap-3 whitespace-nowrap rounded-xl px-4 py-3 text-sm font-semibold ${isActive ? 'bg-teal-700 text-white' : 'text-slate-500 hover:bg-teal-50'}`}><Icon className="h-4 w-4" />{title}</NavLink>)}</nav><div className="mt-8 hidden rounded-2xl bg-teal-50 p-4 text-xs leading-relaxed text-teal-800 lg:block"><ShieldCheck className="mb-2 h-5 w-5" />Your company records, securely connected to your registered contact email.</div></aside><main className="min-w-0 flex-1 space-y-6 p-5 sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-teal-700">Client workspace</p><h1 className="mt-2 text-3xl font-bold text-slate-900">{tabs.find(([key]) => key === tab)?.[1]}</h1><p className="mt-2 text-sm text-slate-500">{tab === 'dashboard' ? 'Your account, documents and team at a glance.' : 'Your latest records from Anant Tattva.'}</p></div><button disabled={loading} onClick={load} className="flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button></div>{error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</p>}{loading && !data && <p role="status" className="rounded-2xl bg-white p-10 text-center text-slate-500">Loading your client records…</p>}{data && <>
    {tab === 'dashboard' && <><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[['Companies', data.summary.companies, 'info'], ['POs Uploaded', data.summary.uploadedPurchaseOrders, 'po'], ['Quotations', data.summary.quotations, 'quotations'], ['Proforma Invoices', data.summary.invoices, 'pi']].map(([title, value, target]) => <Link key={title} to={`/client/${target}`} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-teal-400"><p className="text-sm text-slate-500">{title}</p><strong className="mt-3 block text-3xl text-slate-900">{value}</strong><span className="mt-3 block text-xs font-semibold text-teal-700">View details →</span></Link>)}</div><div className="rounded-2xl bg-teal-800 p-6 text-white"><p className="text-sm text-teal-100">Purchase order overview</p><strong className="mt-2 block text-2xl">{data.summary.uploadedPurchaseOrders} uploaded / {data.summary.purchaseOrders} recorded</strong><p className="mt-2 text-sm text-teal-100">Total recorded PO value: {money(data.summary.poValue)}</p></div><Section title="Your account team" description="The user handling each company and its services."><Table columns={spocColumns} rows={data.clients} /></Section><Section title="Latest quotations"><Table columns={documentColumns} rows={data.quotations.slice(0, 5)} /></Section></>}
    {tab === 'info' && data.clients.map(client => <Section key={client._id} title={client.company} description={`Lead code: ${client.leadCode || '—'}`}><div className="space-y-6"><Table columns={[{
                label: 'Field',
                key: 'field'
              }, {
                label: 'Details',
                key: 'value'
              }]} rows={Object.entries(client).filter(([key]) => !['_id', 'contacts', 'addresses', 'services', 'assignments', 'spoc', 'clientMaster'].includes(key)).map(([key, value]) => ({
                field: label(key),
                value
              }))} /><h3 className="font-bold">Contact Information</h3><Table columns={[{
                label: 'Unit',
                key: 'plantUnit'
              }, {
                label: 'Contact Person',
                key: 'contactPerson'
              }, {
                label: 'Designation',
                key: 'designation'
              }, {
                label: 'Email',
                render: row => row.emails || row.email || '—'
              }, {
                label: 'Mobile',
                key: 'mobileNo1'
              }, {
                label: 'Alternate Mobile',
                key: 'mobileNo2'
              }, {
                label: 'WhatsApp',
                key: 'whatsappNo'
              }]} rows={client.contacts} /><h3 className="font-bold">Locations</h3><Table columns={[{
                label: 'Unit',
                render: row => row.unitName || row.plantUnit || row.unit || '—'
              }, {
                label: 'Address',
                render: row => [row.addressLine1, row.addressLine2, row.addressLine3, row.landmark].filter(Boolean).join(', ')
              }, {
                label: 'City',
                key: 'city'
              }, {
                label: 'State',
                key: 'state'
              }, {
                label: 'PIN',
                key: 'pinCode'
              }, {
                label: 'GST',
                key: 'gstNumber'
              }]} rows={client.addresses} /><h3 className="font-bold">Services</h3><Table columns={[{
                label: 'Service',
                render: row => row.serviceCategory || row.eprCategory || '—'
              }, {
                label: 'Services Offered',
                key: 'servicesOffered'
              }, {
                label: 'Applicant Type',
                key: 'applicantType'
              }, {
                label: 'Sub Applicant Type',
                key: 'subApplicantType'
              }]} rows={client.services} /><h3 className="font-bold">SPOC / Handling Users</h3><Table columns={[{
                label: 'Service',
                render: row => row.serviceCategory || row.eprCategory || row.servicesOffered || 'Account'
              }, {
                label: 'Handling User',
                render: row => row.spoc?.name || 'Not assigned'
              }, {
                label: 'Email',
                render: row => row.spoc?.email || '—'
              }, {
                label: 'PO Status',
                key: 'poStatus'
              }]} rows={client.assignments.length ? client.assignments : [{
                spoc: client.spoc
              }]} />{client.clientMaster.length > 0 && <><h3 className="font-bold">Client Master Details</h3><Table columns={[{
                  label: 'Field',
                  key: 'field'
                }, {
                  label: 'Details',
                  key: 'value'
                }]} rows={client.clientMaster.flatMap((record, index) => Object.entries(record).filter(([key]) => key !== 'id').map(([key, value]) => ({
                  field: `${client.clientMaster.length > 1 ? `${index + 1}. ` : ''}${label(key)}`,
                  value
                })))} /></>}</div></Section>)}
    {tab === 'po' && <Section title="Purchase orders" description={`${data.summary.uploadedPurchaseOrders} files uploaded across ${data.summary.purchaseOrders} PO records.`}><Table columns={[{
              label: 'PO Number',
              key: 'poNumber'
            }, {
              label: 'Company',
              key: 'company'
            }, {
              label: 'Financial Year',
              key: 'financialYear'
            }, {
              label: 'PO Date',
              render: row => date(row.date)
            }, {
              label: 'Amount',
              render: row => money(row.amount)
            }, {
              label: 'Services',
              key: 'services'
            }, {
              label: 'Quotation',
              key: 'quotationNumber'
            }, {
              label: 'SPOC',
              render: row => row.spoc?.name || '—'
            }, {
              label: 'PO File',
              render: row => row.fileUrl ? <a href={row.fileUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-teal-700">View PO ↗</a> : <span className="text-amber-700">Awaiting upload</span>
            }]} rows={data.purchaseOrders} /></Section>}
    {(tab === 'quotations' || tab === 'pi') && <Section title={tab === 'pi' ? 'Proforma invoices' : 'Quotations'} description="Documents shared with your company."><Table columns={documentColumns} rows={tab === 'pi' ? data.invoices : data.quotations} /></Section>}
  </>}</main></div>{document && <DocumentPreview row={document} onClose={() => setDocument(null)} />}</div>;
}
