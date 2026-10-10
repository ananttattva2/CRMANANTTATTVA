const mongoose = require('mongoose');
const { inclusionProjection } = require('../utils/inclusionProjection');
const Client = require('../models/Client');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const Lead = require('../models/Lead');
const Quotation = require('../models/Quotation');
const AnnualReturn = require('../models/AnnualReturn');
const PendingApproval = require('../models/PendingApproval');
const ClientComplianceReview = require('../models/ClientComplianceReview');
const { notifyManagerAnnualSubmitted } = require('../services/annualReviewNotifications');
const { notifyPoSpecialApproval } = require('../services/poApprovalNotifications');
const { notifyClientApprovalDecision } = require('../services/clientApprovalDecisionNotifications');
const { notifyComplianceClientSubmission } = require('../services/clientComplianceSubmissionNotifications');
const { mapQuotationPendingApprovalRow } = require('./quotationController');
const { getVisibleUserScope, ownerFilter } = require('../utils/visibilityScope');
const { CLIENT_APPROVAL_ROLES } = require('../constants/roles');
const { analyzeClientMasterData } = require('../services/userProductivityReport');
const { normalizeClientMaster, resolveClientMasterData } = require('../services/clientMasterResolver');
const { normalizeCompanyIdentity } = require('../services/crmRecordPersistence');
const { normalizeFinancialYear, resolveAnnualReturnPO } = require('../services/annualReturnPoResolver');
const { syncStaffOnboardingCpcbStatus } = require('../services/staffOnboardingWorkflow');
const { syncClientReviewReminderState } = require('../services/clientReviewReminderLifecycle');
const { sendMail } = require('../utils/mailer');
const Notification = require('../models/Notification');
const {
  eligibleServiceIds,
  isLeadEligibleForClientMaster,
  isLeadServiceEligibleForClientMaster,
  serviceClosedAt
} = require('../services/clientMasterEligibility');
const {
  getAdminCreatedLeadReferences,
  dashboardClientExclusionFilter
} = require('../services/dashboardTestLeadExclusion');

const CLIENT_MASTER_CLOSED_LEAD_ERROR = 'Close this lead service before creating its Client Master.';

function combineAccessFilters(...filters) {
  const active = filters.filter((filter) => filter && Object.keys(filter).length);
  return active.length > 1 ? { $and: active } : active[0] || {};
}

function leadOwnerFilter(scope) {
  return ownerFilter(scope, 'createdBy', 'assignedTo', [
    'createdByCrmUserId', 'createdByName', 'createdByEmail', 'importedCreatedBy',
    'generatedForName', 'generatedForEmail', 'assignedToText', 'assignedToEmail',
    'assignedStaffText', 'assignedStaffEmail', 'assignments.assignedToText',
    'assignments.assignedToEmail', 'assignments.assignedStaffText',
    'assignments.assignedStaffEmail', 'serviceSelections.createdByCrmUserId',
    'serviceSelections.createdByName', 'serviceSelections.createdByEmail'
  ], ['generatedForUser', 'assignedStaff', 'assignments.assignedTo', 'assignments.assignedStaff']);
}

async function clientAccessFilter(user) {
  const scope = await getVisibleUserScope(user);
  const directClientAccess = ownerFilter(scope, 'createdBy', 'adminControls.assignedTo', [
    'data.importMeta.assignedTo', 'data.importMeta.user', 'data.importMeta.userName',
    'data.importMeta.createdBy', 'data.importMeta.createdByEmail'
  ]);
  if (scope === null) return directClientAccess;

  // Users assigned to a Lead must see that Lead's populated Client Master,
  // even when the Client document itself was created by an administrator.
  const visibleLeads = await Lead.find(leadOwnerFilter(scope)).select('_id leadCode sourceLeadId').lean();
  if (!visibleLeads.length) return directClientAccess;
  const leadIds = visibleLeads.map((lead) => lead._id).filter(Boolean);
  const leadIdentityValues = visibleLeads.flatMap((lead) => [
    String(lead._id || '').trim(),
    String(lead.leadCode || '').trim(),
    String(lead.sourceLeadId || '').trim()
  ]).filter(Boolean);
  return { $or: [
    ...(directClientAccess.$or || [directClientAccess]),
    { selectedLead: { $in: leadIds } },
    { 'data.selectedLead': { $in: [...leadIds, ...leadIdentityValues] } },
    { 'data.selectedLeadSnapshot.id': { $in: leadIdentityValues } },
    { 'data.selectedLeadSnapshot.sourceLeadId': { $in: leadIdentityValues } },
    { 'data.selectedLeadSnapshot.leadCode': { $in: leadIdentityValues } },
    { 'data.importMeta.leadNumber': { $in: leadIdentityValues } },
    { 'data.importMeta.uniqueId': { $in: leadIdentityValues } }
  ] };
}
exports.clientAccessFilter = clientAccessFilter;

async function leadAccessFilter(user) {
  const scope = await getVisibleUserScope(user);
  return leadOwnerFilter(scope);
}

async function validateNewClientLeadEligibility(selectedLead, assignedServiceId, user) {
  if (!selectedLead) return '';
  const lead = await Lead.findOne(combineAccessFilters({ _id: selectedLead }, await leadAccessFilter(user))).lean();
  if (!lead) return 'Selected lead was not found.';
  return isLeadServiceEligibleForClientMaster(lead, assignedServiceId)
    ? ''
    : CLIENT_MASTER_CLOSED_LEAD_ERROR;
}
const { userHasAnyRole } = require('../utils/userRoles');

function normalizeApprovalStatus(value) {
  const status = String(value || '').trim().toUpperCase();
  return ['PENDING', 'PARTIALLY_APPROVED', 'APPROVED', 'REJECTED'].includes(status) ? status : '';
}

function validateClientSubmissionCompletion(data = {}, workflowStatus = 'draft') {
  if (workflowStatus !== 'submitted') return '';
  const analysis = analyzeClientMasterData(data);
  const percentage = analysis.totalCount ? Math.round((analysis.filledCount / analysis.totalCount) * 100) : 0;
  return percentage < 60 ? `To submit Client Master, please complete at least 60% of the data. Current completion is ${percentage}%.` : '';
}

function normalizeRoleName(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function hasAnnualRole(user, roles = []) {
  return userHasAnyRole(user, roles);
}

function readAnnualWorkflowStage(workflow = {}) {
  const currentStage = String(workflow.currentStage || '').toLowerCase();
  const status = String(workflow.status || '').toLowerCase();
  if (currentStage === 'manager' || status === 'manager_pending') return 'manager';
  if (currentStage === 'compliance' || status === 'compliance_pending') return 'compliance';
  if (currentStage === 'complete' || status === 'compliance_approved') return 'complete';
  return 'user';
}

function latestAnnualWorkflowAction(workflow = {}) {
  const history = Array.isArray(workflow.history) ? workflow.history : [];
  return String(history[history.length - 1]?.action || '').trim().toUpperCase();
}

function validateAnnualWorkflowPermission(existingWorkflow = {}, incomingWorkflow = {}, user = {}) {
  const isAdmin = hasAnnualRole(user, ['admin', 'superadmin']);
  const isManager = isAdmin || hasAnnualRole(user, ['manager', 'management', 'team manager', 'operation head', 'operations head']);
  const isComplianceManager = isAdmin || hasAnnualRole(user, ['compliance', 'compliance manager']);
  const currentStage = readAnnualWorkflowStage(existingWorkflow);
  const nextStage = readAnnualWorkflowStage(incomingWorkflow);
  const currentStatus = String(existingWorkflow.status || 'draft').toLowerCase();
  const nextStatus = String(incomingWorkflow.status || 'draft').toLowerCase();
  const action = latestAnnualWorkflowAction(incomingWorkflow);

  if (action.startsWith('MANAGER_') && !isManager) {
    return 'Only Manager can approve or reject manager review.';
  }
  if (action.startsWith('COMPLIANCE_') && !isComplianceManager) {
    return 'Only Compliance Manager can approve or reject compliance review.';
  }

  const workflowMoved = currentStage !== nextStage || currentStatus !== nextStatus;
  if (!workflowMoved) return '';

  if (nextStatus === 'manager_pending' && nextStage === 'manager') return '';
  if (nextStatus === 'compliance_pending' && nextStage === 'compliance') {
    if (action.startsWith('COMPLIANCE_') || currentStage === 'compliance' || currentStatus === 'compliance_pending') {
      return isComplianceManager ? '' : 'Only Compliance Manager can approve or reject compliance review.';
    }
    return isManager ? '' : 'Only Manager can move annual approval to compliance review.';
  }
  if (nextStatus === 'manager_rejected' && !isManager) {
    return 'Only Manager can approve or reject manager review.';
  }
  if (['compliance_approved', 'compliance_rejected'].includes(nextStatus) && !isComplianceManager) {
    return 'Only Compliance Manager can approve or reject compliance review.';
  }
  if (nextStage === 'complete' && !isComplianceManager) {
    return 'Only Compliance Manager can complete annual approval.';
  }

  return '';
}

function normalizeAnnualWorkflowForStatus(workflow = {}, status = '') {
  const safeWorkflow = isPlainObject(workflow) ? workflow : {};
  const normalizedStatus = String(status || safeWorkflow.status || '').trim().toLowerCase();
  const hasWorkflowStage = Boolean(safeWorkflow.currentStage || safeWorkflow.status);
  if (hasWorkflowStage) return safeWorkflow;

  if (normalizedStatus === 'manager_pending') return { ...safeWorkflow, status: 'manager_pending', currentStage: 'manager' };
  if (normalizedStatus === 'compliance_pending') return { ...safeWorkflow, status: 'compliance_pending', currentStage: 'compliance' };
  if (normalizedStatus === 'compliance_rejected') return { ...safeWorkflow, status: 'compliance_rejected', currentStage: 'manager' };
  if (normalizedStatus === 'compliance_approved') return { ...safeWorkflow, status: 'compliance_approved', currentStage: 'complete' };
  if (normalizedStatus === 'manager_rejected') return { ...safeWorkflow, status: 'manager_rejected', currentStage: 'user' };

  return safeWorkflow;
}

function annualReviewStatusRank(status = '') {
  const normalized = String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'approved' || normalized === 'rejected') return 4;
  if (normalized === 'submitted') return 3;
  if (normalized === 'pending') return 2;
  if (normalized === 'waiting' || normalized === 'locked') return 1;
  return 0;
}

function preferAnnualReviewStatus(currentStatus = '', incomingStatus = '') {
  return annualReviewStatusRank(incomingStatus) >= annualReviewStatusRank(currentStatus)
    ? String(incomingStatus || '').trim().toLowerCase()
    : String(currentStatus || '').trim().toLowerCase();
}

function mergeAnnualSectionMeta(current = {}, incoming = {}) {
  const currentMeta = isPlainObject(current) ? current : {};
  const incomingMeta = isPlainObject(incoming) ? incoming : {};
  const merged = { ...currentMeta, ...incomingMeta };
  const managerStatus = preferAnnualReviewStatus(currentMeta.managerStatus || currentMeta.status, incomingMeta.managerStatus || incomingMeta.status);
  const complianceStatus = preferAnnualReviewStatus(currentMeta.complianceStatus, incomingMeta.complianceStatus);
  const status = preferAnnualReviewStatus(currentMeta.status, incomingMeta.status || managerStatus || complianceStatus);
  return {
    ...merged,
    status: status || merged.status || '',
    managerStatus: managerStatus || merged.managerStatus || '',
    complianceStatus: complianceStatus || merged.complianceStatus || ''
  };
}

function mergeAnnualWorkflowForSave(existingWorkflow = {}, incomingWorkflow = {}) {
  const existing = isPlainObject(existingWorkflow) ? existingWorkflow : {};
  const incoming = isPlainObject(incomingWorkflow) ? incomingWorkflow : {};
  const existingSections = isPlainObject(existing.sections) ? existing.sections : {};
  const incomingSections = isPlainObject(incoming.sections) ? incoming.sections : {};
  const sections = {};

  [...new Set([...Object.keys(existingSections), ...Object.keys(incomingSections)])].forEach((title) => {
    sections[title] = mergeAnnualSectionMeta(existingSections[title], incomingSections[title]);
  });

  return {
    ...existing,
    ...incoming,
    history: Array.isArray(incoming.history) && incoming.history.length >= (Array.isArray(existing.history) ? existing.history.length : 0)
      ? incoming.history
      : (Array.isArray(existing.history) ? existing.history : []),
    sections
  };
}

function normalizeHeaderKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isFilled(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function buildValueLookup(source, prefix = '', lookup = {}) {
  if (!source || typeof source !== 'object') return lookup;

  Object.entries(source).forEach(([key, value]) => {
    const ownKey = normalizeHeaderKey(key);
    const pathKey = normalizeHeaderKey(`${prefix} ${key}`);
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      buildValueLookup(value, `${prefix} ${key}`, lookup);
      return;
    }
    if (isFilled(value)) {
      if (!lookup[ownKey]) lookup[ownKey] = value;
      if (!lookup[pathKey]) lookup[pathKey] = value;
    }
  });

  return lookup;
}

function pickLookup(lookup, aliases) {
  for (const alias of aliases) {
    const value = lookup[normalizeHeaderKey(alias)];
    if (isFilled(value)) return String(value).trim();
  }
  return '';
}

function normalizeCollection(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  if (Array.isArray(payload?.result?.[key])) return payload.result[key];
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}

function readClientName(client) {
  return client.data?.basic?.clientLegalName
    || client.data?.basic?.tradeName
    || client.selectedLead?.company
    || 'Untitled client';
}

function readCreatedBy(client) {
  return client.createdBy?.name
    || client.createdBy?.email
    || client.data?.importMeta?.createdBy
    || client.selectedLead?.importedCreatedBy
    || 'CRM User';
}

function hasQuotationData(client) {
  const validation = client.data?.validation || {};
  return Boolean(validation.quotationNumber || validation.quotationDate || validation.quotationDocument);
}

function approvalDateParts(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return { date: '-', time: '-' };
  }

  return {
    date: date.toLocaleDateString('en-GB'),
    time: date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  };
}

function readApprovalDateParts(client) {
  const lookup = buildValueLookup(client);
  const importedDate = pickLookup(lookup, ['Creation Date', 'Created Date', 'Request Date', 'Date']);
  const importedTime = pickLookup(lookup, ['Creation Time', 'Created Time', 'Request Time', 'Time']);

  if (importedDate || importedTime) {
    return { date: importedDate || '-', time: importedTime || '-' };
  }

  return approvalDateParts(client.createdAt || client.updatedAt);
}

