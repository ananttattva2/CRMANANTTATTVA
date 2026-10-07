import { withExplanationStages } from './uploadChecklist.utils.mjs';
import SalesUploadChecklist from './SalesUploadChecklist';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Download, ExternalLink, FileSpreadsheet, History, Loader2, RefreshCw, Search, ShieldCheck, Trash2, Upload, X } from 'lucide-react';
import api from '../../services/api';
import { API_ENDPOINTS } from '../../services/apiEndpoints';
import { uploadMedia, uploadMediaBatch } from '../../services/mediaUpload';
import { downloadCsv, downloadPurchaseTemplate, formatMetric, getPurchaseFinancialYearMismatch, readPurchaseWorkbook } from './purchaseData.utils';
import OutlookMsgViewer from './OutlookMsgViewer';
import PurchaseProofDropzone from './PurchaseProofDropzone';
import SalesDataPanel from './SalesDataPanel';

const WORKSPACE_TABS = ['Purchase Data', 'Sales Data', 'Pre Consumer / State / Annual', 'EPR Target', 'EPR CREDIT'];
const REQUIRED_NORMAL_ROWS = new Set(['Received from client', 'Ready to upload', 'Client Approval on data', 'Upload Complete']);
const EMPTY_PAGINATION = { page: 1, pages: 1, total: 0 };
const statusTone = (value) => {
  const status = String(value || '').toLowerCase();
  if (status.includes('approved') || status === 'completed' || status === 'matched') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status.includes('reject') || status.includes('rework') || status.includes('missing') || status.includes('excess')) return 'border-rose-200 bg-rose-50 text-rose-700';
  if (status.includes('pending') || status.includes('warning') || status.includes('partial')) return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
};
const errorText = (error) => error?.response?.data?.error || error?.response?.data?.message || error?.message || 'Something went wrong.';

