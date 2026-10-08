const { directQuotationApproval } = require('../services/directQuotationApproval');
const Quotation = require('../models/Quotation');
const mongoose = require('mongoose');
const ProformaInvoice = require('../models/ProformaInvoice');
const PendingApproval = require('../models/PendingApproval');
const QuotationServiceCategory = require('../models/QuotationServiceCategory');
const QuotationPiboCategory = require('../models/QuotationPiboCategory');
const QuotationDropdownOption = require('../models/QuotationDropdownOption');
const LeadDropdownOption = require('../models/LeadDropdownOption');
const { resolveCrmRelationships } = require('../services/crmRelationships');
const Lead = require('../models/Lead');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { sendQuotationLifecycleEmail } = require('../services/quotationLifecycleEmails');
const { getVisibleUserScope, ownerFilter } = require('../utils/visibilityScope');
const { userHasAnyRole } = require('../utils/userRoles');
const {
  BUILT_IN_SERVICE_CATEGORIES,
  normalizeServiceCategoryName
} = require('../constants/quotationServiceCategories');
const {
  PIBO_PARENTS,
  BUILT_IN_PIBO_CATEGORIES,
  cleanCategoryName,
  normalizeParent,
  normalizedCategoryName,
  inferPiboParent,
  validatePiboSelection
} = require('../utils/piboCategories');
const {
  datesFromAnnualYears,
  normalizeDateOnly,
  normalizePeriodUnit,
  serviceEndDateFrom,
  validateServicePeriod
} = require('../utils/servicePeriod');
const {
  getAdminCreatedLeadReferences,
  dashboardQuotationExclusionFilter
} = require('../services/dashboardTestLeadExclusion');

function normalizeApprovalStatus(value) {
  const status = String(value || '').trim().toUpperCase();
  return ['PENDING', 'APPROVED', 'REJECTED'].includes(status) ? status : '';
}

const LEAD_DETAIL_FIELDS = [
  'referredBy',
  'salutation',
  'contactPerson',
  'designation',
  'mobileNo1',
  'mobileNo2',
  'companyName',
  'addressLine1',
  'addressLine2',
  'addressLine3',
  'state',
  'city',
  'pinCode',
  'gstNumber'
];

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function cleanString(value) {
  return String(value || '').trim();
}

function isQuotationAdmin(user) {
  return ['admin', 'superadmin'].includes(cleanString(user?.role).toLowerCase());
}

async function quotationAccessFilter(user) {
  const scope = await getVisibleUserScope(user);
  if (scope === null) return {};
  if (!scope.ids.length && !scope.identities.length) return { _id: { $exists: false } };
  const leads = await Lead.find(ownerFilter(scope, 'createdBy', 'assignedTo', [
    'createdByCrmUserId', 'createdByEmail', 'createdByName', 'importedCreatedBy',
    'generatedForName', 'generatedForEmail', 'assignedToText', 'assignedStaffText',
    'assignedStaffEmail', 'assignments.assignedToText', 'assignments.assignedToEmail',
    'assignments.assignedStaffText', 'assignments.assignedStaffEmail',
    'serviceSelections.createdByCrmUserId', 'serviceSelections.createdByEmail',
    'serviceSelections.createdByName'
  ], [
    'generatedForUser', 'assignedStaff', 'assignments.assignedTo', 'assignments.assignedStaff'
  ])).select('_id leadCode sourceLeadId externalLeadId').lean();
  const leadObjectIds = leads.map((lead) => lead._id);
  const leadIdentifiers = [...new Set(leads.flatMap((lead) => [
    String(lead._id), lead.leadCode, lead.sourceLeadId, lead.externalLeadId
  ]).map(cleanString).filter(Boolean))];

  return {
    $or: [
      { createdBy: { $in: scope.ids } },
      ...(leadObjectIds.length ? [{ leadRef: { $in: leadObjectIds } }] : []),
      ...(leadIdentifiers.length ? [
        { leadId: { $in: leadIdentifiers } },
        { leadCode: { $in: leadIdentifiers } },
        { businessLeadCode: { $in: leadIdentifiers } }
      ] : [])
    ]
  };
}

function combineFilters(...filters) {
  const active = filters.filter((filter) => filter && Object.keys(filter).length);
  return active.length > 1 ? { $and: active } : active[0] || {};
}

async function ensureBuiltInServiceCategories() {
  if (!BUILT_IN_SERVICE_CATEGORIES.length) return;
  await QuotationServiceCategory.bulkWrite(
    BUILT_IN_SERVICE_CATEGORIES.map((name) => ({
      updateOne: {
        filter: { name },
        update: { $setOnInsert: { name } },
        upsert: true
      }
    })),
    { ordered: false }
  );
}

function cleanLeadDetails(value = {}) {
  return LEAD_DETAIL_FIELDS.reduce((data, field) => {
    data[field] = field === 'gstNumber' ? cleanString(value[field]).toUpperCase() : cleanString(value[field]);
    return data;
  }, {});
}

const CURRENT_LEAD_DETAIL_FIELDS = {
  referredBy: 'referredBy',
  salutation: 'salutation',
  contactPerson: 'contactPerson',
  designation: 'designation',
  mobileNo1: 'mobileNo1',
  mobileNo2: 'mobileNo2',
  companyName: 'company',
  addressLine1: 'addressLine1',
  addressLine2: 'addressLine2',
  addressLine3: 'addressLine3',
  state: 'state',
  city: 'city',
  pinCode: 'pinCode'
};

function mergeCurrentLeadDetails(data, lead) {
  if (!lead) return data;
  const leadDetails = { ...(data.leadDetails || {}) };
  Object.entries(CURRENT_LEAD_DETAIL_FIELDS).forEach(([quotationField, leadField]) => {
    leadDetails[quotationField] = cleanString(lead[leadField]);
  });
  const cleanedDetails = cleanLeadDetails(leadDetails);
  return {
    ...data,
    leadId: data.leadId || String(lead._id || ''),
    leadCode: cleanString(lead.leadCode) || data.leadCode,
    companyName: cleanedDetails.companyName,
    leadDetails: cleanedDetails
  };
}

async function refreshQuotationLeadDetails(data, existingQuotation = null, user = null) {
  const filters = [];
  const identities = [
    existingQuotation?.leadRef,
    data.leadId,
    data.leadCode,
    existingQuotation?.leadId,
    existingQuotation?.leadCode
  ].map(cleanString).filter(Boolean);

  identities.forEach((identity) => {
    if (mongoose.Types.ObjectId.isValid(identity)) filters.push({ _id: identity });
    filters.push({ leadCode: identity }, { sourceLeadId: identity }, { externalLeadId: identity });
  });
  if (!filters.length) return data;
  const lead = await Lead.findOne(combineFilters(
    { $or: filters },
    ownerFilter(await getVisibleUserScope(user), 'createdBy', 'assignedTo', [
      'createdByCrmUserId', 'createdByEmail', 'createdByName', 'assignedToText',
      'assignedStaffText', 'assignedStaffEmail', 'assignments.assignedToText',
      'assignments.assignedToEmail', 'serviceSelections.createdByCrmUserId',
      'serviceSelections.createdByEmail', 'serviceSelections.createdByName'
    ], ['assignedStaff', 'assignments.assignedTo', 'assignments.assignedStaff'])
  )).lean();
  if (!lead) {
    const error = new Error('Lead not found or not accessible.');
    error.statusCode = 404;
    throw error;
  }
  return mergeCurrentLeadDetails(data, lead);
}

function validateGstNumber(value) {
  const gstNumber = cleanString(value).toUpperCase();
  if (!gstNumber) return '';
  if (gstNumber.length !== 15) return 'GST Number must contain exactly 15 characters';
  if (!GSTIN_PATTERN.test(gstNumber)) return 'Enter a valid 15-character GST Number';
  return '';
}

function roundMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round((amount + Number.EPSILON) * 100) / 100 : 0;
}

function financialYearFromDate(value) {
  const normalized = normalizeDateOnly(value);
  if (!normalized) return '';
  const year = Number(normalized.slice(0, 4));
  const month = Number(normalized.slice(5, 7));
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

const EPR_CREDIT_YEAR_OPTIONS = new Set(['2022-23', '2023-24', '2024-25', '2025-26', '2026-27', '2027-28', '2028-29', '2029-30']);

function isPwpEprCreditItem(item = {}) {
  const businessCategory = cleanString(item.businessCategory).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const applicantType = cleanString(item.subApplicantType || item.piboCategory || item.applicantType).toLowerCase();
  return businessCategory === 'eprcredit' && applicantType === 'pwp';
}

function isMeaningfulItem(item = {}) {
  return [
    item.industryType,
    item.serviceCategory,
    item.serviceStartDate,
    item.serviceEndDate,
    item.servicesForYear,
    item.eprCategory,
    item.businessCategory,
    item.piboCategory
  ].some((value) => cleanString(value))
    || Number(item.basicAmount) > 0;
}

function cleanItems(items, user = null, existingItems = [], systemStartDate = '') {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => {
      const matchedExistingItem = existingItems.find((row) => item?.id && String(row?.id || '') === String(item.id)) || existingItems[index];
      const existingItem = matchedExistingItem || {};
      const rawBusinessCategory = cleanString(item.businessCategory) || cleanString(existingItem.businessCategory) || undefined;
      const isEprCredit = String(rawBusinessCategory || '').toLowerCase().replace(/[^a-z0-9]+/g, '') === 'eprcredit';
      const businessCategory = isEprCredit ? 'EPR Credit' : rawBusinessCategory;
      let periodUnit;
      let servicePeriod;
      try {
        if (isEprCredit) {
          periodUnit = 'annual';
          servicePeriod = 0;
        } else {
        periodUnit = normalizePeriodUnit(item.periodUnit ?? existingItem.periodUnit, { allowMissing: Boolean(matchedExistingItem) });
        const rawPeriod = item.servicePeriod ?? existingItem.servicePeriod;
        if (rawPeriod === '' || rawPeriod === null || rawPeriod === undefined) throw new Error('Service Period is required.');
        servicePeriod = validateServicePeriod(rawPeriod, periodUnit);
        }
      } catch (error) {
        throw new Error(`Quotation item ${index + 1}: ${error.message}`);
      }
      const rawTransitionPeriod = String(item.transitionPeriod ?? existingItem.transitionPeriod ?? 'No').trim();
      if (!['Yes', 'No'].includes(rawTransitionPeriod)) {
        throw new Error(`Quotation item ${index + 1}: Transition Period must be Yes or No.`);
      }
      const transitionPeriod = rawTransitionPeriod;
      const unitLabel = cleanString(item.unitLabel ?? existingItem.unitLabel).toUpperCase();
      const rawEprCreditYears = Array.isArray(item.annualReturnEprCreditYears)
        ? item.annualReturnEprCreditYears
        : (Array.isArray(existingItem.annualReturnEprCreditYears) ? existingItem.annualReturnEprCreditYears : []);
      const annualReturnEprCreditYears = [...new Set(rawEprCreditYears.map(cleanString).filter(Boolean))];
      if (isEprCredit && annualReturnEprCreditYears.some((year) => !EPR_CREDIT_YEAR_OPTIONS.has(year))) {
        throw new Error(`Quotation item ${index + 1}: Annual Return EPR Credit Years contains an unsupported financial year.`);
      }
      if (isEprCredit && !['KG', 'MT'].includes(unitLabel)) {
        throw new Error(`Quotation item ${index + 1}: UOM must be KG or MT for EPR Credit.`);
      }
      const pwpEprCredit = isPwpEprCreditItem({ ...existingItem, ...item, businessCategory });
      if (isEprCredit && !pwpEprCredit && !annualReturnEprCreditYears.length) {
        throw new Error(`Quotation item ${index + 1}: select at least one Annual Return EPR Credit Year.`);
      }
      const annualReturnYears = [...new Set((Array.isArray(item.annualReturnYears) ? item.annualReturnYears : []).map(cleanString).filter(Boolean))];
      const existingTransitionIsFrozen = !isEprCredit && transitionPeriod === 'Yes' && String(existingItem.transitionPeriod || '') === 'Yes';
      if (existingTransitionIsFrozen && (
        periodUnit !== normalizePeriodUnit(existingItem.periodUnit, { allowMissing: true })
        || servicePeriod !== validateServicePeriod(existingItem.servicePeriod || 1, normalizePeriodUnit(existingItem.periodUnit, { allowMissing: true }))
      )) {
        throw new Error(`Quotation item ${index + 1}: Service Period and Select Period are read-only while Transition Period is Yes.`);
      }
      let serviceStartDate = isEprCredit ? '' : existingTransitionIsFrozen
        ? normalizeDateOnly(existingItem.serviceStartDate)
        : normalizeDateOnly(item.serviceStartDate || existingItem.serviceStartDate);
      let serviceEndDate = '';
      if (isEprCredit) {
        serviceEndDate = '';
      } else if (transitionPeriod === 'Yes') {
        if (existingTransitionIsFrozen) {
          serviceEndDate = normalizeDateOnly(existingItem.serviceEndDate);
        } else {
          const transitionDates = datesFromAnnualYears(annualReturnYears);
          serviceStartDate = transitionDates.serviceStartDate || serviceStartDate || normalizeDateOnly(systemStartDate) || new Date().toISOString().slice(0, 10);
          serviceEndDate = transitionDates.serviceEndDate || serviceEndDateFrom(serviceStartDate, servicePeriod, periodUnit);
        }
      } else {
        serviceEndDate = serviceEndDateFrom(serviceStartDate, servicePeriod, periodUnit);
      }
      return {
        id: cleanString(item.id),
        assignedServiceId: cleanString(item.assignedServiceId) || cleanString(existingItem.assignedServiceId),
        sourceServiceIndex: Number.isInteger(Number(item.sourceServiceIndex)) && Number(item.sourceServiceIndex) >= 0
          ? Number(item.sourceServiceIndex)
          : undefined,
        serviceAddedBy: cleanString(item.serviceAddedBy),
        industryType: cleanString(item.industryType),
        financialYear: cleanString(item.financialYear),
        validityPeriod: Math.max(1, Math.min(50, Number(item.validityPeriod) || 1)),
        servicePeriod,
        periodUnit,
        transitionPeriod: isEprCredit ? 'No' : transitionPeriod,
        annualReturnYears,
        annualReturnEprCreditYears: isEprCredit && !pwpEprCredit ? annualReturnEprCreditYears : [],
        servicesOffered: cleanString(item.servicesOffered),
        applicableService: cleanString(item.applicableService),
        serviceCategory: cleanString(item.serviceCategory),
        serviceStartDate,
        serviceEndDate,
        servicesForYear: financialYearFromDate(serviceStartDate || serviceEndDate) || cleanString(item.servicesForYear),
        eprCategory: cleanString(item.eprCategory),
        businessCategory,
        piboParent: normalizeParent(item.piboParent || item.piboCategoryParent) || inferPiboParent(item.piboCategory) || undefined,
        piboCategory: cleanString(item.piboCategory),
        applicantType: cleanString(item.applicantType ?? existingItem.applicantType),
        subApplicantType: cleanString(item.subApplicantType ?? existingItem.subApplicantType),
        unit: '1',
        unitName: cleanString(item.unitName ?? existingItem.unitName).slice(0, 120),
        unitLabel: isEprCredit ? unitLabel : undefined,
        basicAmount: roundMoney(item.basicAmount)
      };
    })
    .filter((item) => isMeaningfulItem(item));
}

