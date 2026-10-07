import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Diamond, Edit3, Eye, FileCheck2, FileText, RefreshCw, RotateCcw, Search, X, XCircle, Users } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DeactivationApprovals } from '../features/clientMaster/ClientDeactivation';
import DashboardShell from '../components/dashboard/DashboardShell';
import ClientApplicantPicker from '../components/ClientApplicantPicker';
import ProfileModal from '../components/dashboard/ProfileModal';
import ApprovalTabs from '../components/dashboard/ApprovalTabs';
import BrandLoader from '../components/BrandLoader';
import ToastMessage from '../components/ToastMessage';
import PoProofView from '../components/PoProofView';
import { adminRoles, getUserRoles, hasAnyRole } from '../constants/dashboard';
import api, { storeSessionUser } from '../services/api';
import { API_ENDPOINTS } from '../services/apiEndpoints';
import { uploadMedia } from '../services/mediaUpload';
import { resolvePoApplicantDetails } from '../utils/poApplicantDetails.mjs';
import { resolveQuotationBasicAmount } from '../utils/leadClosureQuotation';
import { formatDisplayDate, formatDisplayDateTime } from '../utils/dateFormat';

const rowsPerPage = 5;
const PENDING_APPROVAL_CACHE_KEY = 'crm.pendingApproval.cache.v7';
const PENDING_APPROVAL_CACHE_TTL_MS = 5 * 60 * 1000;
const PENDING_APPROVAL_AUTH_TIMEOUT_MS = 4500;
const PENDING_APPROVAL_DATA_TIMEOUT_MS = 20000;

function approvalCacheUserId(user) {
  return String(user?._id || user?.id || user?.email || '').trim().toLowerCase();
}

function readPendingApprovalCache(expectedUser) {
  try {
    const raw = sessionStorage.getItem(PENDING_APPROVAL_CACHE_KEY) || localStorage.getItem(PENDING_APPROVAL_CACHE_KEY) || 'null';
    const parsed = JSON.parse(raw);
    if (!parsed || Date.now() - Number(parsed.savedAt || 0) > PENDING_APPROVAL_CACHE_TTL_MS) return null;
    const data = parsed.data || null;
    const expectedUserId = approvalCacheUserId(expectedUser);
    const cachedUserId = approvalCacheUserId(data?.currentUser);
    return expectedUserId && cachedUserId === expectedUserId ? data : null;
  } catch {
    return null;
  }
}

function writePendingApprovalCache(data) {
  const payload = JSON.stringify({ savedAt: Date.now(), data });
  try {
    sessionStorage.setItem(PENDING_APPROVAL_CACHE_KEY, payload);
  } catch {
    // Cache is only for faster navigation.
  }
  try {
    localStorage.setItem(PENDING_APPROVAL_CACHE_KEY, payload);
  } catch {
    // Cache is only for faster navigation.
  }
}

function statusBadge(value) {
  const status = String(value || 'PENDING').toUpperCase();
  const tone = ['APPROVED', 'ADMIN APPROVED'].includes(status) ? 'approved' : status === 'PARTIALLY_APPROVED' ? 'partial' : status === 'REJECTED' ? 'rejected' : 'pending';
  return <span className={`pending-status pending-status-${tone}`}>{status === 'PARTIALLY_APPROVED' ? 'PARTIALLY APPROVED' : status}</span>;
}

function formatApprovalValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return formatDisplayDate(value);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(formatApprovalValue).filter((item) => item && item !== '-').join(', ') || '-';
  if (typeof value === 'object') {
    return value.name || value.fullName || value.email || value.username || value.companyName || value.clientName || value.id || value._id || '-';
  }
  return String(value);
}

function formatAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value || '-';
  return amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _isUsableProofValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/\[object/i.test(trimmed)) return false;
  return true;
}