function getPendingClientKey(row) {
  return String(row.uniqueId || row.id || row.clientName || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function getPendingClientKeys(row) {
  const identityKeys = [
    row.id,
    row.uniqueId
  ].map((value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).filter(Boolean);
  if (identityKeys.length) return identityKeys;

  return [
    row.clientName
  ].map((value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).filter(Boolean);
}

function isDemoCreator(value) {
  return /^demo(?:\s+demo)?$/i.test(String(value || '').trim());
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

const CLIENT_LIFECYCLE_MILESTONES = ['leadClosure', 'poReceived', 'kickOffMeeting'];
const CLIENT_LIFECYCLE_STATUSES = new Set(['Pending', 'In Progress', 'Done']);
const CLIENT_LIFECYCLE_PRIORITIES = new Set(['High', 'Medium', 'Low']);

function cleanLifecycleText(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function cleanLifecycleDate(value) {
  const date = cleanLifecycleText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function cleanLifecycleProof(file = {}) {
  if (!isPlainObject(file)) return null;
  const url = cleanLifecycleText(file.secureUrl || file.url, 2000);
  if (!/^https:\/\//i.test(url)) return null;
  return {
    name: cleanLifecycleText(file.name || 'Proof', 240),
    type: cleanLifecycleText(file.type, 120),
    size: Math.max(0, Number(file.size || file.bytes) || 0),
    url,
    secureUrl: url,
    publicId: cleanLifecycleText(file.publicId, 300),
    uploadedAt: file.uploadedAt || new Date().toISOString()
  };
}

function cleanClientLifecycle(payload = {}) {
  const source = isPlainObject(payload) ? payload : {};
  const sourceMilestones = isPlainObject(source.milestones) ? source.milestones : {};
  const milestones = Object.fromEntries(CLIENT_LIFECYCLE_MILESTONES.map((key) => {
    const row = isPlainObject(sourceMilestones[key]) ? sourceMilestones[key] : {};
    const moms = (Array.isArray(row.moms) ? row.moms : []).slice(0, 25).map((mom, index) => ({
      id: cleanLifecycleText(mom?.id, 80) || `mom-${Date.now()}-${index}`,
      date: cleanLifecycleDate(mom?.date),
      subject: cleanLifecycleText(mom?.subject, 200),
      points: (Array.isArray(mom?.points) ? mom.points : []).slice(0, 20).map((point) => cleanLifecycleText(point, 500)).filter(Boolean)
    })).filter((mom) => mom.date || mom.subject || mom.points.length);
    return [key, {
      date: cleanLifecycleDate(row.date),
      completed: row.completed === 'yes' ? 'yes' : 'no',
      remark: cleanLifecycleText(row.remark, 1000),
      moms,
      proofs: (Array.isArray(row.proofs) ? row.proofs : []).slice(0, 10).map(cleanLifecycleProof).filter(Boolean)
    }];
  }));
  const workFollowUps = (Array.isArray(source.workFollowUps) ? source.workFollowUps : []).slice(0, 100).map((row, index) => {
    const status = cleanLifecycleText(row?.status, 30);
    return {
      id: cleanLifecycleText(row?.id, 80) || `follow-up-${Date.now()}-${index}`,
      remark: cleanLifecycleText(row?.remark, 1000),
      date: cleanLifecycleDate(row?.date),
      status: CLIENT_LIFECYCLE_STATUSES.has(status) ? status : 'Pending',
      priority: CLIENT_LIFECYCLE_PRIORITIES.has(cleanLifecycleText(row?.priority, 20)) ? cleanLifecycleText(row?.priority, 20) : 'Medium'
    };
  });
  return { milestones, workFollowUps };
}

function isMongoObjectId(value) {
  return /^[a-f\d]{24}$/i.test(String(value || ''));
}

function readAssignedToId(value) {
  if (!value) return '';
  if (isMongoObjectId(value)) return String(value);
  if (!isPlainObject(value)) return '';

  const candidates = [
    value._id,
    value.id,
    value.userId,
    value.mongoId
  ];
  const match = candidates.find((candidate) => isMongoObjectId(candidate));
  return match ? String(match) : '';
}

function readAssignedToLabel(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (!isPlainObject(value)) return '';
  return String(value.name || value.email || value.crmUserId || value.userId || '').trim();
}

function normalizeAdminControls(adminControls = {}) {
  const normalized = isPlainObject(adminControls) ? { ...adminControls } : {};
  const visibility = String(normalized.visibilityStatus || '').trim().toUpperCase();
  normalized.visibilityStatus = ['LIVE', 'SUSPENDED', 'DISCONTINUED'].includes(visibility) ? visibility : 'LIVE';
  const assignedToId = readAssignedToId(normalized.assignedTo);

  if (assignedToId) {
    normalized.assignedTo = assignedToId;
  } else {
    delete normalized.assignedTo;
  }

  return normalized;
}

function normalizeClientRequestPayload(body = {}) {
  const data = isPlainObject(body.data) ? { ...body.data } : {};
  const adminControls = normalizeAdminControls(body.adminControls);
  const assignedToLabel = readAssignedToLabel(body.adminControls?.assignedTo);

  if (assignedToLabel) {
    data.importMeta = {
      ...(isPlainObject(data.importMeta) ? data.importMeta : {}),
      assignedTo: data.importMeta?.assignedTo || assignedToLabel
    };
  }

  return { data, adminControls };
}

function readClientAssignedServiceId(body = {}, data = {}) {
  return String(body.assignedServiceId || data.assignedServiceId || data.selectedLeadSnapshot?.assignedServiceId || '').trim();
}

const CPCB_APPLICATION_STATUSES = ['Fresh Application', 'In Process', 'Client Submit'];
const CPCB_LOCKED_DATA_KEYS = ['compliance', 'msmeRows', 'cte', 'cpcb', 'cpcbScreenshots', 'processDiagrams'];

function readCpcbOnboarding(data = {}) {
  const onboarding = isPlainObject(data?.cpcbOnboarding) ? data.cpcbOnboarding : {};
  return {
    answered: typeof onboarding.cpcbPortalRegistered === 'boolean',
    registered: onboarding.cpcbPortalRegistered,
    status: String(onboarding.cpcbApplicationStatus || '').trim()
  };
}

function validateCpcbOnboardingInput(registered, status) {
  if (typeof registered !== 'boolean') return 'Select whether the client is registered on the CPCB Portal';
  if (!registered && !CPCB_APPLICATION_STATUSES.includes(String(status || '').trim())) {
    return 'Select one valid CPCB application status';
  }
  return '';
}

function validateRestrictedCpcbUpdate(existingData = {}, incomingData = {}) {
  const existingState = readCpcbOnboarding(existingData);
  const incomingState = readCpcbOnboarding(incomingData);
  if (existingState.answered && (!incomingState.answered || incomingState.registered !== existingState.registered || incomingState.status !== existingState.status)) {
    return 'CPCB onboarding status can only be changed through the CPCB registration status action';
  }
  // Pending CPCB sections are restored from stored data before persistence.
  // Accepting the form payload avoids false failures caused by legacy/root and
  // assigned-service snapshots having different shapes, while the sanitizer
  // below still prevents every locked field from being changed.
  return '';
}

function preserveRestrictedCpcbSections(existingData = {}, incomingData = {}) {
  const safeData = isPlainObject(incomingData) ? { ...incomingData } : {};
  CPCB_LOCKED_DATA_KEYS.forEach((key) => {
    if (existingData[key] === undefined) delete safeData[key];
    else safeData[key] = existingData[key];
  });
  if (existingData.cpcbDataByAssignedServiceId === undefined) delete safeData.cpcbDataByAssignedServiceId;
  else safeData.cpcbDataByAssignedServiceId = existingData.cpcbDataByAssignedServiceId;
  return safeData;
}

function applyCpcbOnboardingData(existingData = {}, { registered, applicationStatus = '', userId, changedAt = new Date() } = {}) {
  const data = isPlainObject(existingData) ? { ...existingData } : {};
  const previous = readCpcbOnboarding(data);
  const history = Array.isArray(data.cpcbOnboarding?.history) ? data.cpcbOnboarding.history : [];
  data.cpcbOnboarding = {
    cpcbPortalRegistered: registered,
    cpcbApplicationStatus: registered ? null : String(applicationStatus || '').trim(),
    updatedAt: changedAt,
    updatedBy: userId,
    history: [...history, {
      cpcbPortalRegistered: registered,
      cpcbApplicationStatus: registered ? null : String(applicationStatus || '').trim(),
      previousRegistered: previous.answered ? previous.registered : null,
      previousApplicationStatus: previous.status || null,
      changedAt,
      changedBy: userId
    }].slice(-50)
  };
  return data;
}

function readRequestedClientId(body = {}) {
  return String(body.recordId || body.clientId || body._id || body.id || '').trim();
}

function readRequestedClientWorkflowStatus(value) {
  const status = String(value || 'draft').trim().toLowerCase();
  return ['draft', 'submitted'].includes(status) ? status : '';
}

function getClientWorkflowTransition(currentValue, requestedValue) {
  const currentStatus = readRequestedClientWorkflowStatus(currentValue);
  const requestedStatus = readRequestedClientWorkflowStatus(requestedValue);
  if (!requestedStatus) return { error: 'Invalid Client Master workflow status' };
  if (currentStatus === 'submitted' && requestedStatus === 'draft') {
    return { error: 'A submitted Client Master record cannot be changed back to draft' };
  }
  return {
    currentStatus,
    requestedStatus,
    becameSubmitted: currentStatus !== 'submitted' && requestedStatus === 'submitted',
    alreadySubmitted: currentStatus === 'submitted' && requestedStatus === 'submitted'
  };
}

function applyClientSubmissionMetadata(client, userId, submittedAt = new Date()) {
  if (!client.submittedAt) client.submittedAt = submittedAt;
  if (!client.submittedBy && userId) client.submittedBy = userId;
  return client;
}

function validateClientMasterIdentity(client, { assignedServiceId = '', selectedLead = '' } = {}) {
  const storedAssignedServiceId = readClientAssignedServiceId(client, client?.data || {});
  if (assignedServiceId && storedAssignedServiceId && String(assignedServiceId) !== storedAssignedServiceId) {
    return 'Assigned service does not match this Client Master record';
  }
  const storedSelectedLead = String(client?.selectedLead?._id || client?.selectedLead || '').trim();
  if (selectedLead && storedSelectedLead && String(selectedLead) !== storedSelectedLead) {
    return 'Selected lead does not match this Client Master record';
  }
  return '';
}

function mergeAssignedServiceCpcbData(existingData = {}, incomingData = {}) {
  return {
    ...incomingData,
    cpcbDataByAssignedServiceId: {
      ...(isPlainObject(existingData.cpcbDataByAssignedServiceId) ? existingData.cpcbDataByAssignedServiceId : {}),
      ...(isPlainObject(incomingData.cpcbDataByAssignedServiceId) ? incomingData.cpcbDataByAssignedServiceId : {})
    },
    serviceDetailsByAssignedServiceId: {
      ...(isPlainObject(existingData.serviceDetailsByAssignedServiceId) ? existingData.serviceDetailsByAssignedServiceId : {}),
      ...(isPlainObject(incomingData.serviceDetailsByAssignedServiceId) ? incomingData.serviceDetailsByAssignedServiceId : {})
    }
  };
}

function readSelectedLeadId(value) {
  const id = String(value || '').trim();
  return mongoose.Types.ObjectId.isValid(id) ? id : undefined;
}

function normalizeAnnualYearKey(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function setNestedValue(target, path, value) {
  const parts = String(path || '').split('.').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return;
  let cursor = target;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      cursor[part] = value;
      return;
    }
    if (!isPlainObject(cursor[part])) cursor[part] = {};
    cursor = cursor[part];
  });
}

function buildAnnualReturnFiling(draft = {}, annualYear = '', meta = {}) {
  const safeDraft = isPlainObject(draft) ? draft : {};
  const parsed = {};
  const approvalWorkflow = normalizeAnnualWorkflowForStatus(meta.approvalWorkflow, meta.status);

  Object.entries(safeDraft).forEach(([key, value]) => {
    if (key === 'savedAt') return;
    setNestedValue(parsed, key, value);
  });

  return {
    annualYear,
    status: String(meta.status || 'draft').trim() || 'draft',
    activeTab: String(meta.activeTab || '').trim(),
    activeSection: String(meta.activeSection || '').trim(),
    draft: safeDraft,
    basicInfo: parsed.basic || {},
    financials: parsed.financials || {},
    data: parsed.data || {},
    brandOwner: parsed.brandOwner || {},
    importer: parsed.importer || {},
    annual: parsed.annual || {},
    approvalWorkflow,
    savedAt: new Date(),
    updatedBy: meta.updatedBy
  };
}

function getAnnualReturnClientKey(client, fallback = '') {
  return String(
    client?._id
    || client?.id
    || client?.data?.importMeta?.uniqueId
    || fallback
    || ''
  ).trim();
}

function getAnnualReturnClientName(client) {
  return String(
    client?.data?.basic?.clientLegalName
    || client?.data?.basic?.tradeName
    || client?.selectedLead?.company
    || 'Untitled client'
  ).trim();
}

function mapAnnualReturnRecordToFiling(row = {}) {
  return {
    annualYear: row.annualYear,
    status: row.status || row.approvalWorkflow?.status || 'draft',
    activeTab: row.activeTab || '',
    activeSection: row.activeSection || '',
    draft: isPlainObject(row.draft) ? row.draft : {},
    basicInfo: isPlainObject(row.basicInfo) ? row.basicInfo : {},
    financials: isPlainObject(row.financials) ? row.financials : {},
    data: isPlainObject(row.data) ? row.data : {},
    brandOwner: isPlainObject(row.brandOwner) ? row.brandOwner : {},
    importer: isPlainObject(row.importer) ? row.importer : {},
    annual: isPlainObject(row.annual) ? row.annual : {},
    approvalWorkflow: isPlainObject(row.approvalWorkflow) ? row.approvalWorkflow : {},
    savedAt: row.savedAt || row.updatedAt || new Date(),
    updatedBy: row.updatedBy
  };
}

async function upsertAnnualReturnRecord(client, annualYear, filing, requestBody = {}, userId) {
  const clientKey = getAnnualReturnClientKey(client, requestBody.clientKey || requestBody.clientId);
  const clientData = isPlainObject(client.data) ? client.data : {};
  const { annualReturn: _annualReturn, ...clientDataSnapshot } = clientData;
  const basic = isPlainObject(clientData.basic) ? clientData.basic : {};
  const annual = isPlainObject(filing.annual) ? filing.annual : {};

  if (!clientKey || !annualYear) return null;

  const existingRecords = await AnnualReturn.find({ clientKey }).sort({ createdAt: 1, updatedAt: 1 });
  const canonical = existingRecords[0] || new AnnualReturn({ clientKey });
  const filings = {};

  existingRecords.forEach((record) => {
    const recordFilings = isPlainObject(record.filings) ? record.filings : {};
    Object.entries(recordFilings).forEach(([year, savedFiling]) => {
      if (year && isPlainObject(savedFiling)) filings[year] = savedFiling;
    });
    if (record.annualYear) {
      filings[record.annualYear] = {
        ...(isPlainObject(filings[record.annualYear]) ? filings[record.annualYear] : {}),
        ...mapAnnualReturnRecordToFiling(record)
      };
    }
  });

  filings[annualYear] = {
    ...(isPlainObject(filings[annualYear]) ? filings[annualYear] : {}),
    ...filing,
    annualYear,
    savedAt: filing.savedAt || new Date(),
    updatedBy: userId
  };

  const duplicateIds = existingRecords
    .filter((record) => String(record._id) !== String(canonical._id))
    .map((record) => record._id);
  const shouldDeferTopLevelYear = existingRecords.some((record) => (
    String(record._id) !== String(canonical._id) && String(record.annualYear || '') === String(annualYear)
  ));

  canonical.client = client._id;
  canonical.clientKey = clientKey;
  canonical.annualYear = shouldDeferTopLevelYear ? (canonical.annualYear || annualYear) : annualYear;
  canonical.clientName = getAnnualReturnClientName(client);
  canonical.piboCategory = String(basic.piboCategory || '').trim();
  canonical.eprCategory = String(basic.eprCategory || '').trim();
  canonical.currentSpoc = String(annual.currentSpoc || requestBody.currentSpoc || '').trim();
  canonical.previousSpoc = String(annual.previousSpoc || requestBody.previousSpoc || '').trim();
  canonical.status = filing.status;
  canonical.activeTab = filing.activeTab;
  canonical.activeSection = filing.activeSection;
  canonical.filings = filings;
  canonical.draft = filing.draft;
  canonical.basicInfo = filing.basicInfo;
  canonical.financials = filing.financials;
  canonical.data = filing.data;
  canonical.brandOwner = filing.brandOwner;
  canonical.importer = filing.importer;
  canonical.annual = filing.annual;
  canonical.approvalWorkflow = filing.approvalWorkflow;
  canonical.clientData = clientDataSnapshot;
  canonical.adminControls = isPlainObject(client.adminControls) ? client.adminControls : {};
  canonical.savedAt = filing.savedAt;
  canonical.updatedBy = userId;
  canonical.markModified('filings');

  await canonical.save();

  if (duplicateIds.length) {
    await AnnualReturn.deleteMany({ _id: { $in: duplicateIds } });
    if (shouldDeferTopLevelYear) {
      canonical.annualYear = annualYear;
      await canonical.save();
    }
    console.info('[AnnualReturn] consolidated duplicate client records', {
      clientKey,
      canonicalId: String(canonical._id),
      removed: duplicateIds.length,
      years: Object.keys(filings)
    });
  }

  return canonical;
}

function buildClientApprovalPayload(body = {}, status, userId, remarks = '') {
  const existingPayload = isPlainObject(body.payload) ? body.payload : {};
  const payloadData = isPlainObject(existingPayload.data) ? existingPayload.data : {};
  const payloadImportMeta = isPlainObject(payloadData.importMeta) ? payloadData.importMeta : {};
  const payloadAdminControls = isPlainObject(existingPayload.adminControls) ? existingPayload.adminControls : {};
  const adminControls = normalizeAdminControls(payloadAdminControls);
  const assignedToLabel = readAssignedToLabel(payloadAdminControls.assignedTo);
  const uniqueId = String(body.uniqueId || payloadImportMeta.uniqueId || '').trim();
  const sourceClientId = String(body.sourceClientId || existingPayload._id || existingPayload.id || '').trim();
  const fullData = Object.keys(payloadData).length
    ? payloadData
    : {
        basic: {
          clientLegalName: String(body.clientName || '').trim(),
          piboCategory: String(body.piboCategory || '').trim(),
          eprCategory: String(body.eprCategory || body.category || '').trim()
        }
      };

  return {
    adminControls: {
      ...adminControls,
      approvalStatus: status
    },
    data: {
      ...fullData,
      importMeta: {
        ...(isPlainObject(fullData.importMeta) ? fullData.importMeta : {}),
        assignedTo: fullData.importMeta?.assignedTo || assignedToLabel || '',
        uniqueId,
        sourceClientId: fullData.importMeta?.sourceClientId || sourceClientId,
        approvalOverride: true
      },
      approvalMeta: {
        status,
        source: String(body.source || 'crm').trim() || 'crm',
        actionBy: userId,
        actionAt: new Date(),
        remarks
      }
    }
  };
}

function mergePendingClients(localRows, incomingRows) {
  const merged = [];
  const indexByKey = new Map();

  [...incomingRows, ...localRows].forEach((row) => {
    const key = getPendingClientKey(row);
    if (key && indexByKey.has(key)) {
      const index = indexByKey.get(key);
      merged[index] = { ...merged[index], ...row };
      return;
    }

    if (key) indexByKey.set(key, merged.length);
    merged.push(row);
  });

  return merged;
}

function pendingApprovalFilter(row, type = 'client') {
  const source = String(row.source || 'crm').trim() || 'crm';
  const sourceClientId = String(row.id || row.sourceClientId || '').trim();
  const uniqueId = String(row.uniqueId || '').trim();

  if (sourceClientId) return { type, source, sourceClientId };
  if (uniqueId) return { type, source, uniqueId };

  return {
    type,
    source,
    clientName: String(row.clientName || row.companyName || '').trim()
  };
}

async function upsertPendingApproval(row, type = 'client') {
  const status = normalizeApprovalStatus(row.approvalStatus) || 'PENDING';
  const filter = pendingApprovalFilter(row, type);
  const source = String(row.source || 'crm').trim() || 'crm';
  const sourceClientId = String(row.id || row.sourceClientId || '').trim();
  const uniqueId = String(row.uniqueId || '').trim();
  const setOnInsert = { type, source };
  if (sourceClientId) setOnInsert.sourceClientId = sourceClientId;
  if (uniqueId) setOnInsert.uniqueId = uniqueId;
  if (status === 'PENDING') setOnInsert.nextReminderAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const existing = await PendingApproval.findOne(filter);
  const existingStatus = normalizeApprovalStatus(existing?.approvalStatus);

  if (existing && existingStatus && existingStatus !== 'PENDING') {
    existing.payload = row;
    existing.clientName = String(row.clientName || row.companyName || existing.clientName || '').trim();
    existing.piboCategory = String(row.piboCategory || existing.piboCategory || '').trim();
    existing.eprCategory = String(row.eprCategory || row.category || existing.eprCategory || '').trim();
    existing.createdByName = String(row.createdBy || row.userName || existing.createdByName || '').trim();
    existing.requestDate = String(row.requestDate || row.quotationDate || existing.requestDate || '').trim();
    existing.requestTime = String(row.requestTime || existing.requestTime || '').trim();
    await existing.save();
    return existing.toObject();
  }

  const record = await PendingApproval.findOneAndUpdate(
    filter,
    {
      $setOnInsert: setOnInsert,
      $set: {
        clientName: String(row.clientName || row.companyName || '').trim(),
        approvalStatus: status,
        piboCategory: String(row.piboCategory || '').trim(),
        eprCategory: String(row.eprCategory || row.category || '').trim(),
        createdByName: String(row.createdBy || row.userName || '').trim(),
        requestDate: String(row.requestDate || row.quotationDate || '').trim(),
        requestTime: String(row.requestTime || '').trim(),
        payload: row
      }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  return record;
}

async function applyClientApprovalStatus(record, status, userId, remarks = '') {
  const sourceClientId = String(record.sourceClientId || '').trim();
  const client = mongoose.Types.ObjectId.isValid(sourceClientId)
    ? await Client.findById(sourceClientId)
    : null;
  const approvalBody = {
    ...(record.payload || {}),
    sourceClientId,
    uniqueId: record.uniqueId || record.payload?.uniqueId || '',
    payload: record.payload?.payload,
    source: record.source
  };
  const approvalFields = buildClientApprovalPayload(approvalBody, status, userId, remarks);

  if (client) {
    client.adminControls = { ...(client.adminControls || {}), ...approvalFields.adminControls };
    client.data = {
      ...(client.data || {}),
      ...(approvalFields.data || {}),
      approvalMeta: {
        status,
        source: String(record.source || 'crm').trim() || 'crm',
        actionBy: userId,
        actionAt: new Date(),
        remarks
      }
    };
    client.markModified('data');
    await client.save();
    await syncClientReviewReminderState({ client, status });
    return client;
  }

  return Client.create({
    adminControls: approvalFields.adminControls,
    data: approvalFields.data,
    workflowStatus: 'draft',
    createdBy: userId
  });
}

function mapPendingApprovalRecord(record) {
  const payload = record.payload || {};
  return {
    ...payload,
    approvalRecordId: record._id,
    id: record.sourceClientId || payload.id || record._id,
    source: record.source,
    uniqueId: record.uniqueId || payload.uniqueId || '',
    clientName: record.clientName || payload.clientName || payload.companyName || 'Untitled client',
    approvalStatus: record.approvalStatus,
    piboCategory: record.piboCategory || payload.piboCategory || '-',
    eprCategory: record.eprCategory || payload.eprCategory || payload.category || '-',
    createdBy: record.createdByName || payload.createdBy || payload.userName || '-',
    requestDate: record.requestDate || payload.requestDate || '-',
    requestTime: record.requestTime || payload.requestTime || '-',
    decisionBy: record.actionBy?.name || record.actionBy?.email || '-',
    decisionAt: record.actionAt || null,
    managementApproverId: record.managementApprover || payload.managementApproverId || '',
    managementApproverName: record.managementApproverName || payload.managementApproverName || '',
    managementApprovalSource: record.managementApprovalSource || payload.managementApprovalSource || '',
    managementApprovalNote: record.managementApprovalNote || payload.managementApprovalNote || '',
    reminderFlag: record.reminderFlag || '',
    redFlagAt: record.redFlagAt || null,
    greenFlagDeadline: record.greenFlagDeadline || null
  };
}

function mapClientPendingApprovalRow(client, createdByLabel = 'CRM User') {
  const parts = approvalDateParts(client.createdAt || new Date());
  const data = client.data || {};

  return {
    id: client._id,
    selectedLeadId: client.selectedLead?._id || client.selectedLead || data.selectedLead || '',
    source: 'crm',
    uniqueId: data.importMeta?.uniqueId || '',
    clientName: data.basic?.clientLegalName || data.basic?.tradeName || 'Untitled client',
    approvalStatus: normalizeApprovalStatus(client.adminControls?.approvalStatus) || 'PENDING',
    piboCategory: data.basic?.piboCategory || '-',
    eprCategory: data.basic?.eprCategory || '-',
    createdBy: createdByLabel,
    requestDate: parts.date,
    requestTime: parts.time
  };
}

async function queueCreatedClientApproval(client, user, { resubmission = false, previousStatus = '' } = {}) {
  const createdByLabel = user?.name || user?.email || 'CRM User';
  if (resubmission) {
    await PendingApproval.findOneAndUpdate(
      { type: 'client', source: 'crm', sourceClientId: String(client._id) },
      { $set: { approvalStatus: 'PENDING', actionBy: null, actionAt: null, remarks: 'Corrected Client Master resubmitted for compliance review', nextReminderAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } }
    );
    const review = await ClientComplianceReview.findOne({ client: client._id });
    if (review) {
      review.status = 'PENDING';
      review.history.push({ action: 'RESUBMITTED', remarks: `Corrected after ${previousStatus || 'compliance review'}`, actionBy: user?._id });
      await review.save();
    }
  }
  await upsertPendingApproval(mapClientPendingApprovalRow(client, createdByLabel), 'client');
  await syncClientReviewReminderState({ client, status: 'PENDING' });
  const notification = await notifyComplianceClientSubmission({ client, submitter: user, resubmission, previousStatus }).catch((error) => {
    console.error('[client-master:compliance-notification]', error.message);
    return { sent: false, reason: error.message };
  });
  return notification;
}

async function syncPendingApprovalRows(rows, type = 'client') {
  const records = [];

  for (const row of rows) {
    records.push(await upsertPendingApproval(row, type));
  }

  return records.map(mapPendingApprovalRecord);
}

async function readStoredPendingApprovals() {
  const [pendingClientRecords, pendingQuotationRecords, recentDecisionRecords] = await Promise.all([
    PendingApproval.find({
      type: 'client',
      approvalStatus: { $in: ['PENDING', 'PARTIALLY_APPROVED', 'REVISION_REQUIRED'] }
    })
      .populate('actionBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean(),
    PendingApproval.find({
      type: 'quotation',
      approvalStatus: { $in: ['PENDING', 'PARTIALLY_APPROVED', 'REVISION_REQUIRED'] }
    })
      .populate('actionBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean(),
    PendingApproval.find({
      type: { $in: ['client', 'quotation'] },
      approvalStatus: { $in: ['APPROVED', 'REJECTED'] }
    })
      .populate('actionBy', 'name email')
      .sort({ actionAt: -1, createdAt: -1 })
      .limit(100)
      .lean()
  ]);
  const records = [...pendingClientRecords, ...pendingQuotationRecords, ...recentDecisionRecords];

  const clientRecords = records.filter((record) => record.type === 'client');
  const sourceClientIds = clientRecords.map((record) => record.sourceClientId).filter((id) => mongoose.Types.ObjectId.isValid(String(id)));
  const submittedClients = await Client.find({ _id: { $in: sourceClientIds }, workflowStatus: 'submitted' }).select('_id').lean();
  const submittedIds = new Set(submittedClients.map((client) => String(client._id)));
  const clientRows = clientRecords
    .filter((record) => submittedIds.has(String(record.sourceClientId)))
    .map(mapPendingApprovalRecord);

  return {
    pendingClients: clientRows,
    pendingQuotations: records
      .filter((record) => record.type === 'quotation' && (
        ['APPROVED', 'REJECTED'].includes(record.approvalStatus)
        || String(record.payload?.managementApprovalStatus || '').toUpperCase() === 'PENDING'
      ))
      .map(mapPendingApprovalRecord)
  };
}

function backgroundSyncPendingApprovals(clientRows = [], quotationRows = []) {
  setTimeout(async () => {
    try {
      await Promise.all([
        syncPendingApprovalRows(clientRows, 'client'),
        syncPendingApprovalRows(quotationRows, 'quotation')
      ]);
    } catch (err) {
      console.error('Pending approval background sync failed', err);
    }
  }, 0);
}

exports.listPurchaseSalesProgress = async (req, res) => {
  const financialYear = String(req.query.financialYear || '').trim();
  if (!/^20\d{2}-\d{2}$/.test(financialYear)) return res.status(400).json({ error: 'Valid financial year is required.' });
  const testLeadReferences = await getAdminCreatedLeadReferences();
  const clients = await Client.find(combineAccessFilters(
    await clientAccessFilter(req.user),
    dashboardClientExclusionFilter(testLeadReferences)
  )).select('_id').lean();
  const clientIds = clients.map((client) => client._id);
  const summarize = require('../services/purchaseSalesProgress');
  const projection = 'clientId checklist baseUpload portalUpload reconciliation managerVerificationStatus complianceVerificationStatus';
  const [purchase, sales] = await Promise.all([
    require('../models/PurchaseData').find({ clientId: { $in: clientIds }, financialYear }).select(projection).lean(),
    require('../models/SalesData').find({ clientId: { $in: clientIds }, financialYear }).select(projection).lean()
  ]);
  res.json({ ok: true, financialYear, purchase: summarize(purchase), sales: summarize(sales) });
};

exports.listClients = async (req, res) => {
  const startedAt = process.hrtime.bigint();
  const accessStartedAt = process.hrtime.bigint();
  const accessFilter = await clientAccessFilter(req.user);
  const accessMs = Number(process.hrtime.bigint() - accessStartedAt) / 1e6;
  const testLeadReferences = req.query.dashboard === 'true'
    ? await getAdminCreatedLeadReferences()
    : null;
  const baseFilter = combineAccessFilters(
    { 'data.importMeta.approvalOverride': { $ne: true } },
    accessFilter,
    testLeadReferences ? dashboardClientExclusionFilter(testLeadReferences) : {}
  );
  const paginated = req.query.page !== undefined || req.query.limit !== undefined || req.query.paginated === 'true';

  // Other CRM screens still consume the legacy full response. Client Master
  // explicitly requests this bounded directory representation.
  if (!paginated) {
    const queryStartedAt = process.hrtime.bigint();
    if (req.query.view === 'execution') {
      const clients = await Client.find(combineAccessFilters(baseFilter, { 'adminControls.approvalStatus': 'APPROVED' }))
        .select('data.basic.clientLegalName data.basic.tradeName data.basic.applicantType data.basic.subApplicantType data.basic.servicesOffered data.clientLifecycle.workFollowUps selectedLead adminControls.approvalStatus adminControls.assignedTo createdAt')
        .populate('selectedLead', 'leadCode company applicantType subApplicantType servicesOffered eprCategory serviceSelections.applicantType serviceSelections.piboParent serviceSelections.subApplicantType serviceSelections.piboCategory serviceSelections.servicesOffered serviceSelections.serviceName serviceSelections.eprCategory assignedStaffText closedAt closedByText assignReachedAt assignments.assignedStaffText assignments.assignedAt assignments.updatedAt assignments.closedAt assignments.poYearRows.poNumber assignments.poYearRows.poReceivedDate assignments.poYearRows.poDate')
        .populate('adminControls.assignedTo', 'name email')
        .sort({ createdAt: -1 }).lean();
      const queryMs = Number(process.hrtime.bigint() - queryStartedAt) / 1e6;
      res.set('Server-Timing', `access;dur=${accessMs.toFixed(1)}, query;dur=${queryMs.toFixed(1)}`);
      return res.json({ ok: true, clients });
    }
    const clients = await Client.find(baseFilter)
    .select([
      '-data.companyOverview.productImage',
      '-data.cpcbScreenshots', '-data.processDiagrams',
      '-data.cpcbDataByAssignedServiceId', '-data.serviceDetailsByAssignedServiceId',
      '-data.annualReturn', '-data.financials',
      '-data.compliance.gstFile', '-data.compliance.cinFile', '-data.compliance.panFile',
      '-data.compliance.factoryLicenseFile', '-data.compliance.eprCertificateFile',
      '-data.compliance.iecFile', '-data.compliance.dicDcssiFile',
      '-data.msmeRows.file', '-data.cte.plantWiseDetails.cteDocument',
      '-data.cte.plantWiseDetails.ctoDocument', '-data.authorised.panDocument',
      '-data.authorisedPersons.panDocument', '-data.authorised.aadhaarDocument',
      '-data.authorisedPersons.aadhaarDocument'
    ].join(' '))
    .populate('selectedLead', 'leadCode company status eprCategory applicantType subApplicantType piboParent serviceSelections createdBy createdByName createdByEmail importedCreatedBy assignedTo assignedToText assignedStaff assignedStaffText assignedStaffEmail assignments assignReachedAt closedAt closedByText createdAt updatedAt')
    .populate('createdBy', 'name email role avatarUrl')
    .populate('adminControls.assignedTo', 'name email role avatarUrl')
    .sort({ createdAt: -1 })
    .lean();
    const queryMs = Number(process.hrtime.bigint() - queryStartedAt) / 1e6;
    res.set('Server-Timing', `access;dur=${accessMs.toFixed(1)}, query;dur=${queryMs.toFixed(1)}`);
    return res.json({ ok: true, clients });
  }

  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
  const search = String(req.query.search || '').trim();
  const visibilityStatus = String(req.query.visibilityStatus || '').trim();
  const staff = String(req.query.staff || '').trim();
  const metric = String(req.query.metric || '').trim();
  const sortBy = ['createdAt', 'updatedAt', 'workflowStatus'].includes(String(req.query.sortBy))
    ? String(req.query.sortBy)
    : 'createdAt';
  const sortOrder = String(req.query.sortOrder).toLowerCase() === 'asc' ? 1 : -1;
  const filters = [baseFilter];
  if (search) {
    const expression = new RegExp(escapeSearchRegex(search.slice(0, 100)), 'i');
    filters.push({ $or: [
      { companyIdentity: expression }, { 'data.importMeta.uniqueId': expression },
      { 'data.importMeta.leadNumber': expression }, { 'data.importMeta.companyName': expression },
      { 'data.basic.clientLegalName': expression }, { 'data.basic.tradeName': expression },
      { 'data.registeredAddress.city': expression }, { 'data.registeredAddress.state': expression },
      { 'data.registeredAddress.pincode': expression }, { 'data.basic.eprCategory': expression },
      { 'data.basic.piboCategory': expression }, { 'data.cpcb.status': expression },
      { 'data.otp.mobile': expression }, { 'data.otp.personName': expression },
      { 'data.importMeta.createdBy': expression }, { 'data.importMeta.createdByEmail': expression }
    ] });
  }
  if (visibilityStatus) filters.push({ 'adminControls.visibilityStatus': visibilityStatus });
  if (staff) {
    const staffValues = [staff];
    if (mongoose.Types.ObjectId.isValid(staff)) staffValues.push(new mongoose.Types.ObjectId(staff));
    const staffExpression = new RegExp(`^${escapeSearchRegex(staff.replace(/^name:/, ''))}$`, 'i');
    const linkedLeadIds = await Lead.find(combineAccessFilters(
      await leadAccessFilter(req.user),
      { $or: [
        { assignedTo: { $in: staffValues } }, { assignedStaff: { $in: staffValues } },
        { 'assignments.assignedTo': { $in: staffValues } }, { 'assignments.assignedStaff': { $in: staffValues } },
        { assignedToText: staffExpression }, { assignedStaffText: staffExpression },
        { 'assignments.assignedToText': staffExpression }, { 'assignments.assignedStaffText': staffExpression }
      ] }
    )).distinct('_id');
    const linkedLeadValues = linkedLeadIds.flatMap((id) => [id, String(id)]);
    filters.push({ $or: [
      { 'adminControls.assignedTo': { $in: staffValues } },
      { 'data.importMeta.assignedTo': staffExpression },
      ...(linkedLeadValues.length ? [
        { selectedLead: { $in: linkedLeadIds } },
        { 'data.selectedLead': { $in: linkedLeadValues } },
        { 'data.selectedLeadSnapshot.id': { $in: linkedLeadValues } }
      ] : [])
    ] });
  }
  if (metric === 'annual') filters.push({ $or: [
    { 'data.basic.firstAnnualReturnYear': { $exists: true, $nin: ['', null] } },
    { 'data.firstAnnualReturnYearApplicable': { $exists: true, $nin: ['', null] } }
  ] });
  if (metric === 'processed') filters.push({ 'data.cpcb.status': 'Approved' });
  if (metric === 'pending') filters.push({ 'data.cpcb.status': { $in: ['Not Started', 'Applied', 'Under Review'] } });
  if (metric === 'progress') filters.push({ 'data.cpcb.status': 'Under Review' });
  if (metric === 'rejected') filters.push({ 'data.cpcb.status': 'Rejected' });
  if (metric === 'discontinued') filters.push({ 'adminControls.visibilityStatus': { $in: ['DISCONTINUED', 'SUSPENDED'] } });
  const filter = combineAccessFilters(...filters);
  const projection = inclusionProjection([
    '_id', 'selectedLead', 'assignedServiceId', 'companyIdentity', 'adminControls',
    'workflowStatus', 'createdBy', 'createdAt', 'updatedAt', 'submittedAt', 'serviceAllocations',
    'data.selectedLead', 'data.assignedServiceId', 'data.selectedLeadSnapshot',
    'data.basic.clientLegalName', 'data.basic.tradeName', 'data.basic.eprCategory',
    'data.basic.piboCategory', 'data.basic.firstAnnualReturnYear',
    'data.registeredAddress.state',
    'data.msmeRows.label', 'data.msmeRows.classificationYear', 'data.msmeRows.status',
    'data.msmeRows.majorActivity', 'data.msmeRows.udyamNumber', 'data.msmeRows.turnover', 'data.msmeRows.value',
    'data.cpcb.status', 'data.importMeta.uniqueId', 'data.importMeta.leadNumber',
    'data.importMeta.companyName', 'data.importMeta.assignedTo', 'data.importMeta.createdBy',
    'data.importMeta.createdByEmail', 'data.companyOverview.companyName',
    ...(req.query.allocation === 'true' ? [
      'services', 'data.basic', 'data.importMeta', 'data.selectedLeadSnapshot',
      'data.authorisedContact', 'data.authorizedContact'
    ] : []),
    ...(req.query.dashboard === 'true' ? [
      'services', 'data.basic', 'data.importMeta', 'data.selectedLeadSnapshot', 'data.assignedServiceId',
      'data.otp.mobile', 'data.otp.email', 'data.authorised.mobile', 'data.authorised.email',
      'data.coordinating.mobile', 'data.coordinating.email', 'data.financials', 'data.validation'
    ] : []),
    ...(req.query.export === 'true' ? [
      'services', 'data.basic.financialYear', 'data.basic.servicesForYear', 'data.basic.registrationYear',
      'data.basic.financialYears', 'data.basic.annualReturnYear', 'data.basic.annualReturnYears',
      'data.basic.firstAnnualReturnYearApplicable', 'data.financialYear', 'data.financialYears',
      'data.servicesForYear', 'data.annualReturnYear', 'data.annualReturnYears',
      'data.firstAnnualReturnYearApplicable', 'data.financials',
      'data.basic.servicesOffered', 'data.basic.companyIndustry', 'data.basic.website',
      'data.registeredAddress', 'data.communicationAddress', 'data.otp',
      'data.authorised.name', 'data.authorised.designation', 'data.authorised.mobile', 'data.authorised.email',
      'data.coordinating.name', 'data.coordinating.designation', 'data.coordinating.mobile', 'data.coordinating.email',
      'data.compliance.gst', 'data.compliance.gstDate', 'data.compliance.cin', 'data.compliance.cinDate',
      'data.compliance.pan', 'data.compliance.panDate', 'data.compliance.factoryLicense',
      'data.compliance.factoryLicenseDate', 'data.compliance.factoryLicenseApplicability',
      'data.compliance.brandOwnerProductionFacility', 'data.compliance.eprCertificate'
    ] : [])
  ]);
  const queryStartedAt = process.hrtime.bigint();
  const [clients, total, summaryRows] = await Promise.all([
    Client.find(filter).select(projection)
      .populate({
        path: 'selectedLead',
        select: 'leadCode company status eprCategory applicantType subApplicantType piboParent firstAnnualReturnYearApplicable serviceSelections assignedTo assignedToText assignedStaff assignedStaffText assignedStaffEmail assignments createdBy createdByName createdByEmail createdByCrmUserId importedCreatedBy generatedForUser generatedForName generatedForEmail createdOnBehalfOfUser createdOnBehalfOfName createdOnBehalfOfEmail',
        populate: ['createdBy', 'generatedForUser', 'createdOnBehalfOfUser'].map(path => ({ path, select: 'name email' }))
      })
      .populate('createdBy', 'name email role avatarUrl')
      .populate('adminControls.assignedTo', 'name email role avatarUrl')
      .sort({ [sortBy]: sortOrder, _id: sortOrder })
      .skip((page - 1) * limit).limit(limit).lean(),
    Client.countDocuments(filter),
    Client.aggregate([
      { $match: baseFilter },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        annual: { $sum: { $cond: [{ $or: [
          { $gt: [{ $ifNull: ['$data.basic.firstAnnualReturnYear', ''] }, ''] },
          { $gt: [{ $ifNull: ['$data.firstAnnualReturnYearApplicable', ''] }, ''] }
        ] }, 1, 0] } },
        processed: { $sum: { $cond: [{ $eq: ['$data.cpcb.status', 'Approved'] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $in: ['$data.cpcb.status', ['Not Started', 'Applied', 'Under Review']] }, 1, 0] } },
        progress: { $sum: { $cond: [{ $eq: ['$data.cpcb.status', 'Under Review'] }, 1, 0] } },
        rejected: { $sum: { $cond: [{ $eq: ['$data.cpcb.status', 'Rejected'] }, 1, 0] } },
        discontinued: { $sum: { $cond: [{ $in: ['$adminControls.visibilityStatus', ['DISCONTINUED', 'SUSPENDED']] }, 1, 0] } }
      } }
    ])
  ]);
  if (req.query.export === 'true' && clients.length) {
    const leadIds = clients.map(client => client.selectedLead?._id).filter(Boolean);
    const poApprovals = await PendingApproval.find({ type: 'purchase_order', 'payload.leadId': { $in: leadIds.flatMap(id => [id, String(id)]) } })
      .select('approvalStatus payload.leadId payload.assignedServiceId payload.assignmentIndex payload.poYearRows.poNumber payload.poYearRows.poFinancialYear payload.poYearRows.annualReturnYear payload.poYearRows.fy payload.poYearRows.registrationYear').lean();
    const byLead = new Map();
    poApprovals.forEach(approval => {
      const key = String(approval.payload.leadId);
      if (!byLead.has(key)) byLead.set(key, []);
      byLead.get(key).push(approval);
    });
    clients.forEach(client => { client.poApprovals = byLead.get(String(client.selectedLead?._id || '')) || []; });
  }
  if (req.query.dashboard === 'true' && clients.length) {
    const [approvals, complianceReviews] = await Promise.all([
      PendingApproval.find({
        type: 'client', source: 'crm', sourceClientId: { $in: clients.map((client) => String(client._id)) }
      }).select('sourceClientId approvalStatus actionAt createdAt reminderFlag redFlagAt greenFlagDeadline correctionStatus correctionStartedAt correctionDueAt correctionBreachedAt correctionDeadlinePolicy').lean(),
      ClientComplianceReview.find({ client: { $in: clients.map((client) => client._id) } })
        .select('client status sections finalRemarks updatedAt')
        .populate('sections.reviewedBy', 'name email').lean()
    ]);
    const reviewByClient = new Map(complianceReviews.map((review) => [String(review.client), review]));
    clients.forEach((client) => { client.complianceReview = reviewByClient.get(String(client._id)) || null; });
    const approvalByClient = new Map(approvals.map((approval) => [String(approval.sourceClientId), approval]));
    clients.forEach((client) => { client.operationsSla = approvalByClient.get(String(client._id)) || null; });
  }
  const queryMs = Number(process.hrtime.bigint() - queryStartedAt) / 1e6;
  const totalMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const summary = summaryRows[0] || { total: 0, annual: 0, processed: 0, pending: 0, progress: 0, rejected: 0, discontinued: 0 };
  res.set('Server-Timing', `access;dur=${accessMs.toFixed(1)}, query;dur=${queryMs.toFixed(1)}, total;dur=${totalMs.toFixed(1)}`);
  return res.json({
    ok: true,
    clients,
    pagination: {
      page, limit, total, totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1
    },
    summary,
    timings: process.env.API_PERF_TIMINGS === 'true' ? { accessMs, queryMs, totalMs } : undefined
  });
};

exports.listClientMasterCatalog = async (req, res) => {
  const startedAt = Date.now();
  const records = await Client.find(await clientAccessFilter(req.user))
    .select([
      '_id', 'selectedLead', 'assignedServiceId', 'workflowStatus',
      'data.selectedLead', 'data.assignedServiceId', 'data.selectedLeadSnapshot',
      'data.basic.clientLegalName', 'data.basic.tradeName', 'data.basic.piboCategory',
      'data.basic.eprCategory', 'data.basic.servicesOffered', 'data.basic.plantUnit',
      'data.basic.companyIndustry', 'data.companyOverview.companyName',
      'data.importMeta.companyName', 'data.importMeta.leadNumber', 'data.importMeta.uniqueId', 'data.cpcbOnboarding',
      'companyName', 'clientLegalName', 'tradeName', 'piboCategory', 'eprCategory',
      'servicesOffered', 'plantUnit', 'industryType', 'applicantType'
    ].join(' '))
    .populate('selectedLead', 'leadCode company')
    .sort({ updatedAt: -1 })
    .lean();
  const clientMasters = records.map(normalizeClientMaster).filter((item) => item.clientMasterId);
  console.info('[ClientMaster discovery]', {
    userId: String(req.user?._id || ''),
    count: clientMasters.length,
    ms: Date.now() - startedAt
  });
  return res.json({ ok: true, clientMasters });
};

exports.listDashboardComplianceRecords = async (req, res) => {
  const startedAt = Date.now();
  const testLeadReferences = await getAdminCreatedLeadReferences();
  const records = await Client.find(combineAccessFilters(
    await clientAccessFilter(req.user),
    dashboardClientExclusionFilter(testLeadReferences)
  ))
    .select([
      '_id', 'selectedLead', 'assignedServiceId', 'workflowStatus',
      'data.assignedServiceId', 'data.selectedLeadSnapshot',
      'data.basic.eprCategory', 'data.basic.piboCategory',
      'data.basic.applicantType', 'data.basic.subApplicantType',
      'data.basic.servicesOffered', 'data.basic.applicableService',
      'data.basic.firstAnnualReturnYear', 'data.basic.servicesForYear',
      'data.basic.registrationYear', 'data.firstAnnualReturnYearApplicable',
      'eprCategory', 'serviceCategory', 'applicantType', 'subApplicantType',
      'piboParent', 'piboCategory', 'servicesOffered', 'applicableService',
      'firstAnnualReturnYear', 'servicesForYear', 'financialYear', 'registrationYear'
    ].join(' '))
    .populate('selectedLead', 'leadCode company serviceSelections')
    .sort({ updatedAt: -1 })
    .lean();
  return res.json({
    ok: true,
    clients: records,
    debug: { source: 'client-master-only', records: records.length, ms: Date.now() - startedAt }
  });
};

function escapeSearchRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clientDiscoveryProjection() {
  return [
    '_id', 'selectedLead', 'assignedServiceId', 'workflowStatus',
    'data.selectedLead', 'data.assignedServiceId', 'data.selectedLeadSnapshot',
    'data.basic.clientLegalName', 'data.basic.tradeName', 'data.basic.piboCategory',
    'data.basic.eprCategory', 'data.basic.servicesOffered', 'data.basic.plantUnit',
    'data.basic.companyIndustry', 'data.companyOverview.companyName',
    'data.importMeta.companyName', 'data.importMeta.leadNumber', 'data.importMeta.uniqueId', 'data.cpcbOnboarding',
    'companyIdentity', 'companyName', 'clientLegalName', 'tradeName', 'piboCategory',
    'eprCategory', 'servicesOffered', 'plantUnit', 'industryType', 'applicantType'
  ].join(' ');
}

function clientMasterGroupCountForLead(lead = {}) {
  const normalize = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const services = Array.isArray(lead.serviceSelections) ? lead.serviceSelections : [];
  const groups = new Set();
  services.forEach((service, index) => {
    const applicantType = normalize(service?.applicantType || service?.piboParent || service?.piboCategoryParent);
    const subApplicantType = normalize(service?.subApplicantType || service?.piboCategory || 'not-applicable') || 'notapplicable';
    const plantUnit = normalize(service?.plantUnit);
    groups.add(applicantType && plantUnit ? `${applicantType}:${subApplicantType}:${plantUnit}` : `service:${index}`);
  });
  return groups.size;
}

function clientMasterServiceClosureSummary(lead = {}) {
  const services = Array.isArray(lead.serviceSelections) && lead.serviceSelections.length
    ? lead.serviceSelections
    : [lead];
  return {
    totalServiceCount: services.length,
    closedServiceCount: services.filter((_, index) => serviceClosedAt(lead, index)).length
  };
}

exports.searchClientMasterCompanies = async (req, res) => {
  const startedAt = Date.now();
  const query = String(req.query.q || '').trim();
  const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 20));
  if (query.length < 2) return res.json({ ok: true, items: [], count: 0, queryMs: 0 });

  const normalizedCompany = normalizeCompanyIdentity(query);
  const rawRegex = new RegExp(escapeSearchRegex(query), 'i');
  const identityRegex = new RegExp(escapeSearchRegex(normalizedCompany), 'i');
  const leadFilter = { $and: [
    { $or: [
      { companyIdentity: identityRegex },
      { company: rawRegex },
      { leadCode: rawRegex },
      { sourceLeadId: rawRegex }
    ] },
    { $or: [
      { closedBy: { $exists: true, $ne: null } },
      { closedByText: { $exists: true, $ne: '' } },
      { closedAt: { $exists: true, $ne: null } },
      { 'assignments.closedBy': { $exists: true, $ne: null } },
      { 'assignments.closedByText': { $exists: true, $ne: '' } },
      { 'assignments.closedAt': { $exists: true, $ne: null } }
    ] }
  ] };
  const clientFilter = { $or: [
    { companyIdentity: identityRegex },
    { 'data.basic.clientLegalName': rawRegex },
    { 'data.basic.tradeName': rawRegex },
    { 'data.companyOverview.companyName': rawRegex },
    { 'data.importMeta.companyName': rawRegex },
    { 'data.importMeta.leadNumber': rawRegex },
    { 'data.importMeta.uniqueId': rawRegex },
    { 'data.selectedLeadSnapshot.leadCode': rawRegex }
  ] };

  const [leads, clientRecords] = await Promise.all([
    Lead.find(combineAccessFilters(leadFilter, await leadAccessFilter(req.user)))
      .select('_id leadCode sourceLeadId company companyIdentity serviceSelections assignments closedBy closedByText closedAt')
      .limit(limit)
      .lean(),
    Client.find(combineAccessFilters(clientFilter, await clientAccessFilter(req.user)))
      .select(clientDiscoveryProjection())
      .limit(limit * 2)
      .lean()
  ]);

  const items = new Map();
  leads.forEach((lead) => {
    const leadId = String(lead._id || '');
    const closureSummary = clientMasterServiceClosureSummary(lead);
    items.set(`lead:${leadId}`, {
      selectionKey: leadId,
      leadId,
      clientMasterId: null,
      companyName: String(lead.company || '').trim(),
      leadCode: String(lead.leadCode || lead.sourceLeadId || '').trim(),
      serviceGroupCount: clientMasterGroupCountForLead(lead),
      ...closureSummary,
      clientMasterIds: new Set()
    });
  });

  clientRecords.map(normalizeClientMaster).forEach((master) => {
    if (!master.clientMasterId) return;
    const masterCompany = normalizeCompanyIdentity(master.companyName);
    const existing = [...items.values()].find((item) => (
      (master.selectedLead && master.selectedLead === item.leadId)
      || (master.leadCode && item.leadCode && master.leadCode.toLowerCase() === item.leadCode.toLowerCase())
      || (masterCompany && masterCompany === normalizeCompanyIdentity(item.companyName))
    ));
    const item = existing || {
      selectionKey: `client:${master.clientMasterId}`,
      leadId: master.selectedLead || null,
      clientMasterId: master.clientMasterId,
      companyName: master.companyName || 'Existing Client Master',
      leadCode: master.leadCode || '',
      clientMasterIds: new Set()
    };
    item.clientMasterIds.add(master.clientMasterId);
    if (!existing) items.set(`client:${master.clientMasterId}`, item);
  });

  const responseItems = [...items.values()]
    .sort((left, right) => left.companyName.localeCompare(right.companyName))
    .slice(0, limit)
    .map((item) => ({
    selectionKey: item.selectionKey,
    leadId: item.leadId,
    clientMasterId: item.clientMasterId,
    companyName: item.companyName,
    leadCode: item.leadCode,
    clientMasterCount: item.serviceGroupCount || item.clientMasterIds.size,
    closedServiceCount: item.closedServiceCount,
    totalServiceCount: item.totalServiceCount
    }));
  return res.json({ ok: true, items: responseItems, count: responseItems.length, queryMs: Date.now() - startedAt });
};

exports.listClientReviewApplicants = async (req, res) => {
  if (!userHasAnyRole(req.user, CLIENT_APPROVAL_ROLES)) return res.status(403).json({ error: 'Client review access required' });
  return exports.listClientMasterServices({ ...req, query: { identity: `client:${req.params.id}` } }, res, { clientReview: true });
};

exports.listClientMasterServices = async (req, res, options = {}) => {
  const identity = String(req.query.identity || req.query.leadId || req.query.clientMasterId || '').trim();
  if (!identity) return res.status(400).json({ error: 'Client or Lead identity is required' });

  const explicitClientId = identity.startsWith('client:') ? identity.slice(7) : String(req.query.clientMasterId || '').trim();
  // Reviewers can inspect the same Client Masters available to the review API.
  // Keep ordinary Client Master discovery restricted to ownership visibility.
  const reviewerDiscovery = options.clientReview === true && userHasAnyRole(req.user, CLIENT_APPROVAL_ROLES);
  const clientVisibility = reviewerDiscovery ? {} : await clientAccessFilter(req.user);
  const leadVisibility = reviewerDiscovery ? { _id: { $exists: false } } : await leadAccessFilter(req.user);
  const baseClient = mongoose.Types.ObjectId.isValid(explicitClientId)
    ? await Client.findOne(combineAccessFilters({ _id: explicitClientId }, clientVisibility)).select(clientDiscoveryProjection()).lean()
    : null;
  const baseIdentity = baseClient ? normalizeClientMaster(baseClient) : null;
  const leadId = String(baseIdentity?.selectedLead || (mongoose.Types.ObjectId.isValid(identity) && !explicitClientId ? identity : '')).trim();
  const lead = mongoose.Types.ObjectId.isValid(leadId) ? await Lead.findOne(combineAccessFilters({ _id: leadId }, leadVisibility)).lean() : null;
  const leadCode = String(lead?.leadCode || lead?.sourceLeadId || baseIdentity?.leadCode || '').trim();
  const companyName = String(lead?.company || baseIdentity?.companyName || '').trim();
  const candidates = [];
  if (leadId) {
    candidates.push(leadId);
    if (mongoose.Types.ObjectId.isValid(leadId)) candidates.push(new mongoose.Types.ObjectId(leadId));
  }
  const relatedFilters = [];
  if (candidates.length) {
    relatedFilters.push(
      { selectedLead: { $in: candidates } },
      { 'data.selectedLead': { $in: candidates } },
      { 'data.selectedLeadSnapshot.id': { $in: candidates } },
      { 'data.selectedLeadSnapshot.sourceLeadId': { $in: candidates } }
    );
  }
  if (leadCode) {
    const exactCode = new RegExp(`^${escapeSearchRegex(leadCode)}$`, 'i');
    relatedFilters.push(
      { 'data.selectedLeadSnapshot.leadCode': exactCode },
      { 'data.importMeta.leadNumber': exactCode },
      { 'data.importMeta.uniqueId': exactCode }
    );
  }
  const companyIdentity = normalizeCompanyIdentity(companyName);
  if (companyIdentity) relatedFilters.push({ companyIdentity });
  if (explicitClientId && mongoose.Types.ObjectId.isValid(explicitClientId)) {
    relatedFilters.push({ _id: new mongoose.Types.ObjectId(explicitClientId) });
  }

  const records = relatedFilters.length
    ? await Client.collection.find(combineAccessFilters({ $or: relatedFilters }, clientVisibility), { projection: {
        _id: 1, selectedLead: 1, assignedServiceId: 1, workflowStatus: 1,
        'data.selectedLead': 1, 'data.assignedServiceId': 1, 'data.selectedLeadSnapshot': 1,
        'data.basic.clientLegalName': 1, 'data.basic.tradeName': 1, 'data.basic.piboCategory': 1,
        'data.basic.eprCategory': 1, 'data.basic.servicesOffered': 1, 'data.basic.plantUnit': 1,
        'data.basic.companyIndustry': 1, 'data.companyOverview.companyName': 1,
        'data.cpcb.ceprUserId': 1, 'data.cpcb.ceprPassword': 1,
        'data.cpcbDataByAssignedServiceId': 1, 'data.serviceDetailsByAssignedServiceId.cpcb': 1,
        'data.importMeta.companyName': 1, 'data.importMeta.leadNumber': 1, 'data.importMeta.uniqueId': 1,
        'data.cpcbOnboarding': 1,
        companyIdentity: 1, companyName: 1, clientLegalName: 1, tradeName: 1,
        piboCategory: 1, eprCategory: 1, servicesOffered: 1, plantUnit: 1,
        industryType: 1, applicantType: 1
      } }).sort({ workflowStatus: -1, updatedAt: -1 }).toArray()
    : [];
  const services = records.map(normalizeClientMaster).filter((item) => item.clientMasterId);
  if (lead && !isLeadEligibleForClientMaster(lead) && !services.length) {
    return res.status(409).json({ error: CLIENT_MASTER_CLOSED_LEAD_ERROR, code: 'LEAD_NOT_CLOSED' });
  }
  const discoveryLead = lead ? { ...lead, clientMasterEligibleServiceIds: eligibleServiceIds(lead) } : lead;
  return res.json({ ok: true, lead: discoveryLead, services, count: services.length });
};

exports.getClient = async (req, res) => {
  const clientId = String(req.params.id || '').trim();
  if (!mongoose.Types.ObjectId.isValid(clientId)) {
    return res.status(400).json({ error: 'Invalid Client Master ID' });
  }

  // Keep exact-record access identical to list/search discovery. Legacy imports
  // may store the responsible CRM user in importMeta.user/createdBy fields
  // instead of adminControls.assignedTo; using the narrower filter here made
  // those records visible in the selector but returned 404 when opened.
  const client = await Client.findOne(combineAccessFilters(
    { _id: clientId },
    await clientAccessFilter(req.user)
  ))
    .populate('selectedLead', 'leadCode company status leadDate importedCreatedAt importedUpdatedAt createdAt updatedAt closedAt closureDate closedBy closedByText closedOnBehalfOfName emails mobileNo1 piboCategory eprCategory addressLine1 addressLine2 addressLine3 state city pinCode contactPerson designation serviceSelections addresses contacts assignments')
    .populate('adminControls.assignedTo', 'name email role avatarUrl');

  if (!client) return res.status(404).json({ error: 'Client Master record not found' });
  const requestedAssignedServiceId = String(req.query.assignedServiceId || '').trim();
  const identityError = validateClientMasterIdentity(client, { assignedServiceId: requestedAssignedServiceId });
  if (identityError) return res.status(409).json({ error: identityError });
  return res.json({
    ok: true,
    client,
    identity: normalizeClientMaster(client),
    resolvedData: resolveClientMasterData(client, requestedAssignedServiceId)
  });
};

// SLA uses the same record visibility rules as the Client Master directory.
exports.getClientSla = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid Client Master ID' });
    const client = await Client.findOne(combineAccessFilters({ _id: req.params.id }, await clientAccessFilter(req.user))).select('sla');
    if (!client) return res.status(404).json({ error: 'Client Master record not found' });
    const { validationError } = require('../services/clientSla');
    const sla = client.sla || {};
    res.json({ ok: true, sla, ready: !validationError(sla) });
  } catch (error) { res.status(500).json({ error: 'Unable to load SLA details.' }); }
};
exports.updateClientSla = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid Client Master ID' });
    const client = await Client.findOne(combineAccessFilters({ _id: req.params.id }, await clientAccessFilter(req.user)));
    if (!client) return res.status(404).json({ error: 'Client Master record not found' });
    const { validationError, cleanSla } = require('../services/clientSla');
    const invalid = validationError(req.body || {});
    if (invalid) return res.status(400).json({ error: invalid, ready: false });
    client.sla = { ...cleanSla(req.body), updatedAt: new Date(), updatedBy: req.user?._id, updatedByName: req.user?.name || req.user?.email || 'CRM User' };
    client.markModified('sla');
    await client.save();
    res.json({ ok: true, sla: client.sla, ready: true });
  } catch (error) { res.status(500).json({ error: 'Unable to save SLA details.' }); }
};

exports.updateCpcbOnboarding = async (req, res) => {
  const clientMasterId = String(req.body.clientMasterId || '').trim();
  const assignedServiceId = String(req.body.assignedServiceId || '').trim();
  const selectedLead = readSelectedLeadId(req.body.selectedLead);
  const registered = req.body.cpcbPortalRegistered;
  const applicationStatus = String(req.body.cpcbApplicationStatus || '').trim();
  const validationError = validateCpcbOnboardingInput(registered, applicationStatus);
  if (validationError) return res.status(400).json({ error: validationError });
  if (!assignedServiceId) return res.status(400).json({ error: 'Assigned service is required' });
  if (clientMasterId && !mongoose.Types.ObjectId.isValid(clientMasterId)) return res.status(400).json({ error: 'Invalid Client Master ID' });

  const scope = await getVisibleUserScope(req.user);
  const visibility = ownerFilter(scope, 'createdBy', 'adminControls.assignedTo', ['data.importMeta.assignedTo']);
  let client = clientMasterId
    ? await Client.findOne({ _id: clientMasterId, ...visibility })
    : selectedLead
      ? await Client.findOne({ selectedLead, ...visibility, $or: [
          { assignedServiceId },
          { 'data.assignedServiceId': assignedServiceId },
          { 'data.selectedLeadSnapshot.assignedServiceId': assignedServiceId }
        ] })
      : null;

  if (clientMasterId && !client) return res.status(404).json({ error: 'Client Master record not found' });
  const creatingClient = !client;
  if (!client) {
    if (!selectedLead) return res.status(400).json({ error: 'Selected lead is required for first-time CPCB onboarding' });
    const eligibilityError = await validateNewClientLeadEligibility(selectedLead, assignedServiceId, req.user);
    if (eligibilityError) return res.status(409).json({ error: eligibilityError, code: eligibilityError === CLIENT_MASTER_CLOSED_LEAD_ERROR ? 'LEAD_NOT_CLOSED' : 'LEAD_NOT_FOUND' });
    const bootstrapData = isPlainObject(req.body.bootstrapData) ? req.body.bootstrapData : {};
    client = new Client({
      selectedLead,
      assignedServiceId,
      companyIdentity: normalizeCompanyIdentity(bootstrapData.basic?.clientLegalName || bootstrapData.companyOverview?.companyName || ''),
      workflowStatus: 'draft',
      createdBy: req.user?._id,
      data: { ...bootstrapData, assignedServiceId }
    });
  }
  // A Client Master id is the canonical identity for an existing record. Lead
  // service assignment ids can be regenerated by older imports/edits, so use
  // the persisted id when continuing that exact record instead of rejecting a
  // valid CPCB status update with 409.
  const persistedAssignedServiceId = readClientAssignedServiceId(client, client?.data || {});
  const effectiveAssignedServiceId = clientMasterId && persistedAssignedServiceId
    ? persistedAssignedServiceId
    : assignedServiceId;
  const identityError = validateClientMasterIdentity(client, { assignedServiceId: effectiveAssignedServiceId, selectedLead });
  if (identityError) return res.status(409).json({ error: identityError });

  const changedAt = new Date();
  const data = applyCpcbOnboardingData(client.data, {
    registered,
    applicationStatus,
    userId: req.user?._id,
    changedAt
  });
  client.assignedServiceId = effectiveAssignedServiceId;
  client.data = data;
  client.markModified('data');
  await client.save();
  await syncStaffOnboardingCpcbStatus({
    leadKey: client.selectedLead,
    staffId: req.user?._id,
    registered,
    now: changedAt
  });
  return res.status(creatingClient ? 201 : 200).json({ ok: true, client, identity: normalizeClientMaster(client), resolvedData: resolveClientMasterData(client, effectiveAssignedServiceId) });
};

exports.getAnnualReturnPoStatus = async (req, res) => {
  const clientId = String(req.params.id || '').trim();
  if (!mongoose.Types.ObjectId.isValid(clientId)) {
    return res.status(400).json({ error: 'Invalid Client Master ID' });
  }
  const years = String(req.query.years || '')
    .split(',')
    .map(normalizeFinancialYear)
    .filter(Boolean)
    .slice(0, 20);
  if (!years.length) return res.status(400).json({ error: 'At least one valid financial year is required' });

  const scope = await getVisibleUserScope(req.user);
  const query = Client.findOne({
    _id: clientId,
    ...ownerFilter(scope, 'createdBy', 'adminControls.assignedTo', ['data.importMeta.assignedTo'])
  }).select('selectedLead assignedServiceId data.assignedServiceId data.basic.piboCategory data.selectedLead data.sourceLeadId data.leadId data.selectedLeadSnapshot data.importMeta.leadNumber data.annualReturn.filings');
  const client = typeof query.lean === 'function' ? await query.lean() : await query;
  if (!client) return res.status(404).json({ error: 'Client Master record not found' });

  const result = await resolveAnnualReturnPO({ clientMaster: client, financialYears: years });
  return res.json({ success: true, ...result });
};

exports.listPendingApprovals = async (req, res) => {
  const startedAt = Date.now();
  const isAdministrativeReviewer = userHasAnyRole(req.user, ['admin', 'superadmin']);
  const isClientReviewer = isAdministrativeReviewer || userHasAnyRole(req.user, ['compliance']);

  // PendingApproval is a read-optimised index. Older quotations (or writes made
  // while the index update failed) can still be pending in the source
  // collection without having an index row. Reconcile only quotations here;
  // unlike the former full client + quotation scan, this indexed query stays
  // small and keeps the approval page responsive.
  const storedApprovalsPromise = readStoredPendingApprovals();
  const liveQuotationsPromise = isAdministrativeReviewer
    ? Quotation.find({ 'managementApproval.status': 'PENDING', status: { $in: ['draft', 'submitted', 'sent', 'admin_approved'] } })
        .populate('createdBy', 'name email')
        .sort({ createdAt: -1 })
        .limit(500)
        .lean()
        .catch((error) => {
          console.error('Pending quotation reconciliation failed', error);
          return [];
        })
    : Promise.resolve([]);
  const [storedFallback, liveQuotations] = await Promise.all([storedApprovalsPromise, liveQuotationsPromise]);
  const liveQuotationRows = liveQuotations.map((quotation) => mapQuotationPendingApprovalRow(quotation, 'CREATE'));

  const storedQuotationIds = new Set(storedFallback.pendingQuotations.map((row) => String(
    row.quotationId || row.payload?.quotationId || row.sourceClientId || row.id || row._id || ''
  )).filter(Boolean));
  const missingQuotationRows = liveQuotationRows.filter((row) => !storedQuotationIds.has(String(row.quotationId || row.id || '')));
  const responseQuotations = [...missingQuotationRows, ...storedFallback.pendingQuotations];
  if (missingQuotationRows.length) backgroundSyncPendingApprovals([], missingQuotationRows);
  const compact = req.query.compact === 'true';
  const compactRow = (row = {}) => ({
    approvalRecordId: row.approvalRecordId,
    id: row.id,
    sourceClientId: row.sourceClientId,
    quotationId: row.quotationId,
    source: row.source,
    uniqueId: row.uniqueId,
    clientName: row.clientName,
    companyName: row.companyName,
    approvalStatus: row.approvalStatus,
    managementApprovalStatus: row.managementApprovalStatus,
    piboCategory: row.piboCategory,
    eprCategory: row.eprCategory,
    createdBy: row.createdBy,
    requestDate: row.requestDate,
    requestTime: row.requestTime,
    decisionBy: row.decisionBy,
    decisionAt: row.decisionAt
  });

  res.json({
    ok: true,
    pendingClients: isClientReviewer ? (compact ? storedFallback.pendingClients.map(compactRow) : storedFallback.pendingClients) : [],
    pendingQuotations: isAdministrativeReviewer ? (compact ? responseQuotations.map(compactRow) : responseQuotations) : [],
    debug: {
      source: missingQuotationRows.length ? 'indexed-with-live-reconciliation' : 'indexed-pending-approvals',
      ms: Date.now() - startedAt,
      storedClients: storedFallback.pendingClients.length,
      storedQuotations: storedFallback.pendingQuotations.length,
      recoveredQuotations: missingQuotationRows.length
    }
  });
};

exports.createClient = async (req, res) => {
  const workflowStatus = readRequestedClientWorkflowStatus(req.body.workflowStatus);
  if (!workflowStatus) return res.status(400).json({ error: 'Invalid Client Master workflow status' });
  const { data, adminControls } = normalizeClientRequestPayload(req.body);
  const selectedLead = readSelectedLeadId(req.body.selectedLead);
  const assignedServiceId = readClientAssignedServiceId(req.body, data);
  const requestedClientId = readRequestedClientId(req.body);

  if (requestedClientId && !mongoose.Types.ObjectId.isValid(requestedClientId)) {
    return res.status(400).json({ error: 'Invalid Client Master record ID' });
  }

  if (!assignedServiceId) {
    return res.status(400).json({ error: 'Assigned service is required to save Client Master data' });
  }

  if (workflowStatus === 'submitted' && !data?.basic?.clientLegalName) {
    return res.status(400).json({ error: 'Client Legal Name is required before submit' });
  }
  const completionError = validateClientSubmissionCompletion(data, workflowStatus);
  if (completionError) return res.status(400).json({ error: completionError });

  const existingClient = requestedClientId
    ? await Client.findOne(combineAccessFilters({ _id: requestedClientId }, await clientAccessFilter(req.user)))
    : selectedLead && req.user?._id
      ? await Client.findOne({
        selectedLead,
        createdBy: req.user._id,
        $or: [
          { assignedServiceId },
          { 'data.assignedServiceId': assignedServiceId },
          { 'data.selectedLeadSnapshot.assignedServiceId': assignedServiceId }
        ]
        })
      : null;
  if (requestedClientId && !existingClient) {
    return res.status(404).json({ error: 'Client Master draft not found' });
  }
  if (existingClient) {
    const identityError = validateClientMasterIdentity(existingClient, { assignedServiceId, selectedLead });
    if (identityError) return res.status(409).json({ error: identityError });
  }
  if (!existingClient) {
    const eligibilityError = await validateNewClientLeadEligibility(selectedLead, assignedServiceId, req.user);
    if (eligibilityError) return res.status(409).json({ error: eligibilityError, code: eligibilityError === CLIENT_MASTER_CLOSED_LEAD_ERROR ? 'LEAD_NOT_CLOSED' : 'LEAD_NOT_FOUND' });
  }
  const transition = getClientWorkflowTransition(existingClient?.workflowStatus || 'draft', workflowStatus);
  if (transition.error) return res.status(409).json({ error: transition.error });
  const client = existingClient || new Client();
  client.selectedLead = selectedLead;
  client.assignedServiceId = assignedServiceId;
  client.adminControls = adminControls;
  client.data = existingClient ? mergeAssignedServiceCpcbData(existingClient.data, data) : data;
  client.workflowStatus = workflowStatus;
  client.createdBy = existingClient?.createdBy || req.user?._id;
  if (transition.becameSubmitted) applyClientSubmissionMetadata(client, req.user?._id);
  client.markModified('data');
  await client.save();

  if (transition.becameSubmitted) await queueCreatedClientApproval(client, req.user);

  res.status(existingClient ? 200 : 201).json({ ok: true, client, alreadySubmitted: transition.alreadySubmitted });
};

async function createClientRecord(row, user) {
  const workflowStatus = row.workflowStatus === 'submitted' ? 'submitted' : 'draft';
  const { data, adminControls } = normalizeClientRequestPayload(row);
  const selectedLead = readSelectedLeadId(row.selectedLead);
  const assignedServiceId = readClientAssignedServiceId(row, data);

  const eligibilityError = await validateNewClientLeadEligibility(selectedLead, assignedServiceId, user);
  if (eligibilityError) { const error = new Error(eligibilityError); error.statusCode = 409; throw error; }

  if (workflowStatus === 'submitted' && !data?.basic?.clientLegalName) {
    const error = new Error('Client Legal Name is required before submit');
    error.statusCode = 400;
    throw error;
  }
  const completionError = validateClientSubmissionCompletion(data, workflowStatus);
  if (completionError) { const error = new Error(completionError); error.statusCode = 400; throw error; }

  const client = await Client.create({
    selectedLead,
    assignedServiceId,
    adminControls,
    data,
    workflowStatus,
    createdBy: user?._id
  });
  if (workflowStatus === 'submitted') await queueCreatedClientApproval(client, row.createdByUser);
  return client;
}

exports.bulkCreateClients = async (req, res) => {
  const rows = Array.isArray(req.body.clients) ? req.body.clients : [];
  if (!rows.length) return res.status(400).json({ error: 'No clients provided' });

  const clients = [];
  const failures = [];

  for (let index = 0; index < rows.length; index += 1) {
    try {
      const client = await createClientRecord({ ...rows[index], createdByUser: req.user }, req.user);
      clients.push(client);
    } catch (err) {
      failures.push({
        row: index + 1,
        error: err.message || 'Unable to save client'
      });
    }
  }

  res.status(failures.length && !clients.length ? 400 : 201).json({
    ok: failures.length === 0,
    imported: clients.length,
    failed: failures.length,
    clients,
    failures
  });
};

exports.bulkUpdateClientYears = async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'No annual return year rows provided' });

  let updated = 0;
  const failures = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const companyUniqueId = String(row.companyUniqueId || '').trim();
    const onboardingYear = String(row.onboardingYear || '').trim();
    const firstAnnualReturnYear = String(row.firstAnnualReturnYear || '').trim();

    if (!companyUniqueId || (!onboardingYear && !firstAnnualReturnYear)) {
      failures.push({ row: Number(row.row) || index + 2, error: 'Company Unique ID and at least one year value are required' });
      continue;
    }

    const client = await Client.findOne({
      $or: [{ 'data.importMeta.uniqueId': companyUniqueId }]
    });

    if (!client) {
      failures.push({ row: Number(row.row) || index + 2, error: 'Matching client not found in CRM' });
      continue;
    }

    client.data = {
      ...(isPlainObject(client.data) ? client.data : {}),
      basic: {
        ...(isPlainObject(client.data?.basic) ? client.data.basic : {}),
        ...(onboardingYear ? { onboardingYear } : {}),
        ...(firstAnnualReturnYear ? { firstAnnualReturnYear } : {})
      }
    };
    client.markModified('data');
    await client.save();
    updated += 1;
  }

  return res.status(failures.length && !updated ? 400 : 200).json({
    ok: failures.length === 0,
    updated,
    failed: failures.length,
    failures
  });
};