function quotationItemKey(item = {}, index = 0) {
  return cleanString(item.assignedServiceId || item.id || (Number.isInteger(Number(item.sourceServiceIndex)) ? `source:${Number(item.sourceServiceIndex)}` : `item:${index}`));
}

function cleanCombinedPricingGroups(groups, items, legacyAmount = 0) {
  if (!Array.isArray(groups) || !groups.length) {
    return items.length ? [{ id: 'legacy-combined-group', name: 'Combined Group 1', itemKeys: items.map(quotationItemKey), basicAmount: roundMoney(legacyAmount) }] : [];
  }
  const validKeys = new Set(items.map(quotationItemKey));
  const assignedKeys = new Set();
  const cleaned = groups.map((group, index) => {
    const itemKeys = [...new Set((Array.isArray(group?.itemKeys) ? group.itemKeys : []).map(cleanString).filter((key) => validKeys.has(key)))];
    if (!itemKeys.length) throw new Error(`Combined pricing group ${index + 1}: select at least one quotation service.`);
    itemKeys.forEach((key) => {
      if (assignedKeys.has(key)) throw new Error(`Combined pricing group ${index + 1}: a quotation service cannot belong to more than one group.`);
      assignedKeys.add(key);
    });
    const rawAmount = group?.basicAmount;
    if (rawAmount === '' || rawAmount === null || rawAmount === undefined || !Number.isFinite(Number(rawAmount)) || Number(rawAmount) < 0) {
      throw new Error(`Combined pricing group ${index + 1}: enter a valid Basic Amount.`);
    }
    return {
      id: cleanString(group?.id) || `combined-group-${index + 1}`,
      name: cleanString(group?.name).slice(0, 120) || `Combined Group ${index + 1}`,
      itemKeys,
      basicAmount: roundMoney(rawAmount)
    };
  });
  const unassignedIndex = items.findIndex((item, index) => !assignedKeys.has(quotationItemKey(item, index)));
  if (unassignedIndex >= 0) throw new Error(`Quotation item ${unassignedIndex + 1}: assign this service to a combined pricing group.`);
  return cleaned;
}

function cleanTerms(terms) {
  if (!Array.isArray(terms)) return [];
  return terms.map(cleanString).filter(Boolean);
}

const PAYMENT_TERM_OPTIONS = [
  '100% after completion of work',
  '50% advance and 50% after completion of work',
  '50% upon receipt of PO and 50% upon completion of EPR Annual Filing',
  '100% advance payment'
];

function cleanPaymentTerm(paymentTerm, terms = []) {
  const selected = cleanString(paymentTerm);
  if (selected && terms.includes(selected)) return selected;
  const legacySelections = terms.filter((term) => PAYMENT_TERM_OPTIONS.includes(term));
  return legacySelections.length === 1 ? legacySelections[0] : '';
}

function validatePaymentTerms(terms = [], paymentTerm = '') {
  return paymentTerm && terms.includes(paymentTerm) ? '' : 'Select exactly one Terms & Conditions payment option.';
}

async function validateQuotationPiboItems(items = []) {
  for (let index = 0; index < items.length; index += 1) {
    try {
      const selection = await validatePiboSelection({
        parent: items[index].piboParent || items[index].piboCategoryParent,
        child: items[index].piboCategory,
        required: true
      });
      items[index].piboParent = selection.piboParent;
      items[index].piboCategory = selection.piboCategory;
      delete items[index].piboCategoryParent;
    } catch (error) {
      error.message = `Quotation item ${index + 1}: ${error.message}`;
      throw error;
    }
  }
}

function validateQuotationItemDates(items = []) {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    if (String(item.businessCategory || '').toLowerCase().replace(/[^a-z0-9]+/g, '') === 'eprcredit') continue;
    if (!item.serviceStartDate) throw new Error(`Quotation item ${index + 1}: Service Start Date is required.`);
    if (!item.serviceEndDate) throw new Error(`Quotation item ${index + 1}: Service End Date is required.`);
    if (item.serviceEndDate < item.serviceStartDate) {
      throw new Error(`Quotation item ${index + 1}: Service End Date must be on or after Service Start Date.`);
    }
  }
}

function cleanBody(body, user = null, existingItems = []) {
  const items = cleanItems(body.items, user, existingItems, body.quotationDate);
  const terms = cleanTerms(body.terms);
  const pricingMode = body.pricingMode === 'combined' ? 'combined' : 'individual';
  const individualTotal = roundMoney(items.reduce((sum, item) => sum + ((Number(item.unit) || 0) * (Number(item.basicAmount) || 0)), 0));
  const combinedPricingGroups = pricingMode === 'combined'
    ? cleanCombinedPricingGroups(body.combinedPricingGroups, items, body.combinedBasicAmount)
    : [];
  const combinedBasicAmount = pricingMode === 'combined'
    ? roundMoney(combinedPricingGroups.reduce((sum, group) => sum + group.basicAmount, 0))
    : 0;
  const calculatedTotal = pricingMode === 'combined' ? combinedBasicAmount : individualTotal;
  return {
    leadId: cleanString(body.leadId),
    leadCode: cleanString(body.leadCode),
    fromName: cleanString(body.fromName).slice(0, 120),
    preparedByName: cleanString(body.preparedByName).slice(0, 120),
    leadDetails: cleanLeadDetails(body.leadDetails),
    validUntil: cleanString(body.validUntil),
    pricingMode,
    serviceState: body.serviceState === 'closed' ? 'closed' : 'open',
    combinedBasicAmount,
    combinedPricingGroups,
    companyName: cleanString(body.companyName || body.leadDetails?.companyName),
    quotationDate: body.quotationDate || undefined,
    items,
    terms,
    paymentTerm: cleanPaymentTerm(body.paymentTerm, terms),
    scopeOfWork: cleanTerms(body.scopeOfWork),
    subtotal: roundMoney(body.subtotal || calculatedTotal),
    grandTotal: roundMoney(body.grandTotal || calculatedTotal),
    status: ['draft', 'submitted', 'sent', 'admin_approved', 'approved', 'rejected'].includes(body.status) ? body.status : 'draft'
  };
}

