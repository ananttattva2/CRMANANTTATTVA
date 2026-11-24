import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, Clock3, Database, Download, Eye, FileCheck2, FileText, FolderCheck, KeyRound, MapPin, Plus, RefreshCw, Save, Search, ShieldCheck, Sparkles, Trash2, Upload, UserRound, X } from 'lucide-react';
import ToastMessage from '../../components/ToastMessage';
import PremiumDatePicker from '../../components/form/PremiumDatePicker';
import api from '../../services/api';
import { API_ENDPOINTS } from '../../services/apiEndpoints';
import { adminRoles } from '../../constants/dashboard';
import { quotationServiceCategoryOptions, selectOptions } from './clientMaster.constants';
import { UploadButton } from './ClientMasterFormSections';
import PurchaseDataWorkspace from './PurchaseDataWorkspace';
import { uploadMedia, uploadMediaBatch } from '../../services/mediaUpload';
import { formatDisplayDate as formatProjectDate } from '../../utils/dateFormat';
import {
  annualDraftLegacyKeys,
  buildAnnualReturnYears,
  formatDateInputValue,
  getAnnualDraftAliasValue,
  getAssignedName,
  getClientQuotationContext,
  getClientUniqueId,
  getFirstAnnualReturnYear,
  getMsmeRows,
  normalizeFinancialYearLabel,
  readClientData
} from './clientMaster.utils';
export function formatInrValue(value) {
  return (Number(value) || 0).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function formatDisplayDate(value) {
  return formatProjectDate(value);
}

export function getDocumentLinkName(url, index) {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').filter(Boolean).pop();
    return safeDecode(last || `Document ${index + 1}`);
  } catch {
    const clean = String(url || '').split('/').filter(Boolean).pop();
    return clean ? safeDecode(clean) : `Document ${index + 1}`;
  }
}

export function normalizeDocumentUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '#';
  if (/^https?:\/\//i.test(value)) return encodeURI(value);
  return `https://ananttattva-s3-bucket.s3.ap-south-1.amazonaws.com/${encodeURIComponent(value)}`;
}

export function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function mapClientDocuments(urls = []) {
  const normalized = urls.map((url) => String(url || '').trim()).filter(Boolean);
  const findBy = (keywords) => normalized.find((url) => {
    const name = safeDecode(String(url).split('?')[0]).toLowerCase();
    return keywords.some((keyword) => name.includes(keyword));
  }) || '';

  return {
    gst: findBy(['gst']),
    pan: findBy(['pancard', 'pan card', 'pan-','pan_','pan.','pan ']),
    cin: findBy(['cin', 'incorporation', 'llp incorporation']),
    factory: findBy(['factory']),
    epr: findBy(['epr']),
    msme: findBy(['msme', 'udyam']),
    application: findBy(['application page', 'application'])
  };
}

function getStoredAnnualReturnDraft(data = {}, annualYear = '') {
  const filing = data.annualReturn?.filings?.[annualYear];
  if (filing?.draft && typeof filing.draft === 'object' && !Array.isArray(filing.draft)) return filing.draft;
  return {};
}

export function getStoredAnnualReturnFiling(data = {}, annualYear = '') {
  const filing = data.annualReturn?.filings?.[annualYear];
  if (filing && typeof filing === 'object' && !Array.isArray(filing)) return filing;
  return {};
}

function getStoredAnnualApprovalWorkflow(data = {}, annualYear = '') {
  const filing = getStoredAnnualReturnFiling(data, annualYear);
  const workflow = filing.approvalWorkflow;
  if (workflow && typeof workflow === 'object' && !Array.isArray(workflow) && !isInitialAnnualWorkflowState(workflow)) return workflow;

  const filingStatus = String(filing.status || '').trim().toLowerCase();
  if (['manager_pending', 'manager_rejected', 'compliance_pending', 'compliance_rejected', 'compliance_approved'].includes(filingStatus)) {
    return {
      ...(workflow && typeof workflow === 'object' && !Array.isArray(workflow) ? workflow : {}),
      status: filingStatus,
      currentStage: filingStatus === 'manager_pending' || filingStatus === 'compliance_rejected'
        ? 'manager'
        : filingStatus === 'compliance_pending'
          ? 'compliance'
          : filingStatus === 'compliance_approved'
            ? 'complete'
            : 'user'
    };
  }

  if (workflow && typeof workflow === 'object' && !Array.isArray(workflow)) return workflow;
  return {};
}

function hasAnnualApprovalWorkflowState(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Boolean(
    value.status
    || value.currentStage
    || value.updatedAt
    || Object.keys(value.sections || {}).length
    || (Array.isArray(value.history) && value.history.length)
  );
}

function isInitialAnnualWorkflowState(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
  const status = String(value.status || '').trim().toLowerCase();
  const currentStage = String(value.currentStage || '').trim().toLowerCase();
  return (!status || status === 'draft')
    && (!currentStage || currentStage === 'user')
    && !value.updatedAt
    && !Object.keys(value.sections || {}).length
    && !(Array.isArray(value.history) && value.history.length);
}

function buildAnnualClientSnapshot(data = {}) {
  const { annualReturn, ...snapshot } = data || {};
  return snapshot;
}

export function normalizeAnnualApprovalWorkflow(value = {}, fallback = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const fallbackSource = fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? fallback : {};
  const sourceHasState = hasAnnualApprovalWorkflowState(source);
  const keepFallback = sourceHasState && isInitialAnnualWorkflowState(source) && hasAnnualApprovalWorkflowState(fallbackSource) && !isInitialAnnualWorkflowState(fallbackSource);
  const current = sourceHasState && !keepFallback ? source : fallbackSource;
  const normalizedStatus = String(current.status || '').trim().toLowerCase();
  const inferredStage = normalizedStatus === 'manager_pending' || normalizedStatus === 'compliance_rejected'
    ? 'manager'
    : normalizedStatus === 'compliance_pending'
      ? 'compliance'
      : normalizedStatus === 'compliance_approved'
        ? 'complete'
        : '';
  return {
    status: current.status || 'draft',
    currentStage: current.currentStage || inferredStage || 'user',
    lastRemark: current.lastRemark || '',
    updatedAt: current.updatedAt || '',
    history: Array.isArray(current.history) ? current.history : [],
    sections: current.sections && typeof current.sections === 'object' && !Array.isArray(current.sections) ? current.sections : {}
  };
}

function getAnnualSectionMeta(workflow = {}, sectionTitle = '') {
  const sections = workflow.sections && typeof workflow.sections === 'object' && !Array.isArray(workflow.sections)
    ? workflow.sections
    : {};
  if (sections[sectionTitle]) return sections[sectionTitle];

  const partKey = getAnnualPartKey(sectionTitle);
  if (!partKey) return {};

  const matchingTitle = Object.keys(sections).find((title) => getAnnualPartKey(title) === partKey);
  return matchingTitle ? sections[matchingTitle] || {} : {};
}

function getAnnualSectionMetas(workflow = {}, sectionTitle = '') {
  const sections = workflow.sections && typeof workflow.sections === 'object' && !Array.isArray(workflow.sections)
    ? workflow.sections
    : {};
  const partKey = getAnnualPartKey(sectionTitle);
  const metas = Object.entries(sections)
    .filter(([title]) => partKey && getAnnualPartKey(title) === partKey)
    .map(([, meta]) => meta)
    .filter(Boolean);
  if (sections[sectionTitle] && !metas.includes(sections[sectionTitle])) metas.push(sections[sectionTitle]);
  return metas.length ? metas : [getAnnualSectionMeta(workflow, sectionTitle)];
}

function pickAnnualReviewStatus(statuses = [], fallback = 'pending') {
  const normalized = statuses.map(normalizeAnnualReviewStatus).filter(Boolean);
  if (normalized.includes('approved')) return 'approved';
  if (normalized.includes('rejected')) return 'rejected';
  if (normalized.includes('submitted')) return 'submitted';
  if (normalized.includes('pending')) return 'pending';
  if (normalized.includes('waiting')) return 'waiting';
  return normalizeAnnualReviewStatus(normalized[0] || fallback);
}

function normalizeAnnualReviewStatus(status = '') {
  const normalized = String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'approve' || normalized === 'approved') return 'approved';
  if (normalized === 'reject' || normalized === 'rejected') return 'rejected';
  if (normalized === 'submit' || normalized === 'submitted') return 'submitted';
  if (normalized === 'wait' || normalized === 'waiting' || normalized === 'locked') return 'waiting';
  if (normalized === 'pending' || normalized === 'current_pending') return 'pending';
  return normalized;
}

function getAnnualMetaTimestamp(meta = {}) {
  return Math.max(
    Date.parse(meta?.updatedAt || '') || 0,
    Date.parse(meta?.managerReviewedAt || '') || 0,
    Date.parse(meta?.complianceReviewedAt || '') || 0,
    0
  );
}

function pickAnnualReviewStatusFromMetas(metas = [], statusKey = 'status', fallback = 'pending') {
  const normalizedMetas = metas
    .map((meta) => ({
      meta,
      status: normalizeAnnualReviewStatus(meta?.[statusKey] || (statusKey === 'status' ? '' : meta?.status || '')),
      timestamp: getAnnualMetaTimestamp(meta)
    }))
    .filter((item) => item.status);

  const reviewed = normalizedMetas
    .filter((item) => item.status === 'approved' || item.status === 'rejected')
    .sort((a, b) => b.timestamp - a.timestamp);

  if (reviewed.length) return reviewed[0].status;
  return pickAnnualReviewStatus(normalizedMetas.map((item) => item.status), fallback);
}

function getAnnualWorkflowStageRank(workflow = {}) {
  const stage = getAnnualReviewStage(workflow);
  if (stage === 'complete') return 4;
  if (stage === 'compliance') return 3;
  if (stage === 'manager') return 2;
  return 1;
}

function getAnnualWorkflowReviewedCount(workflow = {}) {
  const sections = workflow.sections && typeof workflow.sections === 'object' && !Array.isArray(workflow.sections)
    ? workflow.sections
    : {};
  const reviewedPartKeys = new Set();
  Object.entries(sections).forEach(([title, meta]) => {
    const partKey = getAnnualPartKey(title);
    if (!partKey) return;
    const managerStatus = normalizeAnnualReviewStatus(meta?.managerStatus || meta?.status || '');
    const complianceStatus = normalizeAnnualReviewStatus(meta?.complianceStatus || '');
    if (['approved', 'rejected'].includes(managerStatus) || ['approved', 'rejected'].includes(complianceStatus)) {
      reviewedPartKeys.add(partKey);
    }
  });
  return reviewedPartKeys.size;
}

function getAnnualWorkflowTimestamp(workflow = {}) {
  const sectionTimes = Object.values(workflow.sections || {})
    .map((meta) => Date.parse(meta?.updatedAt || meta?.managerReviewedAt || meta?.complianceReviewedAt || ''))
    .filter(Number.isFinite);
  const historyTimes = Array.isArray(workflow.history)
    ? workflow.history.map((item) => Date.parse(item?.at || '')).filter(Number.isFinite)
    : [];
  return Math.max(Date.parse(workflow.updatedAt || '') || 0, ...sectionTimes, ...historyTimes, 0);
}

function shouldKeepCurrentAnnualWorkflow(current = {}, incoming = {}) {
  if (!hasAnnualApprovalWorkflowState(current)) return false;
  if (!hasAnnualApprovalWorkflowState(incoming)) return true;
  const currentRank = getAnnualWorkflowStageRank(current);
  const incomingRank = getAnnualWorkflowStageRank(incoming);
  if (currentRank !== incomingRank) return currentRank > incomingRank;
  const currentReviewed = getAnnualWorkflowReviewedCount(current);
  const incomingReviewed = getAnnualWorkflowReviewedCount(incoming);
  if (currentReviewed !== incomingReviewed) return currentReviewed > incomingReviewed;
  const currentHistory = Array.isArray(current.history) ? current.history.length : 0;
  const incomingHistory = Array.isArray(incoming.history) ? incoming.history.length : 0;
  if (currentHistory !== incomingHistory) return currentHistory > incomingHistory;
  return getAnnualWorkflowTimestamp(current) > getAnnualWorkflowTimestamp(incoming);
}

function annualReviewStatusRank(status = '') {
  const normalized = normalizeAnnualReviewStatus(status);
  if (normalized === 'approved' || normalized === 'rejected') return 4;
  if (normalized === 'submitted') return 3;
  if (normalized === 'pending') return 2;
  if (normalized === 'waiting') return 1;
  return 0;
}

function preferAnnualReviewStatus(currentStatus = '', incomingStatus = '') {
  return annualReviewStatusRank(incomingStatus) >= annualReviewStatusRank(currentStatus)
    ? normalizeAnnualReviewStatus(incomingStatus)
    : normalizeAnnualReviewStatus(currentStatus);
}

function mergeAnnualSectionMeta(current = {}, incoming = {}) {
  const merged = { ...(current || {}), ...(incoming || {}) };
  const managerStatus = preferAnnualReviewStatus(current?.managerStatus || current?.status, incoming?.managerStatus || incoming?.status);
  const complianceStatus = preferAnnualReviewStatus(current?.complianceStatus, incoming?.complianceStatus);
  const status = preferAnnualReviewStatus(current?.status, incoming?.status || managerStatus || complianceStatus);
  return {
    ...merged,
    status: status || merged.status || '',
    managerStatus: managerStatus || merged.managerStatus || '',
    complianceStatus: complianceStatus || merged.complianceStatus || ''
  };
}

function mergeAnnualWorkflowSections(currentSections = {}, incomingSections = {}) {
  const merged = {};
  [...new Set([...Object.keys(currentSections || {}), ...Object.keys(incomingSections || {})])].forEach((title) => {
    merged[title] = mergeAnnualSectionMeta(currentSections?.[title] || {}, incomingSections?.[title] || {});
  });
  return merged;
}

export function mergeAnnualWorkflowState(current = {}, incoming = {}) {
  const normalizedCurrent = normalizeAnnualApprovalWorkflow(current);
  const normalizedIncoming = normalizeAnnualApprovalWorkflow(incoming, normalizedCurrent);
  const base = shouldKeepCurrentAnnualWorkflow(normalizedCurrent, normalizedIncoming)
    ? normalizedCurrent
    : normalizedIncoming;
  const other = base === normalizedCurrent ? normalizedIncoming : normalizedCurrent;
  return normalizeAnnualApprovalWorkflow({
    ...other,
    ...base,
    history: Array.isArray(base.history) && base.history.length >= (Array.isArray(other.history) ? other.history.length : 0)
      ? base.history
      : other.history,
    sections: mergeAnnualWorkflowSections(other.sections || {}, base.sections || {})
  });
}

function summarizeAnnualWorkflow(workflow = {}) {
  const sections = workflow.sections && typeof workflow.sections === 'object' && !Array.isArray(workflow.sections)
    ? workflow.sections
    : {};
  return {
    status: workflow.status || 'draft',
    currentStage: workflow.currentStage || 'user',
    reviewedParts: getAnnualWorkflowReviewedCount(workflow),
    sections: Object.fromEntries(Object.entries(sections).map(([title, meta]) => [
      title,
      {
        status: meta?.status || '',
        managerStatus: meta?.managerStatus || '',
        complianceStatus: meta?.complianceStatus || '',
        reviewerRole: meta?.reviewerRole || '',
        updatedAt: meta?.updatedAt || ''
      }
    ])),
    history: Array.isArray(workflow.history) ? workflow.history.map((item) => item?.action || '').filter(Boolean) : [],
    updatedAt: workflow.updatedAt || ''
  };
}

function buildAnnualWorkflowDebugRows(workflow = {}, sectionTitles = []) {
  const titles = sectionTitles.length ? sectionTitles : Object.keys(workflow.sections || {});
  return titles.map((title) => ({
    part: getAnnualPartShortLabel(title),
    title,
    manager: getAnnualStageSectionStatus(workflow, title, 'manager'),
    compliance: getAnnualStageSectionStatus(workflow, title, 'compliance'),
    status: getAnnualSectionStatus(workflow, title)
  }));
}

function mergeAnnualWorkflowIntoClient(client = {}, annualYear = '', workflow = {}) {
  if (!client || !annualYear || !hasAnnualApprovalWorkflowState(workflow)) return client;
  const data = readClientData(client);
  const annualReturn = data.annualReturn && typeof data.annualReturn === 'object' && !Array.isArray(data.annualReturn)
    ? data.annualReturn
    : {};
  const filings = annualReturn.filings && typeof annualReturn.filings === 'object' && !Array.isArray(annualReturn.filings)
    ? annualReturn.filings
    : {};
  const existingFiling = filings[annualYear] && typeof filings[annualYear] === 'object' && !Array.isArray(filings[annualYear])
    ? filings[annualYear]
    : {};
  const existingWorkflow = normalizeAnnualApprovalWorkflow(existingFiling.approvalWorkflow || {});
  const preferredWorkflow = normalizeAnnualApprovalWorkflow(workflow, existingWorkflow);
  const nextWorkflow = mergeAnnualWorkflowState(existingWorkflow, preferredWorkflow);

  return {
    ...client,
    data: {
      ...data,
      annualReturn: {
        ...annualReturn,
        selectedYear: annualYear,
        lastSavedYear: annualYear,
        filings: {
          ...filings,
          [annualYear]: {
            ...existingFiling,
            status: nextWorkflow.status || existingFiling.status || 'draft',
            approvalWorkflow: nextWorkflow
          }
        }
      }
    }
  };
}

function getAnnualSectionStatus(workflow = {}, sectionTitle = '', stage = '') {
  const metas = getAnnualSectionMetas(workflow, sectionTitle);
  if (stage === 'manager') return pickAnnualReviewStatusFromMetas(metas, 'managerStatus', 'pending');
  if (stage === 'compliance') return pickAnnualReviewStatusFromMetas(metas, 'complianceStatus', 'pending');
  return pickAnnualReviewStatus(metas.map((meta) => meta.status || meta.complianceStatus || meta.managerStatus), 'pending');
}

function getAnnualSectionTone(status = '') {
  if (status === 'approved' || status === 'submitted') return 'approved';
  if (status === 'rejected') return 'rejected';
  return 'pending';
}

function buildAnnualUserSubmittedStatuses(sectionTitles = []) {
  return sectionTitles.reduce((next, title) => ({
    ...next,
    [title]: {
      status: 'submitted',
      managerStatus: 'submitted',
      complianceStatus: 'waiting'
    }
  }), {});
}

function getAnnualReviewLockReason({ isManager = false, isComplianceManager = false, effectiveReviewStage = 'user', workflowStatus = 'draft', activeProcessingTab = '', activeSectionTitle = '', isSubmitSection = false } = {}) {
  if (activeProcessingTab !== 'data') return 'Open the Data tab to review annual return parts.';
  if (effectiveReviewStage === 'user') {
    if (isManager || isComplianceManager) return 'Annual return is still draft. User must complete Part A, B, C, D and submit from Part D.';
    return isSubmitSection ? 'Submit to Manager from Part D.' : 'Complete all Data parts and go to Part D to submit.';
  }
  if (effectiveReviewStage === 'manager' && !isManager) return 'Waiting for Manager approval.';
  if (effectiveReviewStage === 'compliance' && !isComplianceManager) return 'Waiting for Compliance Manager approval.';
  if (effectiveReviewStage === 'complete') return 'Annual return is already fully approved.';
  if (workflowStatus === 'manager_rejected') return 'Manager rejected this return. User must correct and resubmit from Part D.';
  if (workflowStatus === 'compliance_rejected') return 'Compliance rejected this return. Manager must correct/re-approve rejected parts.';
  return `Review action is locked for ${activeSectionTitle || 'this part'}.`;
}

function getAnnualPartShortLabel(title = '') {
  const match = String(title).match(/^Part\s+[A-Z]/i);
  return match ? match[0] : 'Part';
}

function getAnnualPartKey(title = '') {
  const match = String(title || '').trim().match(/^Part\s+([A-Z])/i);
  return match ? match[1].toUpperCase() : '';
}

function getAnnualWorkflowHistoryItem(workflow = {}, action = '') {
  const expectedAction = String(action || '').trim().toUpperCase();
  const history = Array.isArray(workflow.history) ? workflow.history : [];
  return [...history].reverse().find((item) => String(item?.action || '').trim().toUpperCase() === expectedAction) || null;
}

function getAnnualWorkflowSubmittedBy(workflow = {}) {
  const submitted = getAnnualWorkflowHistoryItem(workflow, 'SUBMITTED_TO_MANAGER');
  return submitted?.by || '';
}

function isAnnualPartDSection(title = '') {
  return /^Part\s+D\b/i.test(String(title || '').trim());
}

export function getAnnualReviewStage(workflow = {}) {
  const currentStage = String(workflow.currentStage || '').toLowerCase();
  const status = String(workflow.status || '').toLowerCase();
  if (currentStage === 'manager' || status === 'manager_pending') return 'manager';
  if (currentStage === 'compliance' || status === 'compliance_pending') return 'compliance';
  if (currentStage === 'complete' || status === 'compliance_approved') return 'complete';
  return 'user';
}