exports.updateClient = async (req, res) => {
  const workflowStatus = readRequestedClientWorkflowStatus(req.body.workflowStatus);
  if (!workflowStatus) return res.status(400).json({ error: 'Invalid Client Master workflow status' });
  const { data, adminControls } = normalizeClientRequestPayload(req.body);
  const selectedLead = readSelectedLeadId(req.body.selectedLead);
  const assignedServiceId = readClientAssignedServiceId(req.body, data);
  const requestedClientId = readRequestedClientId(req.body);
  if (requestedClientId && String(requestedClientId) !== String(req.params.id)) {
    return res.status(409).json({ error: 'Client Master record ID does not match the update URL' });
  }

  if (workflowStatus === 'submitted' && !data?.basic?.clientLegalName) {
    return res.status(400).json({ error: 'Client Legal Name is required before submit' });
  }
  const completionError = validateClientSubmissionCompletion(data, workflowStatus);
  if (completionError) return res.status(400).json({ error: completionError });

  let client = await Client.findOne(combineAccessFilters({ _id: req.params.id }, await clientAccessFilter(req.user)));
  if (!client) return res.status(404).json({ error: 'Client not found or not accessible' });
  const effectiveAssignedServiceId = assignedServiceId || readClientAssignedServiceId(client, client.data || {});
  const existingData = isPlainObject(client.data) ? client.data : {};
  const resolvedExistingData = resolveClientMasterData(client, effectiveAssignedServiceId);
  const restrictedUpdateError = validateRestrictedCpcbUpdate(resolvedExistingData, data);
  if (restrictedUpdateError) return res.status(403).json({ error: restrictedUpdateError });

  const identityError = validateClientMasterIdentity(client, { assignedServiceId: effectiveAssignedServiceId, selectedLead });
  if (identityError) return res.status(409).json({ error: identityError });
  const transition = getClientWorkflowTransition(client.workflowStatus, workflowStatus);
  if (transition.error) return res.status(409).json({ error: transition.error });

  const canApproveClient = CLIENT_APPROVAL_ROLES.includes(String(req.user?.role || '').trim().toLowerCase());
  const existingApprovalStatus = normalizeApprovalStatus(client.adminControls?.approvalStatus) || 'PENDING';
  const requestedApprovalStatus = normalizeApprovalStatus(adminControls.approvalStatus) || existingApprovalStatus;
  const complianceResubmission = workflowStatus === 'submitted' && ['PARTIALLY_APPROVED', 'REJECTED'].includes(existingApprovalStatus);
  adminControls.approvalStatus = complianceResubmission ? 'PENDING' : (canApproveClient ? requestedApprovalStatus : existingApprovalStatus);

  const safeData = readCpcbOnboarding(resolvedExistingData).registered === false
    ? preserveRestrictedCpcbSections(existingData, data)
    : data;
  const mergedData = mergeAssignedServiceCpcbData(existingData, safeData);

  if (transition.becameSubmitted) {
    const submittedAt = new Date();
    const update = {
      adminControls,
      data: mergedData,
      workflowStatus: 'submitted',
      submittedAt,
      ...(req.user?._id ? { submittedBy: req.user._id } : {}),
      ...(selectedLead ? { selectedLead } : {}),
      ...(effectiveAssignedServiceId ? { assignedServiceId: effectiveAssignedServiceId } : {})
    };
    const transitionedClient = await Client.findOneAndUpdate(
      { _id: client._id, workflowStatus: 'draft' },
      { $set: update },
      { new: true, runValidators: true }
    );
    if (!transitionedClient) {
      const currentClient = await Client.findById(client._id);
      if (!currentClient) return res.status(404).json({ error: 'Client not found' });
      return res.json({ ok: true, client: currentClient, alreadySubmitted: currentClient.workflowStatus === 'submitted' });
    }
    client = transitionedClient;
    await queueCreatedClientApproval(client, req.user, complianceResubmission
      ? { resubmission: true, previousStatus: existingApprovalStatus }
      : undefined);
  } else {
    if (selectedLead) client.selectedLead = selectedLead;
    if (effectiveAssignedServiceId) client.assignedServiceId = effectiveAssignedServiceId;
    client.adminControls = adminControls;
    client.data = mergedData;
    client.workflowStatus = workflowStatus;
    client.markModified('data');
    await client.save();
  }

  if (complianceResubmission && !transition.becameSubmitted) {
    await queueCreatedClientApproval(client, req.user, { resubmission: true, previousStatus: existingApprovalStatus });
  }

  if (canApproveClient && requestedApprovalStatus !== 'PENDING' && requestedApprovalStatus !== existingApprovalStatus) {
    const actionAt = new Date();
    await PendingApproval.findOneAndUpdate(
      { type: 'client', sourceClientId: String(client._id), approvalStatus: 'PENDING' },
      {
        approvalStatus: requestedApprovalStatus,
        nextReminderAt: null,
        reminderFlag: 'GREEN',
        greenFlagAt: actionAt,
        redFlagAt: null,
        greenFlagDeadline: null,
        actionBy: req.user?._id,
        actionAt,
        remarks: 'Status updated from Client Master'
      }
    );
    await syncClientReviewReminderState({ client, status: requestedApprovalStatus });
  }

  res.json({ ok: true, client });
};

