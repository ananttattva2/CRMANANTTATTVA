const Lead = require('../models/Lead');
const { cleanPoCommercialDetails, validatePoCommercialDetails } = require('../utils/poCommercialDetails');
const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
const LeadActivity = require('../models/LeadActivity');
const Quotation = require('../models/Quotation');
const PendingApproval = require('../models/PendingApproval');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { sendMail } = require('../utils/mailer');
const { sendLeadClosureKickoffEmail } = require('../services/leadClosureKickoffEmail');
const { registerStaffOnboardingAssignments } = require('../services/staffOnboardingWorkflow');
const { notifyLeadAssignment } = require('../services/leadAssignmentNotifications');
const { notifyNewFinancialYear } = require('../services/leadFinancialYearNotifications');
const { notifyAdditionalLeadServices } = require('../services/leadServiceContributorNotifications');
const { claimLeadRoyalty } = require('../services/leadRoyaltyNotifications');
const { normalizeCompanyIdentity } = require('../services/crmRecordPersistence');
const { notifyNewProvisionalClosures } = require('../services/provisionalLeadClosureWorkflow');
const { resolvePoProof, resolveApprovalPoProof } = require('../services/poProofResolver');
const { normalizeProvisionalClosure, permanentlyCloseProvisionalAssignments } = require('../utils/provisionalClosureDeadline');
const LeadDropdownOption = require('../models/LeadDropdownOption');
const { sendLeadIntroductionEmail } = require('../services/leadIntroductionEmail');
const {
  getAdminCreatedLeadReferences,
  dashboardLeadExclusionFilter
} = require('../services/dashboardTestLeadExclusion');

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}
const CalendarItem = require('../models/CalendarItem');
const { getVisibleUserScope, ownerFilter } = require('../utils/visibilityScope');
const { userHasAnyRole } = require('../utils/userRoles');
const { normalizeParent, inferPiboParent, validatePiboSelection } = require('../utils/piboCategories');
const { ADMIN_ROLES } = require('../constants/roles');

async function leadAccessFilter(user) {
  const scope = await getVisibleUserScope(user);
  return ownerFilter(scope, 'createdBy', 'assignedTo', [
    'createdByCrmUserId',
    'createdByName',
    'createdByEmail',
    'importedCreatedBy',
    'generatedForName',
    'generatedForEmail',
    'assignedToText',
    'assignedToEmail',
    'assignedStaffText',
    'assignedStaffEmail',
    'assignments.assignedToText',
    'assignments.assignedToEmail',
    'assignments.assignedStaffText',
    'assignments.assignedStaffEmail',
    'serviceSelections.createdByCrmUserId',
    'serviceSelections.createdByName',
    'serviceSelections.createdByEmail'
  ], [
    'secondaryCreatedBy',
    'generatedForUser',
    'assignedStaff',
    'assignments.assignedTo',
    'assignments.assignedStaff'
  ]);
}

function combineAccessFilters(...filters) {
  const active = filters.filter((filter) => filter && Object.keys(filter).length);
  return active.length > 1 ? { $and: active } : active[0] || {};
}

function identityTokens(...values) {
  return [...new Set(values.flatMap((value) => value && typeof value === 'object'
    ? [value._id, value.id, value.crmUserId, value.userId, value.email, value.name]
    : [value]).map(stableUserIdentity).filter(Boolean))];
}

function hasPendingClosedManagerAssignment(lead = {}, user = {}) {
  const savedAssignments = Array.isArray(lead.assignments) ? lead.assignments : [];
  const assignmentsHaveManager = savedAssignments.some((row) => identityTokens(row?.assignedTo, row?.assignedToText, row?.assignedToEmail).length);
  const assignments = savedAssignments.length && assignmentsHaveManager ? savedAssignments : [lead];
  const restrictToManager = userHasAnyRole(user, ['manager']) && !userHasAnyRole(user, ADMIN_ROLES);
  const userTokens = identityTokens(user._id, user.id, user.crmUserId, user.userId, user.email, user.name);

  return assignments.some((row) => {
    const isClosed = identityTokens(row?.closedBy, row?.closedByText, row?.closedByEmail).length > 0 || Boolean(row?.closedAt);
    const managerTokens = identityTokens(row?.assignedTo, row?.assignedToText, row?.assignedToEmail);
    const hasStaff = identityTokens(row?.assignedStaff, row?.assignedStaffText, row?.assignedStaffEmail).length > 0;
    if (!isClosed || !managerTokens.length || hasStaff) return false;
    return !restrictToManager || managerTokens.some((token) => userTokens.includes(token));
  });
}

function stableUserIdentity(value) {
  if (value && typeof value === 'object') {
    const nestedIdentity = value._id || value.id || value.crmUserId || value.userId || value.email;
    if (nestedIdentity && nestedIdentity !== value) return stableUserIdentity(nestedIdentity);
    const serialized = typeof value.toString === 'function' ? value.toString() : '';
    return serialized === '[object Object]' ? '' : String(serialized || '').trim().toLowerCase();
  }
  return String(value || '').trim().toLowerCase();
}

function canAssignStaffToRow(user = {}, assignment = {}) {
  if (userHasAnyRole(user, ADMIN_ROLES)) return true;
  if (!userHasAnyRole(user, ['manager'])) return false;
  const userTokens = [user._id, user.id, user.crmUserId, user.userId, user.email]
    .map(stableUserIdentity).filter(Boolean);
  const managerTokens = [assignment.assignedTo, assignment.assignedToCrmUserId, assignment.assignedToEmail]
    .map(stableUserIdentity).filter(Boolean);
  return managerTokens.some((token) => userTokens.includes(token));
}

function activeUserLookup(value) {
  const identity = value && typeof value === 'object'
    ? String(value._id || value.id || value.crmUserId || value.userId || value.email || '').trim()
    : String(value || '').trim();
  if (!identity) return null;
  const conditions = [{ crmUserId: identity }, { email: identity.toLowerCase() }];
  if (/^[a-f\d]{24}$/i.test(identity)) conditions.push({ _id: identity });
  return { isActive: { $ne: false }, $or: conditions };
}

const REQUIRED_FIELDS = ['status', 'company', 'servicesOffered', 'addressLine1', 'state', 'city', 'pinCode'];
const LEAD_CODE_PREFIX = 'ATPL-LEAD-';
const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function sendIntroductionWhenRequested(lead, creator) {
  const requestedAt = new Date();
  if (lead.workflowStatus !== 'submitted') {
    const result = { requested: true, sent: false, status: 'skipped', reason: 'not-submitted' };
    await Lead.updateOne({ _id: lead._id }, { $set: { introductionEmailLastRequestedAt: requestedAt, introductionEmailLastStatus: 'skipped', introductionEmailLastError: result.reason } });
    return result;
  }
  try {
    const result = await sendLeadIntroductionEmail({ lead: lead.toObject(), creator });
    if (result?.sent) {
      const sentAt = new Date();
      await Lead.updateOne({ _id: lead._id }, {
        $set: { introductionEmailSentAt: sentAt, introductionEmailLastRequestedAt: requestedAt, introductionEmailLastStatus: 'sent', introductionEmailLastError: '' },
        $inc: { introductionEmailVersion: 1 }
      });
      return { ...result, requested: true, status: 'sent', sentAt };
    }
    const reason = result?.reason || 'send-skipped';
    await Lead.updateOne({ _id: lead._id }, { $set: { introductionEmailLastRequestedAt: requestedAt, introductionEmailLastStatus: 'skipped', introductionEmailLastError: reason } });
    return { ...result, requested: true, sent: false, status: 'skipped', reason };
  } catch (error) {
    console.error('Requested lead introduction email failed', error);
    const failure = String(error?.message || 'Mail provider rejected the request').slice(0, 500);
    await Lead.updateOne({ _id: lead._id }, { $set: { introductionEmailLastRequestedAt: requestedAt, introductionEmailLastStatus: 'failed', introductionEmailLastError: failure } }).catch(() => null);
    return { requested: true, sent: false, status: 'failed', reason: 'send-failed', message: 'The mail provider could not send the introduction email. Please retry the lead submission.' };
  }
}

exports.listLeadDropdownOptions = async (_req, res) => {
  const rows = await LeadDropdownOption.find().sort({ field: 1, name: 1 }).lean();
  const options = rows.reduce((result, row) => {
    if (!result[row.field]) result[row.field] = [];
    result[row.field].push(row.name);
    return result;
  }, {});
  res.json({ ok: true, options });
};

exports.listAssignmentUsers = async (_req, res) => {
  const users = await User.find({ isActive: { $ne: false } })
    .select('crmUserId name email avatarUrl role roles team teamId managerId operationHeadId isActive')
    .sort({ name: 1, email: 1 })
    .lean();
  res.json({ ok: true, users });
};

exports.createLeadDropdownOption = async (req, res) => {
  const field = String(req.body.field || '').trim();
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
  if (!LeadDropdownOption.ALLOWED_FIELDS.includes(field)) return res.status(400).json({ error: 'This dropdown cannot be customized.' });
  if (name.length < 2) return res.status(400).json({ error: 'Enter at least 2 characters.' });
  try {
    const option = await LeadDropdownOption.create({ field, name, normalizedName: name.toLowerCase(), createdBy: req.user._id });
    return res.status(201).json({ ok: true, option });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'This option already exists.' });
    throw error;
  }
};

function usesDirectApplicantType(eprCategory) {
  const category = String(eprCategory || '').toLowerCase();
  return Boolean(category && !category.includes('plastic'));
}

function primaryServiceCategory(data = {}, fallback = {}) {
  const dataServices = Array.isArray(data.serviceSelections) ? data.serviceSelections : [];
  const fallbackServices = Array.isArray(fallback.serviceSelections) ? fallback.serviceSelections : [];
  return String(
    dataServices[0]?.eprCategory
    || data.eprCategory
    || fallbackServices[0]?.eprCategory
    || fallback.eprCategory
    || ''
  ).trim();
}

function shouldValidatePiboSelection(data = {}, fallback = {}) {
  const workflowStatus = data.workflowStatus || fallback.workflowStatus || 'draft';
  return (!usesDirectApplicantType(primaryServiceCategory(data, fallback)) && workflowStatus === 'submitted')
    || Boolean(data.piboParent || data.subApplicantType);
}