function normalizeCompanyName(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(private|pvt)\.?\b/g, ' private ')
    .replace(/\b(limited|ltd)\.?\b/g, ' limited ')
    .replace(/\bl\.?l\.?p\.?\b/g, ' llp ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function preserveTerminalApprovalStatus(existing, incoming) {
  const currentStatus = cleanString(existing?.status).toLowerCase();
  const incomingStatus = cleanString(incoming?.status).toLowerCase();
  if (['approved', 'rejected'].includes(currentStatus) && ['draft', 'submitted', 'sent'].includes(incomingStatus)) {
    return { ...incoming, status: currentStatus };
  }
  return incoming;
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

function readCreatedBy(quotation) {
  return quotation.createdBy?.name || quotation.createdByName || quotation.createdBy?.email || 'CRM User';
}

function quotationApprovalSource(quotation) {
  return 'crm';
}

function mapQuotationPendingApprovalRow(quotation, approvalType = 'CREATE') {
  const parts = approvalDateParts(quotation.createdAt || new Date());
  const details = quotation.leadDetails || {};
  const firstItem = Array.isArray(quotation.items) ? quotation.items[0] || {} : {};
  const itemBasicAmount = roundMoney((quotation.items || []).reduce((sum, item) => sum + (Number(item.basicAmount) || 0), 0));
  const totalBasicAmount = quotation.pricingMode === 'combined'
    ? roundMoney(quotation.combinedBasicAmount || quotation.grandTotal)
    : itemBasicAmount;
  const leadCreator = quotation.leadGeneratedBy || readCreatedBy(quotation);
  const displayUser = readCreatedBy(quotation);
  const displayCreator = readCreatedBy(quotation);

  return {
    id: quotation._id,
    quotationId: quotation._id,
    quotationNumber: quotation.quotationNumber || '',
    leadId: quotation.leadId || '',
    sourceLeadId: quotation.sourceLeadId || quotation.externalLeadId || quotation.leadId || '',
    leadCode: quotation.leadCode || '',
    businessLeadCode: quotation.businessLeadCode || '',
    leadDetails: details,
    validUntil: quotation.validUntil || '',
    pricingMode: quotation.pricingMode || 'individual',
    combinedBasicAmount: quotation.combinedBasicAmount || 0,
    combinedPricingGroups: Array.isArray(quotation.combinedPricingGroups) ? quotation.combinedPricingGroups : [],
    items: Array.isArray(quotation.items) ? quotation.items : [],
    terms: Array.isArray(quotation.terms) ? quotation.terms : [],
    scopeOfWork: Array.isArray(quotation.scopeOfWork) ? quotation.scopeOfWork : [],
    status: quotation.status || 'draft',
    createdAt: quotation.createdAt,
    updatedAt: quotation.updatedAt,
    source: quotationApprovalSource(quotation),
    uniqueId: quotation.quotationNumber || quotation.leadCode || '',
    userName: displayUser,
    leadGeneratedBy: leadCreator,
    companyName: details.companyName || quotation.companyName || 'Untitled quotation',
    contactPerson: details.contactPerson || '-',
    mobileNo1: details.mobileNo1 || '-',
    quotationDate: parts.date,
    service: firstItem.serviceCategory || '-',
    category: firstItem.eprCategory || '-',
    piboCategory: firstItem.piboCategory || '-',
    basicAmount: totalBasicAmount || firstItem.basicAmount || '-',
    grandTotal: roundMoney(quotation.grandTotal || totalBasicAmount || firstItem.basicAmount || 0),
    approvalStatus: quotation.status === 'approved' ? 'APPROVED' : quotation.status === 'rejected' ? 'REJECTED' : 'PENDING',
    approvalType,
    createdBy: displayCreator,
    adminApprovalStatus: quotation.managementApproval?.adminApprovalStatus || '',
    managementApprovalStatus: quotation.managementApproval?.status || '',
    managementApproverId: quotation.managementApproval?.approverId || quotation.managementApproval?.approver || '',
    managementApproverName: quotation.managementApproval?.approverName || '',
    managementApprovalSource: quotation.managementApproval?.source || '',
    managementApprovalNote: quotation.managementApproval?.note || '',
    managementApprovalRequestedBy: quotation.managementApproval?.requestedByName || '',
    managementApprovalRequestedAt: quotation.managementApproval?.requestedAt || null,
    requestDate: parts.date,
    requestTime: parts.time
  };
}

async function upsertQuotationPendingApproval(quotation, approvalType = 'CREATE', automatic = false) {
  const row = mapQuotationPendingApprovalRow(quotation, approvalType);
  const source = row.source || 'crm';
  const status = normalizeApprovalStatus(row.approvalStatus) || 'PENDING';
  const isFreshPendingRequest = status === 'PENDING';
  const record = await PendingApproval.findOneAndUpdate(
    { type: 'quotation', source, sourceClientId: String(quotation._id) },
    {
      $setOnInsert: {
        type: 'quotation',
        source,
        sourceClientId: String(quotation._id),
        uniqueId: row.uniqueId
      },
      $set: {
        clientName: row.companyName,
        approvalStatus: status,
        piboCategory: row.piboCategory,
        eprCategory: row.category,
        createdByName: row.createdBy,
        requestDate: row.requestDate,
        requestTime: row.requestTime,
        payload: row,
        nextReminderAt: isFreshPendingRequest ? new Date() : null,
        ...(isFreshPendingRequest ? { reminderCount: 0, lastReminderAt: null, reminderError: '' } : {})
      },
      ...(isFreshPendingRequest ? { $unset: { actionBy: 1, actionAt: 1, remarks: 1, notifiedAdminEmails: 1 } } : {})
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  if (approvalType === 'UPDATE' || automatic) {
    const reviewers = await User.find({ $or: [{ role: 'superadmin' }, { roles: 'superadmin' }], isActive: { $ne: false } }).select('_id').lean();
    const notification = await Notification.create({
      title: approvalType === 'UPDATE' ? 'Quotation updated — Super Admin approval required' : 'New quotation — Super Admin approval required',
      description: `${row.quotationNumber || 'Quotation'} for ${row.companyName || 'a client'} is waiting for final Super Admin approval.`,
      tag: 'Quotation Approval',
      kind: approvalType === 'UPDATE' ? 'quotation_reapproval_required' : 'management_quotation_approval_requested',
      audience: reviewers.map((user) => user._id),
      visibleToRoles: ['superadmin'],
      createdBy: quotation.createdBy?._id || quotation.createdBy,
      createdByName: row.createdBy || 'CRM User',
      metadata: { quotationId: String(quotation._id), approvalRecordId: String(record._id), approvalType }
    });
    notification.crmNotificationId = String(notification._id);
    await notification.save();
  }

  return record;
}

async function nextQuotationNumber() {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const financialYear = `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
  const prefix = `AT/${financialYear}/`;
  const MIN_START = 313;
  await ensureRenumberedFinancialYear(financialYear);
  const matches = await Quotation.aggregate([
    { $match: { quotationNumber: { $regex: `^AT/${financialYear}/\\d+$`, $options: 'i' } } },
    {
      $addFields: {
        seqNum: {
          $toInt: { $arrayElemAt: [{ $split: ['$quotationNumber', '/'] }, 2] }
        }
      }
    },
    { $sort: { seqNum: -1, createdAt: -1 } },
    { $limit: 1 },
    { $project: { _id: 0, quotationNumber: 1, seqNum: 1 } }
  ]);
  const latestNum = matches[0]?.seqNum || 0;
  const next = Math.max(latestNum, MIN_START - 1) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

async function ensureRenumberedFinancialYear(financialYear) {
  const MIN_START = 313;
  const below = await Quotation.aggregate([
    { $match: { quotationNumber: { $regex: `^AT/${financialYear}/\\d+$`, $options: 'i' } } },
    {
      $addFields: {
        seqNum: { $toInt: { $arrayElemAt: [{ $split: ['$quotationNumber', '/'] }, 2] } }
      }
    },
    { $match: { seqNum: { $lt: MIN_START } } },
    { $sort: { seqNum: 1, createdAt: 1 } },
    { $project: { _id: 1, seqNum: 1, quotationNumber: 1 } }
  ]);
  if (!below.length) return { renumbered: 0 };

  const occupied = new Set(
    (await Quotation.aggregate([
      { $match: { quotationNumber: { $regex: `^AT/${financialYear}/\\d+$`, $options: 'i' } } },
      {
        $addFields: {
          seqNum: { $toInt: { $arrayElemAt: [{ $split: ['$quotationNumber', '/'] }, 2] } }
        }
      },
      { $match: { seqNum: { $gte: MIN_START } } },
      { $project: { _id: 0, seqNum: 1 } }
    ])).map((row) => row.seqNum)
  );

  let next = MIN_START;
  const idMap = new Map();
  const oldToNew = new Map();
  for (const row of below) {
    while (occupied.has(next)) next += 1;
    const newNum = `AT/${financialYear}/${String(next).padStart(3, '0')}`;
    idMap.set(String(row._id), { newNumber: newNum, oldNumber: row.quotationNumber });
    oldToNew.set(row.quotationNumber, newNum);
    occupied.add(next);
    next += 1;
  }

  const updates = [];
  for (const [id, { newNumber, oldNumber }] of idMap.entries()) {
    updates.push(
      Quotation.updateOne({ _id: id }, [{
        $set: {
          quotationNumber: newNumber,
          revisionHistory: {
            $cond: {
              if: { $isArray: '$revisionHistory' },
              then: {
                $map: {
                  input: '$revisionHistory',
                  as: 'rev',
                  in: {
                    $cond: {
                      if: { $eq: ['$$rev.quotationNumber', oldNumber] },
                      then: { $mergeObjects: ['$$rev', { quotationNumber: newNumber }] },
                      else: '$$rev'
                    }
                  }
                }
              },
              else: '$revisionHistory'
            }
          }
        }
      }])
    );
  }
  await Promise.all(updates);

  if (oldToNew.size) {
    const proBulk = [];
    for (const [oldN, newN] of oldToNew.entries()) {
      proBulk.push(ProformaInvoice.updateMany({ quotationNumber: oldN }, { $set: { quotationNumber: newN } }));
    }
    await Promise.all(proBulk);
    const notifBulk = [];
    for (const [oldN, newN] of oldToNew.entries()) {
      notifBulk.push(Notification.updateMany(
        { 'metadata.quotationNumber': oldN },
        { $set: { 'metadata.quotationNumber': newN } }
      ));
    }
    await Promise.all(notifBulk);
  }

  return { renumbered: oldToNew.size };
}

exports.listQuotations = async (req, res) => {
  const filter = {};
  const search = cleanString(req.query.search);
  const status = cleanString(req.query.status);
  const source = cleanString(req.query.source);
  if (status) filter.status = status;
  if (source) filter.source = source;
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    filter.$or = [
      { quotationNumber: regex }, { companyName: regex }, { leadCode: regex }, { businessLeadCode: regex },
      { 'leadDetails.companyName': regex }, { 'leadDetails.contactPerson': regex }
    ];
  }
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = req.query.limit ? Math.min(100, Math.max(1, Number(req.query.limit) || 20)) : 0;
  const accessFilter = await quotationAccessFilter(req.user);
  const testLeadReferences = req.query.dashboard === 'true'
    ? await getAdminCreatedLeadReferences()
    : null;
  const scopedFilter = combineFilters(
    filter,
    accessFilter,
    testLeadReferences ? dashboardQuotationExclusionFilter(testLeadReferences) : {}
  );
  const query = Quotation.find(scopedFilter)
    .select(req.query.compact === 'true'
      ? 'quotationNumber leadId leadRef clientRef leadCode businessLeadCode companyName leadDetails quotationDate validUntil serviceState combinedBasicAmount items subtotal grandTotal status source createdByName preparedByName leadGeneratedBy assignedUserName managementApproval approvalDecision createdBy createdAt updatedAt'
      : '')
    .populate('createdBy', 'name email')
    .populate('approvalDecision.actionBy', 'name email role')
    .sort({ quotationDate: -1, createdAt: -1 });
  if (limit) query.skip((page - 1) * limit).limit(limit);
  const [quotations, total] = await Promise.all([query.lean(), Quotation.countDocuments(scopedFilter)]);
  res.json({ ok: true, quotations, pagination: { page, limit: limit || total, total, pages: limit ? Math.ceil(total / limit) : 1 } });
};

exports.getQuotation = async (req, res) => {
  const quotation = await Quotation.findOne(combineFilters({ _id: req.params.id }, await quotationAccessFilter(req.user)))
    .populate('createdBy', 'name email').populate('approvalDecision.actionBy', 'name email role').lean();
  if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
  return res.json({ ok: true, quotation });
};

exports.listLeadQuotations = async (req, res) => {
  const leadId = cleanString(req.params.leadId);
  const quotations = await Quotation.find(combineFilters({ leadId }, await quotationAccessFilter(req.user)))
    .populate('createdBy', 'name email').populate('approvalDecision.actionBy', 'name email role').sort({ quotationDate: -1, createdAt: -1 }).lean();
  return res.json({ ok: true, quotations });
};

exports.createQuotation = async (req, res) => {
  const gstError = validateGstNumber(req.body.leadDetails?.gstNumber);
  if (gstError) return res.status(400).json({ error: gstError });
  let data;
  try {
    data = cleanBody(req.body, req.user);
    data = await refreshQuotationLeadDetails(data, null, req.user);
    const termsError = validatePaymentTerms(data.terms, data.paymentTerm);
    if (termsError) throw new Error(termsError);
    validateQuotationItemDates(data.items);
    await validateQuotationPiboItems(data.items);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message });
  }
  const quotation = await Quotation.create({
    ...data,
    ...await resolveCrmRelationships(data),
    ...directQuotationApproval(req.user, data),
    quotationNumber: await nextQuotationNumber(),
    createdBy: req.user?._id
  });
  await quotation.populate('createdBy', 'name email');
  await upsertQuotationPendingApproval(quotation, 'CREATE', true);
  await sendQuotationLifecycleEmail({ quotation, event: 'created', actor: req.user })
    .catch((error) => console.error('[Quotation lifecycle email] create failed', error));
  res.status(201).json({ ok: true, quotation });
};

exports.updateQuotation = async (req, res) => {
  const gstError = validateGstNumber(req.body.leadDetails?.gstNumber);
  if (gstError) return res.status(400).json({ error: gstError });
  const quotation = await Quotation.findOne(combineFilters({ _id: req.params.id }, await quotationAccessFilter(req.user)));
  if (!quotation) return res.status(404).json({ error: 'Quotation not found' });

  // Every revision, including a one-field edit, starts a completely new approval cycle.
  // Client-supplied status is deliberately ignored.
  let data;
  try {
    data = cleanBody(req.body, req.user, quotation.items || []);
    data = await refreshQuotationLeadDetails(data, quotation, req.user);
    const termsError = validatePaymentTerms(data.terms, data.paymentTerm);
    if (termsError) throw new Error(termsError);
    validateQuotationItemDates(data.items);
    await validateQuotationPiboItems(data.items);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message });
  }
  const previous = quotation.toObject();
  const labels = {
    leadId: 'Lead', leadCode: 'Lead Code', fromName: 'From Name', preparedByName: 'Prepared By Name', companyName: 'Company', leadDetails: 'Lead Details',
    quotationDate: 'Quotation Date', validUntil: 'Valid Until', items: 'Quotation Items', terms: 'Terms', paymentTerm: 'Selected Payment Term', scopeOfWork: 'Scope of Work',
    subtotal: 'Subtotal', grandTotal: 'Grand Total'
  };
  const changes = Object.keys(labels).filter((field) => JSON.stringify(previous[field] ?? null) !== JSON.stringify(data[field] ?? null)).map((field) => ({
    field,
    label: labels[field],
    before: previous[field] ?? null,
    after: data[field] ?? null
  }));
  Object.assign(quotation, data);
  Object.assign(quotation, await resolveCrmRelationships(data));
  Object.assign(quotation, directQuotationApproval(req.user, quotation));
  quotation.revisionHistory = [
    ...(Array.isArray(quotation.revisionHistory) ? quotation.revisionHistory : []),
    {
      at: new Date(),
      userId: String(req.user?._id || ''),
      userName: req.user?.name || req.user?.email || 'CRM User',
      userEmail: req.user?.email || '',
      changedFields: changes.map((change) => change.field),
      changes
    }
  ];
  quotation.markModified('revisionHistory');
  await quotation.save();
  await quotation.populate('createdBy', 'name email');
  await PendingApproval.deleteMany({ type: 'quotation', sourceClientId: String(quotation._id), approvalStatus: 'PENDING' });
  await upsertQuotationPendingApproval(quotation, 'UPDATE', true);
  await sendQuotationLifecycleEmail({ quotation, event: 'revised', actor: req.user })
    .catch((error) => console.error('[Quotation lifecycle email] revision failed', error));
  res.json({ ok: true, quotation });
};

exports.updateQuotationApproval = async (req, res) => {
  const status = normalizeApprovalStatus(req.body.status || req.body.approvalStatus);
  if (!['APPROVED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ error: 'Approval status must be APPROVED or REJECTED' });
  }

  const reviewerRole = String(req.user?.role || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  const isSuperAdminReviewer = reviewerRole === 'superadmin'
    || (!reviewerRole && userHasAnyRole(req.user, ['superadmin']));
  const isAdminReviewer = reviewerRole === 'admin'
    || (!reviewerRole && userHasAnyRole(req.user, ['admin']) && !isSuperAdminReviewer);
  const remarks = String(req.body.remarks || '').trim();
  const proofUrl = String(req.body.proofUrl || '').trim();
  const proofName = String(req.body.proofName || '').trim();
  if (status === 'REJECTED' && !remarks) {
    return res.status(400).json({ error: 'Please enter a rejection reason.' });
  }

  const approvalRecordId = String(req.body.approvalRecordId || '').trim();
  const approvalRecord = require('mongoose').Types.ObjectId.isValid(approvalRecordId)
    ? await PendingApproval.findById(approvalRecordId)
    : null;
  const update = {
    approvalStatus: status,
    nextReminderAt: null,
    actionBy: req.user?._id,
    actionAt: new Date(),
    remarks,
    decisionProofUrl: proofUrl,
    decisionProofName: proofName,
    'payload.managementApprovalStatus': status
  };
  const requestedId = String(req.params.id || '').trim();
  const resolvedQuotationId = require('mongoose').Types.ObjectId.isValid(requestedId)
    ? requestedId
    : String(approvalRecord?.sourceClientId || approvalRecord?.payload?.quotationId || '').trim();
  const quotation = require('mongoose').Types.ObjectId.isValid(resolvedQuotationId)
    ? await Quotation.findById(resolvedQuotationId).populate('createdBy', 'name email')
    : null;

  if (!quotation) {
    return res.status(404).json({ error: 'Linked quotation not found. Refresh Pending Approval and try again.' });
  }
  if (['approved', 'rejected'].includes(quotation.status)) {
    return res.status(409).json({ error: 'This quotation already has a final decision. Refresh Pending Approval.' });
  }
  quotation.$where = { status: quotation.status };
  if (status === 'APPROVED' && String(quotation.managementApproval?.status || '').toUpperCase() === 'PENDING' && !isSuperAdminReviewer) {
    const actionAt = update.actionAt;
    const adminName = req.user?.name || req.user?.email || 'CRM Admin';
    quotation.status = 'admin_approved';
    quotation.approvalDecision = {
      status: 'APPROVED', approvalKind: 'ADMIN', remarks, proofUrl, proofName,
      reviewerRole, actionBy: req.user?._id, actionAt
    };
    quotation.managementApproval = {
      ...(quotation.managementApproval || {}),
      status: 'PENDING',
      adminApprovalStatus: 'APPROVED',
      adminApprovedBy: req.user?._id,
      adminApprovedByName: adminName,
      adminApprovedAt: actionAt,
      adminApprovalRemarks: remarks,
      adminApprovalProofUrl: proofUrl,
      adminApprovalProofName: proofName
    };
    try { await quotation.save(); } catch (error) {
      if (['DocumentNotFoundError', 'VersionError'].includes(error.name)) return res.status(409).json({ error: 'Another reviewer has already updated this quotation. Refresh Pending Approval.' });
      throw error;
    }
    await PendingApproval.updateMany(
      {
        type: 'quotation',
        $or: [
          ...(approvalRecord?._id ? [{ _id: approvalRecord._id }] : []),
          { sourceClientId: String(quotation._id) },
          { 'payload.quotationId': quotation._id },
          { 'payload.quotationId': String(quotation._id) }
        ]
      },
      { $set: {
        actionBy: req.user?._id, actionAt, remarks, decisionProofUrl: proofUrl, decisionProofName: proofName,
        'payload.adminApprovalStatus': 'APPROVED',
        'payload.adminApprovedByName': adminName,
        'payload.adminApprovedAt': actionAt
      } }
    );
    await sendQuotationLifecycleEmail({ quotation, event: 'admin_approved', actor: req.user })
      .catch((error) => console.error('[Quotation lifecycle email] admin approval failed', error));
    return res.json({
      ok: true,
      approvalStatus: 'PENDING',
      adminApprovalStatus: 'APPROVED',
      message: 'Admin approval completed. The quotation PDF is now available and final Super Admin approval is still pending.',
      quotation
    });
  }

  quotation.status = status === 'APPROVED' ? 'approved' : 'rejected';
  quotation.approvalDecision = {
    status,
    ...(isSuperAdminReviewer && status === 'APPROVED' ? { approvalKind: 'MANAGEMENT_FINAL' } : {}),
    remarks,
    proofUrl,
    proofName,
    reviewerRole,
    actionBy: req.user?._id,
    actionAt: update.actionAt
  };
  if (String(quotation.managementApproval?.status || '').toUpperCase() === 'PENDING') {
    quotation.managementApproval = {
      ...(quotation.managementApproval || {}), status,
      actionBy: req.user?._id,
      actionByName: req.user?.name || req.user?.email || 'CRM Admin',
      actionAt: update.actionAt,
      decisionRemarks: remarks
    };
  }
  try { await quotation.save(); } catch (error) {
      if (['DocumentNotFoundError', 'VersionError'].includes(error.name)) return res.status(409).json({ error: 'Another reviewer has already updated this quotation. Refresh Pending Approval.' });
      throw error;
    }

  await PendingApproval.updateMany(
    {
      type: 'quotation',
      $or: [
        ...(approvalRecord?._id ? [{ _id: approvalRecord._id }] : []),
        { sourceClientId: String(quotation._id) },
        { 'payload.quotationId': quotation._id },
        { 'payload.quotationId': String(quotation._id) }
      ]
    },
    { $set: update }
  );

  await sendQuotationLifecycleEmail({
    quotation,
    event: status === 'APPROVED' ? 'approved' : 'rejected',
    actor: req.user
  }).catch((error) => console.error('[Quotation lifecycle email] decision failed', error));

  res.json({ ok: true, approvalStatus: status, quotation });
};

const MANAGEMENT_APPROVAL_SOURCES = new Set(['TEAMS', 'EMAIL', 'VERBAL_CALL', 'WHATSAPP', 'OTHER']);

function normalizeManagementApprovalSource(value) {
  return String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

exports.listManagementApprovers = async (_req, res) => {
  const users = await User.find({ isActive: { $ne: false } })
    .select('_id name email role roles')
    .sort({ name: 1, email: 1 })
    .lean();
  const approvers = users
    .filter((user) => userHasAnyRole(user, ['superadmin']))
    .map((user) => ({ id: user._id, name: user.name || user.email, email: user.email || '' }));
  return res.json({ ok: true, approvers });
};

exports.submitManagementApproval = async (req, res) => {
  const approverId = String(req.body.approverId || '').trim();
  const source = normalizeManagementApprovalSource(req.body.source);
  const note = String(req.body.note || '').trim();

  if (!mongoose.Types.ObjectId.isValid(approverId)) {
    return res.status(400).json({ error: 'Please select the Super Admin who should give final approval.' });
  }
  if (!MANAGEMENT_APPROVAL_SOURCES.has(source)) {
    return res.status(400).json({ error: 'Please select a valid management approval source.' });
  }
  if (note.length > 500) {
    return res.status(400).json({ error: 'Management approval note cannot exceed 500 characters.' });
  }

  const approver = await User.findOne({ _id: approverId, isActive: { $ne: false } })
    .select('_id name email role roles');
  if (!approver || !userHasAnyRole(approver, ['superadmin'])) {
    return res.status(400).json({ error: 'The selected approver is not an active Super Admin.' });
  }

  const requestedId = String(req.params.id || '').trim();
  const quotation = mongoose.Types.ObjectId.isValid(requestedId)
    ? await Quotation.findById(requestedId).populate('createdBy', 'name email')
    : null;

  if (!quotation) {
    return res.status(404).json({ error: 'Quotation not found. Refresh Quotations and try again.' });
  }
  if (quotation.status === 'approved') {
    return res.status(409).json({ error: 'This quotation has already been approved.' });
  }
  if (quotation.status === 'rejected') {
    return res.status(409).json({ error: 'A rejected quotation must be revised before management can approve it.' });
  }

  const requestedAt = new Date();
  const approverName = approver.name || approver.email || 'Super Admin';
  const requestedByName = req.user?.name || req.user?.email || 'CRM Admin';
  quotation.status = 'submitted';
  quotation.managementApproval = {
    status: 'PENDING',
    approverId: approver._id,
    approver: approver._id,
    approverName,
    note,
    source,
    amount: Number(quotation.grandTotal || 0),
    requestedBy: req.user?._id,
    requestedByName,
    requestedAt
  };
  await quotation.save();

  const approvalRecord = await upsertQuotationPendingApproval(quotation, quotation.revisionHistory?.length ? 'UPDATE' : 'CREATE');
  approvalRecord.managementApprover = approver._id;
  approvalRecord.managementApproverName = approverName;
  approvalRecord.managementApprovalSource = source;
  approvalRecord.managementApprovalNote = note;
  approvalRecord.managementApprovalRecordedBy = req.user?._id;
  approvalRecord.payload = {
    ...(approvalRecord.payload || {}),
    managementApprovalStatus: 'PENDING',
    managementApproverId: String(approver._id),
    managementApproverName: approverName,
    managementApprovalSource: source,
    managementApprovalNote: note,
    managementApprovalRequestedBy: requestedByName,
    managementApprovalRequestedAt: requestedAt
  };
  approvalRecord.markModified('payload');
  await approvalRecord.save();

  const notification = await Notification.create({
    title: 'Final quotation approval requested',
    description: `${quotation.quotationNumber || 'Quotation'} for ${quotation.companyName || quotation.leadDetails?.companyName || 'a client'} is waiting for your final approval.`,
    tag: 'Quotation Approval',
    kind: 'management_quotation_approval_requested',
    audience: [approver._id],
    visibleToRoles: ['superadmin'],
    createdBy: req.user?._id,
    createdByName: requestedByName,
    metadata: { quotationId: String(quotation._id), approvalRecordId: String(approvalRecord._id), source }
  });
  notification.crmNotificationId = String(notification._id);
  await notification.save();

  return res.json({
    ok: true,
    approvalStatus: 'PENDING',
    message: 'Management approval request sent to Pending Approval.',
    managementApproval: quotation.managementApproval,
    quotation
  });
};

exports.finalizeManagementApproval = async (req, res) => {
  const finalReviewerRole = String(req.user?.role || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (finalReviewerRole !== 'superadmin') {
    return res.status(403).json({ error: 'Only a primary Super Admin account can complete final approval.' });
  }
  const requestedId = String(req.params.id || '').trim();
  const quotation = mongoose.Types.ObjectId.isValid(requestedId)
    ? await Quotation.findById(requestedId).populate('createdBy', 'name email')
    : null;
  if (!quotation) return res.status(404).json({ error: 'Linked quotation not found.' });
  if (['approved', 'rejected'].includes(quotation.status)) return res.status(409).json({ error: 'This quotation already has a final decision.' });
  if (String(quotation.managementApproval?.status || '').toUpperCase() !== 'PENDING') {
    return res.status(409).json({ error: 'This quotation does not have a pending management approval request.' });
  }
  quotation.$where = { status: quotation.status };
  const actionAt = new Date();
  const approverName = req.user?.name || req.user?.email || 'Super Admin';
  const remarks = String(req.body.remarks || '').trim() || `Final approval completed by ${approverName}.`;
  quotation.status = 'approved';
  quotation.managementApproval = {
    ...(quotation.managementApproval || {}), status: 'APPROVED', actionBy: req.user?._id, actionByName: approverName, actionAt
  };
  quotation.approvalDecision = {
    status: 'APPROVED', approvalKind: 'MANAGEMENT_FINAL', remarks,
    source: quotation.managementApproval.source || '', note: quotation.managementApproval.note || '',
    proofUrl: String(req.body.proofUrl || quotation.managementApproval.adminApprovalProofUrl || '').trim(),
    proofName: String(req.body.proofName || quotation.managementApproval.adminApprovalProofName || '').trim(),
    adminApprovedByName: quotation.managementApproval.adminApprovedByName || '',
    adminApprovedAt: quotation.managementApproval.adminApprovedAt || null,
    reviewerRole: 'superadmin', actionBy: req.user?._id, actionAt
  };
  try { await quotation.save(); } catch (error) {
    if (['DocumentNotFoundError', 'VersionError'].includes(error.name)) return res.status(409).json({ error: 'Another reviewer has already updated this quotation. Refresh Pending Approval.' });
    throw error;
  }
  await PendingApproval.updateMany({
    type: 'quotation',
    $or: [{ sourceClientId: String(quotation._id) }, { 'payload.quotationId': quotation._id }, { 'payload.quotationId': String(quotation._id) }]
  }, { $set: { approvalStatus: 'APPROVED', nextReminderAt: null, actionBy: req.user?._id, actionAt, remarks, 'payload.managementApprovalStatus': 'APPROVED' } });
  await sendQuotationLifecycleEmail({ quotation, event: 'approved', actor: req.user })
    .catch((error) => console.error('[Quotation lifecycle email] final management approval failed', error));
  return res.json({ ok: true, approvalStatus: 'APPROVED', message: 'Quotation received final Super Admin approval.', quotation });
};

exports.bulkCreateQuotations = async (req, res) => {
  const rows = Array.isArray(req.body.quotations) ? req.body.quotations : [];
  if (!rows.length) return res.status(400).json({ error: 'At least one quotation is required.' });
  if (rows.length > 1000) return res.status(400).json({ error: 'A maximum of 1,000 quotations can be imported at once.' });

  const summary = { total: rows.length, created: 0, updated: 0, failed: 0 };
  const failures = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    try {
      const gstError = validateGstNumber(row.leadDetails?.gstNumber);
      if (gstError) throw new Error(gstError);
      const quotationNumber = cleanString(row.quotationNumber) || await nextQuotationNumber();
      const existing = await Quotation.findOne({ quotationNumber });
      const data = cleanBody(row, req.user, existing?.items || []);
      if (!data.companyName) throw new Error('Company Name is required');
      if (!data.items.length) throw new Error('At least one quotation item is required');
      validateQuotationItemDates(data.items);
      await validateQuotationPiboItems(data.items);
      let quotation;
      if (existing) {
        Object.assign(existing, data, await resolveCrmRelationships(data), { source: 'bulk', status: 'draft', managementApproval: {}, approvalDecision: {} });
        quotation = await existing.save();
        await PendingApproval.deleteMany({ type: 'quotation', sourceClientId: String(existing._id), approvalStatus: 'PENDING' });
        summary.updated += 1;
      } else {
        quotation = await Quotation.create({
          ...data,
          ...await resolveCrmRelationships(data),
          quotationNumber,
          source: 'bulk',
          status: 'draft',
          createdBy: req.user?._id
        });
        summary.created += 1;
      }
      await quotation.populate('createdBy', 'name email');
      await sendQuotationLifecycleEmail({
        quotation,
        event: existing ? 'revised' : 'created',
        actor: req.user
      }).catch((error) => console.error('[Quotation lifecycle email] bulk row failed', error));
    } catch (error) {
      summary.failed += 1;
      failures.push({
        row: index + 2,
        quotationNumber: cleanString(row.quotationNumber),
        companyName: cleanString(row.companyName || row.leadDetails?.companyName),
        error: error.message || 'Import failed'
      });
    }
  }
  return res.status(summary.failed === summary.total ? 400 : 200).json({
    ok: summary.failed === 0,
    summary,
    failures
  });
};

exports.approveAllPendingQuotations = async (req, res) => {
  const reviewerRole = String(req.user?.role || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (reviewerRole !== 'superadmin') {
    return res.status(403).json({ error: 'Only Super Admin can approve all quotations without individual proof.' });
  }
  const remarks = String(req.body.remarks || 'Bulk approved').trim();
  const records = await PendingApproval.find({
    type: 'quotation',
    approvalStatus: 'PENDING',
    'payload.managementApprovalStatus': 'PENDING'
  });
  let approved = 0;
  const failures = [];

  for (const record of records) {
    try {
      const quotation = await Quotation.findById(record.sourceClientId);
      if (!quotation || String(quotation.managementApproval?.status || '').toUpperCase() !== 'PENDING' || ['approved', 'rejected'].includes(quotation.status)) {
        throw new Error('Quotation is missing or already has a final decision. Refresh Pending Approval.');
      }
      quotation.$where = { status: quotation.status };
      if (quotation) {
        quotation.status = 'approved';
        const actionAt = new Date();
        quotation.managementApproval = { ...(quotation.managementApproval || {}), status: 'APPROVED', actionBy: req.user?._id, actionByName: req.user?.name || req.user?.email || 'Super Admin', actionAt };
        quotation.approvalDecision = { status: 'APPROVED', approvalKind: 'MANAGEMENT_FINAL', remarks, proofUrl: '', proofName: '', reviewerRole, actionBy: req.user?._id, actionAt };
        await quotation.save();
        await quotation.populate('createdBy', 'name email');
      }
      record.approvalStatus = 'APPROVED';
      record.nextReminderAt = null;
      record.actionBy = req.user?._id;
      record.actionAt = new Date();
      record.remarks = remarks;
      record.payload = { ...(record.payload || {}), managementApprovalStatus: 'APPROVED' };
      record.markModified('payload');
      await record.save();
      if (quotation) {
        await sendQuotationLifecycleEmail({
          quotation,
          event: 'approved',
          actor: req.user
        }).catch((error) => console.error('[Quotation lifecycle email] bulk approval failed', error));
      }
      approved += 1;
    } catch (err) {
      failures.push({
        id: record._id,
        quotation: record.uniqueId || record.clientName,
        error: err.message || 'Unable to approve quotation'
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

exports.mapQuotationPendingApprovalRow = mapQuotationPendingApprovalRow;
exports.upsertQuotationPendingApproval = upsertQuotationPendingApproval;

exports.listServiceCategories = async (req, res) => {
  await ensureBuiltInServiceCategories();
  const categories = await QuotationServiceCategory.find().sort({ name: 1 }).lean();
  res.json({ categories: categories.map((category) => category.name) });
};

exports.createServiceCategory = async (req, res) => {
  await ensureBuiltInServiceCategories();
  const name = normalizeServiceCategoryName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Category name is required' });
  if (name.length > 100) return res.status(400).json({ error: 'Category name must be under 100 characters' });

  try {
    const category = await QuotationServiceCategory.create({ name, createdBy: req.user?._id });
    return res.status(201).json({ category: category.name });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ error: 'This category already exists' });
    throw err;
  }
};

exports.listPiboCategories = async (req, res) => {
  const custom = await QuotationPiboCategory.find({ parent: { $in: PIBO_PARENTS } }).sort({ parent: 1, name: 1 }).lean();
  const builtIn = Object.entries(BUILT_IN_PIBO_CATEGORIES)
    .flatMap(([parent, names]) => names.map((name) => ({ parent, name, custom: false })));
  return res.json({
    categories: [...builtIn, ...custom.map((category) => ({ parent: category.parent, name: category.name, custom: true }))]
  });
};

exports.createPiboCategory = async (req, res) => {
  const parent = normalizeParent(req.body.parent);
  const name = cleanCategoryName(req.body.name);
  if (!parent) return res.status(400).json({ error: 'Parent is required and must be PIBO, SIMP, or PWP.' });
  if (!name) return res.status(400).json({ error: `${parent} Category name is required.` });
  if (name.length > 60) return res.status(400).json({ error: 'Category name must be 60 characters or fewer.' });

  const normalizedName = normalizedCategoryName(parent, name);
  const builtInDuplicate = BUILT_IN_PIBO_CATEGORIES[parent].some((item) => item.toLowerCase() === name.toLowerCase());
  if (builtInDuplicate) return res.status(409).json({ error: `This category already exists under ${parent}.` });

  try {
    const category = await QuotationPiboCategory.create({ parent, name, normalizedName, createdBy: req.user?._id });
    return res.status(201).json({ category: { parent: category.parent, name: category.name } });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ error: `This category already exists under ${parent}.` });
    throw err;
  }
};

exports._test = {
  cleanBody,
  cleanItems,
  combineFilters,
  isQuotationAdmin,
  mergeCurrentLeadDetails,
  normalizeCompanyName,
  preserveTerminalApprovalStatus,
  quotationAccessFilter,
  validateQuotationItemDates
};

exports.listDropdownOptions = async (req, res) => {
  const [quotationOptions, leadBusinessCategories] = await Promise.all([
    QuotationDropdownOption.find().sort({ field: 1, name: 1 }).lean(),
    LeadDropdownOption.find({ field: 'businessCategory' }).sort({ name: 1 }).lean()
  ]);
  const unique = new Map();
  [...quotationOptions, ...leadBusinessCategories].forEach((option) => {
    const field = String(option.field || '').trim();
    const name = String(option.name || '').trim();
    const key = `${field}:${name.toLowerCase()}`;
    if (field && name && !unique.has(key)) unique.set(key, { field, name });
  });
  return res.json({ options: [...unique.values()] });
};

exports.createDropdownOption = async (req, res) => {
  const field = cleanString(req.body.field);
  if (!QuotationDropdownOption.ALLOWED_FIELDS.includes(field)) {
    return res.status(400).json({ error: 'Unsupported quotation dropdown.' });
  }
  const rawName = cleanString(req.body.name).replace(/\s+/g, ' ');
  const name = field === 'servicesForYear' ? rawName : rawName.toUpperCase();
  if (!name) return res.status(400).json({ error: 'Option name is required.' });
  if (name.length > 100) return res.status(400).json({ error: 'Option name must be 100 characters or fewer.' });

  try {
    const option = await QuotationDropdownOption.create({
      field,
      name,
      normalizedName: name.toLowerCase(),
      createdBy: req.user?._id
    });
    return res.status(201).json({ option: { field: option.field, name: option.name } });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'This option already exists.' });
    throw error;
  }
};