exports.updateClientLifecycle = async (req, res) => {
  const clientId = String(req.params.id || '').trim();
  if (!mongoose.Types.ObjectId.isValid(clientId)) {
    return res.status(400).json({ error: 'Invalid Client Master ID' });
  }
  const client = await Client.findOne(combineAccessFilters(
    { _id: clientId },
    await clientAccessFilter(req.user)
  ));
  if (!client) return res.status(404).json({ error: 'Client Master record not found' });

  const lifecycle = {
    ...cleanClientLifecycle(req.body),
    updatedAt: new Date(),
    updatedBy: req.user?._id,
    updatedByName: cleanLifecycleText(req.user?.name || req.user?.email || 'CRM User', 160)
  };
  const currentData = isPlainObject(client.data) ? client.data : {};
  client.data = { ...currentData, clientLifecycle: lifecycle };
  client.markModified('data');
  await client.save();
  return res.json({ ok: true, lifecycle });
};

exports.updateAnnualReturn = async (req, res) => {
  try {
    const annualYear = normalizeAnnualYearKey(req.body.annualYear);
    if (!annualYear) return res.status(400).json({ error: 'Annual return year is required' });
    const approvalWorkflow = isPlainObject(req.body.approvalWorkflow) ? req.body.approvalWorkflow : {};
    const workflowRemark = String(approvalWorkflow.remark || approvalWorkflow.lastRemark || '').trim();
    if (workflowRemark.length > 250) return res.status(400).json({ error: 'Remark must be 250 characters or less' });

    const clientId = String(req.params.id || '').trim();
    const visibility = await clientAccessFilter(req.user);
    let client = mongoose.Types.ObjectId.isValid(clientId)
      ? await Client.findOne(combineAccessFilters({ _id: clientId }, visibility))
      : await Client.findOne(combineAccessFilters({
          $or: [
            { 'data.importMeta.uniqueId': clientId },
            { 'data.basic.clientLegalName': clientId },
            { 'data.basic.tradeName': clientId }
          ]
        }, visibility));

    if (!client) {
      const clientData = isPlainObject(req.body.clientData) ? req.body.clientData : {};
      const importMeta = isPlainObject(clientData.importMeta) ? clientData.importMeta : {};
      const adminControls = normalizeAdminControls(req.body.adminControls);
      const assignedToLabel = readAssignedToLabel(req.body.adminControls?.assignedTo);
      client = new Client({
        data: {
          ...clientData,
          importMeta: {
            ...importMeta,
            assignedTo: importMeta.assignedTo || assignedToLabel || '',
            uniqueId: importMeta.uniqueId || clientId
          }
        },
        adminControls,
        workflowStatus: 'draft',
        createdBy: req.user?._id
      });
    }

    const currentData = isPlainObject(client.data) ? client.data : {};
    const currentAnnualReturn = isPlainObject(currentData.annualReturn) ? currentData.annualReturn : {};
    const currentFilings = isPlainObject(currentAnnualReturn.filings) ? currentAnnualReturn.filings : {};
    const existingFiling = isPlainObject(currentFilings[annualYear]) ? currentFilings[annualYear] : {};
    console.log('[AnnualReview:updateAnnualReturn] request', {
      clientId,
      annualYear,
      user: req.user?.email || req.user?.name || req.user?._id,
      role: req.user?.role,
      incomingStatus: req.body.status,
      incomingWorkflowStatus: approvalWorkflow.status,
      incomingStage: approvalWorkflow.currentStage,
      existingWorkflowStatus: existingFiling.approvalWorkflow?.status,
      existingStage: existingFiling.approvalWorkflow?.currentStage,
      incomingSections: Object.fromEntries(Object.entries(approvalWorkflow.sections || {}).map(([title, meta]) => [
        title,
        {
          status: meta?.status || '',
          managerStatus: meta?.managerStatus || '',
          complianceStatus: meta?.complianceStatus || '',
          reviewerRole: meta?.reviewerRole || ''
        }
      ]))
    });
    const workflowPermissionError = validateAnnualWorkflowPermission(
      isPlainObject(existingFiling.approvalWorkflow) ? existingFiling.approvalWorkflow : {},
      approvalWorkflow,
      req.user
    );
    if (workflowPermissionError) {
      console.warn('[AnnualReview:updateAnnualReturn] permission denied', {
        clientId,
        annualYear,
        user: req.user?.email || req.user?.name || req.user?._id,
        role: req.user?.role,
        workflowPermissionError
      });
      return res.status(403).json({ error: workflowPermissionError });
    }

    const filing = buildAnnualReturnFiling(req.body.draft, annualYear, {
      activeTab: req.body.activeTab,
      activeSection: req.body.activeSection,
      status: req.body.status,
      approvalWorkflow,
      updatedBy: req.user?._id
    });
    const mergedApprovalWorkflow = mergeAnnualWorkflowForSave(existingFiling.approvalWorkflow, filing.approvalWorkflow);
    const existingStatus = String(existingFiling.status || '').toLowerCase();
    const existingWorkflowStatus = String(existingFiling.approvalWorkflow?.status || '').toLowerCase();
    const nextStatus = String(filing.status || mergedApprovalWorkflow.status || '').toLowerCase();
    const userRole = String(req.user?.role || '').toLowerCase();
    const userSubmittedForManager = nextStatus === 'manager_pending' && !['manager', 'admin', 'superadmin', 'compliance'].includes(userRole);
    const shouldNotifyManager = userSubmittedForManager;
    const preventDuplicateManagerNotification = existingStatus === 'manager_pending' && existingWorkflowStatus === 'manager_pending';

    client.data = {
      ...currentData,
      annualReturn: {
        ...currentAnnualReturn,
        selectedYear: annualYear,
        lastSavedYear: annualYear,
        lastSavedAt: filing.savedAt,
        filings: {
          ...currentFilings,
          [annualYear]: {
            ...existingFiling,
            ...filing,
            approvalWorkflow: mergedApprovalWorkflow,
            draft: {
              ...(isPlainObject(existingFiling.draft) ? existingFiling.draft : {}),
              ...filing.draft
            }
          }
        }
      }
    };

    client.markModified('data');
    await client.save();
    const annualReturn = await upsertAnnualReturnRecord(client, annualYear, client.data.annualReturn.filings[annualYear], req.body, req.user?._id);
    let managerNotification = null;
    if (shouldNotifyManager) {
      managerNotification = await notifyManagerAnnualSubmitted({
        client,
        annualYear,
        submitter: req.user,
        preventDuplicate: preventDuplicateManagerNotification
      });
    }
    let poApprovalNotification = null;
    const purchaseOrderConfirmation = filing.draft?.purchaseOrderConfirmation;
    if (req.body.notifyPoApproval === true && purchaseOrderConfirmation?.mode === 'no' && purchaseOrderConfirmation?.confirmed) {
      try {
        poApprovalNotification = await notifyPoSpecialApproval({
          client,
          annualYear,
          submitter: req.user,
          workflow: purchaseOrderConfirmation
        });
      } catch (notificationError) {
        console.error('PO special approval notification failed', {
          clientId: String(client._id),
          annualYear,
          error: notificationError?.message || notificationError
        });
        poApprovalNotification = { ok: false, error: 'Approval saved, but reviewer notification could not be sent.' };
      }
    }
    console.log('[AnnualReview:updateAnnualReturn] saved', {
      clientId: String(client._id),
      annualYear,
      status: client.data.annualReturn.filings[annualYear]?.status,
      workflowStatus: client.data.annualReturn.filings[annualYear]?.approvalWorkflow?.status,
      stage: client.data.annualReturn.filings[annualYear]?.approvalWorkflow?.currentStage,
      annualReturnRecordStatus: annualReturn?.status,
      annualReturnRecordWorkflowStatus: annualReturn?.approvalWorkflow?.status,
      annualReturnRecordStage: annualReturn?.approvalWorkflow?.currentStage,
      sections: Object.fromEntries(Object.entries(client.data.annualReturn.filings[annualYear]?.approvalWorkflow?.sections || {}).map(([title, meta]) => [
        title,
        {
          status: meta?.status || '',
          managerStatus: meta?.managerStatus || '',
          complianceStatus: meta?.complianceStatus || '',
          reviewerRole: meta?.reviewerRole || ''
        }
      ]))
    });
    res.json({ ok: true, client, annualReturn: client.data.annualReturn.filings[annualYear], annualReturnRecord: annualReturn, managerNotification, poApprovalNotification });
  } catch (err) {
    console.error('Annual return update error', err);
    const message = err?.name === 'ValidationError'
      ? err.message
      : err?.code === 11000
        ? 'Annual return record already exists for this client and year.'
        : 'Unable to save annual return data.';
    res.status(500).json({ error: message });
  }
};

