import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X, ShieldCheck, RefreshCw } from 'lucide-react';
import api from '../../services/api';
import { loadFullQuotation } from '../../utils/quotationDetail.mjs';
import creditPricing from '../../../../shared/eprCreditPricing.cjs';
const money = value => Number(value || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
const slab = item => item.creditRateBand === 'above100' ? 'Above 100 MT' : 'Up to 100 MT';
const headings = ['Sr.No', 'Industry', 'Business Category', 'Service Category', 'Services Offered', 'Applicant', 'EPR / Service Period', 'EPR Credit Years', 'Service Start', 'Service End', 'Registration Year', 'Added By', 'UOM', 'Unit', 'Unit Name', 'Basic Amount (INR / kg)', 'Expected Target', 'Requested Amount (INR / kg)'];
function FinalAmount({ change, value, onChange, status }) {
  if (!onChange) return <strong className="text-teal-800">{change.finalAmount != null ? money(change.finalAmount) : status === 'APPROVED' ? money(change.requestedAmount) : '—'}</strong>;
  return <input aria-label={`Final amount for item ${change.itemIndex + 1}`} type="number" min="0" max="1000000000" step="0.01" value={value ?? ''} onChange={event => onChange(change.itemIndex, event.target.value)} placeholder="Enter final amount" className="h-11 w-40 rounded-xl border border-teal-200 bg-white px-3 font-bold text-teal-900 outline-none transition focus:ring-4 focus:ring-teal-100"/>;
}
function CreditRows({ rows, amounts, setAmount, showFinal = false, finalAmounts = {}, onFinalAmount, status }) {
  const columns = showFinal ? [...headings, 'Final Amount (INR / kg)'] : headings;
  return <div className="max-h-[52vh] overflow-auto rounded-2xl border border-slate-200"><table className="w-full min-w-[1850px] text-left text-xs"><thead className="sticky top-0 z-10 bg-slate-100 text-[10px] uppercase tracking-wide text-slate-600"><tr>{columns.map((heading, index) => <th key={heading} scope="col" className={`whitespace-nowrap px-4 py-4 ${index === columns.length - 1 ? 'sticky right-0 bg-violet-100 text-violet-900' : ''}`}>{heading}</th>)}</tr></thead><tbody>{rows.map(row => {
    const item = row.item;
    const values = [row.itemIndex + 1, item.industryType, item.businessCategory, item.eprCategory || item.serviceCategory, item.servicesOffered || item.applicableService, item.piboCategory || item.applicantType, item.financialYear || `${item.servicePeriod || 1} ${item.periodUnit || 'days'}`, (item.annualReturnEprCreditYears || []).join(', '), item.serviceStartDate, item.serviceEndDate, item.registrationYear, item.serviceAddedBy, item.unitLabel, item.unit, item.unitName];
    return <tr key={row.itemIndex} className="border-t border-slate-100 transition hover:bg-teal-50/50">{values.map((value, index) => <td key={index} className="px-4 py-4 text-slate-700">{value || '—'}</td>)}<td className="px-4 py-4 font-bold">{money(row.currentAmount)}</td><td className="whitespace-nowrap px-4 py-4">{slab(item)}</td><td className={`${showFinal ? '' : 'sticky right-0'} bg-violet-50 px-4 py-4`}>{setAmount ? <input aria-label={`Requested amount for item ${row.itemIndex + 1}`} type="number" required min="0" max="1000000000" step="0.01" value={amounts[row.itemIndex] ?? ''} onChange={e => setAmount(row.itemIndex, e.target.value)} className="h-11 w-40 rounded-xl border border-violet-200 bg-white px-3 font-bold text-violet-900 outline-none focus:ring-4 focus:ring-violet-100" /> : <strong className="text-violet-800">{money(row.requestedAmount)}</strong>}</td>{showFinal && <td className="sticky right-0 bg-teal-50 px-4 py-4"><FinalAmount change={row} value={finalAmounts[row.itemIndex]} onChange={onFinalAmount} status={status}/></td>}</tr>;
  })}</tbody></table></div>;
}
export function CreditRateRequestModal({ quotation, onClose, onSubmitted }) {
  const rows = (quotation.items || []).map((item, itemIndex) => ({ item, itemIndex, currentAmount: Number(item.basicAmount) || 0 })).filter(row => creditPricing.isCredit(row.item));
  const [amounts, setAmounts] = useState(() => Object.fromEntries(rows.map(row => [row.itemIndex, String(row.currentAmount)])));
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const closeRef = useRef(null); const reduced = useReducedMotion();
  useEffect(() => {
    const active = document.activeElement; const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; closeRef.current?.focus();
    return () => { document.body.style.overflow = overflow; active?.focus?.(); };
  }, []);
  async function submit(event) {
    event.preventDefault();setBusy(true);setError('');
    try {
      await api.post(`/quotations/${quotation._id || quotation.id}/credit-rate-requests`, { changes: rows.map(row => ({ itemIndex: row.itemIndex, requestedAmount: amounts[row.itemIndex] })) });
      onSubmitted();
    } catch (e) { setError(e.response?.data?.error || 'Unable to submit this credit request. Please retry.'); } finally {setBusy(false);}
  }
  return createPortal(<AnimatePresence><motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .18 }} className="fixed inset-0 z-[10020] grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm" onKeyDown={event => {
    if (event.key === 'Escape' && !busy) onClose();
    if (event.key === 'Tab') { const elements = [...event.currentTarget.querySelectorAll('button:not(:disabled),input:not(:disabled)')]; const first = elements[0]; const last = elements.at(-1); if (event.shiftKey && document.activeElement === first) {event.preventDefault();last?.focus();} else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first?.focus();} }
  }}><motion.form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="credit-request-title" initial={{ y: reduced ? 0 : 18, scale: reduced ? 1 : .98 }} animate={{ y: 0, scale: 1 }} transition={{ duration: reduced ? 0 : .22 }} className="flex max-h-[92vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-3xl border border-violet-100 bg-white shadow-2xl">
    <header className="flex items-start justify-between gap-4 border-b border-violet-100 bg-gradient-to-r from-violet-50 to-teal-50 p-6"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-violet-700">EPR Credit • Rate review</p><h2 id="credit-request-title" className="mt-2 text-xl font-bold text-slate-900">Request for Credit Change</h2><p className="mt-1 text-sm text-slate-600">{quotation.quotationNumber} · {quotation.companyName || quotation.leadDetails?.companyName}</p></div><button ref={closeRef} type="button" aria-label="Close credit request" disabled={busy} onClick={onClose} className="rounded-xl border bg-white p-2 transition hover:bg-violet-50"><X size={20} /></button></header>
    <div className="space-y-4 overflow-auto p-6"><div className="flex items-center gap-3 rounded-xl bg-teal-50 p-4 text-sm text-teal-800"><ShieldCheck className="shrink-0" size={20} /><p>Enter the requested per-kg rate. The quotation rate updates after approval.</p></div>{error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p>}<CreditRows rows={rows} amounts={amounts} setAmount={(index, amount) => setAmounts(current => ({ ...current, [index]: amount }))} /></div>
    <footer className="flex justify-end gap-3 border-t bg-slate-50 p-5"><button type="button" disabled={busy} onClick={onClose} className="rounded-xl border bg-white px-5 py-3 text-sm font-bold">Cancel</button><button disabled={busy || !rows.length} className="rounded-xl bg-violet-700 px-6 py-3 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:bg-violet-800 disabled:opacity-50">{busy ? 'Submitting…' : 'Submit Credit Request'}</button></footer>
  </motion.form></motion.div></AnimatePresence>,document.body);
}
function CreditRequestLoading({ source, error, onClose, onRetry }) {
  const closeRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement; const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; closeRef.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus?.(); };
  }, []);
  return createPortal(<div className="fixed inset-0 z-[10020] grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="credit-loading-title" className="w-full max-w-lg overflow-hidden rounded-3xl border border-violet-100 bg-white shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b bg-gradient-to-r from-violet-50 to-teal-50 p-6"><div><h2 id="credit-loading-title" className="text-lg font-bold text-slate-900">Request for Credit Change</h2><p className="mt-1 text-sm text-slate-500">{source.quotationNumber}</p></div><button ref={closeRef} aria-label="Close credit request" type="button" onClick={onClose} className="rounded-xl border bg-white p-2"><X size={20}/></button></header>
      <div className="p-8">{error ? <div><p role="alert" className="text-sm text-red-700">{error}</p><button type="button" onClick={onRetry} className="mt-4 rounded-xl bg-violet-700 px-5 py-3 text-sm font-bold text-white">Retry</button></div> : <p role="status" className="flex items-center gap-3 text-sm font-bold text-violet-800"><RefreshCw size={20} className="animate-spin"/>Loading EPR Credit quotation items…</p>}</div>
    </section>
  </div>, document.body);
}
export function CreditRateRequestLoader({ source, onClose, onSubmitted }) {
  const [state, setState] = useState({ quotation: null, error: '' });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setState({ quotation: null, error: '' });
    const timer = setTimeout(() => { if (!active) return; active = false; controller.abort(); setState({ quotation: null, error: 'Quotation details took too long to load. Please retry.' }); }, 15000);
    loadFullQuotation(source, id => api.get(`/quotations/${id}`, { signal: controller.signal })).then(quotation => {
      if (!active) return;
      clearTimeout(timer);setState({ quotation, error: '' });
    }).catch(error => {
      if (!active) return;
      clearTimeout(timer);setState({ quotation: null, error: error.response?.data?.error || 'Unable to load EPR Credit quotation items. Please retry.' });
    });
    return () => { active = false; clearTimeout(timer);controller.abort(); };
  }, [source, retry]);
  return state.quotation ? <CreditRateRequestModal quotation={state.quotation} onClose={onClose} onSubmitted={onSubmitted}/> : <CreditRequestLoading source={source} error={state.error} onClose={onClose} onRetry={() => setRetry(value => value + 1)}/>;
}
function CreditDecisionDialog({ decision, busy, onCancel, onConfirm }) {
  const ref = useRef(null); const reduced = useReducedMotion();
  useEffect(() => {
    const previous = document.activeElement; const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';ref.current?.focus();
    return () => { document.body.style.overflow = overflow;previous?.focus?.(); };
  }, []);
  const approving = decision.status === 'APPROVED';
  return createPortal(<motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{duration:reduced?0:.18}} className="fixed inset-0 z-[10030] grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm" onKeyDown={event => {
    if(event.key==='Escape'&&!busy)onCancel();
    if(event.key==='Tab'){const buttons=[...event.currentTarget.querySelectorAll('button:not(:disabled)')];if(event.shiftKey&&document.activeElement===buttons[0]){event.preventDefault();buttons.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===buttons.at(-1)){event.preventDefault();buttons[0]?.focus();}}
  }}><section role="alertdialog" aria-modal="true" aria-label="Confirm credit decision" aria-describedby="credit-final-message" className="w-full max-w-xl overflow-hidden rounded-3xl border border-teal-100 bg-white shadow-2xl">
    <header className="bg-gradient-to-r from-teal-50 to-violet-50 p-6"><h3 className="text-lg font-bold text-slate-900">{approving?'Confirm final credit amounts':'Reject credit request'}</h3><p className="mt-1 text-sm text-slate-500">{decision.row.quotationNumber}</p></header>
    <div className="space-y-4 p-6"><p id="credit-final-message" className="text-sm font-bold text-slate-700">{approving?(decision.missing.length?'Aapne kuch rows ka Final Amount nahi dala hai. Kya aap un rows ke Requested Amount ke saath proceed karna chahte hain?':'Ye Final Amount quotation mein apply honge. Kya aap approve karna chahte hain?'):'Reject this credit request? Quotation amounts will stay unchanged.'}</p>
    {approving&&<div className="max-h-64 overflow-auto rounded-xl border border-slate-200">{decision.row.changes.map(change=>{const final=decision.finalAmounts.find(value=>value.itemIndex===change.itemIndex);return <div key={change.itemIndex} className="flex items-center justify-between gap-4 border-b px-4 py-3 last:border-0"><span className="text-xs text-slate-600">#{change.itemIndex+1} · {change.item.servicesOffered}</span><span className="text-right"><strong className="block text-sm text-teal-800">{money(final?final.amount:change.requestedAmount)} / kg</strong><small className="text-[10px] text-slate-500">{final?'Final Amount':'Requested Amount · blank final'}</small></span></div>;})}</div>}</div>
    <footer className="flex justify-end gap-3 border-t bg-slate-50 p-5"><button ref={ref} disabled={busy} onClick={onCancel} className="rounded-xl border bg-white px-5 py-3 text-sm font-bold">Cancel</button><button disabled={busy} onClick={onConfirm} className="rounded-xl bg-teal-700 px-6 py-3 text-sm font-bold text-white transition hover:bg-teal-800 disabled:opacity-50">{busy?'Saving…':'Confirm'}</button></footer>
  </section></motion.div>,document.body);
}
export default function CreditRateApprovals({ onCountChange }) {
  const [rows,setRows]=useState([]);const [canDecide,setCanDecide]=useState(false);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState('');const [error,setError]=useState('');const [filter,setFilter]=useState('PENDING');const [selected,setSelected]=useState(null);const [decision,setDecision]=useState(null);const [finalAmounts,setFinalAmounts]=useState({});
  async function load(){setLoading(true);setError('');try{const{data}=await api.get('/quotations/credit-rate-requests');setRows(data.requests||[]);setCanDecide(data.canDecide===true);onCountChange?.((data.requests||[]).filter(row=>row.status==='PENDING').length);}catch(e){setError(e.response?.data?.error||'Unable to load EPR Credit approvals.');}finally{setLoading(false);}}
  useEffect(()=>{load();},[]);
  function setFinal(requestId,itemIndex,amount){setFinalAmounts(current=>({...current,[requestId]:{...current[requestId],[itemIndex]:amount}}));}
  function beginDecision(row,status){
    setError('');const values=[];const missing=[];
    if(status==='APPROVED')for(const change of row.changes){const raw=finalAmounts[row.id]?.[change.itemIndex];if(raw==null||String(raw).trim()===''){missing.push(change.itemIndex);continue;}const amount=Number(raw);if(!Number.isFinite(amount)||amount<0||amount>1e9){setError(`Item ${change.itemIndex+1}: enter a valid Final Amount.`);return;}values.push({itemIndex:change.itemIndex,amount:Math.round(amount*100)/100});}
    setDecision({row,status,finalAmounts:values,missing});
  }
  async function decide(){const{row,status}=decision;setBusy(row.id);setError('');try{await api.patch(`/quotations/${row.quotationId}/credit-rate-requests/${row.id}/decision`,{decision:status,...(status==='APPROVED'?{finalAmounts:decision.finalAmounts,useRequestedAmounts:decision.missing.length>0}:{})});setDecision(null);setSelected(null);setFinalAmounts(current=>{const next={...current};delete next[row.id];return next;});await load();}catch(e){setDecision(null);setError(e.response?.data?.error||'Unable to save this decision.');}finally{setBusy('');}}
  const visible=rows.filter(row=>filter==='ALL'||row.status===filter);
  return <section className="space-y-4 p-4 sm:p-6"><header className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-lg font-bold text-slate-900">EPR Credit rate requests</h2><p className="mt-1 text-xs text-slate-500">Super Admins and {creditPricing.approverEmail} can enter final amounts and approve or reject requests.</p></div><button onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-bold text-teal-800"><RefreshCw size={16} className={loading?'animate-spin':''}/>Refresh</button></header>
    <div className="flex flex-wrap gap-2">{['PENDING','APPROVED','REJECTED','ALL'].map(status=><button key={status} onClick={()=>setFilter(status)} className={`rounded-full border px-4 py-2 text-xs font-bold transition ${filter===status?'border-violet-700 bg-violet-700 text-white':'bg-white text-slate-600 hover:bg-violet-50'}`}>{status} {status==='ALL'?rows.length:rows.filter(row=>row.status===status).length}</button>)}</div>
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    <div className="overflow-auto rounded-2xl border border-slate-200"><table className="w-full min-w-[1150px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr>{['Company / Quotation','Requested by','Service / Expected Target','Current rate','Requested amount','Final amount','Status','Actions'].map(title=><th key={title} className="px-4 py-4">{title}</th>)}</tr></thead><tbody>{visible.map(row=><tr key={row.id} className="border-t transition hover:bg-violet-50/30"><td className="px-4 py-4"><strong className="block text-slate-900">{row.companyName}</strong><span className="mt-1 block text-teal-700">{row.quotationNumber}</span></td><td className="px-4 py-4">{row.requestedByName}<small className="mt-1 block text-slate-400">{row.requestedByEmail}</small></td><td className="px-4 py-4">{row.changes.map(change=><p key={change.itemIndex} className="py-1">{change.item.servicesOffered} · {slab(change.item)}</p>)}</td><td className="px-4 py-4">{row.changes.map(change=><p key={change.itemIndex} className="py-1">{money(change.currentAmount)} / kg</p>)}</td><td className="px-4 py-4 font-bold text-violet-800">{row.changes.map(change=><p key={change.itemIndex} className="py-1">{money(change.requestedAmount)} / kg</p>)}</td><td className="bg-teal-50/50 px-4 py-4">{row.changes.map(change=><div key={change.itemIndex} className="py-1"><FinalAmount change={change} status={row.status} value={finalAmounts[row.id]?.[change.itemIndex]} onChange={canDecide&&row.status==='PENDING'?(index,value)=>setFinal(row.id,index,value):undefined}/></div>)}</td><td className="px-4 py-4"><span className={`rounded-full px-3 py-1 font-bold ${row.status==='APPROVED'?'bg-emerald-50 text-emerald-700':row.status==='REJECTED'?'bg-red-50 text-red-700':'bg-amber-50 text-amber-700'}`}>{row.status}</span>{row.decidedBy&&<small className="mt-2 block text-slate-400">{row.decidedBy}</small>}</td><td className="px-4 py-4"><div className="flex gap-2"><button onClick={()=>setSelected(selected?.id===row.id?null:row)} className="rounded-lg border px-3 py-2 font-bold text-teal-700">View</button>{canDecide&&row.status==='PENDING'&&<><button disabled={!!busy} onClick={()=>beginDecision(row,'APPROVED')} className="rounded-lg bg-emerald-600 px-3 py-2 font-bold text-white">Approve</button><button disabled={!!busy} onClick={()=>beginDecision(row,'REJECTED')} className="rounded-lg border border-red-200 px-3 py-2 font-bold text-red-600">Reject</button></>}</div></td></tr>)}{!visible.length&&<tr><td colSpan={8} className="p-12 text-center text-slate-400">{loading?'Loading credit requests…':'No EPR Credit requests found.'}</td></tr>}</tbody></table></div>
    {selected&&<div className="rounded-2xl border border-violet-100 bg-white p-4"><h3 className="mb-4 font-bold text-slate-800">{selected.quotationNumber} · Requested EPR Credit rows</h3><CreditRows rows={selected.changes} showFinal status={selected.status} finalAmounts={finalAmounts[selected.id]||{}} onFinalAmount={canDecide&&selected.status==='PENDING'?(index,value)=>setFinal(selected.id,index,value):undefined}/></div>}
    {decision&&<CreditDecisionDialog decision={decision} busy={!!busy} onCancel={()=>setDecision(null)} onConfirm={decide}/>}
  </section>;
}