function cleanBody(body) {
  const data = {};
  [
    'communicationMode',
    'communicationModeNote',
    'sourceLeadId',
    'status',
    'company',
    'industryType',
    'eprCategory',
    'piboParent',
    'piboCategoryParent',
    'piboCategory',
    'subApplicantType',
    'applicantType',
    'serviceSelections',
    'servicesOffered',
    'applicableService',
    'firstAnnualReturnYearApplicable',
    'addresses',
    'contacts',
    'assignments',
    'addressLine1',
    'addressLine2',
    'addressLine3',
    'landmark',
    'state',
    'city',
    'pinCode',
    'existingClient',
    'website',
    'salutation',
    'contactPerson',
    'designation',
    'emails',
    'emailsSentCount',
    'lastEmailSent',
    'mobileNo1',
    'mobileNo2',
    'whatsappNo',
    'linkedinUrl',
    'businessCardUrl',
    'referredBy',
    'source',
    'notes',
    'assignedTo',
    'assignedToText',
    'assignedStaff',
    'assignedStaffText',
    'assignedStaffEmail',
    'assignedBy',
    'importedCreatedBy',
    'createdByCrmUserId',
    'createdByName',
    'createdByEmail',
    'generatedForUser',
    'generatedForName',
    'generatedForEmail',
    'creationMode',
    'createdOnBehalfOfUser',
    'createdOnBehalfOfName',
    'createdOnBehalfOfEmail',
    'updatedBy',
    'closedBy',
    'closedByText',
    'closedByEmail',
    'closedOnBehalfOfUser',
    'closedOnBehalfOfName',
    'closedOnBehalfOfEmail',
    'closedAt',
    'leadDate',
    'nextFollowUpDate',
    'nextFollowUpTime',
    'followUpRemarks',
    'followUpPriority',
    'followUpFlag',
    'followUpHistory',
    'importedCreatedAt',
    'importedUpdatedAt',
    'workflowStatus',
    'bulkImported',
    'recordStatus',
    'complianceHealthReport'
    ,'formStartedAt'
    ,'assignReachedAt'
    ,'submittedAt'
    ,'fillDurationSeconds'
  ].forEach((key) => {
    if (body[key] !== undefined) {
      const value = typeof body[key] === 'string' ? body[key].trim() : body[key];
      if (['assignedTo', 'assignedStaff', 'closedBy', 'generatedForUser', 'createdOnBehalfOfUser', 'closedOnBehalfOfUser'].includes(key) && !value) return;
      if (key === 'complianceHealthReport') {
        if (value && typeof value === 'object' && !Array.isArray(value)) data[key] = value;
        return;
      }
      if (key === 'serviceSelections') {
        data[key] = Array.isArray(value) ? value.map((row) => ({
          assignedServiceId: String(row?.assignedServiceId || row?.serviceAssignmentId || `service_assignment_${randomUUID()}`).trim(),
          industryType: String(row?.industryType || '').trim(),
          eprCategory: String(row?.eprCategory || '').trim(),
          businessCategory: String(row?.businessCategory || '').trim().replace(/\s+/g, ' ').slice(0, 100),
          applicantType: String(row?.applicantType || '').trim(),
          subApplicantType: String(row?.subApplicantType || row?.piboCategory || '').trim(),
          servicesOffered: String(row?.servicesOffered || '').trim(),
          applicableService: String(row?.applicableService || '').trim(),
          plantUnit: /^Unit (?:[1-9]|10)$/.test(String(row?.plantUnit || '').trim()) ? String(row.plantUnit).trim() : '',
          firstAnnualReturnYearApplicable: String(row?.firstAnnualReturnYearApplicable || '').trim(),
          nextFollowUpDate: String(row?.nextFollowUpDate || '').trim(),
          nextFollowUpTime: String(row?.nextFollowUpTime || '').trim(),
          followUpRemarks: String(row?.followUpRemarks || '').trim(),
          followUpPriority: String(row?.followUpPriority || 'Medium').trim(),
          followUpUpdatedAt: String(row?.followUpUpdatedAt || '').trim(),
          followUpClosedAt: String(row?.followUpClosedAt || '').trim(),
          followUpClosedBy: String(row?.followUpClosedBy || '').trim(),
          followUpCloseReason: String(row?.followUpCloseReason || '').trim(),
          followUpFlag: String(row?.followUpFlag || '').trim(),
          followUpHistory: Array.isArray(row?.followUpHistory) ? row.followUpHistory.slice(0, 100) : [],
          createdByCrmUserId: String(row?.createdByCrmUserId || '').trim(),
          createdByName: String(row?.createdByName || '').trim(),
          createdByEmail: String(row?.createdByEmail || '').trim().toLowerCase()
        })) : [];
        return;
      }
      if (key === 'addresses') {
        data[key] = Array.isArray(value) ? value.map((row) => ({
          assignedServiceId: String(row?.assignedServiceId || '').trim(),
          plantUnit: String(row?.plantUnit || '').trim(),
          addressLine1: String(row?.addressLine1 || '').trim(),
          addressLine2: String(row?.addressLine2 || '').trim(),
          addressLine3: String(row?.addressLine3 || '').trim(),
          landmark: String(row?.landmark || '').trim(),
          state: String(row?.state || '').trim(),
          city: String(row?.city || '').trim(),
          pinCode: String(row?.pinCode || '').trim(),
          existingClient: row?.existingClient === 'Yes' ? 'Yes' : 'No',
          website: String(row?.website || '').trim()
        })) : [];
        return;
      }
      if (key === 'contacts') {
        data[key] = Array.isArray(value) ? value.map((row) => ({
          assignedServiceId: String(row?.assignedServiceId || '').trim(),
          plantUnit: String(row?.plantUnit || '').trim(),
          salutation: String(row?.salutation || '').trim(),
          contactPerson: String(row?.contactPerson || '').trim(),
          designation: String(row?.designation || '').trim(),
          emails: String(row?.emails || '').trim(),
          mobileNo1: String(row?.mobileNo1 || '').replace(/\D/g, '').slice(0, 10),
          mobileNo2: String(row?.mobileNo2 || '').replace(/\D/g, '').slice(0, 10),
          whatsappNo: String(row?.whatsappNo || '').replace(/\D/g, '').slice(0, 10),
          linkedinUrl: String(row?.linkedinUrl || '').trim(),
          referredBy: String(row?.referredBy || '').trim(),
          source: String(row?.source || '').trim(),
          businessCardUrl: String(row?.businessCardUrl || '').trim()
        })) : [];
        return;
      }
      if (key === 'assignments') {
        data[key] = Array.isArray(value) ? value.map((row) => ({
          assignedServiceId: String(row?.assignedServiceId || '').trim(),
          plantUnit: String(row?.plantUnit || '').trim(),
          assignedTo: String(row?.assignedTo || '').trim(),
          assignedToText: String(row?.assignedToText || '').trim(),
          assignedToEmail: String(row?.assignedToEmail || '').trim(),
          closedBy: String(row?.closedBy || '').trim(),
          closedByText: String(row?.closedByText || '').trim(),
          closedByEmail: String(row?.closedByEmail || '').trim(),
          closedAt: String(row?.closedAt || '').trim(),
          closedOnBehalfOfUser: String(row?.closedOnBehalfOfUser || '').trim(),
          closedOnBehalfOfName: String(row?.closedOnBehalfOfName || '').trim(),
          closedOnBehalfOfEmail: String(row?.closedOnBehalfOfEmail || '').trim().toLowerCase(),
          assignedStaff: String(row?.assignedStaff || '').trim(),
          assignedStaffText: String(row?.assignedStaffText || '').trim(),
          assignedStaffEmail: String(row?.assignedStaffEmail || '').trim(),
          assignedBy: String(row?.assignedBy || '').trim(),
          // Permanent closure is server-only and cannot be forged through a normal lead update.
          poStatus: ['received', 'provisional'].includes(String(row?.poStatus || '')) ? String(row.poStatus) : '',
          poYearRows: Array.isArray(row?.poYearRows) ? row.poYearRows.slice(0, 25).map((po) => ({
            fy: String(po?.fy || '').trim(), poNumber: String(po?.poNumber || '').trim(),
            poDate: String(po?.poDate || '').trim(),
            ...cleanPoCommercialDetails(po),
            poAmount: Math.max(0, Number(po?.poAmount) || 0),
            poFileUrl: resolvePoProof(po).url, poFileName: resolvePoProof(po).name,
            poFileMimeType: String(po?.poFileMimeType || '').trim(),
            poFileSize: Number.isFinite(Number(po?.poFileSize)) && Number(po.poFileSize) >= 0 ? Number(po.poFileSize) : null,
            currency: String(po?.currency || 'INR').trim() || 'INR',
            poReceivedDate: String(po?.poReceivedDate || '').trim(),
            services: Array.isArray(po?.services) ? po.services.map((service) => String(service || '').trim()).filter(Boolean) : [],
            quotationId: String(row?.quotationSent || '').toLowerCase() === 'yes' ? String(po?.quotationId || '').trim() : '',
            quotationNumber: String(row?.quotationSent || '').toLowerCase() === 'yes' ? String(po?.quotationNumber || '').trim() : '',
            quotationItems: String(row?.quotationSent || '').toLowerCase() === 'yes' && Array.isArray(po?.quotationItems) ? po.quotationItems.slice(0, 25) : [],
            quotationSent: ['yes', 'no'].includes(String(row?.quotationSent || '').toLowerCase()) ? String(row.quotationSent).toLowerCase() : '',
            quotationBasicAmount: String(row?.quotationSent || '').toLowerCase() === 'yes' ? Math.max(0, Number(po?.quotationBasicAmount) || 0) : 0,
            earlierQuotationProofUrl: String(row?.quotationSent || '').toLowerCase() === 'no' ? String(po?.earlierQuotationProofUrl || '').trim() : '',
            earlierQuotationProofName: String(row?.quotationSent || '').toLowerCase() === 'no' ? String(po?.earlierQuotationProofName || '').trim() : '',
            quotationCreatedById: String(row?.quotationSent || '').toLowerCase() === 'yes' ? String(po?.quotationCreatedById || '').trim() : '',
            quotationCreatedByEmail: String(row?.quotationSent || '').toLowerCase() === 'yes' ? String(po?.quotationCreatedByEmail || '').trim().toLowerCase() : ''
          })) : [],
          poApprovalStatus: ['PENDING', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED'].includes(String(row?.poApprovalStatus || '').toUpperCase()) ? String(row.poApprovalStatus).toUpperCase() : '',
          quotationSent: ['yes', 'no'].includes(String(row?.quotationSent || '').toLowerCase()) ? String(row.quotationSent).toLowerCase() : '',
          earlierQuotationProofUrl: String(row?.earlierQuotationProofUrl || '').trim(),
          earlierQuotationProofName: String(row?.earlierQuotationProofName || '').trim(),
          closureRequestedBy: String(row?.closureRequestedBy || '').trim(),
          closureRequestedByText: String(row?.closureRequestedByText || '').trim(),
          closureFinalizedByManager: Boolean(row?.closureFinalizedByManager),
          closureApprovalProofUrl: String(row?.closureApprovalProofUrl || '').trim(),
          closureApprovalProofName: String(row?.closureApprovalProofName || '').trim(),
          provisionalCloseExpiresAt: String(row?.provisionalCloseExpiresAt || '').trim(),
          provisionalCloseDeadlineBusinessDays: Math.max(0, Number(row?.provisionalCloseDeadlineBusinessDays) || 0),
          originalPoConfirmed: Boolean(row?.originalPoConfirmed),
          permanentClosedAt: String(row?.permanentClosedAt || '').trim(),
          permanentClosedBy: String(row?.permanentClosedBy || '').trim(),
          permanentClosedByText: String(row?.permanentClosedByText || '').trim(),
          kickoffEmailConsent: row?.kickoffEmailConsent === 'yes' ? 'yes' : row?.kickoffEmailConsent === 'no' ? 'no' : ''
        })) : [];
        return;
      }
      data[key] = key === 'emailsSentCount' ? Number(value) || 0 : value;
      if (key === 'followUpHistory') data[key] = Array.isArray(value) ? value : [];
    }
  });
  const serviceProfileFields = [
    'serviceSelections', 'industryType', 'eprCategory', 'businessCategory',
    'applicantType', 'piboParent', 'piboCategoryParent', 'piboCategory',
    'subApplicantType', 'servicesOffered', 'applicableService',
    'firstAnnualReturnYearApplicable'
  ];
  const updatesServiceProfile = serviceProfileFields.some((field) => Object.prototype.hasOwnProperty.call(body, field));
  if (updatesServiceProfile) {
    const primaryService = Array.isArray(data.serviceSelections) ? data.serviceSelections[0] : null;
    if (primaryService) {
      data.industryType = primaryService.industryType || data.industryType;
      data.eprCategory = primaryService.eprCategory || data.eprCategory;
      data.businessCategory = primaryService.businessCategory || data.businessCategory;
      data.applicantType = primaryService.applicantType || data.applicantType;
      data.subApplicantType = primaryService.subApplicantType || data.subApplicantType || data.piboCategory;
      data.servicesOffered = primaryService.servicesOffered || data.servicesOffered;
      data.firstAnnualReturnYearApplicable = primaryService.firstAnnualReturnYearApplicable || data.firstAnnualReturnYearApplicable;
    }
    data.subApplicantType = String(data.subApplicantType || data.piboCategory || '').trim();
    data.piboParent = normalizeParent(data.piboParent || data.piboCategoryParent) || inferPiboParent(data.subApplicantType) || undefined;
    if (/\btyre\b/i.test(String(data.eprCategory || '')) && ['Producer', 'Recycler', 'Retreader'].includes(data.applicantType)) {
      const compatibility = data.applicantType === 'Producer'
        ? { piboParent: 'PIBO', subApplicantType: 'Producer' }
        : data.applicantType === 'Recycler'
          ? { piboParent: 'PWP', subApplicantType: 'Recycler' }
          : { piboParent: 'PWP', subApplicantType: 'PWP' };
      Object.assign(data, compatibility);
    } else if (usesDirectApplicantType(data.eprCategory)) {
      // Direct-applicant services (for example Solid Waste Management) do not
      // use PIBO/SIMP/PWP. Clear stale values inherited from legacy or previously
      // selected service categories before submitted-lead validation runs.
      data.piboParent = undefined;
      data.subApplicantType = '';
    }
    delete data.piboCategoryParent;
    delete data.piboCategory;
  }
  return data;
}

function validateSubmittedLead(data) {
  const missing = REQUIRED_FIELDS.filter((field) => !data[field]);
  if (missing.length) return `Missing required fields: ${missing.join(', ')}`;
  const serviceRows = Array.isArray(data.serviceSelections) && data.serviceSelections.length ? data.serviceSelections : [data];
  const requiredServiceFields = [
    ['industryType', 'Industry Type'],
    ['businessCategory', 'Business Category'],
    ['firstAnnualReturnYearApplicable', 'Financial Year']
  ];
  const usesPlantUnits = serviceRows.some((row) => String(row?.plantUnit || '').trim());
  if (usesPlantUnits) requiredServiceFields.splice(2, 0, ['plantUnit', 'Plant Unit']);
  for (let index = 0; index < serviceRows.length; index += 1) {
    const missingServiceFields = requiredServiceFields
      .filter(([field]) => !String(serviceRows[index]?.[field] || '').trim())
      .map(([, label]) => label);
    if (missingServiceFields.length) return `Service row ${index + 1}: ${missingServiceFields.join(', ')} ${missingServiceFields.length === 1 ? 'is' : 'are'} required`;
  }
  if (!usesDirectApplicantType(data.eprCategory) && !data.subApplicantType) return 'Sub Applicant Type is required';
  const addresses = Array.isArray(data.addresses) && data.addresses.length ? data.addresses : [data];
  if (addresses.some((row) => !/^\d{6}$/.test(String(row?.pinCode || '')))) return 'Every PIN code must contain exactly 6 digits';
  const contacts = Array.isArray(data.contacts) && data.contacts.length ? data.contacts : [data];
  const assignments = Array.isArray(data.assignments) ? data.assignments : [];
  const distinctPlantUnits = [...new Set(serviceRows.map((row) => String(row?.plantUnit || '').trim()).filter(Boolean))];
  if (usesPlantUnits && (addresses.length < distinctPlantUnits.length || contacts.length < distinctPlantUnits.length || assignments.length !== serviceRows.length)) return 'Every selected Plant Unit must have at least one matching Address and Contact row, and every service must have one Assignment row';
  if (usesPlantUnits && distinctPlantUnits.some((unit) => !addresses.some((row) => row?.plantUnit === unit) || !contacts.some((row) => row?.plantUnit === unit))) return 'Address and Contact rows must match their Plant Unit';
  if (usesPlantUnits && serviceRows.some((service, index) => assignments[index]?.assignedServiceId !== service.assignedServiceId)) return 'Assignment rows must match their assignedServiceId';
  if (contacts.some((row) => !row.salutation || !row.contactPerson || !row.designation || !row.emails || !row.mobileNo1 || !row.referredBy || !row.source)) return 'All contact fields except Mobile No. 2 and Business Card are required';
  if (contacts.some((row) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(row.emails || '')))) return 'Every contact must have a valid email address';
  if (contacts.some((row) => !/^\d{10}$/.test(String(row.mobileNo1 || '')))) return 'Every primary mobile number must contain exactly 10 digits';
  if (contacts.some((row) => row.whatsappNo && !/^\d{10}$/.test(String(row.whatsappNo)))) return 'Every WhatsApp number must contain exactly 10 digits';
  if (contacts.some((row) => row.linkedinUrl && !/^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\//i.test(String(row.linkedinUrl)))) return 'Every LinkedIn value must be a valid linkedin.com URL';
  return '';
}

function isAssignmentOnlyLeadUpdate(body = {}) {
  if (!Array.isArray(body?.assignments) || !body.assignments.length) return false;
  const allowedFields = new Set(['assignments', 'workflowStatus', 'modifyPoDetails']);
  return Object.keys(body).every((field) => allowedFields.has(field));
}

function logLeadUpdateRejection(poDebugId, lead, stage, error) {
  if (!poDebugId) return;
  console.warn('[POProof:lead:rejected]', {
    poDebugId,
    leadId: String(lead?._id || ''),
    leadCode: lead?.leadCode || '',
    stage,
    error
  });
}

const SERVICE_DUPLICATE_FIELDS = ['industryType', 'eprCategory', 'applicantType', 'subApplicantType', 'servicesOffered', 'plantUnit', 'firstAnnualReturnYearApplicable'];

function validateDuplicateServiceSelections(data = {}) {
  const rows = Array.isArray(data.serviceSelections) ? data.serviceSelections : [];
  const seen = new Map();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const complete = SERVICE_DUPLICATE_FIELDS.every((field) => field === 'subApplicantType' && usesDirectApplicantType(row.eprCategory)
      ? true
      : Boolean(String(row[field] || '').trim()));
    if (!complete) continue;
    const identity = SERVICE_DUPLICATE_FIELDS.map((field) => String(row[field] || '').trim().toLowerCase()).join('|');
    if (seen.has(identity)) return `Service row ${index + 1} duplicates row ${seen.get(identity) + 1}. Change at least one service field.`;
    seen.set(identity, index);
  }
  return '';
}

function findExistingAssignment(previousAssignments = [], row = {}, index = -1) {
  const serviceId = String(row?.assignedServiceId || '').trim();
  const byServiceId = previousAssignments.find((item) => serviceId && String(item?.assignedServiceId || '').trim() === serviceId);
  if (byServiceId) return byServiceId;

  const indexedPrevious = previousAssignments[index];
  if (!indexedPrevious) return null;
  const previousServiceId = String(indexedPrevious?.assignedServiceId || '').trim();
  const isLegacyClosedRow = Boolean(indexedPrevious.closedBy && row?.closedBy && (!serviceId || !previousServiceId));
  return isLegacyClosedRow ? indexedPrevious : null;
}

function primaryLeadOwnerIdentity(lead = {}) {
  const ownerRef = lead.generatedForUser || lead.createdOnBehalfOfUser || lead.createdBy || '';
  return {
    id: String(ownerRef?._id || ownerRef || '').trim(),
    name: String(ownerRef?.name || lead.generatedForName || lead.createdOnBehalfOfName || lead.createdByName || lead.createdBy?.name || lead.importedCreatedBy || '').trim(),
    email: String(ownerRef?.email || lead.generatedForEmail || lead.createdOnBehalfOfEmail || lead.createdByEmail || lead.createdBy?.email || '').trim().toLowerCase()
  };
}

function enforcePrimaryOwnerClosureCredit(previousLead = {}, data = {}, actor = {}) {
  if (!Array.isArray(data.assignments)) return data;
  const previousAssignments = Array.isArray(previousLead.assignments) ? previousLead.assignments : [];
  const owner = primaryLeadOwnerIdentity(previousLead);
  const actorId = String(actor?._id || actor?.id || '').trim();
  const actorName = String(actor?.name || actor?.email || '').trim();
  let closureStarted = false;
  let directlyClosed = false;
  data.assignments = data.assignments.map((row, index) => {
    const previous = findExistingAssignment(previousAssignments, row, index) || previousAssignments[index] || {};
    const newlyClosing = Boolean((row?.closureRequestedBy && !previous?.closureRequestedBy) || (row?.closedBy && !previous?.closedBy));
    if (!newlyClosing) return row;
    closureStarted = true;
    directlyClosed = directlyClosed || Boolean(row?.closedBy);
    return {
      ...row,
      ...(row?.closureRequestedBy && actorId ? { closureRequestedBy: actorId, closureRequestedByText: actorName } : {}),
      ...(row?.closedBy && actorId ? { closedBy: actorId, closedByText: actorName, closedByEmail: String(actor?.email || '').trim().toLowerCase() } : {}),
      ...(owner.id ? { closedOnBehalfOfUser: owner.id } : { closedOnBehalfOfUser: '' }),
      closedOnBehalfOfName: owner.name,
      closedOnBehalfOfEmail: owner.email
    };
  });
  if (closureStarted) {
    if (owner.id) data.closedOnBehalfOfUser = owner.id;
    else delete data.closedOnBehalfOfUser;
    data.closedOnBehalfOfName = owner.name;
    data.closedOnBehalfOfEmail = owner.email;
    if (directlyClosed && actorId) {
      data.closedBy = actorId;
      data.closedByText = actorName;
      data.closedByEmail = String(actor?.email || '').trim().toLowerCase();
    }
  }
  return data;
}

function setProvisionalClosureDeadlines(data, beforeLead = {}) {
  if (Array.isArray(data.assignments)) {
    const now = new Date();
    data.assignments = data.assignments.map((row, index) => normalizeProvisionalClosure(
      row, findExistingAssignment(beforeLead.assignments || [], row, index) || {}, now
    ));
  }
  return data;
}

function validateClosureAssignments(data = {}, previousData = null) {
  const rows = Array.isArray(data.assignments) ? data.assignments : [];
  const previousAssignments = Array.isArray(previousData?.assignments) ? previousData.assignments : [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    if (!row.closedBy && !row.closureRequestedBy) continue;
    // An already-closed service may be edited without re-entering legacy PO
    // fields. A newly appended service has no previous match and remains strict.
    if (findExistingAssignment(previousAssignments, row, index)?.closedBy) continue;
    if (row.poStatus === 'received') {
      const poRows = Array.isArray(row.poYearRows) ? row.poYearRows : [];
      if (!poRows.length || poRows.some((po) => !po.fy || !po.poNumber || !(Number(po.poAmount) > 0) || !po.poFileUrl || !Array.isArray(po.services) || !po.services.length)) return `Assignment row ${index + 1}: complete every PO detail, including PO Amount, before closing.`;
    } else if (row.poStatus === 'provisional') {
      if (!row.closureApprovalProofUrl || !row.provisionalCloseExpiresAt) return `Assignment row ${index + 1}: Super Admin approval proof is required for closure without PO.`;
    } else return `Assignment row ${index + 1}: choose whether the PO was received before closing.`;
  }
  return '';
}

function normalizedPoClosureRows(assignment = {}) {
  return (Array.isArray(assignment?.poYearRows) ? assignment.poYearRows : []).map((po) => ({
    fy: String(po?.fy || '').trim(),
    poNumber: String(po?.poNumber || '').trim(),
    poDate: String(po?.poDate || '').trim(),
    poEndDate: String(po?.poEndDate || '').trim(),
    poFinancialYear: String(po?.poFinancialYear || '').trim(),
    annualReturnYear: String(po?.annualReturnYear || '').trim(),
    registrationYear: String(po?.registrationYear || '').trim(),
    paymentTerm: String(po?.paymentTerm || '').trim(),
    poAmount: Math.max(0, Number(po?.poAmount) || 0),
    poFileUrl: resolvePoProof(po).url,
    services: (Array.isArray(po?.services) ? po.services : [])
      .map((service) => String(service || '').trim())
      .filter(Boolean)
      .sort()
  }));
}

function poClosureSubmissionChanged(previous = {}, next = {}) {
  if (String(previous?.poStatus || '') !== String(next?.poStatus || '')) return true;
  const previousClosing = Boolean(previous?.closedBy || previous?.closureRequestedBy);
  const nextClosing = Boolean(next?.closedBy || next?.closureRequestedBy);
  if (previousClosing !== nextClosing) return true;
  return JSON.stringify(normalizedPoClosureRows(previous)) !== JSON.stringify(normalizedPoClosureRows(next));
}

function preserveExistingClosureEvidence(beforeData = {}, nextData = {}) {
  if (!Array.isArray(nextData.assignments)) return nextData;
  const previousAssignments = Array.isArray(beforeData.assignments) ? beforeData.assignments : [];
  nextData.assignments = nextData.assignments.map((row, index) => {
    const previous = findExistingAssignment(previousAssignments, row, index);
    if (!previous) return row;
    const previousPoRows = Array.isArray(previous.poYearRows) ? previous.poYearRows : [];
    const nextPoRows = Array.isArray(row.poYearRows) ? row.poYearRows : [];
    const mergedPoRows = nextPoRows.length ? nextPoRows.map((po, poIndex) => {
      // Match by poNumber only when both sides carry a non-empty poNumber; avoid accidental positional reuse.
      let saved = {};
      if (po?.poNumber) {
        saved = previousPoRows.find((item) => item && item.poNumber === po.poNumber) || {};
      }
      if (
        !saved
        && previousPoRows.length > 0
        && previousPoRows.length === nextPoRows.length
        && (!po?.poNumber || (previousPoRows[poIndex] && previousPoRows[poIndex].poNumber === po.poNumber))
      ) {
        saved = previousPoRows[poIndex] || {};
      }
      const finalProof = resolvePoProof(po, saved);
      return {
        ...saved,
        ...po,
        poYear: String(po?.poYear || saved?.poYear || '').trim(),
        poNumber: String(po?.poNumber || saved?.poNumber || '').trim(),
        poAmount: Math.max(
          0,
          Number(Number.isFinite(Number(po?.poAmount)) ? po.poAmount : null)
          || Number(Number.isFinite(Number(saved?.poAmount)) ? saved.poAmount : null)
          || 0
        ),
        poReceivedDate: po?.poReceivedDate || saved?.poReceivedDate || null,
        poFileUrl: finalProof.url || '',
        poFileName: finalProof.name || '',
        services: Array.isArray(po?.services) && po.services.length ? po.services : (saved.services || [])
      };
    }) : previousPoRows;
    return {
      ...row,
      poStatus: row.poStatus || previous.poStatus,
      poYearRows: mergedPoRows,
      poApprovalStatus: row.poApprovalStatus || previous.poApprovalStatus,
      closureApprovalProofUrl: row.closureApprovalProofUrl || previous.closureApprovalProofUrl,
      closureApprovalProofName: row.closureApprovalProofName || previous.closureApprovalProofName,
      quotationSent: row.quotationSent || previous.quotationSent,
      earlierQuotationProofUrl: row.earlierQuotationProofUrl || previous.earlierQuotationProofUrl,
      earlierQuotationProofName: row.earlierQuotationProofName || previous.earlierQuotationProofName,
      closureRequestedBy: row.closureRequestedBy || previous.closureRequestedBy,
      closureRequestedByText: row.closureRequestedByText || previous.closureRequestedByText,
      closureFinalizedByManager: Boolean(row.closureFinalizedByManager || previous.closureFinalizedByManager),
      provisionalCloseExpiresAt: row.provisionalCloseExpiresAt || previous.provisionalCloseExpiresAt,
      provisionalCloseDeadlineBusinessDays: row.provisionalCloseDeadlineBusinessDays || previous.provisionalCloseDeadlineBusinessDays,
      originalPoConfirmed: Boolean(row.originalPoConfirmed || previous.originalPoConfirmed),
      permanentClosedAt: row.permanentClosedAt || previous.permanentClosedAt,
      permanentClosedBy: row.permanentClosedBy || previous.permanentClosedBy,
      permanentClosedByText: row.permanentClosedByText || previous.permanentClosedByText,
      originalPoDetails: previous.originalPoDetails || null,
      originalPoFileUrl: previous.originalPoFileUrl || '',
      originalPoFileName: previous.originalPoFileName || '',
      originalPoFileType: previous.originalPoFileType || '',
      originalPoFileSize: previous.originalPoFileSize || 0,
      originalPoPublicId: previous.originalPoPublicId || '',
      originalPoUploadedAt: previous.originalPoUploadedAt || ''
    };
  });
  return nextData;
}

function buildPurchaseOrderEmail({ eyebrow, title, message, clientName, leadCode, rows = [], remarks = '', status = 'PENDING', actionUrl = '' }) {
  const tone = status === 'APPROVED' ? '#059669' : status === 'REJECTED' ? '#dc2626' : status === 'REVISION_REQUIRED' ? '#ea580c' : '#2563eb';
  const safeRows = rows.length ? rows : [{}];
  const rowHtml = safeRows.map((po) => `<tr>
    <td style="padding:12px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#0f172a">${escapeHtml(po.poNumber || '-')}</td>
    <td style="padding:12px;border-bottom:1px solid #e2e8f0;color:#475569">${escapeHtml(po.fy || '-')}</td>
    <td style="padding:12px;border-bottom:1px solid #e2e8f0;color:#475569">${escapeHtml(po.poDate || '-')}</td>
    <td style="padding:12px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#0f172a">INR ${Number(po.poAmount || 0).toLocaleString('en-IN')}</td>
    <td style="padding:12px;border-bottom:1px solid #e2e8f0;color:#475569">${escapeHtml(po.quotationNumber || '-')}</td>
    <td style="padding:12px;border-bottom:1px solid #e2e8f0">${po.poFileUrl ? `<a href="${escapeHtml(po.poFileUrl)}" style="color:#2563eb;font-weight:700;text-decoration:none">View proof</a>` : '<span style="color:#94a3b8">Not attached</span>'}</td>
  </tr>`).join('');
  return `<div style="margin:0;padding:28px 12px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#334155">
    <div style="max-width:720px;margin:0 auto;overflow:hidden;border:1px solid #dbe4ef;border-radius:18px;background:#ffffff;box-shadow:0 12px 34px rgba(15,23,42,.08)">
      <div style="height:5px;background:${tone}"></div>
      <div style="padding:28px 30px 20px;background:linear-gradient(135deg,#ffffff,#f8fafc)">
        <div style="font-size:11px;font-weight:800;letter-spacing:1.6px;color:${tone};text-transform:uppercase">${escapeHtml(eyebrow)}</div>
        <h1 style="margin:8px 0 10px;color:#0f172a;font-size:25px;line-height:1.25">${escapeHtml(title)}</h1>
        <p style="margin:0;color:#475569;font-size:15px;line-height:1.7">${message}</p>
      </div>
      <div style="padding:0 30px 24px">
        <div style="display:flex;margin-bottom:18px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;padding:15px">
          <div><div style="font-size:10px;font-weight:800;letter-spacing:1px;color:#94a3b8;text-transform:uppercase">Company / Lead</div><div style="margin-top:5px;color:#0f172a;font-size:16px;font-weight:800">${escapeHtml(clientName || '-')}</div><div style="margin-top:3px;color:#64748b;font-size:12px">${escapeHtml(leadCode || '')}</div></div>
        </div>
        <div style="overflow:hidden;border:1px solid #e2e8f0;border-radius:12px"><table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f8fafc;color:#64748b;text-align:left"><th style="padding:11px 12px">PO Number</th><th style="padding:11px 12px">FY</th><th style="padding:11px 12px">PO Date</th><th style="padding:11px 12px">PO Amount</th><th style="padding:11px 12px">Quotation</th><th style="padding:11px 12px">Proof</th></tr></thead><tbody>${rowHtml}</tbody></table></div>
        ${remarks ? `<div style="margin-top:18px;border-left:4px solid ${tone};border-radius:8px;background:#f8fafc;padding:14px 16px"><div style="font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase">Decision remarks</div><div style="margin-top:6px;color:#1e293b;font-size:14px;line-height:1.6">${escapeHtml(remarks)}</div></div>` : ''}
        ${actionUrl ? `<div style="margin-top:22px;text-align:center"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;border-radius:9px;background:${tone};padding:12px 20px;color:#fff;font-size:14px;font-weight:800;text-decoration:none">Open Pending Approval</a></div>` : ''}
      </div>
      <div style="border-top:1px solid #e2e8f0;background:#f8fafc;padding:15px 30px;color:#94a3b8;font-size:11px;text-align:center">AnantTattva CRM · Automated workflow notification</div>
    </div>
  </div>`;
}

function canDirectlyApprovePoEdit(actor, modifyPoDetails, before = {}) {
  return modifyPoDetails === true && userHasAnyRole(actor, ADMIN_ROLES)
    && before.poStatus === 'received'
    && (before.poYearRows || []).some(po => String(po.poNumber || '').trim() && po.poDate && Number(po.poAmount) > 0 && resolvePoProof(po).url);
}

async function upsertPurchaseOrderApprovals({ beforeLead = {}, lead, actor, submittedAssignments = [], poDebugId = '', modifyPoDetails = false }) {
  const beforeRows = Array.isArray(beforeLead.assignments) ? beforeLead.assignments : [];
  const rows = Array.isArray(lead.assignments) ? lead.assignments : [];
  await Promise.all(rows.map(async (row, index) => {
    if (row.poStatus !== 'received' || (!row.closedBy && !row.closureRequestedBy)) return;
    const before = findExistingAssignment(beforeRows, row, index) || {};
    const changed = JSON.stringify(before.poYearRows || []) !== JSON.stringify(row.poYearRows || []);
    if (!changed && row.poApprovalStatus) return;
    row.poApprovalStatus = 'PENDING';
    const service = (lead.serviceSelections || [])[index] || {};
    const sourceClientId = `${lead._id}:po:${row.assignedServiceId || index}`;
    // Build the approval snapshot from the validated request rows. Using the
    // hydrated Mongoose array here could retain the numeric PO fields while
    // losing newly uploaded proof metadata before the approval was persisted.
    const submittedRow = Array.isArray(submittedAssignments) ? submittedAssignments[index] : null;
    const snapshotSource = Array.isArray(submittedRow?.poYearRows) && submittedRow.poYearRows.length
      ? submittedRow.poYearRows
      : (Array.isArray(row.poYearRows) ? row.poYearRows : []);
    const poRowsSnapshot = snapshotSource.map((po) => {
      const proof = resolvePoProof(po);
      return { ...po, poFileUrl: proof.url, poFileName: proof.name || String(po?.poFileName || '').trim() };
    });
    const missingProofRows = poRowsSnapshot.filter((po) => !po.poFileUrl).map((po) => po.poNumber || '(no PO number)');
    if (missingProofRows.length) console.error('[purchase-order-approval] validated PO proof missing from snapshot', { leadCode: lead.leadCode, assignmentIndex: index, poNumbers: missingProofRows });
    const poProofManifest = poRowsSnapshot.map((po, rowIndex) => ({ rowIndex, poNumber: String(po.poNumber || '').trim(), poFileUrl: String(po.poFileUrl || '').trim(), poFileName: String(po.poFileName || '').trim(), poFileMimeType: String(po.poFileMimeType || '').trim(), poFileSize: po.poFileSize ?? null }));
    console.info('[POProof:approval:snapshot]', { poDebugId, leadCode: lead.leadCode || '', assignmentIndex: index, sourceClientId, rows: poRowsSnapshot.map((po, rowIndex) => ({ rowIndex, poNumber: po.poNumber || '', poAmount: po.poAmount ?? null, hasPoFileUrl: Boolean(po.poFileUrl), poFileName: po.poFileName || '' })) });
    if (canDirectlyApprovePoEdit(actor, modifyPoDetails, before)) {
      row.poApprovalStatus = 'APPROVED';
      row.poEditedBy = String(actor?._id || actor?.id || '');
      row.poEditedByText = actor?.name || actor?.email || '';
      row.poEditedAt = new Date();
      if (before.closedBy) {
        row.closedBy = before.closedBy;
        row.closedByText = before.closedByText || '';
        row.closedByEmail = before.closedByEmail || '';
        row.closedAt = before.closedAt;
      } else if (row.assignedTo && row.closureRequestedBy) {
        row.closedBy = row.closureRequestedBy;
        row.closedByText = row.closureRequestedByText || '';
        row.closedAt = new Date();
        row.closureFinalizedByManager = true;
      }
      // Update an existing review snapshot, without creating another request
      // or sending approval notifications for an administrator's correction.
      await PendingApproval.updateOne(
        { type: 'purchase_order', source: 'crm', sourceClientId },
        { $set: { approvalStatus: 'APPROVED', actionBy: actor?._id, actionAt: new Date(),
          remarks: 'PO details updated directly by Admin.',
          'payload.poYearRows': poRowsSnapshot, 'payload.poProofManifest': poProofManifest,
          'payload.quotationSent': row.quotationSent || '',
          'payload.earlierQuotationProofUrl': row.earlierQuotationProofUrl || '',
          'payload.earlierQuotationProofName': row.earlierQuotationProofName || '',
          'payload.decidedBy': actor?.name || actor?.email || '' } }
      );
      return;
    }
    const savedApproval = await PendingApproval.findOneAndUpdate(
      { type: 'purchase_order', source: 'crm', sourceClientId },
      { $setOnInsert: { type: 'purchase_order', source: 'crm', sourceClientId }, $set: {
        uniqueId: lead.leadCode || String(lead._id), clientName: lead.company || 'Lead', approvalStatus: 'PENDING',
        piboCategory: service.subApplicantType || service.piboCategory || service.applicantType || '',
        eprCategory: service.eprCategory || '', createdByName: actor?.name || actor?.email || '',
        requestDate: new Date().toLocaleDateString('en-GB'), requestTime: new Date().toLocaleTimeString('en-US'),
        payload: { leadId: String(lead._id), leadCode: lead.leadCode || '', assignmentIndex: index, assignedServiceId: row.assignedServiceId || '', service, poYearRows: poRowsSnapshot, poProofManifest, quotationSent: row.quotationSent || '', earlierQuotationProofUrl: row.earlierQuotationProofUrl || '', earlierQuotationProofName: row.earlierQuotationProofName || '', closureRequestedBy: row.closureRequestedBy || '', closureRequestedByText: row.closureRequestedByText || '', poSubmittedById: String(actor?._id || actor?.id || ''), poSubmittedByEmail: actor?.email || '', poSubmittedByName: actor?.name || actor?.email || '', leadCreatorId: String(lead.createdBy?._id || lead.createdBy || ''), leadCreatorEmail: lead.createdBy?.email || lead.createdByEmail || '', quotationCreatorIds: [...new Set(poRowsSnapshot.map((po) => po.quotationCreatedById).filter(Boolean))], quotationCreatorEmails: [...new Set(poRowsSnapshot.map((po) => po.quotationCreatedByEmail).filter(Boolean))] },
        actionBy: null, actionAt: null, remarks: ''
      } }, { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.info('[POProof:approval:persisted]', { poDebugId, approvalId: String(savedApproval?._id || ''), leadCode: lead.leadCode || '', assignmentIndex: index, collection: PendingApproval.collection.collectionName, rowCount: poRowsSnapshot.length, proofCount: poProofManifest.filter((po) => po.poFileUrl).length });
    try {
      const notificationUsers = await User.find({ $or: [
        { role: { $in: ADMIN_ROLES }, isActive: { $ne: false } },
        ...(actor?._id && mongoose.isValidObjectId(actor._id) ? [{ _id: actor._id }] : [])
      ] }).select('name email role').lean();
      const recipients = [...new Set([
        ...notificationUsers.map((user) => user.email), actor?.email
      ].map((email) => String(email || '').trim().toLowerCase()).filter(Boolean))];
      const poRows = Array.isArray(row.poYearRows) ? row.poYearRows : [];
      const emailHtml = buildPurchaseOrderEmail({
        eyebrow: 'New purchase order approval',
        title: 'Purchase Order submitted for review',
        message: `<strong>${escapeHtml(actor?.name || actor?.email || 'CRM User')}</strong> submitted PO details. Please review the values and record your decision.`,
        clientName: lead.company || lead.leadCode,
        leadCode: lead.leadCode,
        rows: poRows,
        status: 'PENDING',
        actionUrl: `${String(process.env.FRONTEND_URL || 'https://crmananttattva.vercel.app').replace(/\/$/, '')}/pending-approval`
      });
      // Approval persistence is the critical path. Mail providers can take up
      // to their network timeout per request, so do not hold the closure HTTP
      // response open (and risk a proxy 502) while notifications are delivered.
      void Promise.allSettled(recipients.map((email) => sendMail(email, `New PO Approval - ${lead.company || lead.leadCode}`, emailHtml, { branded: false })))
        .then((results) => {
          const failed = results.filter((result) => result.status === 'rejected');
          if (failed.length) console.error('Unable to send some new PO approval notifications', { failed: failed.length, recipients: recipients.length });
        });
    } catch (error) {
      console.error('Unable to send new PO approval notifications', error.message);
    }
    return savedApproval;
  }));
  lead.markModified('assignments');
}

function leadCodeSequence(value) {
  const match = String(value || '').trim().match(/^ATPL(?:-LEAD)?-(\d+)$/i);
  return match ? Number.parseInt(match[1], 10) || 0 : 0;
}

async function getNextLeadCode() {
  // The old records used ATPL-0001 while new records use ATPL-LEAD-0001.
  // Calculate the next sequence from both formats, rather than relying on a
  // lexical sort where ATPL-LEAD-* and ATPL-* do not sort together.
  const rows = await Lead.find({ leadCode: { $exists: true, $ne: '' } })
    .select('leadCode')
    .lean();
  const latestNumber = rows.reduce((maximum, row) => Math.max(maximum, leadCodeSequence(row.leadCode)), 0);
  return `${LEAD_CODE_PREFIX}${String(latestNumber + 1).padStart(4, '0')}`;
}

async function createLeadRecord(rawBody, user) {
  const data = setProvisionalClosureDeadlines(cleanBody(rawBody));
  const commercialError = (data.assignments || []).flatMap((row) => row.poYearRows || []).map(validatePoCommercialDetails).find(Boolean);
  if (commercialError) { const error = new Error(commercialError); error.statusCode = 400; throw error; }
  const duplicateServiceError = validateDuplicateServiceSelections(data);
  if (duplicateServiceError) {
    const validationError = new Error(duplicateServiceError);
    validationError.statusCode = 409;
    throw validationError;
  }
  const closureError = validateClosureAssignments(data);
  if (closureError) { const validationError = new Error(closureError); validationError.statusCode = 400; throw validationError; }
  data.companyIdentity = normalizeCompanyIdentity(data.company);
  data.workflowStatus = data.workflowStatus === 'submitted' ? 'submitted' : 'draft';
  if (data.workflowStatus === 'submitted') {
    data.formStartedAt = data.formStartedAt || new Date();
    data.submittedAt = data.submittedAt || new Date();
    data.fillDurationSeconds = Math.max(0, Math.min(86400, Math.round((new Date(data.submittedAt).getTime() - new Date(data.formStartedAt).getTime()) / 1000)));
  }

  if (shouldValidatePiboSelection(data)) {
    const selection = await validatePiboSelection({ parent: data.piboParent, child: data.subApplicantType, required: true });
    data.piboParent = selection.piboParent;
    data.subApplicantType = selection.piboCategory;
  }

  if (data.workflowStatus === 'submitted') {
    const error = validateSubmittedLead(data);
    if (error) {
      const validationError = new Error(error);
      validationError.statusCode = 400;
      throw validationError;
    }
  }

  // Audit attribution must always identify the authenticated user who actually
  // created the record. `generatedFor*` separately identifies its business owner.
  const createdByName = String(user?.name || user?.email || '').trim();
  const createdByEmail = String(user?.email || '').trim().toLowerCase();
  const createdByCrmUserId = String(user?._id || '').trim();

  data.serviceSelections = (Array.isArray(data.serviceSelections) ? data.serviceSelections : []).map((row) => ({
    ...row,
    createdByCrmUserId,
    createdByName,
    createdByEmail
  }));

  return Lead.create({
    ...data,
    leadCode: await getNextLeadCode(),
    createdBy: user?._id,
    createdByName,
    createdByEmail,
    createdByCrmUserId
  });
}

function royaltyIdentityTokens(...values) {
  const identity = (value) => String(value || '').trim().toLowerCase().replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, ' ');
  return [...new Set(values.flatMap((value) => value && typeof value === 'object'
    ? [value._id, value.id, value.crmUserId, value.userId, value.email, value.name]
    : [value]).filter(Boolean).map(identity).filter(Boolean))];
}

function royaltyContributorEligibility(lead = {}, claimant = {}) {
  const originalIds = royaltyIdentityTokens(lead.createdBy, lead.createdByCrmUserId, lead.createdByEmail, lead.createdByName, lead.importedCreatedBy);
  const claimantIds = royaltyIdentityTokens(claimant._id, claimant.id, claimant.crmUserId, claimant.userId, claimant.email, claimant.name);
  if (originalIds.some((value) => claimantIds.includes(value))) {
    return { eligible: false, reason: 'same-user' };
  }

  const assignments = Array.isArray(lead.assignments) ? lead.assignments : [];
  const contributorGroups = (Array.isArray(lead.serviceSelections) ? lead.serviceSelections : [])
    .map((row, index) => {
      const assignment = assignments[index] || {};
      return royaltyIdentityTokens(
        row?.createdByCrmUserId, row?.createdByEmail, row?.createdByName,
        assignment?.closedBy, assignment?.closedByEmail, assignment?.closedByText
      );
    })
    .filter((tokens) => tokens.length);

  if (originalIds.length && !contributorGroups.some((tokens) => tokens.some((token) => originalIds.includes(token)))) {
    contributorGroups.unshift(originalIds);
  }

  const distinctContributors = [];
  contributorGroups.forEach((tokens) => {
    if (!distinctContributors.some((known) => known.some((token) => tokens.includes(token)))) distinctContributors.push(tokens);
  });
  const claimantContributed = distinctContributors.some((tokens) => tokens.some((token) => claimantIds.includes(token)));

  return {
    eligible: distinctContributors.length >= 2 && claimantContributed,
    reason: distinctContributors.length < 2 ? 'insufficient-contributors' : claimantContributed ? '' : 'claimant-not-contributor'
  };
}

async function findDuplicateCompanyRecord(company, excludeId = '') {
  const identity = normalizeCompanyIdentity(company);
  if (!identity) return null;
  const escaped = identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rows = await Lead.find({ $or: [
    { companyIdentity: identity },
    { company: { $regex: `^\\s*${escaped}`, $options: 'i' } }
  ] }).select('_id company leadCode importedCreatedBy createdBy').populate('createdBy', 'name email').lean();
  return rows.find((lead) => String(lead._id) !== String(excludeId || '') && normalizeCompanyIdentity(lead.company) === identity) || null;
}

function buildAppendOnlyServicePatch(beforeLead = {}, incoming = {}, actor = {}) {
  const legacyService = {
    assignedServiceId: beforeLead.assignedServiceId || beforeLead.serviceAssignmentId || `legacy_service_${beforeLead._id || beforeLead.leadCode || 'lead'}`,
    industryType: beforeLead.industryType || '', eprCategory: beforeLead.eprCategory || '', businessCategory: beforeLead.businessCategory || '',
    applicantType: beforeLead.applicantType || beforeLead.piboParent || '', piboCategory: beforeLead.subApplicantType || beforeLead.piboCategory || '',
    servicesOffered: beforeLead.servicesOffered || '', applicableService: beforeLead.applicableService || '', plantUnit: beforeLead.plantUnit || '',
    firstAnnualReturnYearApplicable: beforeLead.firstAnnualReturnYearApplicable || '', createdByCrmUserId: beforeLead.createdByCrmUserId || '',
    createdByName: beforeLead.createdByName || beforeLead.importedCreatedBy || '', createdByEmail: beforeLead.createdByEmail || ''
  };
  const existingServices = Array.isArray(beforeLead.serviceSelections) && beforeLead.serviceSelections.length
    ? beforeLead.serviceSelections
    : [legacyService];
  const incomingServices = Array.isArray(incoming.serviceSelections) ? incoming.serviceSelections : [];
  if (incomingServices.length <= existingServices.length) {
    const error = new Error('Add Services mode requires at least one new service row.');
    error.statusCode = 400;
    throw error;
  }

  const actorId = String(actor?._id || actor?.id || '').trim();
  const actorName = String(actor?.name || actor?.email || '').trim();
  const actorEmail = String(actor?.email || '').trim().toLowerCase();
  const addedServices = incomingServices.slice(existingServices.length).map((row = {}) => ({
    ...row,
    assignedServiceId: row.assignedServiceId || row.serviceAssignmentId || `service_assignment_${randomUUID()}`,
    createdByCrmUserId: actorId,
    createdByName: actorName,
    createdByEmail: actorEmail
  }));
  const patch = { serviceSelections: [...existingServices, ...addedServices] };

  const legacyRows = {
    addresses: [{ assignedServiceId: legacyService.assignedServiceId, plantUnit: beforeLead.plantUnit || '', addressLine1: beforeLead.addressLine1 || '', addressLine2: beforeLead.addressLine2 || '', addressLine3: beforeLead.addressLine3 || '', landmark: beforeLead.landmark || '', state: beforeLead.state || '', city: beforeLead.city || '', pinCode: beforeLead.pinCode || '', existingClient: beforeLead.existingClient || 'No', website: beforeLead.website || '' }],
    contacts: [{ assignedServiceId: legacyService.assignedServiceId, plantUnit: beforeLead.plantUnit || '', salutation: beforeLead.salutation || '', contactPerson: beforeLead.contactPerson || '', designation: beforeLead.designation || '', emails: beforeLead.emails || '', mobileNo1: beforeLead.mobileNo1 || '', mobileNo2: beforeLead.mobileNo2 || '', whatsappNo: beforeLead.whatsappNo || '', linkedinUrl: beforeLead.linkedinUrl || '', referredBy: beforeLead.referredBy || '', source: beforeLead.source || '', businessCardUrl: beforeLead.businessCardUrl || '' }],
    assignments: [{ assignedServiceId: legacyService.assignedServiceId, assignedTo: beforeLead.assignedTo || '', assignedToText: beforeLead.assignedToText || '', assignedToEmail: beforeLead.assignedToEmail || '', assignedStaff: beforeLead.assignedStaff || '', assignedStaffText: beforeLead.assignedStaffText || '', assignedStaffEmail: beforeLead.assignedStaffEmail || '' }]
  };
  ['addresses', 'contacts', 'assignments'].forEach((field) => {
    const existingRows = Array.isArray(beforeLead[field]) && beforeLead[field].length ? beforeLead[field] : legacyRows[field];
    const incomingRows = Array.isArray(incoming[field]) ? incoming[field] : [];
    patch[field] = [...existingRows, ...incomingRows.slice(existingRows.length)];
  });
  return patch;
}

function bulkServiceRow(source = {}, user = {}) {
  return {
    industryType: String(source.industryType || '').trim(),
    eprCategory: String(source.eprCategory || '').trim(),
    businessCategory: String(source.businessCategory || '').trim().replace(/\s+/g, ' ').slice(0, 100),
    applicantType: String(source.applicantType || source.piboParent || '').trim(),
    subApplicantType: String(source.subApplicantType || source.piboCategory || '').trim(),
    servicesOffered: String(source.servicesOffered || '').trim(),
    applicableService: String(source.applicableService || '').trim(),
    firstAnnualReturnYearApplicable: String(source.firstAnnualReturnYearApplicable || '').trim(),
    createdByCrmUserId: String(source.createdByCrmUserId || user?._id || user?.id || '').trim(),
    createdByName: String(source.createdByName || source.importedCreatedBy || user?.name || user?.email || '').trim(),
    createdByEmail: String(source.createdByEmail || user?.email || '').trim().toLowerCase()
  };
}

function validateServiceRemovalPermission(beforeLead = {}, incomingRows = [], user = {}) {
  const beforeRows = Array.isArray(beforeLead.serviceSelections) ? beforeLead.serviceSelections : [];
  if (!beforeRows.length || !Array.isArray(incomingRows)) return '';
  if (ADMIN_ROLES.includes(String(user.role || '').trim().toLowerCase())) return '';
  const identity = (row = {}) => [row.industryType, row.eprCategory, row.applicantType, row.subApplicantType || row.piboCategory, row.servicesOffered, row.firstAnnualReturnYearApplicable]
    .map((value) => String(value || '').trim().toLowerCase()).join('|');
  const incomingCounts = new Map();
  incomingRows.forEach((row) => incomingCounts.set(identity(row), (incomingCounts.get(identity(row)) || 0) + 1));
  const removedRows = beforeRows.filter((row) => {
    const key = identity(row);
    const remaining = incomingCounts.get(key) || 0;
    if (!remaining) return true;
    incomingCounts.set(key, remaining - 1);
    return false;
  });
  const userTokens = royaltyIdentityTokens(user._id, user.id, user.crmUserId, user.userId, user.email, user.name);
  const leadOwnerTokens = royaltyIdentityTokens(
    beforeLead.secondaryCreatedBy,
    beforeLead.createdBy, beforeLead.createdByCrmUserId, beforeLead.createdByEmail, beforeLead.createdByName, beforeLead.importedCreatedBy,
    beforeLead.generatedForUser, beforeLead.generatedForName, beforeLead.generatedForEmail,
    beforeLead.createdOnBehalfOfUser, beforeLead.createdOnBehalfOfName, beforeLead.createdOnBehalfOfEmail
  );
  const assignmentTokens = royaltyIdentityTokens(
    beforeLead.assignedTo, beforeLead.assignedToText, beforeLead.assignedToEmail,
    beforeLead.assignedStaff, beforeLead.assignedStaffText, beforeLead.assignedStaffEmail,
    beforeLead.closedBy, beforeLead.closedByText, beforeLead.closedByEmail,
    ...(Array.isArray(beforeLead.assignments) ? beforeLead.assignments.flatMap((row) => [
      row?.assignedTo, row?.assignedToText, row?.assignedToEmail,
      row?.assignedStaff, row?.assignedStaffText, row?.assignedStaffEmail,
      row?.closedBy, row?.closedByText, row?.closedByEmail
    ]) : [])
  );
  // A legitimate lead owner/assignee must be able to remove an obsolete
  // service and submit the remaining service rows with PO details.
  const canEditLeadServices = [...leadOwnerTokens, ...assignmentTokens]
    .some((token) => userTokens.includes(token));
  if (canEditLeadServices) return '';
  const forbidden = removedRows.find((row) => {
    const ownerTokens = royaltyIdentityTokens(row.createdByCrmUserId, row.createdByEmail, row.createdByName);
    const effectiveOwners = ownerTokens.length ? ownerTokens : leadOwnerTokens;
    return !effectiveOwners.some((token) => userTokens.includes(token));
  });
  return forbidden ? 'You can remove only services that you created.' : '';
}

function changedFollowUpIndexes(beforeLead = {}, data = {}) {
  if (!Array.isArray(data.serviceSelections)) return [];
  const beforeRows = Array.isArray(beforeLead.serviceSelections) ? beforeLead.serviceSelections : [];
  return data.serviceSelections.map((row, index) => {
    const before = beforeRows[index] || {};
    const currentKey = [row?.nextFollowUpDate, row?.nextFollowUpTime, row?.followUpRemarks].map((value) => String(value || '').trim()).join('|');
    const beforeKey = [before?.nextFollowUpDate, before?.nextFollowUpTime, before?.followUpRemarks].map((value) => String(value || '').trim()).join('|');
    const closeChanged = String(row?.followUpClosedAt || '').trim() !== String(before?.followUpClosedAt || '').trim();
    return (currentKey !== beforeKey && (currentKey || beforeKey)) || closeChanged ? index : -1;
  }).filter((index) => index >= 0);
}

function normalizeBulkUserIdentity(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildBulkUserIndex(users = []) {
  const index = new Map();
  users.forEach((user = {}) => {
    const name = String(user.name || '').trim().replace(/\s+/g, ' ');
    const email = String(user.email || '').trim().toLowerCase();
    const tokens = [user._id, user.id, user.crmUserId, name, email, name && email ? `${name} (${email})` : '']
      .map(normalizeBulkUserIdentity).filter(Boolean);
    tokens.forEach((token) => {
      if (!index.has(token)) index.set(token, user);
      else if (String(index.get(token)?._id || '') !== String(user._id || '')) index.set(token, null);
    });
  });
  return index;
}

function resolveBulkCreator(userIndex, value) {
  return userIndex.get(normalizeBulkUserIdentity(value)) || null;
}

function hasBulkService(row = {}) {
  return ['industryType', 'eprCategory', 'applicantType', 'subApplicantType', 'servicesOffered', 'applicableService', 'firstAnnualReturnYearApplicable']
    .some((key) => String(row[key] || '').trim());
}

function bulkServiceIdentity(row = {}) {
  return ['industryType', 'eprCategory', 'applicantType', 'subApplicantType', 'servicesOffered', 'applicableService', 'firstAnnualReturnYearApplicable']
    .map((key) => String(row[key] || '').trim().toLowerCase()).join('|');
}

function normalizeLegacyBulkServices(lead = {}) {
  const saved = (Array.isArray(lead.serviceSelections) ? lead.serviceSelections : []).map((row) => bulkServiceRow(row));
  const topLevel = bulkServiceRow(lead);
  if (hasBulkService(topLevel) && !saved.some((row) => bulkServiceIdentity(row) === bulkServiceIdentity(topLevel))) saved.unshift(topLevel);
  return saved;
}

function bulkAssignmentRow(source = {}) {
  return {
    assignedTo: String(source.assignedTo?._id || source.assignedTo || '').trim(),
    assignedToText: String(source.assignedToText || '').trim(),
    assignedToEmail: String(source.assignedToEmail || '').trim().toLowerCase(),
    assignedStaff: String(source.assignedStaff?._id || source.assignedStaff || '').trim(),
    assignedStaffText: String(source.assignedStaffText || '').trim(),
    assignedStaffEmail: String(source.assignedStaffEmail || '').trim().toLowerCase(),
    closedBy: String(source.closedBy?._id || source.closedBy || '').trim(),
    closedByText: String(source.closedByText || '').trim(),
    closedByEmail: String(source.closedByEmail || '').trim().toLowerCase(),
    assignedBy: String(source.assignedBy || '').trim()
  };
}

function alignBulkAssignments(lead = {}, serviceCount = 0) {
  const existing = (Array.isArray(lead.assignments) ? lead.assignments : []).map(bulkAssignmentRow);
  const topLevel = bulkAssignmentRow(lead);
  if (existing.length < serviceCount && Object.values(topLevel).some(Boolean)) existing.unshift(topLevel);
  while (existing.length < serviceCount) existing.push({ ...topLevel });
  return existing.slice(0, serviceCount);
}

function bulkAddressRow(source = {}) {
  return {
    addressLine1: String(source.addressLine1 || '').trim(), addressLine2: String(source.addressLine2 || '').trim(),
    addressLine3: String(source.addressLine3 || '').trim(), landmark: String(source.landmark || '').trim(),
    state: String(source.state || '').trim(), city: String(source.city || '').trim(), pinCode: String(source.pinCode || '').trim(),
    existingClient: source.existingClient === 'Yes' ? 'Yes' : 'No', website: String(source.website || '').trim()
  };
}

function bulkContactRow(source = {}) {
  return {
    salutation: String(source.salutation || '').trim(), contactPerson: String(source.contactPerson || '').trim(),
    designation: String(source.designation || '').trim(), emails: String(source.emails || '').trim(),
    mobileNo1: String(source.mobileNo1 || '').replace(/\D/g, '').slice(0, 10), mobileNo2: String(source.mobileNo2 || '').replace(/\D/g, '').slice(0, 10),
    whatsappNo: String(source.whatsappNo || '').replace(/\D/g, '').slice(0, 10), linkedinUrl: String(source.linkedinUrl || '').trim(),
    referredBy: String(source.referredBy || '').trim(), source: String(source.source || '').trim(), businessCardUrl: String(source.businessCardUrl || '').trim()
  };
}

function buildBulkCreateData(data, user = {}) {
  const service = bulkServiceRow(data, user);
  const assignment = bulkAssignmentRow(data);
  return {
    ...data,
    serviceSelections: [service],
    assignments: [assignment],
    addresses: Array.isArray(data.addresses) && data.addresses.length ? data.addresses : [bulkAddressRow(data)],
    contacts: Array.isArray(data.contacts) && data.contacts.length ? data.contacts : [bulkContactRow(data)],
    workflowStatus: 'draft'
  };
}

function buildBulkMergeData(existing = {}, incoming = {}, user = {}) {
  const services = normalizeLegacyBulkServices(existing);
  const assignments = alignBulkAssignments(existing, services.length);
  const addedService = bulkServiceRow(incoming, user);
  services.push(addedService);
  assignments.push(bulkAssignmentRow(incoming));
  const primary = services[0] || {};
  const fill = (key) => existing[key] || incoming[key];
  return {
    serviceSelections: services,
    assignments: assignments,
    industryType: primary.industryType || existing.industryType || '', eprCategory: primary.eprCategory || existing.eprCategory || '',
    applicantType: primary.applicantType || existing.applicantType || '', subApplicantType: primary.subApplicantType || existing.subApplicantType || existing.piboCategory || '',
    servicesOffered: primary.servicesOffered || existing.servicesOffered || '', firstAnnualReturnYearApplicable: primary.firstAnnualReturnYearApplicable || existing.firstAnnualReturnYearApplicable || '',
    addresses: Array.isArray(existing.addresses) && existing.addresses.length ? existing.addresses : [bulkAddressRow(incoming)],
    contacts: Array.isArray(existing.contacts) && existing.contacts.length ? existing.contacts : [bulkContactRow(incoming)],
    communicationMode: fill('communicationMode'), status: fill('status'), addressLine1: fill('addressLine1'), addressLine2: fill('addressLine2'),
    addressLine3: fill('addressLine3'), landmark: fill('landmark'), state: fill('state'), city: fill('city'), pinCode: fill('pinCode'),
    existingClient: fill('existingClient'), website: fill('website'), salutation: fill('salutation'), contactPerson: fill('contactPerson'),
    designation: fill('designation'), emails: fill('emails'), mobileNo1: fill('mobileNo1'), mobileNo2: fill('mobileNo2'), whatsappNo: fill('whatsappNo'), linkedinUrl: fill('linkedinUrl'),
    businessCardUrl: fill('businessCardUrl'), referredBy: fill('referredBy'), source: fill('source'), notes: fill('notes'),
    workflowStatus: 'draft', bulkImported: true
  };
}

exports.searchCompanies = async (req, res) => {
  const query = String(req.query.q || req.query.company || '').trim();
  const identity = normalizeCompanyIdentity(query);

  if (identity.length < 2) {
    return res.json({ ok: true, leads: [] });
  }

  const escaped = identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const searchFilter = { $or: [
    { companyIdentity: { $regex: escaped, $options: 'i' } },
    { company: { $regex: escaped, $options: 'i' } }
  ] };
  // Company discovery is global for authenticated CRM users. Otherwise a lead
  // owned by another user is incorrectly shown as a brand-new company and the
  // intended cross-user Add Services workflow can never be opened.
  const leads = await Lead.find(searchFilter)
    .populate('assignedTo', 'name email avatarUrl role')
    .populate('closedBy', 'name email avatarUrl role')
    .populate('createdBy', 'name email')
    .populate('generatedForUser', 'name email')
    .sort({ company: 1, createdAt: -1 })
    .limit(10)
    .lean();

  res.json({ ok: true, leads: leads.filter((lead) => normalizeCompanyIdentity(lead.company).includes(identity)) });
};

exports.listLeads = async (req, res) => {
  const startedAt = process.hrtime.bigint();
  const accessStartedAt = process.hrtime.bigint();
  const accessFilter = await leadAccessFilter(req.user);
  const accessMs = Number(process.hrtime.bigint() - accessStartedAt) / 1e6;
  const paginated = req.query.page !== undefined || req.query.limit !== undefined || req.query.paginated === 'true';

  // Preserve the historical response for non-directory consumers. The Lead
  // Generation screen opts into the bounded list below with paginated=true.
  if (!paginated) {
    const queryStartedAt = process.hrtime.bigint();
    const leads = await Lead.find(accessFilter)
    .select(req.query.view === 'review'
      ? 'leadCode sourceLeadId company createdAt updatedAt importedCreatedAt leadDate importedCreatedBy createdBy createdByCrmUserId createdByEmail createdByName applicantType subApplicantType piboCategory industryType eprCategory servicesOffered firstAnnualReturnYearApplicable assignedStaff assignedStaffText assignedStaffEmail assignedTo assignedToText assignedToEmail closedAt closedBy closedByText serviceSelections.applicantType serviceSelections.subApplicantType serviceSelections.piboCategory serviceSelections.eprCategory serviceSelections.servicesOffered serviceSelections.firstAnnualReturnYearApplicable serviceSelections.createdAt serviceSelections.createdByName serviceSelections.createdByEmail serviceSelections.closedAt serviceSelections.closedBy serviceSelections.closedByText assignments.closedAt assignments.closedBy assignments.closedByText'
      : '')
    .populate('assignedTo', 'name email avatarUrl role')
    .populate('closedBy', 'name email avatarUrl role')
    .populate('createdBy', 'name email')
    .populate('generatedForUser', 'name email crmUserId')
      .sort({ leadCode: 1, createdAt: 1 })
      .lean();
    const queryMs = Number(process.hrtime.bigint() - queryStartedAt) / 1e6;
    res.set('Server-Timing', `access;dur=${accessMs.toFixed(1)}, query;dur=${queryMs.toFixed(1)}`);
    return res.json({ ok: true, leads });
  }

  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || '').trim();
  const serviceCategory = String(req.query.serviceCategory || '').trim();
  const staff = String(req.query.staff || '').trim();
  const allocationOwner = String(req.query.allocationOwner || '').trim();
  const metric = String(req.query.metric || '').trim();
  const workspace = String(req.query.workspace || '').trim().toLowerCase();
  const sortBy = ['leadCode', 'createdAt', 'updatedAt', 'company', 'status'].includes(String(req.query.sortBy))
    ? String(req.query.sortBy)
    : 'leadCode';
  const sortOrder = String(req.query.sortOrder).toLowerCase() === 'desc' ? -1 : 1;
  const filters = [accessFilter];
  if (req.query.dashboard === 'true') {
    const testLeadReferences = await getAdminCreatedLeadReferences();
    filters.push(dashboardLeadExclusionFilter(testLeadReferences));
  }
  if (search) {
    const expression = new RegExp(escapeRegex(search.slice(0, 100)), 'i');
    filters.push({ $or: [
      { leadCode: expression }, { company: expression }, { addressLine1: expression },
      { city: expression }, { pinCode: expression }, { piboCategory: expression },
      { eprCategory: expression }, { state: expression }, { contactPerson: expression },
      { mobileNo1: expression }, { emails: expression }, { status: expression }
    ] });
  }
  if (status) filters.push({ status });
  if (['converted', 'existing'].includes(metric)) filters.push({ $or: [{ existingClient: 'Yes' }, { status: 'Existing Client' }] });
  if (metric === 'new') filters.push({ existingClient: { $ne: 'Yes' }, status: { $ne: 'Existing Client' } });
  if (serviceCategory) filters.push({ $or: [{ eprCategory: serviceCategory }, { 'serviceSelections.eprCategory': serviceCategory }] });
  if (staff) {
    const staffValues = [staff];
    if (mongoose.Types.ObjectId.isValid(staff)) staffValues.push(new mongoose.Types.ObjectId(staff));
    const staffExpression = new RegExp(`^${escapeRegex(staff.replace(/^name:/, ''))}$`, 'i');
    filters.push({ $or: [
      { assignedTo: { $in: staffValues } }, { assignedStaff: { $in: staffValues } },
      { secondaryCreatedBy: { $in: staffValues } },
      { generatedForUser: { $in: staffValues } }, { 'assignments.assignedTo': { $in: staffValues } },
      { 'assignments.assignedStaff': { $in: staffValues } }, { assignedToText: staffExpression },
      { assignedStaffText: staffExpression }, { generatedForName: staffExpression },
      { 'assignments.assignedToText': staffExpression }, { 'assignments.assignedStaffText': staffExpression }
    ] });
  }
  if (allocationOwner) {
    if (allocationOwner === 'unassigned') {
      filters.push({
        $and: [
          { $or: [{ generatedForUser: null }, { generatedForUser: { $exists: false } }] },
          { $or: [{ createdBy: null }, { createdBy: { $exists: false } }] }
        ]
      });
    } else if (mongoose.Types.ObjectId.isValid(allocationOwner)) {
      const ownerIds = [allocationOwner, new mongoose.Types.ObjectId(allocationOwner)];
      filters.push({ $or: [{ generatedForUser: { $in: ownerIds } }, { createdBy: { $in: ownerIds } }] });
    }
  }
  const filter = combineAccessFilters(...filters);
  const projection = [
    'leadCode', 'sourceLeadId', 'company', 'status', 'workflowStatus', 'recordStatus',
    'eprCategory', 'piboCategory', 'existingClient', 'contactPerson', 'mobileNo1', 'emails',
    'addressLine1', 'state', 'city', 'pinCode', 'assignedTo', 'assignedToText', 'assignedToEmail', 'assignedStaff',
    'assignedStaffText', 'assignedStaffEmail', 'assignedBy', 'createdBy', 'createdByName',
    'createdByEmail', 'importedCreatedBy', 'secondaryCreatedBy', 'secondaryCreatedByName',
    'secondaryCreatedByEmail', 'secondaryCreatedByCrmUserId', 'generatedForUser', 'generatedForName',
    'generatedForEmail', 'createdOnBehalfOfUser', 'createdOnBehalfOfName', 'closedBy',
    'closedByText', 'closedByEmail', 'closedOnBehalfOfName', 'closedAt', 'assignReachedAt', 'assignments',
    'serviceSelections', 'createdAt', 'updatedAt',
    ...(req.query.dashboard === 'true' ? [
      'industryType', 'applicantType', 'subApplicantType', 'servicesOffered', 'referredBy',
      'source', 'leadDate', 'nextFollowUpDate', 'nextFollowUpTime', 'followUpRemarks',
      'followUpPriority', 'followUpFlag', 'followUpHistory'
    ] : []),
    ...(req.query.export === 'true' ? [
      'industryType', 'piboParent', 'piboCategoryParent', 'subApplicantType', 'servicesOffered',
      'designation', 'mobileNo2', 'website', 'emailsSentCount', 'lastEmailSent', 'referredBy',
      'source', 'notes', 'leadDate', 'nextFollowUpDate', 'nextFollowUpTime', 'followUpRemarks',
      'importedCreatedAt', 'importedUpdatedAt', 'businessCardUrl'
    ] : [])
  ].join(' ');
  const queryStartedAt = process.hrtime.bigint();
  if (workspace === 'notified') {
    // Avoid the nested MongoDB array/count query that can exceed the gateway
    // timeout. Classify the user's already-scoped directory in Node, then page.
    const candidates = await Lead.find(filter).select(projection)
      .sort({ [sortBy]: sortOrder, ...(sortBy === 'leadCode' ? { createdAt: sortOrder } : { _id: sortOrder }) })
      .lean();
    const matched = candidates.filter((lead) => hasPendingClosedManagerAssignment(lead, req.user));
    const total = matched.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const pageRows = matched.slice((safePage - 1) * limit, safePage * limit);
    const leads = await Lead.populate(pageRows, [
      { path: 'assignedTo', select: 'name email avatarUrl role' },
      { path: 'closedBy', select: 'name email avatarUrl role' },
      { path: 'createdBy', select: 'name email' },
      { path: 'generatedForUser', select: 'name email crmUserId' }
    ]);
    const queryMs = Number(process.hrtime.bigint() - queryStartedAt) / 1e6;
    const totalMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const existing = matched.filter((lead) => lead.existingClient === 'Yes' || lead.status === 'Existing Client').length;
    res.set('Server-Timing', `access;dur=${accessMs.toFixed(1)}, query;dur=${queryMs.toFixed(1)}, total;dur=${totalMs.toFixed(1)}`);
    return res.json({
      ok: true,
      leads,
      pagination: {
        page: safePage, limit, total, totalPages,
        hasNextPage: safePage < totalPages,
        hasPreviousPage: safePage > 1
      },
      summary: {
        total, existing, converted: existing, new: total - existing,
        allocated: total, unassigned: 0, notifiedPending: total
      },
      timings: process.env.API_PERF_TIMINGS === 'true' ? { accessMs, queryMs, totalMs } : undefined
    });
  }
  const [leads, total, summaryRows] = await Promise.all([
    Lead.find(filter).select(projection)
      .populate('assignedTo', 'name email avatarUrl role')
      .populate('closedBy', 'name email avatarUrl role')
      .populate('createdBy', 'name email')
      .populate('generatedForUser', 'name email crmUserId')
      .sort({ [sortBy]: sortOrder, ...(sortBy === 'leadCode' ? { createdAt: sortOrder } : { _id: sortOrder }) })
      .skip((page - 1) * limit).limit(limit).lean(),
    Lead.countDocuments(filter),
    Lead.aggregate([
      { $match: accessFilter },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        existing: { $sum: { $cond: [{ $or: [{ $eq: ['$existingClient', 'Yes'] }, { $eq: ['$status', 'Existing Client'] }] }, 1, 0] } },
        allocated: { $sum: { $cond: [{ $or: [
          { $ne: [{ $ifNull: ['$generatedForUser', null] }, null] },
          { $ne: [{ $ifNull: ['$createdBy', null] }, null] }
        ] }, 1, 0] } }
      } }
    ])
  ]);
  const queryMs = Number(process.hrtime.bigint() - queryStartedAt) / 1e6;
  const totalMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const summary = summaryRows[0] || { total: 0, existing: 0, allocated: 0 };
  res.set('Server-Timing', `access;dur=${accessMs.toFixed(1)}, query;dur=${queryMs.toFixed(1)}, total;dur=${totalMs.toFixed(1)}`);
  return res.json({
    ok: true,
    leads,
    pagination: {
      page, limit, total, totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1
    },
    summary: {
      total: summary.total,
      existing: summary.existing,
      converted: summary.existing,
      new: summary.total - summary.existing,
      allocated: summary.allocated,
      unassigned: summary.total - summary.allocated,
      // The notified workspace is already filtered, so its total is the exact
      // pending lead count without another collection-wide count query.
      notifiedPending: workspace === 'notified' ? total : undefined
    },
    timings: process.env.API_PERF_TIMINGS === 'true' ? { accessMs, queryMs, totalMs } : undefined
  });
};

exports.getLead = async (req, res) => {
  const leadId = String(req.params.id || '').trim();
  if (!mongoose.Types.ObjectId.isValid(leadId)) return res.status(400).json({ error: 'Invalid Lead ID' });
  const lead = await Lead.findOne(combineAccessFilters({ _id: leadId }, await leadAccessFilter(req.user)))
    .populate('assignedTo', 'name email avatarUrl role')
    .populate('closedBy', 'name email avatarUrl role')
    .populate('createdBy', 'name email')
    .populate('generatedForUser', 'name email crmUserId')
    .lean();
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  return res.json({ ok: true, lead });
};

exports.createLead = async (req, res) => {
  try {
    const duplicate = await findDuplicateCompanyRecord(req.body?.company);
    if (duplicate) {
      const ownerName = duplicate.importedCreatedBy || duplicate.createdBy?.name || duplicate.createdBy?.email || 'another CRM user';
      return res.status(409).json({
        error: `This lead has already been generated by ${ownerName}. You cannot create or update this lead.`,
        code: 'DUPLICATE_LEAD_COMPANY',
        duplicate: {
          id: String(duplicate._id || ''),
          company: duplicate.company || '',
          ownerName,
          leadCode: duplicate.leadCode || ''
        }
      });
    }
    const lead = await createLeadRecord(req.body, req.user);
    await LeadActivity.create({ lead: lead._id, type: 'lead_created', title: 'Lead created', description: `Lead created for ${lead.company || lead.leadCode}`, actor: req.user?._id });
    const managerId = String(req.body?.assignedToCrmUserId || req.body?.assignedTo || lead.assignedTo || '').trim();
    if (managerId) {
      await notifyLeadAssignment({ lead: lead.toObject(), managerId, assignedBy: req.user }).catch((error) => console.error('Lead assignment notification failed', error));
    }
    const introductionEmail = req.body?.sendIntroductionEmail === true
      ? await sendIntroductionWhenRequested(lead, req.user)
      : { requested: false, sent: false, status: 'not-requested' };
    res.status(201).json({ ok: true, lead, introductionEmail });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Unable to save lead' });
  }
};

exports.allocateLead = async (req, res) => {
  try {
    const userId = String(req.body?.userId || '').trim();
    if (!mongoose.isValidObjectId(userId)) return res.status(400).json({ error: 'A valid admin user is required.' });
    const target = await User.findById(userId).select('name email crmUserId role isActive');
    if (!target || target.isActive === false) return res.status(404).json({ error: 'Active CRM user not found.' });

    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    const previousOwner = lead.generatedForName || lead.createdByName || lead.createdByEmail || lead.importedCreatedBy || 'Unassigned';
    lead.generatedForUser = target._id;
    lead.generatedForName = target.name || target.email;
    lead.generatedForEmail = target.email || '';
    lead.creationMode = String(lead.createdBy || '') === String(target._id) ? 'self' : 'other';
    lead.createdOnBehalfOfUser = target._id;
    lead.createdOnBehalfOfName = target.name || target.email;
    lead.createdOnBehalfOfEmail = target.email || '';
    lead.updatedBy = req.user?.name || req.user?.email || String(req.user?._id || '');
    await lead.save();
    await LeadActivity.create({
      lead: lead._id,
      type: 'lead_allocated',
      title: 'Lead allocated',
      description: `${lead.company || lead.leadCode || 'Lead'} reallocated from ${previousOwner} to ${target.name || target.email}`,
      actor: req.user?._id
    });
    const saved = await Lead.findById(lead._id)
      .populate('createdBy', 'name email role')
      .populate('generatedForUser', 'name email crmUserId role');
    let emailDelivery = { requested: Boolean(target.email), sent: false };
    if (target.email) {
      const appUrl = String(process.env.FRONTEND_URL || 'https://crmananttattva.vercel.app').replace(/\/$/, '');
      const assigneeName = target.name || target.email;
      const allocatorName = req.user?.name || req.user?.email || 'CRM Administrator';
      const company = lead.company || 'Unnamed company';
      const leadCode = lead.leadCode || 'Lead';
      const html = `
        <div style="margin:0;background:#f1f5f9;padding:28px 12px;font-family:Arial,Helvetica,sans-serif;color:#334155">
          <div style="max-width:640px;margin:0 auto;overflow:hidden;border:1px solid #dbeafe;border-radius:18px;background:#ffffff;box-shadow:0 12px 34px rgba(15,23,42,.10)">
            <div style="background:linear-gradient(135deg,#1d4ed8,#4f46e5,#7c3aed);padding:26px 30px;color:#ffffff">
              <div style="font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;opacity:.85">CRM Lead Allocation</div>
              <h1 style="margin:8px 0 0;font-size:25px;line-height:1.25">A lead has been allocated to you</h1>
            </div>
            <div style="padding:28px 30px">
              <p style="margin:0 0 18px;font-size:15px;line-height:1.7">Hello <strong style="color:#0f172a">${escapeHtml(assigneeName)}</strong>,</p>
              <p style="margin:0 0 22px;font-size:14px;line-height:1.7">${escapeHtml(allocatorName)} has assigned the following CRM lead to you. It is now available under your ownership and will be reflected in Sales MIS.</p>
              <table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
                <tr><td style="width:145px;background:#f8fafc;padding:12px 14px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:800;color:#64748b">LEAD CODE</td><td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:800;color:#1d4ed8">${escapeHtml(leadCode)}</td></tr>
                <tr><td style="background:#f8fafc;padding:12px 14px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:800;color:#64748b">COMPANY</td><td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:800;color:#0f172a">${escapeHtml(company)}</td></tr>
                <tr><td style="background:#f8fafc;padding:12px 14px;font-size:12px;font-weight:800;color:#64748b">ALLOCATED BY</td><td style="padding:12px 14px;font-size:14px;font-weight:700;color:#334155">${escapeHtml(allocatorName)}</td></tr>
              </table>
              <p style="margin:24px 0 0"><a href="${escapeHtml(appUrl)}/sales/lead-generation" target="_blank" rel="noopener noreferrer" style="display:inline-block;border-radius:11px;background:#1d4ed8;padding:13px 22px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:800">Open Lead in CRM →</a></p>
              <p style="margin:24px 0 0;border-top:1px solid #e2e8f0;padding-top:18px;font-size:11px;line-height:1.6;color:#94a3b8">This is an automated CRM allocation notification. Please sign in to review the complete lead details and next actions.</p>
            </div>
          </div>
        </div>`;
      try {
        await sendMail(target.email, `New Lead Allocated - ${leadCode} - ${company}`, html, { branded: false });
        emailDelivery = { requested: true, sent: true, recipient: target.email };
      } catch (mailError) {
        console.error('Lead allocation email failed', { leadId: String(lead._id), recipient: target.email, error: mailError.message });
        emailDelivery = { requested: true, sent: false, recipient: target.email, error: mailError.message };
      }
    }
    res.json({ ok: true, message: `Lead allocated to ${target.name || target.email}.`, lead: saved, emailDelivery });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unable to allocate lead.' });
  }
};

exports.updateLeadCreator = async (req, res) => {
  try {
    const slot = req.body?.slot || 'primary';
    if (!['primary', 'secondary'].includes(slot)) return res.status(400).json({ error: 'Choose Primary or Secondary user.' });
    const userId = String(req.body?.userId || '').trim();
    if ((slot === 'primary' || userId) && !mongoose.isValidObjectId(userId)) return res.status(400).json({ error: 'A valid creator user is required.' });
    const target = userId ? await User.findById(userId).select('name email crmUserId role isActive') : null;
    if (userId && (!target || target.isActive === false)) return res.status(404).json({ error: 'Active CRM user not found.' });
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    const otherUserId = slot === 'secondary' ? lead.createdBy : lead.secondaryCreatedBy;
    if (userId && String(otherUserId || '') === userId) return res.status(400).json({ error: 'Primary and Secondary must be different users.' });
    if (slot === 'secondary') {
      const previousId = String(lead.secondaryCreatedBy || '');
      if (previousId !== userId) {
        lead.creatorChangeHistory.push({ slot, fromUserId: lead.secondaryCreatedBy || null, fromName: lead.secondaryCreatedByName || '', toUserId: target?._id || null, toName: target?.name || target?.email || '', changedBy: req.user?._id, changedByName: req.user?.name || req.user?.email || 'CRM Administrator', changedAt: new Date() });
      }
      lead.secondaryCreatedBy = target?._id || null;
      lead.secondaryCreatedByCrmUserId = target?.crmUserId || (target ? String(target._id) : '');
      lead.secondaryCreatedByName = target?.name || target?.email || '';
      lead.secondaryCreatedByEmail = target?.email || '';
      lead.updatedBy = req.user?.name || req.user?.email || String(req.user?._id || '');
      await lead.save();
      if (previousId !== userId) await LeadActivity.create({ lead: lead._id, type: 'lead_creator_changed', title: 'Secondary editor updated', description: `${lead.company || lead.leadCode || 'Lead'} secondary editor ${target ? `assigned to ${target.name || target.email}` : 'removed'}`, actor: req.user?._id });
      const saved = await Lead.findById(lead._id).populate('createdBy', 'name email crmUserId role').populate('generatedForUser', 'name email crmUserId role');
      return res.json({ ok: true, message: target ? `Secondary user ${target.name || target.email} can now view and edit this lead.` : 'Secondary user removed.', lead: saved });
    }
    const previous = { userId: lead.createdBy || null, crmUserId: lead.createdByCrmUserId || '', name: lead.createdByName || lead.createdByEmail || lead.importedCreatedBy || 'Unknown creator', email: lead.createdByEmail || '' };
    if (String(previous.userId || '') !== String(target._id)) {
      lead.creatorChangeHistory.push({ slot: 'primary', fromUserId: previous.userId, fromCrmUserId: previous.crmUserId, fromName: previous.name, fromEmail: previous.email, toUserId: target._id, toCrmUserId: target.crmUserId || String(target._id), toName: target.name || target.email, toEmail: target.email || '', changedBy: req.user?._id, changedByName: req.user?.name || req.user?.email || 'CRM Administrator', changedAt: new Date() });
    }
    lead.createdBy = target._id;
    lead.createdByCrmUserId = target.crmUserId || String(target._id);
    lead.createdByName = target.name || target.email;
    lead.createdByEmail = target.email || '';
    lead.updatedBy = req.user?.name || req.user?.email || String(req.user?._id || '');
    await lead.save();
    await LeadActivity.create({ lead: lead._id, type: 'lead_creator_changed', title: 'Created By updated', description: `${lead.company || lead.leadCode || 'Lead'} creator changed from ${previous.name} to ${target.name || target.email}`, actor: req.user?._id });
    const saved = await Lead.findById(lead._id).populate('createdBy', 'name email crmUserId role').populate('generatedForUser', 'name email crmUserId role');
    res.json({ ok: true, message: `Created By updated to ${target.name || target.email}. Lead Owner was not changed.`, lead: saved });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unable to update lead creator.' });
  }
};

exports.updateLead = async (req, res) => {
  try {
    const addServicesMode = req.body?.addServicesMode === true;
    const assignmentOnlyUpdate = isAssignmentOnlyLeadUpdate(req.body);
    const lead = addServicesMode
      ? await Lead.findById(req.params.id)
      : await Lead.findOne(combineAccessFilters({ _id: req.params.id }, await leadAccessFilter(req.user)));
    if (!lead) return res.status(404).json({ error: 'Lead not found or not accessible' });
    const beforeLead = lead.toObject();

    if (req.body?.company) {
      const duplicate = await findDuplicateCompanyRecord(req.body.company, req.params.id);
      if (duplicate) {
        const ownerName = duplicate.importedCreatedBy || duplicate.createdBy?.name || duplicate.createdBy?.email || 'another CRM user';
        return res.status(409).json({
          error: `This lead has already been generated by ${ownerName}. You cannot create or update this lead.`,
          code: 'DUPLICATE_LEAD_COMPANY',
          duplicate: {
            id: String(duplicate._id || ''),
            company: duplicate.company || '',
            ownerName,
            leadCode: duplicate.leadCode || ''
          }
        });
      }
    }

    const sendIntroductionEmail = req.body?.sendIntroductionEmail === true;
    const poDebugId = String(req.get('x-po-debug-id') || '').trim().slice(0, 100);
    let data = preserveExistingClosureEvidence(beforeLead, cleanBody(req.body));
    data = enforcePrimaryOwnerClosureCredit(beforeLead, data, req.user);
    if (addServicesMode) data = buildAppendOnlyServicePatch(beforeLead, data, req.user);
    data = setProvisionalClosureDeadlines(data, beforeLead);
    if (poDebugId) console.info('[POProof:lead:sanitized]', { poDebugId, leadId: String(lead._id), leadCode: lead.leadCode || '', collection: Lead.collection.collectionName, assignments: (data.assignments || []).map((row, assignmentIndex) => ({ assignmentIndex, poStatus: row.poStatus || '', rows: (row.poYearRows || []).map((po, rowIndex) => ({ rowIndex, poNumber: po.poNumber || '', poAmount: po.poAmount ?? null, hasPoFileUrl: Boolean(po.poFileUrl), poFileName: po.poFileName || '' })) })) });
    delete data.sendIntroductionEmail;
    const followUpChangedIndexes = changedFollowUpIndexes(beforeLead, data);
    if (followUpChangedIndexes.length) {
      data.followUpFlag = 'GREEN';
      data.serviceSelections = data.serviceSelections.map((row, index) => followUpChangedIndexes.includes(index) ? { ...row, followUpFlag: 'GREEN' } : row);
    }
    const duplicateServiceError = validateDuplicateServiceSelections({ ...lead.toObject(), ...data });
    if (duplicateServiceError) return res.status(409).json({ error: duplicateServiceError, code: 'DUPLICATE_SERVICE_COMBINATION' });
    if (Array.isArray(data.serviceSelections)) {
      const removalPermissionError = validateServiceRemovalPermission(beforeLead, data.serviceSelections, req.user);
      if (removalPermissionError) return res.status(403).json({ error: removalPermissionError, code: 'SERVICE_REMOVAL_FORBIDDEN' });
    }
    const closureError = validateClosureAssignments({ ...lead.toObject(), ...data }, beforeLead);
    if (closureError) {
      logLeadUpdateRejection(poDebugId, lead, 'closure-validation', closureError);
      return res.status(400).json({ error: closureError, code: 'INVALID_LEAD_CLOSURE' });
    }
    if (Object.prototype.hasOwnProperty.call(data, 'company')) {
      data.companyIdentity = normalizeCompanyIdentity(data.company);
    }
    data.workflowStatus = data.workflowStatus === 'submitted' ? 'submitted' : (data.workflowStatus || lead.workflowStatus || 'draft');

    if (data.workflowStatus === 'submitted' && !assignmentOnlyUpdate) {
      data.formStartedAt = data.formStartedAt || lead.formStartedAt || lead.createdAt || new Date();
      data.submittedAt = data.submittedAt || lead.submittedAt || new Date();
      data.fillDurationSeconds = Math.max(0, Math.min(86400, Math.round((new Date(data.submittedAt).getTime() - new Date(data.formStartedAt).getTime()) / 1000)));
      const error = validateSubmittedLead({ ...lead.toObject(), ...data });
      if (error) {
        logLeadUpdateRejection(poDebugId, lead, 'submitted-lead-validation', error);
        return res.status(400).json({ error });
      }
    }

    const current = lead.toObject();
    if (!assignmentOnlyUpdate && shouldValidatePiboSelection(data, current)) {
      const selection = await validatePiboSelection({
        parent: data.piboParent || current.piboParent || current.piboCategoryParent,
        child: data.subApplicantType || current.subApplicantType || current.piboCategory,
        required: true
      });
      data.piboParent = selection.piboParent;
      data.subApplicantType = selection.piboCategory;
    }

    const poCommercialError = (data.assignments || []).flatMap((row) => row.poYearRows || []).map(validatePoCommercialDetails).find(Boolean);
    if (poCommercialError) return res.status(400).json({ error: poCommercialError });
    if (Array.isArray(data.assignments)) {
      const invalidPoDate = data.assignments.some((row, index) => {
        const beforeAssignment = beforeLead.assignments?.[index] || {};
        const poSubmissionChanged = poClosureSubmissionChanged(beforeAssignment, row);
        return poSubmissionChanged && row?.poStatus === 'received' && (row.closedBy || row.closureRequestedBy)
          && (row.poYearRows || []).some((po) => !/^\d{4}-\d{2}-\d{2}$/.test(String(po?.poDate || '').trim()) || Number.isNaN(new Date(`${po.poDate}T00:00:00`).getTime()));
      });
      if (invalidPoDate) {
        const error = 'A valid PO Date is required for every Purchase Order row.';
        logLeadUpdateRejection(poDebugId, lead, 'po-date-validation', error);
        return res.status(400).json({ error });
      }
      data.assignments = data.assignments.map((row) => {
        const approved = String(row?.poApprovalStatus || '').toUpperCase() === 'APPROVED';
        if (!approved || !row?.assignedTo || !row?.closureRequestedBy || row?.closedBy) return row;
        return { ...row, closedBy: row.closureRequestedBy, closedByText: row.closureRequestedByText || '', closedAt: new Date().toISOString(), closureFinalizedByManager: true };
      });
    }
    Object.assign(lead, data);
    if (Object.prototype.hasOwnProperty.call(data, 'subApplicantType') || Array.isArray(data.serviceSelections)) {
      lead.piboCategory = undefined;
    }
    lead.updatedBy = req.user?.name || req.user?.email || String(req.user?._id || '');
    if (data.closedBy && !lead.closedAt) lead.closedAt = new Date();
    await upsertPurchaseOrderApprovals({ beforeLead, lead, actor: req.user, submittedAssignments: data.assignments, poDebugId, modifyPoDetails: req.body?.modifyPoDetails === true });
    await lead.save();
    if (poDebugId) console.info('[POProof:lead:persisted]', { poDebugId, leadId: String(lead._id), leadCode: lead.leadCode || '', collection: Lead.collection.collectionName, assignments: (lead.assignments || []).map((row, assignmentIndex) => ({ assignmentIndex, proofCount: (row.poYearRows || []).filter((po) => resolvePoProof(po).url).length, rowCount: (row.poYearRows || []).length })) });
    if (Object.prototype.hasOwnProperty.call(data, 'subApplicantType') || Array.isArray(data.serviceSelections)) {
      await Lead.collection.updateOne({ _id: lead._id }, { $unset: { piboCategory: '' } });
    }
    if (followUpChangedIndexes.length) {
      const completedAt = new Date().toISOString();
      await CalendarItem.updateMany({
        leadId: String(lead._id), type: 'followup', status: { $ne: 'completed' },
        'metadata.serviceIndex': { $in: followUpChangedIndexes }
      }, {
        $set: { status: 'completed', completedAt, completionRemarks: 'Follow-up updated; red flag reset to green.' },
        $push: { completionHistory: { at: completedAt, by: req.user?.name || req.user?.email || 'CRM User', remarks: 'Follow-up updated; red flag reset to green.' } }
      });
    }
    await notifyNewProvisionalClosures({ beforeLead, afterLead: lead.toObject(), actor: req.user })
      .catch((error) => console.error('Provisional lead closure email failed', error));
    await sendLeadClosureKickoffEmail({ beforeLead, lead: lead.toObject() })
      .catch((error) => console.error('Lead closure kick-off email failed', error));
    if (Array.isArray(data.assignments)) {
      await registerStaffOnboardingAssignments({
        lead: lead.toObject(),
        manager: req.user
      }).catch((error) => console.error('Staff onboarding assignment notification failed', error));
    }
    const savedLead = lead.toObject();
    const beforeAssignments = Array.isArray(beforeLead.assignments) ? beforeLead.assignments : [];
    const changedManagerRows = (savedLead.assignments || []).map((row, index) => ({ row, index })).filter(({ row, index }) => row?.assignedTo && String(row.assignedTo) !== String(beforeAssignments[index]?.assignedTo || ''));
    await Promise.all(changedManagerRows.map(({ row, index }) => notifyLeadAssignment({ lead: savedLead, managerId: row.assignedTo, assignedBy: req.user, assignmentIndex: index })
      .catch((error) => console.error('Lead assignment notification failed', error))));
    const introductionEmail = sendIntroductionEmail && lead.workflowStatus === 'submitted'
      ? await sendIntroductionWhenRequested(lead, req.user)
      : { requested: sendIntroductionEmail, sent: false, status: sendIntroductionEmail ? 'skipped' : 'not-requested', reason: sendIntroductionEmail ? 'not-submitted' : undefined };
    if (req.body?.addServicesMode) {
      await notifyNewFinancialYear({ beforeLead, savedLead: lead.toObject(), submittedPayload: req.body, actor: req.user }).catch((error) => console.error('Financial year notification failed', error));
      const notificationLead = {
        ...lead.toObject(),
        generatedForUser: req.body.generatedForUser || lead.generatedForUser,
        generatedForName: req.body.generatedForName || lead.generatedForName,
        generatedForEmail: req.body.generatedForEmail || lead.generatedForEmail
      };
      await notifyAdditionalLeadServices({
        beforeLead,
        afterLead: notificationLead,
        actor: req.user
      }).catch((error) => console.error('Additional lead service notification failed', error));
    }
    const changedFields = Object.keys(data).filter((key) => key !== 'followUpHistory');
    await LeadActivity.create({ lead: lead._id, type: 'lead_updated', title: 'Lead updated', description: changedFields.length ? `Updated ${changedFields.join(', ')}` : 'Lead details updated', actor: req.user?._id, metadata: { changedFields, modifyPoDetails: req.body?.modifyPoDetails === true } });
    res.json({ ok: true, lead, introductionEmail });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Unable to update lead' });
  }
};

exports.assignLeadStaff = async (req, res) => {
  try {
    const rowIndex = Number.parseInt(req.params.rowIndex, 10);
    if (!Number.isInteger(rowIndex) || rowIndex < 0) {
      return res.status(400).json({ error: 'A valid assignment row is required.' });
    }

    const lead = await Lead.findOne(combineAccessFilters(
      { _id: req.params.id },
      await leadAccessFilter(req.user)
    ));
    if (!lead) return res.status(404).json({ error: 'Lead not found or not accessible.' });

    const assignments = Array.isArray(lead.assignments) ? lead.assignments.map((row) => ({ ...(row || {}) })) : [];
    const assignment = assignments[rowIndex];
    if (!assignment) return res.status(404).json({ error: 'Assignment row not found.' });
    if (!canAssignStaffToRow(req.user, assignment)) {
      return res.status(403).json({ error: 'Only the assigned manager or an administrator can assign staff for this service.' });
    }

    const requestedStaffId = String(req.body?.staffUserId || '').trim();
    const kickoffEmailConsent = requestedStaffId && req.body?.kickoffEmailConsent === 'yes' ? 'yes'
      : requestedStaffId && req.body?.kickoffEmailConsent === 'no' ? 'no' : '';
    const staff = requestedStaffId
      ? await User.findOne(activeUserLookup(requestedStaffId)).select('_id crmUserId name email role roles team isActive').lean()
      : null;
    if (requestedStaffId && !staff) return res.status(404).json({ error: 'Active staff user not found.' });

    const beforeLead = lead.toObject();
    const updatedAssignment = {
      ...assignment,
      assignedStaff: staff?._id || '',
      assignedStaffText: staff ? (staff.name || staff.email) : '',
      assignedStaffEmail: staff?.email || '',
      assignedBy: req.user?._id || '',
      kickoffEmailConsent
    };
    assignments[rowIndex] = updatedAssignment;

    // Only persist the selected row. Saving the complete document validates
    // unrelated legacy/imported fields and can reject a valid staff assignment.
    const setFields = {
      [`assignments.${rowIndex}`]: updatedAssignment,
      updatedBy: req.user?.name || req.user?.email || String(req.user?._id || '')
    };
    const unsetFields = {};
    if (rowIndex === 0) {
      setFields.assignedStaffText = staff ? (staff.name || staff.email) : '';
      setFields.assignedStaffEmail = staff?.email || '';
      if (staff) setFields.assignedStaff = staff._id;
      else unsetFields.assignedStaff = 1;
    }
    const update = { $set: setFields };
    if (Object.keys(unsetFields).length) update.$unset = unsetFields;
    const savedLeadDocument = await Lead.findByIdAndUpdate(lead._id, update, {
      new: true,
      runValidators: false
    });
    if (!savedLeadDocument) return res.status(404).json({ error: 'Lead was removed before the assignment could be saved.' });

    const savedLead = savedLeadDocument.toObject();
    await sendLeadClosureKickoffEmail({ beforeLead, lead: savedLead })
      .catch((error) => console.error('Lead staff assignment kick-off email failed', { leadId: String(lead._id), rowIndex, error: error.message }));
    if (staff) {
      await registerStaffOnboardingAssignments({ lead: savedLead, manager: req.user })
        .catch((error) => console.error('Lead staff onboarding registration failed', { leadId: String(lead._id), rowIndex, error: error.message }));
    }
    await LeadActivity.create({
      lead: lead._id,
      type: staff ? 'lead_staff_assigned' : 'lead_staff_unassigned',
      title: staff ? 'Staff assigned to service' : 'Staff removed from service',
      description: staff
        ? `${staff.name || staff.email} assigned to ${lead.company || lead.leadCode || 'lead'} service row ${rowIndex + 1}`
        : `Staff removed from ${lead.company || lead.leadCode || 'lead'} service row ${rowIndex + 1}`,
      actor: req.user?._id,
      metadata: { rowIndex, staffUserId: staff ? String(staff._id) : '', kickoffEmailConsent }
    }).catch((error) => console.error('Lead staff assignment activity log failed', {
      leadId: String(lead._id), rowIndex, error: error.message
    }));

    return res.json({
      ok: true,
      message: staff ? `${staff.name || staff.email} assigned successfully.` : 'Staff assignment removed.',
      assignment: savedLead.assignments?.[rowIndex] || updatedAssignment,
      lead: savedLeadDocument
    });
  } catch (err) {
    console.error('Lead staff assignment failed', { leadId: req.params.id, rowIndex: req.params.rowIndex, error: err.message });
    return res.status(err.statusCode || 500).json({ error: err.message || 'Unable to assign staff.' });
  }
};

exports.permanentlyCloseProvisionalLead = async (req, res) => {
  try {
    if (req.body?.originalPoReceived !== true) {
      return res.status(400).json({ error: 'Confirm that the original Purchase Order has been received.' });
    }
    const lead = await Lead.findOne(combineAccessFilters({ _id: req.params.id }, await leadAccessFilter(req.user)));
    if (!lead) return res.status(404).json({ error: 'Lead not found or not accessible' });
    const provisionalIndexes = (lead.assignments || []).map((row, index) => row?.poStatus === 'provisional' ? index : -1).filter((index) => index >= 0);
    if (!provisionalIndexes.length) {
      return res.status(409).json({ error: 'This lead has no provisional closure awaiting permanent confirmation.' });
    }
    const submittedRows = Array.isArray(req.body?.originalPoRows) ? req.body.originalPoRows.slice(0, 25) : [];
    const originalPoRows = provisionalIndexes.map((assignmentIndex) => {
      const submitted = submittedRows.find((row) => Number(row?.assignmentIndex) === assignmentIndex) || {};
      const serviceRow = lead.serviceSelections?.[assignmentIndex] || {};
      const proofType = String(submitted.poFileType || '').trim().slice(0, 100);
      return {
        assignmentIndex,
        assignedServiceId: String(lead.assignments?.[assignmentIndex]?.assignedServiceId || serviceRow.assignedServiceId || '').trim(),
        fy: String(submitted.fy || serviceRow.firstAnnualReturnYearApplicable || '').trim().slice(0, 30),
        poNumber: String(submitted.poNumber || '').trim().slice(0, 100),
        poDate: String(submitted.poDate || '').trim(),
        ...cleanPoCommercialDetails(submitted),
        poAmount: Math.max(0, Number(submitted.poAmount) || 0),
        service: String(serviceRow.servicesOffered || serviceRow.applicableService || serviceRow.eprCategory || submitted.service || '').trim().slice(0, 255),
        poFileUrl: String(submitted.poFileUrl || '').trim().slice(0, 2000),
        poFileName: String(submitted.poFileName || '').trim().slice(0, 255),
        poFileType: proofType,
        poFileSize: Math.max(0, Number(submitted.poFileSize) || 0),
        poPublicId: String(submitted.poPublicId || '').trim().slice(0, 500),
        poUploadedAt: String(submitted.poUploadedAt || '').trim()
      };
    });
    const commercialError = originalPoRows.map(validatePoCommercialDetails).find(Boolean);
    if (commercialError) return res.status(400).json({ error: commercialError });
    const invalidPoRow = originalPoRows.find((row) => !row.fy || !row.poNumber || !/^\d{4}-\d{2}-\d{2}$/.test(row.poDate)
      || Number.isNaN(new Date(`${row.poDate}T00:00:00`).getTime()) || !(row.poAmount > 0) || !row.service
      || !/^https:\/\//i.test(row.poFileUrl) || !row.poFileName
      || !(row.poFileType === 'application/pdf' || row.poFileType.startsWith('image/')));
    if (submittedRows.length !== provisionalIndexes.length || invalidPoRow) {
      return res.status(400).json({ error: 'Complete PO Number, PO Date, PO Amount, PO Proof, Service Period, and Service for every provisional service.' });
    }

    const result = permanentlyCloseProvisionalAssignments(lead.assignments || [], req.user, originalPoRows);

    lead.assignments = result.assignments;
    const primary = result.assignments[0] || {};
    lead.closedBy = primary.closedBy || lead.closedBy;
    lead.closedByText = primary.closedByText || lead.closedByText || '';
    lead.closedByEmail = primary.closedByEmail || lead.closedByEmail || '';
    lead.updatedBy = req.user?.name || req.user?.email || String(req.user?._id || '');
    lead.markModified('assignments');
    await lead.save();

    await LeadActivity.create({
      lead: lead._id,
      type: 'lead_permanently_closed',
      title: 'Lead permanently closed',
      description: `${result.changedCount} provisional service closure(s) permanently closed after original PO confirmation. Automatic reopening is disabled.`,
      actor: req.user?._id,
      metadata: { serviceCount: result.changedCount, originalPoConfirmed: true, originalPoNumbers: originalPoRows.map((row) => row.poNumber), originalPoFileUrls: originalPoRows.map((row) => row.poFileUrl) }
    }).catch((error) => console.error('Permanent lead closure audit failed', error));

    res.json({ ok: true, message: 'Lead permanently closed. It will not reopen after 7 business days.', lead: lead.toObject() });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unable to permanently close the lead.' });
  }
};

exports.decidePurchaseOrderApproval = async (req, res) => {
  const status = String(req.body.status || '').trim().toUpperCase();
  if (!['APPROVED', 'REJECTED', 'REVISION_REQUIRED'].includes(status)) return res.status(400).json({ error: 'Select Approve, Reject, or Revision Required.' });
  const remarks = String(req.body.remarks || '').trim();
  if (!remarks) return res.status(400).json({ error: 'Decision remarks are required.' });
  const screenshotUrl = String(req.body.screenshotUrl || '').trim();
  const approval = await PendingApproval.findOne({ _id: req.params.id, type: 'purchase_order' });
  if (!approval) return res.status(404).json({ error: 'PO approval request not found.' });
  const lead = await Lead.findById(approval.payload?.leadId).populate('createdBy', 'name email');
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });
  const index = Number(approval.payload?.assignmentIndex);
  if (!lead.assignments?.[index]) return res.status(404).json({ error: 'Lead assignment not found.' });
  lead.assignments[index].poApprovalStatus = status;
  const closureRequestedBy = lead.assignments[index].closureRequestedBy || approval.payload?.closureRequestedBy;
  if (status === 'APPROVED' && closureRequestedBy) {
    lead.assignments[index].closureRequestedBy = closureRequestedBy;
    lead.assignments[index].closureRequestedByText = lead.assignments[index].closureRequestedByText || approval.payload?.closureRequestedByText || '';
    if (lead.assignments[index].assignedTo) {
      lead.assignments[index].closedBy = closureRequestedBy;
      lead.assignments[index].closedByText = lead.assignments[index].closureRequestedByText;
      lead.assignments[index].closedAt = new Date();
      lead.assignments[index].closureFinalizedByManager = true;
    }
  }
  lead.markModified('assignments');
  await lead.save();
  approval.approvalStatus = status;
  approval.remarks = remarks;
  approval.actionBy = req.user?._id;
  approval.actionAt = new Date();
  approval.payload = { ...(approval.payload || {}), decisionScreenshotUrl: screenshotUrl, decidedBy: req.user?.name || req.user?.email || '' };
  approval.markModified('payload');
  await approval.save();
  const responsibleUsers = await User.find({ $or: [
    { role: { $in: ADMIN_ROLES }, isActive: { $ne: false } },
    ...(approval.payload?.poSubmittedById ? [{ _id: approval.payload.poSubmittedById }] : []),
    ...(approval.createdByName ? [{ name: approval.createdByName }] : [])
  ] }).select('email').lean();
  const recipients = [...new Set([
    ...responsibleUsers.map((user) => user.email),
    approval.payload?.poSubmittedByEmail,
    approval.payload?.leadCreatorEmail,
    ...(approval.payload?.quotationCreatorEmails || [])
  ].map((email) => String(email || '').trim().toLowerCase()).filter(Boolean))];
  const verb = status === 'APPROVED' ? 'approved' : status === 'REJECTED' ? 'rejected' : 'marked for revision';
  const decisionRows = Array.isArray(approval.payload?.poYearRows) && approval.payload.poYearRows.length
    ? approval.payload.poYearRows
    : (lead.assignments[index].poYearRows || []);
  const html = buildPurchaseOrderEmail({
    eyebrow: `Purchase order ${verb}`,
    title: status === 'APPROVED' ? 'Purchase Order approved successfully' : status === 'REJECTED' ? 'Purchase Order rejected' : 'Purchase Order revision required',
    message: `The Purchase Order for <strong>${escapeHtml(lead.company || lead.leadCode)}</strong> was <strong>${escapeHtml(verb)}</strong>.`,
    clientName: lead.company || lead.leadCode,
    leadCode: lead.leadCode,
    rows: decisionRows,
    remarks,
    status,
    actionUrl: `${String(process.env.FRONTEND_URL || 'https://crmananttattva.vercel.app').replace(/\/$/, '')}/pending-approval`
  });
  let screenshotAttachment = null;
  if (screenshotUrl) {
    try {
      const response = await fetch(screenshotUrl);
      if (response.ok) screenshotAttachment = { filename: 'po-correction-screenshot.jpg', content: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') || 'image/jpeg' };
    } catch (error) {
      console.error('Unable to attach PO correction screenshot', error.message);
    }
  }
  const mailResults = await Promise.allSettled(recipients.map((email) => sendMail(email, `PO ${status.replace('_', ' ')} - ${lead.company || lead.leadCode}`, html, { branded: false, attachments: screenshotAttachment ? [screenshotAttachment] : [] })));
  const emailNotification = {
    recipients: recipients.length,
    sent: mailResults.filter((result) => result.status === 'fulfilled').length,
    failed: mailResults.filter((result) => result.status === 'rejected').length
  };
  if (emailNotification.failed) {
    console.error('Some PO decision emails could not be sent', { approvalId: String(approval._id), status, ...emailNotification });
  }
  res.json({ ok: true, approval, emailNotification });
};

exports.recordIntroductionEmail = async (req, res) => {
  const identityFilter = mongoose.isValidObjectId(req.params.id) ? { _id: req.params.id } : { sourceLeadId: req.params.id };
  const lead = await Lead.findOne(combineAccessFilters(identityFilter, await leadAccessFilter(req.user)));
  if (!lead) return res.status(404).json({ error: 'Lead not found or not accessible' });
  const recipient = String(req.body.recipient || lead.emails || '').trim();
  await LeadActivity.create({ lead: lead._id, type: 'email_sent', title: 'Introduction email opened', description: recipient ? `Introduction email prepared for ${recipient}` : 'Introduction email action opened', actor: req.user?._id, metadata: { recipient } });
  res.status(201).json({ ok: true });
};

exports.getLeadHistory = async (req, res) => {
  const lookup = [{ sourceLeadId: req.params.id }];
  if (req.query.leadCode) lookup.push({ leadCode: String(req.query.leadCode).trim() });
  if (mongoose.isValidObjectId(req.params.id)) lookup.push({ _id: req.params.id });
  const storedLead = await Lead.findOne(combineAccessFilters({ $or: lookup }, await leadAccessFilter(req.user))).populate('createdBy', 'name email').lean();
  if (!storedLead) return res.status(404).json({ error: 'Lead not found or not accessible' });
  const lead = storedLead;
  const ids = [lead._id, lead.sourceLeadId, req.params.id].filter(Boolean).map(String);
  const company = String(lead.company || req.query.company || '').trim();
  const quotationMatches = [{ leadId: { $in: ids } }];
  if (lead.leadCode) quotationMatches.push({ leadCode: lead.leadCode });
  if (company) quotationMatches.push({ 'leadDetails.companyName': company });
  const quotations = await Quotation.find({ $or: quotationMatches }).populate('createdBy', 'name email').lean();
  const quotationIds = quotations.map((item) => String(item._id));
  const calendarMatches = [];
  if (lead.leadCode) calendarMatches.push({ leadNumber: lead.leadCode });
  if (company) calendarMatches.push({ leadCompanyName: company });
  const [activities, approvals, calendarItems] = await Promise.all([
    lead._id ? LeadActivity.find({ lead: lead._id }).populate('actor', 'name email').lean() : Promise.resolve([]),
    PendingApproval.find({ type: 'quotation', sourceClientId: { $in: quotationIds } }).populate('actionBy', 'name email').lean(),
    calendarMatches.length ? CalendarItem.find({ $or: calendarMatches }).lean() : Promise.resolve([])
  ]);
  const events = activities.map((item) => ({ id: item._id, type: item.type, title: item.title, description: item.description, actor: item.actor?.name || item.actor?.email || item.actorName || 'CRM User', at: item.createdAt, metadata: item.metadata }));
  if (!activities.some((item) => item.type === 'lead_created') && (lead.createdAt || lead.importedCreatedAt)) events.push({ id: `created-${lead._id || req.params.id}`, type: 'lead_created', title: 'Lead created', description: `Lead ${lead.leadCode || ''} created for ${company}`, actor: lead.createdBy?.name || lead.createdBy?.email || lead.importedCreatedBy || 'Imported user', at: lead.createdAt || lead.importedCreatedAt });
  quotations.forEach((item) => events.push({ id: `quote-${item._id}`, type: 'quotation_created', title: 'Quotation created', description: `${item.quotationNumber || 'Quotation'} added with ${(item.items || []).length} item(s)`, actor: item.createdBy?.name || item.createdBy?.email || 'CRM User', at: item.createdAt, metadata: { quotationNumber: item.quotationNumber, status: item.status } }));
  approvals.forEach((item) => events.push({ id: `approval-${item._id}`, type: item.approvalStatus === 'APPROVED' ? 'quotation_approved' : item.approvalStatus === 'REJECTED' ? 'quotation_rejected' : 'approval_pending', title: item.approvalStatus === 'APPROVED' ? 'Quotation approved' : item.approvalStatus === 'REJECTED' ? 'Quotation rejected' : 'Quotation sent for approval', description: `${item.uniqueId || 'Quotation'} • ${item.remarks || item.approvalStatus}`, actor: item.actionBy?.name || item.actionBy?.email || item.createdByName || 'CRM User', at: item.actionAt || item.createdAt }));
  calendarItems.forEach((item) => {
    events.push({ id: `calendar-${item._id}`, type: item.type === 'followup' ? 'follow_up' : 'todo', title: item.type === 'followup' ? 'Follow-up scheduled' : 'Todo created', description: `${item.title}${item.scheduledDate ? ` • ${item.scheduledDate}${item.scheduledTime ? ` ${item.scheduledTime}` : ''}` : ''}`, actor: item.createdBy || item.assignedToName || 'CRM User', at: item.createdAt, metadata: { status: item.status, priority: item.priority } });
    (item.completionHistory || []).forEach((entry, index) => events.push({ id: `complete-${item._id}-${index}`, type: 'todo_completed', title: `${item.type === 'followup' ? 'Follow-up' : 'Todo'} completed`, description: entry.remarks || item.completionRemarks || item.title, actor: entry.by || item.assignedToName || 'CRM User', at: entry.at || item.completedAt || item.updatedAt }));
  });
  (lead.followUpHistory || []).forEach((item, index) => events.push({ id: `followup-${index}`, type: 'follow_up', title: 'Lead follow-up updated', description: item.remarks || item.followUpRemarks || 'Follow-up activity', actor: item.updatedBy || item.createdBy || 'CRM User', at: item.updatedAt || item.createdAt || item.date || lead.updatedAt }));
  events.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  res.json({ ok: true, lead: { leadCode: lead.leadCode, company }, events, summary: { total: events.length, quotations: quotations.length, followUps: events.filter((item) => item.type === 'follow_up').length, todos: events.filter((item) => item.type.startsWith('todo')).length } });
};

exports.bulkCreateLeads = async (req, res) => {
  const rows = Array.isArray(req.body.leads) ? req.body.leads : [];
  if (!rows.length) return res.status(400).json({ error: 'No leads provided' });

  const leads = [];
  const failures = [];
  let created = 0;
  let updated = 0;
  const staff = await User.find({ isActive: { $ne: false } }).select('_id crmUserId name email').lean();
  const staffByName = new Map(staff.map((user) => [String(user.name || '').trim().replace(/\s+/g, ' ').toLowerCase(), user]));
  const staffByIdentity = buildBulkUserIndex(staff);

  for (let index = 0; index < rows.length; index += 1) {
    try {
      const data = cleanBody(rows[index]);
      data.workflowStatus = 'draft';
      data.bulkImported = true;
      data.companyIdentity = normalizeCompanyIdentity(data.company);
      if (!data.companyIdentity) throw new Error('Company is required');
      if (data.pinCode && !/^\d{6}$/.test(String(data.pinCode))) throw new Error('PIN must contain exactly 6 digits');

      const assignedName = String(data.assignedToText || '').trim().replace(/\s+/g, ' ').toLowerCase();
      const matchedStaff = assignedName ? staffByName.get(assignedName) : null;
      if (matchedStaff) {
        data.assignedTo = matchedStaff._id;
        data.assignedToText = matchedStaff.name;
        data.assignedToEmail = matchedStaff.email || '';
      }

      const requestedCreator = String(data.importedCreatedBy || '').trim();
      const creator = requestedCreator ? resolveBulkCreator(staffByIdentity, requestedCreator) : req.user;
      if (requestedCreator && !creator) {
        throw new Error(`Created By user "${requestedCreator}" was not found or is not unique. Use the exact active CRM user name, email, or CRM User ID.`);
      }
      data.createdByCrmUserId = String(creator?._id || creator?.id || '').trim();
      data.createdByName = String(creator?.name || creator?.email || '').trim();
      data.createdByEmail = String(creator?.email || '').trim().toLowerCase();
      data.importedCreatedBy = data.createdByName;

      let lead = await Lead.findOne({ companyIdentity: data.companyIdentity });
      if (!lead) {
        const escapedCompany = String(data.company || '').trim().split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const candidates = escapedCompany ? await Lead.find({ company: { $regex: `^\\s*${escapedCompany}`, $options: 'i' } }).limit(100) : [];
        lead = candidates.find((candidate) => normalizeCompanyIdentity(candidate.company) === data.companyIdentity) || null;
      }

      if (lead) {
        lead.set(buildBulkMergeData(lead.toObject(), data, creator));
        lead.companyIdentity = data.companyIdentity;
        await lead.save();
        updated += 1;
      } else {
        lead = await createLeadRecord(buildBulkCreateData(data, creator), creator || req.user);
        created += 1;
      }
      leads.push(lead);
    } catch (err) {
      failures.push({
        row: index + 1,
        error: err.message || 'Unable to save lead'
      });
    }
  }

  res.status(failures.length && !leads.length ? 400 : 201).json({
    ok: failures.length === 0,
    imported: leads.length,
    created,
    updated,
    failed: failures.length,
    leads,
    failures
  });
};

exports.claimLeadRoyalty = async (req, res) => {
  const lookup = [{ sourceLeadId: req.params.id }];
  if (mongoose.isValidObjectId(req.params.id)) lookup.push({ _id: req.params.id });
  const lead = await Lead.findOne(combineAccessFilters(
    { $or: lookup },
    await leadAccessFilter(req.user)
  )).populate('createdBy', 'name email').lean();
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });
  const eligibility = royaltyContributorEligibility(lead, req.user);
  if (eligibility.reason === 'same-user') {
    return res.status(400).json({ error: 'Royalty cannot be claimed when the original lead and added service were created by the same user.' });
  }
  if (!eligibility.eligible) {
    return res.status(400).json({ error: 'Claim Royalty is available only after two different users contribute service rows to the same lead.' });
  }
  const financialYear = String(req.body?.financialYear || '').trim();
  const claimantTokens = royaltyIdentityTokens(req.user?._id, req.user?.id, req.user?.email, req.user?.name);
  const claimedRows = (Array.isArray(lead.serviceSelections) ? lead.serviceSelections : []).filter((row) => {
    const tokens = royaltyIdentityTokens(row?.createdByCrmUserId, row?.createdByEmail, row?.createdByName);
    return tokens.some((token) => claimantTokens.includes(token));
  });
  const servicesOffered = [...new Set(claimedRows.map((row) => String(row?.servicesOffered || '').trim()).filter(Boolean))];
  const eprCategories = [...new Set(claimedRows.map((row) => String(row?.eprCategory || '').trim()).filter(Boolean))];
  const result = await claimLeadRoyalty({ lead, claimant: req.user, financialYear, servicesOffered, eprCategories });
  if (result.expired) return res.status(400).json({ error: `The two-day correction window expired on ${String(result.correctionDeadline).slice(0, 10)}. Please contact an Admin.` });
  return res.status(result.skipped ? 200 : 201).json(result);
};

exports.requestDuplicateLeadApproval = async (req, res) => {
  try {
    const existingLeadId = String(req.body.existingLeadId || '').trim();
    const leadAssignedTo = String(req.body.leadAssignedTo || '').trim();
    const company = String(req.body.company || '').trim();
    const reason = String(req.body.reason || '').trim();
    const requesterEmail = String(req.body.requesterEmail || req.user?.email || '').trim().toLowerCase();
    const screenshotUrl = String(req.body.screenshotUrl || '').trim();
    const candidateUsers = Array.isArray(req.body.candidateUsers) ? req.body.candidateUsers.slice(0, 10).map((item) => ({ id: String(item?.id || '').trim(), name: String(item?.name || '').trim() })).filter((item) => item.id && item.name) : [];
    if (!existingLeadId || !company) return res.status(400).json({ error: 'Existing lead and company are required.' });
    if (reason.length < 10) return res.status(400).json({ error: 'Please enter a reason of at least 10 characters.' });
    const requestedById = String(req.user?._id || req.user?.id || '');
    if (requestedById && !candidateUsers.some((item) => item.id === requestedById)) candidateUsers.push({ id: requestedById, name: String(req.user?.name || req.user?.email || 'Requesting user') });
    const companyIdentity = normalizeCompanyIdentity(company);
    const sourceClientId = `${existingLeadId}:${requestedById}`;
    const now = new Date();
    const approval = await PendingApproval.findOneAndUpdate(
      { type: 'lead_duplicate', source: 'crm', sourceClientId },
      {
        $set: {
          uniqueId: `DUP-${existingLeadId}`,
          clientName: company,
          approvalStatus: 'PENDING',
          createdByName: req.user?.name || req.user?.email || 'CRM User',
          requestDate: now.toISOString().slice(0, 10),
          requestTime: now.toTimeString().slice(0, 8),
          payload: { existingLeadId, leadAssignedTo, company, companyIdentity, reason, requesterEmail, screenshotUrl, requestedById, candidateUsers },
          remarks: reason,
          actionBy: null,
          actionAt: null
        },
        $setOnInsert: { type: 'lead_duplicate', source: 'crm', sourceClientId }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    await Notification.create({
      title: 'Duplicate lead special approval requested',
      description: `${req.user?.name || requesterEmail} requested permission for ${company}.`,
      tag: 'Lead Approval',
      kind: 'lead_duplicate_approval',
      createdBy: req.user?._id,
      createdByName: req.user?.name || req.user?.email || '',
      visibleToRoles: ['admin', 'superadmin'],
      attachmentName: screenshotUrl ? 'Duplicate lead screenshot' : '',
      attachmentUrl: screenshotUrl,
      metadata: { approvalId: String(approval._id), company, existingLeadId }
    });
    const admins = await User.find({ role: { $in: ['admin', 'superadmin'] }, isActive: { $ne: false }, email: { $ne: '' } }).select('email').lean();
    const approvalHtml = `<div style="font-family:Arial,sans-serif;color:#334155"><h2 style="color:#0f766e">Special approval requested</h2><p><strong>${escapeHtml(req.user?.name || requesterEmail || 'CRM User')}</strong> requested permission to create another lead for <strong>${escapeHtml(company)}</strong>.</p><p><strong>Reason:</strong> ${escapeHtml(reason)}</p><p><strong>Requester:</strong> ${escapeHtml(requesterEmail)}</p><p>Please review this request in Pending Approval.</p></div>`;
    await Promise.allSettled(admins.map((admin) => sendMail(admin.email, `Special Approval - ${company}`, approvalHtml, { branded: false })));
    return res.status(201).json({ ok: true, approval });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to request special approval.' });
  }
};

exports.listDuplicateLeadApprovals = async (req, res) => {
  const admin = userHasAnyRole(req.user, ADMIN_ROLES);
  if (!admin && req.user?._id) {
    const legacyServiceNotifications = await Notification.find({
      kind: 'lead_additional_services',
      audience: req.user._id,
      'metadata.eventKey': { $exists: true, $ne: '' }
    }).select('metadata createdBy createdByName createdAt').populate('createdBy', 'name email').lean();
    await Promise.all(legacyServiceNotifications.map(async (notification) => {
      const metadata = notification.metadata || {};
      const eventKey = String(metadata.eventKey || '').trim();
      if (!eventKey) return null;
      const contributorId = String(notification.createdBy?._id || notification.createdBy || '');
      const contributorName = notification.createdBy?.name || metadata.actorName || notification.createdByName || 'CRM User';
      const contributorEmail = notification.createdBy?.email || metadata.contributorEmail || '';
      const approval = await PendingApproval.findOneAndUpdate(
        { type: 'lead_service', source: 'crm', sourceClientId: eventKey },
        {
          $setOnInsert: {
            type: 'lead_service',
            source: 'crm',
            sourceClientId: eventKey,
            uniqueId: `SERVICE-${metadata.leadId || notification._id}`,
            clientName: metadata.company || 'Company',
            approvalStatus: 'PENDING',
            createdByName: metadata.actorName || notification.createdByName || 'CRM User',
            requestDate: new Date(notification.createdAt || Date.now()).toISOString().slice(0, 10),
            requestTime: new Date(notification.createdAt || Date.now()).toTimeString().slice(0, 8),
            nextReminderAt: new Date(Date.now() + 10 * 60 * 1000),
            payload: {
              eventKey,
              leadId: metadata.leadId || '',
              company: metadata.company || '',
              contributorId,
              contributorName,
              contributorEmail,
              originalCreatorId: String(req.user._id),
              originalCreator: req.user.name || req.user.email || '',
              originalCreatorEmail: req.user.email || '',
              preliminaryStatus: 'PENDING',
              finalStatus: 'PENDING',
              groups: metadata.groups || []
            },
            remarks: 'Awaiting preliminary review by the original lead creator.'
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      const payload = {
        ...(approval.payload || {}),
        contributorId,
        contributorName,
        ...(contributorEmail ? { contributorEmail } : {})
      };
      await PendingApproval.updateOne({ _id: approval._id }, { $set: { payload } });
      return approval;
    }));
  }
  const query = { type: { $in: ['lead_duplicate', 'lead_royalty', 'lead_service', 'lead_temporary', 'purchase_order'] } };
  if (!admin) {
    const userId = String(req.user?._id || req.user?.id || '');
    // A service approval belongs to both people displayed in the UI: the user
    // who added the service and the original lead creator. Keep this filter in
    // the API (rather than only filtering the table) so one user cannot load
    // another user's pending-service records from the browser.
    query.$or = [
      { 'payload.requestedById': userId },
      { 'payload.claimantId': userId },
      { 'payload.contributorId': userId },
      { 'payload.originalCreatorId': userId },
      { 'payload.managerId': userId },
      { 'payload.temporaryUserId': userId }
    ];
  }
  const [activeApprovals, recentDecisions] = await Promise.all([
    PendingApproval.find({
      ...query,
      approvalStatus: { $in: ['PENDING', 'PARTIALLY_APPROVED', 'REVISION_REQUIRED'] }
    }).populate('actionBy', 'name email').sort({ createdAt: -1 }).limit(500).lean(),
    PendingApproval.find({
      ...query,
      approvalStatus: { $in: ['APPROVED', 'REJECTED'] }
    }).populate('actionBy', 'name email').sort({ actionAt: -1, createdAt: -1 }).limit(100).lean()
  ]);
  const approvals = [...activeApprovals, ...recentDecisions];
  const purchaseOrderApprovals = approvals.filter((approval) => approval.type === 'purchase_order');
  if (purchaseOrderApprovals.length) {
    const approvalLeadId = (approval) => {
      const payloadId = String(approval.payload?.leadId || '').trim();
      if (mongoose.isValidObjectId(payloadId)) return payloadId;
      const sourceId = String(approval.sourceClientId || '').split(':po:')[0].trim();
      return mongoose.isValidObjectId(sourceId) ? sourceId : '';
    };
    const leadIds = [...new Set(purchaseOrderApprovals.map(approvalLeadId).filter(Boolean))];
    const legacyLeadIds = [...new Set(purchaseOrderApprovals.map((approval) => String(approval.sourceClientId || '').split(':po:')[0].trim()).filter((value) => value && !mongoose.isValidObjectId(value)))];
    const leadCodes = [...new Set(purchaseOrderApprovals.flatMap((approval) => [approval.payload?.leadCode, approval.uniqueId]).map((value) => String(value || '').trim()).filter(Boolean))];
    const companies = [...new Set(purchaseOrderApprovals.map((approval) => String(approval.clientName || '').trim()).filter(Boolean))];
    const leadLookup = [];
    if (leadIds.length) leadLookup.push({ _id: { $in: leadIds } });
    if (legacyLeadIds.length) leadLookup.push({ sourceLeadId: { $in: legacyLeadIds } });
    if (leadCodes.length) leadLookup.push({ leadCode: { $in: leadCodes } });
    if (companies.length) leadLookup.push(...companies.map((company) => ({ company: { $regex: `^${escapeRegex(company)}$`, $options: 'i' } })));
    const leads = leadLookup.length ? await Lead.find({ $or: leadLookup }).populate('createdBy', 'name email').lean() : [];
    const leadById = new Map(leads.map((lead) => [String(lead._id), lead]));
    const leadByCode = new Map(leads.map((lead) => [String(lead.leadCode || '').toLowerCase(), lead]).filter(([code]) => code));
    const leadByCompany = new Map(leads.map((lead) => [String(lead.company || '').toLowerCase(), lead]).filter(([company]) => company));
    const leadBySourceId = new Map(leads.map((lead) => [String(lead.sourceLeadId || ''), lead]).filter(([id]) => id));
    const matchedLeadCodes = leads.map((lead) => lead.leadCode).filter(Boolean);
    const quotations = await Quotation.find({ $or: [
      { leadRef: { $in: leadIds } }, { leadId: { $in: leadIds } },
      { leadCode: { $in: matchedLeadCodes } }, { businessLeadCode: { $in: matchedLeadCodes } }
    ] }).lean();
    const quoteForRow = (row, lead) => quotations.find((quote) => String(quote._id) === String(row.quotationId || ''))
      || quotations.find((quote) => quote.quotationNumber && quote.quotationNumber === row.quotationNumber)
      || quotations.find((quote) => [quote.leadRef, quote.leadId, quote.leadCode, quote.businessLeadCode].some((value) => [String(lead._id), lead.leadCode].includes(String(value || ''))));
    purchaseOrderApprovals.forEach((approval) => {
      const payload = approval.payload || {};
      const snapshotRows = (Array.isArray(payload.poYearRows) ? payload.poYearRows
        : Array.isArray(payload.poRows) ? payload.poRows
          : Array.isArray(payload.purchaseOrders) ? payload.purchaseOrders : []);
      const lead = leadById.get(approvalLeadId(approval))
        || leadBySourceId.get(String(approval.sourceClientId || '').split(':po:')[0].trim())
        || leadByCode.get(String(payload.leadCode || approval.uniqueId || '').toLowerCase())
        || leadByCompany.get(String(approval.clientName || '').toLowerCase());
      approval.poDebug = {
        approvalRows: snapshotRows.length,
        leadMatched: Boolean(lead),
        assignmentMatched: false,
        leadRows: 0,
        quotationMatched: false,
        lookup: approvalLeadId(approval) ? 'object-id' : (String(approval.sourceClientId || '').split(':po:')[0] || 'company')
      };
      if (!lead) return;
      const assignmentIndex = Number(payload.assignmentIndex);
      const assignments = Array.isArray(lead.assignments) ? lead.assignments : [];
      const assignment = (Number.isInteger(assignmentIndex) && assignments[assignmentIndex]?.poYearRows?.length ? assignments[assignmentIndex] : null)
        || assignments.find((row) => payload.assignedServiceId && String(row.assignedServiceId || '') === String(payload.assignedServiceId) && row.poYearRows?.length)
        || assignments.find((row) => Array.isArray(row.poYearRows) && row.poYearRows.length)
        || null;
      const liveRows = Array.isArray(assignment?.poYearRows) ? assignment.poYearRows
        : Array.isArray(assignment?.poRows) ? assignment.poRows
          : Array.isArray(assignment?.purchaseOrders) ? assignment.purchaseOrders : [];
      const poYearRows = (liveRows.length ? liveRows : snapshotRows).map((liveRow, rowIndex) => {
        const snapshot = snapshotRows.find((row) => row && liveRow?.poNumber && row.poNumber === liveRow.poNumber)
                      || snapshotRows[rowIndex]
                      || {};
        const row = { ...snapshot, ...liveRow };
        const quotation = quoteForRow(row, lead);
        const poAmount = Number(liveRow.poAmount) > 0 ? Number(liveRow.poAmount)
          : Number(snapshot.poAmount) > 0 ? Number(snapshot.poAmount)
            : Number(quotation?.grandTotal) || null;
        const normalizedProof = resolveApprovalPoProof({ approval, normalizedRow: { ...snapshot, ...liveRow }, rowIndex });
        const savedQuotationItems = Array.isArray(liveRow.quotationItems) && liveRow.quotationItems.length
          ? liveRow.quotationItems
          : Array.isArray(snapshot.quotationItems) && snapshot.quotationItems.length ? snapshot.quotationItems : [];
        return {
          ...row,
          poAmount,
          poFileUrl: normalizedProof.poFileUrl || row.poFileUrl || snapshot.poFileUrl || liveRow.poFileUrl || '',
          poFileName: normalizedProof.poFileName || row.poFileName || snapshot.poFileName || liveRow.poFileName || '',
          ...normalizedProof,
          currency: row.currency || 'INR',
          quotationId: row.quotationId || (quotation?._id ? String(quotation._id) : ''),
          quotationNumber: row.quotationNumber || quotation?.quotationNumber || '',
          quotationItems: savedQuotationItems.length ? savedQuotationItems : (quotation?.items || []),
          quotationBasicAmount: Number(quotation?.combinedBasicAmount) || Number(quotation?.subtotal) || Number(quotation?.grandTotal) || null,
          poFileMimeType: normalizedProof.poFileMimeType || row.poFileMimeType || snapshot.poFileMimeType || liveRow.poFileMimeType || '',
          poFileSize: normalizedProof.poFileSize ?? row.poFileSize ?? snapshot.poFileSize ?? liveRow.poFileSize ?? null
        };
      });
      const resolvedIndex = assignments.indexOf(assignment);
      approval.poDebug = {
        ...approval.poDebug,
        assignmentMatched: Boolean(assignment),
        leadRows: liveRows.length,
        quotationMatched: poYearRows.some((row) => Boolean(row.quotationId || row.quotationNumber || row.quotationItems?.length))
      };
      const service = (lead.serviceSelections || []).find((row) => payload.assignedServiceId && String(row.assignedServiceId || '') === String(payload.assignedServiceId))
        || lead.serviceSelections?.[resolvedIndex >= 0 ? resolvedIndex : assignmentIndex]
        || payload.service
        || {};
      approval.payload = {
        ...payload,
        leadId: payload.leadId || String(lead._id),
        leadCode: payload.leadCode || lead.leadCode || '',
        service,
        poYearRows,
        leadCreatorId: payload.leadCreatorId || String(lead.createdBy?._id || lead.createdBy || ''),
        leadCreatorEmail: payload.leadCreatorEmail || lead.createdBy?.email || lead.createdByEmail || ''
      };
    });
  }
  res.json({ ok: true, approvals, poStorage: {
    binaryStore: 'Cloudinary: crm/leads/purchase-orders',
    leadCollection: Lead.collection.collectionName,
    leadPath: 'assignments[].poYearRows[].poFileUrl',
    approvalCollection: PendingApproval.collection.collectionName,
    approvalPaths: ['payload.poYearRows[].poFileUrl', 'payload.poProofManifest[].poFileUrl']
  } });
};

exports.updateDuplicateLeadApproval = async (req, res) => {
  const status = String(req.body.status || '').toUpperCase();
  if (!['APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'Status must be APPROVED or REJECTED.' });
  const current = await PendingApproval.findOne({ _id: req.params.id, type: { $in: ['lead_duplicate', 'lead_royalty', 'lead_service'] } }).lean();
  if (!current) return res.status(404).json({ error: 'Lead approval request not found.' });
  const isAdmin = userHasAnyRole(req.user, ADMIN_ROLES);
  const userId = String(req.user?._id || req.user?.id || '');
  if (current.type !== 'lead_service' && !isAdmin) return res.status(403).json({ error: 'Admin access is required.' });
  if (current.type === 'lead_service') {
    const isCreator = userId && userId === String(current.payload?.originalCreatorId || '');
    if (!isAdmin && !isCreator) return res.status(403).json({ error: 'Only the original lead creator or an Admin can review this request.' });
    const payload = { ...(current.payload || {}) };
    const actorName = req.user?.name || req.user?.email || (isAdmin ? 'Admin' : 'Original lead creator');
    const decisionReason = String(req.body.remarks || '').trim();
    if (status === 'REJECTED' && !decisionReason) {
      return res.status(400).json({ error: 'A rejection reason is required.' });
    }
    if (isAdmin) {
      if (!['APPROVED', 'REJECTED'].includes(String(payload.preliminaryStatus || '').toUpperCase())) {
        return res.status(409).json({ error: 'The original lead creator must complete the preliminary review before final Admin action.' });
      }
      payload.finalStatus = status;
      payload.finalActionBy = actorName;
      payload.finalActionAt = new Date();
      payload.finalReason = decisionReason;
    } else {
      payload.preliminaryStatus = status;
      payload.preliminaryActionBy = actorName;
      payload.preliminaryActionAt = new Date();
      payload.preliminaryReason = decisionReason;
    }
    const approval = await PendingApproval.findOneAndUpdate(
      { _id: req.params.id },
      { $set: {
        payload,
        ...(isAdmin ? { approvalStatus: status } : {}),
        ...(!isAdmin ? { nextReminderAt: null } : {}),
        actionBy: req.user?._id,
        actionAt: new Date(),
        remarks: isAdmin
          ? `Final ${status.toLowerCase()} by ${actorName}${decisionReason ? `: ${decisionReason}` : ''}`
          : `Preliminary ${status.toLowerCase()} by ${actorName}${decisionReason ? `: ${decisionReason}` : ''}; awaiting final Admin review.`
      } },
      { new: true }
    );
    const admins = await User.find({ role: { $in: ADMIN_ROLES }, isActive: { $ne: false } }).select('email').lean();
    const emails = [
      approval.payload?.originalCreatorEmail,
      approval.payload?.contributorEmail,
      ...admins.map((admin) => admin.email)
    ].map((email) => String(email || '').trim()).filter((email, index, rows) => email && rows.indexOf(email) === index);
    const stage = isAdmin ? 'Final Legal Review' : 'Preliminary Review';
    const decisionRows = `<tr><td style="padding:10px;font-weight:700">Original Creator Decision</td><td style="padding:10px">${escapeHtml(payload.preliminaryStatus || 'PENDING')}</td></tr>
      <tr><td style="padding:10px;font-weight:700">Creator Reason</td><td style="padding:10px">${escapeHtml(payload.preliminaryReason || '-')}</td></tr>
      <tr><td style="padding:10px;font-weight:700">Final Admin Decision</td><td style="padding:10px">${escapeHtml(payload.finalStatus || 'PENDING')}</td></tr>
      <tr><td style="padding:10px;font-weight:700">Final Admin Reason</td><td style="padding:10px">${escapeHtml(payload.finalReason || '-')}</td></tr>`;
    const preliminaryNote = '<div style="margin:20px 0;padding:14px 16px;background:#fff7ed;border-left:4px solid #f97316;border-radius:6px;color:#9a3412"><strong>This is a preliminary decision made by the assigned user. The final approval authority rests with the Admin/Super Admin.</strong></div>';
    const html = `<div style="max-width:680px;font-family:Arial,sans-serif;color:#334155;line-height:1.6">
      <h2 style="color:${status === 'REJECTED' ? '#b91c1c' : '#0f766e'}">${escapeHtml(stage)}: ${escapeHtml(status)}</h2>
      <p>The additional service request for <strong>${escapeHtml(approval.clientName)}</strong> has been <strong>${status.toLowerCase()}</strong> by <strong>${escapeHtml(actorName)}</strong>.</p>
      ${decisionReason ? `<p><strong>Reason:</strong><br>${escapeHtml(decisionReason)}</p>` : ''}
      ${!isAdmin ? preliminaryNote : '<div style="margin:20px 0;padding:14px 16px;background:#ecfdf5;border-left:4px solid #059669;border-radius:6px;color:#065f46"><strong>This is the final decision recorded by the Admin/Super Admin.</strong></div>'}
      <table style="width:100%;margin-top:18px;border-collapse:collapse;border:1px solid #e2e8f0">${decisionRows}</table>
      <p style="margin-top:24px"><strong>Thanks &amp; Regards,</strong><br><strong>Team Ananttattva</strong></p>
    </div>`;
    const subject = isAdmin
      ? `Final Service Request ${status} - ${approval.clientName}`
      : `Preliminary Service Request ${status} - ${approval.clientName}`;
    await Promise.allSettled(emails.map((email) => sendMail(email, subject, html, { branded: false })));
    return res.json({ ok: true, approval });
  }
  const selectedUserId = String(req.body.selectedUserId || '').trim();
  const claimantRatio = Number(req.body.claimantRatio);
  const originalCreatorRatio = Number(req.body.originalCreatorRatio);
  if (current.type === 'lead_duplicate' && status === 'APPROVED' && !selectedUserId) return res.status(400).json({ error: 'Select the user who will own the approved lead.' });
  if (current.type === 'lead_royalty' && status === 'APPROVED' && (!Number.isFinite(claimantRatio) || !Number.isFinite(originalCreatorRatio) || claimantRatio < 0 || originalCreatorRatio < 0 || claimantRatio + originalCreatorRatio !== 100)) {
    return res.status(400).json({ error: 'Enter valid royalty ratios totaling exactly 100%.' });
  }
  const payload = {
    ...(current.payload || {}),
    ...(selectedUserId ? { selectedUserId } : {}),
    ...(current.type === 'lead_royalty' && status === 'APPROVED' ? { claimantRatio, originalCreatorRatio } : {})
  };
  const approval = await PendingApproval.findOneAndUpdate(
    { _id: req.params.id },
    { $set: { approvalStatus: status, payload, actionBy: req.user?._id, actionAt: new Date(), remarks: String(req.body.remarks || `${status} by ${req.user?.name || req.user?.email || 'admin'}`).trim() } },
    { new: true }
  );
  if (!approval) return res.status(404).json({ error: 'Lead approval request not found.' });
  const requesterId = approval.payload?.requestedById;
  const resultAudience = [requesterId, approval.payload?.originalCreatorId].filter((id, index, rows) => mongoose.isValidObjectId(id) && rows.indexOf(id) === index);
  await Notification.create({
    title: `${approval.type === 'lead_royalty' ? 'Royalty claim' : 'Duplicate lead request'} ${status.toLowerCase()}`,
    description: `${approval.clientName} was ${status.toLowerCase()} by ${req.user?.name || req.user?.email || 'Admin'}${approval.type === 'lead_royalty' && status === 'APPROVED' ? `. Royalty split: ${claimantRatio}% / ${originalCreatorRatio}%.` : ''}`,
    tag: 'Lead Approval',
    kind: approval.type === 'lead_royalty' ? 'lead_royalty_claim_result' : 'lead_duplicate_approval_result',
    createdBy: req.user?._id,
    createdByName: req.user?.name || req.user?.email || '',
    audience: resultAudience,
    metadata: { approvalId: String(approval._id), company: approval.clientName, status, selectedUserId, claimantRatio, originalCreatorRatio }
  });
  const resultEmails = [approval.payload?.requesterEmail, approval.payload?.claimantEmail, approval.payload?.originalCreatorEmail].map((value) => String(value || '').trim()).filter((value, index, rows) => value && rows.indexOf(value) === index);
  if (resultEmails.length) {
    const detail = approval.type === 'lead_royalty' && status === 'APPROVED'
      ? `<p><strong>Royalty ratio:</strong> ${claimantRatio}% claimant / ${originalCreatorRatio}% original creator</p>`
      : selectedUserId ? `<p><strong>Selected lead owner:</strong> ${selectedUserId}</p>` : '';
    await Promise.allSettled(resultEmails.map((email) => sendMail(email, `${approval.type === 'lead_royalty' ? 'Royalty Claim' : 'Special Approval'} ${status} - ${approval.clientName}`, `<div style="font-family:Arial,sans-serif;color:#334155"><h2 style="color:#0f766e">${status === 'APPROVED' ? 'Request approved' : 'Request rejected'}</h2><p>Your request for <strong>${escapeHtml(approval.clientName)}</strong> was ${status.toLowerCase()}.</p>${detail}<p>Please review the CRM Notification Center for complete details.</p></div>`, { branded: false })));
  }
  return res.json({ ok: true, approval });
};

exports._test = {
  usesDirectApplicantType,
  primaryServiceCategory,
  shouldValidatePiboSelection,
  cleanBody,
  validateSubmittedLead,
  isAssignmentOnlyLeadUpdate,
  bulkServiceRow,
  normalizeLegacyBulkServices,
  alignBulkAssignments,
  buildBulkCreateData,
  buildBulkMergeData,
  buildBulkUserIndex,
  resolveBulkCreator,
  changedFollowUpIndexes,
  validateServiceRemovalPermission,
  stableUserIdentity,
  canAssignStaffToRow,
  activeUserLookup,
  leadCodeSequence,
  poClosureSubmissionChanged,
  canDirectlyApprovePoEdit,
  upsertPurchaseOrderApprovals
};

const LeadServiceCatalog = require('../models/LeadServiceCatalog');

function cleanCatalogValue(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

exports.listServiceCatalog = async (req, res) => {
  const entries = await LeadServiceCatalog.find().sort({ category: 1 }).lean();
  return res.json({ catalog: entries.map((entry) => ({
    category: entry.category,
    servicesOffered: [...(entry.servicesOffered || [])].sort((a, b) => a.localeCompare(b))
  })) });
};

exports.createServiceCatalogCategory = async (req, res) => {
  const category = cleanCatalogValue(req.body.category);
  if (!category) return res.status(400).json({ error: 'Service Category is required.' });
  if (category.length > 100) return res.status(400).json({ error: 'Service Category must be 100 characters or fewer.' });
  try {
    const entry = await LeadServiceCatalog.create({
      category,
      normalizedCategory: category.toLowerCase(),
      servicesOffered: [],
      createdBy: req.user?._id,
      updatedBy: req.user?._id
    });
    return res.status(201).json({ catalog: { category: entry.category, servicesOffered: [] } });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'This Service Category already exists.' });
    throw error;
  }
};

exports.addServiceCatalogOffering = async (req, res) => {
  const category = cleanCatalogValue(req.params.category);
  const requestedServices = (Array.isArray(req.body.services) ? req.body.services : [req.body.service])
    .map(cleanCatalogValue)
    .filter(Boolean);
  const uniqueServices = [...new Map(requestedServices.map((service) => [service.toLowerCase(), service])).values()];
  if (!uniqueServices.length) return res.status(400).json({ error: 'At least one Services Offered value is required.' });
  if (uniqueServices.some((service) => service.length > 100)) return res.status(400).json({ error: 'Each Services Offered value must be 100 characters or fewer.' });
  const entry = await LeadServiceCatalog.findOne({ normalizedCategory: category.toLowerCase() });
  if (!entry) return res.status(404).json({ error: 'Service Category was not found.' });
  const existing = new Set(entry.servicesOffered.map((value) => value.toLowerCase()));
  const servicesToAdd = uniqueServices.filter((service) => !existing.has(service.toLowerCase()));
  if (!servicesToAdd.length) return res.status(409).json({ error: 'All entered Services Offered values already exist in the selected category.' });
  entry.servicesOffered.push(...servicesToAdd);
  entry.updatedBy = req.user?._id;
  await entry.save();
  return res.status(201).json({ catalog: { category: entry.category, servicesOffered: entry.servicesOffered }, addedServices: servicesToAdd });
};

exports.uploadPurchaseOrderProof = async (req, res) => {
  const poDebugId = String(req.get('x-po-debug-id') || '').trim().slice(0, 100);
  const approval = await PendingApproval.findOne({ _id: req.params.id, type: 'purchase_order' });
  if (!approval) return res.status(404).json({ error: 'Purchase Order approval not found.' });
  const poFileUrl = String(req.body.poFileUrl || '').trim();
  const poFileName = String(req.body.poFileName || 'PO proof').trim();
  const poFileMimeType = String(req.body.poFileMimeType || '').trim();
  const poFileSize = Number.isFinite(Number(req.body.poFileSize)) ? Number(req.body.poFileSize) : null;
  const rowIndex = Math.max(0, Number.parseInt(req.body.rowIndex, 10) || 0);
  if (!/^https:\/\//i.test(poFileUrl)) return res.status(400).json({ error: 'A valid uploaded PO proof URL is required.' });
  console.info('[POProof:repair:received]', { poDebugId, approvalId: req.params.id, rowIndex, hasPoFileUrl: Boolean(poFileUrl), poFileName, poFileSize });
  const payload = approval.payload || {};
  const snapshotRows = Array.isArray(payload.poYearRows) && payload.poYearRows.length ? payload.poYearRows
    : Array.isArray(payload.poRows) && payload.poRows.length ? payload.poRows
      : Array.isArray(payload.purchaseOrders) ? payload.purchaseOrders : [];
  while (snapshotRows.length <= rowIndex) snapshotRows.push({});
  snapshotRows[rowIndex] = { ...snapshotRows[rowIndex], poFileUrl, poFileName, poFileMimeType, poFileSize };
  const poProofManifest = Array.isArray(payload.poProofManifest) ? [...payload.poProofManifest] : [];
  while (poProofManifest.length <= rowIndex) poProofManifest.push({});
  poProofManifest[rowIndex] = { ...poProofManifest[rowIndex], rowIndex, poNumber: snapshotRows[rowIndex].poNumber || '', poFileUrl, poFileName, poFileMimeType, poFileSize };
  approval.payload = { ...payload, poYearRows: snapshotRows, poProofManifest };
  approval.markModified('payload');
  await approval.save();
  const leadId = String(payload.leadId || approval.sourceClientId || '').split(':po:')[0].trim();
  const lead = mongoose.isValidObjectId(leadId) ? await Lead.findById(leadId) : await Lead.findOne({ $or: [{ sourceLeadId: leadId }, { leadCode: payload.leadCode || approval.uniqueId }] });
  if (lead) {
    const assignmentIndex = Number(payload.assignmentIndex);
    const assignment = (Number.isInteger(assignmentIndex) ? lead.assignments?.[assignmentIndex] : null)
      || lead.assignments?.find((row) => payload.assignedServiceId && String(row.assignedServiceId || '') === String(payload.assignedServiceId));
    if (assignment) {
      if (!Array.isArray(assignment.poYearRows)) assignment.poYearRows = [];
      while (assignment.poYearRows.length <= rowIndex) assignment.poYearRows.push({});
      assignment.poYearRows[rowIndex] = { ...assignment.poYearRows[rowIndex], poFileUrl, poFileName, poFileMimeType, poFileSize };
      lead.markModified('assignments');
      await lead.save();
      console.info('[POProof:repair:lead-persisted]', { poDebugId, approvalId: req.params.id, leadId: String(lead._id), leadCode: lead.leadCode || '', assignmentIndex, rowIndex, collection: Lead.collection.collectionName });
    }
  }
  console.info('[POProof:repair:approval-persisted]', { poDebugId, approvalId: String(approval._id), rowIndex, collection: PendingApproval.collection.collectionName, hasPoFileUrl: Boolean(approval.payload?.poYearRows?.[rowIndex]?.poFileUrl) });
  res.json({ ok: true, approval, leadUpdated: Boolean(lead) });
};

// Shared only with the temporary-lead conversion controller so conversion
// follows the exact same lead-code and ownership rules as Add Lead.
exports.createLeadRecordInternal = createLeadRecord;
exports.buildAppendOnlyServicePatchInternal = buildAppendOnlyServicePatch;

// Review the persisted submission snapshot before an administrator decides a PO.
exports.getPurchaseOrderApproval = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid PO approval ID.' });
  try {
    const approval = await PendingApproval.findOne({ _id: req.params.id, type: 'purchase_order' }).lean();
    if (!approval) return res.status(404).json({ error: 'PO approval not found.' });
    return res.json({ ok: true, approval });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load submitted PO details. Please retry.' });
  }
};