export function normalizeRoleName(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function hasAnyAnnualRole(currentRole = '', allowedRoles = []) {
  const normalizedRole = normalizeRoleName(currentRole);
  return allowedRoles.some((role) => normalizedRole === normalizeRoleName(role));
}

function getAnnualUserRoleValues(user = {}) {
  return [
    user?.role,
    user?.roleLabel,
    user?.team,
    user?.title,
    user?.designation,
    user?.department
  ].filter(Boolean);
}

function hasAnyAnnualUserRole(user = {}, allowedRoles = []) {
  return getAnnualUserRoleValues(user).some((value) => hasAnyAnnualRole(value, allowedRoles));
}

export const annualProcessingTabLabels = {
  basic: 'Basic Info',
  data: 'Data',
  cpcbLetter: 'CPCB Letter'
};
export const annualProcessingTabIds = Object.keys(annualProcessingTabLabels);
export const annualDataSubTabs = [
  { id: 'compliance', label: 'Data Compliance' }
];

export function getAnnualCompletedTabs(draft = {}) {
  const completed = draft?.__completedTabs && typeof draft.__completedTabs === 'object' && !Array.isArray(draft.__completedTabs)
    ? draft.__completedTabs
    : {};
  return annualProcessingTabIds.reduce((next, tabId) => ({ ...next, [tabId]: Boolean(completed[tabId]) }), {});
}

function getAnnualCompletedCount(draft = {}) {
  const completed = getAnnualCompletedTabs(draft);
  return annualProcessingTabIds.filter((tabId) => completed[tabId]).length;
}

function getAnnualCompletedSections(draft = {}) {
  const completed = draft?.__completedSections && typeof draft.__completedSections === 'object' && !Array.isArray(draft.__completedSections)
    ? draft.__completedSections
    : {};
  return annualProcessingTabIds.reduce((next, tabId) => ({
    ...next,
    [tabId]: Array.isArray(completed[tabId]) ? completed[tabId].filter(Boolean) : []
  }), {});
}

function formatCompletedTabsMessage(completedTabs = {}) {
  const labels = annualProcessingTabIds
    .filter((tabId) => completedTabs[tabId])
    .map((tabId) => annualProcessingTabLabels[tabId]);
  if (!labels.length) return '';
  if (labels.length === 1) return `${labels[0]} done.`;
  return `${labels.join(', ')} done.`;
}

function PoServiceMultiSelect({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = Array.isArray(value) ? value : String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  const filtered = options.filter((option) => option.toLowerCase().includes(query.trim().toLowerCase()));

  function toggle(option) {
    onChange(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option]);
  }

  return (
    <div className="min-w-[360px] rounded-2xl border border-slate-200 bg-white p-2 shadow-sm transition focus-within:border-teal-300 focus-within:ring-4 focus-within:ring-teal-50">
      <button type="button" onClick={() => setOpen((current) => !current)} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-left">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {selected.length ? selected.slice(0, 2).map((service) => <span key={service} className="max-w-40 truncate rounded-lg bg-teal-50 px-2.5 py-1.5 text-xs font-black text-[#30737B]">{service}</span>) : <span className="px-1 text-sm font-bold text-slate-400">Select one or more services</span>}
          {selected.length > 2 && <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-black text-slate-600">+{selected.length - 2} more</span>}
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-[#30737B] transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-100 p-2.5"><Search className="h-4 w-4 text-slate-400" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 border-0 bg-transparent text-sm font-bold outline-none" placeholder="Search services..." />{selected.length > 0 && <button type="button" onClick={() => onChange([])} className="text-xs font-black text-red-500">Clear</button>}</div>
          <div className="max-h-56 overflow-y-auto p-2">
            {filtered.map((option) => {
              const checked = selected.includes(option);
              return <button type="button" key={option} onClick={() => toggle(option)} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-black transition last:mb-0 ${checked ? 'bg-teal-50 text-[#205e65]' : 'text-slate-600 hover:bg-slate-50'}`}><span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border ${checked ? 'border-[#30737B] bg-[#30737B] text-white' : 'border-slate-300 bg-white'}`}>{checked && <Check className="h-3.5 w-3.5" />}</span><span>{option}</span></button>;
            })}
            {!filtered.length && <p className="p-5 text-center text-sm font-bold text-slate-400">No matching service found.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function PoDetailItem({ label, value, wide = false }) {
  return <div className={`rounded-xl border border-slate-200 bg-slate-50/70 p-4 ${wide ? 'sm:col-span-2' : ''}`}><span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span><strong className="mt-1 block break-words text-sm font-black text-slate-800">{value || '-'}</strong></div>;
}

export function AnnualReturnHistory({ client, quotations = [], proformaInvoices = [], staff = [], years, selectedYear, currentUser, onSelectYear, onClientUpdated }) {
  const navigate = useNavigate();
  const data = readClientData(client);
  const firstAnnualReturnYear = getFirstAnnualReturnYear(client, data);
  const [activeProcessingTab, setActiveProcessingTab] = useState('basic');
  const [activeDataSubTab, setActiveDataSubTab] = useState('compliance');
  const [activePillSection, setActivePillSection] = useState('');
  const [annualTransitioning, setAnnualTransitioning] = useState(false);
  const [annualDraft, setAnnualDraft] = useState({});
  const [confirmFinancials, setConfirmFinancials] = useState(false);
  const [annualConfirmOpen, setAnnualConfirmOpen] = useState(false);
  const [pendingAnnualNextTab, setPendingAnnualNextTab] = useState('');
  const [pendingAnnualNextSection, setPendingAnnualNextSection] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const [annualToast, setAnnualToast] = useState(null);
  const [annualCompletionModal, setAnnualCompletionModal] = useState(null);
  const [savingAnnual, setSavingAnnual] = useState(false);
  const [annualSaveError, setAnnualSaveError] = useState('');
  const [approvalWorkflow, setApprovalWorkflow] = useState(normalizeAnnualApprovalWorkflow());
  const [reviewDrawerOpen, setReviewDrawerOpen] = useState(false);
  const selected = years.find((year) => year.label === selectedYear);
  const clientName = data.basic?.clientLegalName || data.basic?.tradeName || 'Selected Client';
  const uniqueId = getClientUniqueId(client);
  const annualPoStorageKey = `annual-return-po:${client?._id || client?.id || uniqueId}`;
  const storedPoWorkflow = Object.values(data.annualReturn?.filings || {})
    .map((filing) => filing?.draft?.purchaseOrderConfirmation)
    .find((value) => value?.confirmed) || {};
  const [poWorkflow, setPoWorkflow] = useState(() => {
    try { return JSON.parse(localStorage.getItem(annualPoStorageKey) || 'null') || storedPoWorkflow; } catch { return storedPoWorkflow; }
  });
  const [poDraft, setPoDraft] = useState(() => {
    try { return JSON.parse(localStorage.getItem(annualPoStorageKey) || 'null') || storedPoWorkflow; } catch { return storedPoWorkflow; }
  });
  const [poModalOpen, setPoModalOpen] = useState(false);
  const [poDetails, setPoDetails] = useState(null);
  const [poResolution, setPoResolution] = useState({ loading: true, error: '', byYear: {}, sourceLead: null });
  const [poRefreshToken, setPoRefreshToken] = useState(0);
  const [poApprovalPreviewOpen, setPoApprovalPreviewOpen] = useState(false);
  const [poValidationError, setPoValidationError] = useState('');
  const assignedName = getAssignedName(client, staff);
  const rawPreviousSpoc = String(data.importMeta?.previousSpoc || '').trim();
  const previousSpocName = rawPreviousSpoc && rawPreviousSpoc.toUpperCase() !== 'N/A'
    ? getAssignedName({ adminControls: { assignedTo: rawPreviousSpoc } }, staff)
    : assignedName;
  const msmeRows = getMsmeRows(data);
  const plants = data.cte?.plantWiseDetails || [];
  const rawDocumentUrls = data.validation?.documentUrls;
  const documentUrls = Array.isArray(rawDocumentUrls)
    ? rawDocumentUrls.map((item) => (typeof item === 'string' ? item : item?.url || item?.fileUrl || item?.path || '')).map((item) => item.trim()).filter(Boolean)
    : String(rawDocumentUrls || '').split(',').map((item) => item.trim()).filter(Boolean);
  const annualPoServiceCategoryOptions = useMemo(() => {
    const fromQuotations = quotations
      .flatMap((quotation) => Array.isArray(quotation.items) ? quotation.items : [])
      .map((item) => String(item.serviceCategory || '').trim())
      .filter(Boolean);
    return [...new Set([...quotationServiceCategoryOptions, ...fromQuotations])].sort((left, right) => left.localeCompare(right));
  }, [quotations]);
  const previousQuotationService = useMemo(() => quotations
    .flatMap((quotation) => Array.isArray(quotation.items) ? quotation.items : [])
    .map((item) => String(item.serviceCategory || item.service || '').trim())
    .filter(Boolean)
    .at(-1) || '', [quotations]);
  const latestQuotationNo = useMemo(() => {
    const normalizeName = (value = '') => String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const clientNames = [
      data.basic?.clientLegalName,
      data.basic?.tradeName,
      data.importMeta?.companyName,
      client?.companyName,
      client?.clientName
    ].map(normalizeName).filter(Boolean);
    const matchingQuotations = quotations.filter((quotation) => {
      const quoteCompany = normalizeName(quotation.leadDetails?.companyName || quotation.companyName || quotation.clientName || '');
      if (!quoteCompany) return false;
      return !clientNames.length || clientNames.some((name) => quoteCompany === name || quoteCompany.includes(name) || name.includes(quoteCompany));
    });
    const sorted = matchingQuotations
      .filter(Boolean)
      .sort((left, right) => new Date(right.createdAt || right.quotationDate || right.updatedAt || 0) - new Date(left.createdAt || left.quotationDate || left.updatedAt || 0));
    const latest = sorted[0] || {};
    return latest.quotationNumber || latest.quotationNo || latest.quoteNumber || data.financials?.quotationNo || data.validation?.quotationNumber || '';
  }, [client, data.basic?.clientLegalName, data.basic?.tradeName, data.financials?.quotationNo, data.importMeta?.companyName, data.validation?.quotationNumber, quotations]);
  const latestProforma = useMemo(() => {
    const normalizeName = (value = '') => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[^a-z0-9]+/g, ' ').replace(/\s+(?:(?:private|pvt)\s+(?:limited|ltd)|limited\s+liability(?:\s+partnership)?|llp|limited|ltd)$/g, '').trim();
    const names = [data.basic?.clientLegalName, data.basic?.tradeName, data.importMeta?.companyName, client?.companyName, client?.clientName].map(normalizeName).filter(Boolean);
    return [...proformaInvoices]
      .filter((invoice) => {
        if (invoice.clientRef && String(invoice.clientRef) === String(client?._id || client?.id || '')) return true;
        const invoiceName = normalizeName(invoice.companyName || invoice.leadDetails?.companyName);
        return invoiceName && names.includes(invoiceName);
      })
      .sort((left, right) => new Date(right.updatedAt || right.createdAt || right.invoiceDate || 0) - new Date(left.updatedAt || left.createdAt || left.invoiceDate || 0))[0] || null;
  }, [client, data.basic?.clientLegalName, data.basic?.tradeName, data.importMeta?.companyName, proformaInvoices]);
  const docLinks = mapClientDocuments(documentUrls);
  const registeredAddress = [data.registeredAddress?.address1, data.registeredAddress?.address2, data.registeredAddress?.address3].filter(Boolean).join(', ');
  const communicationAddress = [data.communicationAddress?.address1, data.communicationAddress?.address2, data.communicationAddress?.city, data.communicationAddress?.state, data.communicationAddress?.pincode].filter(Boolean).join(', ');
  const registeredAddressFull = [registeredAddress, data.registeredAddress?.city, data.registeredAddress?.state, data.registeredAddress?.pincode].filter(Boolean).join(', ');
  const postalAddressFull = communicationAddress || registeredAddressFull;
  const showPostalAddress = !addressesMatch(registeredAddressFull, postalAddressFull);
  const basicAddressFields = (colSpan = 'legacy-wide') => [
    createProcessingField('basic.registeredAddress', 'Registered Address', registeredAddressFull, MapPin, 'textarea', [], 'auto', colSpan),
    ...(showPostalAddress ? [createProcessingField('basic.postalAddress', 'Postal Address', postalAddressFull, MapPin, 'textarea', [], 'auto', colSpan)] : [])
  ];
  const typeOfBusiness = data.basic?.companyIndustry || data.basic?.piboCategory || data.basic?.eprCategory || '';
  const piboCategory = String(data.basic?.piboCategory || '').trim().toUpperCase();
  const isBrandOwner = piboCategory === 'BRAND OWNER' || piboCategory === 'BRANDOWNER';
  const isImporter = piboCategory === 'IMPORTER';
  const isAnnualAdmin = hasAnyAnnualUserRole(currentUser, [...adminRoles, 'super admin']);
  const isAnnualUser = hasAnyAnnualUserRole(currentUser, ['user', 'operation', 'operations', 'sales', 'consultant', 'executive']);
  const isManager = isAnnualAdmin || hasAnyAnnualUserRole(currentUser, ['manager', 'management', 'team manager', 'operation head', 'operations head']);
  const isComplianceManager = isAnnualAdmin || hasAnyAnnualUserRole(currentUser, ['compliance', 'compliance manager']);
  const canFirstStageReview = isManager;
  const canViewAnnualReviewPanel = Boolean(currentUser);
  const reviewUiMode = isAnnualAdmin || isManager || isComplianceManager ? 'drawer' : 'popup';
  const draftKey = selected ? `annual-return-processing:${client?._id || client?.id || uniqueId}:${selected.label}` : '';
  const storedApprovalWorkflow = selected?.label ? getStoredAnnualApprovalWorkflow(data, selected.label) : {};
  const storedApprovalWorkflowKey = selected?.label ? JSON.stringify(storedApprovalWorkflow) : '';
  const quotationContext = selected ? {
    clientId: client?._id || client?.id || '',
    leadId: typeof client?.selectedLead === 'string' ? client.selectedLead : client?.selectedLead?._id || client?.selectedLead?.id || '',
    leadCode: client?.selectedLead?.leadCode || data.importMeta?.leadNumber || uniqueId,
    annualYear: selected.label,
    clientName,
    contactPerson: data.otp?.personName || data.authorised?.name || '',
    designation: data.otp?.designation || data.authorised?.designation || '',
    mobileNo1: data.otp?.mobile || data.authorised?.mobile || '',
    mobileNo2: data.authorised?.alternateMobile || '',
    addressLine1: data.registeredAddress?.address1 || '',
    addressLine2: data.registeredAddress?.address2 || '',
    addressLine3: data.registeredAddress?.address3 || '',
    state: data.registeredAddress?.state || '',
    city: data.registeredAddress?.city || '',
    pinCode: data.registeredAddress?.pincode || '',
    piboCategory: data.basic?.piboCategory || '',
    eprCategory: data.basic?.eprCategory || '',
    returnTo: `/sales/client-data-processing/${encodeURIComponent(client?._id || client?.id || uniqueId)}/${encodeURIComponent(selected.label)}`
  } : null;

  useEffect(() => {
    if (!draftKey) return;
    const dbDraft = selected?.label ? getStoredAnnualReturnDraft(data, selected.label) : {};
    let nextDraft = {};
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) || '{}');
      const hasDbDraft = dbDraft && typeof dbDraft === 'object' && Object.keys(dbDraft).length > 0;
      nextDraft = hasDbDraft ? dbDraft : (saved && typeof saved === 'object' ? saved : {});
    } catch {
      nextDraft = dbDraft && typeof dbDraft === 'object' ? dbDraft : {};
    }
    setAnnualDraft(nextDraft);
    setActiveDataSubTab('compliance');
    const completedTabs = getAnnualCompletedTabs(nextDraft);
    const restoredMessage = formatCompletedTabsMessage(completedTabs);
    setConfirmFinancials(false);
    setAnnualConfirmOpen(false);
    setPendingAnnualNextTab('');
    setPendingAnnualNextSection('');
    setSaveNotice('');
    setAnnualToast(restoredMessage ? { type: 'success', message: restoredMessage } : null);
    setAnnualCompletionModal(null);
    setAnnualSaveError('');
    setApprovalWorkflow(normalizeAnnualApprovalWorkflow(getStoredAnnualApprovalWorkflow(data, selected?.label)));
    setReviewDrawerOpen(false);
  }, [draftKey, selected?.label, client?._id, client?.id]);

  useEffect(() => {
    if (!selected?.label) return;
    setApprovalWorkflow((current) => {
      const normalizedCurrent = normalizeAnnualApprovalWorkflow(current);
      const normalizedStored = normalizeAnnualApprovalWorkflow(storedApprovalWorkflow, normalizedCurrent);
      const merged = mergeAnnualWorkflowState(normalizedCurrent, normalizedStored);
      const keepCurrent = summarizeAnnualWorkflow(merged).reviewedParts === summarizeAnnualWorkflow(normalizedCurrent).reviewedParts
        && getAnnualWorkflowStageRank(merged) === getAnnualWorkflowStageRank(normalizedCurrent);
      console.debug('[AnnualReview:stored-workflow-sync]', {
        annualYear: selected.label,
        keepCurrent,
        current: summarizeAnnualWorkflow(normalizedCurrent),
        stored: summarizeAnnualWorkflow(normalizedStored),
        merged: summarizeAnnualWorkflow(merged)
      });
      return merged;
    });
  }, [selected?.label, storedApprovalWorkflowKey]);

  useEffect(() => {
    if (!annualToast) return undefined;
    const timer = window.setTimeout(() => setAnnualToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [annualToast]);

  useEffect(() => {
    if (!poModalOpen && !poApprovalPreviewOpen && !poDetails) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [poModalOpen, poApprovalPreviewOpen, poDetails]);

  useEffect(() => {
    if (selected || !years.length) return undefined;
    const clientId = client?._id || client?.id;
    if (!clientId) {
      setPoResolution({ loading: false, error: '', byYear: Object.fromEntries(years.map((year) => [year.label, { fy: year.label, poRequired: false, poStatus: 'unlinked', po: null }])), sourceLead: null });
      return undefined;
    }
    let cancelled = false;
    setPoResolution((current) => ({ ...current, loading: true, error: '' }));
    api.get(API_ENDPOINTS.clients.annualReturnPoStatus(clientId), {
      params: { years: years.map((year) => year.label).join(',') }
    }).then((response) => {
      if (cancelled) return;
      const rows = Array.isArray(response.data?.years) ? response.data.years : [];
      setPoResolution({
        loading: false,
        error: '',
        byYear: Object.fromEntries(rows.map((row) => [normalizeFinancialYearLabel(row.fy), row])),
        sourceLead: response.data?.sourceLead || null
      });
    }).catch((error) => {
      if (cancelled) return;
      setPoResolution({ loading: false, error: error?.response?.data?.error || 'Unable to check PO details.', byYear: {}, sourceLead: null });
    });
    return () => { cancelled = true; };
  }, [client?._id, client?.id, selected, poRefreshToken, years.map((year) => year.label).join('|')]);

  function updatePoRows(nextRows) {
    setPoDraft((current) => ({ ...current, mode: current.mode || 'yes', rows: nextRows }));
  }

  function addPoYear() {
    const rows = Array.isArray(poDraft.rows) ? poDraft.rows : [];
    const nextAvailableYear = years.find((year) => !rows.some((row) => row.fyYear === year.label))?.label || '';
    const inheritedService = rows.at(-1)?.service || previousQuotationService || '';
    updatePoRows([...rows, { fyYear: nextAvailableYear, poNumber: '', file: null, service: inheritedService }]);
  }

  function updatePoRow(index, field, value) {
    const rows = Array.isArray(poDraft.rows) ? poDraft.rows : [];
    updatePoRows(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  }

  async function uploadPoFile(index, file) {
    if (!file) return;
    updatePoRow(index, 'file', await uploadMedia(file, 'crm/annual-return/purchase-orders'));
  }

  async function uploadApprovalFiles(fileList) {
    const approvalFiles = await uploadMediaBatch(fileList, 'crm/annual-return/special-approvals');
    setPoDraft((current) => ({ ...current, approvalFiles }));
  }

  async function savePoWorkflow() {
    const mode = poDraft.mode;
    const rows = Array.isArray(poDraft.rows) ? poDraft.rows : [];
    if (!mode) {
      setPoValidationError('Please select Yes or No for PO Received.');
      return;
    }
    const invalid = !rows.length || rows.some((row) => !row.fyYear || !String(row.poNumber || '').trim() || !row.file || !String(row.service || '').trim());
    if (invalid) {
      setPoValidationError('FY Year, PO Number, PO Upload and Service are required for every row.');
      return;
    }
    const saved = { ...poDraft, mode, confirmed: true, savedAt: new Date().toISOString() };
    const clientId = client?._id || client?.id || data.importMeta?.uniqueId;
    const targetYears = [...new Set(rows.map((row) => row.fyYear))];
    try {
      await Promise.all(targetYears.map((annualYear, index) => api.put(API_ENDPOINTS.clients.annualReturn(clientId), {
        annualYear,
        notifyPoApproval: mode === 'no' && index === 0,
        activeTab: 'basic',
        activeSection: 'Purchase Order Confirmation',
        status: 'draft',
        draft: {
          ...getStoredAnnualReturnDraft(data, annualYear),
          purchaseOrderConfirmation: saved
        }
      })));
    } catch (error) {
      setPoValidationError(error?.response?.data?.error || 'Unable to save PO confirmation. Please try again.');
      return;
    }
    localStorage.setItem(annualPoStorageKey, JSON.stringify(saved));
    setPoWorkflow(saved);
    setPoDraft(saved);
    setPoValidationError('');
    setPoModalOpen(false);
    setPoRefreshToken((value) => value + 1);
    setAnnualToast({ type: 'success', message: 'Purchase Order confirmation saved successfully.' });
  }

  function isAnnualYearLocked(yearLabel) {
    if (poResolution.loading || poResolution.error) return true;
    return ['pending', 'conflict'].includes(poResolution.byYear[normalizeFinancialYearLabel(yearLabel)]?.poStatus);
  }

  function poStateForYear(yearLabel) {
    if (poResolution.loading) return { fy: yearLabel, poStatus: 'loading', poRequired: false, po: null };
    if (poResolution.error) return { fy: yearLabel, poStatus: 'error', poRequired: false, po: null, message: poResolution.error };
    return poResolution.byYear[normalizeFinancialYearLabel(yearLabel)] || { fy: yearLabel, poStatus: 'unlinked', poRequired: false, po: null };
  }

  useEffect(() => {
    if (!reviewDrawerOpen) return undefined;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const previousOverflow = document.body.style.overflow;
    const previousPosition = document.body.style.position;
    const previousTop = document.body.style.top;
    const previousWidth = document.body.style.width;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousOverflow;
      document.body.style.position = previousPosition;
      document.body.style.top = previousTop;
      document.body.style.width = previousWidth;
      window.scrollTo(0, scrollY);
    };
  }, [reviewDrawerOpen]);

  function readDraftValue(label, fallback = '') {
    const saved = annualDraft[label];
    if (saved !== undefined && saved !== null) return saved;
    const legacySaved = annualDraft[annualDraftLegacyKeys[label]];
    if (legacySaved !== undefined && legacySaved !== null) return legacySaved;
    const alternateLegacySaved = getAnnualDraftAliasValue(annualDraft, label);
    if (alternateLegacySaved !== undefined && alternateLegacySaved !== null) return alternateLegacySaved;
    return fallback || '';
  }

  function updateDraftValue(label, value) {
    setAnnualDraft((current) => {
      const next = { ...current, [label]: value };
      const clearDraftKeys = (keys) => keys.forEach((key) => {
        delete next[key];
        const legacyKey = annualDraftLegacyKeys[key];
        if (legacyKey) delete next[legacyKey];
      });

      if (label === 'importer.productionFacility' && !isYesAnswer(value)) {
        clearDraftKeys(['importer.districtIndustryCentreRegistered', 'importer.registrationCopy']);
      }
      if (label === 'importer.districtIndustryCentreRegistered' && !isYesAnswer(value)) {
        clearDraftKeys(['importer.registrationCopy']);
      }
      if (label === 'importer.applicationRenewal' && !isYesAnswer(value)) {
        clearDraftKeys(['importer.registrationNumber', 'importer.dateOfIssue', 'importer.validityOfRegistration']);
      }
      if (label === 'brandOwner.productionFacility' && !isYesAnswer(value)) {
        clearDraftKeys(['brandOwner.districtIndustryCentreRegistered', 'brandOwner.registrationCopy']);
      }
      if (label === 'brandOwner.districtIndustryCentreRegistered' && !isYesAnswer(value)) {
        clearDraftKeys(['brandOwner.registrationCopy']);
      }
      if (label === 'brandOwner.applicationRenewal' && !isYesAnswer(value)) {
        clearDraftKeys(['brandOwner.registrationNumber', 'brandOwner.dateOfIssue', 'brandOwner.validityOfRegistration']);
      }
      if (label === 'data.productionFacility' && !isYesAnswer(value)) {
        clearDraftKeys(['data.districtIndustryCentreRegistered', 'data.registrationCopy']);
      }
      if (label === 'data.districtIndustryCentreRegistered' && !isYesAnswer(value)) {
        clearDraftKeys(['data.registrationCopy']);
      }
      if (label === 'data.applicationRenewal' && !isYesAnswer(value)) {
        clearDraftKeys(['data.registrationNumber', 'data.dateOfIssue', 'data.validityOfRegistration']);
      }

      return next;
    });
    setSaveNotice('');
  }

  function draftAnswerIsYes(label, fallback = '') {
    return isYesAnswer(readDraftValue(label, fallback));
  }

  function draftAnswerValue(label, fallback = '') {
    return readDraftValue(label, fallback);
  }

  function transitionAnnualContent(applyChange) {
    setAnnualTransitioning(true);
    window.setTimeout(() => {
      applyChange();
      window.setTimeout(() => setAnnualTransitioning(false), 130);
    }, 60);
  }

  function switchProcessingTab(tabId) {
    if (!tabId || tabId === activeProcessingTab) return;
    transitionAnnualContent(() => {
      setActiveProcessingTab(tabId);
      setActivePillSection('');
    });
  }

  function switchPillSection(sectionTitle) {
    if (!sectionTitle || sectionTitle === activePillSection || sectionTitle === activeSection?.title) return;
    transitionAnnualContent(() => setActivePillSection(sectionTitle));
  }

  async function saveAnnualDraft(nextTab = '', nextSection = '', workflowOverride = null, statusOverride = 'draft', completionTab = '') {
    if (!selected?.label) return;
    const clientId = client?._id || client?.id || uniqueId;
    if (!clientId) {
      setAnnualSaveError('Unable to save annual return: client id not found.');
      return;
    }

    setSavingAnnual(true);
    setAnnualSaveError('');
    const completedTabs = {
      ...(annualDraft.__completedTabs && typeof annualDraft.__completedTabs === 'object' ? annualDraft.__completedTabs : {})
    };
    const completedSections = {
      ...(annualDraft.__completedSections && typeof annualDraft.__completedSections === 'object' ? annualDraft.__completedSections : {})
    };
    const currentSectionTitle = activeSection?.title || nextSection || '';
    if (currentSectionTitle) {
      completedSections[activeProcessingTab] = [
        ...new Set([...(Array.isArray(completedSections[activeProcessingTab]) ? completedSections[activeProcessingTab] : []), currentSectionTitle])
      ];
    }
    if (completionTab && annualProcessingTabLabels[completionTab]) completedTabs[completionTab] = true;
    const draftToSave = { ...annualDraft, __completedTabs: completedTabs, __completedSections: completedSections, savedAt: new Date().toISOString() };
    const workflowToSave = workflowOverride || approvalWorkflow;
    const payloadSummary = {
      clientId,
      annualYear: selected.label,
      activeTab: nextTab || activeProcessingTab,
      activeSection: nextSection || activeSection?.title || '',
      status: statusOverride,
      workflow: summarizeAnnualWorkflow(workflowToSave)
    };
    console.groupCollapsed('[AnnualReview:saveAnnualDraft] request');
    console.debug(payloadSummary);
    console.groupEnd();
    try {
      const response = await api.put(API_ENDPOINTS.clients.annualReturn(clientId), {
        annualYear: selected.label,
        draft: draftToSave,
        activeTab: nextTab || activeProcessingTab,
        activeSection: nextSection || activeSection?.title || '',
        status: statusOverride,
        approvalWorkflow: workflowToSave,
        clientData: buildAnnualClientSnapshot(data),
        adminControls: client?.adminControls || {},
        currentSpoc: assignedName || '',
        previousSpoc: previousSpocName || ''
      }, { timeout: 30000 });
      const savedWorkflow = response.data?.annualReturn?.approvalWorkflow;
      const savedNormalizedWorkflow = normalizeAnnualApprovalWorkflow(savedWorkflow, workflowToSave);
      const requestedNormalizedWorkflow = normalizeAnnualApprovalWorkflow(workflowToSave, savedNormalizedWorkflow);
      const nextWorkflow = mergeAnnualWorkflowState(savedNormalizedWorkflow, requestedNormalizedWorkflow);
      console.groupCollapsed('[AnnualReview:saveAnnualDraft] response');
      console.debug({
        ok: response.data?.ok,
        responseStatus: response.data?.annualReturn?.status || response.data?.annualReturnRecord?.status || '',
        requested: summarizeAnnualWorkflow(requestedNormalizedWorkflow),
        saved: summarizeAnnualWorkflow(savedNormalizedWorkflow),
        selected: summarizeAnnualWorkflow(nextWorkflow)
      });
      console.table(buildAnnualWorkflowDebugRows(nextWorkflow, getDataSectionTitles()));
      console.groupEnd();
      setAnnualDraft(response.data?.annualReturn?.draft || draftToSave);
      setApprovalWorkflow((current) => {
        const normalizedCurrent = normalizeAnnualApprovalWorkflow(current);
        const normalizedNext = mergeAnnualWorkflowState(normalizedCurrent, nextWorkflow);
        const keepCurrent = shouldKeepCurrentAnnualWorkflow(normalizedCurrent, normalizedNext);
        console.debug('[AnnualReview:state-merge-after-save]', {
          keepCurrent,
          current: summarizeAnnualWorkflow(normalizedCurrent),
          next: summarizeAnnualWorkflow(normalizedNext)
        });
        return normalizedNext;
      });
      if (draftKey) localStorage.setItem(draftKey, JSON.stringify(response.data?.annualReturn?.draft || draftToSave));
      if (response.data?.client) {
        onClientUpdated?.(mergeAnnualWorkflowIntoClient(response.data.client, selected.label, nextWorkflow));
      }
      setSaveNotice('Annual Return data saved in database.');
      if (completionTab && annualProcessingTabLabels[completionTab]) {
        const message = `${annualProcessingTabLabels[completionTab]} done.`;
        setAnnualCompletionModal({ title: message, message: `${annualProcessingTabLabels[completionTab]} has been completed successfully.` });
        setAnnualToast({ type: 'success', message });
      }
      if (nextTab && nextTab !== activeProcessingTab) switchProcessingTab(nextTab);
      else if (nextSection) switchPillSection(nextSection);
      return true;
    } catch (err) {
      console.error('[AnnualReview:saveAnnualDraft] failed', {
        payload: payloadSummary,
        status: err?.response?.status,
        error: err?.response?.data?.error || err?.message,
        response: err?.response?.data
      });
      setAnnualSaveError(err?.code === 'ECONNABORTED'
        ? 'Save request timed out. Please check backend/MongoDB and try again.'
        : err?.response?.data?.error || 'Unable to save annual return data in database.');
      return false;
    } finally {
      setSavingAnnual(false);
    }
  }

  function getNextAnnualTarget() {
    const currentSectionIndex = activeSections.findIndex((section) => section.title === activeSection?.title);
    if (currentSectionIndex > -1 && currentSectionIndex < activeSections.length - 1) {
      return { tab: activeProcessingTab, section: activeSections[currentSectionIndex + 1].title };
    }
    const currentIndex = processingTabs.findIndex((tab) => tab.id === activeProcessingTab);
    return { tab: processingTabs[Math.min(currentIndex + 1, processingTabs.length - 1)]?.id || activeProcessingTab, section: '' };
  }

  function isLastSectionInCurrentTab() {
    const currentSectionIndex = activeSections.findIndex((section) => section.title === activeSection?.title);
    return currentSectionIndex > -1 && currentSectionIndex === activeSections.length - 1;
  }

  async function handleAnnualSubmitNext() {
    const nextTarget = getNextAnnualTarget();
    const completionTab = isLastSectionInCurrentTab() ? activeProcessingTab : '';
    const saved = await saveAnnualDraft(nextTarget.tab, nextTarget.section, null, 'draft', completionTab);
    if (saved) {
      setSaveNotice(completionTab ? 'Saved in database. Continue to the next step.' : '');
      if (!completionTab) setAnnualToast({ type: 'success', message: 'Saved. Continue to the next section.' });
    }
  }

  function closeAnnualConfirm() {
    setAnnualConfirmOpen(false);
    setConfirmFinancials(false);
    setPendingAnnualNextTab('');
    setPendingAnnualNextSection('');
  }

  async function confirmAnnualSubmission() {
    if (!confirmFinancials) return;
    const fallbackTarget = getNextAnnualTarget();
    const nextTab = pendingAnnualNextTab || fallbackTarget.tab;
    const nextSection = pendingAnnualNextSection || fallbackTarget.section;
    setAnnualConfirmOpen(false);
    setConfirmFinancials(false);
    setPendingAnnualNextTab('');
    setPendingAnnualNextSection('');
    await saveAnnualDraft(nextTab, nextSection, null, 'draft', isLastSectionInCurrentTab() ? activeProcessingTab : '');
  }

  function getDataSectionTitles() {
    return (sectionsByTab.data || []).map((section) => section.title).filter(Boolean);
  }

  function buildSubmittedSectionStatusMap() {
    const now = new Date().toISOString();
    return getDataSectionTitles().reduce((next, title) => ({
      ...next,
      [title]: {
        ...(approvalWorkflow.sections?.[title] || {}),
        status: 'pending',
        managerStatus: 'pending',
        complianceStatus: 'waiting',
        reviewerRole: 'manager',
        updatedAt: now
      }
    }), {});
  }

  function buildSingleSectionReviewMap(sectionTitle, sectionStatus, reviewerRole, baseSections = approvalWorkflow.sections) {
    const stageStatusKey = reviewerRole === 'compliance' ? 'complianceStatus' : 'managerStatus';
    const reviewerNameKey = reviewerRole === 'compliance' ? 'complianceReviewedBy' : 'managerReviewedBy';
    const reviewerAtKey = reviewerRole === 'compliance' ? 'complianceReviewedAt' : 'managerReviewedAt';
    const now = new Date().toISOString();
    const reviewerName = currentUser?.name || currentUser?.email || (reviewerRole === 'compliance' ? 'Compliance Manager' : 'Manager');
    const partKey = getAnnualPartKey(sectionTitle);
    const nextSections = { ...(baseSections || {}) };
    const matchingTitles = Object.keys(nextSections).filter((title) => partKey && getAnnualPartKey(title) === partKey);
    [...new Set([...matchingTitles, sectionTitle])].forEach((title) => {
      nextSections[title] = {
        ...(nextSections?.[title] || {}),
        status: sectionStatus,
        [stageStatusKey]: sectionStatus,
        [reviewerNameKey]: reviewerName,
        [reviewerAtKey]: now,
        reviewerRole,
        updatedAt: now
      };
    });
    return nextSections;
  }

  function getAnnualSectionStageStatus(sections, title, reviewerRole) {
    const meta = getAnnualSectionMeta({ sections }, title);
    const statusKey = reviewerRole === 'compliance' ? 'complianceStatus' : 'managerStatus';
    return normalizeAnnualReviewStatus(meta[statusKey] || meta.status || '');
  }

  function getAnnualSectionMetaByPart(sections = {}, title = '') {
    const partKey = getAnnualPartKey(title);
    if (!partKey) return sections?.[title] || {};
    const exactMeta = sections?.[title];
    const savedTitles = Object.keys(sections || {});
    const matchingMeta = savedTitles
      .filter((savedTitle) => getAnnualPartKey(savedTitle) === partKey)
      .map((savedTitle) => sections?.[savedTitle])
      .filter(Boolean);
    return Object.assign({}, ...matchingMeta, exactMeta || {});
  }

  function hasAnnualPartApprovedBy(sections = {}, partKey = '', reviewerRole = 'manager') {
    const statusKey = reviewerRole === 'compliance' ? 'complianceStatus' : 'managerStatus';
    return Object.entries(sections || {}).some(([title, meta]) => (
      getAnnualPartKey(title) === partKey &&
      normalizeAnnualReviewStatus(meta?.[statusKey] || meta?.status || '') === 'approved'
    ));
  }

  function allSectionsReviewedBy(sections, reviewerRole) {
    const currentTitles = getDataSectionTitles();
    const requiredPartKeys = currentTitles.map(getAnnualPartKey).filter(Boolean);
    const uniqueRequiredPartKeys = [...new Set(requiredPartKeys)];
    return uniqueRequiredPartKeys.length > 0 && uniqueRequiredPartKeys.every((partKey) => hasAnnualPartApprovedBy(sections, partKey, reviewerRole));
  }

  function resetSectionsForCompliance(sections) {
    const now = new Date().toISOString();
    return getDataSectionTitles().reduce((next, title) => ({
      ...next,
      [title]: {
        ...getAnnualSectionMetaByPart(sections, title),
        managerStatus: hasAnnualPartApprovedBy(sections, getAnnualPartKey(title), 'manager')
          ? 'approved'
          : sections?.[title]?.managerStatus || 'pending',
        status: 'pending',
        complianceStatus: 'pending',
        reviewerRole: 'compliance',
        updatedAt: now
      }
    }), {});
  }

  function buildCompliancePendingWorkflow(workflow, sections) {
    return normalizeAnnualApprovalWorkflow({
      ...workflow,
      status: 'compliance_pending',
      currentStage: 'compliance',
      lastRemark: '',
      updatedAt: new Date().toISOString(),
      sections: resetSectionsForCompliance(sections),
      history: [
        ...(workflow.history || []),
        { action: 'MANAGER_APPROVED_ALL', by: currentUser?.name || currentUser?.email || 'Manager', at: new Date().toISOString(), remark: '' }
      ]
    });
  }

  async function submitDataForManager() {
    const nextWorkflow = normalizeAnnualApprovalWorkflow({
      ...approvalWorkflow,
      status: 'manager_pending',
      currentStage: 'manager',
      lastRemark: '',
      updatedAt: new Date().toISOString(),
      sections: buildSubmittedSectionStatusMap(),
      history: [
        ...(approvalWorkflow.history || []),
        { action: 'SUBMITTED_TO_MANAGER', by: currentUser?.name || currentUser?.email || 'User', at: new Date().toISOString(), remark: '' }
      ]
    });
    console.debug('[AnnualReview:submit-to-manager]', summarizeAnnualWorkflow(nextWorkflow));
    setApprovalWorkflow(nextWorkflow);
    const saved = await saveAnnualDraft(activeProcessingTab, activeSection?.title || '', nextWorkflow, 'manager_pending', 'data');
    if (saved) {
      setApprovalWorkflow(nextWorkflow);
      setReviewDrawerOpen(false);
      setSaveNotice('Data submitted to manager for review.');
      setAnnualToast({ type: 'success', message: 'Annual return submitted to Manager for review.' });
    }
  }

  async function handleAnnualReview(status, sectionTitleOverride = '') {
    const remark = '';
    const approved = status === 'APPROVED';
    const effectiveReviewStage = getAnnualReviewStage(approvalWorkflow);
    const managerAction = canFirstStageReview && effectiveReviewStage === 'manager';
    const complianceAction = !managerAction && isComplianceManager && effectiveReviewStage === 'compliance';
    if (!managerAction && !complianceAction) {
      setAnnualSaveError('Only Manager and Compliance Manager can approve or reject annual data.');
      return;
    }

    const currentSectionTitle = sectionTitleOverride || activeSection?.title || '';
    if (!currentSectionTitle) return;
    const sectionStatus = approved ? 'approved' : 'rejected';
    const reviewerRole = managerAction ? 'manager' : 'compliance';
    const reviewedSections = buildSingleSectionReviewMap(currentSectionTitle, sectionStatus, reviewerRole, approvalWorkflow.sections);
    const managerFinished = managerAction && approved && allSectionsReviewedBy(reviewedSections, 'manager');
    const complianceFinished = complianceAction && approved && allSectionsReviewedBy(reviewedSections, 'compliance');
    const sections = reviewedSections;
    const nextStatus = managerAction
      ? (approved ? (managerFinished ? 'compliance_pending' : 'manager_pending') : 'manager_rejected')
      : (approved ? (complianceFinished ? 'compliance_approved' : 'compliance_pending') : 'compliance_rejected');
    const nextStage = managerAction
      ? (approved ? (managerFinished ? 'compliance' : 'manager') : 'user')
      : (approved ? (complianceFinished ? 'complete' : 'compliance') : 'manager');
    const action = `${reviewerRole.toUpperCase()}_${status}`;
    const nextWorkflow = managerFinished
      ? buildCompliancePendingWorkflow(approvalWorkflow, reviewedSections)
      : normalizeAnnualApprovalWorkflow({
      ...approvalWorkflow,
      status: nextStatus,
      currentStage: nextStage,
      lastRemark: remark,
      updatedAt: new Date().toISOString(),
      sections,
      history: [
        ...(approvalWorkflow.history || []),
        { action, section: currentSectionTitle, by: currentUser?.name || currentUser?.email || reviewerRole, at: new Date().toISOString(), remark }
      ]
    });

    console.groupCollapsed('[AnnualReview:handleAnnualReview]');
    console.debug({
      action,
      currentSectionTitle,
      approved,
      reviewerRole,
      managerFinished,
      complianceFinished,
      before: summarizeAnnualWorkflow(approvalWorkflow),
      after: summarizeAnnualWorkflow(nextWorkflow)
    });
    console.table(buildAnnualWorkflowDebugRows(nextWorkflow, getDataSectionTitles()));
    console.groupEnd();
    setApprovalWorkflow(nextWorkflow);
    onClientUpdated?.(mergeAnnualWorkflowIntoClient(client, selected?.label, nextWorkflow));
    const saved = await saveAnnualDraft(activeProcessingTab, currentSectionTitle, nextWorkflow, nextStatus);
    if (!saved) {
      setApprovalWorkflow(approvalWorkflow);
      return;
    }
    setApprovalWorkflow(nextWorkflow);
    if (!approved || managerFinished || complianceFinished) setReviewDrawerOpen(false);
    setSaveNotice(approved
      ? (managerFinished || complianceFinished ? 'All parts approved and workflow moved ahead.' : `${currentSectionTitle} approved. Review next part.`)
      : `${currentSectionTitle} rejected.`);
  }

  const processingTabs = [
    { id: 'basic', label: 'Basic Info', icon: Building2 },
    { id: 'data', label: 'Data', icon: Database },
    { id: 'cpcbLetter', label: 'CPCB Letter', icon: ShieldCheck }
  ];
  const completedAnnualTabs = getAnnualCompletedTabs(annualDraft);
  const completedAnnualCount = getAnnualCompletedCount(annualDraft);
  const completedAnnualSections = getAnnualCompletedSections(annualDraft);
  const producerProductionFacilityFallback = data.annualReturn?.productionFacility || '';
  const producerApplicationRenewalFallback = data.annualReturn?.applicationRenewal || data.cpcb?.applicationType || '';
  const producerDicRegisteredFallback = data.annualReturn?.districtIndustryCentreRegistered || data.annualReturn?.dicRegistrationStatus || '';
  const producerProductionFacility = draftAnswerValue('data.productionFacility', producerProductionFacilityFallback);
  const producerApplicationRenewal = draftAnswerValue('data.applicationRenewal', producerApplicationRenewalFallback);
  const producerDicRegistered = draftAnswerValue('data.districtIndustryCentreRegistered', producerDicRegisteredFallback);
  const showProducerProductionDetails = isYesAnswer(producerProductionFacility);
  const showProducerRenewalDetails = isYesAnswer(producerApplicationRenewal);
  const showProducerDicUpload = showProducerProductionDetails && isYesAnswer(producerDicRegistered);
  const producerOtherDetailFields = [
    createProcessingField('data.stateOfCto', 'State / UT in which the CTO is issued by SPCB / PCC', data.registeredAddress?.state || '', MapPin),
    createProcessingField('data.productionFacility', 'Does Producer have Production Facility', producerProductionFacility, CheckCircle2, 'select', ['Yes', 'No'], 'manual'),
    ...(showProducerProductionDetails ? [
      createProcessingField('data.districtIndustryCentreRegistered', 'Registered with District Industries Centre / State Government / UT?', producerDicRegistered, ShieldCheck, 'select', ['Yes', 'No'], 'manual')
    ] : []),
    ...(showProducerDicUpload ? [
      createProcessingField('data.registrationCopy', 'Registration Copy / Upload Document', data.annualReturn?.registrationCopy || data.validation?.factoryLicenseFile || '', Upload, 'file')
    ] : []),
    createProcessingField('data.applicationRenewal', 'Application is for Renewal', producerApplicationRenewal, RefreshCw, 'select', ['Yes', 'No'], 'manual'),
    ...(showProducerRenewalDetails ? [
      createProcessingField('data.registrationNumber', 'Registration No.', data.cpcb?.registrationNumber || data.compliance?.eprCertificate || data.compliance?.eprCertificateNumber, FileText),
      createProcessingField('data.dateOfIssue', 'Date of Issue', data.cpcb?.issueDate || data.cpcb?.approvalDate || data.compliance?.eprCertificateDate, CalendarDays, 'date'),
      createProcessingField('data.validityOfRegistration', 'Validity of Registration Certificate / Uploaded Document', data.cpcb?.validityDate || data.compliance?.eprCertificateValidity || '', CalendarDays, 'file')
    ] : []),
    createProcessingField('data.totalCapitalInvested', 'Total Capital Invested in the Project Concerned', data.financials?.totalCapitalInvested || data.annualReturn?.totalCapitalInvested || '', FileText, 'number'),
    createProcessingField('data.commencementYear', 'Year of Commencement of Operation', data.annualReturn?.commencementYear || data.basic?.onboardingYear, CalendarDays, 'text'),
    createProcessingField('data.productDetails', 'Details Type of Products Produced / Marketed', data.annualReturn?.productDetails || '', Database, 'textarea'),
    createProcessingField('data.productPackagingMajorMaterial', 'Product Packaging Image / Upload Image', data.annualReturn?.productPackagingMajorMaterial || '', Upload, 'file'),
    createProcessingField('data.processFlowDiagram', 'Process Flow Diagram / Upload Document', docLinks.application || data.annualReturn?.processFlowDiagram || '', Upload, 'file'),
    createProcessingField('data.thicknessOfPlastic', 'Thickness of Plastic in Micron', data.annualReturn?.thicknessOfPlastic || '', FileText, 'text')
  ];
  const producerDataSections = [
    {
      title: 'Part A - Client Data',
      type: 'legacyData',
      groups: [
        {
          title: 'Client Details',
          tone: 'green',
          fields: [
            createProcessingField('basic.organisationLegalName', 'Name of the Organisation', clientName, Building2),
            createProcessingField('basic.tradeName', 'Trade Name', data.basic?.tradeName, Building2),
            ...basicAddressFields(),
            createProcessingField('basic.companyPan', "Company's PAN", data.compliance?.pan || data.compliance?.panNumber, FileText),
            createProcessingField('basic.companyGst', "Company's GST", data.compliance?.gst || data.compliance?.gstNumber, FileText)
          ]
        },
        {
          title: 'Authorised Person Details',
          fields: [
            createProcessingField('basic.authorisedPersonName', 'Name', data.authorised?.name || data.otp?.personName, UserRound),
            createProcessingField('basic.authorisedPersonDesignation', 'Designation', data.authorised?.designation || data.otp?.designation, UserRound),
            createProcessingField('basic.otpMobile', 'Mobile No.', data.otp?.mobile || data.authorised?.mobile, UserRound, 'tel'),
            createProcessingField('basic.authorisedPersonEmail', 'Email Id', data.authorised?.email || data.coordinating?.email, FileText, 'email'),
            createProcessingField('basic.authorisedPersonPan', 'PAN Number', data.authorised?.pan, FileText)
          ]
        },
        {
          title: 'Other Details / Attach in Required for All Filing',
          tone: 'dark',
          fields: producerOtherDetailFields
        },
        {
          title: 'Plastic Consumption',
          type: 'plasticConsumptionTable',
          tableKey: 'data.plasticConsumptionRows',
          rows: buildPlasticConsumptionRows(data.annualReturn, selected?.label)
        }
      ]
    },
    {
      title: 'Part B - Consent Details',
      fields: [
        createProcessingField('data.partB.state', 'State', data.registeredAddress?.state, MapPin),
        createProcessingField('data.partB.waterApplicationNumber', 'Water Application Number', data.cte?.waterApplicationNumber || '', FileText),
        createProcessingField('data.partB.waterConsentValidity', 'Water Validity of Consent', data.cte?.waterConsentValidity || '', CalendarDays, 'date'),
        createProcessingField('data.partB.waterConsentDocument', 'Water Consent Documents', data.cte?.waterConsentDocument || docLinks.factory || '', Upload, 'file'),
        createProcessingField('data.partB.airApplicationNumber', 'Air Application Number', data.cte?.airApplicationNumber || '', FileText),
        createProcessingField('data.partB.airConsentValidity', 'Air Validity of Consent', data.cte?.airConsentValidity || '', CalendarDays, 'date'),
        createProcessingField('data.partB.airConsentDocument', 'Air Consent Documents', data.cte?.airConsentDocument || '', Upload, 'file')
      ]
    },
    {
      title: 'Part C - Raw Data & Interaction',
      type: 'interactionTable',
      rawDataKey: 'data.partC.rawDataUploads',
      tableKey: 'data.partC.clientInteractions',
      rows: buildClientInteractionRows(data.annualReturn)
    },
    {
      title: 'Part D - Plant & Declaration Details',
      fields: [
        createProcessingField('data.partD.eprCreditReverse', 'EPR Credit Reverse for Registration', data.annualReturn?.eprCreditReverse || '', FileText),
        createProcessingField('data.partD.plantArea', 'Plot Area of the recycling plant', plants?.[0]?.plantArea || data.annualReturn?.plantArea || '', Database, 'number'),
        createProcessingField('data.partD.gpsLocationLatitude', 'GPS Latitude of the Unit', plants?.[0]?.latitude || data.annualReturn?.gpsLocationLatitude || '', MapPin),
        createProcessingField('data.partD.gpsLocationLongitude', 'GPS Longitude of the Unit', plants?.[0]?.longitude || data.annualReturn?.gpsLocationLongitude || '', MapPin),
        createProcessingField('data.partD.rawMaterialStorageArea', 'Raw Material Storage Area', data.annualReturn?.rawMaterialStorageArea || '', Database, 'number'),
        createProcessingField('data.partD.productionProcess', 'Production Process', data.annualReturn?.productionProcess || '', FileText, 'textarea'),
        createProcessingField('data.partD.plasticMajorMaterial', 'Product/Packaging major material', data.annualReturn?.plasticMajorMaterial || data.annualReturn?.productPackagingMajorMaterial || '', FileText),
        createProcessingField('data.partD.plantVideo', 'Upload new video link of the plant', data.annualReturn?.plantVideo || '', Upload, 'file'),
        createProcessingField('data.partD.installedCapacity', 'Installed Capacity', data.annualReturn?.installedCapacity || '', Database, 'number'),
        createProcessingField('data.partD.rawMaterialCapacity', 'Raw Material Capacity', data.annualReturn?.rawMaterialCapacity || '', Database, 'number'),
        createProcessingField('data.partD.sanctionedPowerLoad', 'Sanctioned power load of plant', data.annualReturn?.sanctionedPowerLoad || '', Database, 'number'),
        createProcessingField('data.partD.electricityBill', 'Upload Electricity Bill', data.annualReturn?.electricityBill || '', Upload, 'file'),
        createProcessingField('data.partD.districtMagistrate', 'District Magistrate', data.annualReturn?.districtMagistrate || '', FileText),
        createProcessingField('data.partD.authorizationDocument', 'Authorization Document', data.annualReturn?.authorizationDocument || '', Upload, 'file'),
        createProcessingField('data.partD.bankGuarantee', 'Bank guarantee from state of project activity to CPCB', data.annualReturn?.bankGuarantee || '', Upload, 'file'),
        createProcessingField('data.partD.signatures', 'Signature / photos / declaration images', data.annualReturn?.signatures || '', Upload, 'file'),
        createProcessingField('data.partD.additionalInformation', 'Any other information or PDF', data.annualReturn?.additionalInformation || '', Upload, 'file')
      ]
    }
  ];

  const brandOwnerProductionFacilityFallback = data.annualReturn?.productionFacility || '';
  const brandOwnerApplicationRenewalFallback = data.annualReturn?.applicationRenewal || data.cpcb?.applicationType || '';
  const brandOwnerDicRegisteredFallback = data.annualReturn?.districtIndustryCentreRegistered || data.annualReturn?.dicRegistrationStatus || '';
  const brandOwnerProductionFacility = draftAnswerValue('brandOwner.productionFacility', brandOwnerProductionFacilityFallback);
  const brandOwnerApplicationRenewal = draftAnswerValue('brandOwner.applicationRenewal', brandOwnerApplicationRenewalFallback);
  const brandOwnerDicRegistered = draftAnswerValue('brandOwner.districtIndustryCentreRegistered', brandOwnerDicRegisteredFallback);
  const showBrandOwnerProductionDetails = isYesAnswer(brandOwnerProductionFacility);
  const showBrandOwnerRenewalDetails = isYesAnswer(brandOwnerApplicationRenewal);
  const showBrandOwnerDicUpload = showBrandOwnerProductionDetails && isYesAnswer(brandOwnerDicRegistered);
  const brandOwnerOtherDetailFields = [
    createProcessingField('brandOwner.stateOfCto', 'State / UT in which the CTO is issued by SPCB / PCC', data.registeredAddress?.state || '', MapPin),
    createProcessingField('brandOwner.productionFacility', 'Does Brand Owner have Production Facility', brandOwnerProductionFacility, CheckCircle2, 'select', ['Yes', 'No'], 'manual'),
    ...(showBrandOwnerProductionDetails ? [
      createProcessingField('brandOwner.districtIndustryCentreRegistered', 'Registered with District Industries Centre / State Government / UT?', brandOwnerDicRegistered, ShieldCheck, 'select', ['Yes', 'No'], 'manual')
    ] : []),
    ...(showBrandOwnerDicUpload ? [
      createProcessingField('brandOwner.registrationCopy', 'Registration Copy / Upload Document', data.annualReturn?.registrationCopy || data.validation?.factoryLicenseFile || '', Upload, 'file')
    ] : []),
    createProcessingField('brandOwner.applicationRenewal', 'Application is for Renewal', brandOwnerApplicationRenewal, RefreshCw, 'select', ['Yes', 'No'], 'manual'),
    ...(showBrandOwnerRenewalDetails ? [
      createProcessingField('brandOwner.registrationNumber', 'Registration No.', data.cpcb?.registrationNumber || data.compliance?.eprCertificate || data.compliance?.eprCertificateNumber, FileText),
      createProcessingField('brandOwner.dateOfIssue', 'Date of Issue', data.cpcb?.issueDate || data.cpcb?.approvalDate || data.compliance?.eprCertificateDate, CalendarDays, 'date'),
      createProcessingField('brandOwner.validityOfRegistration', 'Validity of Registration Certificate / Uploaded Document', data.cpcb?.validityDate || data.compliance?.eprCertificateValidity || '', CalendarDays, 'file')
    ] : []),
    createProcessingField('brandOwner.totalCapitalInvested', 'Total Capital Invested in the Project Concerned', data.financials?.totalCapitalInvested || data.annualReturn?.totalCapitalInvested || '', FileText, 'number'),
    createProcessingField('brandOwner.commencementYear', 'Year of Commencement of Operation', data.annualReturn?.commencementYear || data.basic?.onboardingYear, CalendarDays, 'text'),
    createProcessingField('brandOwner.productDetails', 'Details Type of Products Produced / Marketed', data.annualReturn?.productDetails || '', Database, 'textarea'),
    createProcessingField('brandOwner.productPackagingMajorMaterial', 'Product Packaging Image / Upload Image', data.annualReturn?.productPackagingMajorMaterial || '', Upload, 'file'),
    createProcessingField('brandOwner.processFlowDiagram', 'Process Flow Diagram / Upload Document', docLinks.application || data.annualReturn?.processFlowDiagram || '', Upload, 'file'),
    createProcessingField('brandOwner.thicknessOfPlastic', 'Thickness of Plastic in Micron', data.annualReturn?.thicknessOfPlastic || '', FileText, 'text')
  ];

  const brandOwnerDataSections = [
    {
      title: 'Part A - Brand Owner Data',
      type: 'legacyData',
      groups: [
        {
          title: 'Brand Owner Details',
          tone: 'green',
          fields: [
            createProcessingField('basic.organisationLegalName', 'Name of the Organisation', clientName, Building2),
            createProcessingField('basic.tradeName', 'Trade Name', data.basic?.tradeName, Building2),
            ...basicAddressFields(),
            createProcessingField('basic.companyPan', "Company's PAN", data.compliance?.pan || data.compliance?.panNumber, FileText),
            createProcessingField('basic.companyGst', "Company's GST", data.compliance?.gst || data.compliance?.gstNumber, FileText),
            createProcessingField('brandOwner.typeOfBusiness', 'Type of Business', typeOfBusiness || 'Brand Owner', FolderCheck)
          ]
        },
        {
          title: 'Authorised Person Details',
          fields: [
            createProcessingField('basic.authorisedPersonName', 'Name', data.authorised?.name || data.otp?.personName, UserRound),
            createProcessingField('basic.authorisedPersonDesignation', 'Designation', data.authorised?.designation || data.otp?.designation, UserRound),
            createProcessingField('basic.otpMobile', 'Mobile No.', data.otp?.mobile || data.authorised?.mobile, UserRound, 'tel'),
            createProcessingField('basic.authorisedPersonEmail', 'Email Id', data.authorised?.email || data.coordinating?.email, FileText, 'email'),
            createProcessingField('basic.authorisedPersonPan', 'PAN Number', data.authorised?.pan, FileText)
          ]
        },
        {
          title: 'Other Details / Attach in Required for All Filing',
          tone: 'dark',
          fields: brandOwnerOtherDetailFields
        },
        {
          title: 'Plastic Consumption',
          type: 'plasticConsumptionTable',
          tableKey: 'brandOwner.plasticConsumptionRows',
          rows: buildPlasticConsumptionRows(data.annualReturn, selected?.label)
        }
      ]
    },
    {
      title: 'Part B - Consent Details',
      fields: [
        createProcessingField('brandOwner.partB.state', 'State', data.registeredAddress?.state, MapPin),
        createProcessingField('brandOwner.partB.waterApplicationNumber', 'Water Application Number', data.cte?.waterApplicationNumber || '', FileText),
        createProcessingField('brandOwner.partB.waterConsentValidity', 'Water Validity of Consent', data.cte?.waterConsentValidity || '', CalendarDays, 'date'),
        createProcessingField('brandOwner.partB.waterConsentDocument', 'Water Consent Documents', data.cte?.waterConsentDocument || docLinks.factory || '', Upload, 'file'),
        createProcessingField('brandOwner.partB.airApplicationNumber', 'Air Application Number', data.cte?.airApplicationNumber || '', FileText),
        createProcessingField('brandOwner.partB.airConsentValidity', 'Air Validity of Consent', data.cte?.airConsentValidity || '', CalendarDays, 'date'),
        createProcessingField('brandOwner.partB.airConsentDocument', 'Air Consent Documents', data.cte?.airConsentDocument || '', Upload, 'file')
      ]
    },
    {
      title: 'Part C - Client Raw Data',
      type: 'interactionTable',
      rawDataKey: 'brandOwner.partC.rawDataUploads',
      tableKey: 'brandOwner.partC.clientInteractions',
      rows: buildClientInteractionRows(data.annualReturn)
    },
    {
      title: 'Part D - Brand Owner Declaration',
      fields: [
        createProcessingField('brandOwner.partD.piboName', 'PIBO Name as per registration certificate', clientName, Building2),
        createProcessingField('brandOwner.partD.eprTarget', 'EPR Target', data.annualReturn?.eprTarget || '', Database, 'number'),
        createProcessingField('brandOwner.partD.openingLeftoverDocument', 'Opening leftover upload document', data.annualReturn?.openingLeftoverDocument || '', Upload, 'file'),
        createProcessingField('brandOwner.partD.signatureUpload', 'Signature / stamp / photos upload', data.annualReturn?.signatureUpload || '', Upload, 'file'),
        createProcessingField('brandOwner.partD.exemptionApplied', 'Exemption from sale of recycled plastic applied', data.annualReturn?.exemptionApplied || '', CheckCircle2, 'select', ['Yes', 'No']),
        createProcessingField('brandOwner.partD.recyclingTarget', 'Recycling target for credit application', data.annualReturn?.recyclingTarget || '', Database, 'number'),
        createProcessingField('brandOwner.partD.permissionFssai', 'Permission granted from FSSAI for use in food contact applications', data.annualReturn?.permissionFssai || '', Upload, 'file'),
        createProcessingField('brandOwner.partD.permissionNonFood', 'Permission granted from FSSAI for reuse in non-food contact applications', data.annualReturn?.permissionNonFood || '', Upload, 'file')
      ]
    }
  ];

  const importerProductionFacilityFallback = data.annualReturn?.productionFacility || '';
  const importerApplicationRenewalFallback = data.annualReturn?.applicationRenewal || data.cpcb?.applicationType || '';
  const importerDicRegisteredFallback = data.annualReturn?.districtIndustryCentreRegistered || data.annualReturn?.dicRegistrationStatus || '';
  const importerProductionFacility = draftAnswerValue('importer.productionFacility', importerProductionFacilityFallback);
  const importerApplicationRenewal = draftAnswerValue('importer.applicationRenewal', importerApplicationRenewalFallback);
  const importerDicRegistered = draftAnswerValue('importer.districtIndustryCentreRegistered', importerDicRegisteredFallback);
  const showImporterProductionDetails = isYesAnswer(importerProductionFacility);
  const showImporterRenewalDetails = isYesAnswer(importerApplicationRenewal);
  const showImporterDicUpload = showImporterProductionDetails && isYesAnswer(importerDicRegistered);
  const importerOtherDetailFields = [
    createProcessingField('importer.stateOfCto', 'State / UT in which the CTO is issued by SPCB / PCC', data.registeredAddress?.state || '', MapPin),
    createProcessingField('importer.productionFacility', 'Does Importer have Production Facility', importerProductionFacility, CheckCircle2, 'select', ['Yes', 'No'], 'manual'),
    ...(showImporterProductionDetails ? [
      createProcessingField('importer.districtIndustryCentreRegistered', 'Registered with District Industries Centre / State Government / UT?', importerDicRegistered, ShieldCheck, 'select', ['Yes', 'No'], 'manual')
    ] : []),
    ...(showImporterDicUpload ? [
      createProcessingField('importer.registrationCopy', 'Registration Copy / Upload Document', data.annualReturn?.registrationCopy || data.validation?.factoryLicenseFile || '', Upload, 'file')
    ] : []),
    createProcessingField('importer.applicationRenewal', 'Application is for Renewal', importerApplicationRenewal, RefreshCw, 'select', ['Yes', 'No'], 'manual'),
    ...(showImporterRenewalDetails ? [
      createProcessingField('importer.registrationNumber', 'Registration No.', data.cpcb?.registrationNumber || data.compliance?.eprCertificate || data.compliance?.eprCertificateNumber, FileText),
      createProcessingField('importer.dateOfIssue', 'Date of Issue', data.cpcb?.issueDate || data.cpcb?.approvalDate || data.compliance?.eprCertificateDate, CalendarDays, 'date'),
      createProcessingField('importer.validityOfRegistration', 'Validity of Registration Certificate / Uploaded Document', data.cpcb?.validityDate || data.compliance?.eprCertificateValidity || '', CalendarDays, 'file')
    ] : []),
    createProcessingField('importer.totalCapitalInvested', 'Total Capital Invested in the Project Concerned', data.financials?.totalCapitalInvested || data.annualReturn?.totalCapitalInvested || '', FileText, 'number'),
    createProcessingField('importer.commencementYear', 'Year of Commencement of Operation', data.annualReturn?.commencementYear || data.basic?.onboardingYear, CalendarDays, 'text'),
    createProcessingField('importer.productDetails', 'Details Type of Products Produced / Marketed', data.annualReturn?.productDetails || '', Database, 'textarea'),
    createProcessingField('importer.productPackagingMajorMaterial', 'Product Packaging Image / Upload Image', data.annualReturn?.productPackagingMajorMaterial || '', Upload, 'file'),
    createProcessingField('importer.processFlowDiagram', 'Process Flow Diagram / Upload Document', docLinks.application || data.annualReturn?.processFlowDiagram || '', Upload, 'file'),
    createProcessingField('importer.thicknessOfPlastic', 'Thickness of Plastic in Micron', data.annualReturn?.thicknessOfPlastic || '', FileText, 'text')
  ];

  const importerDataSections = [
    {
      title: 'Part A - Importer Data',
      type: 'legacyData',
      groups: [
        {
          title: 'Importer Details',
          tone: 'green',
          fields: [
            createProcessingField('basic.organisationLegalName', 'Name of the Organisation', clientName, Building2),
            createProcessingField('basic.tradeName', 'Trade Name', data.basic?.tradeName, Building2),
            ...basicAddressFields(),
            createProcessingField('basic.companyPan', "Company's PAN", data.compliance?.pan || data.compliance?.panNumber, FileText),
            createProcessingField('basic.companyGst', "Company's GST", data.compliance?.gst || data.compliance?.gstNumber, FileText),
            createProcessingField('importer.typeOfBusiness', 'Type of Business', typeOfBusiness || 'Importer', FolderCheck)
          ]
        },
        {
          title: 'Authorised Person Details',
          fields: [
            createProcessingField('basic.authorisedPersonName', 'Name', data.authorised?.name || data.otp?.personName, UserRound),
            createProcessingField('basic.authorisedPersonDesignation', 'Designation', data.authorised?.designation || data.otp?.designation, UserRound),
            createProcessingField('basic.otpMobile', 'Mobile No.', data.otp?.mobile || data.authorised?.mobile, UserRound, 'tel'),
            createProcessingField('basic.authorisedPersonEmail', 'Email Id', data.authorised?.email || data.coordinating?.email, FileText, 'email'),
            createProcessingField('basic.authorisedPersonPan', 'PAN Number', data.authorised?.pan, FileText)
          ]
        },
        {
          title: 'Other Details / Attach in Required for All Filing',
          tone: 'dark',
          fields: importerOtherDetailFields
        },
        {
          title: 'Plastic Consumption',
          type: 'plasticConsumptionTable',
          tableKey: 'importer.plasticConsumptionRows',
          rows: buildPlasticConsumptionRows(data.annualReturn, selected?.label)
        }
      ]
    },
    {
      title: 'Part B - Consent Details',
      fields: [
        createProcessingField('importer.partB.notApplicable', 'Not Applicable in Importer', data.annualReturn?.importerConsentStatus || 'Not Applicable in Importer', ShieldCheck, 'text', [], 'manual', 'xl:col-span-2')
      ]
    },
    {
      title: 'Part C - Client Raw Data',
      type: 'interactionTable',
      rawDataKey: 'importer.partC.rawDataUploads',
      tableKey: 'importer.partC.clientInteractions',
      rows: buildClientInteractionRows(data.annualReturn)
    },
    {
      title: 'Part D - Importer Declaration',
      fields: [
        createProcessingField('importer.partD.eprActionPlan', 'EPR Action Plan for Implementation of PWM Rule', data.annualReturn?.eprActionPlan || '', FileText, 'textarea', [], 'auto', 'xl:col-span-2'),
        createProcessingField('importer.partD.requiredDocuments', 'Documents Required to be submitted in Part D', data.annualReturn?.requiredDocuments || 'Covering letter, signature image and additional PDF declaration', FileText, 'textarea', [], 'manual', 'xl:col-span-2'),
        createProcessingField('importer.partD.coveringLetter', 'Covering Letter / Upload Document', data.annualReturn?.coveringLetter || '', Upload, 'file'),
        createProcessingField('importer.partD.signatureUpload', 'Signature (only png, jpeg, jpg, gif) / Upload Image', data.annualReturn?.signatureUpload || '', Upload, 'file'),
        createProcessingField('importer.partD.additionalInformation', 'Any other Information in PDF / Declaration if any', data.annualReturn?.additionalInformation || '', Upload, 'file')
      ]
    }
  ];

  const dataSections = isImporter ? importerDataSections : isBrandOwner ? brandOwnerDataSections : producerDataSections;
  const cpcbLetterSections = buildCpcbLetterSections(clientName, selected?.label);

  const sectionsByTab = {
    basic: [
      {
        title: 'Organisation Details',
        fields: [
          createProcessingField('basic.organisationLegalName', 'Name of the Organisation', clientName, Building2),
          createProcessingField('basic.tradeName', 'Trade Name', data.basic?.tradeName, Building2),
          ...basicAddressFields('xl:col-span-2'),
          createProcessingField('basic.companyPan', "Company's PAN", data.compliance?.pan || data.compliance?.panNumber, FileText),
          createProcessingField('basic.companyGst', "Company's GST", data.compliance?.gst || data.compliance?.gstNumber, FileText),
          createProcessingField('basic.typeOfBusiness', 'Type of Business', typeOfBusiness, FolderCheck, 'select', [...selectOptions.piboCategory, ...selectOptions.eprCategory, 'Manufacturing', 'Trading', 'Service'])
        ]
      },
      {
        title: 'Authorised Person Details',
        fields: [
          createProcessingField('basic.authorisedPersonName', 'Name', data.authorised?.name || data.otp?.personName, UserRound),
          createProcessingField('basic.authorisedPersonDesignation', 'Designation', data.authorised?.designation || data.otp?.designation, UserRound),
          createProcessingField('basic.otpMobile', 'Mobile No.', data.otp?.mobile || data.authorised?.mobile, UserRound, 'tel'),
          createProcessingField('basic.authorisedPersonEmail', 'Email Id', data.authorised?.email || data.coordinating?.email, FileText, 'email'),
          createProcessingField('basic.authorisedPersonPan', 'PAN Number', data.authorised?.pan, FileText)
        ]
      },
      {
        title: 'Other Details',
        fields: [
          createProcessingField('basic.eprCertificateNo', 'EPR Certificate No.', data.compliance?.eprCertificate || data.compliance?.eprCertificateNumber, ShieldCheck),
          createProcessingField('basic.cpcbRegistrationNumber', 'CPCB Registration Number', data.cpcb?.registrationNumber, FileText),
          createProcessingField('basic.applicationApprovalDate', 'Date of Application Approval', data.cpcb?.approvalDate || data.compliance?.eprCertificateDate, CalendarDays, 'date'),
          createProcessingField('basic.plantLocation', 'Plant Location', plants?.[0]?.plantLocation || plants?.[0]?.location || data.registeredAddress?.city, MapPin),
          createProcessingField('basic.gstNumber', 'GST Number', data.compliance?.gst || data.compliance?.gstNumber, FileText),
          createProcessingField('basic.panNumber', 'PAN', data.compliance?.pan || data.compliance?.panNumber, FileText)
        ]
      },
      {
        title: 'MSME Details',
        type: 'msmeTable',
        tableKey: 'MSME Details',
        rows: msmeRows
      },
      {
        title: 'Login Details',
        fields: [
          createProcessingField('basic.cpcbLoginId', 'CPCB Login ID', data.cpcb?.loginId || data.cpcb?.ceprUserId, UserRound),
          createProcessingField('basic.cpcbLoginPassword', 'CPCB Login Password', data.cpcb?.loginPassword || data.cpcb?.ceprPassword || '', KeyRound, 'password'),
          createProcessingField('basic.cpcbStatus', 'CPCB Status', data.cpcb?.status, ShieldCheck, 'select', selectOptions.cpcbStatus)
        ]
      },
      {
        title: 'Contact Person Details',
        fields: [
          createProcessingField('basic.authorisedPersonName', 'Authorised Contact Person', data.authorised?.name || data.otp?.personName, UserRound),
          createProcessingField('basic.authorisedPersonDesignation', 'Authorised Person Designation', data.authorised?.designation || data.otp?.designation, UserRound),
          createProcessingField('basic.otpMobile', 'OTP Enabled Mobile No.', data.otp?.mobile || data.authorised?.mobile, UserRound, 'tel'),
          createProcessingField('basic.coordinatingPersonName', 'Coordinating Person Name', data.coordinating?.name, UserRound),
          createProcessingField('basic.coordinatingPersonDesignation', 'Coordinating Person Designation', data.coordinating?.designation, UserRound),
          createProcessingField('basic.coordinatingPersonMobile', 'Coordinating Person Mobile', data.coordinating?.mobile, UserRound, 'tel')
        ]
      }
    ],
    financials: [
      {
        title: 'Quotation and SLA Details',
        actions: ['quotation'],
        fields: [
          createProcessingField('financials.quotationNo', 'Quotation No.', data.financials?.quotationNo || data.validation?.quotationNumber, FileText),
          createProcessingField('financials.quotationDate', 'Quotation Date', data.financials?.quotationDate || data.validation?.quotationDate, CalendarDays, 'date'),
          createProcessingField('financials.quotationFile', 'Quotation File', data.financials?.quotationDocument || data.validation?.quotationDocument || '', Upload, 'file'),
          createProcessingField('financials.slaNo', 'Compliance SLA No.', data.financials?.slaNo, FileText),
          createProcessingField('financials.slaDate', 'SLA Date', data.financials?.slaDate, CalendarDays, 'date'),
          createProcessingField('financials.slaFile', 'Upload SLA', data.financials?.slaDocument, Upload, 'file')
        ]
      },
      {
        title: 'Compliance Document Details',
        type: 'compliancePoDetails',
        poYearTable: {
          countKey: 'financials.poYearCount',
          rowsKey: 'financials.poYearRows',
          serviceCategoryOptions: annualPoServiceCategoryOptions,
          defaultFy: selected?.label || '',
          annualReturnYear: selected?.label || '',
          quotationNo: latestQuotationNo,
          proformaInvoice: latestProforma
        },
        fields: [
          createProcessingField('financials.complianceAmountReceived', 'Compliance Amount Received', data.financials?.amountReceived || data.validation?.basicAmount, FileText, 'number'),
          createProcessingField('financials.receivedThrough', 'Received Through', data.financials?.receivedThrough, FileText, 'select', ['Cheque', 'NEFT', 'RTGS', 'UPI', 'Cash']),
          createProcessingField('financials.receivedDate', 'Received Date', data.financials?.receivedDate, CalendarDays, 'date'),
          createProcessingField('financials.amountStatus', 'Amount Status', data.financials?.amountStatus, CheckCircle2, 'select', ['Pending', 'Partial Received', 'Full Received'])
        ]
      },
      {
        title: 'Credit Details',
        fields: [
          createProcessingField('financials.creditPoNo', 'Credit PO No.', data.financials?.creditPoNo, FileText),
          createProcessingField('financials.creditPoDate', 'Credit PO Date', data.financials?.creditPoDate, CalendarDays, 'date'),
          createProcessingField('financials.creditPoFile', 'Upload Credit PO', data.financials?.creditPoDocument, Upload, 'file'),
          createProcessingField('financials.creditReceivedDate', 'Credit Amount Received Date', data.financials?.creditReceivedDate, CalendarDays, 'date'),
          createProcessingField('financials.creditReceivedThrough', 'Credit Amount Received Through', data.financials?.creditReceivedThrough, FileText, 'select', ['Cheque', 'NEFT', 'RTGS', 'UPI', 'Cash'])
        ]
      }
    ],
    data: dataSections,
    cpcbLetter: cpcbLetterSections,
    documents: [
      {
        title: 'Document Library',
        fields: [
          createProcessingField('documents.gstCertificate', 'GST Certificate', data.compliance?.gstFile || docLinks.gst, FileText, 'file'),
          createProcessingField('documents.panDocument', 'PAN Document', data.compliance?.panFile || docLinks.pan, FileText, 'file'),
          createProcessingField('documents.cinDocument', 'CIN Document', data.compliance?.cinFile || docLinks.cin, FileText, 'file'),
          createProcessingField('documents.factoryLicense', 'Factory License', data.compliance?.factoryLicenseFile || docLinks.factory, FileText, 'file'),
          createProcessingField('documents.eprCertificate', 'EPR Certificate', data.compliance?.eprCertificateFile || docLinks.epr, ShieldCheck, 'file'),
          createProcessingField('documents.msmeUdyam', 'MSME / Udyam', msmeRows?.[0]?.file || docLinks.msme, FileCheck2, 'file')
        ]
      }
    ],
    annual: [
      {
        title: 'Annual Return Filing',
        fields: [
          createProcessingField('annual.returnYear', 'Annual Return Year', selected?.label || 'Select Hub', CalendarDays),
          createProcessingField('annual.filingStatus', 'Filing Status', data.annualReturn?.status || 'Open', RefreshCw, 'select', ['Open', 'In Progress', 'Filed', 'Submitted', 'Closed']),
          createProcessingField('annual.currentSpoc', 'Current SPOC', assignedName, UserRound),
          createProcessingField('annual.previousSpoc', 'Previous SPOC', previousSpocName, UserRound),
          createProcessingField('annual.firstAnnualReturnYear', 'First Annual Return Year', firstAnnualReturnYear, CalendarDays)
        ]
      }
    ]
  };
  const activeSections = sectionsByTab[activeProcessingTab] || sectionsByTab.basic;
  const activeSection = activeSections.find((section) => section.title === activePillSection) || activeSections[0];
  const activeSectionIndex = activeSections.findIndex((section) => section.title === activeSection?.title);
  const hasNextSection = activeSectionIndex > -1 && activeSectionIndex < activeSections.length - 1;
  const activeTabIndex = Math.max(processingTabs.findIndex((tab) => tab.id === activeProcessingTab), 0);
  const effectiveReviewStage = getAnnualReviewStage(approvalWorkflow);
  const dataReviewReady = effectiveReviewStage === 'manager' || effectiveReviewStage === 'compliance';
  const canManagerReviewData = activeProcessingTab === 'data' && canFirstStageReview && effectiveReviewStage === 'manager';
  const canComplianceReviewData = activeProcessingTab === 'data' && isComplianceManager && effectiveReviewStage === 'compliance';
  const canTakeReviewAction = canManagerReviewData || canComplianceReviewData;
  const canOpenReviewPanel = activeProcessingTab === 'data' && canViewAnnualReviewPanel;
  const canViewReviewData = activeProcessingTab === 'data' && canOpenReviewPanel && dataReviewReady;
  const complianceOnlyUser = isComplianceManager && !isAnnualAdmin && !isManager && !isAnnualUser;
  const canSubmitAnnualData = activeProcessingTab === 'data' && isAnnualUser && !isManager && !isComplianceManager && effectiveReviewStage === 'user';
  const canSubmitFromReviewPanel = canSubmitAnnualData && canOpenReviewPanel && !complianceOnlyUser;
  const userSubmittedDisplayStatuses = activeProcessingTab === 'data' && isAnnualUser && !canTakeReviewAction && dataReviewReady
    ? buildAnnualUserSubmittedStatuses(getDataSectionTitles())
    : null;
  const dataSectionStatuses = userSubmittedDisplayStatuses || approvalWorkflow.sections;
  const dataSectionReviewStage = userSubmittedDisplayStatuses ? 'manager' : effectiveReviewStage;
  const isFinalDataSection = activeProcessingTab === 'data' && activeSectionIndex > -1 && activeSectionIndex === activeSections.length - 1;
  const isSubmitSection = activeProcessingTab === 'data' && (isAnnualPartDSection(activeSection?.title) || isFinalDataSection);
  const canSubmitData = canSubmitAnnualData && !canTakeReviewAction && isSubmitSection;
  const dataPendingForReview = activeProcessingTab === 'data' && dataReviewReady && !canViewReviewData;
  const annualReviewRoleLabel = isAnnualAdmin
    ? 'Admin'
    : isComplianceManager
      ? 'Compliance Manager'
      : isManager
        ? 'Manager'
        : 'User';
  const annualReviewDebugInfo = {
    userRole: currentUser?.role || '',
    userTeam: currentUser?.team || '',
    annualRoleLabel: annualReviewRoleLabel,
    workflowStatus: approvalWorkflow.status || 'draft',
    currentStage: approvalWorkflow.currentStage || 'user',
    effectiveReviewStage,
    activeProcessingTab,
    activeSection: activeSection?.title || '',
    isAnnualUser,
    isManager,
    isComplianceManager,
    canViewAnnualReviewPanel,
    canManagerReviewData,
    canComplianceReviewData,
    canTakeReviewAction,
    canOpenReviewPanel,
    canViewReviewData,
    isSubmitSection,
    lockReason: getAnnualReviewLockReason({
      isManager,
      isComplianceManager,
      effectiveReviewStage,
      workflowStatus: approvalWorkflow.status,
      activeProcessingTab,
      activeSectionTitle: activeSection?.title,
      isSubmitSection
    })
  };
  const annualSubmittedBy = getAnnualWorkflowSubmittedBy(approvalWorkflow);
  const submitButtonLabel = activeProcessingTab === 'data'
    ? (canViewReviewData
      ? `Review ${getAnnualPartShortLabel(activeSection?.title)}`
      : dataPendingForReview
      ? formatAnnualWorkflowStatus(approvalWorkflow)
      : canSubmitData
        ? (approvalWorkflow.status === 'manager_rejected' || approvalWorkflow.status === 'compliance_rejected' ? 'Resubmit to Manager' : 'Submit to Manager')
        : 'Next')
    : 'Submit / Next';
  const submitButtonIcon = canViewReviewData ? ShieldCheck : Save;
  const handlePrimaryAnnualAction = canViewReviewData
    ? () => setReviewDrawerOpen(true)
    : (canSubmitData ? submitDataForManager : handleAnnualSubmitNext);
  const showReviewNextButton = canTakeReviewAction && hasNextSection;

  useEffect(() => {
    if (activeProcessingTab !== 'data') return;
    window.__annualReviewDebug = annualReviewDebugInfo;
    console.debug('[AnnualReviewDebug]', annualReviewDebugInfo);
  }, [
    activeProcessingTab,
    currentUser?.role,
    currentUser?.team,
    annualReviewRoleLabel,
    effectiveReviewStage,
    approvalWorkflow.status,
    approvalWorkflow.currentStage,
    activeSection?.title,
    isAnnualUser,
    isManager,
    isComplianceManager,
    canViewAnnualReviewPanel,
    canManagerReviewData,
    canComplianceReviewData,
    canTakeReviewAction,
    canOpenReviewPanel,
    canViewReviewData,
    isSubmitSection
  ]);

  useEffect(() => {
    if (!selected?.label || savingAnnual || effectiveReviewStage !== 'manager') return;
    if (String(approvalWorkflow.status || '').toLowerCase() !== 'manager_pending') return;
    if (!allSectionsReviewedBy(approvalWorkflow.sections, 'manager')) return;
    const nextWorkflow = buildCompliancePendingWorkflow(approvalWorkflow, approvalWorkflow.sections);
    saveAnnualDraft(activeProcessingTab, activeSection?.title || '', nextWorkflow, 'compliance_pending').then((saved) => {
      if (saved) setSaveNotice('Manager approved all parts. Workflow moved to Compliance Manager.');
    });
  }, [selected?.label, savingAnnual, effectiveReviewStage, approvalWorkflow.sections, approvalWorkflow.status, approvalWorkflow.currentStage]);

  useEffect(() => {
    setActivePillSection((current) => (
      activeSections.some((section) => section.title === current) ? current : activeSections[0]?.title || ''
    ));
  }, [activeProcessingTab, activeSections]);

  function openAnnualYear(year) {
    const clientKey = client?._id || client?.id || data.importMeta?.uniqueId || getClientUniqueId(client);
    const nextYear = year?.label || '';
    const poState = poStateForYear(nextYear);
    if (poState.poStatus !== 'received') {
      setAnnualToast({ type: 'error', message: `Annual Return ${nextYear} can open only after its Purchase Order is received.` });
      return;
    }
    if (isAnnualYearLocked(nextYear)) {
      if (poState.poStatus === 'pending') {
        setAnnualToast({ type: 'error', message: `PO details are required before starting Annual Return ${nextYear}.` });
        setPoDraft(poWorkflow);
        setPoModalOpen(true);
      } else if (poState.poStatus === 'conflict') {
        setPoDetails(poState);
      } else {
        setAnnualToast({ type: 'error', message: poState.message || 'Checking PO details. Please try again shortly.' });
      }
      return;
    }
    console.debug('[CRM AnnualReturn]', {
      label: 'hub-card-open',
      at: new Date().toISOString(),
      clientKey,
      annualYear: nextYear,
      availableYears: years.map((item) => item.label),
      hasStoredFiling: Boolean(data.annualReturn?.filings?.[nextYear])
    });
    onSelectYear(nextYear);
    navigate(`/sales/client-data-processing/${encodeURIComponent(clientKey)}/${encodeURIComponent(nextYear)}`);
  }

  const hubPoStates = years.map((year) => poStateForYear(year.label));
  const pendingPoState = hubPoStates.find((state) => state.poStatus === 'pending');
  const receivedPoState = hubPoStates.find((state) => state.poStatus === 'received');

  return (
    <div className="mt-5 space-y-5">
      {!selected && (
        <div className="flex flex-col gap-3 rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => navigate('/sales/client-master')} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-[#30737B] hover:bg-teal-50"><ArrowLeft className="h-5 w-5" /></button>
            <div><p className="text-xs font-black uppercase tracking-[0.18em] text-[#30737B]">Annual Return</p><h2 className="text-xl font-black text-slate-950">{clientName}</h2></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!poResolution.loading && (pendingPoState || receivedPoState) && <button type="button" onClick={() => {
              if (pendingPoState) {
                setPoDraft(poWorkflow.confirmed ? poWorkflow : {});
                setPoValidationError('');
                setPoModalOpen(true);
              } else setPoDetails(receivedPoState);
            }} className="btn-lift inline-flex items-center gap-2 rounded-xl bg-[#30737B] px-5 py-3 text-sm font-black text-white">{pendingPoState ? <Plus className="h-4 w-4" /> : <FileText className="h-4 w-4" />} {pendingPoState ? 'Add PO' : 'PO Details'}</button>}
          </div>
        </div>
      )}
      {annualToast && (
        <div className="fixed right-5 top-16 z-[160] w-[min(430px,calc(100vw-40px))]">
          <ToastMessage type={annualToast.type} actionLabel="Close" onAction={() => setAnnualToast(null)}>{annualToast.message}</ToastMessage>
        </div>
      )}
      {!selected && <section className="annual-return-hub">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#30737B]">EPR Years</p>
            <h4 className="mt-1 text-xl font-black text-slate-950">Annual return hubs</h4>
          </div>
          <p className="max-w-xl text-sm font-bold text-slate-500">Only completed financial years from the first applicable annual return year are available.</p>
        </div>

        {years.length ? (
          <div className="annual-year-grid mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {years.map((year, index) => {
              const active = selected?.label === year.label;
              const locked = isAnnualYearLocked(year.label);
              const poState = poStateForYear(year.label);
              const statusMeta = {
                received: { label: 'PO Received', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700', card: 'border-emerald-200 bg-gradient-to-br from-white to-emerald-50/70' },
                pending: { label: 'PO Pending', badge: 'border-amber-200 bg-amber-50 text-amber-700', card: 'border-amber-200 bg-gradient-to-br from-white to-amber-50/70' },
                not_required: { label: 'PO Not Required', badge: 'border-slate-200 bg-slate-100 text-slate-600', card: 'border-slate-200 bg-white' },
                unlinked: { label: 'Source Lead Not Linked', badge: 'border-slate-200 bg-slate-100 text-slate-600', card: 'border-slate-200 bg-white' },
                conflict: { label: 'PO Conflict', badge: 'border-orange-200 bg-orange-50 text-orange-700', card: 'border-orange-200 bg-gradient-to-br from-white to-orange-50/70' },
                loading: { label: 'Checking PO details...', badge: 'border-teal-100 bg-teal-50 text-teal-700', card: 'border-teal-100 bg-white' },
                error: { label: 'PO check unavailable', badge: 'border-red-200 bg-red-50 text-red-700', card: 'border-red-200 bg-white' }
              }[poState.poStatus];
              return (
                <article
                  key={year.label}
                  className={`relative overflow-hidden rounded-2xl border p-5 shadow-[0_12px_28px_rgba(15,23,42,0.07)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(15,23,42,0.10)] ${statusMeta.card} ${active ? 'ring-2 ring-teal-500' : ''}`}
                  style={{ '--delay': `${index * 90}ms` }}
                >
                  <div className="flex items-start justify-between gap-3"><span className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">EPR Year</span><span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${statusMeta.badge}`}>{statusMeta.label}</span></div>
                  <strong className="mt-3 block text-3xl font-black leading-none text-slate-950">{year.label}</strong>
                  <span className="mt-2 block text-xs font-bold text-slate-400">{year.period}</span>
                  <div className="mt-4 min-h-16 rounded-xl border border-white/80 bg-white/75 p-3">
                    {poState.poStatus === 'received' && <><span className="text-[10px] font-black uppercase tracking-widest text-slate-400">PO Number</span><strong className="mt-1 block break-words text-sm font-black text-slate-800">{poState.po?.number || 'Document received'}</strong>{poState.po?.fileName && <span className="mt-1 block truncate text-xs font-semibold text-slate-500" title={poState.po.fileName}>{poState.po.fileName}</span>}</>}
                    {poState.poStatus === 'pending' && <p className="text-xs font-bold leading-5 text-amber-700">PO details are required before starting this Annual Return.</p>}
                    {poState.poStatus === 'not_required' && <p className="text-xs font-bold leading-5 text-red-600">Purchase Order is required before this Annual Return can be opened.</p>}
                    {poState.poStatus === 'unlinked' && <p className="text-xs font-bold leading-5 text-slate-500">The Client Master has no valid source Lead relationship.</p>}
                    {poState.poStatus === 'conflict' && <p className="text-xs font-bold leading-5 text-orange-700">Multiple PO records found. Please review PO details.</p>}
                    {poState.poStatus === 'loading' && <div className="space-y-2"><span className="block h-3 w-32 animate-pulse rounded bg-teal-100" /><span className="block h-3 w-48 animate-pulse rounded bg-slate-100" /></div>}
                    {poState.poStatus === 'error' && <p className="text-xs font-bold leading-5 text-red-600">{poState.message}</p>}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    {poState.poStatus === 'received' && poState.po?.fileUrl ? <a href={normalizeDocumentUrl(poState.po.fileUrl)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-black text-emerald-700"><Eye className="h-3.5 w-3.5" /> View PO</a> : <span />}
                    {poState.poStatus === 'error' && <button type="button" onClick={() => setPoRefreshToken((value) => value + 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600">Retry</button>}
                    {poState.poStatus === 'pending' && <button type="button" onClick={() => { setPoDraft(poWorkflow.confirmed ? poWorkflow : {}); setPoValidationError(''); setPoModalOpen(true); }} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-black text-white">Add PO</button>}
                    {poState.poStatus === 'conflict' && <button type="button" onClick={() => setPoDetails(poState)} className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-black text-white">Review Details</button>}
                    {poState.poStatus === 'received' && <button type="button" disabled={locked} onClick={() => openAnnualYear(year)} className="rounded-lg bg-[#30737B] px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-45">Open Annual Return</button>}
                    {poState.poStatus === 'not_required' && <button type="button" disabled className="cursor-not-allowed rounded-lg bg-red-600 px-3 py-2 text-xs font-black text-white opacity-90" title="Purchase Order is required">Open Annual Return</button>}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyTab
            title="No completed annual return year"
            message="Select a first annual return year up to the latest completed financial year."
          />
        )}
      </section>}

      {poDetails && !selected && createPortal((
        <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <section className="w-full max-w-xl overflow-hidden rounded-[24px] border border-emerald-100 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.35)]">
            <header className="flex items-start justify-between gap-4 border-b border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-teal-50 p-6">
              <div><p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Purchase Order Details</p><h2 className="mt-2 text-2xl font-black text-slate-950">{poDetails.poStatus === 'conflict' ? 'PO records need review' : 'Lead closure PO'}</h2></div>
              <button type="button" onClick={() => setPoDetails(null)} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500"><X className="h-4 w-4" /></button>
            </header>
            <div className="grid gap-4 p-6 sm:grid-cols-2">
              <PoDetailItem label="PO Status" value={poDetails.poStatus === 'received' ? 'Received' : 'Conflict'} />
              <PoDetailItem label="Financial Year" value={poDetails.fy} />
              <PoDetailItem label="PO Number" value={poDetails.po?.number || 'Multiple records found'} wide />
              <PoDetailItem label="Service" value={poDetails.po?.service || 'Annual Return'} />
              <PoDetailItem label="Source" value={poDetails.po?.source === 'annual_return_legacy' ? 'Existing Annual Return record' : poDetails.po?.leadCode ? `Lead ${poDetails.po.leadCode}` : poResolution.sourceLead?.leadCode ? `Lead ${poResolution.sourceLead.leadCode}` : 'Source Lead'} />
              <PoDetailItem label="Document" value={poDetails.po?.fileName || (poDetails.po?.fileUrl ? 'PO document' : 'Not available')} wide />
              {poDetails.poStatus === 'conflict' && <p className="sm:col-span-2 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm font-bold text-orange-700">Multiple different Annual Return PO records were found for this financial year. No record was selected automatically.</p>}
            </div>
            <footer className="flex justify-end gap-3 border-t border-slate-100 p-5">
              <button type="button" onClick={() => setPoDetails(null)} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-black text-slate-600">Close</button>
              {poDetails.po?.fileUrl && <a href={normalizeDocumentUrl(poDetails.po.fileUrl)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-[#30737B] px-5 py-2.5 text-sm font-black text-white"><Eye className="h-4 w-4" /> View Document</a>}
            </footer>
          </section>
        </div>
      ), document.body)}

      {poApprovalPreviewOpen && !selected && createPortal((
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-700/70 p-3 backdrop-blur-md sm:p-6">
          <section className="flex max-h-[calc(100vh-24px)] w-full max-w-[1320px] flex-col overflow-hidden rounded-[30px] border border-emerald-100 bg-[#fbfdfd] shadow-[0_35px_100px_rgba(15,23,42,0.35)] sm:max-h-[calc(100vh-48px)]">
            <header className="flex shrink-0 items-start justify-between gap-5 border-b border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-orange-50 px-5 py-5 sm:px-7">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-emerald-700">Preview</span><span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold text-slate-500">Approval email / proof</span></div>
                <h2 className="mt-3 truncate text-xl font-black text-slate-900 sm:text-2xl">PO Special Approval</h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">{clientName} · {uniqueId}</p>
              </div>
              <button type="button" onClick={() => setPoApprovalPreviewOpen(false)} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-red-200 hover:text-red-500"><X className="h-5 w-5" /></button>
            </header>
            <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
              <section className="rounded-[24px] border border-emerald-100 bg-white p-5 shadow-sm sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div><p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Mail summary</p><h3 className="mt-2 text-lg font-black text-slate-900">Purchase Order special approval for review</h3><p className="mt-1 text-sm font-semibold text-slate-500">{(poWorkflow.approvalFiles || []).length} attachment(s) included</p></div>
                  <span className="rounded-full bg-teal-50 px-4 py-2 text-xs font-black text-[#30737B]">Saved {formatDisplayDate(poWorkflow.savedAt)}</span>
                </div>
                <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr_1.35fr]">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"><p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Subject</p><p className="mt-2 font-bold leading-6 text-slate-700">PO approval · {clientName}</p></div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"><p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Date</p><p className="mt-2 font-bold text-slate-700">{formatDisplayDate(poWorkflow.savedAt)}</p></div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"><p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Attachments</p><div className="mt-2 flex flex-wrap gap-2">{(poWorkflow.approvalFiles || []).map((file, index) => { const href = file.secureUrl || file.url || file.fileUrl; return <a key={`${file.name}-${index}`} href={href} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-2 rounded-xl border border-emerald-100 bg-white px-3 py-2 text-xs font-bold text-[#30737B] shadow-sm hover:bg-emerald-50"><FileText className="h-4 w-4 shrink-0" /><span className="truncate">{file.name || `Proof ${index + 1}`}</span></a>; })}</div></div>
                </div>
              </section>
              <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-4"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Approval message</p></div>
                <div className="min-h-44 whitespace-pre-wrap p-5 text-sm font-medium leading-7 text-slate-700 sm:p-7">{poWorkflow.approvalNote || 'No written approval note was provided. Review the uploaded proof above.'}</div>
              </section>
              <div className="flex justify-end"><button type="button" onClick={() => setPoApprovalPreviewOpen(false)} className="rounded-xl bg-[#30737B] px-6 py-3 text-sm font-black text-white shadow-sm">Close Preview</button></div>
            </div>
          </section>
        </div>
      ), document.body)}

      {poModalOpen && !selected && createPortal((
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-md sm:p-6">
          <section className="flex max-h-[calc(100vh-24px)] w-full max-w-[1480px] flex-col overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-[0_32px_90px_rgba(15,23,42,0.38)] sm:max-h-[calc(100vh-48px)]">
            <header className="flex shrink-0 items-start justify-between border-b border-emerald-100 bg-[linear-gradient(120deg,#f0fdf4_0%,#ffffff_48%,#fff7ed_100%)] px-5 py-5 sm:px-7 sm:py-6">
              <div><p className="text-xs font-black uppercase tracking-[0.22em] text-[#527566]">PO Workflow</p><h2 className="mt-2 text-2xl font-black text-slate-950">Purchase Order Confirmation</h2><p className="mt-1 text-sm font-semibold text-slate-500">{clientName} · {uniqueId}</p></div>
              <button type="button" onClick={() => setPoModalOpen(false)} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:-translate-y-0.5 hover:text-red-500 hover:shadow-md"><X className="h-5 w-5" /></button>
            </header>
            <div className="flex-1 space-y-5 overflow-y-auto bg-slate-50/60 p-4 sm:p-6">
              <div className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">PO Received</p>
                <div className="mt-4 flex gap-3">
                  {['yes', 'no'].map((mode) => {
                    const selectedMode = poDraft.mode === mode;
                    return (
                      <button key={mode} type="button" aria-pressed={selectedMode} onClick={() => { setPoDraft((current) => ({ ...current, mode })); setPoValidationError(''); }} className={`group flex min-w-36 items-center gap-3 rounded-2xl border-2 px-4 py-3.5 text-left transition-all ${selectedMode ? 'border-[#30737B] bg-teal-50 text-[#205e65] shadow-md shadow-teal-900/10' : 'border-slate-200 bg-white text-slate-600 hover:border-teal-200 hover:bg-teal-50/40'}`}>
                        <span className={`grid h-9 w-9 place-items-center rounded-xl transition ${selectedMode ? 'bg-[#30737B] text-white' : 'bg-slate-100 text-slate-400 group-hover:bg-teal-100 group-hover:text-[#30737B]'}`}>{mode === 'yes' ? <Check className="h-5 w-5" /> : <X className="h-5 w-5" />}</span>
                        <span><strong className="block text-sm font-black capitalize">{mode}</strong><small className="mt-0.5 block text-[11px] font-bold text-slate-400">{mode === 'yes' ? 'PO is available' : 'Enter PO details'}</small></span>
                        {selectedMode && <CheckCircle2 className="ml-auto h-5 w-5 text-[#30737B]" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {!poDraft.mode ? (
                <div className="rounded-2xl border border-dashed border-teal-200 bg-gradient-to-br from-white to-teal-50/60 px-6 py-10 text-center shadow-sm">
                  <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-teal-100 text-[#30737B]"><FileCheck2 className="h-7 w-7" /></div>
                  <h3 className="mt-4 text-lg font-black text-slate-900">Select PO availability</h3>
                  <p className="mx-auto mt-2 max-w-lg text-sm font-semibold text-slate-500">Choose Yes or No, then add the financial-year purchase order details.</p>
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">PO Received For No Of Year</p><strong className="mt-2 block text-2xl text-slate-900">{(poDraft.rows || []).length}</strong></div><div className="flex gap-2"><button type="button" onClick={addPoYear} disabled={(poDraft.rows || []).length >= years.length} className="rounded-xl bg-[#416c5a] px-4 py-3 text-sm font-black text-white disabled:opacity-50">+ Add Next Year</button><button type="button" onClick={() => updatePoRows((poDraft.rows || []).slice(0, -1))} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-600">Remove Last Year</button></div></div>
                  <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <table className="w-full min-w-[1180px] text-left text-sm">
                      <thead className="border-b border-teal-200 bg-gradient-to-r from-teal-50 via-emerald-50 to-cyan-50 text-xs font-black uppercase tracking-widest text-teal-900"><tr><th className="w-24 p-5">Sr. No</th><th className="w-48 p-5">FY Year</th><th className="w-64 p-5">PO Number</th><th className="w-60 p-5">PO Upload</th><th className="min-w-[420px] p-5">Services</th></tr></thead>
                      <tbody>{(poDraft.rows || []).length ? (poDraft.rows || []).map((row, index) => (
                        <tr key={index} className="border-t border-slate-100 align-top transition hover:bg-teal-50/30">
                          <td className="p-5"><span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 font-black text-slate-700">{index + 1}</span></td>
                          <td className="p-5"><select className="form-input min-w-40" value={row.fyYear || ''} onChange={(event) => updatePoRow(index, 'fyYear', event.target.value)}><option value="">Select FY Year</option>{years.map((year) => <option key={year.label} value={year.label}>{year.label}</option>)}</select></td>
                          <td className="p-5"><input className="form-input min-w-52" value={row.poNumber || ''} onChange={(event) => updatePoRow(index, 'poNumber', event.target.value)} placeholder="Enter PO Number" /></td>
                          <td className="p-5"><label className="inline-flex min-h-12 max-w-52 cursor-pointer items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 font-black text-[#416c5a] transition hover:bg-emerald-100"><Upload className="h-4 w-4 shrink-0" /><span className="truncate">{row.file?.name || 'Choose File'}</span><input type="file" className="sr-only" onChange={(event) => uploadPoFile(index, event.target.files?.[0])} /></label></td>
                          <td className="p-5"><PoServiceMultiSelect value={row.service} options={annualPoServiceCategoryOptions} onChange={(services) => updatePoRow(index, 'service', services)} /></td>
                        </tr>
                      )) : <tr><td colSpan="5" className="p-14 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-teal-50 text-[#30737B]"><Plus className="h-7 w-7" /></div><p className="mt-4 font-black text-slate-700">No purchase order year added</p><p className="mt-1 text-sm font-semibold text-slate-400">Click Add Next Year to start adding PO and services.</p></td></tr>}</tbody>
                    </table>
                  </div>
                </div>
              )}
              {poValidationError && <ToastMessage type="error">{poValidationError}</ToastMessage>}
              <footer className="flex justify-end gap-3 border-t border-slate-200 pt-5"><button type="button" onClick={() => setPoModalOpen(false)} className="rounded-xl border border-slate-200 px-5 py-3 font-black text-slate-600">Cancel</button><button type="button" onClick={savePoWorkflow} className="rounded-xl bg-[#416c5a] px-6 py-3 font-black text-white">Save And Continue</button></footer>
            </div>
          </section>
        </div>
      ), document.body)}

      {selected && (
        <section className="annual-workspace">
          <div className="annual-toolbar">
            <button type="button" onClick={() => onSelectYear('')} className="btn-lift annual-back-button" aria-label="Back" title="Back">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="annual-summary-strip">
              <div className="annual-summary-card annual-summary-card-client">
                <span className="annual-summary-icon"><Building2 className="h-5 w-5" /></span>
                <div className="annual-summary-copy">
                  <span className="annual-summary-label">{uniqueId}</span>
                  <strong className="annual-summary-value">{clientName}</strong>
                  <span className="annual-summary-meta">{data.basic?.piboCategory || data.basic?.eprCategory || 'Client'}</span>
                </div>
              </div>
              <div className="annual-summary-card">
                <span className="annual-summary-icon"><CalendarDays className="h-5 w-5" /></span>
                <div className="annual-summary-copy">
                  <span className="annual-summary-label">Annual Return Year</span>
                  <strong className="annual-summary-value">{selected.label}</strong>
                </div>
              </div>
              <div className="annual-summary-card annual-summary-card-user">
                <span className="annual-summary-icon"><UserRound className="h-5 w-5" /></span>
                <div className="annual-summary-copy">
                  <span className="annual-summary-label">Current SPOC</span>
                  <strong className="annual-summary-value">{assignedName || '-'}</strong>
                </div>
              </div>
              <div className="annual-summary-card annual-summary-card-spoc">
                <span className="annual-summary-icon"><RefreshCw className="h-5 w-5" /></span>
                <div className="annual-summary-copy">
                  <span className="annual-summary-label">Previous SPOC</span>
                  <strong className="annual-summary-value">{previousSpocName || '-'}</strong>
                </div>
              </div>
            </div>
          </div>

          <div className="annual-workspace-body">
            <aside className="annual-stepper">
              {processingTabs.map((tab) => {
                const Icon = tab.icon;
                const active = activeProcessingTab === tab.id;
                const complete = Boolean(completedAnnualTabs[tab.id]);
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => switchProcessingTab(tab.id)}
                    title={tab.label}
                    aria-current={active ? 'step' : undefined}
                    className={`annual-step ${active ? 'annual-step-active' : ''} ${complete ? 'annual-step-complete' : ''}`}
                  >
                    <span className="annual-step-icon"><Icon className="h-4 w-4" /></span>
                    <span>{tab.label}</span>
                    {complete && <CheckCircle2 className="annual-step-check h-4 w-4" />}
                  </button>
                );
              })}
            </aside>

            <div className={`annual-tab-content min-w-0 ${annualTransitioning ? 'annual-tab-content-switching' : ''}`}>
              <div className="annual-panel-head">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-[#30737B]">Step {activeTabIndex + 1} of {processingTabs.length} - {completedAnnualCount}/{processingTabs.length} done</p>
                  <h4 className="mt-1 text-xl font-black text-slate-950">{processingTabs[activeTabIndex]?.label}</h4>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className="annual-year-badge"><CalendarDays className="h-4 w-4" /> FY {selected.label}</span>
                </div>
              </div>
              {activeProcessingTab === 'data' && annualDataSubTabs.length > 1 && (
                <div className="mx-4 mt-4 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2" role="tablist" aria-label="Annual return data views">
                  {annualDataSubTabs.map((subTab) => {
                    const active = activeDataSubTab === subTab.id;
                    return (
                      <button
                        key={subTab.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setActiveDataSubTab(subTab.id)}
                        className={`min-h-11 flex-1 rounded-xl px-5 py-2.5 text-sm font-black transition sm:flex-none ${active ? 'bg-[#30737B] text-white shadow-md shadow-teal-900/15' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-teal-50 hover:text-[#30737B]'}`}
                      >
                        {subTab.label}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="annual-section-content space-y-4">
                {activeSection && activeProcessingTab !== 'data' && (
                  <ProcessingSection
                    section={activeSection}
                    sectionTabs={activeSections.map((section) => section.title)}
                    activeSectionTitle={activeSection.title}
                    onSelectSection={switchPillSection}
                    quotationContext={quotationContext}
                    tone="white"
                    readValue={readDraftValue}
                    onChange={updateDraftValue}
                    fieldRenderer={activeProcessingTab === 'financials' ? 'table' : 'overview'}
                    sectionStatuses={activeProcessingTab === 'data' ? dataSectionStatuses : {}}
                    reviewStage={dataSectionReviewStage}
                    completedSectionTitles={completedAnnualSections[activeProcessingTab] || []}
                    canReview={canOpenReviewPanel}
                    onReview={() => setReviewDrawerOpen(true)}
                    saving={savingAnnual}
                    onSave={() => saveAnnualDraft(activeProcessingTab, activeSection?.title || '')}
                  />
                )}
                {activeProcessingTab === 'data' && (
                  <PurchaseDataWorkspace clientId={client?._id || client?.id || uniqueId} financialYear={selected.label} currentUser={currentUser} />
                )}
              </div>
              {saveNotice && <ToastMessage type="success" className="mx-4 mb-3">{saveNotice}</ToastMessage>}
              {annualSaveError && <ToastMessage type="error" className="mx-4 mb-3">{annualSaveError}</ToastMessage>}
              {activeProcessingTab !== 'data' && <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button type="button" disabled={savingAnnual || dataPendingForReview} onClick={handlePrimaryAnnualAction} className={`btn-lift inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-6 text-sm font-black text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-60 ${canViewReviewData ? 'bg-slate-950 shadow-slate-950/20' : 'bg-emerald-600 shadow-emerald-600/20'}`}>{React.createElement(submitButtonIcon, { className: 'h-4 w-4' })}{savingAnnual ? 'Saving...' : submitButtonLabel}</button>
                {showReviewNextButton && (
                  <button type="button" disabled={savingAnnual} onClick={handleAnnualSubmitNext} className="btn-lift inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-6 text-sm font-black text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-60">
                    Next Part <ChevronRight className="h-4 w-4" />
                  </button>
                )}
              </div>}
            </div>
          </div>
        </section>
      )}
      {reviewDrawerOpen && createPortal(
        <AnnualReviewDrawer
          workflow={approvalWorkflow}
          mode={reviewUiMode}
          roleLabel={annualReviewRoleLabel}
          debugInfo={annualReviewDebugInfo}
          activeSectionTitle={activeSection?.title || ''}
          sectionTitles={getDataSectionTitles()}
          canTakeAction={canTakeReviewAction}
          canSubmitToManager={canSubmitFromReviewPanel}
          saving={savingAnnual}
          onClose={() => setReviewDrawerOpen(false)}
          onSubmitToManager={submitDataForManager}
          onApprove={(sectionTitle) => handleAnnualReview('APPROVED', sectionTitle)}
          onReject={(sectionTitle) => handleAnnualReview('REJECTED', sectionTitle)}
        />,
        document.body
      )}
      {annualCompletionModal && (
        <div className="annual-completion-backdrop" role="presentation" onClick={() => setAnnualCompletionModal(null)}>
          <div className="annual-completion-modal" role="dialog" aria-modal="true" aria-label={annualCompletionModal.title} onClick={(event) => event.stopPropagation()}>
            <div className="annual-completion-icon"><CheckCircle2 className="h-8 w-8" /></div>
            <h2>{annualCompletionModal.title}</h2>
            <p>{annualCompletionModal.message}</p>
            <button type="button" onClick={() => setAnnualCompletionModal(null)} className="btn-lift">OK</button>
          </div>
        </div>
      )}
      {annualConfirmOpen && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/45 px-4 backdrop-blur-sm animate-[fadeIn_.18s_ease-out]">
          <div className="w-full max-w-lg rounded-[24px] bg-white p-6 shadow-2xl shadow-slate-950/25 animate-[app-loader-card-in_.32s_cubic-bezier(.22,1,.36,1)]">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-orange-100 text-orange-700">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <h2 className="mt-5 text-center text-xl font-black text-slate-950">Submission Confirmation</h2>
            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4 text-left">
              <input type="checkbox" checked={confirmFinancials} onChange={(event) => setConfirmFinancials(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-orange-600" />
              <span className="text-sm font-black leading-6 text-slate-800">I confirm the auto-fetched Client Master data and entered values are checked for this annual return step.</span>
            </label>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={closeAnnualConfirm} className="btn-lift min-h-11 rounded-lg border border-slate-200 bg-white px-5 font-black text-slate-700">
                Cancel
              </button>
              <button type="button" disabled={!confirmFinancials || savingAnnual} onClick={confirmAnnualSubmission} className="btn-lift min-h-11 rounded-lg bg-emerald-600 px-6 font-black text-white shadow-lg shadow-emerald-600/20 disabled:cursor-not-allowed disabled:opacity-50">
                {savingAnnual ? 'Saving...' : 'Confirm & Next'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatAnnualWorkflowStatus(workflow = {}) {
  const status = String(workflow.status || 'draft').replace(/_/g, ' ');
  const effectiveReviewStage = getAnnualReviewStage(workflow);
  if (effectiveReviewStage === 'manager') return 'Pending with Manager';
  if (effectiveReviewStage === 'compliance') return 'Pending with Compliance Manager';
  if (effectiveReviewStage === 'complete') return 'Approved by Compliance Manager';
  if (workflow.status === 'manager_rejected') return 'Rejected by Manager, waiting for user correction';
  if (workflow.status === 'compliance_rejected') return 'Rejected by Compliance Manager, waiting for manager correction';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function getAnnualReviewVisiblePattern(activeSectionTitle = '', showAllParts = false) {
  if (showAllParts) return /^Part\s+[A-D]\b/i;
  const activePart = String(getAnnualPartShortLabel(activeSectionTitle)).toUpperCase();
  const activeIndex = ['PART A', 'PART B', 'PART C', 'PART D'].indexOf(activePart);
  const lastVisibleIndex = activeIndex > -1 ? activeIndex : 0;
  const visibleParts = ['A', 'B', 'C', 'D'].slice(0, lastVisibleIndex + 1).join('');
  return new RegExp(`^Part\\s+[${visibleParts}]\\b`, 'i');
}

function getAnnualStageSectionStatus(workflow = {}, sectionTitle = '', stage = 'manager') {
  const metas = getAnnualSectionMetas(workflow, sectionTitle);
  const effectiveReviewStage = getAnnualReviewStage(workflow);
  if (stage === 'manager') {
    return pickAnnualReviewStatusFromMetas(metas, 'managerStatus', 'pending');
  }
  const complianceStatus = pickAnnualReviewStatusFromMetas(metas, 'complianceStatus', '');
  const managerStatus = pickAnnualReviewStatusFromMetas(metas, 'managerStatus', '');
  if (complianceStatus) return complianceStatus;
  if (effectiveReviewStage === 'complete') return 'approved';
  if (managerStatus === 'approved') return 'pending';
  if (managerStatus === 'rejected') return 'waiting';
  return 'waiting';
}

function getAnnualStageReviewer(workflow = {}, sectionTitle = '', stage = 'manager') {
  const metas = getAnnualSectionMetas(workflow, sectionTitle);
  const reviewedByKey = stage === 'compliance' ? 'complianceReviewedBy' : 'managerReviewedBy';
  const reviewedAtKey = stage === 'compliance' ? 'complianceReviewedAt' : 'managerReviewedAt';
  const statusKey = stage === 'compliance' ? 'complianceStatus' : 'managerStatus';
  const actionPrefix = stage === 'compliance' ? 'COMPLIANCE_' : 'MANAGER_';
  const partKey = getAnnualPartKey(sectionTitle);
  const meta = metas.find((item) => normalizeAnnualReviewStatus(item?.[statusKey] || item?.status || '') === 'approved' && item?.[reviewedByKey])
    || metas.find((item) => normalizeAnnualReviewStatus(item?.[statusKey] || item?.status || '') === 'rejected' && item?.[reviewedByKey])
    || metas.find((item) => item?.[reviewedByKey])
    || {};
  const history = Array.isArray(workflow.history) ? workflow.history : [];
  const historyItem = [...history].reverse().find((item) => (
    String(item?.action || '').trim().toUpperCase().startsWith(actionPrefix) &&
    (!partKey || getAnnualPartKey(item?.section || '') === partKey) &&
    item?.by
  )) || {};
  return {
    by: meta[reviewedByKey] || historyItem.by || '',
    at: meta[reviewedAtKey] || meta.updatedAt || historyItem.at || ''
  };
}

function getAnnualStatusBadgeClass(status = '') {
  if (status === 'approved') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'rejected') return 'border-red-200 bg-red-50 text-red-700';
  if (status === 'waiting') return 'border-slate-200 bg-slate-100 text-slate-500';
  return 'border-amber-200 bg-amber-50 text-amber-700';
}

function getAnnualReviewProgress(workflow = {}, sectionTitles = [], stage = 'manager') {
  const titles = sectionTitles.length ? sectionTitles : Object.keys(workflow.sections || {});
  const statuses = titles.map((title) => getAnnualStageSectionStatus(workflow, title, stage));
  const total = titles.length || 0;
  const approved = statuses.filter((status) => status === 'approved').length;
  const rejected = statuses.filter((status) => status === 'rejected').length;
  const waiting = statuses.filter((status) => status === 'waiting').length;
  const reviewed = statuses.filter((status) => status === 'approved' || status === 'rejected').length;
  const pending = Math.max(total - approved - rejected - waiting, 0);
  return {
    total,
    approved,
    rejected,
    pending,
    waiting,
    reviewed,
    percent: total ? Math.round((reviewed / total) * 100) : 0
  };
}

function buildAnnualTrackingSteps(workflow = {}, managerProgress = {}, complianceProgress = {}) {
  const stage = getAnnualReviewStage(workflow);
  const status = String(workflow.status || '').toLowerCase();
  const managerRejected = status === 'manager_rejected';
  const complianceRejected = status === 'compliance_rejected';
  const submittedToManager = stage === 'manager' || stage === 'compliance' || stage === 'complete' || managerRejected || complianceRejected;
  const managerComplete = stage === 'compliance' || stage === 'complete' || complianceRejected || (managerProgress.total > 0 && managerProgress.approved === managerProgress.total);
  const complianceActive = stage === 'compliance';
  const complianceComplete = stage === 'complete';

  return [
    {
      title: 'User Submitted',
      description: submittedToManager ? 'Annual return sent to Manager' : 'Draft is still with user',
      state: submittedToManager ? 'complete' : 'current',
      meta: submittedToManager ? 'Done' : 'Draft'
    },
    {
      title: 'Manager Review',
      description: managerRejected ? 'Rejected, waiting for user correction' : `${managerProgress.reviewed || 0}/${managerProgress.total || 0} parts reviewed`,
      state: managerRejected ? 'rejected' : managerComplete ? 'complete' : submittedToManager ? 'current' : 'upcoming',
      meta: managerRejected ? 'Rejected' : managerComplete ? 'Approved' : submittedToManager ? `${managerProgress.percent || 0}%` : 'Waiting'
    },
    {
      title: 'Compliance Review',
      description: complianceRejected
        ? 'Rejected, waiting for manager correction'
        : managerComplete
          ? `${complianceProgress.reviewed || 0}/${complianceProgress.total || 0} parts reviewed`
          : 'Starts after Manager approval',
      state: complianceRejected ? 'rejected' : complianceComplete ? 'complete' : complianceActive ? 'current' : 'upcoming',
      meta: complianceRejected ? 'Rejected' : complianceComplete ? 'Approved' : complianceActive ? `${complianceProgress.percent || 0}%` : 'Locked'
    }
  ];
}

function AnnualTrackingTimeline({ workflow, managerProgress, complianceProgress }) {
  const steps = buildAnnualTrackingSteps(workflow, managerProgress, complianceProgress);
  const activeStep = steps.find((step) => step.state === 'current' || step.state === 'rejected') || steps[steps.length - 1];
  const submittedBy = getAnnualWorkflowSubmittedBy(workflow);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="bg-[linear-gradient(135deg,#f8fafc_0%,#ffffff_55%,#f0fdfa_100%)] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-[#30737B]">Approval Tracking</p>
          <h4 className="mt-1 text-lg font-black text-slate-950">{activeStep.title}</h4>
          <p className="mt-1 text-sm font-bold text-slate-500">{activeStep.description}</p>
          {submittedBy && <p className="mt-2 text-xs font-black uppercase tracking-[0.08em] text-slate-500">Submitted by: <span className="text-slate-800">{submittedBy}</span></p>}
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-black uppercase text-slate-600">
          {formatAnnualWorkflowStatus(workflow)}
        </span>
      </div>
      </div>

      <div className="px-4 pb-4 pt-5">
        <div className="grid grid-cols-3 gap-0">
        {steps.map((step, index) => {
          const complete = step.state === 'complete';
          const current = step.state === 'current';
          const rejected = step.state === 'rejected';
          const upcoming = step.state === 'upcoming';
          const dotClass = complete
            ? 'border-emerald-600 bg-emerald-600 text-white'
              : rejected
                ? 'border-red-500 bg-red-500 text-white'
                : current
                  ? 'border-[#30737B] bg-white text-[#30737B] ring-4 ring-[#30737B]/10'
                  : 'border-slate-200 bg-slate-50 text-slate-400';
          const textClass = rejected ? 'text-red-700' : complete ? 'text-emerald-700' : current ? 'text-[#30737B]' : 'text-slate-500';
          const metaClass = rejected ? 'bg-red-50 text-red-700' : complete ? 'bg-emerald-50 text-emerald-700' : current ? 'bg-teal-50 text-[#30737B]' : 'bg-slate-100 text-slate-500';
          const railClass = complete ? 'bg-emerald-500' : current ? 'bg-[#30737B]/25' : 'bg-slate-200';

          return (
            <div key={step.title} className={`relative flex min-w-0 flex-col items-center px-1 text-center ${upcoming ? 'opacity-75' : ''}`}>
              {index > 0 && <span className={`absolute left-0 top-4 h-1 w-1/2 -translate-y-1/2 ${steps[index - 1].state === 'complete' ? 'bg-emerald-500' : 'bg-slate-200'}`} />}
              {index < steps.length - 1 && <span className={`absolute right-0 top-4 h-1 w-1/2 -translate-y-1/2 ${railClass}`} />}
              <span className={`relative z-[1] grid h-8 w-8 place-items-center rounded-full border-2 text-xs font-black ${dotClass}`}>
                  {complete ? <Check className="h-4 w-4" /> : rejected ? <X className="h-4 w-4" /> : current ? <RefreshCw className="h-4 w-4" /> : index + 1}
              </span>
              <div className="mt-3 min-w-0">
                <p className={`truncate text-[12px] font-black ${textClass}`}>{step.title}</p>
                <span className={`mt-2 inline-flex max-w-full rounded-full px-2 py-1 text-[10px] font-black uppercase ${metaClass}`}>
                  <span className="truncate">{step.meta}</span>
                </span>
                <p className="mt-2 line-clamp-2 min-h-8 text-[11px] font-bold leading-4 text-slate-500">{step.description}</p>
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}

function AnnualStatusChip({ label, status }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-black uppercase ${getAnnualStatusBadgeClass(status)}`}>
      {label}: {status || 'pending'}
    </span>
  );
}

function AnnualReviewDrawer({ workflow, mode = 'popup', roleLabel, debugInfo = {}, activeSectionTitle = '', sectionTitles = [], canTakeAction = false, canSubmitToManager = false, saving, onClose, onSubmitToManager, onApprove, onReject }) {
  const reviewStage = getAnnualReviewStage(workflow) === 'compliance' ? 'compliance' : 'manager';
  const workflowStatus = String(workflow.status || '').toLowerCase();
  const managerCorrectionMode = reviewStage === 'manager' && workflowStatus === 'compliance_rejected';
  const showAllParts = ['manager', 'compliance', 'complete'].includes(getAnnualReviewStage(workflow)) ||
    ['manager_rejected', 'compliance_rejected'].includes(workflowStatus);
  const allSectionTitles = sectionTitles.length ? sectionTitles : Object.keys(workflow.sections || {});
  const visiblePartPattern = getAnnualReviewVisiblePattern(activeSectionTitle, showAllParts);
  const visibleSectionTitles = allSectionTitles.length
    ? allSectionTitles
    : allSectionTitles.filter((title) => visiblePartPattern.test(String(title || '')));
  const managerProgress = getAnnualReviewProgress(workflow, allSectionTitles, 'manager');
  const complianceProgress = getAnnualReviewProgress(workflow, allSectionTitles, 'compliance');
  useEffect(() => {
    console.groupCollapsed('[AnnualReview:drawer-state]');
    console.debug({
      workflow: summarizeAnnualWorkflow(workflow),
      reviewStage,
      workflowStatus,
      activeSectionTitle,
      canTakeAction,
      canSubmitToManager,
      managerProgress,
      complianceProgress,
      debugInfo
    });
    console.table(allSectionTitles.map((title) => ({
      part: getAnnualPartShortLabel(title),
      title,
      visible: visibleSectionTitles.includes(title),
      manager: getAnnualStageSectionStatus(workflow, title, 'manager'),
      compliance: getAnnualStageSectionStatus(workflow, title, 'compliance'),
      currentStageStatus: getAnnualSectionStatus(workflow, title, reviewStage)
    })));
    console.groupEnd();
  }, [
    workflow,
    reviewStage,
    workflowStatus,
    activeSectionTitle,
    canTakeAction,
    canSubmitToManager,
    allSectionTitles.join('|'),
    visibleSectionTitles.join('|'),
    managerProgress.percent,
    complianceProgress.percent,
    debugInfo.workflowStatus,
    debugInfo.currentStage,
    debugInfo.effectiveReviewStage
  ]);
  const isDrawer = mode === 'drawer';
  const backdropClass = isDrawer
    ? 'annual-review-backdrop fixed inset-0 z-[120] bg-slate-950/35 backdrop-blur-sm'
    : 'annual-review-backdrop fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-sm sm:py-10';
  const panelClass = isDrawer
    ? 'annual-review-panel absolute right-0 top-0 h-full w-full max-w-xl overflow-y-auto rounded-l-[20px] bg-white shadow-2xl shadow-slate-950/30 animate-[drawerIn_.24s_ease-out]'
    : 'annual-review-panel relative max-h-[calc(100vh-48px)] w-full max-w-xl overflow-y-auto rounded-[24px] bg-white shadow-2xl shadow-slate-950/30 animate-[app-loader-card-in_.28s_cubic-bezier(.22,1,.36,1)] sm:max-h-[calc(100vh-80px)]';

  return (
    <div className={backdropClass}>
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close review drawer" onClick={onClose} />
      <aside className={panelClass}>
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#30737B]">{roleLabel}</p>
              <h3 className="mt-1 text-xl font-black text-slate-950">Annual Data Review</h3>
            </div>
            <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="annual-review-body space-y-5 px-5 py-5">
          <AnnualTrackingTimeline workflow={workflow} managerProgress={managerProgress} complianceProgress={complianceProgress} />
          {canSubmitToManager && (
            <button type="button" disabled={saving} onClick={onSubmitToManager} className="btn-lift inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-black text-white shadow-lg shadow-emerald-600/20 disabled:cursor-not-allowed disabled:opacity-60">
              <ShieldCheck className="h-4 w-4" /> {saving ? 'Submitting...' : 'Submit A-D to Manager'}
            </button>
          )}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-2">
            <div className="mb-2 flex items-center justify-between px-2 pt-1">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Visible Parts</p>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-slate-500 shadow-sm">{visibleSectionTitles.length} shown</span>
            </div>
            <div className="space-y-2">
              {visibleSectionTitles.map((title) => {
                const sectionStatus = getAnnualSectionStatus(workflow, title, reviewStage);
                const managerStatus = getAnnualStageSectionStatus(workflow, title, 'manager');
                const complianceStatus = getAnnualStageSectionStatus(workflow, title, 'compliance');
                const managerReviewer = getAnnualStageReviewer(workflow, title, 'manager');
                const complianceReviewer = getAnnualStageReviewer(workflow, title, 'compliance');
                const stageStatus = reviewStage === 'compliance' ? complianceStatus : managerStatus;
                const tone = getAnnualSectionTone(sectionStatus);
                const active = title === activeSectionTitle;
                const approved = tone === 'approved';
                const rejected = tone === 'rejected';
                const pending = tone === 'pending';
                const canReviewSection = canTakeAction && (
                  managerCorrectionMode
                    ? stageStatus !== 'waiting'
                    : !['approved', 'rejected', 'waiting'].includes(stageStatus)
                );
                return (
                  <div key={title} className={`rounded-xl border px-3 py-3 shadow-sm ${approved ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : rejected ? 'border-red-200 bg-red-50 text-red-700' : pending ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-700'} ${active ? 'ring-2 ring-[#30737B]/20' : ''}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-black">{title}</span>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/70 px-2 py-1 text-xs font-black uppercase">
                        {approved ? <Check className="h-3.5 w-3.5" /> : rejected ? <X className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        {active ? 'Current - ' : ''}{sectionStatus || 'pending'}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <AnnualStatusChip label="Manager" status={managerStatus} />
                      <AnnualStatusChip label="Compliance" status={complianceStatus} />
                    </div>
                    {(managerReviewer.by || complianceReviewer.by) && (
                      <div className="mt-2 grid gap-1 text-[11px] font-black uppercase text-slate-600">
                        {managerReviewer.by && <span>Manager: {managerReviewer.by}</span>}
                        {complianceReviewer.by && <span>Compliance: {complianceReviewer.by}</span>}
                      </div>
                    )}
                    {canReviewSection && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <button type="button" disabled={saving} onClick={() => onReject(title)} className="btn-lift inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-red-500 px-3 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-60">
                          <X className="h-3.5 w-3.5" /> Reject
                        </button>
                        <button type="button" disabled={saving} onClick={() => onApprove(title)} className="btn-lift inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-60">
                          <Check className="h-3.5 w-3.5" /> Approve
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function ProcessingHeroStat({ label, value, icon: Icon }) {
  return (
    <div className="rounded-xl border border-white/20 bg-white/95 p-3 shadow-lg shadow-slate-950/10">
      <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
        <Icon className="h-4 w-4 text-orange-600" />
        {label}
      </div>
      <p className="mt-2 truncate text-sm font-black text-slate-950">{value || '-'}</p>
    </div>
  );
}

function buildCpcbLetterSections(clientName = '', annualYear = '') {
  const commonBackground = 'AnantTattva Private Limited is engaged in policy advocacy, compliance facilitation, and industry-government stakeholder coordination across sustainability, circular economy, EPR, and environmental governance.';
  const commonContext = `This representation is prepared in reference to Plastic Waste Management (Amendment) Rules, 2026 and the implementation questions arising during ${annualYear || 'the applicable annual return period'}.`;
  const buildRepresentationNote = (template) => [
    commonBackground,
    `${commonContext} ${template.regulatoryContext}`,
    template.industryConcern,
    template.requestedClarifications,
    template.supportNote
  ].filter(Boolean).join('\n\n');
  const templates = [
    {
      code: 'A',
      authorityShort: 'FSSAI',
      title: 'A - FSSAI',
      recipient: 'The Chairperson, Food Safety and Standards Authority of India',
      subject: 'Request for regulatory clarification on recycled plastic content and reuse obligations for food-contact packaging',
      regulatoryContext: 'Food-contact packaging requires clarity on whether recycled plastic content, reuse obligations, marking, labelling, migration controls, traceability, and decontamination validation are presently permitted under applicable FSSAI requirements.',
      industryConcern: 'Food packaging stakeholders are facing uncertainty because environmental compliance obligations overlap with food safety, contamination control, migration limits, shelf-life stability, and hygienic integrity requirements.',
      requestedClarifications: [
        'Categories of food-contact packaging where recycled plastic usage is permitted or prohibited.',
        'Specific polymers and applications eligible for food-grade recycled content.',
        'Applicability of reuse obligations on Category-I rigid food-contact packaging.',
        'Testing protocols, migration limits, decontamination standards, and validation requirements.',
        'Labelling and marking requirements for recycled-content food packaging.',
        'Documentation required for claiming exemption under PWM Rules, 2026.'
      ].join('\n'),
      supportNote: 'We request FSSAI to consider issuing a formal clarification or guidance note and, if appropriate, conduct a technical stakeholder consultation for practical implementation concerns.'
    },
    {
      code: 'B',
      authorityShort: 'CDSCO',
      title: 'B - CDSCO',
      recipient: 'The Drugs Controller General of India, Central Drugs Standard Control Organisation',
      subject: 'Request for regulatory clarification on pharmaceutical packaging under Plastic Waste Management (Amendment) Rules, 2026',
      regulatoryContext: 'Pharmaceutical and healthcare packaging needs clarity on whether drug stability requirements, sterility considerations, migration limitations, packaging integrity protocols, or notified quality standards restrict recycled plastic content.',
      industryConcern: 'Drug manufacturers, packaging converters, importers, polymer suppliers, and contract packaging entities are unable to determine the practical applicability of exemption provisions under PWM Rules.',
      requestedClarifications: [
        'Whether recycled plastic content is permissible in pharmaceutical primary and secondary packaging.',
        'Whether Drugs & Cosmetics Rules, packaging guidelines, pharmacopoeial standards, or notified quality standards restrict recycled polymer usage.',
        'Whether exemptions under PWM Rules can be claimed based on pharmaceutical packaging safety requirements.',
        'Applicability of reuse obligations for Category-I rigid pharmaceutical packaging.',
        'Testing, validation, migration, toxicology, and stability assessment requirements.',
        'Requirement of additional approvals or product variation filings when recycled-content packaging is introduced.'
      ].join('\n'),
      supportNote: 'We request CDSCO to provide suitable clarification so sustainability objectives can be harmonized with pharmaceutical safety and public health protection.'
    },
    {
      code: 'C',
      authorityShort: 'CIBRC',
      title: 'C - CIBRC',
      recipient: 'The Secretary, Central Insecticides Board & Registration Committee',
      subject: 'Request for clarification on recycled plastic content and reuse obligations for pesticide packaging under Plastic Waste Management (Amendment) Rules, 2026',
      regulatoryContext: 'Pesticide packaging requires clarity on recycled plastic content and reuse obligations in light of hazardous material handling, chemical compatibility, leakage prevention, contamination control, and product stability requirements.',
      industryConcern: 'Agrochemical manufacturers, packaging suppliers, and compliance teams are facing interpretation risk during EPR reporting, procurement planning, and packaging sustainability decisions.',
      requestedClarifications: [
        'Whether recycled plastic usage is presently permitted in pesticide or agrochemical packaging.',
        'Specific packaging categories where virgin polymer usage is mandatory.',
        'Applicability of reuse obligations for Category-I rigid pesticide packaging.',
        'Existing statutory provisions, standards, guidelines, or registration conditions for packaging material specifications.',
        'Documentation requirements for claiming exemption under PWM Rules, 2026.',
        'Whether future technical evaluation mechanisms may be considered for controlled use of recycled polymers.'
      ].join('\n'),
      supportNote: 'We request CIBRC to issue suitable regulatory clarification to ensure uniform implementation and avoid interpretational ambiguity across stakeholders.'
    }
  ];

  return templates.map((template) => ({
    title: template.title,
    type: 'letterWorkspace',
    authorityCode: template.code,
    authorityShort: template.authorityShort,
    fields: [
      createProcessingField(`cpcbLetter.${template.authorityShort}.letterDate`, 'Letter Date', '', CalendarDays, 'date', [], 'manual'),
      createProcessingField(`cpcbLetter.${template.authorityShort}.referenceNo`, 'Reference No.', '', FileText, 'text', [], 'manual'),
      createProcessingField(`cpcbLetter.${template.authorityShort}.clientName`, 'Client / Industry Name', clientName, Building2, 'text', [], 'manual'),
      createProcessingField(`cpcbLetter.${template.authorityShort}.recipient`, 'To / Authority', template.recipient, UserRound, 'textarea', [], 'manual', 'annual-letter-wide'),
      createProcessingField(`cpcbLetter.${template.authorityShort}.subject`, 'Subject', template.subject, FileText, 'textarea', [], 'manual', 'annual-letter-wide'),
      createProcessingField(`cpcbLetter.${template.authorityShort}.representationNote`, 'Representation Note', buildRepresentationNote(template), Sparkles, 'textarea', [], 'manual', 'annual-letter-wide annual-letter-note-field'),
      createProcessingField(`cpcbLetter.${template.authorityShort}.signatory`, 'Signatory', 'For AnantTattva Private Limited', UserRound, 'text', [], 'manual'),
      createProcessingField(`cpcbLetter.${template.authorityShort}.finalLetterFile`, 'Final Letter Upload', '', Upload, 'file', [], 'manual')
    ]
  }));
}

function CpcbLetterWorkspace({ section, readValue, onChange, onSave, saving }) {
  const [downloadOpen, setDownloadOpen] = useState(false);
  const fields = (section.fields || []).map(normalizeProcessingField);
  const buildLegacyRepresentationNote = () => {
    const prefix = `cpcbLetter.${section.authorityShort}.`;
    return [
      readValue(`${prefix}background`, ''),
      readValue(`${prefix}regulatoryContext`, ''),
      readValue(`${prefix}industryConcern`, ''),
      readValue(`${prefix}requestedClarifications`, ''),
      readValue(`${prefix}supportNote`, '')
    ].map(getProcessingDisplayValue).filter(Boolean).join('\n\n');
  };
  const values = fields.reduce((next, field) => {
    const savedValue = readValue(field.key, '');
    const fallbackValue = field.label === 'Representation Note'
      ? (getProcessingDisplayValue(savedValue) || buildLegacyRepresentationNote() || field.value)
      : readValue(field.key, field.value);
    return { ...next, [field.key]: fallbackValue };
  }, {});
  const valueFor = (label) => {
    const field = fields.find((item) => item.label === label);
    return field ? getProcessingDisplayValue(values[field.key] || field.value) : '';
  };
  const noteLines = valueFor('Representation Note')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const letter = buildCpcbLetterDownloadData(section, valueFor, noteLines);

  function downloadLetter(format) {
    setDownloadOpen(false);
    if (format === 'word') downloadCpcbLetterWord(letter);
    else downloadCpcbLetterPdf(letter);
  }

  return (
    <div className="annual-letter-workspace">
      <div className="annual-letter-authority-bar">
        <span className="annual-letter-code">{section.authorityCode}</span>
        <div>
          <p>{section.authorityShort}</p>
          <strong>{valueFor('Subject') || 'CPCB representation letter'}</strong>
        </div>
      </div>
      <div className="annual-letter-grid">
        <div className="annual-letter-form">
          {fields.map((field) => {
            const displayValue = field.type === 'date' ? formatDateInputValue(values[field.key]) : getProcessingDisplayValue(values[field.key]);
            return (
              <label key={field.key} className={`annual-letter-field ${field.colSpan || ''}`}>
                <span className="annual-letter-label">{field.label}</span>
                <AnnualFieldControl
                  field={field}
                  value={values[field.key]}
                  displayValue={displayValue}
                  isAutoLocked={false}
                  onChange={(nextValue) => onChange(field.key, nextValue)}
                />
              </label>
            );
          })}
        </div>
        <aside className="annual-letter-preview">
          <div className="annual-letter-paper">
            <div className="annual-letter-paper-head">
              <span>{section.authorityCode}</span>
              <strong>Representation to {section.authorityShort}</strong>
            </div>
            <p><b>Date:</b> {valueFor('Letter Date') || '-'}</p>
            <p><b>Ref:</b> {valueFor('Reference No.') || '-'}</p>
            <p className="annual-letter-to"><b>To,</b><br />{valueFor('To / Authority')}</p>
            <p><b>Subject:</b> {valueFor('Subject')}</p>
            <p>Respected Sir/Madam,</p>
            {noteLines.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}
            <p>Thanking You,</p>
            <p><b>{valueFor('Signatory')}</b></p>
          </div>
        </aside>
      </div>
      <div className="annual-letter-final-actions">
        <button type="button" disabled={saving} onClick={onSave} className="annual-letter-save-button">
          <Save className="h-4 w-4" /> {saving ? 'Saving...' : 'Save'}
        </button>
        <div className="annual-letter-download">
          <button type="button" onClick={() => setDownloadOpen((current) => !current)} className="annual-letter-download-button" aria-expanded={downloadOpen}>
            <Download className="h-4 w-4" /> Download <ChevronDown className={`h-4 w-4 transition ${downloadOpen ? 'rotate-180' : ''}`} />
          </button>
          {downloadOpen && (
            <div className="annual-letter-download-menu">
              <button type="button" onClick={() => downloadLetter('pdf')}><FileText className="h-4 w-4" /> PDF</button>
              <button type="button" onClick={() => downloadLetter('word')}><FileCheck2 className="h-4 w-4" /> Word</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function buildCpcbLetterDownloadData(section, valueFor, noteLines) {
  const lines = [
    `Representation to ${section.authorityShort}`,
    '',
    `Date: ${valueFor('Letter Date') || '-'}`,
    `Ref: ${valueFor('Reference No.') || '-'}`,
    '',
    'To,',
    valueFor('To / Authority'),
    '',
    `Subject: ${valueFor('Subject')}`,
    '',
    'Respected Sir/Madam,',
    '',
    ...noteLines,
    '',
    'Thanking You,',
    valueFor('Signatory')
  ];

  return {
    authority: section.authorityShort,
    code: section.authorityCode,
    subject: valueFor('Subject') || 'CPCB representation letter',
    lines
  };
}

function downloadCpcbLetterWord(letter) {
  const body = letter.lines.map((line) => {
    if (!line) return '<p>&nbsp;</p>';
    if (line === `Representation to ${letter.authority}`) return `<h1>${escapeHtml(line)}</h1>`;
    return `<p>${escapeHtml(line)}</p>`;
  }).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(letter.subject)}</title><style>body{font-family:Arial,sans-serif;line-height:1.55;color:#111827;}h1{font-size:22px;}h2{font-size:16px;}p{margin:0 0 10px;}</style></head><body>${body}</body></html>`;
  downloadBlob(new Blob([html], { type: 'application/msword;charset=utf-8' }), `${buildLetterFileName(letter)}.doc`);
}

function downloadCpcbLetterPdf(letter) {
  const pdfBytes = buildSimplePdf(letter.lines, letter.subject);
  downloadBlob(new Blob([pdfBytes], { type: 'application/pdf' }), `${buildLetterFileName(letter)}.pdf`);
}

function buildSimplePdf(lines, title) {
  const pageWidth = 595;
  const pageHeight = 842;
  const marginX = 54;
  const topY = 790;
  const lineHeight = 15;
  const maxChars = 88;
  const wrappedLines = lines.flatMap((line) => wrapPdfLine(line, maxChars));
  const pages = [];
  for (let index = 0; index < wrappedLines.length; index += 46) {
    pages.push(wrappedLines.slice(index, index + 46));
  }
  const safePages = pages.length ? pages : [['']];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${safePages.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${safePages.length} >>`
  ];
  safePages.forEach((pageLines, pageIndex) => {
    const pageObjectNumber = 3 + pageIndex * 2;
    const contentObjectNumber = pageObjectNumber + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >> >> /Contents ${contentObjectNumber} 0 R >>`);
    const stream = pageLines.map((line, lineIndex) => {
      const y = topY - (lineIndex * lineHeight);
      const isHeading = lineIndex === 0 && pageIndex === 0;
      return `BT /${isHeading ? 'F2' : 'F1'} ${isHeading ? 15 : 10} Tf ${marginX} ${y} Td (${escapePdfText(line)}) Tj ET`;
    }).join('\n');
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  const header = `%PDF-1.4\n% ${escapePdfText(title).slice(0, 60)}\n`;
  let body = '';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(header.length + body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = header.length + body.length;
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\n`;
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(header + body + xref + trailer);
}

function wrapPdfLine(line = '', maxChars = 88) {
  const text = String(line || '');
  if (!text.trim()) return [''];
  const words = text.split(/\s+/);
  const wrapped = [];
  let current = '';
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      wrapped.push(current);
      current = word;
    } else {
      current = next;
    }
  });
  if (current) wrapped.push(current);
  return wrapped;
}

function escapePdfText(value) {
  return String(value || '').replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildLetterFileName(letter) {
  return `CPCB-Letter-${letter.authority}-${letter.code}`.replace(/[^a-z0-9-]+/gi, '-');
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function ProcessingSection({ section, sectionTabs = [], activeSectionTitle = '', onSelectSection, quotationContext, tone = 'white', readValue, onChange, fieldRenderer = 'overview', sectionStatuses = {}, reviewStage = '', completedSectionTitles = [], canReview = false, onReview, onSave, saving = false }) {
  const navigate = useNavigate();
  const quotationState = quotationContext ? { quotationContext } : {};
  const sectionTitle = activeSectionTitle || section.title || 'Data workspace';
  const totalFields = section.type === 'legacyData'
    ? (section.groups || []).reduce((count, group) => count + (group.fields?.length || 0), 0)
    : section.type === 'msmeTable' || section.type === 'interactionTable'
      ? (section.rows || []).length
      : (section.fields || []).length;

  return (
    <section className={`processing-section-card ${section.type === 'legacyData' ? 'processing-section-card-legacy' : ''}`}>
      <div className="processing-section-head">
        <div className="processing-section-title-wrap">
          <span className="processing-section-eyebrow">Annual return data</span>
          <h4 className="processing-section-title">{sectionTitle}</h4>
        </div>
        <span className="processing-section-count">{totalFields} fields</span>
      </div>
      <div className="processing-section-actions flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          {sectionTabs.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {sectionTabs.map((title) => {
                const active = title === activeSectionTitle;
                const showStatus = Object.keys(sectionStatuses || {}).length > 0;
                const sectionStatus = showStatus ? getAnnualSectionStatus({ sections: sectionStatuses }, title, reviewStage) : '';
                const statusTone = showStatus ? getAnnualSectionTone(sectionStatus) : '';
                const statusIcon = statusTone === 'approved'
                  ? <Check className="h-3.5 w-3.5" />
                  : statusTone === 'rejected'
                    ? <X className="h-3.5 w-3.5" />
                    : statusTone === 'pending'
                      ? <RefreshCw className="h-3.5 w-3.5" />
                      : null;
                const locallyComplete = completedSectionTitles.includes(title);
                return (
                <button
                  key={title}
                  type="button"
                  onClick={() => onSelectSection?.(title)}
                  className={`processing-hint-pill ${active ? 'processing-hint-pill-active' : ''} ${statusTone === 'approved' || locallyComplete ? 'processing-hint-pill-approved' : ''} ${statusTone === 'rejected' ? 'processing-hint-pill-rejected' : ''} ${statusTone === 'pending' ? 'processing-hint-pill-pending' : ''}`}
                >
                  {statusIcon || (locallyComplete ? <Check className="h-3.5 w-3.5" /> : null)}
                  {title}
                </button>
                );
              })}
            </div>
          )}
        </div>
        {(section.actions?.includes('quotation') || canReview) && (
          <div className="flex flex-wrap justify-end gap-2">
            {canReview && (
              <button type="button" onClick={onReview} className="btn-lift inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-xs font-black text-white">
                <ShieldCheck className="h-3.5 w-3.5" /> Review
              </button>
            )}
            {section.actions?.includes('quotation') && (
              <button type="button" onClick={() => navigate('/sales/quotations?mode=add', { state: quotationState })} className="btn-lift inline-flex h-9 items-center gap-2 rounded-lg bg-orange-600 px-4 text-xs font-black text-white">
                <Plus className="h-3.5 w-3.5" /> Add New Quotation
              </button>
            )}
          </div>
        )}
      </div>
      {section.type === 'legacyData' ? (
        <LegacyDataLayout groups={section.groups || []} readValue={readValue} onChange={onChange} />
      ) : section.type === 'msmeTable' ? (
        <AnnualMsmeTable
          rows={readValue(section.tableKey || section.title, section.rows || [])}
          onChange={(nextRows) => onChange(section.tableKey || section.title, nextRows)}
        />
      ) : section.type === 'interactionTable' ? (
        <ClientInteractionTable
          rawFiles={readValue(section.rawDataKey || `${section.tableKey}.rawDataUploads`, buildRawDataUploadState())}
          onRawFilesChange={(nextFiles) => onChange(section.rawDataKey || `${section.tableKey}.rawDataUploads`, nextFiles)}
          rows={readValue(section.tableKey || section.title, section.rows || [])}
          onChange={(nextRows) => onChange(section.tableKey || section.title, nextRows)}
        />
      ) : section.type === 'letterWorkspace' ? (
        <CpcbLetterWorkspace
          section={section}
          readValue={readValue}
          onChange={onChange}
          onSave={onSave}
          saving={saving}
        />
      ) : section.type === 'compliancePoDetails' ? (
        <div className="annual-compliance-po-workspace">
          <ProcessingTable
            title={section.title}
            fields={section.fields || []}
            readValue={readValue}
            onChange={onChange}
            renderer={fieldRenderer}
          />
        </div>
      ) : isConsentDetailsSection(section.fields || []) ? (
        <ConsentDetailsTable
          fields={section.fields || []}
          readValue={readValue}
          onChange={onChange}
        />
      ) : (
        <ProcessingTable
          title={section.title}
          fields={section.fields || []}
          readValue={readValue}
          onChange={onChange}
          renderer={fieldRenderer}
        />
      )}
    </section>
  );
}

function isConsentDetailsSection(fields = []) {
  const labels = fields.map((field) => normalizeProcessingField(field).label);
  return labels.includes('Water Application Number') && labels.includes('Air Application Number');
}

function createAnnualPoYearRow(defaultFy = '') {
  return {
    fy: defaultFy,
    annualReturnYear: defaultFy,
    quotationNo: '',
    compliancePoDate: '',
    compliancePoFile: '',
    serviceCategory: [],
    value: ''
  };
}

function normalizeAnnualPoYearRows(rows = [], count = 0, defaultFy = '') {
  const safeCount = Math.max(0, Number(count) || 0);
  return Array.from({ length: safeCount }, (_, index) => ({
    ...createAnnualPoYearRow(defaultFy),
    ...(Array.isArray(rows) ? rows[index] || {} : {})
  }));
}

function AnnualPoYearTable({ config = {}, readValue, onChange }) {
  const [openServiceRow, setOpenServiceRow] = useState(null);
  const countKey = config.countKey || 'financials.poYearCount';
  const rowsKey = config.rowsKey || 'financials.poYearRows';
  const serviceOptions = Array.isArray(config.serviceCategoryOptions) ? config.serviceCategoryOptions : [];
  const savedRows = readValue(rowsKey, []);
  const proformaRows = Array.isArray(config.proformaInvoice?.poYearRows) ? config.proformaInvoice.poYearRows : [];
  const sourceRows = Array.isArray(savedRows) && savedRows.length ? savedRows : proformaRows;
  const savedCount = readValue(countKey, sourceRows.length);
  const rowCount = Math.max(0, Number(savedCount) || 0);
  const rows = normalizeAnnualPoYearRows(sourceRows, rowCount, config.defaultFy || '').map((row) => ({
    ...row,
    annualReturnYear: row.annualReturnYear || config.annualReturnYear || config.defaultFy || '',
    quotationNo: config.quotationNo || (String(row.quotationNo || '').startsWith('ATPL-QTN-') ? '' : row.quotationNo || ''),
    serviceCategory: Array.isArray(row.serviceCategory)
      ? row.serviceCategory
      : String(row.serviceCategory || '').split(',').map((item) => item.trim()).filter(Boolean)
  }));

  const invoiceServices = [...new Set((config.proformaInvoice?.items || []).map((item) => String(item.serviceCategory || '').trim()).filter(Boolean))];
  rows.forEach((row) => { if (!row.serviceCategory.length && invoiceServices.length) row.serviceCategory = invoiceServices; });

  function updateCount(nextValue) {
    const nextCount = Math.max(0, Math.min(50, Number(nextValue) || 0));
    onChange(countKey, nextCount);
    onChange(rowsKey, normalizeAnnualPoYearRows(sourceRows, nextCount, config.defaultFy || ''));
  }

  function updateRow(rowIndex, field, value) {
    onChange(rowsKey, rows.map((row, index) => (index === rowIndex ? { ...row, [field]: value } : row)));
  }

  function toggleServiceCategory(rowIndex, option) {
    const current = rows[rowIndex]?.serviceCategory || [];
    const next = current.includes(option)
      ? current.filter((item) => item !== option)
      : [...current, option];
    updateRow(rowIndex, 'serviceCategory', next);
  }

  function toggleServiceMenu(rowIndex) {
    if (openServiceRow === rowIndex) {
      setOpenServiceRow(null);
      return;
    }
    setOpenServiceRow(rowIndex);
  }

  async function updateFile(rowIndex, fileList) {
    const file = fileList?.[0];
    if (!file) return;
    const uploaded = await uploadMedia(file, 'crm/client-master/compliance-po');
    updateRow(rowIndex, 'compliancePoFile', uploaded);
  }

  return (
    <div className="annual-po-year-card">
      <div className="annual-po-year-head">
        <div>
          <span>Compliance PO Mapping</span>
          <h4>Mention No. of Year PO</h4>
          <p>Annual Return: {config.annualReturnYear || config.defaultFy || 'Not selected'}</p>
        </div>
        <label className="annual-po-year-count">
          <span>No. of year PO</span>
          <input
            type="number"
            min="0"
            max="50"
            value={rowCount || ''}
            placeholder="0"
            onChange={(event) => updateCount(event.target.value)}
          />
        </label>
      </div>

      {rowCount > 0 ? (
        <div className="annual-po-year-table-wrap">
          <table className="annual-po-year-table">
            <thead>
              <tr>
                <th>#</th>
                <th>F.Y</th>
                <th>Annual Return</th>
                <th>Quotation No.</th>
                <th>Compliance PO Date</th>
                <th>Upload Compliance PO</th>
                <th>Service Category</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td>
                    <input
                      value={row.fy || ''}
                      placeholder={config.defaultFy || '2024-25'}
                      onChange={(event) => updateRow(index, 'fy', event.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      value={row.annualReturnYear || ''}
                      placeholder="Annual Return Year"
                      onChange={(event) => updateRow(index, 'annualReturnYear', event.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      value={row.quotationNo || ''}
                      placeholder="Quotation No."
                      onChange={(event) => updateRow(index, 'quotationNo', event.target.value)}
                    />
                  </td>
                  <td>
                    <PremiumDatePicker value={row.compliancePoDate || ''} onChange={(event) => updateRow(index, 'compliancePoDate', event.target.value)} />
                  </td>
                  <td>
                    <label className="annual-po-upload-cell">
                      <Upload className="h-4 w-4" />
                      <span>{row.compliancePoFile?.name || row.compliancePoFile || 'Upload PO'}</span>
                      <input
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.gif"
                        onChange={(event) => updateFile(index, event.target.files)}
                      />
                    </label>
                  </td>
                  <td>
                    <div className="annual-po-multi-select">
                      <button type="button" onClick={() => toggleServiceMenu(index)}>
                        <span>{(row.serviceCategory || []).length ? `${(row.serviceCategory || []).length} selected` : 'Select service category'}</span>
                        <ChevronDown className="h-4 w-4" />
                      </button>
                      {openServiceRow === index && (
                        <div className="annual-po-multi-menu">
                          {serviceOptions.map((option) => {
                            const checked = (row.serviceCategory || []).includes(option);
                            return (
                              <label key={option}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleServiceCategory(index, option)}
                                />
                                <span>{option}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <small className="annual-po-selected-count">{(row.serviceCategory || []).join(', ') || 'No service selected'}</small>
                  </td>
                  <td>
                    <input
                      type="number"
                      value={row.value || ''}
                      placeholder="0"
                      onChange={(event) => updateRow(index, 'value', event.target.value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="annual-po-year-empty">
          Enter number of year PO to create the F.Y wise PO table.
        </div>
      )}
    </div>
  );
}

function ConsentDetailsTable({ fields = [], readValue, onChange }) {
  const normalizedFields = fields.map(normalizeProcessingField);
  const findField = (label) => normalizedFields.find((field) => field.label === label);
  const stateField = findField('State');
  const rowsKey = stateField?.key ? `${stateField.key.split('.').slice(0, -1).join('.')}.consentRows` : 'consentRows';
  const extraRows = Array.isArray(readValue(rowsKey, [])) ? readValue(rowsKey, []) : [];
  const rowSlots = [
    { name: 'state', field: stateField, className: 'consent-state-cell' },
    { name: 'waterApplicationNumber', field: findField('Water Application Number') },
    { name: 'waterConsentValidity', field: findField('Water Validity of Consent') },
    { name: 'waterConsentDocument', field: findField('Water Consent Documents'), className: 'consent-document-cell' },
    { name: 'airApplicationNumber', field: findField('Air Application Number') },
    { name: 'airConsentValidity', field: findField('Air Validity of Consent') },
    { name: 'airConsentDocument', field: findField('Air Consent Documents'), className: 'consent-document-cell' }
  ];

  function addConsentRow() {
    const stateValue = stateField ? readValue(stateField.key, stateField.value) : '';
    onChange(rowsKey, [
      ...extraRows,
      {
        state: getProcessingDisplayValue(stateValue),
        waterApplicationNumber: '',
        waterConsentValidity: '',
        waterConsentDocument: '',
        airApplicationNumber: '',
        airConsentValidity: '',
        airConsentDocument: ''
      }
    ]);
  }

  function updateExtraRow(rowIndex, fieldName, nextValue) {
    const extraIndex = rowIndex - 1;
    onChange(rowsKey, extraRows.map((row, index) => (
      index === extraIndex ? { ...row, [fieldName]: nextValue } : row
    )));
  }

  function removeConsentRow(rowIndex) {
    const extraIndex = rowIndex - 1;
    if (extraIndex < 0) return;
    onChange(rowsKey, extraRows.filter((_, index) => index !== extraIndex));
  }

  function renderControl(slot, rowIndex) {
    const field = slot.field;
    if (!field) return <span className="annual-table-muted">-</span>;
    const extraRow = rowIndex > 0 ? (extraRows[rowIndex - 1] || {}) : null;
    const draftValue = extraRow ? (extraRow[slot.name] ?? '') : readValue(field.key, field.value);
    const hasUserValue = extraRow ? true : annualValueWasEdited(draftValue, field.value);
    const displayValue = field.type === 'date' ? formatDateInputValue(draftValue) : getProcessingDisplayValue(draftValue);
    const isFilled = Boolean(getProcessingDisplayValue(draftValue).trim());
    const isAutoLocked = !extraRow && field.source !== 'manual' && !hasUserValue && isFilled && field.type !== 'file';

    return (
      <AnnualFieldControl
        field={field}
        value={draftValue}
        displayValue={displayValue}
        isAutoLocked={isAutoLocked}
        onChange={(nextValue) => (extraRow ? updateExtraRow(rowIndex, slot.name, nextValue) : onChange(field.key, nextValue))}
      />
    );
  }

  return (
    <div className="consent-details-table-shell">
      <div className="consent-details-table-toolbar">
        <span>{extraRows.length + 1} row{extraRows.length ? 's' : ''}</span>
        <button type="button" onClick={addConsentRow} className="consent-add-row-button">
          <Plus className="h-4 w-4" /> Add Row
        </button>
      </div>
      <div className="consent-details-table-wrap">
        <table className="consent-details-table">
          <colgroup>
            <col className="consent-col-state" />
            <col className="consent-col-application" />
            <col className="consent-col-validity" />
            <col className="consent-col-document" />
            <col className="consent-col-application" />
            <col className="consent-col-validity" />
            <col className="consent-col-document" />
            <col className="consent-col-action" />
          </colgroup>
          <thead>
            <tr className="consent-act-row">
              <th rowSpan={2} className="consent-state-head">State</th>
              <th colSpan={3}>Water (Act)</th>
              <th colSpan={3}>Air (Act)</th>
              <th rowSpan={2} className="consent-action-head">Action</th>
            </tr>
            <tr className="consent-label-row">
              <th>Application Number</th>
              <th>Validity of Consent</th>
              <th>Water Consent Documents</th>
              <th>Application Number</th>
              <th>Validity of Consent</th>
              <th>Air Consent Documents</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: extraRows.length + 1 }, (_, rowIndex) => (
              <tr key={rowIndex}>
                {rowSlots.map((slot) => (
                  <td key={`${rowIndex}-${slot.name}`} className={slot.className || ''}>
                    {renderControl(slot, rowIndex)}
                  </td>
                ))}
                <td className="consent-action-cell">
                  {rowIndex > 0 ? (
                    <button type="button" onClick={() => removeConsentRow(rowIndex)} className="consent-remove-row-button">
                      <Trash2 className="h-4 w-4" /> Remove
                    </button>
                  ) : (
                    <span className="consent-base-row-label">Base row</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LegacyDataLayout({ groups = [], readValue, onChange }) {
  const totalFields = groups.reduce((count, group) => count + (group.fields?.length || 0), 0);
  const completedFields = groups.reduce((count, group) => count + (group.fields || []).filter((rawField) => {
    const field = normalizeProcessingField(rawField);
    return Boolean(getProcessingDisplayValue(readValue(field.key, field.value)).trim());
  }).length, 0);

  return (
    <div className="legacy-data-sheet">
      <div className="legacy-data-overview">
        <div>
          <p className="legacy-data-kicker">Client data</p>
          <h5>Data review workspace</h5>
        </div>
        <div className="legacy-data-stats">
          <span><strong>{groups.length}</strong> groups</span>
          <span><strong>{completedFields}</strong>/{totalFields} filled</span>
        </div>
      </div>
      {groups.map((group) => (
        <div key={group.title} className={`legacy-data-row ${group.type === 'plasticConsumptionTable' ? 'legacy-data-row-table' : ''} ${group.tone === 'green' ? 'legacy-data-row-green' : ''} ${group.tone === 'dark' ? 'legacy-data-row-dark' : ''}`}>
          <div className="legacy-data-group">
            <span className="legacy-data-group-mark">{(group.title || 'D').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('')}</span>
            <span className="legacy-data-group-title">{group.title}</span>
            <span className="legacy-data-group-count">{group.type === 'plasticConsumptionTable' ? 'table' : `${group.fields?.length || 0} fields`}</span>
          </div>
          {group.type === 'plasticConsumptionTable' ? (
            <PlasticConsumptionTable
              rows={readValue(group.tableKey || group.title, group.rows || [])}
              onChange={(nextRows) => onChange(group.tableKey || group.title, nextRows)}
            />
          ) : (
            <ProcessingTable
              title={group.title}
              fields={group.fields || []}
              readValue={readValue}
              onChange={onChange}
              compact
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ProcessingTable({ title, fields = [], readValue, onChange, compact = false, renderer = 'overview' }) {
  const normalizedFields = fields.map(normalizeProcessingField);

  if (renderer === 'table') {
    return (
      <div className={`annual-financial-table-wrap ${compact ? 'annual-financial-table-wrap-compact' : ''}`}>
        <table className="annual-financial-table">
          <thead>
            <tr>
              <th className="annual-financial-index">#</th>
              <th>Financial Detail</th>
              <th>Value / Upload</th>
            </tr>
          </thead>
          <tbody>
            {normalizedFields.map((field, index) => {
              const draftValue = readValue(field.key, field.value);
              const hasUserValue = annualValueWasEdited(draftValue, field.value);
              return (
                <FinancialTableRow
                  key={`${title}-${field.key}`}
                  index={index}
                  field={field}
                  value={draftValue}
                  source={field.source === 'manual' || hasUserValue ? 'Manual' : ''}
                  onChange={(nextValue) => onChange(field.key, nextValue)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className={`annual-overview-fields ${compact ? 'annual-overview-fields-compact' : ''}`}>
      {normalizedFields.map((field, index) => {
        const draftValue = readValue(field.key, field.value);
        const hasUserValue = annualValueWasEdited(draftValue, field.value);
        return (
          <ProcessingOverviewField
            key={`${title}-${field.key}`}
            index={index}
            field={field}
            value={draftValue}
            source={field.source === 'manual' || hasUserValue ? 'Manual' : ''}
            onChange={(nextValue) => onChange(field.key, nextValue)}
          />
        );
      })}
    </div>
  );
}

function FinancialTableRow({ index, field, value, source, onChange }) {
  const Icon = field.icon;
  const displayValue = field.type === 'date' ? formatDateInputValue(value) : getProcessingDisplayValue(value);
  const isFilled = Boolean(getProcessingDisplayValue(value).trim());
  const isAutoLocked = source !== 'Manual' && isFilled && field.type !== 'file';

  return (
    <tr className={isFilled ? 'annual-financial-row-filled' : ''}>
      <td className="annual-financial-row-index">{index + 1}</td>
      <td>
        <div className="annual-financial-field">
          {Icon && <span className="annual-financial-field-icon"><Icon className="h-4 w-4" /></span>}
          <span className="annual-financial-field-copy">
            <span className="annual-financial-field-label">{field.label}</span>
            {source && <span className="annual-financial-field-meta">{source}</span>}
          </span>
        </div>
      </td>
      <td>
        <div className="annual-financial-control">
          <AnnualFieldControl
            field={field}
            value={value}
            displayValue={displayValue}
            isAutoLocked={isAutoLocked}
            onChange={onChange}
          />
        </div>
      </td>
    </tr>
  );
}

function ProcessingOverviewField({ index, field, value, source, onChange }) {
  const Icon = field.icon;
  const displayValue = field.type === 'date' ? formatDateInputValue(value) : getProcessingDisplayValue(value);
  const isFilled = Boolean(getProcessingDisplayValue(value).trim());
  const isAutoLocked = source !== 'Manual' && isFilled && field.type !== 'file';
  const isWideRow = field.type === 'textarea' || field.colSpan;

  return (
    <div className={`annual-overview-field ${isFilled ? 'annual-overview-field-filled' : ''} ${isWideRow ? 'annual-overview-field-wide' : ''}`}>
      <span className="annual-overview-index">{index + 1}</span>
      <div className="annual-overview-name">
        {Icon && <span className="annual-overview-icon"><Icon className="h-4 w-4" /></span>}
        <span className="annual-overview-copy">
          <span className="annual-overview-label">{field.label}</span>
          {source && <span className="annual-data-field-meta">{source}</span>}
        </span>
      </div>
      <div className="annual-overview-control">
        <AnnualFieldControl
          field={field}
          value={value}
          displayValue={displayValue}
          isAutoLocked={isAutoLocked}
          onChange={onChange}
        />
      </div>
    </div>
  );
}

function ProcessingTableRow({ index, field, value, source, onChange }) {
  const Icon = field.icon;
  const displayValue = field.type === 'date' ? formatDateInputValue(value) : getProcessingDisplayValue(value);
  const isFilled = Boolean(getProcessingDisplayValue(value).trim());
  const isAutoLocked = source !== 'Manual' && isFilled && field.type !== 'file';
  const isWideRow = field.type === 'textarea' || field.colSpan;

  return (
    <tr className={`${isFilled ? 'annual-data-row-filled' : ''} ${isWideRow ? 'annual-data-row-wide' : ''}`}>
      <td className="annual-data-table-index">{index + 1}</td>
      <td>
        <div className="annual-data-field-name">
          {Icon && <span className="annual-data-field-icon"><Icon className="h-4 w-4" /></span>}
          <span className="annual-data-field-copy">
            <span className="annual-data-field-label">{field.label}</span>
            {source && <span className="annual-data-field-meta">{source}</span>}
          </span>
        </div>
      </td>
      <td>
        <AnnualFieldControl
          field={field}
          value={value}
          displayValue={displayValue}
          isAutoLocked={isAutoLocked}
          onChange={onChange}
        />
      </td>
    </tr>
  );
}

function AnnualFieldControl({ field, value, displayValue, isAutoLocked, onChange }) {
  const fileInputRef = useRef(null);
  const fileUrl = getProcessingFileUrl(value);
  const isUrl = fileUrl && (fileUrl.startsWith('http') || fileUrl.startsWith('data:') || fileUrl.includes('/'));

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    onChange(await uploadMedia(file, 'crm/annual-return/documents'));
  }

  if (field.type === 'select') {
    return (
      <select value={displayValue} onChange={(event) => onChange(event.target.value)} disabled={isAutoLocked} className="annual-table-input">
        <option value="">Select</option>
        {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }

  if (field.type === 'textarea') {
    return (
      <textarea value={displayValue} onChange={(event) => onChange(event.target.value)} readOnly={isAutoLocked} rows={2} className="annual-table-input annual-table-textarea" />
    );
  }

  if (field.type === 'file') {
    return (
      <div className="annual-table-file annual-table-file-modern">
        <label className="annual-file-picker">
          <input ref={fileInputRef} type="file" onChange={handleFileChange} className="annual-table-file-input" />
          <span className="annual-file-picker-icon"><Upload className="h-4 w-4" /></span>
          <span className="annual-file-picker-copy">
            <span>Upload document</span>
            <small>PDF, PNG, JPG or GIF</small>
          </span>
        </label>
        <button type="button" onClick={() => fileInputRef.current?.click()} className="annual-file-add-button">Add</button>
        {displayValue ? (
          isUrl ? <a href={fileUrl.startsWith('data:') ? fileUrl : normalizeDocumentUrl(fileUrl)} target="_blank" rel="noreferrer">View uploaded file</a>
            : <span>{displayValue}</span>
        ) : <span className="annual-table-muted">No file selected</span>}
      </div>
    );
  }

  return (
    <input type={field.type} value={displayValue} onChange={(event) => onChange(event.target.value)} readOnly={isAutoLocked} className="annual-table-input" />
  );
}

function LegacyDataField({ field, value, source, onChange }) {
  const displayValue = field.type === 'date' ? formatDateInputValue(value) : getProcessingDisplayValue(value);
  const fileUrl = getProcessingFileUrl(value);
  const isUrl = fileUrl && (fileUrl.startsWith('http') || fileUrl.startsWith('data:') || fileUrl.includes('/'));
  const Icon = field.icon;
  const isFilled = Boolean(getProcessingDisplayValue(value).trim());
  const isAutoLocked = source !== 'Manual' && isFilled && field.type !== 'file';

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    onChange(await uploadMedia(file, 'crm/annual-return/documents'));
  }

  return (
    <label className={`legacy-data-field ${field.colSpan || ''} ${isFilled ? 'legacy-data-field-filled' : ''}`}>
      <span className="legacy-data-field-head">
        {Icon && <span className="legacy-data-icon"><Icon className="h-3.5 w-3.5" /></span>}
        <span className="legacy-data-label">{field.label}</span>
      </span>
      <span className="legacy-data-control">
        {field.type === 'select' ? (
          <select value={displayValue} onChange={(event) => onChange(event.target.value)} disabled={isAutoLocked} className="legacy-data-input">
            <option value="">Select</option>
            {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        ) : field.type === 'textarea' ? (
          <textarea value={displayValue} onChange={(event) => onChange(event.target.value)} readOnly={isAutoLocked} rows={2} className="legacy-data-input legacy-data-textarea" />
        ) : field.type === 'file' ? (
          <span className="legacy-file-wrap">
            <input type="file" onChange={handleFileChange} className="legacy-file-input" />
            {displayValue ? (
              isUrl ? <a href={fileUrl.startsWith('data:') ? fileUrl : normalizeDocumentUrl(fileUrl)} target="_blank" rel="noreferrer">View uploaded file</a>
                : <span>{displayValue}</span>
            ) : null}
          </span>
        ) : (
          <input type={field.type} value={displayValue} onChange={(event) => onChange(event.target.value)} readOnly={isAutoLocked} className="legacy-data-input" />
        )}
      </span>
    </label>
  );
}

function annualValueWasEdited(value, fallback) {
  if (value === undefined || value === null || value === '') return false;
  return getProcessingDisplayValue(value) !== getProcessingDisplayValue(fallback || '');
}

function isYesAnswer(value) {
  const normalized = String(getProcessingDisplayValue(value) || '').trim().toLowerCase();
  return normalized === 'yes' || normalized === 'y' || normalized === 'true';
}

function AnnualMsmeTable({ rows, onChange }) {
  const safeRows = Array.isArray(rows) && rows.length ? rows : [createAnnualMsmeRow()];

  function updateRow(index, field, value) {
    onChange(safeRows.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  }

  function addRow() {
    onChange([...safeRows, createAnnualMsmeRow()]);
  }

  function removeRow(index) {
    const nextRows = safeRows.filter((_, rowIndex) => rowIndex !== index);
    onChange(nextRows.length ? nextRows : [createAnnualMsmeRow()]);
  }

  return (
    <div className="mt-5">
      <button type="button" onClick={addRow} className="btn-lift inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-700 px-4 font-black text-white shadow-lg shadow-emerald-700/20">
        <Plus className="h-4 w-4" /> Add Row
      </button>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[1180px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-[0.08em] text-slate-500">
            <tr>
              <th className="w-20 px-4 py-4">Sr.No</th>
              <th className="px-4 py-4">MSME Classification Year *</th>
              <th className="px-4 py-4">MSME Status *</th>
              <th className="px-4 py-4">MSME Major Activity *</th>
              <th className="px-4 py-4">MSME Udyam Number *</th>
              <th className="px-4 py-4">TurnOver of the Company (CR.) *</th>
              <th className="px-4 py-4">MSME Udyam Certificate</th>
              <th className="w-28 px-4 py-4 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {safeRows.map((row, index) => (
              <tr key={index} className="border-t border-slate-100 align-middle">
                <td className="px-4 py-4 font-black text-slate-950">{index + 1}</td>
                <td className="px-4 py-4">
                  <input className="form-input min-h-10" value={row.classificationYear || ''} onChange={(event) => updateRow(index, 'classificationYear', event.target.value)} />
                </td>
                <td className="px-4 py-4">
                  <select className="form-input min-h-10" value={row.status || ''} onChange={(event) => updateRow(index, 'status', event.target.value)}>
                    <option value="">Select</option>
                    {selectOptions.msmeStatus.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </td>
                <td className="px-4 py-4">
                  <select className="form-input min-h-10" value={row.majorActivity || ''} onChange={(event) => updateRow(index, 'majorActivity', event.target.value)}>
                    <option value="">Select</option>
                    {selectOptions.msmeActivity.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </td>
                <td className="px-4 py-4">
                  <input className="form-input min-h-10" value={row.udyamNumber || row.value || ''} onChange={(event) => updateRow(index, 'udyamNumber', event.target.value)} />
                </td>
                <td className="px-4 py-4">
                  <input type="number" className="form-input min-h-10" value={row.turnover || ''} onChange={(event) => updateRow(index, 'turnover', event.target.value)} />
                </td>
                <td className="px-4 py-4">
                  <UploadButton value={row.file} onChange={(value) => updateRow(index, 'file', value)} />
                </td>
                <td className="px-4 py-4 text-center">
                  <button type="button" onClick={() => removeRow(index)} className="rounded-lg border border-red-200 px-3 py-2 font-black text-red-600 hover:bg-red-50">Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlasticConsumptionTable({ rows, onChange }) {
  const safeRows = Array.isArray(rows) && rows.length ? rows : buildPlasticConsumptionRows();
  const columns = [
    ['year', 'YEAR'],
    ['rigidPlastic', 'Rigid Plastic (CAT I)'],
    ['flexiblePlastic', 'Flexible Plastic (CAT II)'],
    ['mlp', 'MLP (CAT III)'],
    ['compostablePlastic', 'Compostable Plastic (CAT IV)']
  ];

  function updateCell(index, field, value) {
    onChange(safeRows.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  }

  return (
    <div className="legacy-data-fields legacy-table-wrap">
      <div className="annual-table-panel annual-table-panel-pc">
        <div className="annual-table-panel-head">
          <div>
            <span className="annual-table-kicker">PC</span>
            <h4>Plastic Consumption</h4>
          </div>
          <span className="annual-table-meta">{safeRows.length} year rows</span>
        </div>
        <div className="plastic-consumption-table">
          <table>
            <thead>
              <tr>
                {columns.map(([, label]) => <th key={label}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {safeRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {columns.map(([field]) => (
                    <td key={field}>
                      <input
                        value={row[field] || ''}
                        onChange={(event) => updateCell(rowIndex, field, event.target.value)}
                        aria-label={columns.find(([key]) => key === field)?.[1]}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ClientInteractionTable({ rawFiles, onRawFilesChange, rows, onChange }) {
  const safeRows = Array.isArray(rows) && rows.length ? rows : buildClientInteractionRows();
  const safeRawFiles = normalizeRawDataUploadState(rawFiles);
  const [editingIndex, setEditingIndex] = useState(null);
  const [momReadOnly, setMomReadOnly] = useState(false);
  const [form, setForm] = useState(createClientInteractionRow());
  const editingOpen = editingIndex !== null;

  function updateRawFile(field, value) {
    onRawFilesChange({ ...safeRawFiles, [field]: value });
  }

  function updateRow(index, field, value) {
    onChange(safeRows.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  }

  function addRow() {
    onChange([...safeRows, createClientInteractionRow()]);
  }

  function removeRow(index) {
    const nextRows = safeRows.filter((_, rowIndex) => rowIndex !== index);
    onChange(nextRows.length ? nextRows : [createClientInteractionRow()]);
  }

  async function handleMailUpload(index, event) {
    const file = event.target.files?.[0];
    if (!file) return;
    updateRow(index, 'attachedMail', await uploadMedia(file, 'crm/annual-return/client-interactions'));
  }

  function openMom(index, readOnly = false) {
    setEditingIndex(index);
    setMomReadOnly(readOnly);
    setForm(normalizeClientInteractionRow(safeRows[index]));
  }

  function closeMom() {
    setEditingIndex(null);
    setMomReadOnly(false);
    setForm(createClientInteractionRow());
  }

  function updateDetail(index, value) {
    const details = getMomDetails(form).map((detail, detailIndex) => (detailIndex === index ? value : detail));
    setForm((current) => ({ ...current, momDetails: details }));
  }

  function addDetail() {
    setForm((current) => ({ ...current, momDetails: [...getMomDetails(current), ''] }));
  }

  function removeDetail(index) {
    const details = getMomDetails(form).filter((_, detailIndex) => detailIndex !== index);
    setForm((current) => ({ ...current, momDetails: details.length ? details : [''] }));
  }

  function saveMom() {
    const nextRows = safeRows.map((row, rowIndex) => (
      rowIndex === editingIndex ? { ...row, ...form, momDetails: getMomDetails(form) } : row
    ));
    onChange(nextRows);
    closeMom();
  }

  return (
    <div className="part-c-workspace">
      <div className="raw-upload-grid">
        <RawDataUploadCard
          label="Upload Sales Raw Data"
          value={safeRawFiles.salesRawData}
          onChange={(value) => updateRawFile('salesRawData', value)}
        />
        <RawDataUploadCard
          label="Upload Purchase Raw Data"
          value={safeRawFiles.purchaseRawData}
          onChange={(value) => updateRawFile('purchaseRawData', value)}
        />
        <RawDataUploadCard
          label="Upload Pre - Post Raw Data"
          value={safeRawFiles.prePostRawData}
          onChange={(value) => updateRawFile('prePostRawData', value)}
        />
      </div>
      <div className="annual-table-panel">
        <div className="annual-table-panel-head">
          <div>
            <span className="annual-table-kicker">Part C</span>
            <h4>Client Interaction</h4>
          </div>
          <button type="button" onClick={addRow} className="annual-add-row"><Plus className="h-4 w-4" /> Add Row</button>
        </div>
      <div className="client-interaction-table">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Client Interaction</th>
              <th>Minutes of Meeting</th>
              <th>Attached Mail</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {safeRows.map((row, index) => {
              const normalized = normalizeClientInteractionRow(row);
              return (
                <tr key={index}>
                  <td>
                      <PremiumDatePicker value={formatDateInputValue(normalized.date)} aria-label="Client interaction date" onChange={(event) => updateRow(index, 'date', event.target.value)} />
                  </td>
                  <td>
                      <input
                        value={normalized.clientInteraction}
                        aria-label="Client interaction"
                        onChange={(event) => updateRow(index, 'clientInteraction', event.target.value)}
                      />
                  </td>
                  <td>
                    <button type="button" onClick={() => openMom(index)} className="mom-add-button">ADD</button>
                    <button type="button" onClick={() => openMom(index, true)} className="mom-view-button">View Form</button>
                  </td>
                  <td>
                    <label className="mail-upload-button" title={getProcessingDisplayValue(normalized.attachedMail) || 'Upload mail'}>
                      <Upload className="h-5 w-5" />
                      <input type="file" className="sr-only" onChange={(event) => handleMailUpload(index, event)} />
                    </label>
                  </td>
                  <td>
                    <button type="button" onClick={() => removeRow(index)} className="annual-remove-row">Remove</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>

      {editingOpen && (
        <div className="mom-modal-backdrop">
          <div className="mom-modal" role="dialog" aria-modal="true" aria-label="Minutes of Meeting">
            <div className="mom-modal-head">
              <h3>{momReadOnly ? 'View Minutes of Meeting' : 'Minutes of Meeting'}</h3>
              <button type="button" onClick={closeMom} aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <div className="mom-modal-grid">
              <label>
                <span>Date</span>
                <PremiumDatePicker value={formatDateInputValue(form.date)} readOnly={momReadOnly} disabled={momReadOnly} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} />
              </label>
              <label>
                <span>Subject</span>
                <input value={form.subject || ''} readOnly={momReadOnly} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} />
              </label>
            </div>
            <div className="mom-details">
              <span className="mom-details-title">Minutes of Meeting Details</span>
              {getMomDetails(form).map((detail, index) => (
                <div key={index} className="mom-detail-row">
                  <strong>{index + 1}.</strong>
                  <input value={detail} readOnly={momReadOnly} onChange={(event) => updateDetail(index, event.target.value)} placeholder="Enter term or condition" />
                  {!momReadOnly && <button type="button" onClick={() => removeDetail(index)}><X className="h-4 w-4" /> Remove</button>}
                </div>
              ))}
              {!momReadOnly && <button type="button" onClick={addDetail} className="mom-add-detail"><Plus className="h-4 w-4" /> Add</button>}
            </div>
            <div className="mom-modal-actions">
              <button type="button" onClick={closeMom}>{momReadOnly ? 'Close' : 'Cancel'}</button>
              {!momReadOnly && <button type="button" onClick={saveMom}>Save</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RawDataUploadCard({ label, value, onChange }) {
  const displayValue = getProcessingDisplayValue(value);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    onChange(await uploadMedia(file, 'crm/annual-return/raw-data'));
  }

  function viewFile() {
    const fileUrl = getProcessingFileUrl(value);
    if (!fileUrl) return;
    window.open(fileUrl.startsWith('data:') ? fileUrl : normalizeDocumentUrl(fileUrl), '_blank', 'noopener,noreferrer');
  }

  return (
    <div className={`raw-upload-card ${displayValue ? 'raw-upload-card-filled' : ''}`}>
      <label>
        <Upload className="h-5 w-5" />
        <span>{label}: User Will Upload</span>
        <input type="file" className="sr-only" onChange={handleFile} />
      </label>
      {displayValue && (
        <div className="raw-upload-file">
          <span>{displayValue}</span>
          <button type="button" onClick={viewFile}>View</button>
        </div>
      )}
    </div>
  );
}

function createAnnualMsmeRow() {
  return { classificationYear: '', status: '', majorActivity: '', udyamNumber: '', turnover: '', file: '' };
}

function createPlasticConsumptionRow(year = '') {
  return { year, rigidPlastic: '', flexiblePlastic: '', mlp: '', compostablePlastic: '' };
}

function buildPlasticConsumptionRows(annualReturn = {}, selectedYear = '') {
  const savedRows = annualReturn?.plasticConsumptionRows || annualReturn?.totalPlasticConsumed;
  if (Array.isArray(savedRows) && savedRows.length) return savedRows.map(normalizePlasticConsumptionRow);
  if (savedRows && typeof savedRows === 'object') return [normalizePlasticConsumptionRow(savedRows)];
  const [startYear] = String(selectedYear || '').split('-');
  const start = Number(startYear);
  if (Number.isFinite(start)) {
    return [createPlasticConsumptionRow(`${start - 1}-${start}`), createPlasticConsumptionRow(`${start}-${start + 1}`)];
  }
  return [createPlasticConsumptionRow('2023-2024'), createPlasticConsumptionRow('2024-2025')];
}

function normalizePlasticConsumptionRow(row = {}) {
  return {
    year: row.year || row.YEAR || '',
    rigidPlastic: row.rigidPlastic || row.rigid || row.cat1 || row.catI || '',
    flexiblePlastic: row.flexiblePlastic || row.flexible || row.cat2 || row.catII || '',
    mlp: row.mlp || row.cat3 || row.catIII || '',
    compostablePlastic: row.compostablePlastic || row.compostable || row.cat4 || row.catIV || ''
  };
}

function createClientInteractionRow() {
  return { date: '', clientInteraction: '', subject: '', momDetails: [''], attachedMail: '' };
}

function buildRawDataUploadState() {
  return { salesRawData: '', purchaseRawData: '', prePostRawData: '' };
}

function normalizeRawDataUploadState(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return buildRawDataUploadState();
  return {
    salesRawData: value.salesRawData || value.sales || '',
    purchaseRawData: value.purchaseRawData || value.purchase || '',
    prePostRawData: value.prePostRawData || value.prePost || value.prePostRaw || ''
  };
}

function buildClientInteractionRows(annualReturn = {}) {
  const savedRows = annualReturn?.clientInteractions || annualReturn?.partC?.clientInteractions;
  if (Array.isArray(savedRows) && savedRows.length) return savedRows.map(normalizeClientInteractionRow);
  return [createClientInteractionRow()];
}

function normalizeClientInteractionRow(row = {}) {
  return {
    date: row.date || row.clientInteractionDate || '',
    clientInteraction: row.clientInteraction || row.notes || row.clientInteractionNotes || '',
    subject: row.subject || row.minutesSubject || '',
    momDetails: getMomDetails(row),
    attachedMail: row.attachedMail || row.mail || row.file || ''
  };
}

function getMomDetails(row = {}) {
  const details = row.momDetails || row.minutesOfMeetingDetails || row.minutesDetails || row.minutesOfMeeting;
  if (Array.isArray(details)) return details.length ? details : [''];
  if (typeof details === 'string' && details.trim()) return [details];
  return [''];
}

function getProcessingDisplayValue(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(getProcessingDisplayValue).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    return value.name || value.fileName || value.originalName || value.url || value.fileUrl || value.path || value.dataUrl || '';
  }
  return String(value);
}

function addressesMatch(firstAddress = '', secondAddress = '') {
  const first = String(firstAddress || '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').trim().toLowerCase();
  const second = String(secondAddress || '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').trim().toLowerCase();
  return Boolean(first) && first === second;
}

function createProcessingField(key, label, value, icon, type = 'text', options = [], source = 'auto', colSpan = '') {
  return { key, label, value, icon, type, options, source, colSpan };
}

function normalizeProcessingField(field) {
  if (Array.isArray(field)) {
    const [label, value, icon, type = 'text', options = []] = field;
    return createProcessingField(label, label, value, icon, type, options);
  }
  return {
    key: field.key || field.label,
    label: field.label,
    value: field.value,
    icon: field.icon,
    type: field.type || 'text',
    options: field.options || [],
    source: field.source || 'auto',
    colSpan: field.colSpan || ''
  };
}

function getProcessingFileUrl(value) {
  if (!value) return '';
  if (typeof value === 'object') return value.dataUrl || value.url || value.fileUrl || value.path || '';
  return String(value);
}

function ProcessingPill({ label, value, icon: Icon, type = 'text', tone = 'white', options = [], source = '', colSpan = '', onChange }) {
  const displayValue = type === 'date' ? formatDateInputValue(value) : getProcessingDisplayValue(value);
  const fileUrl = getProcessingFileUrl(value);
  const isUrl = fileUrl && (fileUrl.startsWith('http') || fileUrl.startsWith('data:') || fileUrl.includes('/'));
  const inputClass = 'processing-input';
  const isAutoLocked = source !== 'Manual' && Boolean(getProcessingDisplayValue(value).trim()) && type !== 'file';

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    onChange(await uploadMedia(file, 'crm/annual-return/documents'));
  }

  return (
    <label className={`processing-data-pill ${tone === 'yellow' ? 'processing-data-pill-yellow' : 'processing-data-pill-white'} ${colSpan}`}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && <span className="processing-field-icon"><Icon className="h-4 w-4" /></span>}
        <div className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center justify-between gap-2">
            <span className="processing-field-label">{label}</span>
          </span>
          {type === 'select' ? (
            <select value={displayValue} onChange={(event) => onChange(event.target.value)} disabled={isAutoLocked} className={inputClass}>
              <option value="">Select</option>
              {options.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          ) : type === 'textarea' ? (
            <textarea value={displayValue} onChange={(event) => onChange(event.target.value)} readOnly={isAutoLocked} rows={3} className={`${inputClass} min-h-20 resize-y`} />
          ) : type === 'file' ? (
            <div className="mt-2 flex min-w-0 flex-col gap-2">
              <input type="file" onChange={handleFileChange} className="processing-file-input" />
              {displayValue ? (
                isUrl ? <a href={fileUrl.startsWith('data:') ? fileUrl : normalizeDocumentUrl(fileUrl)} target="_blank" rel="noreferrer" className="truncate text-xs font-black text-[#30737B] underline">View existing file</a>
                  : <p className="truncate text-xs font-black text-slate-500">{displayValue}</p>
              ) : null}
            </div>
          ) : (
            <input type={type} value={displayValue} onChange={(event) => onChange(event.target.value)} readOnly={isAutoLocked} className={inputClass} />
          )}
        </div>
      </div>
    </label>
  );
}

export function DetailAccordion({ title, open, onToggle, children }) {
  return (
    <div className="overflow-hidden rounded-xl border border-emerald-100 bg-white shadow-sm shadow-emerald-900/5">
      <button type="button" onClick={onToggle} className="flex min-h-14 w-full items-center justify-between gap-4 bg-[linear-gradient(135deg,#f0fdfa_0%,#ffffff_100%)] px-5 text-left font-black text-slate-900">
        <span className="flex items-center gap-3">
          <span className="h-2 w-2 rounded-full bg-[#30737B]" />
          {title}
        </span>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#30737B] text-white shadow-lg shadow-teal-700/20 transition hover:scale-105">
          <ChevronDown className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && <div className="client-detail-accordion-body border-t border-emerald-100 bg-white">{children}</div>}
    </div>
  );
}

export function EmptyTab({ title, message }) {
  return (
    <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
      <p className="text-lg font-black text-slate-700">{title}</p>
      <p className="mt-2 text-sm font-bold text-slate-500">{message}</p>
    </div>
  );
}

function InteractionBox({ title, message, tone }) {
  const isAmber = tone === 'amber';
  return (
    <div className="mt-4 overflow-hidden rounded border border-slate-200">
      <div className={`${isAmber ? 'bg-orange-100' : 'bg-slate-100'} px-4 py-3 font-black text-slate-600`}>{title}</div>
      <div className="grid min-h-28 place-items-center px-4 py-8 text-center font-black text-slate-500">{message}</div>
    </div>
  );
}