// Last-resort deep recursive scan: finds any https://res.cloudinary / drive / s3 / blob
// proof URL buried in arbitrary nested object trees (legacy YES-path records stored
// Cloudinary response objects directly without flattening URL fields).
const _DEEP_URL_PROOF_RE = /^https?:\/\/(?:res\.cloudinary\.com|storage\.googleapis\.com|[\w-]+\.s3[\w.-]*\.amazonaws\.com|[\w.-]*s3[\w.-]*\.amazonaws\.com|cdn[\w-]*\.digitaloceanspaces\.com|commondatastorage\.googleapis\.com|lh\d*\.googleusercontent\.com|firebasestorage\.googleapis\.com|drive\.google\.com|pdf\.s3)\/\S/i;
const _DEEP_NAME_PROOF_RE = /\.(?:pdf|png|jpe?g|webp|gif|heic|tiff?|bmp)(?:[?#].*)?$/i;
function _deepFindProofField(root, want = 'url', _seen = new WeakSet(), _depth = 0) {
  if (_depth > 8 || root == null) return '';
  if (typeof root === 'string') {
    const v = root.trim();
    if (!v) return '';
    if (want === 'url') return _DEEP_URL_PROOF_RE.test(v) ? v : '';
    return _DEEP_NAME_PROOF_RE.test(v) || (v.length < 220 && v.length > 3 && !v.startsWith('http') && /[A-Za-z]/.test(v)) ? v : '';
  }
  if (typeof root !== 'object') return '';
  if (_seen.has(root)) return '';
  try { _seen.add(root); } catch { /* primitives ignore WeakSet */ }
  const entries = Array.isArray(root) ? root.map((v, i) => [i, v]) : Object.entries(root);
  for (const [, value] of entries) {
    const found = _deepFindProofField(value, want, _seen, _depth + 1);
    if (found) return found;
  }
  return '';
}

function _firstUsable(values, fallback = '') {
  for (const value of values) {
    if (_isUsableProofValue(value)) return typeof value === 'number' ? String(value) : String(value).trim();
  }
  return fallback;
}

function getPoProofUrl(row = {}) {
  if (!row || typeof row !== 'object') return '';
  const nestedUrl = [row.poProof, row.poFile, row.poDocument, row.poUpload, row.poAttachment, row.uploadedDocument, row.document, row.file, row.attachment, row.cloudinary, row.media, row.upload, row.resource, row.asset, row.payload, row.meta, row.metadata, row.data, row.info, row.detail, row.extra, row.source]
    .filter((value) => value && typeof value === 'object' && !Array.isArray(value))
    .map((value) => _firstUsable([value.poFileUrl, value.proofUrl, value.fileUrl, value.secureUrl, value.secure_url, value.url, value.imageUrl, value.image_url, value.pdfUrl, value.pdf_url, value.downloadUrl, value.download_url, value.directUrl, value.direct_url, value.sourceUrl, value.source_url, value.originalUrl, value.original_url]))
    .find((value) => value);
  const direct = _firstUsable([
    row.poFileUrl, row.poProofUrl, row.poDocumentUrl, row.poUploadUrl, row.poAttachmentUrl,
    row.uploadedDocumentUrl, row.documentUrl, row.fileUrl, row.secureUrl, row.secure_url,
    row.imageUrl, row.image_url, row.pdfUrl, row.pdf_url, row.downloadUrl, row.download_url,
    row.directUrl, row.direct_url, row.sourceUrl, row.source_url, row.originalUrl, row.original_url,
    row.url, nestedUrl
  ]);
  if (direct) return direct;
  return _deepFindProofField(row, 'url');
}

function getPoProofName(row = {}) {
  if (!row || typeof row !== 'object') return 'PO proof';
  const nestedName = [row.poProof, row.poFile, row.poDocument, row.poUpload, row.poAttachment, row.uploadedDocument, row.document, row.file, row.attachment, row.cloudinary, row.media, row.upload, row.resource, row.asset, row.payload, row.meta, row.metadata, row.data, row.info, row.detail, row.extra, row.source]
    .filter((value) => value && typeof value === 'object' && !Array.isArray(value))
    .map((value) => _firstUsable([value.poFileName, value.proofName, value.fileName, value.originalName, value.name, value.displayName, value.display_name, value.originalFilename, value.original_filename, value.filename, value.originalFileName, value.original_file_name]))
    .find((value) => value);
  const direct = _firstUsable([
    row.poFileName, row.poProofName, row.poDocumentName, row.poUploadName, row.poAttachmentName,
    row.uploadedDocumentName, row.documentName, row.fileName, row.originalName, row.name,
    row.displayName, row.display_name, row.originalFilename, row.original_filename,
    row.filename, row.originalFileName, row.original_file_name, nestedName
  ], 'PO proof');
  if (direct && direct !== 'PO proof') return direct;
  const deep = _deepFindProofField(row, 'name');
  return deep || direct;
}

function getApprovalPoRows(payload = {}) {
  return Array.isArray(payload.poYearRows) && payload.poYearRows.length ? payload.poYearRows
    : Array.isArray(payload.poRows) && payload.poRows.length ? payload.poRows
      : Array.isArray(payload.purchaseOrders) && payload.purchaseOrders.length ? payload.purchaseOrders : [];
}

function resolveCanonicalPoProof(approval = {}, normalizedRow = {}, rowIndex = 0) {
  const payload = approval.payload || {};
  const payloadRows = getApprovalPoRows(payload);
  const manifest = Array.isArray(payload.poProofManifest) ? payload.poProofManifest : [];
  const poNumber = String(normalizedRow.poNumber || '').trim();
  const matchesPoNumber = (row) => Boolean(poNumber && String(row?.poNumber || '').trim() === poNumber);
  const indexedForPo = (entries) => {
    const entry = entries[rowIndex];
    const indexedPoNumber = String(entry?.poNumber || '').trim();
    return entry && (!poNumber || !indexedPoNumber || indexedPoNumber === poNumber) ? entry : null;
  };
  // Defence: if the upstream hydratePurchaseOrderApprovals already resolved a valid
  // proof (truthy normalizedRow.poFileUrl + normalizedRow.hasPoFileUrl === true), do not
  // clobber it with a stale empty fallback from other resolvers.
  const alreadyResolved = Boolean(normalizedRow.hasPoFileUrl && _isUsableProofValue(normalizedRow.poFileUrl));
  const snapshotForProof =
    indexedForPo(payloadRows)
    || payloadRows.find(matchesPoNumber)
    || indexedForPo(manifest)
    || manifest.find(matchesPoNumber)
    || null;
  // 🔴 FINAL FIX (merge order was REVERSED!): spread snapshotForProof LAST so it ALWAYS wins
  // over normalizedRow from earlier buggy hydrate layers. Snapshot = DB upsert payload.poYearRows
  // written by backend upsertPurchaseOrderApprovals (guaranteed URL present if proof uploaded).
  // Old (broken): { ...snapshot, ...normalizedRow } → normalizedRow.empty URL destroyed valid snapshot URL!
  const compositeRow = { ...(normalizedRow || {}), ...(snapshotForProof || {}) };
  const sources = [
    snapshotForProof || {},
    normalizedRow || {},
    compositeRow,
    snapshotForProof,
    indexedForPo(payloadRows),
    payloadRows.find(matchesPoNumber),
    indexedForPo(manifest),
    manifest.find(matchesPoNumber),
    payload,
    approval,
  ].filter(Boolean);

  const proofSource = sources.find((source) => getPoProofUrl(source)) || compositeRow;
  const resolvedUrl = getPoProofUrl(proofSource);
  // If hydratePurchaseOrderApprovals already had a valid URL, prefer it; otherwise use the resolver result.
  const fallbackDirectUrl = [normalizedRow.poFileUrl, snapshotForProof?.poFileUrl, payloadRows[rowIndex]?.poFileUrl, manifest[rowIndex]?.poFileUrl]
    .filter((value) => _isUsableProofValue(value))
    .find(Boolean);
  const megaComposite = Object.assign({}, compositeRow, ...sources);
  const poFileUrl = (alreadyResolved && normalizedRow.poFileUrl) || resolvedUrl || fallbackDirectUrl || getPoProofUrl(megaComposite) || _deepFindProofField(megaComposite, 'url') || '';
  const resolvedName = getPoProofName(proofSource) || getPoProofName(normalizedRow) || getPoProofName(snapshotForProof || {}) || getPoProofName(megaComposite);
  const fallbackDirectName = [normalizedRow.poFileName, snapshotForProof?.poFileName, payloadRows[rowIndex]?.poFileName, manifest[rowIndex]?.poFileName]
    .filter((value) => _isUsableProofValue(value))
    .find(Boolean);
  const poFileName = (alreadyResolved && _isUsableProofValue(normalizedRow.poFileName) && normalizedRow.poFileName) || resolvedName || fallbackDirectName || _deepFindProofField(megaComposite, 'name') || 'PO proof';
  const compositeForMetadata = { ...(snapshotForProof || {}), ...(normalizedRow || {}), ...(proofSource || {}), ...megaComposite };
  const poFileMimeType = [compositeForMetadata.poFileMimeType, compositeForMetadata.poProof?.mimeType, compositeForMetadata.mimeType, compositeForMetadata.type, manifest[rowIndex]?.poFileMimeType, snapshotForProof?.poFileMimeType]
    .map((value) => String(value || '').trim())
    .find((value) => value) || '';
  const poFileSize = [compositeForMetadata.poFileSize, compositeForMetadata.bytes, compositeForMetadata.size, manifest[rowIndex]?.poFileSize, snapshotForProof?.poFileSize]
    .map((value) => (value != null && Number.isFinite(Number(value)) ? Number(value) : null))
    .find((value) => value != null);
  // Diagnostic: if URL still empty after every fallback, log for debugging.
  if (!poFileUrl && typeof console !== 'undefined') {
    console.debug('[POProof:resolveCanonical:fail]', {
      approvalId: approval._id || approval.id,
      leadCode: payload.leadCode || approval.uniqueId || '', rowIndex,
      alreadyResolved, resolvedUrl, fallbackDirectUrl,
      megaAny: _deepFindProofField(megaComposite, 'url'),
      topKeys: Object.keys(megaComposite).filter((k) => /proof|file|document|upload|attachment|url|secure|cloud|name/i.test(k))
    });
  }
  return {
    ...normalizedRow,
    approvalId: String(approval._id || approval.id || ''),
    leadCode: String(payload.leadCode || approval.uniqueId || ''),
    rowIndex,
    poFileUrl,
    poFileName,
    poFileMimeType,
    poFileSize,
    hasPoFileUrl: Boolean(poFileUrl)
  };
}

function NormalizedPoProof({ item, approvalRow }) {
  // 🧊 DEFROST: Deep clone approvalRow.payload via JSON roundtrip. Frozen React state objects / Proxy getters
  // can silently return undefined for known keys on nested properties, causing tier-4 match to return empty
  // even though DB data is perfectly valid. JSON clone completely bypasses any Proxy/getter traps.
  let payload;
  try { payload = JSON.parse(JSON.stringify(approvalRow?.payload || {})); } catch { payload = Object.assign({}, approvalRow?.payload || {}); }
  const snapshotRows = Array.isArray(payload.poYearRows) ? payload.poYearRows : [];
  const manifestRows = Array.isArray(payload.poProofManifest) ? payload.poProofManifest : [];
  const rowIndex = Number.isFinite(item?.rowIndex) ? item.rowIndex : 0;
  const itemPoNumber = String(item?.poNumber || '').trim();
  // TIER 4 — SNAPSHOT/MANIFEST FIRST (SOURCE OF TRUTH!)
  // backend upsertPurchaseOrderApprovals ALWAYS writes snapshotRows + manifestRows with correct URL.
  // TIER 1-3 = item props only as advisory fallback (they can be stale / overwritten / buggy).
  let snapshotMatchUrl = '';
  try {
    if (snapshotRows.length === 1) snapshotMatchUrl = getPoProofUrl(snapshotRows[0]);
    if (!snapshotMatchUrl && manifestRows.length === 1 && _isUsableProofValue(manifestRows[0]?.poFileUrl)) snapshotMatchUrl = String(manifestRows[0].poFileUrl || '').trim();
    if (!snapshotMatchUrl) {
      const byIndex = snapshotRows[rowIndex];
      const byIndexUrl = byIndex ? getPoProofUrl(byIndex) : '';
      const byIndexMatch = !byIndexUrl ? false : (!itemPoNumber || !String(byIndex?.poNumber || '').trim() || String(byIndex.poNumber || '').trim() === itemPoNumber);
      if (byIndexMatch && byIndexUrl) snapshotMatchUrl = byIndexUrl;
    }
    if (!snapshotMatchUrl && itemPoNumber) {
      const byPo = snapshotRows.find((r) => String(r?.poNumber || '').trim() === itemPoNumber);
      snapshotMatchUrl = byPo ? getPoProofUrl(byPo) : '';
    }
    if (!snapshotMatchUrl) {
      const manifestEntry = manifestRows.find((m) => String(m.rowIndex) === String(rowIndex)) || (itemPoNumber ? manifestRows.find((m) => String(m.poNumber || '').trim() === itemPoNumber) : null);
      if (manifestEntry && _isUsableProofValue(manifestEntry.poFileUrl)) snapshotMatchUrl = String(manifestEntry.poFileUrl || '').trim();
    }
  } catch { /* ignore */ }
  const itemUrl = (item?.hasPoFileUrl && _isUsableProofValue(item?.poFileUrl)) ? String(item.poFileUrl).trim()
    : _isUsableProofValue(item?.proofUrl) ? String(item.proofUrl).trim()
    : getPoProofUrl(item || {});
  // Terminal deep find (payload clone)
  const payloadDeepUrl = _deepFindProofField(payload, 'url') || '';
  // 🚨 WINNER CHAIN (PRIORITY ORDER): snapshot (DB truth) → item props → terminal deep find
  // Previously itemUrl first; bug caused item to beat snapshot with empty/invalid.
  const directUrl = snapshotMatchUrl || itemUrl || payloadDeepUrl || '';
  // ULTIMATE diagnostic: exact state at RENDER time (not closure time like forEach above)
  if (typeof console !== 'undefined') {
    console.groupCollapsed('[POProof:Component:render]', { leadCode: item?.leadCode || (approvalRow?.payload?.leadCode) || '', approvalId: item?.approvalId || (approvalRow?._id || approvalRow?.id || ''), poNumber: item?.poNumber || '', rowIndex: item.rowIndex });
    console.log('item keys:', Object.keys(item || {}));
    console.log('TIER1-3 itemUrl:', itemUrl ? itemUrl.slice(0, 90) + '...' : 'EMPTY');
    console.log('TIER4 snapshotMatchUrl (snapshotRows=' + snapshotRows.length + ' manifest=' + manifestRows.length + '):', snapshotMatchUrl ? snapshotMatchUrl.slice(0, 90) + '...' : 'EMPTY');
    console.log('TIER5 payloadDeepUrl:', payloadDeepUrl ? payloadDeepUrl.slice(0, 90) + '...' : 'EMPTY');
    console.log('directUrl resolved RENDER TIME:', directUrl ? directUrl.slice(0, 90) + '...' : 'EMPTY');
    console.log('hasPoFileUrl prop:', item?.hasPoFileUrl, 'poFileUrl prop:', item?.poFileUrl, 'proofUrl prop:', item?.proofUrl);
    console.log('getPoProofUrl(item) raw call:', getPoProofUrl(item || {}));
    console.log('_deepFindProofField(item):', item ? _deepFindProofField(item, 'url') : '');
    console.log('getPoProofUrl(payload.snapshotRows[' + rowIndex + ']):', snapshotRows[rowIndex] ? getPoProofUrl(snapshotRows[rowIndex]) : '');
    const manifestRowDebug = manifestRows.find((m) => String(m.rowIndex) === String(rowIndex)) || (itemPoNumber ? manifestRows.find((m) => String(m.poNumber || '').trim() === itemPoNumber) : null);
    console.log('manifest entry match:', manifestRowDebug || 'NONE');
    console.groupEnd();
    if (!directUrl) {
      console.warn('[POProof:Normalized:dash] TIER4/5 ALSO FAILED!', {
        itemUrl, snapshotMatchUrl, payloadDeepUrl, snapshotRowsLen: snapshotRows.length, manifestRowsLen: manifestRows.length, manifestRowDebug,
        hasPoFileUrl: item?.hasPoFileUrl, poFileUrl: item?.poFileUrl, proofUrl: item?.proofUrl,
        topKeys: Object.keys(item || {}).filter((k) => /proof|file|document|upload|attachment|url|secure|cloud|name/i.test(k)),
        deepFound: item ? _deepFindProofField(item, 'url') : '',
        rowIndex: item?.rowIndex, approvalId: item?.approvalId, leadCode: item?.leadCode, poNumber: item?.poNumber
      });
    } else if (item?.hasPoFileUrl === true && !_isUsableProofValue(item?.poFileUrl)) {
      console.warn('[POProof:Discrepancy] forEach said hasPoFileUrl true but render-time poFileUrl invalid. proofUrl used as fallback:', { poFileUrl: item?.poFileUrl, proofUrl: item?.proofUrl, directUrl });
    }
  }
  const dumpFullDiagnostic = (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    console.group('%c🔍 [POProof:Inspector:FullDump] — lead=' + (item?.leadCode || approvalRow?.payload?.leadCode || '') + ' po=' + (item?.poNumber || ''), 'background:#111827;color:#fde68a;font-weight:700;padding:4px 8px;border-radius:6px');
    console.log('approval_id:', approvalRow?._id || approvalRow?.id || '');
    console.log('approval_type:', approvalRow?.type || '');
    console.log('approval_status:', approvalRow?.approvalStatus || '');
    console.log('approval_clientName:', approvalRow?.clientName || '');
    console.log('approval_payload_leadCode:', approvalRow?.payload?.leadCode || approvalRow?.uniqueId || '');
    console.log('approval_payload_SERVICE:', approvalRow?.payload?.service || '');
    console.log('approval_payload_ASSIGNED_SERVICE_ID:', approvalRow?.payload?.assignedServiceId || '');
    console.log('approval_payload_ASSIGNMENT_INDEX:', approvalRow?.payload?.assignmentIndex, typeof approvalRow?.payload?.assignmentIndex);
    console.log('approval_payload_KEYS_ALL:', Object.keys(approvalRow?.payload || {}));
    console.log('approval_payload_FULL:', approvalRow?.payload || {});
    console.log('approval_normalizedPoRows (stored):', approvalRow?.normalizedPoRows || 'NOT_ATTACHED');
    const pRows = approvalRow?.payload?.poYearRows || approvalRow?.payload?.poRows || [];
    console.log('approval_payload.poYearRows LENGTH=' + pRows.length + ':', pRows);
    const manifest = approvalRow?.payload?.poProofManifest || [];
    console.log('approval_payload.poProofManifest LENGTH=' + manifest.length + ':', manifest);
    // Snapshot ALL url-y fields on payload top-level
    console.log('approval_payload_TOP_LEVEL_DIRECT_FIELDS:', Object.fromEntries(Object.entries(approvalRow?.payload || {}).filter(([k]) => /proof|file|document|upload|attachment|url|secure|cloud|name|quotationSent/i.test(k))));
    console.log('CURRENT ITEM (po row) KEYS:', Object.keys(item || {}));
    console.log('CURRENT ITEM FULL:', item || {});
    console.log('getPoProofUrl(payload top):', approvalRow?.payload ? getPoProofUrl(approvalRow.payload) : '');
    console.log('getPoProofUrl(approval top):', getPoProofUrl(approvalRow || {}));
    console.log('deepFind(payload):', approvalRow?.payload ? _deepFindProofField(approvalRow.payload, 'url') : '');
    console.log('deepFind(approval):', _deepFindProofField(approvalRow || {}, 'url'));
    // Also enumerate ALL string fields anywhere that look like cloudinary URLs
    const allStrings = [];
    try {
      const walk = (o, path, depth) => {
        if (depth > 6 || !o) return;
        const t = typeof o;
        if (t === 'string') { if (/res\.cloudinary|cloudinary\.com|s3\.amazonaws|storage\.googleapis|firebasestorage|drive\.google/i.test(o)) allStrings.push([path, o.slice(0, 160)]); return; }
        if (t !== 'object') return;
        Object.entries(o).forEach(([k, v]) => walk(v, path ? `${path}.${k}` : String(k), depth + 1));
      };
      walk({ approval: approvalRow || {}, item: item || {} }, '', 0);
    } catch { /* ignore */ }
    console.log('🔎 ALL_CLOUDINARY_STRINGS_ANYWHERE (depth<=6):', allStrings);
    console.groupEnd();
    const summary = '🔍 Full diagnostic dump written to Console!\n\nExpand the YELLOW/BLACK group [POProof:Inspector:FullDump] for lead=' + (item?.leadCode || approvalRow?.payload?.leadCode || '') + '\n\nLast-line CLOUDINARY_STRINGS_ANYWHERE lists EVERY valid proof URL in the entire approval — if present there, proof EXISTS IN DB and frontend will recover it!\n\nCloudinary strings found: ' + String(allStrings.length || 0);
    try { alert(summary); } catch { /* ignore */ }
  };
  if (!directUrl) {
    // Render dash TEXT itself as the clickable inspector button (no extra width required,
    // so even narrow PO Proof columns show the click target.)
    return (
      <div className="flex items-center gap-1">
        <span
          role="button"
          tabIndex={0}
          title="Click to inspect — dumps full DB structure + ALL Cloudinary URLs anywhere in document to Console"
          onClick={dumpFullDiagnostic}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') dumpFullDiagnostic(e); }}
          className="inline-flex min-h-[28px] cursor-help items-center gap-1 rounded-md border border-dashed border-slate-200 bg-slate-50/60 px-2 text-[11px] font-black uppercase tracking-wide text-slate-500 shadow-[0_1px_0_rgba(148,163,184,0.15)] hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700"
        >
          <span aria-hidden>🔍</span>
          <span>Proof Missing</span>
        </span>
      </div>
    );
  }
  const name = _isUsableProofValue(item?.poFileName) ? item.poFileName : getPoProofName(item || {}) || 'PO proof';
  return <a href={directUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center rounded-lg bg-blue-600 px-3 text-xs font-black text-white shadow-sm">Open PO Proof</a>;
}

function PoProof({ row, onUpload, uploading = false }) {
  const url = getPoProofUrl(row);
  console.debug('[POProof:render:cell]', { poNumber: row?.poNumber || '', hasResolvedUrl: Boolean(url), proofKeys: Object.keys(row || {}).filter((key) => /proof|file|document|upload|attachment|url/i.test(key)) });
  if (!url) return <label className="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-dashed border-orange-300 bg-orange-50 px-3 text-xs font-black text-orange-700">{uploading ? 'Uploading...' : 'Upload Missing PO Proof'}<input type="file" accept="image/*,.pdf" className="sr-only" disabled={uploading} onChange={onUpload}/></label>;
  const name = getPoProofName(row);
  const mime = String(row?.poFileMimeType || row?.poProof?.mimeType || '').toLowerCase();
  const image = mime.startsWith('image/') || /\.(?:png|jpe?g|webp|gif)(?:\?|$)/i.test(url);
  return <div className="mt-2 flex items-center gap-2">
    {image && <a href={url} target="_blank" rel="noreferrer" title="Open full PO proof"><img src={url} alt={name} className="h-14 w-14 rounded-lg border border-slate-200 bg-white object-cover shadow-sm" /></a>}
    <div className="flex flex-col items-start gap-1">
      <a href={url} target="_blank" rel="noreferrer" className="font-black text-blue-600 underline">View PO Proof</a>
      <a href={url} download={name} target="_blank" rel="noreferrer" className="text-[10px] font-bold text-slate-500 hover:text-slate-800">Download · {name}</a>
    </div>
  </div>;
}

function normalizePoApprovalRow(row = {}) {
  const quotationItems = Array.isArray(row.quotationItems) ? row.quotationItems : [];
  const itemTotal = quotationItems.reduce((sum, item) => sum + (Number(item.unit) || 1) * (Number(item.basicAmount) || 0), 0);
  const isSystemQuotation = String(row.quotationSent || '').toLowerCase() === 'yes' || Boolean(row.quotationId || row.quotationNumber);
  const recordedQuotationPrice = Number(row.quotationBasicAmount);
  const resolvedUrl = getPoProofUrl(row) || row.poFileUrl || row.proofUrl || '';
  const resolvedName = getPoProofName(row) || row.poFileName || '';
  return {
    ...row,
    poAmountValue: Number(row.poAmount) > 0 ? Number(row.poAmount) : null,
    isSystemQuotation,
    basicAmountValue: isSystemQuotation
      ? (Number.isFinite(recordedQuotationPrice) && recordedQuotationPrice > 0 ? recordedQuotationPrice : (itemTotal || null))
      : null,
    proofUrl: resolvedUrl,
    poFileUrl: resolvedUrl,
    poFileName: resolvedName,
    hasPoFileUrl: Boolean(_isUsableProofValue(resolvedUrl))
  };
}

function normalizeApprovalPoRows(approval = {}) {
  const payload = approval.payload || {};
  const rows = getApprovalPoRows(payload);
  const sourceRows = rows.length ? rows : (payload.poNumber || payload.poAmount || getPoProofUrl(payload) || getPoProofUrl(approval) ? [payload] : []);
  return sourceRows.map((row, rowIndex) => {
    const normalized = resolveCanonicalPoProof(approval, row, rowIndex);
    const rowWithQuotationSource = { ...normalized, quotationSent: normalized.quotationSent || payload.quotationSent || '' };
    return { ...normalizePoApprovalRow(rowWithQuotationSource), poFileUrl: normalized.poFileUrl, poFileName: normalized.poFileName, poFileMimeType: normalized.poFileMimeType, hasPoFileUrl: normalized.hasPoFileUrl };
  });
}

function SubmittedPoReview({ approval }) {
  const rows = normalizeApprovalPoRows(approval);
  const showQuotationPrice = rows.some((row) => row.isSystemQuotation);
  const headings = ['EPR / Service Period', 'PO Number', 'PO Date', 'PO End Date', 'PO Financial Year', 'Annual Return Year', 'Payment Term', ...(showQuotationPrice ? ['Quotation Price (INR)'] : []), 'PO Amount (INR)', 'PO Proof', 'Service', 'Applicant', 'Sub-applicant'];
  return <section className="pending-po-submitted"><header><strong>Submitted PO Details</strong><span>{rows.length} PO records</span></header><div className="pending-po-submitted-scroll"><table><thead><tr>{headings.map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((po, index) => <tr key={`${po.poNumber || 'po'}-${index}`}><td>{po.fy || 'Not recorded'}</td><td><strong>{po.poNumber || 'Not recorded'}</strong></td><td>{formatDisplayDate(po.poDate, 'Not recorded')}</td><td>{formatDisplayDate(po.poEndDate, 'Not recorded')}</td><td>{po.poFinancialYear || 'Not recorded'}</td><td>{po.annualReturnYear || 'Not recorded'}</td><td className="pending-po-payment">{po.paymentTerm || 'Not recorded'}</td>{showQuotationPrice && <td>{po.isSystemQuotation && po.basicAmountValue != null ? <><strong>₹{po.basicAmountValue.toLocaleString('en-IN')}</strong>{po.quotationNumber && <small className="block text-slate-500">{po.quotationNumber}</small>}</> : 'Not recorded'}</td>}<td>{po.poAmountValue != null ? `₹${po.poAmountValue.toLocaleString('en-IN')}` : 'Not recorded'}</td><td>{po.poFileUrl ? <PoProofView po={po} /> : 'Proof not attached'}</td><td>{(Array.isArray(po.services) ? po.services.join(', ') : po.service) || approval.payload?.service?.servicesOffered || 'Not recorded'}</td><td>{resolvePoApplicantDetails(approval, po).applicant}</td><td>{resolvePoApplicantDetails(approval, po).subApplicant}</td></tr>)}{!rows.length && <tr><td colSpan={headings.length}>No PO rows were recorded in this submission.</td></tr>}</tbody></table></div>{approval.payload?.earlierQuotationProofUrl && <a href={approval.payload.earlierQuotationProofUrl} target="_blank" rel="noopener noreferrer" className="pending-po-earlier-proof">View earlier quotation proof</a>}</section>;
}

function PoApprovalDetails({ row }) {
  const quotationItem = Array.isArray(row?.quotationItems) ? row.quotationItems[0] || {} : {};
  const details = [
    ['FY / Service Period', row?.fy || quotationItem.servicesForYear || quotationItem.financialYear],
    ['Industry Type', quotationItem.industryType],
    ['Business Category', quotationItem.businessCategory],
    ['Service Category', quotationItem.serviceCategory || quotationItem.eprCategory],
    ['Service Start', quotationItem.serviceStartDate],
    ['Service End', quotationItem.serviceEndDate],
    ['Applicant Type', quotationItem.subApplicantType || quotationItem.piboCategory || quotationItem.applicantType],
    ['Unit', quotationItem.unit || '1'],
    ['UOM', quotationItem.unitLabel],
    ['Basic Amount', quotationItem.basicAmount != null ? `₹${Number(quotationItem.basicAmount || 0).toLocaleString('en-IN')}` : null]
  ];
  return <article className="mb-3 min-w-[440px] rounded-xl border border-slate-200 bg-slate-50 p-3 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-slate-950">{row?.poNumber || 'PO number unavailable'}</strong><span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-black text-emerald-700">{row?.currency || 'INR'} {row?.poAmount == null ? '-' : Number(row.poAmount).toLocaleString('en-IN')}</span></div>
    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-3">{details.map(([label, value]) => <div key={label}><small className="block text-[9px] font-black uppercase tracking-wide text-slate-400">{label}</small><span className="text-xs font-bold text-slate-700">{formatApprovalValue(value)}</span></div>)}</div>
    <div className="mt-3 text-[10px] font-bold uppercase text-slate-500">Services: {Array.isArray(row?.services) ? row.services.map((service) => formatApprovalValue(service)).join(', ') || '-' : '-'}</div>
  </article>;
}

function applyBulkLeadCreators(clients = [], leads = []) {
  const byKey = new Map();
  leads.forEach((lead) => {
    [lead._id, lead.id, lead.sourceLeadId, lead.leadCode].forEach((value) => {
      const key = String(value || '').trim().toLowerCase();
      if (key) byKey.set(key, lead);
    });
  });

  return clients.map((row) => {
    const client = row.payload || {};
    const selectedLead = client.selectedLead || {};
    const selectedLeadId = typeof selectedLead === 'object' ? (selectedLead._id || selectedLead.id) : selectedLead;
    const leadNumber = client.data?.importMeta?.leadNumber || row.leadNumber || '';
    const lead = [selectedLeadId, leadNumber]
      .map((value) => byKey.get(String(value || '').trim().toLowerCase()))
      .find(Boolean);
    const isBulkLead = Boolean(String(lead?.sourceLeadId || leadNumber || '').trim());
    const originalCreator = String(lead?.importedCreatedBy || '').trim();
    const assignedName = String(lead?.assignedTo?.name || lead?.assignedToText || lead?.assignedToEmail || '').trim();
    const leadCreator = /^demo(?:\s+demo)?$/i.test(originalCreator) && assignedName ? assignedName : originalCreator;
    return isBulkLead && leadCreator ? { ...row, createdBy: leadCreator, leadCreatedBy: leadCreator } : row;
  });
}

function applyBulkQuotationOwners(quotations = [], leads = []) {
  const byKey = new Map();
  leads.forEach((lead) => {
    [lead._id, lead.id, lead.sourceLeadId, lead.leadCode].forEach((value) => {
      const key = String(value || '').trim().toLowerCase();
      if (key) byKey.set(key, lead);
    });
  });
  return quotations.map((row) => {
    const lead = [row.leadId, row.sourceLeadId, row.businessLeadCode, row.leadCode]
      .map((value) => byKey.get(String(value || '').trim().toLowerCase()))
      .find(Boolean);
    if (!lead?.sourceLeadId) return row;
    const originalCreator = String(lead.importedCreatedBy || '').trim();
    const assignedName = String(lead.assignedTo?.name || lead.assignedToText || lead.assignedToEmail || '').trim();
    const creator = /^demo(?:\s+demo)?$/i.test(originalCreator) && assignedName ? assignedName : originalCreator;
    return {
      ...row,
      userName: assignedName || creator || row.userName,
      leadGeneratedBy: creator || row.leadGeneratedBy,
      createdBy: creator || row.createdBy
    };
  });
}

function hydratePurchaseOrderApprovals(approvals = [], leads = []) {
  return approvals.map((approval) => {
    if (approval.type !== 'purchase_order') return approval;
    const payload = approval.payload || {};
    const approvalLeadKeys = [payload.leadId, payload.leadCode].map((value) => String(value || '')).filter(Boolean);
    const lead = leads.find((row) => [row._id, row.id, row.sourceLeadId, row.leadCode]
      .some((value) => approvalLeadKeys.includes(String(value || ''))));
    if (!lead) return approval;
    const assignments = Array.isArray(lead.assignments) ? lead.assignments : [];
    const assignment = assignments.find((row) => payload.assignedServiceId && String(row?.assignedServiceId || '') === String(payload.assignedServiceId))
      || assignments[Number(payload.assignmentIndex)]
      || {};
    const snapshotRows = getApprovalPoRows(payload);
    const manifest = Array.isArray(payload.poProofManifest) ? payload.poProofManifest : [];
    // Helper: resolve proof through snapshot → manifest → row explicitly using poProof-aware lookup.
    // Live rows (from Lead doc) can be empty strings or garbage objects for quotationSent=yes legacy rows.
    const resolveProof = (snapshotRow, liveRow, rowIndex, rowPoNumber = '') => {
      const manifestRow = rowPoNumber
        ? manifest.find((entry) => entry && String(entry.poNumber || '').trim() === rowPoNumber)
        : (manifest[rowIndex] || null);
      const sources = [snapshotRow || {}, manifestRow || {}, liveRow || {}, payload || {}, approval || {}].filter(Boolean);
      // Aggressive 5-layer + nested object composite union: feed all merged sources through
      // getPoProofUrl (which now does a _deepFindProofField scan recursively for any cloudinary URL).
      const composite = Object.assign({}, ...sources);
      const proofSource = sources.find((source) => getPoProofUrl(source)) || composite;
      const nameSource = sources.find((source) => getPoProofName(source) && getPoProofName(source) !== 'PO proof') || proofSource || composite;
      const url = getPoProofUrl(proofSource)
        || (String(snapshotRow?.poFileUrl || '').trim() && !/\[object/i.test(String(snapshotRow.poFileUrl || '')) ? String(snapshotRow.poFileUrl).trim() : '')
        || (String(manifestRow?.poFileUrl || '').trim() && !/\[object/i.test(String(manifestRow.poFileUrl || '')) ? String(manifestRow.poFileUrl).trim() : '')
        || (String(liveRow?.poFileUrl || '').trim() && !/\[object/i.test(String(liveRow.poFileUrl || '')) ? String(liveRow.poFileUrl).trim() : '')
        || getPoProofUrl(composite)
        || '';
      const name = getPoProofName(nameSource)
        || (String(snapshotRow?.poFileName || '').trim() && !/\[object/i.test(String(snapshotRow.poFileName || '')) ? String(snapshotRow.poFileName).trim() : '')
        || (String(manifestRow?.poFileName || '').trim() && !/\[object/i.test(String(manifestRow.poFileName || '')) ? String(manifestRow.poFileName).trim() : '')
        || (String(liveRow?.poFileName || '').trim() && !/\[object/i.test(String(liveRow.poFileName || '')) ? String(liveRow.poFileName).trim() : '')
        || getPoProofName(composite)
        || 'PO proof';
      const mime = [snapshotRow, manifestRow, liveRow, composite].map((value) => String(value?.poFileMimeType || value?.mimeType || value?.type || '').trim()).find((value) => value) || '';
      const size = [snapshotRow, manifestRow, liveRow, composite].map((value) => (value?.poFileSize != null && Number.isFinite(Number(value.poFileSize)) ? Number(value.poFileSize) : (Number.isFinite(Number(value?.bytes)) ? Number(value.bytes) : (Number.isFinite(Number(value?.size)) ? Number(value.size) : null)))).find((value) => value != null);
      // Diagnostic: if still no URL after every fallback, log what we have so user can share.
      if (!url && typeof console !== 'undefined') {
        console.debug('[POProof:hydrate:fail]', {
          leadCode: payload.leadCode || approval.leadCode, approvalId: approval._id || approval.id,
          rowIndex, rowPoNumber,
          // Keys that EXIST in source trees (non-empty non-object top-level)
          candidate: {
            snapshotUrl: snapshotRow?.poFileUrl, manifestUrl: manifestRow?.poFileUrl,
            liveUrl: liveRow?.poFileUrl, snapshotKeys: snapshotRow ? Object.keys(snapshotRow) : [],
            manifestKeys: manifestRow ? Object.keys(manifestRow) : [],
            liveKeys: liveRow ? Object.keys(liveRow) : [],
            deepAnywhere: _deepFindProofField(composite, 'url')
          }
        });
      }
      return { poFileUrl: url, poFileName: name, poFileMimeType: mime, poFileSize: size };
    };
    const snapshotPoNumber = (row) => String(row?.poNumber || '').trim();
    const livePoRowsAll = Array.isArray(assignment.poYearRows) ? assignment.poYearRows.filter(Boolean) : [];
    // Match snapshot rows to live rows robustly:
    // 1. Exact poNumber match (non-empty on both sides)
    // 2. Index-based match ONLY when row counts are equal (so alignment is guaranteed)
    // 3. Otherwise keep the snapshot row (trusted source written at approval time)
    const livePoRows = livePoRowsAll.filter((row) => {
      const hasAnyPo = snapshotPoNumber(row) || Number(row?.poAmount) > 0 || Boolean(getPoProofUrl(row));
      return hasAnyPo;
    });
    let mergedPoRows = [];
    if (snapshotRows.length && !livePoRows.length) {
      // No live rows exist (pure snapshot scenario) → use snapshot + manifest enrichment.
      mergedPoRows = snapshotRows.map((snapshot, idx) => {
        const proof = resolveProof(snapshot, null, idx, snapshotPoNumber(snapshot));
        return { ...snapshot, ...proof, hasPoFileUrl: Boolean(proof.poFileUrl) };
      });
    } else if (snapshotRows.length === livePoRows.length) {
      // Row counts match → safe 1:1 index + poNumber cross-match.
      mergedPoRows = livePoRows.map((liveRow, idx) => {
        const poNumber = snapshotPoNumber(liveRow);
        const snapshot = poNumber
          ? snapshotRows.find((row) => snapshotPoNumber(row) === poNumber) || snapshotRows[idx] || {}
          : snapshotRows[idx] || {};
        const proof = resolveProof(snapshot, liveRow, idx, poNumber);
        return {
          ...snapshot,
          ...liveRow,
          ...proof,
          // Structural metadata snapshot → live (quotationSent=yes rows).
          quotationSent: String(liveRow?.quotationSent || snapshot?.quotationSent || payload.quotationSent || '').toLowerCase(),
          quotationId: liveRow?.quotationId || snapshot?.quotationId || '',
          quotationNumber: liveRow?.quotationNumber || snapshot?.quotationNumber || '',
          quotationBasicAmount: resolveQuotationBasicAmount(liveRow?.quotationBasicAmount, snapshot?.quotationBasicAmount),
          quotationItems: Array.isArray(liveRow?.quotationItems) && liveRow.quotationItems.length ? liveRow.quotationItems : (snapshot?.quotationItems || []),
          hasPoFileUrl: Boolean(proof.poFileUrl)
        };
      });
    } else {
      // Row count mismatch (common for quotationSent=yes). DO NOT overwrite snapshot with
      // different-cardinality live rows; instead enrich each snapshot row independently and
      // attempt to locate the matching live row if possible.
      mergedPoRows = snapshotRows.map((snapshot, idx) => {
        const poNumber = snapshotPoNumber(snapshot);
        const liveRow = (poNumber ? livePoRows.find((row) => snapshotPoNumber(row) === poNumber) : livePoRows[idx]) || null;
        const proof = resolveProof(snapshot, liveRow, idx, poNumber);
        return {
          ...snapshot,
          ...(liveRow || {}),
          ...proof,
          quotationSent: String(liveRow?.quotationSent || snapshot.quotationSent || payload.quotationSent || '').toLowerCase(),
          quotationId: liveRow?.quotationId || snapshot.quotationId || '',
          quotationNumber: liveRow?.quotationNumber || snapshot.quotationNumber || '',
          quotationBasicAmount: resolveQuotationBasicAmount(liveRow?.quotationBasicAmount, snapshot.quotationBasicAmount),
          quotationItems: Array.isArray(liveRow?.quotationItems) && liveRow.quotationItems.length ? liveRow.quotationItems : (snapshot.quotationItems || []),
          hasPoFileUrl: Boolean(proof.poFileUrl)
        };
      });
    }
    return {
      ...approval,
      payload: {
        ...payload,
        leadCode: payload.leadCode || lead.leadCode || '',
        service: payload.service || (lead.serviceSelections || [])[Number(payload.assignmentIndex)] || {},
        poYearRows: mergedPoRows.length ? mergedPoRows : snapshotRows
      }
    };
  });
}

function getApprovalStatus(row) {
  return String(row?.approvalStatus || row?.status || 'PENDING').toUpperCase();
}

function rowMatchesSearch(row, query) {
  if (!query.trim()) return true;
  const needle = query.trim().toLowerCase();
  return Object.values(row || {}).some((value) => formatApprovalValue(value).toLowerCase().includes(needle));
}

function readError(err, fallback) {
  return err?.response?.data?.error || fallback;
}

function isSoftApprovalLoadError(err) {
  return err?.code === 'ECONNABORTED' || err?.message === 'Network Error' || !err?.response;
}

export default function PendingApproval({ embedded = false, companyOnly = false }) {
  const ApprovalShell = embedded ? React.Fragment : DashboardShell;
  const [currentUser, setCurrentUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  });
  const [profileOpen, setProfileOpen] = useState(false);
  const [clientReviewSelection, setClientReviewSelection] = useState(null);
  const cachedApprovalData = useMemo(() => readPendingApprovalCache(currentUser), []);
  const [pendingClients, setPendingClients] = useState(() => cachedApprovalData?.pendingClients || []);
  const [pendingQuotations, setPendingQuotations] = useState(() => cachedApprovalData?.pendingQuotations || []);
  const [duplicateLeadApprovals, setDuplicateLeadApprovals] = useState([]);
  const [serviceApprovals, setServiceApprovals] = useState([]);
  const [serviceApprovalDetail, setServiceApprovalDetail] = useState(null);
  const [serviceRejection, setServiceRejection] = useState(null);
  const [clientDecision, setClientDecision] = useState(null);
  const [royaltyApprovals, setRoyaltyApprovals] = useState([]);
  const [temporaryApprovals, setTemporaryApprovals] = useState([]);
  const [temporaryDecision, setTemporaryDecision] = useState(null);
  const [poApprovals, setPoApprovals] = useState([]);
  const [poDecision, setPoDecision] = useState(null);
  const [quotationDecision, setQuotationDecision] = useState(null);
  const [approvalInputs, setApprovalInputs] = useState({});
  const [loading, setLoading] = useState(() => !cachedApprovalData);
  const [profileSaving, setProfileSaving] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [debugInfo, setDebugInfo] = useState(null);
  const [deactivationCount, setDeactivationCount] = useState(0);
  const [activeTab, setActiveTab] = useState('clients');
  const [clientPage, setClientPage] = useState(1);
  const [quotePage, setQuotePage] = useState(1);
  const [poPage, setPoPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [piboFilter, setPiboFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const loadRequestRef = useRef(0);
  const navigate = useNavigate();
  const location = useLocation();
  const effectiveRoles = getUserRoles(currentUser);
  const normalizedRole = effectiveRoles.join('|');
  const canApprove = hasAnyRole(currentUser, adminRoles);
  const isSuperAdmin = hasAnyRole(currentUser, ['superadmin']);
  const primaryRole = String(currentUser?.role || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  const isQuotationSuperAdmin = primaryRole === 'superadmin' || (!primaryRole && hasAnyRole(currentUser, ['superadmin']));
  const canAdminApproveQuotation = primaryRole === 'admin' || (!primaryRole && hasAnyRole(currentUser, ['admin']) && !isQuotationSuperAdmin);
  const canApproveTemporary = hasAnyRole(currentUser, ['admin', 'superadmin']);
  const isComplianceApprovalView = companyOnly || hasAnyRole(currentUser, ['compliance']) && !canApprove;
  const isServiceParticipantView = !canApprove && !isComplianceApprovalView;
  const canApproveClients = canApprove || isComplianceApprovalView;

  useEffect(() => {
    if (location.state?.approvalNotice) setNotice(location.state.approvalNotice);
  }, [location.state?.approvalNotice]);

  const allApprovalRows = useMemo(() => isComplianceApprovalView
    ? pendingClients
    : isServiceParticipantView
      ? serviceApprovals
      : [...pendingClients, ...pendingQuotations, ...duplicateLeadApprovals, ...serviceApprovals, ...royaltyApprovals, ...temporaryApprovals, ...poApprovals], [isComplianceApprovalView, isServiceParticipantView, pendingClients, pendingQuotations, duplicateLeadApprovals, serviceApprovals, royaltyApprovals, temporaryApprovals, poApprovals]);
  const piboOptions = useMemo(() => {
    const values = allApprovalRows
      .map((row) => formatApprovalValue(row?.piboCategory))
      .filter((value) => value && value !== '-');
    return [...new Set(values)].sort((a, b) => a.localeCompare(b));
  }, [allApprovalRows]);
  const approvalUserName = (row) => formatApprovalValue(row?.createdBy || row?.submittedBy || row?.createdByName || row?.userName || row?.claimedBy || row?.leadGeneratedBy);
  const userOptions = useMemo(() => [...new Set(allApprovalRows.map(approvalUserName).filter((value) => value && value !== '-'))].sort((a, b) => a.localeCompare(b)), [allApprovalRows]);
  const filterRow = (row) => {
    const statusMatches = statusFilter === 'all' || getApprovalStatus(row) === statusFilter;
    const piboMatches = piboFilter === 'all' || formatApprovalValue(row?.piboCategory) === piboFilter;
    const userMatches = userFilter === 'all' || approvalUserName(row) === userFilter;
    return statusMatches && piboMatches && userMatches && rowMatchesSearch(row, searchTerm);
  };
  const filteredClients = useMemo(() => (
    !['all', 'clients'].includes(typeFilter) ? [] : pendingClients.filter(filterRow)
  ), [pendingClients, searchTerm, statusFilter, piboFilter, userFilter, typeFilter]);
  const filteredQuotations = useMemo(() => (
    !['all', 'quotations'].includes(typeFilter) ? [] : pendingQuotations.filter(filterRow)
  ), [pendingQuotations, searchTerm, statusFilter, piboFilter, userFilter, typeFilter]);
  const filteredDuplicateLeads = useMemo(() => !['all', 'duplicates'].includes(typeFilter) ? [] : duplicateLeadApprovals.filter(filterRow), [duplicateLeadApprovals, searchTerm, statusFilter, userFilter, typeFilter]);
  const filteredRoyalty = useMemo(() => !['all', 'royalty'].includes(typeFilter) ? [] : royaltyApprovals.filter(filterRow), [royaltyApprovals, searchTerm, statusFilter, userFilter, typeFilter]);
  const filteredServices = useMemo(() => !['all', 'services'].includes(typeFilter) ? [] : serviceApprovals.filter(filterRow), [serviceApprovals, searchTerm, statusFilter, userFilter, typeFilter]);
  const filteredTemporary = useMemo(() => !['all', 'temporary'].includes(typeFilter) ? [] : temporaryApprovals.filter(filterRow), [temporaryApprovals, searchTerm, statusFilter, userFilter, typeFilter]);
  const filteredPoApprovals = useMemo(() => !['all', 'po'].includes(typeFilter) ? [] : poApprovals.filter(filterRow), [poApprovals, searchTerm, statusFilter, piboFilter, userFilter, typeFilter]);
  const approvedTodayCount = useMemo(() => (
    allApprovalRows.filter((row) => getApprovalStatus(row) === 'APPROVED').length
  ), [allApprovalRows]);
  const approvedQuotationCount = useMemo(() => (
    pendingQuotations.filter((row) => getApprovalStatus(row) === 'APPROVED').length
  ), [pendingQuotations]);
  const rejectedCount = useMemo(() => (
    allApprovalRows.filter((row) => getApprovalStatus(row) === 'REJECTED').length
  ), [allApprovalRows]);

  const clientTotalPages = Math.max(1, Math.ceil(filteredClients.length / rowsPerPage));
  const quoteTotalPages = Math.max(1, Math.ceil(filteredQuotations.length / rowsPerPage));
  const poTotalPages = Math.max(1, Math.ceil(filteredPoApprovals.length / rowsPerPage));

  const visibleClients = useMemo(() => (
    filteredClients.slice((clientPage - 1) * rowsPerPage, clientPage * rowsPerPage)
  ), [clientPage, filteredClients]);

  const visibleQuotations = useMemo(() => (
    filteredQuotations.slice((quotePage - 1) * rowsPerPage, quotePage * rowsPerPage)
  ), [filteredQuotations, quotePage]);

  const visiblePoApprovals = useMemo(() => (
    filteredPoApprovals.slice((poPage - 1) * rowsPerPage, poPage * rowsPerPage)
  ), [filteredPoApprovals, poPage]);

  const approvalTabs = useMemo(() => {
    if (companyOnly) return [{ id: 'clients', icon: Clock3, label: 'Pending Clients', count: filteredClients.length }];
    const list = [{ id: 'deactivation', icon: Users, label: 'Client Deactivation', count: deactivationCount }];
    if (isServiceParticipantView) {
      list.push({ id: 'services', icon: FileText, label: 'Pending Service Approvals', count: filteredServices.length });
      return list;
    }
    if (canApproveClients) {
      list.push({ id: 'clients', icon: Clock3, label: 'Pending Clients', count: filteredClients.length });
    }
    if (canApproveTemporary) {
      list.push({ id: 'temporary', icon: Users, label: 'Temporary Assignments', count: filteredTemporary.length });
    }
    if (!isComplianceApprovalView) {
      list.push({ id: 'po', icon: FileCheck2, label: 'PO Approval', count: filteredPoApprovals.length });
      list.push({ id: 'quotations', icon: FileText, label: 'Pending Quotations', count: filteredQuotations.length });
      list.push({ id: 'royalty', icon: Users, label: 'Royalty Claims', count: filteredRoyalty.length });
      list.push({ id: 'services', icon: FileText, label: 'Pending Service Approvals', count: filteredServices.length });
      list.push({ id: 'duplicates', icon: Users, label: 'Special Approvals', count: filteredDuplicateLeads.length });
    }
    return list;
  }, [companyOnly, deactivationCount, canApproveClients, canApproveTemporary, isComplianceApprovalView, isServiceParticipantView, filteredClients.length, filteredTemporary.length, filteredPoApprovals.length, filteredQuotations.length, filteredRoyalty.length, filteredServices.length, filteredDuplicateLeads.length]);

  useEffect(() => {
    let mounted = true;
    api.get('/clients/deactivation-requests').then((response) => { if (mounted) setDeactivationCount((response.data.requests || []).filter((row) => row.canDecide).length); }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  function handleTabChange(tabId) {
    if (tabId && typeof tabId === 'string') {
      setActiveTab(tabId);
      setTypeFilter(tabId);
      if (tabId === 'clients') setStatusFilter('PENDING');
    }
  }

  useEffect(() => {
    loadPage({ silent: Boolean(cachedApprovalData) });
  }, []);

  useEffect(() => {
    const tab = new URLSearchParams(location.search).get('tab');
    if (tab === 'deactivation') { setActiveTab('deactivation'); return; }
    if (isComplianceApprovalView) {
      setActiveTab('clients');
      setTypeFilter('clients');
      setStatusFilter('PENDING');
      return;
    }
    if (isServiceParticipantView) {
      setActiveTab('services');
      setTypeFilter('services');
      setStatusFilter('all');
      return;
    }
    if (tab === 'clients' || tab === 'quotations' || tab === 'duplicates' || tab === 'royalty' || tab === 'services' || tab === 'po') setActiveTab(tab);
    else setActiveTab('quotations');
  }, [isComplianceApprovalView, isServiceParticipantView, location.search, normalizedRole]);

  useEffect(() => {
    setClientPage(1);
    setQuotePage(1);
    setPoPage(1);
  }, [searchTerm, typeFilter, statusFilter, piboFilter, userFilter]);

  useEffect(() => {
    if (poPage > poTotalPages) setPoPage(poTotalPages);
  }, [poPage, poTotalPages]);

  function resetFilters() {
    setSearchTerm('');
    setTypeFilter(isComplianceApprovalView ? 'clients' : isServiceParticipantView ? 'services' : 'all');
    setStatusFilter(isComplianceApprovalView ? 'PENDING' : 'all');
    setPiboFilter('all');
    setUserFilter('all');
  }

  function openMetric(type, status = 'PENDING') {
    const preferredTab = type || (canApproveClients ? 'clients' : 'quotations');
    setActiveTab(preferredTab);
    setTypeFilter(preferredTab);
    setStatusFilter(status);
    setSearchTerm('');
    setPiboFilter('all');
    setUserFilter('all');
    document.querySelector('.pending-approval-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function loadPage(options = {}) {
    const requestId = ++loadRequestRef.current;
    const cached = !options.force ? readPendingApprovalCache(currentUser) : null;
    const authRequestConfig = { timeout: PENDING_APPROVAL_AUTH_TIMEOUT_MS };
    const dataRequestConfig = {
      timeout: PENDING_APPROVAL_DATA_TIMEOUT_MS,
      params: { _: Date.now() }
    };
    if (cached && !options.force) {
      setPendingClients(cached.pendingClients || []);
      setPendingQuotations(cached.pendingQuotations || []);
      if (cached.currentUser) setCurrentUser((stored) => ({
        ...(stored || {}),
        ...cached.currentUser,
        avatarUrl: cached.currentUser.avatarUrl || stored?.avatarUrl || stored?.avatar || stored?.profileImage || ''
      }));
      setLoading(false);
    } else if (options.force || !options.silent) {
      setLoading(true);
    }
    setError('');

    try {
      const [meResult, approvalsResult] = await Promise.allSettled([
        api.get(API_ENDPOINTS.auth.me, authRequestConfig),
        api.get(API_ENDPOINTS.clients.pendingApprovals, dataRequestConfig)
      ]);

      const meResponse = meResult.status === 'fulfilled' ? meResult.value : null;
      const approvalsResponse = approvalsResult.status === 'fulfilled' ? approvalsResult.value : null;
      const crmLeads = [];

      if (meResponse?.data?.user) {
        setCurrentUser(meResponse.data.user);
        storeSessionUser(meResponse.data.user);
      }

      if (!approvalsResponse) {
        throw approvalsResult.reason || new Error('Unable to load pending approvals');
      }
      if (requestId !== loadRequestRef.current) return;

      const snapshot = {
        currentUser: meResponse?.data?.user || currentUser || cached?.currentUser || cachedApprovalData?.currentUser || null,
        pendingClients: applyBulkLeadCreators(approvalsResponse.data.pendingClients || [], crmLeads),
        pendingQuotations: applyBulkQuotationOwners(approvalsResponse.data.pendingQuotations || [], crmLeads),
        debug: approvalsResponse.data.debug || null
      };
      setPendingClients(snapshot.pendingClients);
      setPendingQuotations(snapshot.pendingQuotations);
      setDebugInfo(snapshot.debug);
      console.info('[PendingApproval:loaded]', {
        clients: snapshot.pendingClients.length,
        quotations: snapshot.pendingQuotations.length,
        debug: snapshot.debug
      });
      writePendingApprovalCache(snapshot);
      setClientPage(1);
      setQuotePage(1);
      if (!options.silent || !cached) setLoading(false);

      // Load the heavier special/PO approval feed after the primary client and
      // quotation response is visible. A slow PO enrichment must not hold the
      // whole Pending Approval screen at zero until the data timeout expires.
      const [duplicateResult] = await Promise.allSettled([
        api.get(API_ENDPOINTS.leads.duplicateApprovals, dataRequestConfig)
      ]);
      if (requestId !== loadRequestRef.current) return;
      const poStorage = duplicateResult.status === 'fulfilled' ? duplicateResult.value.data?.poStorage : null;
      if (poStorage) console.info('[POProof:database:locations]', poStorage);
      const leadApprovals = hydratePurchaseOrderApprovals(duplicateResult.status === 'fulfilled' ? (duplicateResult.value.data?.approvals || []) : [], crmLeads).map((approval) => {
        if (approval.type === 'lead_service') {
          const leadId = String(approval.payload?.leadId || '');
          const matchingLead = crmLeads.find((lead) => [lead._id, lead.id, lead.sourceLeadId, lead.leadCode]
            .some((id) => String(id || '') === leadId));
          const grouped = new Map();
          (matchingLead?.serviceSelections || []).forEach((service) => {
            const owner = String(
              service.createdByName
              || service.createdByEmail
              || matchingLead.importedCreatedBy
              || approval.payload?.originalCreator
              || 'CRM User'
            ).trim();
            if (!grouped.has(owner)) grouped.set(owner, []);
            grouped.get(owner).push(service);
          });
          const serviceGroups = [...grouped.entries()].map(([user, services]) => ({ user, count: services.length, services }));
          return {
            ...approval,
            payload: {
              ...(approval.payload || {}),
              serviceGroups: serviceGroups.length ? serviceGroups : (approval.payload?.groups || [])
            }
          };
        }
        if (approval.type === 'lead_royalty' || approval.payload?.leadAssignedTo) return approval;
        const existingId = String(approval.payload?.existingLeadId || '');
        const matchingLead = crmLeads.find((lead) => [lead._id, lead.id, lead.sourceLeadId, lead.leadCode].some((id) => String(id || '') === existingId));
        const leadAssignedTo = matchingLead?.assignedTo?.name
          || matchingLead?.assignedToText
          || matchingLead?.assignedStaff?.name
          || matchingLead?.assignedStaffText
          || matchingLead?.assignments?.find((item) => item?.assignedToText || item?.assignedStaffText)?.assignedToText
          || matchingLead?.assignments?.find((item) => item?.assignedStaffText)?.assignedStaffText
          || '';
        return leadAssignedTo ? { ...approval, payload: { ...approval.payload, leadAssignedTo } } : approval;
      });
      setDuplicateLeadApprovals(leadApprovals.filter((row) => !['lead_royalty', 'lead_service', 'lead_temporary', 'purchase_order'].includes(row.type)));
      setServiceApprovals(leadApprovals.filter((row) => row.type === 'lead_service'));
      setRoyaltyApprovals(leadApprovals.filter((row) => row.type === 'lead_royalty'));
      setTemporaryApprovals(leadApprovals.filter((row) => row.type === 'lead_temporary'));
      const normalizedPoApprovals = leadApprovals.filter((row) => row.type === 'purchase_order')
        .map((approval) => ({ ...approval, normalizedPoRows: normalizeApprovalPoRows(approval) }));
      setPoApprovals(normalizedPoApprovals);
      console.groupCollapsed('[POProof:list:normalized]');
      const normalizedRows = normalizedPoApprovals.flatMap((approval) => approval.normalizedPoRows);
      console.table(normalizedRows.map((row) => ({ approvalId: row.approvalId, leadCode: row.leadCode, poNumber: row.poNumber, rowIndex: row.rowIndex, poFileUrl: row.poFileUrl, hasPoFileUrl: row.hasPoFileUrl })));
      console.groupEnd();
      setPoPage(1);
    } catch (err) {
      if (isSoftApprovalLoadError(err)) {
        const fallback = cached || cachedApprovalData || {};
        setPendingClients(fallback.pendingClients || []);
        setPendingQuotations(fallback.pendingQuotations || []);
        setDebugInfo({
          source: 'browser-cache-fallback',
          message: err?.message || 'Request timed out',
          timeout: PENDING_APPROVAL_DATA_TIMEOUT_MS,
          clients: fallback.pendingClients?.length || 0,
          quotations: fallback.pendingQuotations?.length || 0
        });
        console.info('[PendingApproval:fallback]', err?.message || err, fallback);
        if (fallback.currentUser) setCurrentUser(fallback.currentUser);
      } else {
        setError(readError(err, 'Unable to load pending approvals.'));
        setDebugInfo({
          source: 'error',
          status: err?.response?.status,
          message: readError(err, 'Unable to load pending approvals.')
        });
        console.error('[PendingApproval:error]', err);
      }
    } finally {
      if (!options.silent || !cached) setLoading(false);
    }
  }

  function requestClientDecision(row, status) {
    if (!canApproveClients) return;
    setClientDecision({ row, status, note: '' });
  }

  async function updateApproval(row, status, remarks) {
    if (!canApproveClients) return;
    const decisionNote = String(remarks || '').trim();
    if (!decisionNote || decisionNote.length > 250) return;
    const id = row?.id;
    setSavingId(`${id}-${status}`);
    setError('');
    setNotice('');

    try {
      const response = await api.patch(API_ENDPOINTS.clients.approval(id), {
        status,
        approvalRecordId: row?.approvalRecordId,
        source: row?.source,
        uniqueId: row?.uniqueId,
        clientName: row?.clientName || row?.companyName,
        piboCategory: row?.piboCategory,
        eprCategory: row?.eprCategory,
        createdBy: row?.createdBy,
        remarks: decisionNote,
        payload: row?.payload
      });
      setClientDecision(null);
      const emailMessage = response.data?.notification?.sent
        ? ' Decision email sent to the creator.'
        : ' Decision saved, but the creator email could not be sent; verify the creator email address.';
      setNotice(`${row?.clientName || 'Client Master'} ${status.toLowerCase()} successfully.${emailMessage}`);
      await loadPage({ force: true, silent: true });
    } catch (err) {
      setError(readError(err, 'Unable to update approval.'));
    } finally {
      setSavingId('');
    }
  }

  async function submitClientDecision(event) {
    event.preventDefault();
    const note = String(clientDecision?.note || '').trim();
    if (!clientDecision?.row || !note || note.length > 250) return;
    await updateApproval(clientDecision.row, clientDecision.status, note);
  }

  async function submitTemporaryDecision(event) {
    event.preventDefault();
    const remarks = String(temporaryDecision?.remarks || '').trim();
    const wordCount = remarks ? remarks.split(/\s+/).filter(Boolean).length : 0;
    if (!temporaryDecision?.row || !remarks || wordCount > 250) return;
    const id = temporaryDecision.row._id || temporaryDecision.row.id;
    setSavingId(id);
    setError('');
    try {
      await api.patch(API_ENDPOINTS.leads.temporaryAssignmentDecision(id), { decision: temporaryDecision.decision, remarks });
      setNotice(`Temporary assignment ${temporaryDecision.decision === 'APPROVED' ? 'approved for 7 days' : 'rejected'}. Remarks saved in the database audit trail.`);
      setTemporaryDecision(null);
      await loadPage({ force: true, silent: true });
    } catch (err) {
      if (requestId !== loadRequestRef.current) return;
      setError(readError(err, 'Unable to save the temporary assignment decision.'));
    } finally {
      setSavingId('');
    }
  }

  async function uploadPoDecisionScreenshot(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setSavingId('po-screenshot');
    setError('');
    try {
      const uploaded = await uploadMedia(file, 'crm/leads/po-approval-decisions');
      setPoDecision((current) => ({ ...current, screenshotUrl: uploaded.secureUrl, screenshotName: file.name }));
    } catch (err) {
      setError(readError(err, 'Unable to upload the correction screenshot.'));
    } finally {
      setSavingId('');
      event.target.value = '';
    }
  }

  async function uploadMissingPoProof(approval, rowIndex, event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const id = approval._id || approval.id;
    setSavingId(`po-proof-${id}-${rowIndex}`);
    setError('');
    try {
      const poDebugId = globalThis.crypto?.randomUUID?.() || `po-repair-${Date.now()}`;
      console.info('[POProof:repair:start]', { poDebugId, approvalId: id, rowIndex, fileName: file.name, fileSize: file.size });
      const uploaded = await uploadMedia(file, 'crm/leads/purchase-orders');
      console.info('[POProof:repair:cloudinary]', { poDebugId, approvalId: id, rowIndex, hasSecureUrl: Boolean(uploaded.secureUrl), publicId: uploaded.publicId || '' });
      const response = await api.patch(API_ENDPOINTS.leads.purchaseOrderApprovalProof(id), { rowIndex, poFileUrl: uploaded.secureUrl, poFileName: uploaded.name || file.name, poFileMimeType: uploaded.type || file.type || '', poFileSize: uploaded.bytes || uploaded.size || file.size || null }, { headers: { 'X-PO-Debug-ID': poDebugId } });
      console.info('[POProof:repair:saved]', { poDebugId, approvalId: id, rowIndex, approvalHasProof: Boolean(response.data?.approval?.payload?.poYearRows?.[rowIndex]?.poFileUrl), leadUpdated: response.data?.leadUpdated === true });
      setNotice('PO proof uploaded and saved to both the approval record and linked Lead.');
      await loadPage({ force: true, silent: true });
    } catch (err) {
      console.error('[POProof:repair:error]', { approvalId: id, rowIndex, status: err?.response?.status, message: readError(err, 'Unable to upload and save the missing PO proof.') });
      setError(readError(err, 'Unable to upload and save the missing PO proof.'));
    } finally { setSavingId(''); }
  }

  async function openPoDecision(row, status) {
    const id = String(row._id || row.id || '');
    setPoDecision({ row, status, remarks: '', loadingDetails: true, loadError: '' });
    try {
      const response = await api.get(API_ENDPOINTS.leads.purchaseOrderApprovalDecision(id), { timeout: 15000 });
      const fresh = response.data?.approval;
      if (!fresh || String(fresh._id || fresh.id) !== id) throw new Error('Submitted PO details could not be loaded.');
      setPoDecision((current) => current && String(current.row._id || current.row.id) === id && current.status === status ? { ...current, row: fresh, loadingDetails: false, loadError: fresh.approvalStatus === 'PENDING' ? '' : 'This PO has already been reviewed. Refresh the approval list.' } : current);
    } catch (failure) {
      setPoDecision((current) => current && String(current.row._id || current.row.id) === id && current.status === status ? { ...current, loadingDetails: false, loadError: failure.response?.data?.error || failure.message || 'Unable to load PO details. Please retry.' } : current);
    }
  }

  async function submitPoDecision(event) {
    event.preventDefault();
    const remarks = String(poDecision?.remarks || '').trim();
    if (!poDecision?.row || !remarks || poDecision.loadingDetails || poDecision.loadError) return;
    const decision = { ...poDecision, remarks };
    const id = decision.row._id || decision.row.id;
    setSavingId(`po-${id}`);
    setError('');
    setPoDecision(null);
    setPoApprovals((current) => current.map((row) => String(row._id || row.id) === String(id)
      ? { ...row, approvalStatus: decision.status, remarks, actionAt: new Date().toISOString() }
      : row));
    try {
      const response = await api.patch(API_ENDPOINTS.leads.purchaseOrderApprovalDecision(id), { status: decision.status, remarks, screenshotUrl: decision.screenshotUrl || '' });
      const email = response.data?.emailNotification;
      const decisionLabel = decision.status === 'APPROVED' ? 'approved' : decision.status === 'REJECTED' ? 'rejected' : 'returned for revision';
      const emailMessage = email?.failed
        ? ` ${email.sent || 0} email(s) sent; ${email.failed} could not be sent.`
        : email?.sent ? ` Email sent to ${email.sent} responsible user(s).` : ' Decision saved; no recipient email was available.';
      setNotice(`Purchase Order ${decisionLabel}.${emailMessage}`);
      await loadPage({ force: true, silent: true });
    } catch (err) {
      setError(readError(err, 'Unable to save the Purchase Order decision.'));
      await loadPage({ force: true, silent: true });
    } finally {
      setSavingId('');
    }
  }

  async function updateQuotationApproval(row, status, decision = {}) {
    if (!canApprove) return;
    const id = row?.quotationId || row?._id || row?.id;
    setSavingId(`quote-${id}-${status}`);
    setError('');
    setNotice('');

    try {
      const response = await api.patch(API_ENDPOINTS.quotations.approval(id), {
        status,
        approvalRecordId: row?.approvalRecordId,
        remarks: String(decision.remarks || '').trim() || (status === 'APPROVED' ? 'Approved by Super Admin from Pending Approval' : ''),
        proofUrl: decision.proofUrl || '',
        proofName: decision.proofName || ''
      });
      const savedStatus = String(response.data?.quotation?.status || '').toUpperCase();
      if (status === 'APPROVED' && response.data?.adminApprovalStatus !== 'APPROVED' && savedStatus !== 'APPROVED') {
        throw new Error(`Quotation status was not saved as ${status}.`);
      }
      setNotice(response.data?.message || `Quotation ${status.toLowerCase()} successfully.`);
      await loadPage({ force: true, silent: true });
    } catch (err) {
      setError(readError(err, 'Unable to update quotation approval.'));
    } finally {
      setSavingId('');
    }
  }

  async function uploadQuotationDecisionProof(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setSavingId('quotation-proof');
    setError('');
    try {
      const uploaded = await uploadMedia(file, 'crm/quotations/approval-proofs');
      setQuotationDecision((current) => ({ ...current, proofUrl: uploaded.secureUrl, proofName: file.name }));
    } catch (err) {
      setError(readError(err, 'Unable to upload approval proof.'));
    } finally {
      setSavingId('');
      event.target.value = '';
    }
  }

  async function submitQuotationDecision(event) {
    event.preventDefault();
    if (!quotationDecision?.row) return;
    const remarks = String(quotationDecision.remarks || '').trim();
    if (quotationDecision.status === 'REJECTED' && !remarks) return;
    const decision = quotationDecision;
    setQuotationDecision(null);
    if (decision.finalApproval) await finalizeManagementApproval(decision.row, decision);
    else await updateQuotationApproval(decision.row, decision.status, decision);
  }

  function requestQuotationDecision(row, status) {
    setQuotationDecision({ row, status, finalApproval: status === 'APPROVED' && isQuotationSuperAdmin && row.managementApprovalStatus === 'PENDING', remarks: '', proofUrl: '', proofName: '' });
  }

  async function finalizeManagementApproval(row, decision = {}) {
    if (!isQuotationSuperAdmin || getApprovalStatus(row) !== 'PENDING') return;
    const id = row.quotationId || row._id || row.id;
    setSavingId(`management-final-${id}`);
    setError('');
    try {
      const response = await api.patch(API_ENDPOINTS.quotations.managementApprovalFinalize(id), { remarks: decision.remarks || '', proofUrl: decision.proofUrl || '', proofName: decision.proofName || '' });
      setNotice(response.data?.message || 'Quotation received final Super Admin approval.');
      await loadPage({ force: true, silent: true });
    } catch (err) {
      setError(readError(err, 'Unable to complete final Super Admin approval.'));
    } finally {
      setSavingId('');
    }
  }

  async function updateDuplicateLeadApproval(row, status) {
    const isOriginalCreator = String(row?.payload?.originalCreatorId || '') === String(currentUser?._id || currentUser?.id || '');
    if (!canApprove && !(row?.type === 'lead_service' && isOriginalCreator)) return;
    const id = row?._id || row?.id;
    setSavingId(`${id}-${status}`);
    setError('');
    try {
      const values = approvalInputs[id] || {};
      await api.patch(API_ENDPOINTS.leads.duplicateApproval(id), {
        status,
        selectedUserId: values.selectedUserId,
        claimantRatio: values.claimantRatio,
        originalCreatorRatio: values.originalCreatorRatio,
        remarks: values.decisionReason || `${status === 'APPROVED' ? 'Approved' : 'Rejected'} from Pending Approval`
      });
      setNotice(`${row?.type === 'lead_royalty' ? 'Royalty claim' : row?.type === 'lead_service' ? (canApprove ? 'Final additional-service review' : 'Preliminary additional-service review') : 'Special approval request'} ${status.toLowerCase()} successfully.`);
      await loadPage({ force: true, silent: true });
    } catch (err) {
      setError(readError(err, 'Unable to update duplicate lead approval.'));
    } finally {
      setSavingId('');
    }
  }

  function requestServiceDecision(row, status) {
    if (status === 'REJECTED') {
      setServiceRejection({ row, reason: '' });
      return;
    }
    updateDuplicateLeadApproval(row, status);
  }

  async function submitServiceRejection(event) {
    event.preventDefault();
    const reason = String(serviceRejection?.reason || '').trim();
    if (!reason) return;
    const row = serviceRejection.row;
    const id = row._id || row.id;
    setApprovalInputs((current) => ({ ...current, [id]: { ...(current[id] || {}), decisionReason: reason } }));
    setServiceRejection(null);
    setSavingId(`${id}-REJECTED`);
    setError('');
    try {
      await api.patch(API_ENDPOINTS.leads.duplicateApproval(id), { status: 'REJECTED', remarks: reason });
      setNotice(`${canApprove ? 'Final' : 'Preliminary'} service rejection saved successfully.`);
      await loadPage({ force: true, silent: true });
    } catch (err) {
      setError(readError(err, 'Unable to reject this service approval.'));
    } finally {
      setSavingId('');
    }
  }

  function openQuotationDetails(row) {
    const quotationId = row?._id || row?.quotationId || row?.id;
    if (!quotationId) return;
    navigate('/sales/quotations', {
      state: {
        previewQuotationId: quotationId,
        quotationSnapshot: row,
        fromPendingApproval: true
      }
    });
  }

  function reviseQuotation(row) {
    if (getApprovalStatus(row) === 'PENDING') {
      setNotice('Quotation can be revised only after it is approved or rejected.');
      setError('');
      return;
    }
    const quotationId = row?._id || row?.quotationId || row?.id;
    if (!quotationId) return;
    navigate('/sales/quotations', {
      state: {
        editQuotationId: quotationId,
        quotationSnapshot: row,
        fromPendingApproval: true
      }
    });
  }

  async function approveAllPendingClients() {
    if (!canApproveClients) return;
    if (!pendingClients.length) return;
    setSavingId('approve-all');
    setError('');
    setNotice('');

    try {
      const response = await api.patch(API_ENDPOINTS.clients.approveAllPendingClients, {
        remarks: 'Bulk approved from Pending Approval'
      });
      setNotice(`${response.data.approved || 0} pending client approvals completed.`);
      await loadPage({ force: true, silent: true });
    } catch (err) {
      setError(readError(err, 'Unable to approve all pending clients.'));
    } finally {
      setSavingId('');
    }
  }

  function openClientMaster(row) {
    if (!row?.id) return;
    setClientReviewSelection(row);
  }

  async function approveAllPendingQuotations() {
    if (!canApprove) return;
    if (!pendingQuotations.length) return;
    setSavingId('quote-approve-all');
    setError('');
    setNotice('');

    try {
      const response = await api.patch(API_ENDPOINTS.quotations.approveAllPending, {
        remarks: 'Bulk approved from Pending Approval'
      });
      setNotice(`${response.data.approved || 0} pending quotation approvals completed.`);
      await loadPage({ force: true, silent: true });
    } catch (err) {
      setError(readError(err, 'Unable to approve all pending quotations.'));
    } finally {
      setSavingId('');
    }
  }

  async function handleUpdateProfile(profile) {
    setProfileSaving(true);
    try {
      const response = await api.put(API_ENDPOINTS.auth.me, profile);
      setCurrentUser(response.data.user);
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleUpdatePassword(passwords) {
    setProfileSaving(true);
    try {
      await api.put(API_ENDPOINTS.auth.password, passwords);
    } catch (err) {
      throw new Error(readError(err, 'Unable to update password'));
    } finally {
      setProfileSaving(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('login_email');
    navigate('/', { replace: true });
  }

  if (loading && !currentUser && !pendingClients.length && !pendingQuotations.length) {
    return <BrandLoader message="Loading approval desk" />;
  }

  return (
    <ApprovalShell {...(!embedded ? { currentUser, onOpenProfile: () => setProfileOpen(true), onLogout: handleLogout } : {})}>
      <div className="pending-approval-page">
        <div className="pending-approval-shell">
          {!embedded && <header className="pending-approval-hero">
            <div className="pending-approval-title">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="pending-back-button"
                aria-label="Back"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <p>Approval desk</p>
                <h1>Pending Approval</h1>
                <span>Review client masters and quotation requests with a focused approval workflow.</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => loadPage({ force: true })}
              className={`pending-refresh-button ${loading ? 'pending-refresh-loading' : ''}`}
              disabled={loading}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </header>}

          {error && <ToastMessage type="error" className="mt-5">{error}</ToastMessage>}
          {notice && <ToastMessage type="success" className="mt-5">{notice}</ToastMessage>}
          {loading && <div className="page-inline-loader">Refreshing approval data...</div>}

          {!embedded && <div className="pending-metrics">
            {canApproveClients && <Metric icon={Users} label="Pending Clients" value={pendingClients.filter((client) => getApprovalStatus(client) === 'PENDING').length} hint="Needs your review" tone="mint" onClick={() => openMetric('clients')} />}
            {!isComplianceApprovalView && <Metric icon={FileText} label="Pending Quotations" value={pendingQuotations.filter((row) => getApprovalStatus(row) === 'PENDING').length} hint="Needs your review" tone="blue" onClick={() => openMetric('quotations')} />}
            {!isComplianceApprovalView && <Metric icon={Users} label="Special Approvals" value={duplicateLeadApprovals.filter((row) => getApprovalStatus(row) === 'PENDING').length} hint="Lead review" tone="mint" onClick={() => openMetric('duplicates')} />}
            {!isComplianceApprovalView && <Metric icon={Users} label="Royalty Claims" value={royaltyApprovals.filter((row) => getApprovalStatus(row) === 'PENDING').length} hint="Ratio review" tone="blue" onClick={() => openMetric('royalty')} />}
            <Metric icon={CheckCircle2} label="Approved" value={approvedTodayCount} hint="Saved approval history" tone="teal" onClick={() => openMetric(isComplianceApprovalView ? 'clients' : 'quotations', 'APPROVED')} />
            <Metric icon={XCircle} label="Rejected" value={rejectedCount} hint="Since midnight" tone="rose" onClick={() => openMetric(null, 'REJECTED')} />
          </div>}

          <section className="pending-approval-panel">
            {activeTab !== 'deactivation' && <div className="pending-filter-bar">
              <label className="pending-search-field">
                <Search className="h-4 w-4" />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search approval..."
                />
              </label>
              {!isComplianceApprovalView && <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filter approval type">
                <option value="all">All Types</option>
                <option value="clients">Clients</option>
                <option value="quotations">Quotations</option>
                <option value="duplicates">Special Approvals</option>
                <option value="services">Pending Service Approvals</option>
                <option value="royalty">Royalty Claims</option>
                {canApproveTemporary && <option value="temporary">Temporary Assignments</option>}
              </select>}
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter approval status">
                <option value="all">All Status</option>
                <option value="PENDING">Pending</option>
                <option value="PARTIALLY_APPROVED">Partially Approved</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
              </select>
              <select value={piboFilter} onChange={(event) => setPiboFilter(event.target.value)} aria-label="Filter PIBO category">
                <option value="all">All Applicant Types</option>
                {piboOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <select value={userFilter} onChange={(event) => setUserFilter(event.target.value)} aria-label="Filter by user">
                <option value="all">All Users</option>
                {userOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <button type="button" className="pending-reset-button" onClick={resetFilters}>
                <RotateCcw className="h-4 w-4" />
                Reset
              </button>
              <button
                type="button"
                onClick={() => loadPage({ force: true })}
                className={`pending-refresh-button pending-refresh-button-compact ${loading ? 'pending-refresh-loading' : ''}`}
                disabled={loading}
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
            </div>}
            {activeTab !== 'deactivation' && !isComplianceApprovalView && (
              <div className="pending-status-quick-filters" aria-label="Quick approval status filters">
                <span>Quick filter</span>
                <button type="button" className={statusFilter === 'APPROVED' ? 'is-active' : ''} onClick={() => { setActiveTab('quotations'); setTypeFilter('quotations'); setStatusFilter('APPROVED'); }}>
                  <CheckCircle2 className="h-4 w-4" />Approved<b>{approvedQuotationCount}</b>
                </button>
              </div>
            )}
            <div className="pending-tabs-wrap">
              <ApprovalTabs
                tabs={approvalTabs}
                activeTab={activeTab}
                onTabChange={handleTabChange}
              />
            </div>

            {activeTab === 'deactivation' ? <DeactivationApprovals onCountChange={setDeactivationCount} /> : activeTab === 'po' ? (
              <>
                <ApprovalTable title="Purchase Order Approvals" columns={['Company / Lead', 'Service', 'PO Amount', 'PO Proof', 'Basic Amount (INR)', 'Submitted By', 'Status', 'Actions']} emptyText="No Purchase Orders are waiting for approval." page={poPage} totalPages={poTotalPages} showing={visiblePoApprovals.length} total={filteredPoApprovals.length} onPrev={() => setPoPage((value) => Math.max(1, value - 1))} onNext={() => setPoPage((value) => Math.min(poTotalPages, value + 1))}>
                {visiblePoApprovals.map((row) => {
                  const id = row._id || row.id;
                  // 🔴 FINAL FIX: NEVER trust row.normalizedPoRows attached by earlier hydrate runs.
                  // Those could be stale (buggy hydrate version saved broken hasPoFileUrl=false).
                  // Banner diagnostic above table uses fresh normalization and shows OK_DIRECT green pill
                  // for same row — so delete attached property, forcing fresh normalize every render.
                  try { delete row.normalizedPoRows; } catch { /* ignore strict */ try { Object.defineProperty(row, 'normalizedPoRows', { value: undefined, writable: true, configurable: true }); } catch { /* ignore */ } }
                  const normalizedPoRows = normalizeApprovalPoRows(row);
                  // Legacy repair row: go through FULL resolveCanonicalPoProof chain (not just normalizePoApprovalRow)
                  // so that any proof stored ANYWHERE (payload snapshot, manifest, lead assignment, deep nested)
                  // is recovered even when no canonical poYearRows array exists for this approval yet.
                  const poRows = normalizedPoRows.length
                    ? normalizedPoRows
                    : (() => {
                        const payload = row.payload || {};
                        const pseudo = { ...payload, poNumber: payload.poNumber || row.uniqueId || '' };
                        const canonical = resolveCanonicalPoProof(row, pseudo, 0);
                        return [normalizePoApprovalRow({ ...canonical, proofUrl: canonical.poFileUrl || canonical.proofUrl, poFileUrl: canonical.poFileUrl, hasPoFileUrl: canonical.hasPoFileUrl || Boolean(getPoProofUrl(canonical)) })];
                      })();
                  const renderKey = `po-approval-${String(id || '').slice(-8)}-${poRows.length}-${String(row.payload?.leadCode || row.uniqueId || '')}`;
                  row.approStatus = row.approvalStatus;
                  return <tr key={renderKey}>
                    <Cell strong>{row.clientName}<small className="mt-1 block text-xs text-slate-400">{row.payload?.leadCode || row.uniqueId || '-'}</small></Cell>
                    <Cell>{row.payload?.service?.servicesOffered || row.payload?.service?.applicableService || row.eprCategory || '-'}</Cell>
                    <Cell>{poRows.map((po) => <div key={`${po.approvalId || id}-${po.rowIndex ?? 0}-${po.poNumber || 'po'}-amount`} className="mb-1 font-black text-emerald-700">{po.poAmountValue ? `₹${po.poAmountValue.toLocaleString('en-IN')}` : '-'}<small className="ml-1 text-slate-400">{po.currency || 'INR'}</small></div>)}</Cell>
                  <Cell>{(() => {
                    // 🔴 NUCLEAR FIX: Calculate proof URL HERE, in the EXACT SAME closure scope that
                    // ran poRows.forEach(console.log) which the user already CONFIRMED returns
                    // hasPoFileUrl=true + valid Cloudinary URL for EVERY row (screenshot console table 1174).
                    // NO NormalizedPoProof component call = NO prop passing = NO stale closure / frozen ref bugs!
                    // Deep-clone row.payload (DEFROST) via JSON roundtrip → 100% bypass Proxy/getter traps.
                    let clonedPayload;
                    try { clonedPayload = JSON.parse(JSON.stringify(row.payload || {})); } catch { clonedPayload = Object.assign({}, row.payload || {}); }
                    const snap = Array.isArray(clonedPayload.poYearRows) ? clonedPayload.poYearRows : [];
                    const mani = Array.isArray(clonedPayload.poProofManifest) ? clonedPayload.poProofManifest : [];
                    // For each row, resolve URL matching by len1 (unambiguous) → rowIndex → poNumber → manifest → deepFind(payload)
                    const resolveUrlForPo = (po, i) => {
                      // (1) Component prop path closure (already validated!)
                      const copy = Object.assign({}, po || {});
                      if (!copy.hasPoFileUrl || !_isUsableProofValue(copy.poFileUrl)) {
                        const u = getPoProofUrl(copy);
                        if (_isUsableProofValue(u)) { copy.poFileUrl = u; copy.hasPoFileUrl = true; copy.proofUrl = copy.proofUrl || u; }
                      }
                      const propUrl = (copy.hasPoFileUrl && _isUsableProofValue(copy.poFileUrl)) ? String(copy.poFileUrl).trim()
                        : _isUsableProofValue(copy.proofUrl) ? String(copy.proofUrl).trim()
                        : getPoProofUrl(copy || {});
                      if (_isUsableProofValue(propUrl)) return { url: propUrl, source: 'prop' };
                      // (2) len1 unambiguous snapshot
                      if (snap.length === 1) {
                        const u = getPoProofUrl(snap[0]);
                        if (_isUsableProofValue(u)) return { url: u, source: 'snap_len1' };
                      }
                      if (mani.length === 1 && _isUsableProofValue(mani[0]?.poFileUrl)) return { url: String(mani[0].poFileUrl || '').trim(), source: 'mani_len1' };
                      // (3) rowIndex match
                      const byIdx = snap[i];
                      const byIdxU = byIdx ? getPoProofUrl(byIdx) : '';
                      if (_isUsableProofValue(byIdxU)) return { url: byIdxU, source: 'snap_rowIdx' };
                      const maniByIdx = mani.find((m) => String(m.rowIndex) === String(i));
                      if (maniByIdx && _isUsableProofValue(maniByIdx.poFileUrl)) return { url: String(maniByIdx.poFileUrl || '').trim(), source: 'mani_rowIdx' };
                      // (4) poNumber strict match
                      const poNum = String(copy.poNumber || byIdx?.poNumber || '').trim();
                      if (poNum) {
                        const byPo = snap.find((r) => String(r?.poNumber || '').trim() === poNum);
                        const byPoU = byPo ? getPoProofUrl(byPo) : '';
                        if (_isUsableProofValue(byPoU)) return { url: byPoU, source: 'snap_poNum' };
                        const maniByPo = mani.find((m) => String(m.poNumber || '').trim() === poNum);
                        if (maniByPo && _isUsableProofValue(maniByPo.poFileUrl)) return { url: String(maniByPo.poFileUrl || '').trim(), source: 'mani_poNum' };
                      }
                      // (5) payload snapshot ANY url / deep find
                      const deep = _deepFindProofField(clonedPayload, 'url') || '';
                      if (_isUsableProofValue(deep)) return { url: deep, source: 'payload_deep' };
                      return { url: '', source: 'MISSING' };
                    };
                    const rendered = [];
                    for (let i = 0; i < poRows.length; i += 1) {
                      const po = poRows[i] || {};
                      const resolved = resolveUrlForPo(po, i);
                      if (_isUsableProofValue(resolved.url)) {
                        rendered.push(<a key={`nuc-${row._id || row.id || id}-${i}-${po.poNumber || 'po'}`} href={resolved.url} target="_blank" rel="noopener noreferrer" className="mb-2 inline-flex min-h-9 items-center rounded-lg bg-blue-600 px-3 text-xs font-black text-white shadow-sm">Open PO Proof</a>);
                      } else {
                        rendered.push(<div key={`nuc-miss-${row._id || row.id || id}-${i}-${po.poNumber || 'po'}`} className="mb-2"><span role="button" tabIndex={0} title={('Resolution path: ' + resolved.source)} onClick={(e) => { if (e) { e.preventDefault(); e.stopPropagation(); } console.group('%c🔍 [POProof:Inspector:FullDump] — lead=' + (row.payload?.leadCode || clonedPayload.leadCode || '') + ' po=' + (po?.poNumber || ''), 'background:#111827;color:#fde68a;font-weight:700;padding:4px 8px;border-radius:6px'); console.log('snap_len=' + snap.length + ' mani_len=' + mani.length, { snap, mani, clonedPayload, resolvedPayloadTopDirect: Object.fromEntries(Object.entries(clonedPayload || {}).filter(([k]) => /proof|file|document|upload|attachment|url|secure|cloud|name|quotationSent/i.test(k))), poRowCurrent: po, currentResolved: resolved }); const allStrings = []; try { const walk = (o, path, depth) => { if (depth > 6 || !o) return; const t = typeof o; if (t === 'string') { if (/res\.cloudinary|cloudinary\.com|s3\.amazonaws|storage\.googleapis|firebasestorage|drive\.google/i.test(o)) allStrings.push([path, o.slice(0, 160)]); return; } if (t !== 'object') return; Object.entries(o).forEach(([k, v]) => walk(v, path ? `${path}.${k}` : String(k), depth + 1)); }; walk({ payload: clonedPayload || {}, approval: row || {}, po: po || {} }, '', 0); } catch { /* ignore */ } console.log('🔎 ALL_CLOUDINARY_STRINGS_ANYWHERE (depth<=6):', allStrings); console.groupEnd(); try { alert('🔍 Full dump written!\n\nResolution path=' + resolved.source + '\nCloudinary strings found=' + String(allStrings.length || 0) + '\n\nExpand yellow/black 🔍 group in Console for details.'); } catch { /* ignore */ } }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { const fn = (e.currentTarget.onclick || (() => {})); if (typeof fn === 'function') fn(e); } }} className="inline-flex min-h-[28px] cursor-help items-center gap-1 rounded-md border border-dashed border-slate-200 bg-slate-50/60 px-2 text-[11px] font-black uppercase tracking-wide text-slate-500 shadow-[0_1px_0_rgba(148,163,184,0.15)] hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700"><span aria-hidden>🔍</span><span>Proof Missing ({resolved.source})</span></span></div>);
                      }
                    }
                    if (row.payload?.earlierQuotationProofUrl) rendered.push(<a key="earlier-proof" href={row.payload.earlierQuotationProofUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block text-xs font-black text-amber-700 underline">View earlier quotation proof</a>);
                    return rendered;
                  })()}</Cell>
                    <Cell>{poRows.map((po) => <strong key={`${po.approvalId || id}-${po.rowIndex ?? 0}-${po.poNumber || 'po'}-basic`} className="block text-slate-900">{po.basicAmountValue != null ? `₹${po.basicAmountValue.toLocaleString('en-IN')}` : '-'}</strong>)}</Cell>
                    <Cell>{row.payload?.poSubmittedByName || row.createdByName || '-'}</Cell><Cell>{statusBadge(row.approvalStatus)}</Cell>
                    <Cell><div className="flex flex-wrap gap-2"><button type="button" disabled={row.approvalStatus !== 'PENDING'} onClick={() => openPoDecision(row, 'APPROVED')} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-40">Approve</button><button type="button" disabled={row.approvalStatus !== 'PENDING'} onClick={() => openPoDecision(row, 'REJECTED')} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-black text-red-600 disabled:opacity-40">Reject</button><button type="button" disabled={row.approvalStatus !== 'PENDING'} onClick={() => openPoDecision(row, 'REVISION_REQUIRED')} className="rounded-lg border border-orange-200 px-3 py-2 text-xs font-black text-orange-600 disabled:opacity-40">Revise</button></div></Cell>
                  </tr>;
                })}
              </ApprovalTable>
              </>
            ) : activeTab === 'temporary' ? (
              <ApprovalTable title="Temporary User Requests" columns={['Client Name', 'Previous User', 'Temporary User', 'Manager Name', 'Duration', 'Status', 'Decision Remarks', 'Actions']} emptyText="No temporary user requests found." page={1} totalPages={1} showing={filteredTemporary.length} total={filteredTemporary.length} onPrev={() => {}} onNext={() => {}}>
                {filteredTemporary.map((row) => <tr key={row._id || row.id}>
                  <Cell strong>{row.clientName}</Cell><Cell>{row.payload?.permanentUserName || '-'}</Cell><Cell>{row.payload?.temporaryUserName || '-'}</Cell><Cell>{row.payload?.managerName || '-'}</Cell><Cell>{row.payload?.requestedDays || 7} days</Cell><Cell>{statusBadge(row.approvalStatus)}</Cell><Cell>{row.remarks || '-'}</Cell>
                  <Cell><div className="flex gap-2"><button type="button" disabled={savingId === (row._id || row.id) || row.approvalStatus !== 'PENDING'} onClick={() => setTemporaryDecision({ row, decision: 'APPROVED', remarks: '' })} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">Approve</button><button type="button" disabled={savingId === (row._id || row.id) || row.approvalStatus !== 'PENDING'} onClick={() => setTemporaryDecision({ row, decision: 'REJECTED', remarks: '' })} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-black text-rose-600 disabled:opacity-50">Reject</button></div></Cell>
                </tr>)}
              </ApprovalTable>
            ) : activeTab === 'clients' ? (
              <ApprovalTable
                title="Pending Clients"
                columns={['Client Name', 'Approval Status', 'Decision By', 'Applicant Type', 'Service Category', 'Created By', 'Request Date', 'Actions']}
                emptyText="No pending clients found."
                page={clientPage}
                totalPages={clientTotalPages}
                showing={visibleClients.length}
                total={filteredClients.length}
                onPrev={() => setClientPage((value) => Math.max(1, value - 1))}
                onNext={() => setClientPage((value) => Math.min(clientTotalPages, value + 1))}
                actions={<div className="flex flex-wrap gap-2" aria-label="Client approval status tabs">{[
                  ['PENDING', 'Pending'],
                  ['PARTIALLY_APPROVED', 'Partially Approved'],
                  ['APPROVED', 'Approved'],
                  ['REJECTED', 'Rejected']
                ].map(([status, label]) => { const count = pendingClients.filter((client) => getApprovalStatus(client) === status).length; return <button type="button" key={status} onClick={() => setStatusFilter(status)} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black transition ${statusFilter === status ? status === 'APPROVED' ? 'border-emerald-600 bg-emerald-600 text-white' : status === 'PARTIALLY_APPROVED' ? 'border-amber-500 bg-amber-500 text-white' : 'border-rose-200 bg-rose-100 text-rose-700' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300'}`}><span className="client-status-tab-label">{label}</span><b className={`rounded-full px-2 py-0.5 ${statusFilter === status ? status === 'PENDING' ? 'bg-rose-200 text-rose-800' : 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'}`}>{count}</b></button> })}</div>}
              >
                {visibleClients.map((client) => {
                  const approvalState = getApprovalStatus(client);
                  const complianceApproved = approvalState === 'APPROVED';
                  const partiallyApproved = approvalState === 'PARTIALLY_APPROVED';
                  return <tr key={client.id} className="transition-colors hover:bg-slate-50">
                    <Cell strong><span className="flex items-center gap-2">{complianceApproved ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-label="Compliance approved" /> : partiallyApproved ? <AlertTriangle className="h-4 w-4 shrink-0 fill-amber-100 text-amber-500" aria-label="Compliance partially approved" /> : <AlertTriangle className="h-4 w-4 shrink-0 fill-rose-100 text-rose-600" aria-label="Compliance approval pending" />}<button type="button" onClick={() => openClientMaster(client)} className="font-black text-emerald-700 underline decoration-emerald-300 underline-offset-4 hover:text-emerald-900">{client.clientName}</button></span></Cell>
                    <Cell><div className="flex flex-col items-start gap-1">{statusBadge(client.approvalStatus)}{['RED', 'PERMANENT_RED'].includes(client.reminderFlag) && <><span className="rounded-full bg-red-100 px-2 py-1 text-[9px] font-black text-red-700">{client.reminderFlag === 'PERMANENT_RED' ? 'PERMANENT RED FLAG' : 'RED FLAG - 24H RECOVERY'}</span>{client.reminderFlag === 'RED' && client.greenFlagDeadline && <small className="font-bold text-red-600">Recover by {formatDisplayDateTime(client.greenFlagDeadline)}</small>}</>}</div></Cell>
                    <Cell>{approvalState === 'PENDING' ? '-' : <span className="font-black text-slate-700">{formatApprovalValue(client.decisionBy)}{client.decisionAt && <small className="mt-1 block font-semibold text-slate-400">{new Date(client.decisionAt).toLocaleString('en-IN')}</small>}</span>}</Cell>
                    <Cell>{client.piboCategory}</Cell>
                    <Cell>{client.eprCategory}</Cell>
                    <Cell>{formatApprovalValue(client.createdBy)}</Cell>
                    <Cell>{[formatApprovalValue(client.requestDate), formatApprovalValue(client.requestTime)].filter((item) => item !== '-').join(' ')}</Cell>
                    <Cell><button type="button" onClick={() => openClientMaster(client)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white"><FileCheck2 className="h-4 w-4" />Review</button></Cell>
                  </tr>
                })}
              </ApprovalTable>
            ) : activeTab === 'services' ? (
              <div className="grid gap-4">
                <div className="rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 px-5 py-4 text-sm font-bold leading-6 text-orange-900 shadow-sm">
                  <span className="mr-2 inline-flex rounded-full bg-orange-600 px-3 py-1 text-xs font-black uppercase tracking-wider text-white">Important</span>
                  This is a preliminary decision made by the assigned user. The final approval authority rests with the Admin/Super Admin.
                </div>
                <ApprovalTable
                title="Pending Service Approvals"
                columns={['Company', 'Service Added By', 'Original Creator', 'Services Added', 'Creator Decision', 'Final Decision', 'Actions']}
                emptyText="No service approval requests found."
                page={1}
                totalPages={1}
                showing={filteredServices.length}
                total={filteredServices.length}
                onPrev={() => {}}
                onNext={() => {}}
              >
                {filteredServices.map((row) => {
                  const id = row._id || row.id;
                  const isCreator = String(row.payload?.originalCreatorId || '') === String(currentUser?._id || currentUser?.id || '');
                  return <tr key={id}>
                    <Cell strong><button type="button" onClick={() => setServiceApprovalDetail(row)} className="font-black text-emerald-700 underline decoration-emerald-300 underline-offset-4 hover:text-emerald-900">{row.clientName}</button></Cell>
                    <Cell>{row.payload?.contributorName || row.createdByName}</Cell>
                    <Cell>{row.payload?.originalCreator || currentUser?.name || '-'}</Cell>
                    <Cell>{row.payload?.addedServices?.length || row.payload?.groups?.reduce((sum, group) => sum + Number(group.count || 0), 0) || '-'}</Cell>
                    <Cell><div className="grid gap-1">
                      {statusBadge(row.payload?.preliminaryStatus)}
                      {Number(row.reminderCount || 0) > 0 && row.payload?.preliminaryStatus === 'PENDING' && (
                        <small className={`max-w-64 font-black ${Number(row.reminderCount) >= 2 ? 'text-red-600' : 'text-amber-600'}`}>
                          {Number(row.reminderCount) >= 2 ? '🚩 RED FLAG — Final reminder sent' : 'Reminder 1 of 2 sent'}
                        </small>
                      )}
                      {row.payload?.autoApproved && <small className="max-w-64 font-black text-blue-700">System preliminary approval after two unanswered reminders</small>}
                      {row.payload?.preliminaryReason && <small className="max-w-64 font-bold text-red-600">{row.payload.preliminaryReason}</small>}
                    </div></Cell>
                    <Cell><div className="grid gap-1">{statusBadge(row.payload?.finalStatus)}{row.payload?.finalReason && <small className="max-w-64 font-bold text-red-600">{row.payload.finalReason}</small>}</div></Cell>
                    <ActionCell row={{ ...row, id }} savingId={savingId} onUpdate={requestServiceDecision} canApprove={canApprove || isCreator} />
                  </tr>;
                })}
                </ApprovalTable>
              </div>
            ) : activeTab === 'duplicates' ? (
              <ApprovalTable
                title="Special Approvals"
                columns={['Company', 'Requested By', 'Reason', 'Email', 'Evidence', 'Select Lead Owner', 'Status', 'Actions']}
                emptyText="No special approval requests found."
                page={1}
                totalPages={1}
                showing={filteredDuplicateLeads.length}
                total={filteredDuplicateLeads.length}
                onPrev={() => {}}
                onNext={() => {}}
              >
                {filteredDuplicateLeads.map((row) => (
                  <tr key={row._id || row.id}>
                    <Cell strong>{row.clientName}</Cell>
                    <Cell>{row.createdByName}</Cell>
                    <Cell>{row.type === 'lead_service' ? `Additional services by ${row.payload?.contributorName || row.createdByName}` : row.payload?.reason}</Cell>
                    <Cell>{row.type === 'lead_service' ? row.payload?.contributorEmail : row.payload?.requesterEmail}</Cell>
                    <Cell>{row.payload?.screenshotUrl ? <a className="font-black text-emerald-700 underline" href={row.payload.screenshotUrl} target="_blank" rel="noreferrer">Open</a> : '-'}</Cell>
                    <Cell>{row.type === 'lead_service' ? `Creator: ${row.payload?.preliminaryStatus || 'PENDING'} / Final: ${row.payload?.finalStatus || 'PENDING'}` : <select className="form-input min-w-44" value={approvalInputs[row._id]?.selectedUserId || row.payload?.selectedUserId || ''} disabled={getApprovalStatus(row) !== 'PENDING'} onChange={(event) => setApprovalInputs((current) => ({ ...current, [row._id]: { ...(current[row._id] || {}), selectedUserId: event.target.value } }))}><option value="">Select user</option>{(row.payload?.candidateUsers || []).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select>}</Cell>
                    <Cell>{statusBadge(row.type === 'lead_service' && !canApprove ? row.payload?.preliminaryStatus : row.approvalStatus)}</Cell>
                    <ActionCell row={{ ...row, id: row._id || row.id }} savingId={savingId} onUpdate={updateDuplicateLeadApproval} canApprove={canApprove || (row.type === 'lead_service' && String(row.payload?.originalCreatorId || '') === String(currentUser?._id || currentUser?.id || ''))} />
                  </tr>
                ))}
              </ApprovalTable>
            ) : activeTab === 'royalty' ? (
              <ApprovalTable title="Claim Royalty Approvals" columns={['Company', 'FY', 'Services Offered', 'Service Category', 'Data Flag', 'Original Creator', 'Claimed By', 'Original %', 'Claimant %', 'Status', 'Actions']} emptyText="No royalty claims found." page={1} totalPages={1} showing={filteredRoyalty.length} total={filteredRoyalty.length} onPrev={() => {}} onNext={() => {}}>
                {filteredRoyalty.map((row) => {
                  const id = row._id || row.id;
                  const values = approvalInputs[id] || {};
                  return <tr key={id}>
                    <Cell strong>{row.clientName}</Cell><Cell>{row.payload?.financialYear}</Cell><Cell>{(row.payload?.servicesOffered || []).join(', ') || '-'}</Cell><Cell>{(row.payload?.eprCategories || []).join(', ') || '-'}</Cell><Cell><span className={`rounded-full px-3 py-1 text-xs font-black ${row.payload?.dataFlag === 'GREEN' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`} title={row.payload?.correctionDeadline ? `Correction allowed until ${formatDisplayDate(row.payload.correctionDeadline)}` : 'Complete'}>{row.payload?.dataFlag || 'RED'}</span></Cell><Cell>{row.payload?.originalCreator}</Cell><Cell>{row.payload?.claimantName}</Cell>
                    <Cell><input className="form-input min-w-24" type="number" min="0" max="100" disabled={getApprovalStatus(row) !== 'PENDING'} value={values.originalCreatorRatio ?? row.payload?.originalCreatorRatio ?? ''} onChange={(event) => setApprovalInputs((current) => ({ ...current, [id]: { ...(current[id] || {}), originalCreatorRatio: event.target.value } }))} /></Cell>
                    <Cell><input className="form-input min-w-24" type="number" min="0" max="100" disabled={getApprovalStatus(row) !== 'PENDING'} value={values.claimantRatio ?? row.payload?.claimantRatio ?? ''} onChange={(event) => setApprovalInputs((current) => ({ ...current, [id]: { ...(current[id] || {}), claimantRatio: event.target.value } }))} /></Cell>
                    <Cell>{statusBadge(row.approvalStatus)}</Cell><ActionCell row={{ ...row, id }} savingId={savingId} onUpdate={updateDuplicateLeadApproval} canApprove={canApprove} />
                  </tr>;
                })}
              </ApprovalTable>
            ) : (
              <ApprovalTable
                title={
                  <>
                    <span className="pending-count-num">{filteredQuotations.length}</span>
                    <span>{statusFilter === 'APPROVED' ? (filteredQuotations.length === 1 ? ' Quotation Approved' : ' Quotations Approved') : statusFilter === 'REJECTED' ? (filteredQuotations.length === 1 ? ' Quotation Rejected' : ' Quotations Rejected') : (filteredQuotations.length === 1 ? ' Quotation Pending' : ' Quotations Pending')}</span>
                  </>
                }
                columns={['User Name', 'Lead Generated By', 'Company Name', 'Contact Person', 'Mobile No.', { label: 'Quotation Date', sortable: true }, 'Service', 'Category', 'Applicant Type', 'Basic Amount', 'Approval Status', 'Approval Type', 'Created By', 'Super Admin Approval', 'Actions']}
                emptyText={statusFilter === 'APPROVED' ? 'No approved quotations found.' : statusFilter === 'REJECTED' ? 'No rejected quotations found.' : 'No pending quotations found.'}
                page={quotePage}
                totalPages={quoteTotalPages}
                showing={visibleQuotations.length}
                total={filteredQuotations.length}
                onPrev={() => setQuotePage((value) => Math.max(1, value - 1))}
                onNext={() => setQuotePage((value) => Math.min(quoteTotalPages, value + 1))}
                actions={['APPROVED', 'REJECTED'].includes(statusFilter) ? null : isQuotationSuperAdmin ? (
                  <button
                    type="button"
                    disabled={!pendingQuotations.length || Boolean(savingId)}
                    onClick={approveAllPendingQuotations}
                    className="pending-approve-all"
                  >
                    {savingId === 'quote-approve-all' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Approve All
                  </button>
                ) : (
                  <span className="pending-admin-only">Admin only</span>
                )}
              >
                {visibleQuotations.map((quote) => (
                  <tr key={quote.id}>
                    <Cell strong>{quote.userName}</Cell>
                    <Cell>{quote.leadGeneratedBy}</Cell>
                    <Cell strong>{quote.companyName}</Cell>
                    <Cell>{quote.contactPerson}</Cell>
                    <Cell>{quote.mobileNo1}</Cell>
                    <Cell>{quote.quotationDate}</Cell>
                    <Cell>{quote.service}</Cell>
                    <Cell>{quote.category}</Cell>
                    <Cell>{quote.piboCategory}</Cell>
                    <Cell strong>{formatAmount(quote.basicAmount)}</Cell>
                    <Cell>{statusBadge(quote.adminApprovalStatus === 'APPROVED' && quote.managementApprovalStatus === 'PENDING' ? 'ADMIN APPROVED' : quote.approvalStatus)}</Cell>
                    <Cell>{quote.approvalType}</Cell>
                    <Cell>{formatApprovalValue(quote.createdBy)}</Cell>
                    <ManagementApprovalCell
                      row={quote}
                      savingId={savingId}
                      isSuperAdmin={isQuotationSuperAdmin}
                      currentUser={currentUser}
                      onFinalize={(row) => setQuotationDecision({ row, status: 'APPROVED', finalApproval: true, remarks: '', proofUrl: '', proofName: '' })}
                    />
                    <QuotationActionCell
                      row={quote}
                      savingId={savingId}
                      onView={openQuotationDetails}
                      onRevise={reviseQuotation}
                      onUpdate={requestQuotationDecision}
                      canApprove={canApprove}
                      canAdminApprove={canAdminApproveQuotation}
                      isSuperAdmin={isQuotationSuperAdmin}
                    />
                  </tr>
                ))}
              </ApprovalTable>
            )}
          </section>
        </div>
      </div>

      {serviceApprovalDetail && (
        <div className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setServiceApprovalDetail(null); }}>
          <div className="max-h-[88vh] w-full max-w-6xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-emerald-100 bg-gradient-to-r from-emerald-50 to-orange-50 p-5">
              <div><p className="text-xs font-black uppercase tracking-widest text-emerald-700">Service contribution details</p><h2 className="mt-1 text-2xl font-black text-slate-950">{serviceApprovalDetail.clientName}</h2><p className="mt-1 text-sm font-bold text-slate-500">Lead creator: {serviceApprovalDetail.payload?.originalCreator || '-'}</p></div>
              <button type="button" onClick={() => setServiceApprovalDetail(null)} className="grid h-10 w-10 place-items-center rounded-xl bg-white text-slate-600 shadow"><X className="h-5 w-5" /></button>
            </header>
            <div className="max-h-[70vh] overflow-auto p-5">
              {(serviceApprovalDetail.payload?.serviceGroups || []).length ? <div className="space-y-5">{serviceApprovalDetail.payload.serviceGroups.map((group) => (
                <section key={group.user} className="overflow-hidden rounded-2xl border border-slate-200">
                  <div className="flex items-center justify-between bg-slate-50 px-4 py-3"><strong>{group.user}</strong><span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">{group.count ?? group.services?.length ?? 0} Services</span></div>
                  <div className="overflow-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-emerald-50 text-xs uppercase text-emerald-800"><tr>{['#', 'Industry', 'Service Category', 'Applicant Type', 'Service', 'Applicable Service', 'Financial Year'].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}</tr></thead><tbody>{(group.services || []).map((service, index) => <tr key={`${group.user}-${index}`} className="border-t"><td className="px-4 py-3 font-black">{index + 1}</td><td className="px-4 py-3">{service.industryType || '-'}</td><td className="px-4 py-3">{service.eprCategory || '-'}</td><td className="px-4 py-3">{service.applicantType || service.piboCategory || '-'}</td><td className="px-4 py-3 font-bold">{service.servicesOffered || '-'}</td><td className="px-4 py-3">{service.applicableService || '-'}</td><td className="px-4 py-3">{service.firstAnnualReturnYearApplicable || '-'}</td></tr>)}</tbody></table>{!(group.services || []).length && <p className="p-5 text-sm font-bold text-slate-500">Detailed rows are unavailable for this older approval; total count is {group.count || 0}.</p>}</div>
                </section>
              ))}</div> : <div className="p-10 text-center font-bold text-slate-500">No service contribution details are available.</div>}
            </div>
          </div>
        </div>
      )}

      {clientDecision && (
        <div className="pending-decision-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingId) setClientDecision(null); }}>
          <form onSubmit={submitClientDecision} className={`pending-decision-modal ${clientDecision.status === 'APPROVED' ? 'is-approved' : 'is-rejected'}`}>
            <div className="pending-decision-icon">
              {clientDecision.status === 'APPROVED' ? <CheckCircle2 className="h-7 w-7" /> : <XCircle className="h-7 w-7" />}
            </div>
            <button type="button" disabled={Boolean(savingId)} onClick={() => setClientDecision(null)} className="pending-decision-close" aria-label="Close decision dialog"><X className="h-5 w-5" /></button>
            <p className="pending-decision-kicker">Client Master decision</p>
            <h2>{clientDecision.status === 'APPROVED' ? 'Approve client' : 'Reject client'}</h2>
            <strong className="pending-decision-client">{clientDecision.row.clientName}</strong>
            <p className="pending-decision-help">Your note and decision will be saved in the audit trail and emailed to <strong>{formatApprovalValue(clientDecision.row.createdBy) === '-' ? 'the Client Master creator' : formatApprovalValue(clientDecision.row.createdBy)}</strong>.</p>
            <label className="pending-decision-field">
              <span>{clientDecision.status === 'APPROVED' ? 'Approval note' : 'Rejection reason'} <b>*</b></span>
              <textarea
                autoFocus
                required
                maxLength={250}
                rows={5}
                value={clientDecision.note}
                onChange={(event) => setClientDecision((current) => ({ ...current, note: event.target.value }))}
                placeholder={clientDecision.status === 'APPROVED' ? 'Write a clear approval note...' : 'Explain what needs to be corrected...'}
              />
              <small><span>{clientDecision.note.length}/250</span> characters</small>
            </label>
            <div className="pending-decision-actions">
              <button type="button" disabled={Boolean(savingId)} onClick={() => setClientDecision(null)}>Cancel</button>
              <button type="submit" disabled={Boolean(savingId) || !clientDecision.note.trim()}>
                {savingId ? <RefreshCw className="h-4 w-4 animate-spin" /> : clientDecision.status === 'APPROVED' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                Submit {clientDecision.status === 'APPROVED' ? 'Approval' : 'Rejection'}
              </button>
            </div>
          </form>
        </div>
      )}
      {temporaryDecision && (() => {
        const wordCount = String(temporaryDecision.remarks || '').trim().split(/\s+/).filter(Boolean).length;
        return <div className="pending-decision-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingId) setTemporaryDecision(null); }}>
          <form onSubmit={submitTemporaryDecision} className={`pending-decision-modal ${temporaryDecision.decision === 'APPROVED' ? 'is-approved' : 'is-rejected'}`}>
            <div className="pending-decision-icon">{temporaryDecision.decision === 'APPROVED' ? <CheckCircle2 className="h-7 w-7" /> : <XCircle className="h-7 w-7" />}</div>
            <button type="button" disabled={Boolean(savingId)} onClick={() => setTemporaryDecision(null)} className="pending-decision-close" aria-label="Close temporary user decision dialog"><X className="h-5 w-5" /></button>
            <p className="pending-decision-eyebrow">Temporary User Approval</p><h2>{temporaryDecision.decision === 'APPROVED' ? 'Approve temporary user' : 'Reject temporary user'}</h2>
            <strong className="pending-decision-client">{temporaryDecision.row.clientName}</strong>
            <p className="pending-decision-help"><strong>Previous User:</strong> {temporaryDecision.row.payload?.permanentUserName || '-'} · <strong>Temporary User:</strong> {temporaryDecision.row.payload?.temporaryUserName || '-'} · <strong>Manager:</strong> {temporaryDecision.row.payload?.managerName || '-'}</p>
            <label className="pending-decision-field"><span>Decision remarks <b>*</b></span><textarea autoFocus required rows={7} value={temporaryDecision.remarks} onChange={(event) => setTemporaryDecision((current) => ({ ...current, remarks: event.target.value }))} placeholder="Enter clear approval or rejection remarks (maximum 250 words)..." /><small className={wordCount > 250 ? 'text-red-600' : ''}><span>{wordCount}/250</span> words</small></label>
            <div className="pending-decision-actions"><button type="button" disabled={Boolean(savingId)} onClick={() => setTemporaryDecision(null)}>Cancel</button><button type="submit" disabled={Boolean(savingId) || !temporaryDecision.remarks.trim() || wordCount > 250}>{savingId ? <RefreshCw className="h-4 w-4 animate-spin" /> : temporaryDecision.decision === 'APPROVED' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}Submit {temporaryDecision.decision === 'APPROVED' ? 'Approval' : 'Rejection'}</button></div>
          </form>
        </div>;
      })()}
      {poDecision && <div className="pending-decision-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingId) setPoDecision(null); }}><form onSubmit={submitPoDecision} role="dialog" aria-modal="true" aria-label="Review submitted Purchase Order" className={`pending-decision-modal pending-po-review-modal ${poDecision.status === 'APPROVED' ? 'is-approved' : 'is-rejected'}`}><div className="pending-decision-icon">{poDecision.status === 'APPROVED' ? <CheckCircle2 className="h-7 w-7" /> : <XCircle className="h-7 w-7" />}</div><button type="button" disabled={Boolean(savingId)} onClick={() => setPoDecision(null)} className="pending-decision-close" aria-label="Close PO decision"><X className="h-5 w-5" /></button><p className="pending-decision-eyebrow">Purchase Order Approval</p><h2>{poDecision.status === 'APPROVED' ? 'Approve Purchase Order' : poDecision.status === 'REJECTED' ? 'Reject Purchase Order' : 'Request quotation and PO revision'}</h2><strong className="pending-decision-client">{poDecision.row.clientName}</strong>{poDecision.loadingDetails ? <p role="status" className="pending-po-review-loading">Loading latest submitted PO details…</p> : poDecision.loadError ? <div role="alert" className="pending-po-review-error">{poDecision.loadError}<button type="button" onClick={() => openPoDecision(poDecision.row, poDecision.status)}>Retry</button></div> : <SubmittedPoReview approval={poDecision.row} />}<p className="pending-decision-help">No image or document is required. Add clear remarks and submit. The dialog will close immediately while the decision email is sent to the responsible users.</p><label className="pending-decision-field"><span>Decision remarks <b>*</b></span><textarea autoFocus required rows={6} value={poDecision.remarks} onChange={(event) => setPoDecision((current) => ({ ...current, remarks: event.target.value }))} placeholder="Clearly explain this PO decision..." /></label><div className="pending-decision-actions"><button type="button" disabled={Boolean(savingId)} onClick={() => setPoDecision(null)}>Cancel</button><button type="submit" disabled={Boolean(savingId) || poDecision.loadingDetails || Boolean(poDecision.loadError) || !poDecision.remarks.trim()}>{savingId ? <RefreshCw className="h-4 w-4 animate-spin" /> : poDecision.status === 'APPROVED' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}Submit {poDecision.status === 'APPROVED' ? 'Approval' : poDecision.status === 'REJECTED' ? 'Rejection' : 'Revision'}</button></div></form></div>}

      {quotationDecision && <div className="pending-decision-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingId) setQuotationDecision(null); }}><form onSubmit={submitQuotationDecision} style={{ maxHeight: "90vh", overflowY: "auto" }} className={`pending-decision-modal quotation-decision-modal ${quotationDecision.status === 'APPROVED' ? 'is-approved' : 'is-rejected'}`}><button type="button" disabled={Boolean(savingId)} onClick={() => setQuotationDecision(null)} className="pending-decision-close" aria-label="Close quotation decision"><X className="h-5 w-5" /></button><p className="pending-decision-eyebrow">Quotation Decision</p><h2>{quotationDecision.status === 'APPROVED' ? (quotationDecision.finalApproval ? 'Final Management Approval' : 'Management Approval') : 'Reject quotation'}</h2><strong className="pending-decision-client">{quotationDecision.row.companyName || '-'}</strong>{quotationDecision.status === 'APPROVED' ? <><ManagementApprovalDetails row={quotationDecision.row} /><p className="pending-decision-help">{quotationDecision.finalApproval ? "Review the Management Approval details before confirming final approval." : "Approval proof is optional. Admin approval unlocks the quotation PDF; final Super Admin approval follows."}</p>{!quotationDecision.finalApproval && <><label className="mt-4 flex min-h-16 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50 px-4 font-black text-emerald-700"><FileCheck2 className="mr-2 h-5 w-5" />{quotationDecision.proofName || 'Upload approval proof (optional)'}<input type="file" accept="image/*,.pdf" className="sr-only" onChange={uploadQuotationDecisionProof} /></label><label className="pending-decision-field mt-4"><span>Approval note</span><textarea rows={4} value={quotationDecision.remarks} onChange={(event) => setQuotationDecision((current) => ({ ...current, remarks: event.target.value }))} placeholder="Add an optional approval note..." /></label></>}</> : <label className="pending-decision-field"><span>Rejection reason <b>*</b></span><textarea autoFocus required rows={7} value={quotationDecision.remarks} onChange={(event) => setQuotationDecision((current) => ({ ...current, remarks: event.target.value }))} placeholder="Please explain why this quotation is being rejected..." /></label>}<div className="pending-decision-actions"><button type="button" disabled={Boolean(savingId)} onClick={() => setQuotationDecision(null)}>Cancel</button><button type="submit" disabled={Boolean(savingId) || (quotationDecision.status === 'REJECTED' && !quotationDecision.remarks.trim())}>{savingId ? <RefreshCw className="h-4 w-4 animate-spin" /> : quotationDecision.status === 'APPROVED' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}Confirm {quotationDecision.status === 'APPROVED' ? 'Approval' : 'Rejection'}</button></div></form></div>}

      {serviceRejection && (
        <div className="fixed inset-0 z-[10001] grid place-items-center bg-slate-950/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setServiceRejection(null); }}>
          <form onSubmit={submitServiceRejection} className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-widest text-red-600">Rejection reason required</p><h2 className="mt-1 text-xl font-black text-slate-950">{serviceRejection.row.clientName}</h2></div><button type="button" onClick={() => setServiceRejection(null)} className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100"><X className="h-5 w-5" /></button></div>
            <label className="mt-5 grid gap-2"><span className="text-sm font-black text-slate-700">Reason for rejection</span><textarea autoFocus required rows={5} value={serviceRejection.reason} onChange={(event) => setServiceRejection((current) => ({ ...current, reason: event.target.value }))} className="rounded-xl border border-slate-300 p-4 text-sm font-semibold outline-none focus:border-red-400 focus:ring-4 focus:ring-red-100" placeholder="Explain clearly why these additional services are being rejected..." /></label>
            <p className="mt-2 text-xs font-bold text-slate-500">This reason will be visible in Pending Approval and emailed to the contributor, Admin and Superadmin.</p>
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setServiceRejection(null)} className="min-h-11 rounded-xl border px-5 font-black text-slate-700">Cancel</button><button type="submit" disabled={!serviceRejection.reason.trim()} className="min-h-11 rounded-xl bg-red-600 px-5 font-black text-white disabled:opacity-50">Reject with Reason</button></div>
          </form>
        </div>
      )}

      {profileOpen && (
        <ProfileModal
          user={currentUser}
          saving={profileSaving}
          onClose={() => setProfileOpen(false)}
          onLogout={handleLogout}
          onSave={handleUpdateProfile}
          onUpdatePassword={handleUpdatePassword}
        />
      )}
      {clientReviewSelection && <ClientApplicantPicker row={clientReviewSelection} onClose={() => setClientReviewSelection(null)} onSelect={service => { setClientReviewSelection(null); navigate(`/pending-approval/clients/${service.clientMasterId}/review`); }} />}
    </ApprovalShell>
  );
}

function Metric({ icon: Icon, label, value, hint = '', tone = 'mint', onClick }) {
  const animatedValue = useCountUp(value);
  return (
    <button type="button" onClick={onClick} className={`pending-metric-card pending-metric-${tone}`} aria-label={`Open ${label}`}>
      <span>
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <p>{label}</p>
        <strong className="count-up-number">{animatedValue}</strong>
        {hint && <small>{hint}</small>}
      </div>
    </button>
  );
}

function ApprovalTab({ active, icon: Icon, label, count, onClick }) {
  const animatedCount = useCountUp(count);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pending-tab ${active ? 'active' : ''}`}
    >
      <span>
        <Icon className="h-5 w-5 shrink-0" />
        <span>{label}</span>
      </span>
      <i>
        {animatedCount}
      </i>
    </button>
  );
}

function useCountUp(value, duration = 900) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const to = Number(value) || 0;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setDisplayValue(to);
      return undefined;
    }

    const start = performance.now();
    let frameId;

    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(to * eased));
      if (progress < 1) frameId = requestAnimationFrame(tick);
    }

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [duration, value]);

  return displayValue;
}

function ApprovalTable({ title, columns, children, emptyText, page, totalPages, onPrev, onNext, actions = null, showing = 0, total = 0 }) {
  const hasRows = React.Children.count(children) > 0;
  const startEntry = total === 0 ? 0 : (page - 1) * rowsPerPage + 1;
  const endEntry = Math.min(page * rowsPerPage, total);

  return (
    <div className="pending-table-card">
      <div className="pending-table-head">
        <div className="pending-table-title-wrap">
          <h2 className="pending-table-count-title">{title}</h2>
        </div>
        {actions}
      </div>
      <div className="pending-table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((column) => {
                const isObject = typeof column === 'object' && column !== null;
                const label = isObject ? column.label : column;
                const sortable = isObject ? column.sortable : false;
                return (
                  <th key={label}>
                    <span className="pending-th-content">
                      {label}
                      {sortable && <Diamond className="pending-sort-icon h-3 w-3" />}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {hasRows ? children : (
              <tr>
                <td colSpan={columns.length} className="pending-empty-cell">{emptyText}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="pending-pager">
        <span>Showing {startEntry} to {endEntry} of {total} entries</span>
        <div>
          <button type="button" disabled={page === 1} onClick={onPrev}><ChevronLeft className="h-3.5 w-3.5" /></button>
          <strong>{page}</strong>
          <button type="button" disabled={page === totalPages} onClick={onNext}><ChevronRight className="h-3.5 w-3.5" /></button>
        </div>
      </div>
    </div>
  );
}

function Cell({ children, strong = false }) {
  const hasRenderableElements = React.isValidElement(children)
    || (Array.isArray(children) && children.some((child) => React.isValidElement(child)));
  return (
    <td className={strong ? 'pending-cell-strong' : ''}>
      {hasRenderableElements ? children : formatApprovalValue(children)}
    </td>
  );
}

function ActionCell({ row, savingId, onUpdate, savingPrefix = '', canApprove = false }) {
  const id = row?.id;
  const approving = savingId === `${savingPrefix}${id}-APPROVED`;
  const rejecting = savingId === `${savingPrefix}${id}-REJECTED`;
  const pending = getApprovalStatus(row) === 'PENDING';

  if (!canApprove) {
    return <td aria-label="Approval actions unavailable"><span className="pending-admin-only">Admin only</span></td>;
  }
  if (!pending) {
    return <td><span className="pending-admin-only">Completed</span></td>;
  }

  return (
    <td>
      <div className="pending-row-actions">
        <button
          type="button"
          disabled={Boolean(savingId)}
          onClick={() => onUpdate(row, 'APPROVED')}
          className="pending-action pending-action-approve"
        >
          {approving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Approve
        </button>
        <button
          type="button"
          disabled={Boolean(savingId)}
          onClick={() => onUpdate(row, 'REJECTED')}
          className="pending-action pending-action-reject"
        >
          {rejecting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
          Reject
        </button>
      </div>
    </td>
  );
}

function ManagementApprovalDetails({ row }) {
  const fields = [
    ['Quotation No.', row.quotationNumber || row.uniqueId || '-'],
    ['Company', row.companyName || '-'],
    ['Date', formatDisplayDate(row.quotationDate || row.createdAt)],
    ['Price approved by', row.managementApproverName || '-'],
    ['Amount (\u20b9)', formatAmount(row.grandTotal ?? row.basicAmount)],
    ['Approval Source', String(row.managementApprovalSource || '-').replace(/_/g, ' ')],
    ['Note', row.managementApprovalNote || '-'],
    ['Requested By', row.managementApprovalRequestedBy || '-'],
  ];
  return <dl className="quotation-management-details">{fields.map(([label, value]) => <div key={label}><dt className="text-xs font-bold text-slate-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words font-semibold text-slate-900">{value}</dd></div>)}</dl>;
}

function ManagementApprovalCell({ row, savingId, isSuperAdmin = false, onFinalize }) {
  const id = row?.quotationId || row?._id || row?.id;
  const pending = getApprovalStatus(row) === 'PENDING';
  const submitting = savingId === `management-final-${id}`;
  const managementStatus = String(row?.managementApprovalStatus || '').toUpperCase();

  if (managementStatus === 'APPROVED') {
    const source = String(row.managementApprovalSource || '').replace(/_/g, ' ');
    return <td><span className="management-approved-badge" title={source ? `Approved via ${source}` : 'Final approved'}><CheckCircle2 className="h-3.5 w-3.5" />Final Approved</span></td>;
  }
  if (!pending) return <td><span className="pending-admin-only">Completed</span></td>;
  if (managementStatus !== 'PENDING') return <td><span className="pending-admin-only">Not requested</span></td>;
  if (!isSuperAdmin) return <td><span className="pending-admin-only">Awaiting {row.managementApproverName || 'Super Admin'} Final Approval</span></td>;

  return (
    <td className="management-approval-cell">
      <button type="button" disabled={Boolean(savingId)} title="Complete final Super Admin approval" onClick={() => onFinalize(row)} className="management-approve-button disabled:cursor-not-allowed disabled:opacity-50">
        {submitting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
        Final Approve
      </button>
    </td>
  );
}

function QuotationActionCell({ row, savingId, onView, onRevise, onUpdate, canApprove = false, canAdminApprove = false, isSuperAdmin = false }) {
  const id = row?.id;
  const approving = savingId === `quote-${id}-APPROVED`;
  const rejecting = savingId === `quote-${id}-REJECTED`;
  const revisable = getApprovalStatus(row) !== 'PENDING';
  const adminApproved = String(row?.adminApprovalStatus || '').toUpperCase() === 'APPROVED';

  return (
    <td className="pending-quotation-actions-cell">
      <div className="pending-row-actions pending-quotation-actions">
        <div className="pending-quotation-actions-top">
          <button
            type="button"
            onClick={() => onView(row)}
            className="pending-action pending-action-view"
          >
            <Eye className="h-3.5 w-3.5" />
            View
          </button>
          <button
            type="button"
            disabled={!revisable}
            onClick={() => onRevise(row)}
            title={revisable ? 'Revise quotation' : 'Approve or reject this quotation first'}
            className={`pending-action pending-action-revise ${revisable ? '' : 'cursor-not-allowed opacity-50'}`}
          >
            <Edit3 className="h-3.5 w-3.5" />
            Revise
          </button>
        </div>
        {canApprove && getApprovalStatus(row) === 'PENDING' ? (
          <div className="pending-quotation-actions-bottom">
            {((canAdminApprove && !adminApproved) || isSuperAdmin) && <button
              type="button"
              disabled={Boolean(savingId)}
              onClick={() => onUpdate(row, 'APPROVED')}
              title="Approve quotation"
              className="pending-action pending-action-approve"
            >
              {approving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Approve
            </button>}
            <button
              type="button"
              disabled={Boolean(savingId)}
              onClick={() => onUpdate(row, 'REJECTED')}
              className="pending-action pending-action-reject"
            >
              {rejecting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
              Reject
            </button>
          </div>
        ) : null}
      </div>
    </td>
  );
}