function Badge({ children, value = children }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${statusTone(value)}`}>{children}</span>;
}

function Metric({ label, value, tone = 'slate' }) {
  const colors = tone === 'green' ? 'border-emerald-200 bg-emerald-50' : tone === 'orange' ? 'border-orange-200 bg-orange-50' : 'border-slate-200 bg-slate-50';
  return <div className={`rounded-xl border p-3 ${colors}`}><p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p><strong className="mt-1 block text-lg font-black text-slate-950">{value}</strong></div>;
}

function UploadCard({ source, upload, locked, disabled, busy, onSelect, onRemove, financialYear }) {
  const title = source === 'base' ? 'Purchase Base Data' : 'Purchase Portal Upload';
  const mappings = source === 'base'
    ? ['Qty. of Plastic (MT) = Base Qty', 'Total Invoice Value = Base GST']
    : ['Total Plastic Quantity = Portal Qty', 'Total Invoice Value = Portal GST Value'];
  return <article className={`rounded-2xl border p-4 ${locked ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200 bg-white'}`}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h6 className="text-sm font-black text-slate-950">{title}</h6><p className="mt-1 text-xs font-bold text-slate-500">Required Excel mappings:</p><p className="mt-0.5 text-[11px] font-bold text-slate-500">{mappings.join(' · ')}</p></div><button type="button" onClick={() => downloadPurchaseTemplate(source, financialYear)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700"><Download className="h-3.5 w-3.5" /> Template</button></div>
    {upload?.importStatus === 'Imported' ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><a href={upload.secureUrl || upload.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 truncate text-sm font-black text-emerald-800 hover:underline"><FileSpreadsheet className="h-4 w-4 shrink-0" />{upload.name}</a><p className="mt-1 text-xs font-bold text-emerald-700">{upload.totalRows} rows · {formatMetric(upload.totalQuantity)} tons · {upload.warningRowCount || 0} warnings</p></div>{!disabled && <button type="button" onClick={() => onRemove(source)} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>}</div>
      {!disabled && <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-emerald-200">Replace file<input className="hidden" type="file" accept=".xlsx,.xls" disabled={busy} onChange={(event) => onSelect(source, event.target.files?.[0], event.target)} /></label>}
    </div> : <label className={`mt-4 grid min-h-28 place-items-center rounded-xl border border-dashed text-center ${locked || disabled ? 'cursor-not-allowed border-amber-300 bg-white/70' : 'cursor-pointer border-emerald-300 bg-emerald-50 hover:bg-emerald-100/60'}`}>
      <div><Upload className="mx-auto h-6 w-6 text-emerald-600" /><p className="mt-2 text-sm font-black text-slate-800">{locked ? 'Upload locked' : busy ? 'Reading Excel…' : 'Choose Excel file'}</p><p className="mt-1 text-[11px] font-bold text-slate-500">{locked ? "Set ‘Upload Complete’ to Yes to unlock." : '.xlsx or .xls · maximum 10,000 rows'}</p></div>
      <input className="hidden" type="file" accept=".xlsx,.xls" disabled={locked || disabled || busy} onChange={(event) => onSelect(source, event.target.files?.[0], event.target)} />
    </label>}
  </article>;
}

function ImportPreview({ pending, busy, onClose, onConfirm }) {
  if (!pending) return null;
  return <div className="fixed inset-0 z-[150] grid place-items-center bg-slate-950/50 p-4"><div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl bg-white shadow-2xl">
    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white p-5"><div><p className="text-xs font-black uppercase tracking-widest text-[#30737B]">Import preview</p><h5 className="mt-1 text-lg font-black text-slate-950">{pending.file.name} · {pending.parsed.rows.length} rows</h5></div><button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
    <div className="overflow-x-auto p-5"><table className="min-w-full text-left text-xs"><thead><tr>{pending.parsed.headers.map((header) => <th key={header} className="whitespace-nowrap border-b bg-slate-50 px-3 py-2 font-black text-slate-600">{header}</th>)}</tr></thead><tbody>{pending.parsed.preview.map((row, index) => <tr key={index}>{pending.parsed.headers.map((header) => <td key={header} className="max-w-56 truncate border-b px-3 py-2 font-bold text-slate-700">{String(row[header] ?? '') || '-'}</td>)}</tr>)}</tbody></table></div>
    <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white p-4"><p className="text-xs font-bold text-slate-500">Check the preview, then click <strong className="text-emerald-700">Confirm &amp; Upload</strong> to save and populate the tables.</p><div className="flex gap-2"><button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm font-black">Cancel</button><button type="button" onClick={onConfirm} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-[#087A70] px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-emerald-900/15 disabled:opacity-60">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? 'Uploading & importing…' : 'Confirm & Upload'}</button></div></div>
  </div></div>;
}

export default function PurchaseDataWorkspace({ clientId, financialYear, currentUser }) {
  const [activeTab, setActiveTab] = useState('Purchase Data');
  const [purchase, setPurchase] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [pendingImport, setPendingImport] = useState(null);
  const [mailPreview, setMailPreview] = useState(null);
  const [rowsSource, setRowsSource] = useState('base');
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState(EMPTY_PAGINATION);
  const [rowSearch, setRowSearch] = useState('');
  const [reviewMessage, setReviewMessage] = useState('');
  const saveTimer = useRef(null);
  const initialized = useRef(false);
  const canEdit = purchase?.permissions?.canEdit !== false;
  const uploadUnlocked = purchase?.checklist?.find((row) => row.particular === 'Upload Complete')?.yesNo === 'Yes';
  const nilUpload = purchase?.readiness?.nilUpload;
  const nilUploadSelected = purchase?.checklist?.find((row) => row.particular === 'Nil Upload')?.yesNo === 'Yes';

  const loadPurchase = useCallback(async (quiet = false) => {
    if (!clientId || !financialYear) return;
    if (!quiet) setLoading(true);
    try {
      const { data } = await api.get(API_ENDPOINTS.clients.purchaseData(clientId), { params: { financialYear } });
      setPurchase(withExplanationStages(data.purchaseData));
      setNotice(null);
    } catch (error) { setNotice({ type: 'error', text: errorText(error) }); }
    finally { setLoading(false); initialized.current = true; }
  }, [clientId, financialYear]);

  useEffect(() => { initialized.current = false; loadPurchase(); return () => clearTimeout(saveTimer.current); }, [loadPurchase]);

  const saveChecklist = useCallback(async (next, successText = '') => {
    if (!canEdit) return;
    setBusy('checklist');
    try {
      const { data } = await api.put(API_ENDPOINTS.clients.purchaseChecklist(clientId), { financialYear, checklist: next.checklist, userRemarks: next.userRemarks || '' });
      setPurchase(withExplanationStages(data.purchaseData));
      if (successText) setNotice({ type: 'success', text: successText });
    } catch (error) { setNotice({ type: 'error', text: errorText(error) }); }
    finally { setBusy(''); }
  }, [canEdit, clientId, financialYear]);

  const updateChecklistRow = (index, patch, immediate = false) => {
    const next = { ...purchase, checklist: purchase.checklist.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row) };
    setPurchase(next);
    clearTimeout(saveTimer.current);
    if (immediate) saveChecklist(next, 'Checklist saved.'); else saveTimer.current = setTimeout(() => saveChecklist(next), 650);
    const changedRow = next.checklist[index];
    const nilSelected = next.checklist.find((row) => row.particular === 'Nil Upload')?.yesNo === 'Yes';
    const mandatory = changedRow.particular !== 'Client Approval on data' && !nilSelected && REQUIRED_NORMAL_ROWS.has(changedRow.particular);
    if (mandatory && patch.yesNo === 'Yes' && (!changedRow.date || !changedRow.files?.length)) setNotice({ type: 'warning', text: `${changedRow.particular}: date and supporting proof are required.` });
  };

  const uploadProof = async (index, fileList) => {
    if (!fileList?.length) return;
    setBusy(`proof-${index}`);
    try {
      const selected = Array.from(fileList);
      const emailFiles = selected.filter((file) => /\.(eml|msg)$/i.test(file.name) || ['message/rfc822', 'application/vnd.ms-outlook'].includes(file.type));
      const ordinaryFiles = selected.filter((file) => !emailFiles.includes(file));
      let working = purchase;
      for (const emailFile of emailFiles) {
        const form = new FormData(); form.append('file', emailFile); form.append('financialYear', financialYear); form.append('section', 'purchase'); form.append('progressParticular', purchase.checklist[index].particular);
        const { data } = await api.post(API_ENDPOINTS.clients.purchaseEmailProof(clientId), form, { headers: { 'Content-Type': 'multipart/form-data' } });
        if (data.purchaseData) working = data.purchaseData;
        else if (data.proof && !working.checklist[index].files.some((file) => String(file.proofId || '') === String(data.proof.proofId || ''))) working = { ...working, checklist: working.checklist.map((row, rowIndex) => rowIndex === index ? { ...row, files: [...(row.files || []), data.proof].slice(0, 20) } : row) };
      }
      if (ordinaryFiles.length) {
        const uploaded = await uploadMediaBatch(ordinaryFiles, `crm/purchase-data/${clientId}/${financialYear}/proofs`);
        working = { ...working, checklist: working.checklist.map((row, rowIndex) => rowIndex === index ? { ...row, files: [...(row.files || []), ...uploaded].slice(0, 20) } : row) };
        await saveChecklist(working);
      }
      setPurchase(working); setNotice({ type: 'success', text: emailFiles.length ? 'Email proof decoded and uploaded successfully.' : 'Proof uploaded.' });
    } catch (error) { if (error?.response?.data?.proof) setMailPreview(error.response.data.proof); setNotice({ type: 'error', text: errorText(error) }); }
    finally { setBusy(''); }
  };

  const removeProof = async (rowIndex, fileIndex, file) => {
    if (file?.proofId) {
      setBusy(`proof-${rowIndex}`);
      try { const { data } = await api.delete(API_ENDPOINTS.purchaseProofs.detail(file.proofId)); if (data.purchaseData) setPurchase(withExplanationStages(data.purchaseData)); setNotice({ type: 'success', text: 'Email proof removed.' }); }
      catch (error) { setNotice({ type: 'error', text: errorText(error) }); }
      finally { setBusy(''); }
      return;
    }
    updateChecklistRow(rowIndex, { files: purchase.checklist[rowIndex].files.filter((_, current) => current !== fileIndex) }, true);
  };

  const selectExcel = async (source, file, input) => {
    if (!file) return;
    setBusy(`parse-${source}`);
    try {
      const parsed = await readPurchaseWorkbook(file, source);
      const financialYearMismatch = getPurchaseFinancialYearMismatch(parsed.rows, financialYear);
      if (financialYearMismatch) throw new Error(financialYearMismatch.message);
      setPendingImport({ source, file, parsed });
      setNotice({ type: 'success', text: `${file.name} read successfully (${parsed.rows.length} rows). Confirm the preview to upload.` });
    }
    catch (error) { setNotice({ type: 'error', text: errorText(error) }); }
    finally { setBusy(''); if (input) input.value = ''; }
  };

  const confirmImport = async () => {
    if (!pendingImport) return;
    setBusy('import');
    try {
      const selectedSource = pendingImport.source;
      const file = await uploadMedia(pendingImport.file, `crm/purchase-data/${clientId}/${financialYear}/excel`);
      const { data } = await api.post(API_ENDPOINTS.clients.purchaseImport(clientId, selectedSource), { financialYear, file, rows: pendingImport.parsed.rows, sheetName: pendingImport.parsed.sheetName, headerRowNumber: pendingImport.parsed.headerRowNumber });
      const importedRows = Array.isArray(data.previewRows) ? data.previewRows : [];
      setPurchase(withExplanationStages(data.purchaseData));
      setRowsSource(selectedSource);
      setRows(importedRows.slice(0, 25));
      const importedCount = Number(data.importedRowCount ?? data.upload?.importedRowCount ?? importedRows.length);
      setPagination({ page: 1, pages: Math.max(1, Math.ceil(importedCount / 25)), total: importedCount });
      setPendingImport(null);
      const skippedText = data.skippedRowCount ? ` ${data.skippedRowCount} invalid or duplicate row(s) were skipped; review the validation details.` : '';
      setNotice({ type: data.partialImport || (data.autoSubmitted && !data.managerEmailSent) ? 'warning' : 'success', text: data.autoSubmitted ? (data.managerEmailSent ? `Both Excel files imported. Sent to Manager for approval and email notification delivered.${skippedText}` : `Both Excel files imported and sent to Manager approval, but the Manager email could not be delivered. Please verify the user-manager mapping and mail configuration.${skippedText}`) : `${selectedSource === 'base' ? 'Base' : 'Portal'} Excel uploaded successfully. ${importedCount} valid row(s) are now visible below.${skippedText}` });
    } catch (error) {
      const details = error?.response?.data?.validationErrors?.slice(0, 3).map((item) => `Row ${item.rowNumber}: ${item.message}`).join(' · ');
      setNotice({ type: 'error', text: `${errorText(error)}${details ? ` ${details}` : ''}` });
    } finally { setBusy(''); }
  };

  const removeImport = async (source) => {
    if (!window.confirm(`Remove the current ${source} import? Previous approvals will reset.`)) return;
    setBusy(`remove-${source}`);
    try {
      const { data } = await api.delete(API_ENDPOINTS.clients.purchaseImport(clientId, source), { params: { financialYear } });
      setPurchase(withExplanationStages(data.purchaseData)); setRows([]); setPagination(EMPTY_PAGINATION); setNotice({ type: 'success', text: 'Import removed.' });
    } catch (error) { setNotice({ type: 'error', text: errorText(error) }); }
    finally { setBusy(''); }
  };

  const loadRows = useCallback(async (page = 1) => {
    if (!purchase?.[rowsSource === 'base' ? 'baseUpload' : 'portalUpload']) { setRows([]); setPagination(EMPTY_PAGINATION); return; }
    setBusy('rows');
    try {
      const { data } = await api.get(API_ENDPOINTS.clients.purchaseRows(clientId), { params: { financialYear, source: rowsSource, page, limit: 25, search: rowSearch || undefined } });
      setRows(data.rows || []); setPagination(data.pagination || EMPTY_PAGINATION);
    } catch (error) { setNotice({ type: 'error', text: errorText(error) }); }
    finally { setBusy(''); }
  }, [clientId, financialYear, purchase, rowSearch, rowsSource]);

  useEffect(() => {
    const upload = purchase?.[rowsSource === 'base' ? 'baseUpload' : 'portalUpload'];
    if (upload?.importStatus === 'Imported') loadRows(1);
    else { setRows([]); setPagination(EMPTY_PAGINATION); }
  }, [purchase?.baseUpload?.uploadId, purchase?.portalUpload?.uploadId, rowsSource]);


  const review = async (stage, decision) => {
    if (decision === 'REJECTED' && !reviewMessage.trim()) { setNotice({ type: 'error', text: 'Rejection comments are required.' }); return; }
    setBusy('review');
    try {
      const endpoint = stage === 'manager' ? API_ENDPOINTS.clients.purchaseManagerReview(clientId) : API_ENDPOINTS.clients.purchaseComplianceReview(clientId);
      const { data } = await api.post(endpoint, { financialYear, decision, message: reviewMessage, acknowledgeWarnings: true });
      setPurchase(withExplanationStages(data.purchaseData)); setReviewMessage(''); setNotice({ type: 'success', text: `${stage === 'manager' ? 'Manager' : 'Compliance'} decision saved.` });
    } catch (error) { setNotice({ type: 'error', text: errorText(error) }); }
    finally { setBusy(''); }
  };

  const totals = purchase?.reconciliation?.totals || {};
  const categories = purchase?.reconciliation?.categorySummary || {};
  const entities = purchase?.reconciliation?.entitySummary || {};
  const issues = purchase?.reconciliation?.issues || [];
  const allEntities = useMemo(() => [...(entities.Registered || []), ...(entities.Unregistered || [])], [entities]);

  if (loading) return <div className="mx-4 grid min-h-72 place-items-center rounded-2xl border border-slate-200 bg-white"><div className="text-center"><Loader2 className="mx-auto h-7 w-7 animate-spin text-[#087A70]" /><p className="mt-2 text-sm font-black text-slate-600">Loading Purchase Data…</p></div></div>;
  if (!purchase) return <div className="mx-4 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm font-black text-rose-700">{notice?.text || 'Purchase Data could not be loaded.'}</div>;

  return <section role="tabpanel" aria-label="Data Compliance" className="mx-4 overflow-hidden rounded-3xl border border-teal-200 bg-[linear-gradient(145deg,#f0fdfa_0%,#ffffff_42%,#fff7ed_100%)] shadow-[0_18px_55px_rgba(15,118,110,0.10)]">
    <div className="overflow-x-auto border-b border-teal-200 bg-gradient-to-r from-teal-50 via-cyan-50 to-emerald-50 p-2.5"><div className="flex min-w-max gap-2" role="tablist">{WORKSPACE_TABS.map((tab) => <button type="button" role="tab" aria-selected={activeTab === tab} key={tab} onClick={() => setActiveTab(tab)} className={`min-w-44 rounded-xl border px-4 py-3 text-xs font-black transition ${activeTab === tab ? 'border-teal-300 bg-white text-teal-800 shadow-sm' : 'border-transparent text-slate-600 hover:border-teal-200 hover:bg-white/70 hover:text-teal-700'}`}>{tab}</button>)}</div></div>
    {notice && <div className={`m-4 flex items-start justify-between gap-3 rounded-xl border p-3 text-sm font-bold ${notice.type === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : notice.type === 'warning' ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}><span>{notice.text}</span><button type="button" onClick={() => setNotice(null)}><X className="h-4 w-4" /></button></div>}

    {activeTab === 'Purchase Data' && <div className="space-y-4 p-4">
      <SalesUploadChecklist title="Purchase Data Upload Checklist" checklist={purchase.checklist || []} canEdit={canEdit} busy={busy} onChange={updateChecklistRow} onUploadProof={uploadProof} onRemoveProof={removeProof} onPreview={setMailPreview} onError={(text) => setNotice({ type: 'error', text })} />
      <fieldset disabled={!uploadUnlocked && !nilUpload} className={`min-w-0 space-y-3 ${!uploadUnlocked && !nilUpload ? 'opacity-50' : ''}`} inert={!uploadUnlocked && !nilUpload ? '' : undefined}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Metric label="Status" value={purchase.calculatedStatus} /><Metric label="Received date" value={purchase.readiness?.startDate || '-'} /><Metric label="Portal upload date" value={purchase.readiness?.endDate || '-'} /><Metric label="Blocking issues" value={purchase.reconciliation?.blockingIssueCount || 0} tone="orange" /><Metric label="Warnings" value={purchase.reconciliation?.warningIssueCount || 0} tone="orange" /></div>
      {!uploadUnlocked && !nilUpload && <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-black text-amber-800">Set “Upload Complete” to “Yes” in the tracker to unlock Purchase Excel uploads.</div>}
      {nilUpload ? <div className="rounded-2xl border border-violet-300 bg-gradient-to-r from-violet-50 via-fuchsia-50 to-pink-50 px-5 py-4 text-sm font-black text-violet-900 shadow-sm">Nil Upload path is active. Only “Client Approval on data” is mandatory; Excel files and the other checklist validations are bypassed.</div> : <div className="grid gap-4 lg:grid-cols-2"><UploadCard source="base" upload={purchase.baseUpload} locked={!uploadUnlocked} disabled={!canEdit} busy={Boolean(busy)} onSelect={selectExcel} onRemove={removeImport} financialYear={financialYear} /><UploadCard source="portal" upload={purchase.portalUpload} locked={!uploadUnlocked} disabled={!canEdit} busy={Boolean(busy)} onSelect={selectExcel} onRemove={removeImport} financialYear={financialYear} /></div>}

      <div className="rounded-2xl border border-slate-200"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 p-3"><div><h6 className="text-sm font-black text-slate-950">Purchase Upload Summary</h6><p className="text-[11px] font-bold text-slate-500">Backend-calculated reconciliation; invalid rows are excluded.</p></div><Badge value={totals.result}>{totals.result || 'Awaiting data'}</Badge></div><div className="grid gap-3 p-3 sm:grid-cols-3 lg:grid-cols-6"><Metric label="Data to upload" value={formatMetric(totals.baseQty)} tone="green" /><Metric label="Uploaded on portal" value={formatMetric(totals.portalQty)} tone="green" /><Metric label="Qty diff" value={formatMetric(totals.qtyDiff)} /><Metric label="GST to upload" value={formatMetric(totals.baseGst)} tone="orange" /><Metric label="GST uploaded" value={formatMetric(totals.portalGst)} tone="orange" /><Metric label="GST diff" value={formatMetric(totals.gstDiff)} /></div>
      <div className="overflow-x-auto"><table className="min-w-[1000px] w-full text-xs"><thead><tr className="text-white"><th rowSpan="2" className="bg-[#172238] px-3 py-3 text-left">Category</th><th colSpan="6" className="bg-[#07805f] px-3 py-2">REGISTERED</th><th colSpan="6" className="bg-[#f45108] px-3 py-2">UNREGISTERED</th></tr><tr className="text-[10px] uppercase text-white">{['Base Qty','Portal Qty','Qty Diff','Base GST','Portal GST','GST Diff','Base Qty','Portal Qty','Qty Diff','Base GST','Portal GST','GST Diff'].map((label, index) => <th key={`${label}-${index}`} className={`px-2 py-2 ${index < 6 ? 'bg-[#07805f]' : 'bg-[#f45108]'}`}>{label}</th>)}</tr></thead><tbody>{['Cat-I','Cat-II','Cat-III','Cat-IV'].map((category) => { const current = categories[category] || {}; return <tr key={category} className="border-t border-slate-200 text-center font-bold"><td className="bg-slate-100 px-3 py-2 text-left font-black">{category}</td>{['Registered','Unregistered'].flatMap((type) => { const item = current[type] || {}; return [item.baseQty,item.portalQty,item.qtyDiff,item.baseGst,item.portalGst,item.gstDiff].map((value, index) => <td key={`${type}-${index}`} className={type === 'Registered' ? 'bg-emerald-50 px-2 py-2' : 'bg-orange-50 px-2 py-2'}>{formatMetric(value)}</td>); })}</tr>; })}</tbody></table></div></div>

      <div className="grid gap-4 xl:grid-cols-2">{['Registered','Unregistered'].map((type) => { const registered = type === 'Registered'; const dataCellTone = registered ? 'bg-emerald-50' : 'bg-orange-50'; return <div key={type} className="overflow-hidden rounded-2xl border border-slate-200"><h6 className={`px-4 py-3 text-sm font-black text-white ${registered ? 'bg-[#07805f]' : 'bg-[#f45108]'}`}>{type} Entity List</h6><div className="max-h-72 overflow-auto"><table className="w-full min-w-[650px] text-xs"><thead className="sticky top-0"><tr>{['Name','Base','Portal','Diff','GST diff','Status'].map((label, columnIndex) => <th key={label} className={`px-3 py-2 font-black text-white ${columnIndex === 0 ? 'bg-[#172238] text-left' : registered ? 'bg-[#07805f] text-center' : 'bg-[#f45108] text-center'}`}>{label}</th>)}</tr></thead><tbody>{(entities[type] || []).map((entity, index) => <tr key={`${entity.name}-${index}`} className="border-t border-slate-200"><td className="bg-slate-100 px-3 py-2 font-black">{entity.name}<span className="block text-[10px] text-slate-400">{entity.gstin}</span></td><td className={`text-center ${dataCellTone}`}>{formatMetric(entity.baseQty)}</td><td className={`text-center ${dataCellTone}`}>{formatMetric(entity.portalQty)}</td><td className={`text-center ${dataCellTone}`}>{formatMetric(entity.qtyDiff)}</td><td className={`text-center ${dataCellTone}`}>{formatMetric(entity.gstDiff)}</td><td className={`px-2 text-center ${dataCellTone}`}><Badge value={entity.result}>{entity.result}</Badge></td></tr>)}{!(entities[type] || []).length && <tr><td colSpan="6" className="p-6 text-center font-bold text-slate-400">No entities</td></tr>}</tbody></table></div></div>; })}</div>

      <div className="overflow-hidden rounded-2xl border border-slate-200"><div className="flex flex-wrap items-center justify-between gap-2 border-b bg-slate-50 p-3"><div><h6 className="text-sm font-black">Validation & Reconciliation Issues</h6><p className="text-[11px] font-bold text-slate-500">Blocking issues prevent submission; warnings require explanation.</p></div><button type="button" disabled={!issues.length} onClick={() => downloadCsv(`purchase-issues-${financialYear}.csv`, issues)} className="inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-2 text-xs font-black disabled:opacity-40"><Download className="h-3.5 w-3.5" />CSV</button></div><div className="max-h-72 overflow-auto"><table className="w-full min-w-[900px] text-xs"><thead className="sticky top-0 bg-slate-100"><tr>{['Issue','Severity','Entity','GSTIN','Category','Material','Base Qty','Portal Qty','Difference'].map((label) => <th key={label} className="px-3 py-2 text-left">{label}</th>)}</tr></thead><tbody>{issues.map((issue, index) => <tr key={index} className="border-t"><td className="px-3 py-2 font-black">{issue.issue}</td><td><Badge value={issue.severity}>{issue.severity}</Badge></td><td>{issue.entity || '-'}</td><td>{issue.gstin || '-'}</td><td>{issue.category || '-'}</td><td>{issue.material || '-'}</td><td>{formatMetric(issue.baseQty)}</td><td>{formatMetric(issue.portalQty)}</td><td>{typeof issue.difference === 'number' ? formatMetric(issue.difference) : issue.difference || '-'}</td></tr>)}{!issues.length && <tr><td colSpan="9" className="p-6 text-center font-bold text-emerald-600"><CheckCircle2 className="mx-auto mb-2 h-5 w-5" />No reconciliation issues</td></tr>}</tbody></table></div></div>

      <div className="overflow-hidden rounded-2xl border border-slate-200"><div className="flex flex-wrap items-center justify-between gap-2 border-b bg-slate-50 p-3"><div><h6 className="text-sm font-black">Imported Raw Data</h6><p className="mt-1 text-[10px] font-bold text-slate-500">Uploaded rows appear here automatically after a successful import.</p></div><div className="flex gap-2"><select value={rowsSource} onChange={(event) => { setRowsSource(event.target.value); setRows([]); }} className="rounded-lg border px-3 py-2 text-xs font-black"><option value="base">Base data</option><option value="portal">Portal data</option></select><div className="flex rounded-lg border bg-white"><input value={rowSearch} onChange={(event) => setRowSearch(event.target.value)} placeholder="Entity / GSTIN" className="w-36 px-3 text-xs font-bold outline-none" /><button type="button" onClick={() => loadRows(1)} className="p-2 text-[#087A70]"><Search className="h-4 w-4" /></button></div><button type="button" onClick={() => loadRows(1)} className="rounded-lg border bg-white px-3 py-2 text-xs font-black">Refresh rows</button></div></div><div className="overflow-x-auto"><table className="min-w-[900px] w-full text-xs"><thead className="bg-slate-100"><tr>{['Row','Entity','Registration','GSTIN','Category','Material','Quantity','GST','Status'].map((label) => <th key={label} className="px-3 py-2 text-left">{label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row._id || `${rowsSource}-${row.rowNumber}-${index}`} className="border-t"><td className="px-3 py-2">{row.rowNumber}</td><td className="font-black">{row.entityName}</td><td>{row.registrationType}</td><td>{row.gstin || '-'}</td><td>{row.plasticCategory}</td><td>{row.materialType}</td><td>{formatMetric(row.quantity)}</td><td>{formatMetric(row.gstPaid)}</td><td><Badge value={row.validationStatus}>{row.validationStatus}</Badge></td></tr>)}{!rows.length && <tr><td colSpan="9" className="p-6 text-center font-bold text-slate-400">Upload and confirm an Excel file, or click “Refresh rows” for an existing import.</td></tr>}</tbody></table></div>{pagination.total > 0 && <div className="flex items-center justify-end gap-2 border-t p-3 text-xs font-black"><span>{pagination.total} rows</span><button type="button" disabled={pagination.page <= 1} onClick={() => loadRows(pagination.page - 1)} className="rounded border p-1 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button><span>{pagination.page}/{pagination.pages}</span><button type="button" disabled={pagination.page >= pagination.pages} onClick={() => loadRows(pagination.page + 1)} className="rounded border p-1 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button></div>}</div>

      </fieldset>
      {(purchase.permissions?.canManagerReview || purchase.permissions?.canComplianceReview) && <div className="rounded-2xl border border-slate-200 p-4"><div className="flex items-start gap-3"><ShieldCheck className="mt-1 h-5 w-5 text-[#087A70]" /><div className="flex-1"><h6 className="text-sm font-black">Approval Workflow</h6><div className="mt-2 flex flex-wrap gap-2"><Badge value={purchase.managerVerificationStatus}>Manager: {purchase.managerVerificationStatus}</Badge><Badge value={purchase.complianceVerificationStatus}>Compliance: {purchase.complianceVerificationStatus}</Badge></div><textarea value={reviewMessage} onChange={(event) => setReviewMessage(event.target.value)} rows="2" placeholder="Submission note, warning explanation or rejection comments…" className="mt-3 w-full rounded-xl border border-slate-200 p-3 text-sm font-bold" /><div className="mt-3 flex flex-wrap gap-2">{purchase.permissions?.canManagerReview && purchase.managerVerificationStatus === 'Pending' && <><button type="button" onClick={() => review('manager','APPROVED')} className="rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-black text-white">Manager Approve</button><button type="button" onClick={() => review('manager','REJECTED')} className="rounded-lg bg-rose-600 px-4 py-2.5 text-xs font-black text-white">Manager Reject</button></>}{purchase.permissions?.canComplianceReview && purchase.complianceVerificationStatus === 'Pending' && <><button type="button" onClick={() => review('compliance','APPROVED')} className="rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-black text-white">Compliance Approve</button><button type="button" onClick={() => review('compliance','REJECTED')} className="rounded-lg bg-rose-600 px-4 py-2.5 text-xs font-black text-white">Compliance Reject</button></>}</div></div></div>
      {!!purchase.reviewHistory?.length && <div className="mt-4 border-t pt-4"><p className="mb-2 flex items-center gap-2 text-xs font-black uppercase text-slate-500"><History className="h-4 w-4" />Audit history</p><div className="space-y-2">{[...purchase.reviewHistory].reverse().map((item, index) => <div key={index} className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600"><strong className="text-slate-900">{item.stage} · {item.decision}</strong> by {item.by?.name || '-'} · {item.at ? new Date(item.at).toLocaleString('en-IN') : '-'}{item.message && <span className="block mt-1">{item.message}</span>}</div>)}</div></div>}</div>}
    </div>}


    {activeTab === 'Sales Data' && <SalesDataPanel clientId={clientId} financialYear={financialYear} />}
    {!['Purchase Data','Sales Data'].includes(activeTab) && <div className="grid min-h-72 place-items-center bg-[linear-gradient(135deg,#f0fdfa,#fff,#fff7ed)] p-8 text-center"><div><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white text-[#30737B] shadow ring-1 ring-teal-100"><FileSpreadsheet className="h-7 w-7" /></span><h5 className="mt-4 text-lg font-black">{activeTab}</h5><p className="mt-2 text-sm font-bold text-slate-500">This Data Compliance module will be configured in the next phase.</p></div></div>}
    <ImportPreview pending={pendingImport} busy={busy === 'import'} onClose={() => setPendingImport(null)} onConfirm={confirmImport} />
    {mailPreview && <OutlookMsgViewer file={mailPreview} onClose={() => setMailPreview(null)} />}
  </section>;
}
