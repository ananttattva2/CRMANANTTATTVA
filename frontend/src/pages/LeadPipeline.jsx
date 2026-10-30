import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BarChart3, CheckCircle2, Download, Flame, RefreshCw, Search, Snowflake, Users, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import DashboardShell from '../components/dashboard/DashboardShell';
import LeadRevenuePanel, { revenueMoney } from '../components/leads/LeadRevenuePanel';
import useCrmRefresh from '../hooks/useCrmRefresh';
import api from '../services/api';
import '../styles/lead-pipeline.css';

export default function LeadPipeline() {
  const [currentUser, setCurrentUser] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [owner, setOwner] = useState('');
  const [selection, setSelection] = useState(null);
  const [revenueRow, setRevenueRow] = useState(null);
  const [closeRow, setCloseRow] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [closing, setClosing] = useState(false);
  const [modalError, setModalError] = useState('');
  const dialog = useRef(null);
  const sequence = useRef(0);
  async function load() {
    const version = ++sequence.current;
    try {
      const [me, result] = await Promise.all([api.get('/auth/me'), api.get('/leads/pipeline-revenue')]);
      if (version !== sequence.current) return;
      setCurrentUser(me.data.user); setRows(result.data.rows || []); setError('');
    } catch (e) { if (version === sequence.current) setError(e.response?.data?.error || 'Unable to load pipeline.'); }
    finally { if (version === sequence.current) setLoading(false); }
  }
  useEffect(() => { void load(); return () => { sequence.current++; }; }, []);
  useCrmRefresh(load);
  useEffect(() => {
    if (selection && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!selection && dialog.current?.open) dialog.current.close();
  }, [selection]);
  const filtered = useMemo(() => rows.filter(r => (!owner || r.owner === owner) && `${r.company} ${r.code} ${r.owner}`.toLowerCase().includes(query.trim().toLowerCase())), [rows, query, owner]);
  const listed = selection ? filtered.filter(r => (!selection.kind || r.kind === selection.kind) && (!selection.state || r.state === selection.state)) : [];
  const total = source => source.reduce((n, r) => n + r.revenuePaise, 0);
  function open(kind = '', state = '') { setRevenueRow(null); setCloseRow(null); setModalError(''); setSelection({ kind, state }); }
  function exportRows(source, name) {
    const data = source.flatMap(r => (r.groups.length ? r.groups : [{ amountPaise: 0, contributions: [] }]).map((g, i) => ({
      'Lead ID': r.code, Company: r.company, Category: `${r.kind === 'hot' ? 'Hot' : 'Cold'} Lead`, Status: r.state, Owner: r.owner,
      Services: r.serviceCount, 'Revenue Group': r.groups.length ? i + 1 : 'Not recorded', 'Group Revenue (INR)': g.amountPaise / 100,
      'Lead Total (INR)': i === 0 ? r.revenuePaise / 100 : '', 'Contributions': g.contributions.length,
      'Recorded By': [...new Set(g.contributions.map(c => c.createdByName))].join(', ')
    })));
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(data);
    sheet['!cols'] = [{ wch: 20 }, { wch: 42 }, { wch: 16 }, { wch: 12 }, { wch: 25 }, { wch: 12 }, { wch: 18 }, { wch: 24 }, { wch: 24 }, { wch: 18 }, { wch: 35 }];
    XLSX.utils.book_append_sheet(book, sheet, 'Lead Pipeline');
    XLSX.writeFile(book, `${name}.xlsx`);
  }
  async function closeCold() {
    if (!closeRow || !remarks.trim() || closing) return;
    setClosing(true); setModalError('');
    try {
      await api.post(`/leads/revenue/cold/${closeRow.id}/close`, { remarks });
      setCloseRow(null); setRemarks(''); await load();
    } catch (e) { setModalError(e.response?.data?.error || 'Unable to close cold lead.'); }
    finally { setClosing(false); }
  }
  return <DashboardShell currentUser={currentUser}><div className="pipeline-page">
    <header className="pipeline-header"><div><p className="pipeline-eyebrow">SALES INTELLIGENCE</p><h1>Open &amp; Closed Leads</h1><p>A clear view of your hot and cold pipeline, with locked revenue history.</p></div><div className="pipeline-toolbar"><button type="button" onClick={() => { setLoading(true); void load(); }} aria-label="Refresh pipeline"><RefreshCw size={16}/></button><button type="button" onClick={() => exportRows(filtered, 'lead-pipeline')} disabled={loading || !filtered.length}><Download size={16}/>Export Excel</button></div></header>
    <div className="pipeline-filters"><label><Search size={17}/><input aria-label="Search pipeline" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search company, lead ID or owner…"/></label><select aria-label="Filter by owner" value={owner} onChange={e => setOwner(e.target.value)}><option value="">All visible owners</option>{[...new Set(rows.map(r => r.owner))].sort().map(name => <option key={name}>{name}</option>)}</select><span><Users size={15}/>{filtered.length} visible leads</span></div>
    {error && <p role="alert" className="pipeline-error">{error}</p>}
    {loading ? <div role="status" className="pipeline-empty">Loading your lead pipeline…</div> : <>
      <button type="button" onClick={() => open()} className="pipeline-root"><span className="pipeline-root-icon"><BarChart3 size={28}/></span><span><small>COMPLETE PIPELINE</small><strong>Open &amp; Closed Leads</strong><span>{filtered.length} leads · {revenueMoney(total(filtered))} estimated revenue</span></span><ArrowUpRight size={20}/></button>
      <div className="pipeline-branches">{['hot', 'cold'].map(kind => {
        const source = filtered.filter(r => r.kind === kind);
        const Icon = kind === 'hot' ? Flame : Snowflake;
        return <section key={kind} className={`pipeline-branch ${kind}`}>
          <button type="button" onClick={() => open(kind)} className="pipeline-category"><div><p>{kind === 'hot' ? 'HIGH PRIORITY' : 'NURTURE PIPELINE'}<span>{source.length} leads</span></p><h2>{kind === 'hot' ? 'Hot Leads' : 'Cold Leads'}</h2><strong>{revenueMoney(total(source))}</strong><small>Total estimated revenue</small></div><span className="pipeline-category-icon"><Icon size={43}/></span></button>
          <div className="pipeline-states">{['open', 'closed'].map(state => { const items = source.filter(r => r.state === state); return <button type="button" key={state} onClick={() => open(kind, state)} className={`pipeline-state ${state}`}><span><i/>{state === 'open' ? 'Open + Revenue' : 'Closed + Revenue'}<ArrowUpRight size={19}/></span><strong>{revenueMoney(total(items))}</strong><small>{state === 'closed' ? <CheckCircle2 size={18}/> : <Users size={18}/>}<b>{items.length}</b> {state} leads</small></button>; })}</div>
        </section>;
      })}</div>
      <p className="pipeline-note">Amounts are estimated revenue, not invoices or payments. Leads with no recorded estimate show ₹0. Converted cold leads move into Hot Leads; existing estimates carry forward without double counting. A hot lead is closed when all its services are closed.</p>
    </>}
    <dialog ref={dialog} className="pipeline-dialog" onCancel={() => setSelection(null)} onClose={() => setSelection(null)}>
      {selection && <><header><div><p className="pipeline-eyebrow">PIPELINE DETAILS</p><h2>{selection.kind ? `${selection.kind === 'hot' ? 'Hot' : 'Cold'} Leads` : 'All Leads'}{selection.state ? ` · ${selection.state === 'open' ? 'Open' : 'Closed'}` : ''}</h2><p>{listed.length} leads · {revenueMoney(total(listed))} estimated revenue</p></div><div className="pipeline-toolbar"><button type="button" onClick={() => exportRows(listed, 'pipeline-details')} disabled={!listed.length}><Download size={16}/>Excel</button><button type="button" onClick={() => setSelection(null)} aria-label="Close lead list"><X/></button></div></header>
      <div className="pipeline-dialog-body"><div className="pipeline-table-wrap"><table><thead><tr>{['Lead / Company', 'Category', 'Status', 'Owner', 'Services', 'Revenue groups', 'Total revenue', 'Actions'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{listed.map(r => <tr key={`${r.kind}-${r.id}`}><td><b>{r.company}</b><small>{r.code}</small></td><td>{r.kind === 'hot' ? 'Hot' : 'Cold'}</td><td><span className={`pipeline-badge ${r.state}`}>{r.state}</span></td><td>{r.owner}</td><td>{r.serviceCount || '—'}</td><td>{r.groups.length ? r.groups.map((g, i) => <span key={g.id} className="pipeline-group">#{i + 1} {revenueMoney(g.amountPaise)}</span>) : <span className="text-slate-400">Not recorded</span>}</td><td className="font-black">{revenueMoney(r.revenuePaise)}</td><td><button type="button" onClick={() => { setRevenueRow(r); setCloseRow(null); }}>Revenue history</button>{r.kind === 'cold' && r.state === 'open' && <button type="button" onClick={() => { setCloseRow(r); setRevenueRow(null); setRemarks(''); setModalError(''); }}>Close cold lead</button>}</td></tr>)}</tbody></table>{!listed.length && <p className="pipeline-empty">No leads in this category.</p>}</div>
        {revenueRow && <section className="mt-4"><h3 className="font-black">{revenueRow.company} · Revenue</h3><LeadRevenuePanel key={`${revenueRow.kind}-${revenueRow.id}`} kind={revenueRow.kind} leadId={revenueRow.id} onSaved={load}/></section>}
        {closeRow && <section className="mt-5 rounded-2xl border bg-slate-50 p-5"><h3 className="font-black">Close cold lead: {closeRow.company}</h3><p className="mt-2 text-sm text-slate-500">This moves the lead to Closed Cold Leads and locks its estimate. It does not convert it to a Hot Lead.</p><label className="mt-3 block text-sm font-bold">Closing remarks<textarea value={remarks} onChange={e => setRemarks(e.target.value)} maxLength={1000} className="mt-2 block w-full rounded-xl border bg-white p-3"/></label><button type="button" disabled={closing || !remarks.trim()} onClick={closeCold} className="mt-3 rounded-xl bg-emerald-800 px-4 py-3 font-bold text-white disabled:opacity-40">{closing ? 'Closing…' : 'Confirm close'}</button><button type="button" onClick={() => setCloseRow(null)} className="ml-3">Cancel</button></section>}
        {modalError && <p role="alert" className="pipeline-error">{modalError}</p>}
      </div></>}
    </dialog>
  </div></DashboardShell>;
}