exports.updateClientApproval = async (req, res) => {
  const status = normalizeApprovalStatus(req.body.status || req.body.approvalStatus);
  if (!['APPROVED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ error: 'Approval status must be APPROVED or REJECTED' });
  }
  const approvalRecordId = String(req.body.approvalRecordId || '').trim();
  const remarks = String(req.body.remarks || '').trim();
  if (!remarks) {
    return res.status(400).json({ error: `${status === 'APPROVED' ? 'Approval note' : 'Rejection reason'} is required` });
  }
  if (remarks.length > 250) {
    return res.status(400).json({ error: 'Decision note cannot exceed 250 characters' });
  }
  const approvalRecord = mongoose.Types.ObjectId.isValid(approvalRecordId)
    ? await PendingApproval.findById(approvalRecordId)
    : null;
  const source = String(req.body.source || approvalRecord?.source || 'crm').trim() || 'crm';
  const sourceClientId = String(req.body.sourceClientId || req.params.id || approvalRecord?.sourceClientId || '').trim();
  const rawApprovalPayload = req.body.payload || approvalRecord?.payload?.payload || null;
  const shouldBuildApprovalPayload = isPlainObject(rawApprovalPayload)
    || isPlainObject(req.body.data)
    || isPlainObject(req.body.adminControls);
  const approvalFields = shouldBuildApprovalPayload
    ? buildClientApprovalPayload({
        ...req.body,
        source,
        sourceClientId,
        uniqueId: req.body.uniqueId || approvalRecord?.uniqueId || '',
        payload: rawApprovalPayload || req.body.payload || {}
      }, status, req.user?._id, remarks)
    : null;

  const client = mongoose.Types.ObjectId.isValid(req.params.id)
    ? await Client.findById(req.params.id)
    : null;

  if (client && status === 'APPROVED') {
    const complianceReview = await ClientComplianceReview.findOne({ client: client._id }).lean();
    const sections = Array.isArray(complianceReview?.sections) ? complianceReview.sections : [];
    const reviewComplete = sections.length === 9
      && sections.every((section) => ['VERIFIED', 'NOT_APPLICABLE'].includes(section.status))
      && complianceReview?.status === 'APPROVED';
    if (!reviewComplete) return res.status(409).json({ error: 'Complete all Compliance Verification tabs before approving this Client Master' });
  }

  if (!client) {
    const createdClient = await Client.create({
      adminControls: approvalFields?.adminControls || { approvalStatus: status },
      data: approvalFields?.data || {
        approvalMeta: {
          status,
          source,
          actionBy: req.user?._id,
          actionAt: new Date(),
          remarks
        }
      },
      workflowStatus: 'draft',
      createdBy: req.user?._id
    });

    if (approvalRecord) {
      await PendingApproval.findByIdAndUpdate(approvalRecord._id, {
        approvalStatus: status,
        nextReminderAt: null,
        reminderFlag: 'GREEN',
        greenFlagAt: new Date(),
        redFlagAt: null,
        greenFlagDeadline: null,
        actionBy: req.user?._id,
        actionAt: new Date(),
        remarks
      });
    } else {
      await PendingApproval.findOneAndUpdate(
        pendingApprovalFilter({
          id: req.params.id,
          source,
          uniqueId: req.body.uniqueId,
          clientName: req.body.clientName
        }),
        {
          approvalStatus: status,
          nextReminderAt: null,
          reminderFlag: 'GREEN',
          greenFlagAt: new Date(),
          redFlagAt: null,
          greenFlagDeadline: null,
          actionBy: req.user?._id,
          actionAt: new Date(),
          remarks
        }
      );
    }

    const notification = await notifyClientApprovalDecision({ record: approvalRecord || req.body, client: createdClient, status, remarks, reviewer: req.user })
      .catch((error) => {
        console.error('Client approval decision email failed', error);
        return { sent: false, reason: error.message || 'email_failed' };
      });
    await syncClientReviewReminderState({ client: createdClient, status });
    return res.json({ ok: true, client: createdClient, notification });
  }

  client.adminControls = approvalFields
    ? { ...(client.adminControls || {}), ...approvalFields.adminControls }
    : { ...(client.adminControls || {}), approvalStatus: status };

  client.data = {
    ...(client.data || {}),
    ...(approvalFields?.data || {}),
    approvalMeta: {
      status,
      source,
      actionBy: req.user?._id,
      actionAt: new Date(),
      remarks
    }
  };

  client.markModified('data');
  await client.save();
  await syncClientReviewReminderState({ client, status });

  if (approvalRecord) {
    await PendingApproval.findByIdAndUpdate(approvalRecord._id, {
      approvalStatus: status,
      nextReminderAt: null,
      reminderFlag: 'GREEN',
      greenFlagAt: new Date(),
      redFlagAt: null,
      greenFlagDeadline: null,
      actionBy: req.user?._id,
      actionAt: new Date(),
      remarks
    });
  } else {
    await PendingApproval.findOneAndUpdate(
      pendingApprovalFilter({
        id: req.params.id,
        source: req.body.source || 'crm',
        uniqueId: req.body.uniqueId,
        clientName: req.body.clientName
      }),
      {
        approvalStatus: status,
        nextReminderAt: null,
        reminderFlag: 'GREEN',
        greenFlagAt: new Date(),
        redFlagAt: null,
        greenFlagDeadline: null,
        actionBy: req.user?._id,
        actionAt: new Date(),
        remarks
      }
    );
  }

  const notification = await notifyClientApprovalDecision({ record: approvalRecord || req.body, client, status, remarks, reviewer: req.user })
    .catch((error) => {
      console.error('Client approval decision email failed', error);
      return { sent: false, reason: error.message || 'email_failed' };
    });
  res.json({ ok: true, client, notification });
};

exports.approveAllPendingClients = async (req, res) => {
  const remarks = String(req.body.remarks || 'Bulk approved').trim();
  const records = await PendingApproval.find({ type: 'client', approvalStatus: 'PENDING' });
  let approved = 0;
  const failures = [];

  for (const record of records) {
    try {
      const approvalClientId = String(record.sourceClientId || record.payload?.id || '');
      const locked = (req.clientDeactivationLocks || []).some((entry) => entry.clientIds.some((id) => String(id) === approvalClientId)
        || String(entry.clientName || '').trim().toLowerCase() === String(record.clientName || '').trim().toLowerCase());
      if (locked) throw new Error('Client is inactive or awaiting deactivation approval.');
      const approvedClient = await applyClientApprovalStatus(record, 'APPROVED', req.user?._id, remarks);
      record.approvalStatus = 'APPROVED';
      record.nextReminderAt = null;
      record.reminderFlag = 'GREEN';
      record.greenFlagAt = new Date();
      record.redFlagAt = null;
      record.greenFlagDeadline = null;
      record.actionBy = req.user?._id;
      record.actionAt = new Date();
      record.remarks = remarks;
      await record.save();
      await notifyClientApprovalDecision({ record, client: approvedClient, status: 'APPROVED', remarks, reviewer: req.user })
        .catch((error) => console.error('Client bulk approval decision email failed', error));
      approved += 1;
    } catch (err) {
      failures.push({
        id: record._id,
        clientName: record.clientName,
        error: err.message || 'Unable to approve client'
      });
    }
  }

  res.json({
    ok: failures.length === 0,
    approved,
    failed: failures.length,
    failures
  });
};

// ---------- Client Service Allocation Email/Notification helpers ----------
function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

function splitAllocationKeyToTuple(key) {
  if (!key || typeof key !== 'string') return Array(9).fill('');
  const arr = String(key).split('::').map((p) => String(p || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  while (arr.length < 9) arr.push('');
  return arr.slice(0, 9);
}

function normalizeAllocationKeyString(key) {
  return splitAllocationKeyToTuple(key).filter(Boolean).join('::');
}

function buildAllocationKeyFromService(service = {}) {
  const clean = (v = '') => String(v || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const tuple = [
    clean(service.applicantType),
    clean(service.subApplicantType || service.piboCategory),
    clean(service.plantUnit),
    clean(service.eprCategory || service.serviceCategory || service.epr),
    clean(service.piboCategory || service.subApplicantType),
    clean(service.servicesOffered || service.service || service.scope),
    clean(service.servicePeriod || service.period),
    clean(service.financialYear || service.servicesForYear || (Array.isArray(service.annualReturnYears) ? service.annualReturnYears[0] : '') || service.fy),
    clean(service.applicantLabel || service.label)
  ];
  return tuple.filter(Boolean).join('::');
}

function splitAllocationKey(key) {
  if (!key || typeof key !== 'string') return {};
  const parts = String(key).split('::').map((p) => String(p || '').trim());
  const [applicantType = '', subApplicantType = '', plantUnit = '', eprCategory = '', piboCategory = '', servicesOffered = '', servicePeriod = '', financialYear = '', applicantLabel = ''] = parts;
  return { applicantType, subApplicantType, plantUnit, eprCategory, piboCategory, servicesOffered, servicePeriod, financialYear, applicantLabel };
}

function serviceDisplayNameForAllocation(key) {
  const s = splitAllocationKey(key);
  const label = s.applicantLabel || s.piboCategory || s.subApplicantType || s.applicantType || 'Service';
  const extras = [];
  if (s.eprCategory) extras.push(s.eprCategory);
  if (s.servicesOffered) extras.push(s.servicesOffered);
  if (s.financialYear) extras.push(`FY ${s.financialYear}`);
  if (s.plantUnit) extras.push(s.plantUnit);
  return {
    label,
    summary: extras.length ? `${label} · ${extras.join(' · ')}` : label,
    breakdown: s
  };
}

function readClientOverviewFromRecord(rawClient) {
  const client = rawClient && typeof rawClient.toObject === 'function' ? rawClient.toObject() : Object(rawClient || {});
  const data = Object(client.data || {});
  const snap = Object(data.selectedLeadSnapshot || {});
  const basic = Object(data.basic || {});
  const overview = Object(data.companyOverview || {});
  const contact = Object(data.authorisedContact || data.authorizedContact || {});
  const meta = Object(data.importMeta || {});
  const lead = Object(client.selectedLead || {});

  const pickClean = (...candidates) => {
    for (const v of candidates) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        const s = String(v).trim();
        if (s && s !== 'undefined' && s !== 'null') return s;
      }
      if (typeof v === 'string') {
        const s = v.trim();
        if (s && s !== 'undefined' && s !== 'null') return s;
      }
    }
    return '';
  };

  const companyName = pickClean(
    basic.clientLegalName, basic.tradeName, basic.companyName, basic.clientName,
    meta.companyName, snap.companyName, overview.companyName, client.companyName, client.clientLegalName, client.clientName,
    lead.company, lead.companyName, client.companyIdentity
  );

  const contactPerson = pickClean(
    basic.contactPerson, contact.contactPerson, snap.contactPerson, client.contactPerson, lead.contactPerson
  );

  const mobile = pickClean(
    basic.mobileNo, contact.mobile, basic.mobileNo1, basic.mobile, basic.phone, contact.phone, contact.mobileNo,
    snap.mobileNo1, snap.mobile, snap.phone, snap.primaryContactNumber, snap.contactMobile, snap.contactPhone,
    client.mobile, client.phone, client.mobileNo, client.contactNumber, client.contactPhone, client.contactMobile,
    lead.mobile, lead.phone, lead.mobileNo, lead.primaryContactNumber, lead.contactMobile
  );

  const email = pickClean(
    basic.emailId, basic.email, contact.emailId, contact.email, snap.emailId, snap.email,
    client.emailId, client.email, lead.email, lead.emailId
  );

  const gstin = pickClean(
    basic.gstNumber, basic.gst, basic.gstin, snap.gstNumber, snap.gst, snap.gstin,
    meta.gstNumber, meta.gstin, client.gstNumber, client.gst, client.gstin, lead.gstNumber, lead.gstin
  );

  const state = pickClean(basic.state, basic.stateName, snap.state, snap.stateName, overview.state, client.state, client.stateName, lead.state, lead.stateName);
  const city = pickClean(basic.city, basic.cityName, snap.city, snap.cityName, overview.city, client.city, client.cityName, lead.city, lead.cityName);
  const leadCode = pickClean(meta.leadNumber, meta.leadCode, snap.leadCode, snap.leadNumber, lead.leadCode, lead.leadNumber, client.leadCode, client.leadNumber, client.uniqueId);

  return { companyName, contactPerson, mobile, email, gstin, state, city, leadCode };
}

function buildAllocationStaffEmailHtml({ recipientName, recipientRole, managerName, managerRole, clientName, clientLeadCode, clientGst, clientState, clientCity, clientMobile, clientEmail, servicesRows, isReassignment, crmLink }) {
  const safeClientName = clientName && String(clientName).trim() ? String(clientName).trim() : 'Client';
  const rowsHtml = servicesRows.map((r, i) => {
    const s = splitAllocationKey(r.serviceKey);
    const serviceName = s.applicantLabel || s.piboCategory || s.subApplicantType || s.applicantType || 'Service';
    return `<tr style="${i % 2 ? 'background:#f8fafc' : ''}">
      <td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-weight:700">${escapeHtml(serviceName)}</td>
      <td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;color:#334155">${escapeHtml(s.eprCategory || '-')}</td>
      <td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;color:#334155">${escapeHtml(s.servicesOffered || '-')}</td>
      <td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;color:#334155">${escapeHtml(s.financialYear || '-')}</td>
      <td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;color:#334155">${escapeHtml(s.plantUnit || '-')}${r.previousUserName && r.previousUserId !== r.newUserId ? `<div style="margin-top:4px;font-size:12px;color:#b45309;background:#fff7ed;border:1px solid #fed7aa;display:inline-block;padding:2px 8px;border-radius:999px">Reassigned from ${escapeHtml(r.previousUserName)}</div>` : ''}</td>
    </tr>`;
  }).join('');

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f1f5f9" style="width:100%;border-collapse:collapse;background-color:#f1f5f9">
  <tr><td align="center" style="padding:28px 12px">
    <table role="presentation" width="660" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:660px;border-collapse:separate;background-color:#ffffff;border:1px solid #dbe5e1;border-radius:18px;overflow:hidden">
      <tr><td bgcolor="#0f766e" style="padding:26px 32px;background:linear-gradient(135deg,#059669 0%,#0d9488 55%,#0891b2 100%)">
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:800;letter-spacing:2px;color:#ccfbf1;text-transform:uppercase">Customer Hub · Client Master Allocation</div>
        <div style="margin-top:10px;font-family:Arial,Helvetica,sans-serif;font-size:28px;line-height:34px;font-weight:900;color:#ffffff">${escapeHtml(isReassignment ? 'Service reassigned for client' : 'New client service assigned')}</div>
        <div style="margin-top:6px;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:28px;font-weight:900;color:#fef3c7;text-shadow:0 1px 0 rgba(0,0,0,0.15)">🟢 ${escapeHtml(safeClientName)}${clientLeadCode ? ` <span style="font-size:14px;color:#ccfbf1;font-weight:700;margin-left:6px">· ${escapeHtml(clientLeadCode)}</span>` : ''}</div>
        <div style="margin-top:10px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#ecfeff">Assigned by <strong style="color:#ffffff">${escapeHtml(managerName)}</strong>${managerRole ? ` · ${escapeHtml(managerRole)}` : ''}</div>
      </td></tr>
      <tr><td style="padding:28px 32px;font-family:Arial,Helvetica,sans-serif;color:#334155">
        <p style="margin:0 0 14px;font-size:16px;line-height:26px;color:#334155">Hi <strong style="color:#0f172a">${escapeHtml(recipientName || recipientRole || 'Team member')}</strong>,</p>
        <p style="margin:0 0 18px;font-size:16px;line-height:26px;color:#0f172a;font-weight:800"><span style="display:inline-block;padding:4px 10px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;color:#047857;font-weight:900;margin-right:8px">CLIENT</span> ${escapeHtml(safeClientName)}${clientLeadCode ? ` <span style="color:#475569;font-weight:700">· ${escapeHtml(clientLeadCode)}</span>` : ''} has been allocated to you on <strong>${servicesRows.length} service${servicesRows.length === 1 ? '' : 's'}</strong>.</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:24px;color:#475569">Please log in to CRM to view the full <strong style="color:#0f172a">${escapeHtml(safeClientName)}</strong> client master record and begin processing your allocated services immediately.</p>

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ecfdf5" style="width:100%;margin:0 0 24px;border-collapse:separate;background-color:#ecfdf5;border:1px solid #a7f3d0;border-radius:14px">
          <tr>
            <td width="60%" valign="top" style="padding:20px 22px">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#047857;margin-bottom:8px">Client name</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:900;line-height:30px;color:#064e3b;margin-bottom:6px">${escapeHtml(safeClientName)}</div>
              ${clientLeadCode ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#065f46;font-weight:700;margin-bottom:4px">${escapeHtml(clientLeadCode)}</div>` : ''}
              ${clientGst ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111827;margin-top:4px"><span style="color:#047857;font-weight:700">GST:</span> ${escapeHtml(clientGst)}</div>` : ''}
              ${clientState || clientCity ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111827;margin-top:3px"><span style="color:#047857;font-weight:700">Location:</span> ${escapeHtml([clientCity, clientState].filter(Boolean).join(', '))}</div>` : ''}
            </td>
            <td width="40%" valign="top" style="padding:20px 22px">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#047857;margin-bottom:8px">Contact · ${escapeHtml(safeClientName)}</div>
              ${clientMobile ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;margin-bottom:5px">📞 <strong>${escapeHtml(clientMobile)}</strong></div>` : ''}
              ${clientEmail ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827">✉️ <strong>${escapeHtml(clientEmail)}</strong></div>` : ''}
              <div style="margin-top:16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#064e3b;font-weight:700">${escapeHtml(String(servicesRows.length))} service${servicesRows.length === 1 ? '' : 's'} allocated for <strong>${escapeHtml(safeClientName)}</strong></div>
            </td>
          </tr>
        </table>

        <h3 style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:16px;color:#0f172a;font-weight:800">Your allocated services on <span style="color:#065f46">${escapeHtml(safeClientName)}</span></h3>
        <div style="overflow:auto;border:1px solid #e2e8f0;border-radius:14px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:14px">
            <thead><tr style="background:#f1f5f9;color:#0f172a">
              <th style="padding:12px 14px;text-align:left;border-bottom:2px solid #cbd5e1;font-weight:800">Service</th>
              <th style="padding:12px 14px;text-align:left;border-bottom:2px solid #cbd5e1;font-weight:800">Category (EPR)</th>
              <th style="padding:12px 14px;text-align:left;border-bottom:2px solid #cbd5e1;font-weight:800">Scope</th>
              <th style="padding:12px 14px;text-align:left;border-bottom:2px solid #cbd5e1;font-weight:800">Financial Year</th>
              <th style="padding:12px 14px;text-align:left;border-bottom:2px solid #cbd5e1;font-weight:800">Plant / Notes</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:22px 0 6px;border-collapse:separate;background-color:#f0f9ff;border-left:4px solid #0284c7;border-radius:12px">
          <tr><td style="padding:16px 18px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#0c4a6e">
            <strong style="color:#075985">Next steps for ${escapeHtml(safeClientName)}:</strong> Open the <strong>${escapeHtml(safeClientName)}</strong> client master record in CRM by clicking the button below. Each of your allocated services (Producer, Brand Owner, Importer, Recycler etc.) has been individually tagged to you for this client. If this allocation is incorrect or needs adjustment, reply to your reporting manager <strong>${escapeHtml(managerName)}</strong>.
          </td></tr>
        </table>

        ${crmLink ? `<p style="margin:26px 0 0"><a href="${escapeHtml(crmLink)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:linear-gradient(135deg,#059669,#0d9488,#0891b2);color:#ffffff;text-decoration:none;border-radius:12px;padding:14px 22px;font-weight:800;font-family:Arial,Helvetica,sans-serif;font-size:15px;box-shadow:0 8px 20px rgba(13,148,136,0.25)">Open ${escapeHtml(safeClientName)} in CRM →</a></p>` : ''}
      </td></tr>
      <tr><td bgcolor="#f8fafc" style="padding:17px 32px;background-color:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 17px 17px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#64748b">
        This is an automated CRM notification for client <strong style="color:#0f172a">${escapeHtml(safeClientName)}</strong>. Client service allocation was updated by ${escapeHtml(managerName)}.
      </td></tr>
    </table>
  </td></tr>
  </table>`;
}

function buildAllocationManagerSummaryHtml({ managerName, clientName, clientLeadCode, changesRows, crmLink }) {
  const safeClientName = clientName && String(clientName).trim() ? String(clientName).trim() : 'Client';
  const changed = changesRows.filter((r) => r.type !== 'unchanged');
  const reassigned = changed.filter((r) => r.type === 'reassigned');
  const newly = changed.filter((r) => r.type === 'new');
  const removed = changesRows.filter((r) => r.type === 'removed');

  const rowsHtml = changesRows.map((r, i) => {
    const s = splitAllocationKey(r.serviceKey);
    const serviceName = s.applicantLabel || s.piboCategory || s.subApplicantType || s.applicantType || 'Service';
    const typePill = r.type === 'new'
      ? `<div style="display:inline-block;padding:3px 10px;border-radius:999px;background:#ecfdf5;color:#047857;font-weight:800;font-size:12px;border:1px solid #a7f3d0">NEW</div>`
      : r.type === 'reassigned'
        ? `<div style="display:inline-block;padding:3px 10px;border-radius:999px;background:#fff7ed;color:#9a3412;font-weight:800;font-size:12px;border:1px solid #fed7aa">REASSIGNED</div>`
        : r.type === 'removed'
          ? `<div style="display:inline-block;padding:3px 10px;border-radius:999px;background:#fef2f2;color:#991b1b;font-weight:800;font-size:12px;border:1px solid #fecaca">UNASSIGNED</div>`
          : `<div style="display:inline-block;padding:3px 10px;border-radius:999px;background:#f1f5f9;color:#475569;font-weight:700;font-size:12px;border:1px solid #cbd5e1">UNCHANGED</div>`;

    return `<tr style="${i % 2 ? 'background:#f8fafc' : ''}">
      <td style="padding:11px 14px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-weight:700">${escapeHtml(serviceName)}${s.eprCategory ? `<div style="font-weight:500;color:#64748b;font-size:12px;margin-top:2px">${escapeHtml(s.eprCategory)}${s.financialYear ? ` · FY ${escapeHtml(s.financialYear)}` : ''}</div>` : ''}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #e2e8f0;color:#475569">${escapeHtml(r.previousUserName || r.previousUserId || '— Unassigned —')}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-weight:700">${escapeHtml(r.newUserName || r.newUserId || '— Unassigned —')}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #e2e8f0">${typePill}</td>
    </tr>`;
  }).join('');

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f1f5f9" style="width:100%;border-collapse:collapse;background-color:#f1f5f9">
  <tr><td align="center" style="padding:28px 12px">
    <table role="presentation" width="680" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:680px;border-collapse:separate;background-color:#ffffff;border:1px solid #dbe5e1;border-radius:18px;overflow:hidden">
      <tr><td bgcolor="#0ea5e9" style="padding:24px 30px;background:linear-gradient(135deg,#0ea5e9 0%,#6366f1 60%,#8b5cf6 100%)">
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:800;letter-spacing:2px;color:#e0f2fe;text-transform:uppercase">Client Master Allocation · Summary</div>
        <div style="margin-top:8px;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:32px;font-weight:900;color:#ffffff">Allocation saved</div>
        <div style="margin-top:6px;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:28px;font-weight:900;color:#fef9c3;text-shadow:0 1px 0 rgba(0,0,0,0.15)">🟣 Client: <strong>${escapeHtml(safeClientName)}</strong></div>
        ${clientLeadCode ? `<div style="margin-top:4px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#e0f2fe;font-weight:700">${escapeHtml(clientLeadCode)}</div>` : ''}
      </td></tr>
      <tr><td style="padding:26px 30px;font-family:Arial,Helvetica,sans-serif;color:#334155">
        <p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#334155">Hi <strong style="color:#0f172a">${escapeHtml(managerName || 'Admin')}</strong>,</p>
        <p style="margin:0 0 18px;font-size:15px;line-height:24px;color:#0f172a;font-weight:800"><span style="display:inline-block;padding:4px 10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;color:#1d4ed8;font-weight:900;margin-right:8px">SUMMARY</span> Allocation changes for <strong>${escapeHtml(safeClientName)}</strong>${clientLeadCode ? ` · ${escapeHtml(clientLeadCode)}` : ''} saved successfully. Individual assignees were also notified separately by email.</p>

        <div style="padding:14px 18px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:14px;margin:0 0 24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a">
          <span style="font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#64748b;margin-right:8px">Client</span>
          <span style="font-weight:900;color:#0f172a;font-size:18px">${escapeHtml(safeClientName)}</span>
          ${clientLeadCode ? `<span style="margin-left:10px;color:#64748b;font-weight:700">· ${escapeHtml(clientLeadCode)}</span>` : ''}
        </div>

        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:0 0 24px">
          <div style="padding:14px 16px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:14px">
            <div style="font-family:Arial;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#047857">Changes (${escapeHtml(safeClientName)})</div>
            <div style="margin-top:4px;font-family:Arial;font-size:22px;font-weight:800;color:#065f46">${escapeHtml(String(changed.length))}</div>
          </div>
          <div style="padding:14px 16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px">
            <div style="font-family:Arial;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#1d4ed8">New assignments</div>
            <div style="margin-top:4px;font-family:Arial;font-size:22px;font-weight:800;color:#1e40af">${escapeHtml(String(newly.length))}</div>
          </div>
          <div style="padding:14px 16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:14px">
            <div style="font-family:Arial;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#9a3412">Reassigned</div>
            <div style="margin-top:4px;font-family:Arial;font-size:22px;font-weight:800;color:#92400e">${escapeHtml(String(reassigned.length))}</div>
          </div>
          <div style="padding:14px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:14px">
            <div style="font-family:Arial;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#991b1b">Unassigned</div>
            <div style="margin-top:4px;font-family:Arial;font-size:22px;font-weight:800;color:#7f1d1d">${escapeHtml(String(removed.length))}</div>
          </div>
        </div>

        <h3 style="margin:0 0 10px;font-size:15px;font-weight:800;color:#0f172a;font-family:Arial">Allocation breakdown — <span style="color:#1d4ed8">${escapeHtml(safeClientName)}</span></h3>
        <div style="overflow:auto;border:1px solid #e2e8f0;border-radius:14px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:14px">
            <thead><tr style="background:#f1f5f9;color:#0f172a">
              <th style="padding:11px 14px;text-align:left;border-bottom:2px solid #cbd5e1;font-weight:800">Service (${escapeHtml(safeClientName)})</th>
              <th style="padding:11px 14px;text-align:left;border-bottom:2px solid #cbd5e1;font-weight:800">Previous owner</th>
              <th style="padding:11px 14px;text-align:left;border-bottom:2px solid #cbd5e1;font-weight:800">New owner</th>
              <th style="padding:11px 14px;text-align:left;border-bottom:2px solid #cbd5e1;font-weight:800">Status</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>

        ${crmLink ? `<p style="margin:26px 0 0"><a href="${escapeHtml(crmLink)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#6366f1,#8b5cf6);color:#ffffff;text-decoration:none;border-radius:12px;padding:13px 20px;font-weight:800;font-family:Arial,Helvetica,sans-serif;font-size:14px;box-shadow:0 8px 20px rgba(99,102,241,0.25)">Review ${escapeHtml(safeClientName)} allocation in CRM →</a></p>` : ''}
      </td></tr>
      <tr><td bgcolor="#f8fafc" style="padding:17px 30px;background-color:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 17px 17px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#64748b">
        Thank you for managing ownership of <strong style="color:#0f172a">${escapeHtml(safeClientName)}</strong> in CRM. An audit log entry was created for client <strong>${escapeHtml(safeClientName)}</strong>.
      </td></tr>
    </table>
  </td></tr>
  </table>`;
}

async function sendAllocationNotificationsAndEmails({ client, previousAllocations, newAllocations, changedKeys, assignedByUser }) {
  if (!client) return { ok: true, skipped: 'no_client' };
  const overview = readClientOverviewFromRecord(client);
  const clientName = overview.companyName || '';
  const clientLeadCode = overview.leadCode || '';
  const clientGst = overview.gstin || '';
  const clientState = overview.state || '';
  const clientCity = overview.city || '';
  const clientMobile = overview.mobile || '';
  const clientEmail = overview.email || '';
  const clientContact = overview.contactPerson || '';
  console.debug('[alloc:mail] overview resolution', {
    clientId: String(client._id || client.id || ''),
    resolvedClientName: clientName || '(FALLBACK Client)',
    resolvedLeadCode: clientLeadCode,
    resolvedGst: clientGst,
    resolvedContact: clientContact,
    resolvedMobile: clientMobile,
    resolvedEmail: clientEmail
  });
  const managerName = String(assignedByUser?.name || assignedByUser?.email || 'CRM');
  const managerRole = String(assignedByUser?.role || '');
  const managerEmail = String(assignedByUser?.email || '');
  const managerId = String(assignedByUser?._id || assignedByUser?.id || '');

  const appUrl = String(process.env.FRONTEND_URL || process.env.APP_URL || '').replace(/\/$/, '');
  const crmStaffLink = appUrl ? `${appUrl}/sales/client-master-allocate` : '';

  // Build a full change summary including removals (keys that existed previously but not in newAllocations)
  const allKeys = new Set([...Object.keys(previousAllocations || {}), ...Object.keys(newAllocations || {})]);
  const changesRows = [];
  for (const key of allKeys) {
    const prevVal = previousAllocations?.[key];
    const newVal = newAllocations?.[key];
    const prevUid = prevVal ? String(typeof prevVal === 'object' ? (prevVal.userId?._id || prevVal.userId || prevVal.id || '') : prevVal) : '';
    const newUid = newVal ? String(typeof newVal === 'object' ? (newVal.userId?._id || newVal.userId || newVal.id || '') : newVal) : '';
    let type;
    if (!prevUid && newUid) type = 'new';
    else if (prevUid && !newUid) type = 'removed';
    else if (prevUid && newUid && prevUid !== newUid) type = 'reassigned';
    else type = 'unchanged';
    const prevUser = prevVal?.userName || (prevVal && typeof prevVal === 'object' ? prevVal.assignedByName : '') || prevUid;
    const newUser = newVal?.userName || (newVal && typeof newVal === 'object' ? newVal.assignedByName : '') || newUid;
    changesRows.push({ serviceKey: key, previousUserId: prevUid, previousUserName: prevUser, newUserId: newUid, newUserName: newUser, type });
  }

  // Group newly assigned + reassigned rows by new user
  const byUserId = new Map();
  for (const r of changesRows) {
    if ((r.type === 'new' || r.type === 'reassigned') && r.newUserId) {
      if (!byUserId.has(r.newUserId)) byUserId.set(r.newUserId, []);
      byUserId.get(r.newUserId).push(r);
    }
  }

  const emailResults = [];
  const notificationIds = [];

  if (byUserId.size > 0) {
    const userIds = [...byUserId.keys()];
    const validIds = userIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    const users = validIds.length
      ? await User.find({ _id: { $in: validIds.map((id) => new mongoose.Types.ObjectId(id)) }, isActive: { $ne: false } }).select('_id name email role').lean()
      : [];
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    for (const [uid, rows] of byUserId.entries()) {
      const user = userMap.get(uid);
      if (!user) {
        emailResults.push({ userId: uid, skipped: 'user_not_found', services: rows.length });
        continue;
      }
      const recipientName = user.name || user.email;
      const recipientRole = user.role;
      const recipientEmail = user.email;

      // (1) Create in-app Notification for user
      try {
        const notif = await Notification.create({
          title: `${servicesRowsShortLabel(rows)} assigned to you`,
          description: `${managerName} allocated ${rows.length} client service${rows.length === 1 ? '' : 's'} on ${clientName || 'a client'} to you. Open Client Master Allocate to begin.`,
          tag: 'Client Allocation',
          kind: 'client_service_allocated_to_staff',
          createdBy: managerId ? new mongoose.Types.ObjectId(managerId) : undefined,
          createdByName: managerName,
          audience: [user._id],
          metadata: {
            clientId: String(client._id),
            clientName,
            clientLeadCode,
            allocatedBy: managerName,
            allocatedById: managerId,
            services: rows.map((r) => ({ serviceKey: r.serviceKey, ...serviceDisplayNameForAllocation(r.serviceKey), previousUserId: r.previousUserId, previousUserName: r.previousUserName, type: r.type }))
          }
        });
        notificationIds.push(String(notif._id));
      } catch (err) {
        console.error('[alloc:notif:create]', err.message);
      }

      // (2) Email (only if user has valid email)
      if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(recipientEmail).trim())) {
        emailResults.push({ userId: uid, userName: recipientName, skipped: 'no_valid_email', services: rows.length });
        continue;
      }
      const isReassignment = rows.some((r) => r.type === 'reassigned');
      const servicesRows = rows.map((r) => ({ serviceKey: r.serviceKey, previousUserName: r.previousUserName, previousUserId: r.previousUserId, newUserId: r.newUserId, newUserName: r.newUserName }));
      try {
        const clientDisplay = clientName && String(clientName).trim() ? String(clientName).trim() : 'Client';
        const subject = `Client: ${clientDisplay} | ${isReassignment ? 'Services reassigned to you' : `${rows.length} service${rows.length === 1 ? '' : 's'} assigned to you`}${clientLeadCode ? ` · ${clientLeadCode}` : ''}`;
        const html = buildAllocationStaffEmailHtml({ recipientName, recipientRole, managerName, managerRole, clientName, clientLeadCode, clientGst, clientState, clientCity, clientMobile, clientEmail, servicesRows, isReassignment, crmLink: crmStaffLink });
        await sendMail(recipientEmail, subject, html, { branded: false });
        emailResults.push({ userId: uid, userName: recipientName, email: recipientEmail, services: rows.length, sent: true });
      } catch (err) {
        console.error('[alloc:mail:staff]', err.message);
        emailResults.push({ userId: uid, userName: recipientName, email: recipientEmail, services: rows.length, error: err.message });
      }
    }
  }

  // (3) Send manager summary confirmation email
  if (managerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(managerEmail) && changesRows.length > 0) {
    try {
      const clientDisplay = clientName && String(clientName).trim() ? String(clientName).trim() : 'Client';
      const subject = `Client: ${clientDisplay} | Allocation saved · ${changedKeys.length} change${changedKeys.length === 1 ? '' : 's'}${clientLeadCode ? ` · ${clientLeadCode}` : ''}`;
      const html = buildAllocationManagerSummaryHtml({ managerName, clientName, clientLeadCode, changesRows, crmLink: crmStaffLink });
      await sendMail(managerEmail, subject, html, { branded: false });
      emailResults.push({ manager: true, userName: managerName, email: managerEmail, sent: true, summary: true });
    } catch (err) {
      console.error('[alloc:mail:manager]', err.message);
      emailResults.push({ manager: true, userName: managerName, email: managerEmail, error: err.message });
    }
  }

  return { ok: true, emailResults, notifications: notificationIds.length, changedKeys: changedKeys.length, totalKeys: allKeys.size };
}

function servicesRowsShortLabel(rows) {
  const uniqueTypes = new Set(
    rows.map((r) => splitAllocationKey(r.serviceKey).applicantLabel || splitAllocationKey(r.serviceKey).piboCategory || splitAllocationKey(r.serviceKey).applicantType || 'Service')
  );
  const first = [...uniqueTypes].slice(0, 2).join(' + ');
  const suffix = uniqueTypes.size > 2 ? ` +${uniqueTypes.size - 2}` : '';
  return `${first}${suffix}`;
}

function findAllocationMatchInStore(serviceKeyOrSvcs, allocationStore) {
  const allocs = (allocationStore && typeof allocationStore === 'object') ? allocationStore : {};
  const entries = Object.entries(allocs);
  if (entries.length === 0) return { key: null, rawEntry: null, matchKind: 'empty-store' };
  const svc = serviceKeyOrSvcs && typeof serviceKeyOrSvcs === 'object' && !Array.isArray(serviceKeyOrSvcs) && !(serviceKeyOrSvcs instanceof Date || mongoose?.Types?.ObjectId?.isValid?.(serviceKeyOrSvcs))
    ? serviceKeyOrSvcs
    : null;
  const asService = svc ? buildAllocationKeyFromService(serviceKeyOrSvcs) : '';
  const normDirect = normalizeAllocationKeyString(asService || String(serviceKeyOrSvcs || ''));
  const key9 = splitAllocationKeyToTuple(asService || String(serviceKeyOrSvcs || ''));
  const nonEmptyIdx = key9.map((p, i) => p ? i : -1).filter((i) => i >= 0);

  // 1) exact normalized key match
  if (normDirect) {
    for (const [k, v] of entries) {
      const nk = normalizeAllocationKeyString(k);
      if (nk && nk === normDirect) return { key: k, rawEntry: v, matchKind: 'normalized-exact' };
    }
  }
  // 2) fuzzy 70% tuple component match
  if (nonEmptyIdx.length) {
    let best = null; let bestScore = 0;
    for (const [k, v] of entries) {
      const k9 = splitAllocationKeyToTuple(k);
      let same = 0;
      nonEmptyIdx.forEach((i) => { if (k9[i] === key9[i]) same += 1; });
      const score = same / nonEmptyIdx.length;
      if (score >= 0.7 && score > bestScore) { bestScore = score; best = { key: k, rawEntry: v, matchKind: `fuzzy-${Math.round(score * 100)}` }; }
    }
    if (best) return best;
  }
  // 3) literal key match (including original ::-non-filtered)
  const literal = asService || String(serviceKeyOrSvcs || '');
  if (literal && allocs[literal]) return { key: literal, rawEntry: allocs[literal], matchKind: 'literal-exact' };
  return { key: null, rawEntry: null, matchKind: 'none' };
}

function userIdFromAllocEntry(entry) {
  // First: if entry itself is already a plain string/number uid (e.g. "6a732bedffe6621c1d81394a") use it directly
  if (entry == null) return '';
  if (typeof entry === 'string' || typeof entry === 'number') {
    const s = String(entry || '').trim();
    if (!s) return '';
    const m = s.match(/[a-f0-9]{24}/i);
    return m ? m[0] : s;
  }
  const v = typeof entry === 'object' ? entry : {};
  const raw = v.userId || v.user || v.assignedTo || v.uid || v.assigneeId || v.assignee_id || v.assignedUserId || v.id || v._id || v.value || '';
  if (raw == null) return '';
  if (typeof raw === 'object') {
    const id = String(raw?._id || raw?.id || raw?.$oid || raw || '').trim();
    return id && id !== '[object Object]' ? id : '';
  }
  const s = String(raw || '').trim();
  const m = s.match(/[a-f0-9]{24}/i);
  return m ? m[0] : s;
}

function extractServicesFromClientServer(client = {}) {
  const data = Object(client.data || {});
  const rawServices = Array.isArray(client.services) ? client.services : [];
  const map = new Map();
  const services = rawServices.length ? rawServices.map((s) => {
    const sd = (s && typeof s === 'object') ? s : {};
    return Object.assign({}, sd, {
      applicantType: sd.applicantType || sd.piboParent || data.selectedLeadSnapshot?.applicantType || data.selectedLeadSnapshot?.piboParent || data.selectedLeadSnapshot?.piboCategoryParent || '',
      subApplicantType: sd.piboCategory || data.selectedLeadSnapshot?.subApplicantType || data.basic?.piboCategory || data.selectedLeadSnapshot?.piboCategory || sd.subApplicantType || '',
      servicesOffered: sd.servicesOffered || data.selectedLeadSnapshot?.servicesOffered || data.basic?.servicesOffered || '',
      eprCategory: sd.eprCategory || data.selectedLeadSnapshot?.eprCategory || data.basic?.eprCategory || sd.serviceCategory || '',
      financialYear: sd.financialYear || sd.servicesForYear || (Array.isArray(sd.annualReturnYears) ? sd.annualReturnYears[0] : '') || '',
      plantUnit: sd.plantUnit || data.selectedLeadSnapshot?.plantUnit || data.basic?.plantUnit || '',
      piboParent: sd.piboParent || sd.applicantType || data.selectedLeadSnapshot?.piboParent || '',
      piboCategory: sd.piboCategory || sd.subApplicantType || data.selectedLeadSnapshot?.piboCategory || data.basic?.piboCategory || '',
      assignedServiceId: sd.assignedServiceId || data.assignedServiceId || client.assignedServiceId || '',
      serviceCategory: sd.serviceCategory || sd.eprCategory || data.selectedLeadSnapshot?.eprCategory || data.basic?.eprCategory || ''
    });
  }) : [];
  if (services.length) {
    services.forEach((svc) => {
      const k = buildAllocationKeyFromService(svc);
      if (!map.has(k)) map.set(k, svc);
    });
    return Array.from(map.values());
  }
  if (data.selectedLeadSnapshot || data.basic || client.applicantType || client.servicesOffered) {
    const synthetic = {
      applicantType: data.selectedLeadSnapshot?.applicantType || data.selectedLeadSnapshot?.piboParent || client.applicantType || client.piboParent || '',
      subApplicantType: data.selectedLeadSnapshot?.subApplicantType || data.basic?.piboCategory || client.piboCategory || '',
      eprCategory: data.selectedLeadSnapshot?.eprCategory || data.basic?.eprCategory || client.eprCategory || '',
      servicesOffered: data.selectedLeadSnapshot?.servicesOffered || data.basic?.servicesOffered || client.servicesOffered || '',
      financialYear: data.selectedLeadSnapshot?.financialYear || data.basic?.financialYear || client.financialYear || (client.year ? String(client.year) : ''),
      plantUnit: data.selectedLeadSnapshot?.plantUnit || data.basic?.plantUnit || client.plantUnit || '',
      piboCategory: data.selectedLeadSnapshot?.piboCategory || data.basic?.piboCategory || client.piboCategory || '',
      assignedServiceId: client.assignedServiceId || data.assignedServiceId || ''
    };
    return [synthetic];
  }
  return [];
}

exports.upsertClientServiceAllocations = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ ok: false, error: 'Invalid client id' });
    const client = await Client.findOne(combineAccessFilters(
      { _id: id },
      await clientAccessFilter(req.user)
    )).populate('selectedLead').lean(false);
    if (!client) return res.status(404).json({ ok: false, error: 'Client not found or not accessible' });
    const clientServices = extractServicesFromClientServer(client);
    const rawAllocations = req.body?.allocations || req.body?.serviceAllocations || req.body;
    if (!rawAllocations || typeof rawAllocations !== 'object') {
      return res.status(400).json({ ok: false, error: 'Invalid payload — `allocations: {serviceKey: userId}` required' });
    }
    const rawEntries = Object.entries(rawAllocations).filter(([k, v]) => {
      if (!k || typeof k !== 'string') return false;
      if (v == null || v === '' || v === null) return false;
      if (typeof v === 'string' || typeof v === 'number') return true;
      if (typeof v === 'object') {
        if (typeof v.userId !== 'undefined') return true;
        if (typeof v.uid !== 'undefined') return true;
        if (typeof v.user !== 'undefined') return true;
        if (typeof v.assignedTo !== 'undefined') return true;
        if (typeof v.assigneeId !== 'undefined') return true;
        if (typeof v.assignee_id !== 'undefined') return true;
        if (typeof v.assignedUserId !== 'undefined') return true;
        if (typeof v.id !== 'undefined') return true;
        if (typeof v._id !== 'undefined') return true;
        if (typeof v.value !== 'undefined') return true;
        // Also accept any object that contains a 24-hex id pattern in any string property
        const anyHex = Object.values(v).some((val) => typeof val === 'string' && /^[a-f0-9]{24}$/i.test(val.trim()));
        if (anyHex) return true;
      }
      return false;
    });
    console.debug('[alloc:upsert] inbound', { client: id, rawKeys: Object.keys(rawAllocations || {}), rawEntriesCount: rawEntries.length, keys: rawEntries.map(([k,v])=>k).join(' | ') });

    // (1) Validate all referenced userIds exist (allow `{userId}` object shape OR raw string userId)
    const uniqueUserIds = new Set();
    rawEntries.forEach(([, v]) => {
      const uid = userIdFromAllocEntry(v);
      if (uid) uniqueUserIds.add(uid);
    });
    const foundMap = new Map();
    if (uniqueUserIds.size) {
      const validIds = [...uniqueUserIds].filter((uid) => mongoose.Types.ObjectId.isValid(uid));
      const foundUsers = await User.find({ _id: { $in: validIds.map((uid) => new mongoose.Types.ObjectId(uid)) } }, '_id name email role isActive').lean();
      foundUsers.forEach((u) => foundMap.set(String(u._id), u));
      for (const uid of uniqueUserIds) {
        if (!mongoose.Types.ObjectId.isValid(uid) || !foundMap.has(uid)) {
          return res.status(400).json({ ok: false, error: `Invalid user id: ${uid}` });
        }
        const u = foundMap.get(uid);
        if (u.isActive === false) return res.status(400).json({ ok: false, error: `User is inactive: ${u.name || uid}` });
      }
    }

    // (1a) Snapshot PREVIOUS allocations for change detection
    const prevAllocRaw = client.serviceAllocations && typeof client.serviceAllocations === 'object'
      ? (client.serviceAllocations.toObject ? client.serviceAllocations.toObject() : { ...client.serviceAllocations })
      : {};
    const previousAllocations = {};
    Object.entries(prevAllocRaw).forEach(([k, v]) => {
      if (!k || !v) return;
      const uid = userIdFromAllocEntry(v);
      if (!uid) return;
      previousAllocations[k] = {
        userId: uid,
        assignedByName: typeof v === 'object' ? String(v.assignedByName || v.userName || '') : '',
        userName: typeof v === 'object' ? String(v.assignedByName || v.userName || '') : ''
      };
    });

    // (2) Build normalized allocations map: for each incoming (rawKey → uid), find matching stored key via fuzzy rules.
    //     First: use services[] for this client to build canonical keys, then re-key any mismatches.
    const now = new Date();
    const normalized = {};
    Object.entries(previousAllocations).forEach(([k, p]) => {
      if (!p || !p.userId) return;
      normalized[k] = {
        userId: new mongoose.Types.ObjectId(p.userId),
        assignedById: req.user?._id ? new mongoose.Types.ObjectId(req.user._id) : null,
        assignedByName: p.assignedByName || '',
        assignedAt: p.assignedAt || now,
        updatedAt: now,
        updatedBy: String(req.user?.name || '')
      };
    });

    rawEntries.forEach(([rawKey, rawVal]) => {
      let uid = userIdFromAllocEntry(rawVal);
      // FINAL FORCED FALLBACK (cannot return empty after rawEntries filter passed):
      //   if rawVal itself is a valid 24-hex string (e.g. "6a732bedffe6621c1d81394a"), treat as uid directly
      if (!uid && typeof rawVal === 'string') {
        const s = String(rawVal || '').trim();
        const m = s.match(/[a-f0-9]{24}/i);
        if (m) uid = m[0];
      }
      if (!uid && typeof rawVal === 'number' && String(rawVal || '').length >= 12) {
        uid = String(rawVal);
      }
      console.debug('[alloc:upsert:row] rawKey=', rawKey, 'rawVal=', JSON.stringify(rawVal), 'uid=', uid || '(EMPTY — will delete)');
      if (!uid) {
        const delMatch = findAllocationMatchInStore(rawKey, previousAllocations);
        if (delMatch.key) delete normalized[delMatch.key];
        return;
      }
      // Try to find a canonical key for this rawKey:
      // - First: if there's an existing matching slot in prevAllocs, use that key
      // - Else if this rawKey matches any of this client's services fuzzily -> rewrite key to service canonical key
      // - Else keep raw key (still normalized)
      let canonicalKey = normalizeAllocationKeyString(rawKey) || String(rawKey || '');
      let found = null;
      const existingPrev = findAllocationMatchInStore(rawKey, previousAllocations);
      if (existingPrev.key) {
        canonicalKey = existingPrev.key;
        found = { from: 'prev-match' };
      } else if (clientServices.length) {
        const tuple9 = splitAllocationKeyToTuple(rawKey);
        const nonEmptyIdx = tuple9.map((p, i) => p ? i : -1).filter((i) => i >= 0);
        let bestScore = 0;
        for (const svc of clientServices) {
          const svcKey = buildAllocationKeyFromService(svc);
          const nk = normalizeAllocationKeyString(svcKey);
          if (nk && normalizeAllocationKeyString(rawKey) === nk) { canonicalKey = svcKey; found = { from: 'service-normalized-exact' }; break; }
          if (nonEmptyIdx.length) {
            const k9 = splitAllocationKeyToTuple(svcKey);
            let same = 0;
            nonEmptyIdx.forEach((i) => { if (k9[i] === tuple9[i]) same += 1; });
            const score = same / nonEmptyIdx.length;
            if (score >= 0.7 && score > bestScore) { bestScore = score; canonicalKey = svcKey; found = { from: `service-fuzzy-${Math.round(score * 100)}` }; }
          }
        }
      }
      if (!canonicalKey) {
        // absolute fallback — don't drop this! always have a key so allocation persists
        canonicalKey = rawKey || `fallback_${Date.now()}_${Math.round(Math.random()*100000)}`;
        console.warn('[alloc:upsert:row] no canonical key resolved -> forced fallback', canonicalKey);
      }
      const prevForThisKey = previousAllocations[canonicalKey];
      const isReuse = prevForThisKey && String(prevForThisKey.userId) === uid;
      const userObj = foundMap.get(uid) || {};
      console.debug('[alloc:upsert:row] writing canonicalKey=', canonicalKey, 'uid=', uid, 'userObj=', userObj);
      normalized[canonicalKey] = {
        userId: new mongoose.Types.ObjectId(uid),
        userIdString: uid,
        assignedById: req.user?._id ? new mongoose.Types.ObjectId(req.user._id) : null,
        assignedByIdString: req.user?._id ? String(req.user._id) : '',
        assignedByName: String(userObj.name || req.user?.name || ''),
        assignedUserRole: String(userObj.role || ''),
        assignedAt: isReuse && prevForThisKey?.assignedAt ? new Date(prevForThisKey.assignedAt) : now,
        updatedAt: now,
        updatedBy: String(req.user?.name || '')
      };
    });
    console.debug('[alloc:upsert] normalized final keys:', Object.keys(normalized));

    // Detect changed keys (added, removed, owner different) — only these trigger emails/notifs
    const allKeysNow = new Set([...Object.keys(previousAllocations), ...Object.keys(normalized)]);
    const changedKeys = [];
    for (const k of allKeysNow) {
      const prevUid = previousAllocations[k]?.userId || '';
      const newUid = normalized[k] ? userIdFromAllocEntry(normalized[k]) : '';
      if (prevUid !== newUid) changedKeys.push(k);
    }

    // ATOMIC WRITE GUARANTEE: use findByIdAndUpdate + $set (no Mixed markModified bugs)
    const updatePayload = {
      $set: {
        serviceAllocations: normalized,
        updatedAt: now,
        updatedBy: String(req.user?.name || '')
      }
    };
    const atomicResult = await Client.findByIdAndUpdate(client._id, updatePayload, { new: true, runValidators: false, lean: true }).exec();
    console.debug('[alloc:upsert:atomic] findByIdAndUpdate OK, stored serviceAllocations keys:', Object.keys(atomicResult?.serviceAllocations || {}));

    // FULL DB RELOAD (the one source of truth for response; we won't trust in-memory anymore)
    const reloaded = await Client.findById(client._id).populate('selectedLead').lean(false).exec();
    const storedAllocationsRaw = (reloaded && reloaded.serviceAllocations && typeof reloaded.serviceAllocations === 'object')
      ? (reloaded.serviceAllocations.toObject ? reloaded.serviceAllocations.toObject() : { ...reloaded.serviceAllocations })
      : {};
    console.debug('[alloc:upsert:stored] DB reloaded storedAllocations actual keys:', Object.keys(storedAllocationsRaw));

    const savedHydrated = reloaded || client;
    const savedOverview = readClientOverviewFromRecord(savedHydrated);

    // (3) Build response from ACTUAL STORED DB entries (not our in-memory normalized!)
    const newAllocationsForMail = {};
    const responseAllocations = {};
    Object.entries(storedAllocationsRaw).forEach(([k, v]) => {
      const uid = userIdFromAllocEntry(v);
      if (!uid) return;
      const entryName = typeof v === 'object' ? String(v.assignedByName || v.userName || '') : '';
      newAllocationsForMail[k] = { userId: uid, userName: entryName };
      const match = findAllocationMatchInStore(k, previousAllocations);
      responseAllocations[k] = {
        userId: uid,
        userIdString: uid,
        assignedByName: entryName,
        assignedUserRole: typeof v === 'object' ? String(v.assignedUserRole || v.role || '') : '',
        assignedById: typeof v === 'object' ? String(v.assignedByIdString || v.assignedById || req.user?._id || '') : String(req.user?._id || ''),
        assignedAt: typeof v === 'object' && v.assignedAt ? v.assignedAt : now,
        updatedAt: typeof v === 'object' && v.updatedAt ? v.updatedAt : now,
        matchedExistingEntry: match.key ? match : undefined
      };
    });
    console.debug('[alloc:upsert:response] responseAllocations final count=', Object.keys(responseAllocations).length);

    // (4) Audit log, emails + notifications (non-blocking for response)
    const notifPromise = (async () => {
      try {
        const auditClientLabel = savedOverview.companyName || savedOverview.leadCode || String(saved._id);
        await AuditLog.create({
          entityName: 'Client.serviceAllocations',
          recordId: String(saved._id),
          userName: String(req.user?.name || ''),
          userId: String(req.user?._id || ''),
          description: `Assigned ${rawEntries.length} service(s) on client ${auditClientLabel}: ${Object.entries(responseAllocations).map(([k, v]) => `${k.split('::').slice(0, 3).join('|')} -> ${(v.assignedByName || v.userId).slice(0, 16)}`).join(', ')}`,
          createdAt: now
        });
      } catch (err) {
        console.error('[alloc:auditLog]', err.message);
      }
      if (changedKeys.length === 0) return { ok: true, skipped: 'no_changes' };
      try {
        const mailResult = await sendAllocationNotificationsAndEmails({
          client: savedHydrated,
          previousAllocations,
          newAllocations: newAllocationsForMail,
          changedKeys,
          assignedByUser: { _id: String(req.user._id), name: String(req.user.name || ''), email: String(req.user.email || ''), role: String(req.user.role || '') }
        });
        return mailResult;
      } catch (err) {
        console.error('[alloc:notifications]', err.message);
        return { ok: false, error: err.message };
      }
    })();

    res.json({
      ok: true,
      message: `Saved ${Object.keys(responseAllocations).length} service allocation(s) for ${savedOverview.companyName || 'client'}${savedOverview.leadCode ? ' · ' + savedOverview.leadCode : ''}`,
      allocations: responseAllocations,
      allocationKeysCanonical: clientServices.map(buildAllocationKeyFromService),
      changedServices: changedKeys.length,
      notificationsTriggered: changedKeys.length > 0,
      client: savedOverview,
      _debug: {
        rawEntriesCount: rawEntries.length,
        normalizedCount: Object.keys(normalized || {}).length,
        atomicWroteKeys: Object.keys(atomicResult?.serviceAllocations || {}).length,
        storedReloadedKeys: Object.keys(storedAllocationsRaw || {}).length,
        finalResponseAllocCount: Object.keys(responseAllocations).length
      },
      _rawStored: storedAllocationsRaw
    });

    // Fire-and-forget audit + email resolution log
    notifPromise.then((result) => {
      console.debug('[alloc:notifications:done]', JSON.stringify(result));
    }).catch((err) => console.error('[alloc:notifications:bg]', err));
    return null;
  } catch (err) {
    console.error('[clientCtrl:upsertServiceAllocations]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Save failed' });
  }
};

exports.__test = {
  buildClientApprovalPayload,
  applyClientSubmissionMetadata,
  getClientWorkflowTransition,
  mergeAssignedServiceCpcbData,
  readCpcbOnboarding,
  validateCpcbOnboardingInput,
  validateRestrictedCpcbUpdate,
  preserveRestrictedCpcbSections,
  applyCpcbOnboardingData,
  cleanClientLifecycle,
  readRequestedClientId,
  validateClientMasterIdentity,
  normalizeClientMaster,
  resolveClientMasterData
};
