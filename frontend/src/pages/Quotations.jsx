import { canReviseQuotation } from '../utils/quotationRevision.mjs';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, Download, Edit3, Eye, FileSpreadsheet, FileText, Filter, Mail, MessageCircle, MoreHorizontal, Phone, Plus, RefreshCw, Save, Search, Trash2, UploadCloud, Users, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import DashboardShell from '../components/dashboard/DashboardShell';
import ProfileModal from '../components/dashboard/ProfileModal';
import PiboDependentSelect from '../components/form/PiboDependentSelect';
import PremiumDatePicker from '../components/form/PremiumDatePicker';
import api from '../services/api';
import { API_ENDPOINTS } from '../services/apiEndpoints';
import { inferPiboParent, normalizePiboCategories } from '../constants/piboCategories';
import { adminRoles } from '../constants/dashboard';
import { QUOTATION_SCOPE_PRESET_OPTIONS, QUOTATION_SCOPE_PRESETS } from '../constants/quotationScopePresets';
import { createQuotationPdf } from '../utils/quotationPdf';
import { addServiceDays, datesFromAnnualYears, normalizeDateInputValue, normalizePeriodUnit, periodDisplay, renewalDateFrom, serviceEndDateFrom } from '../utils/servicePeriod';

const ANANT_LOGO_SOURCE_URL = '/anant-tattva-logo-chroma.png';

const MANAGEMENT_APPROVAL_SOURCES = [
  { value: 'TEAMS', label: 'Teams' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'VERBAL_CALL', label: 'Verbal Call' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'OTHER', label: 'Other' }
];

function TeamsApprovalIcon({ className = '' }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={className}><path fill="currentColor" d="M14.2 5.2a3.1 3.1 0 1 1 6.2 0 3.1 3.1 0 0 1-6.2 0ZM13 9h8.2c.44 0 .8.36.8.8v5.1a4.1 4.1 0 0 1-8.2 0V9.8c0-.44-.36-.8-.8-.8Zm-4.2-6a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6ZM2.8 9.5h10c.44 0 .8.36.8.8v6.05A5.65 5.65 0 0 1 2.3 16.4v-6.1c0-.44.23-.8.5-.8Z"/><path fill="#fff" d="M5.2 11.2h7v1.45H9.9v5.05H8.25v-5.05H5.2V11.2Z"/></svg>;
}

function ApprovalSourceIcon({ source, className = '' }) {
  if (source === 'TEAMS') return <TeamsApprovalIcon className={className} />;
  if (source === 'EMAIL') return <Mail className={className} />;
  if (source === 'VERBAL_CALL') return <Phone className={className} />;
  if (source === 'WHATSAPP') return <MessageCircle className={className} />;
  return <MoreHorizontal className={className} />;
}

const emptyLeadDetails = {
  referredBy: '',
  salutation: '',
  contactPerson: '',
  designation: '',
  mobileNo1: '',
  mobileNo2: '',
  companyName: '',
  addressLine1: '',
  addressLine2: '',
  addressLine3: '',
  state: '',
  city: '',
  pinCode: '',
  gstNumber: ''
};

const emptyItem = {
  assignedServiceId: '',
  industryType: '',
  financialYear: '',
  validityPeriod: '',
  servicePeriod: '',
  periodUnit: 'annual',
  transitionPeriod: 'No',
  annualReturnYears: [],
  annualReturnEprCreditYears: [],
  servicesOffered: '',
  applicableService: '',
  serviceCategory: '',
  serviceStartDate: '',
  serviceEndDate: '',
  servicesForYear: '',
  eprCategory: '',
  businessCategory: '',
  piboParent: '',
  piboCategoryParent: '',
  piboCategory: '',
  applicantType: '',
  subApplicantType: '',
  unit: '1',
  unitName: '',
  unitLabel: '',
  basicAmount: ''
};

const PERIOD_UNIT_OPTIONS = [
  { value: 'days', label: 'Days' },
  { value: 'months', label: 'Month' },
  { value: 'annual', label: 'Annual' }
];
const TRANSITION_PERIOD_OPTIONS = ['Yes', 'No'];

function periodUnitLabel(unit, quantity = 1) {
  const plural = Number(quantity) === 1 ? '' : 's';
  switch (String(unit || '').trim().toLowerCase()) {
    case 'days': return `Day${plural}`;
    case 'months': return `Month${plural}`;
    default: return `Year${plural}`;
  }
}
function periodUnitLongLabel(unit) {
  switch (String(unit || '').trim().toLowerCase()) {
    case 'days': return 'Days';
    case 'months': return 'Month';
    default: return 'Annual';
  }
}

const EPR_CREDIT_UOM_OPTIONS = ['KG', 'MT'];
const EPR_CREDIT_YEAR_OPTIONS = ['2022-23', '2023-24', '2024-25', '2025-26', '2026-27', '2027-28', '2028-29', '2029-30'];

function isEprCreditItem(item = {}) {
  return String(item.businessCategory || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '') === 'eprcredit';
}

function quotationServicePeriodDisplay(item = {}) {
  return isEprCreditItem(item) ? '0' : periodDisplay(item.servicePeriod, item.periodUnit);
}

function servicePeriodValidityNote(item = {}, validUntil = '') {
  if (isEprCreditItem(item)) {
    return `The EPR – Credit rates are valid till: ${formatServiceDate(validUntil)}. New revised EPR credit rates will be applicable after expiry of validity date.`;
  }
  const unit = item.periodUnit || 'annual';
  const period = Math.max(1, Number(item.servicePeriod) || 1);
  const startDate = normalizeDateInputValue(item.serviceStartDate);
  const endDate = item.transitionPeriod === 'Yes' ? normalizeDateInputValue(item.serviceEndDate) : serviceEndDateFrom(startDate, period, unit);
  const renewalDate = endDate ? addServiceDays(endDate, 1) : '';
  return `Your service period is ${periodDisplay(period, unit)}${startDate ? ` (${formatServiceDate(startDate)} to ${formatServiceDate(endDate)})` : ''}${item.businessCategory ? ` for ${item.businessCategory}` : ''}${renewalDate ? ` and renewal will be applicable from ${formatServiceDate(renewalDate)}` : ''}.`;
}

function quotationUnitLabel(item = {}) {
  const unit = String(item.unit || '1').trim() || '1';
  const uom = String(item.unitLabel || '').trim().toUpperCase();
  return isEprCreditItem(item) && EPR_CREDIT_UOM_OPTIONS.includes(uom) ? `${unit}${uom}` : unit;
}

function isPlasticWasteService(item = {}) {
  return /(?:^|\b)plastic\s+waste(?:\b|$)/i.test(String(item.serviceCategory || item.eprCategory || ''));
}

function getQuotationApplicantType(item = {}, source = {}) {
  if (isPlasticWasteService({ ...item, serviceCategory: source.serviceCategory || source.eprCategory || item.serviceCategory || item.eprCategory })) {
    return String(source.subApplicantType || source.piboCategory || item.subApplicantType || item.piboCategory || source.applicantType || item.applicantType || '-').trim() || '-';
  }
  return String(source.applicantType || item.applicantType || item.piboCategory || item.piboParent || '-').trim() || '-';
}

function quotationEprCreditYears(item = {}) {
  return Array.isArray(item.annualReturnEprCreditYears)
    ? item.annualReturnEprCreditYears.filter((year) => EPR_CREDIT_YEAR_OPTIONS.includes(String(year)))
    : [];
}

const CCP_LEAD_SEQUENCE_START = 353;

function displayLeadCode(row = {}, index = -1) {
  const value = String(
    row.businessLeadCode
    || row.leadNumber
    || row['Lead Number']
    || row.data?.importMeta?.leadNumber
    || row.importMeta?.leadNumber
    || row.leadCode
    || row.sourceLeadId
    || ''
  ).trim();
  const generatedCode = /^ATPL(?:-LEAD)?-[A-F\d]{10,}$/i.test(value);
  if (generatedCode && index >= 0) return `ATPL-${String(CCP_LEAD_SEQUENCE_START + index).padStart(4, '0')}`;
  const businessMatch = value.match(/^ATPL(?:-LEAD)?-(\d+)$/i);
  return businessMatch ? `ATPL-${businessMatch[1].padStart(4, '0')}` : (value || '-');
}

function parseDateInputValue(value) {
  const normalized = normalizeDateInputValue(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function deriveFinancialYearFromDate(value) {
  const parts = parseDateInputValue(value);
  if (!parts) return '';
  const startYear = parts.month >= 4 ? parts.year : parts.year - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function quotationFyOptions() {
  const now = new Date();
  const currentStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return Array.from({ length: 12 }, (_, index) => {
    const start = currentStart - 5 + index;
    return `${start}-${String(start + 1).slice(-2)}`;
  });
}

function formatServiceDate(value) {
  const parts = parseDateInputValue(value);
  if (!parts) return '-';
  return new Date(parts.year, parts.month - 1, parts.day).toLocaleDateString('en-GB').replace(/\//g, '-');
}

function quotationServiceDateRange(item = {}) {
  const startDate = normalizeDateInputValue(item.serviceStartDate);
  if (!startDate) return '-';
  const savedEndDate = normalizeDateInputValue(item.serviceEndDate);
  const endDate = savedEndDate || serviceEndDateFrom(startDate, item.servicePeriod || 1, item.periodUnit || 'annual');
  return `${formatServiceDate(startDate)} - ${formatServiceDate(endDate)}`;
}

function QuotationServiceDateRangeCell({ item }) {
  const [startDate, endDate] = quotationServiceDateRange(item).split(' - ');
  return <><span className="block whitespace-nowrap">{startDate}{endDate ? ' -' : ''}</span>{endDate && <span className="block whitespace-nowrap">{endDate}</span>}</>;
}

function quotationServiceDateRangeHtml(item = {}) {
  return escapeHtml(quotationServiceDateRange(item)).replace(' - ', ' -<br>');
}

function quotationAnnualReturnOrCreditYears(item = {}) {
  const years = isEprCreditItem(item)
    ? quotationEprCreditYears(item)
    : (Array.isArray(item.annualReturnYears) ? item.annualReturnYears : []);
  return [...new Set(years.map(String).filter(Boolean))];
}

function isAnnualReturnRegistrationApplicant(item = {}) {
  const applicantType = String(getQuotationApplicantType(item) || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  return applicantType === 'producer' || applicantType === 'importerofrawmaterial';
}

function isPwpQuotationApplicant(item = {}) {
  return [
    getQuotationApplicantType(item),
    item.applicantType,
    item.piboParent,
    item.piboCategoryParent
  ].some((value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '') === 'pwp');
}

function quotationServicePeriodYears(item = {}) {
  const start = parseDateInputValue(normalizeDateInputValue(item.serviceStartDate));
  if (!start) return [];
  const savedEnd = normalizeDateInputValue(item.serviceEndDate);
  const computedEnd = savedEnd || serviceEndDateFrom(item.serviceStartDate, item.servicePeriod || 1, item.periodUnit || 'annual');
  const end = parseDateInputValue(computedEnd) || start;
  const firstYear = start.month >= 4 ? start.year : start.year - 1;
  const lastYear = end.month >= 4 ? end.year : end.year - 1;
  return Array.from({ length: Math.max(1, lastYear - firstYear + 1) }, (_, index) => {
    const year = firstYear + index;
    return `${year}-${String(year + 1).slice(-2)}`;
  });
}

function quotationAnnualReturnRegistrationYear(item = {}) {
  if (isEprCreditItem(item)) return '';
  const selectedYears = quotationAnnualReturnOrCreditYears(item);
  const displayedYears = selectedYears.length ? selectedYears : quotationServicePeriodYears(item);
  if (isPwpQuotationApplicant(item)) return displayedYears.join(', ') || item.financialYear || '-';
  if (isEprConsultancyItem(item)) {
    return displayedYears.join(', ') || item.financialYear || '-';
  }
  if (!isAnnualReturnRegistrationApplicant(item)) return '-';
  return displayedYears.join(', ') || item.financialYear || '-';
}

function isEprConsultancyItem(item = {}) {
  return String(item.businessCategory || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '') === 'eprconsultancy';
}

function isPwpEprCreditItem(item = {}) {
  return isEprCreditItem(item) && String(getQuotationApplicantType(item) || '').trim().toLowerCase() === 'pwp';
}

function normalizedQuotationService(item = {}) {
  return String(item.servicesOffered || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function isAnnualReturnQuotationService(item = {}) {
  return normalizedQuotationService(item).includes('annualreturn');
}

function isRegistrationQuotationService(item = {}) {
  return normalizedQuotationService(item).includes('registration');
}

function quotationYearMappingHeader(items = []) {
  const consultancyItems = items.filter(isEprConsultancyItem);
  if (consultancyItems.length) {
    const hasAnnualReturn = consultancyItems.some(isAnnualReturnQuotationService);
    const hasRegistration = consultancyItems.some(isRegistrationQuotationService);
    if (hasAnnualReturn && !hasRegistration) return 'Annual Return Year';
    if (hasRegistration && !hasAnnualReturn) return 'Registration EPR Year';
    return 'EPR Year';
  }
  return 'Annual Return EPR Year / Credit Year';
}

function isMeaningfulQuotationItem(item = {}) {
  return [
    item.industryType,
    item.serviceCategory,
    item.serviceStartDate,
    item.serviceEndDate,
    item.servicesForYear,
    item.eprCategory,
    item.businessCategory,
    item.piboCategory
  ].some((value) => String(value || '').trim())
    || Number(item.basicAmount) > 0;
}

const emptyQuotation = {
  leadId: '',
  leadCode: '',
  fromName: '',
  preparedByName: '',
  leadDetails: emptyLeadDetails,
  validUntil: '',
  pricingMode: '',
  combinedBasicAmount: '',
  combinedPricingGroups: [],
  items: [],
  terms: [],
  paymentTerm: '',
  scopeOfWork: [],
  status: 'draft'
};

const salutationOptions = ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.', 'Er.', 'CA', 'Adv.'];
const eprCategoryOptions = ['EPR - Plastic Waste', 'EPR - E-Waste', 'EPR - Battery Waste', 'EPR - Paper Waste', 'EPR - Water Waste', 'EPR - C&D Waste', 'EPR - Tyre Waste', 'EPR - Used Oil Waste', 'EPR - End of Life Vehicles', 'EPR - Non Ferrous'];
const businessCategoryOptions = ['EPR Consultancy', 'EPR Credit'];
const EPR_DATA_YEAR_CATEGORIES = new Set(eprCategoryOptions.map((category) => category.trim().toLowerCase()));

function requiresEprDataYear(category) {
  return EPR_DATA_YEAR_CATEGORIES.has(String(category || '').trim().toLowerCase());
}
const industryTypeOptions = ['Automotive', 'Chemicals', 'Construction', 'Consumer Goods', 'E-commerce', 'Electronics', 'Energy', 'FMCG', 'Financial Services', 'Healthcare', 'Hospitality', 'IT & Software', 'Logistics', 'Manufacturing', 'Pharmaceuticals', 'Renewables', 'Retail', 'Telecom', 'Waste Management', 'Food Manufacturing', 'Mechanical Industry', 'Petrochemical', 'Packaging Manufacture', 'Plastic Recycling', 'E-Waste Recycler', 'E-Waste Recycling', 'Other'];
const PAYMENT_TERM_OPTIONS = [
  '100% after completion of work',
  '50% advance and 50% after completion of work',
  '50% upon receipt of PO and 50% upon completion of EPR Annual Filing',
  '100% advance payment'
];

function quotationPaymentTerm(row = {}) {
  const terms = Array.isArray(row.terms) ? row.terms.map((term) => String(term ?? '').trim()).filter(Boolean) : [];
  const selected = String(row.paymentTerm || '').trim();
  if (selected && terms.includes(selected)) return selected;
  const legacySelections = terms.filter((term) => PAYMENT_TERM_OPTIONS.includes(term));
  return legacySelections.length === 1 ? legacySelections[0] : '';
}
const ANANT_TATTVA_GST_NUMBER = '27AAZCA6657R1ZB';
const ANANT_TATTVA_ADDRESS = '1st Floor, A/25, Technocraft House, Road No. 3, MIDC, Andheri East, Mumbai, Maharashtra 400093';

function cleanScopePresetItem(value) {
  return String(value || '').replace(/:\s*\d+\.\d+\s*/g, ': ').replace(/^\d+\.\d+\s*/, '').trim();
}

function mapLeadToDetails(lead) {
  return {
    referredBy: lead?.referredBy || '',
    salutation: lead?.salutation || '',
    contactPerson: lead?.contactPerson || '',
    designation: lead?.designation || '',
    mobileNo1: lead?.mobileNo1 || '',
    mobileNo2: lead?.mobileNo2 || '',
    companyName: lead?.company || '',
    addressLine1: lead?.addressLine1 || '',
    addressLine2: lead?.addressLine2 || '',
    addressLine3: lead?.addressLine3 || '',
    state: lead?.state || '',
    city: lead?.city || '',
    pinCode: lead?.pinCode || '',
    gstNumber: lead?.gstNumber || lead?.gstin || lead?.gst || ''
  };
}

function normalizeSearchValue(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeOwnerIdentity(value) {
  return normalizeSearchValue(value)
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ownerIdentityTokens(...values) {
  return [...new Set(values.flatMap((value) => {
    if (!value) return [];
    if (typeof value === 'object') {
      return ownerIdentityTokens(
        value._id,
        value.id,
        value.crmUserId,
        value.userId,
        value.name,
        value.email
      );
    }
    const normalized = normalizeOwnerIdentity(value);
    return normalized ? [normalized] : [];
  }))];
}

function quotationApplicantSelection(row = {}) {
  const subApplicantType = String(row.subApplicantType || row.piboCategory || '').trim();
  if (isPlasticWasteService(row) && subApplicantType) {
    return { parent: row.piboParent || row.applicantType || inferPiboParent(subApplicantType), child: subApplicantType };
  }
  if (row.piboCategory) return { parent: row.piboParent || row.applicantType || inferPiboParent(row.piboCategory), child: row.piboCategory };
  const applicant = String(row.applicantType || '').trim();
  if (['Producer', 'Producers'].includes(applicant)) return { parent: 'PIBO', child: 'Producer' };
  if (applicant === 'Manufacturer') return { parent: 'SIMP', child: 'Manufacturer of Raw Material' };
  if (['Recycler', 'Recyclers'].includes(applicant)) return { parent: 'PWP', child: 'Recycler' };
  if (applicant === 'Refurbisher') return { parent: 'PWP', child: 'Refurbisher' };
  if (applicant === 'Collection Agents') return { parent: 'SIMP', child: 'Seller' };
  if (applicant === 'Used Oil Importers') return { parent: 'SIMP', child: 'Importer of Raw Material' };
  return applicant ? { parent: 'SIMP', child: 'Seller' } : { parent: '', child: '' };
}

function leadServiceIsClosed(lead = {}, index = 0) {
  const services = Array.isArray(lead.serviceSelections) && lead.serviceSelections.length ? lead.serviceSelections : [lead];
  const assignments = Array.isArray(lead.assignments) && lead.assignments.length ? lead.assignments : [lead];
  const service = services[index] || {};
  const assignment = assignments[index] || {};
  return Boolean(
    service.closedBy || service.closedByText
    || assignment.closedBy || assignment.closedByText
    || (services.length === 1 && (lead.closedBy || lead.closedByText))
  );
}

function quotationItemIdentity(row = {}) {
  return [
    row.industryType,
    row.servicesOffered || row.serviceCategory,
    row.firstAnnualReturnYearApplicable || row.servicesForYear,
    row.eprCategory,
    row.piboCategory || row.applicantType
  ].map(normalizeSearchValue).join('|');
}

function syncQuotationItemsWithLead(items = [], lead = {}) {
  const services = Array.isArray(lead?.serviceSelections) && lead.serviceSelections.length ? lead.serviceSelections : (lead ? [lead] : []);
  return (Array.isArray(items) ? items : []).map((item, itemIndex) => {
    const assignedServiceId = String(item?.assignedServiceId || '').trim();
    const sourceIndex = Number.isInteger(Number(item?.sourceServiceIndex)) ? Number(item.sourceServiceIndex) : itemIndex;
    const service = services.find((row) => assignedServiceId && String(row?.assignedServiceId || '') === assignedServiceId)
      || services[sourceIndex]
      || services.find((row) => quotationItemIdentity(row) === quotationItemIdentity(item));
    if (!service) return item;
    return {
      ...item,
      assignedServiceId: service.assignedServiceId || assignedServiceId,
      sourceServiceIndex: services.indexOf(service),
      businessCategory: service.businessCategory || item.businessCategory || ''
    };
  });
}

function findLeadForQuotation(quotation = {}, leads = []) {
  const leadId = String(quotation.leadId || '').trim();
  const leadCode = normalizeSearchValue(quotation.leadCode);
  return leads.find((lead) => String(lead._id || lead.id || '') === leadId)
    || leads.find((lead) => leadCode && [lead.leadCode, lead.businessLeadCode, lead.sourceLeadId].map(normalizeSearchValue).includes(leadCode));
}

function quotationOwnerName(quotation = {}) {
  if (String(quotation.quotationNumber || '').trim().toUpperCase() === 'AT/26-27/325') return 'ANAND PADHYA';
  return String(
    quotation.fromName
    || quotation.leadGeneratedBy
    || quotation.assignedUserName
    || quotation.createdByName
    || quotation.createdBy?.name
    || quotation.createdBy?.email
    || '-'
  ).trim() || '-';
}

function quotationPreparedByName(quotation = {}) {
  if (String(quotation.quotationNumber || '').trim().toUpperCase() === 'AT/26-27/325') return 'SAURABH BHAT';
  return String(quotation.preparedByName || quotation.createdBy?.name || quotation.createdByName || quotation.preparedBy || '-').trim() || '-';
}

function serviceBelongsToUser(row = {}, lead = {}, currentUser = null) {
  if (adminRoles.includes(String(currentUser?.role || '').trim().toLowerCase())) return true;
  const userTokens = ownerIdentityTokens(
    currentUser?._id,
    currentUser?.id,
    currentUser?.crmUserId,
    currentUser?.userId,
    currentUser?.name,
    currentUser?.email
  );
  if (!userTokens.length) return false;
  // A lead can be entered by one user on behalf of another. Both the actual
  // creator and the generated-for owner must be able to quote its services.
  const participantTokens = ownerIdentityTokens(
    lead.createdBy?._id,
    lead.createdBy?.id,
    lead.createdBy?.name,
    lead.createdBy?.email,
    lead.createdByCrmUserId,
    lead.createdByName,
    lead.createdByEmail,
    lead.importedCreatedBy,
    lead.generatedForUser?._id,
    lead.generatedForUser?.id,
    lead.generatedForUser?.name,
    lead.generatedForUser?.email,
    lead.generatedForName,
    lead.generatedForEmail
  );
  if (participantTokens.some((token) => userTokens.includes(token))) return true;
  const ownerTokens = ownerIdentityTokens(
    row.createdByCrmUserId,
    row.createdByName,
    row.createdByEmail
  );
  const effectiveOwnerTokens = ownerTokens.length ? ownerTokens : ownerIdentityTokens(
    lead.createdBy?._id,
    lead.createdBy?.id,
    lead.createdBy?.name,
    lead.createdBy?.email,
    lead.createdByCrmUserId,
    lead.createdByName,
    lead.createdByEmail,
    lead.importedCreatedBy
  );
  return effectiveOwnerTokens.some((token) => userTokens.includes(token));
}

function mapLeadServiceRows(lead = {}, savedItems = [], serviceState = 'open', currentUser = null) {
  const rows = Array.isArray(lead.serviceSelections) && lead.serviceSelections.length
    ? lead.serviceSelections
    : [{
        industryType: lead.industryType,
        eprCategory: lead.eprCategory,
        businessCategory: lead.businessCategory,
        applicantType: lead.applicantType || lead.piboParent,
        subApplicantType: lead.subApplicantType || lead.piboCategory,
        piboCategory: lead.piboCategory,
        servicesOffered: lead.servicesOffered,
        firstAnnualReturnYearApplicable: lead.firstAnnualReturnYearApplicable
      }];
  const mappedRows = rows.map((row, index) => ({
    row,
    index,
    closed: leadServiceIsClosed(lead, index),
    owned: serviceBelongsToUser(row, lead, currentUser)
  }))
    .filter(({ owned }) => owned)
    .filter(({ closed }) => serviceState === 'closed' ? closed : !closed)
    .map(({ row, index }) => {
    const saved = savedItems.find((item) => Number(item.sourceServiceIndex) === index)
      || savedItems.find((item) => quotationItemIdentity(item) === quotationItemIdentity(row))
      || {};
    const applicant = quotationApplicantSelection(row);
    return {
      ...emptyItem,
      ...saved,
      assignedServiceId: row.assignedServiceId || saved.assignedServiceId || '',
      sourceServiceIndex: index,
      serviceAddedBy: row.createdByName || row.createdByEmail || currentUser?.name || currentUser?.email || '',
      servicesOffered: row.servicesOffered || saved.servicesOffered || '',
      applicableService: row.applicableService || saved.applicableService || '',
      industryType: row.industryType || saved.industryType || '',
      serviceCategory: row.eprCategory || saved.serviceCategory || '',
      serviceStartDate: normalizeDateInputValue(saved.serviceStartDate),
      serviceEndDate: normalizeDateInputValue(saved.serviceEndDate),
      servicesForYear: saved.servicesForYear || row.firstAnnualReturnYearApplicable || '',
      eprCategory: row.eprCategory || saved.eprCategory || '',
      businessCategory: row.businessCategory || saved.businessCategory || '',
      applicantType: row.applicantType || saved.applicantType || '',
      subApplicantType: row.subApplicantType || row.piboCategory || saved.subApplicantType || '',
      piboParent: applicant.parent || saved.piboParent || '',
      piboCategory: applicant.child || saved.piboCategory || '',
      unit: saved.unit || '1',
      basicAmount: saved.basicAmount ?? ''
    };
  });
  // Rows manually added in Quotation do not exist in the lead service matrix.
  // Preserve them on refresh instead of rebuilding the table from lead rows only.
  const mappedIndexes = new Set(mappedRows.map((item) => Number(item.sourceServiceIndex)).filter(Number.isFinite));
  const additionalSavedRows = savedItems
    .filter((item) => !Number.isFinite(Number(item.sourceServiceIndex)) || !mappedIndexes.has(Number(item.sourceServiceIndex)))
    .map((item) => ({
      ...emptyItem,
      ...item,
      serviceStartDate: normalizeDateInputValue(item.serviceStartDate),
      serviceEndDate: normalizeDateInputValue(item.serviceEndDate),
      unit: item.unit || '1',
      basicAmount: item.basicAmount ?? ''
    }));
  return [...mappedRows, ...additionalSavedRows];
}

function isCombinedQuotation(quotation = {}) {
  return quotation.pricingMode === 'combined';
}

function quotationItemsTotal(items = []) {
  return items.reduce((sum, item) => sum + ((Number(item.unit) || 1) * (Number(item.basicAmount) || 0)), 0);
}

function quotationItemKey(item = {}, index = 0) {
  return String(item.assignedServiceId || item.id || (Number.isInteger(Number(item.sourceServiceIndex)) ? `source:${Number(item.sourceServiceIndex)}` : `item:${index}`)).trim();
}

function createCombinedPricingGroup(index = 0, itemKeys = []) {
  return {
    id: `combined-group-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    name: `Combined Group ${index + 1}`,
    itemKeys: [...new Set(itemKeys.map(String).filter(Boolean))],
    basicAmount: ''
  };
}

function normalizeCombinedPricingGroups(quotation = {}, items = []) {
  const groups = Array.isArray(quotation.combinedPricingGroups) ? quotation.combinedPricingGroups : [];
  if (groups.length) {
    return groups.map((group, index) => ({
      id: String(group.id || `combined-group-${index + 1}`),
      name: String(group.name || `Combined Group ${index + 1}`),
      itemKeys: [...new Set((Array.isArray(group.itemKeys) ? group.itemKeys : []).map(String).filter(Boolean))],
      basicAmount: group.basicAmount ?? ''
    }));
  }
  if (quotation.pricingMode !== 'combined' || !items.length) return [];
  return [{
    id: 'legacy-combined-group',
    name: 'Combined Group 1',
    itemKeys: items.map(quotationItemKey),
    basicAmount: quotation.combinedBasicAmount ?? ''
  }];
}

function combinedPricingRows(quotation = {}, items = []) {
  const groups = normalizeCombinedPricingGroups(quotation, items);
  const groupByItemKey = new Map();
  groups.forEach((group) => {
    (group.itemKeys || []).forEach((key) => groupByItemKey.set(String(key), group));
  });
  const rows = items.map((item, index) => ({
    item,
    index,
    group: groupByItemKey.get(quotationItemKey(item, index)) || {
      id: `unassigned-${index}`,
      basicAmount: item.basicAmount ?? 0
    }
  }));
  rows.forEach((row, rowIndex) => {
    const previousGroupId = rows[rowIndex - 1]?.group?.id;
    row.firstInGroup = rowIndex === 0 || previousGroupId !== row.group.id;
    if (!row.firstInGroup) return;
    let runEnd = rowIndex + 1;
    while (runEnd < rows.length && rows[runEnd].group.id === row.group.id) runEnd += 1;
    row.groupSize = runEnd - rowIndex;
  });
  return rows;
}

function scopePresetKeyForAmount(amount) {
  const basicAmount = Number(amount) || 0;
  if (basicAmount <= 0) return '';
  if (basicAmount <= 75000) return 'basic';
  if (basicAmount <= 100000) return 'premium';
  return 'superPremium';
}


function combinedQuotationTotal(quotation = {}, items = []) {
  const groups = normalizeCombinedPricingGroups(quotation, items);
  if (groups.length) return groups.reduce((sum, group) => sum + (Number(group.basicAmount) || 0), 0);
  const itemTotal = quotationItemsTotal(items);
  return itemTotal || Number(quotation.combinedBasicAmount) || Number(quotation.grandTotal) || 0;
}

function hasFetchedQuotationValue(value) {
  const normalized = normalizeSearchValue(value);
  return Boolean(normalized && !['-', 'n/a', 'na', 'null', 'undefined', 'not available'].includes(normalized));
}

function contextMatchesQuotation(row, context) {
  if (!context) return true;
  const details = row.leadDetails || {};
  const contextLeadId = normalizeSearchValue(context.leadId);
  const contextLeadCode = normalizeSearchValue(context.leadCode);
  const contextCompany = normalizeSearchValue(context.clientName);
  const contextYear = normalizeSearchValue(context.annualYear);
  const rowLeadId = normalizeSearchValue(row.leadId);
  const rowLeadCode = normalizeSearchValue(row.leadCode);
  const rowCompany = normalizeSearchValue(details.companyName);
  const leadMatched = Boolean(
    (contextLeadId && rowLeadId && contextLeadId === rowLeadId) ||
    (contextLeadCode && rowLeadCode && contextLeadCode === rowLeadCode) ||
    (contextCompany && rowCompany && contextCompany === rowCompany)
  );
  const itemYears = (row.items || []).map((item) => normalizeSearchValue(item.servicesForYear)).filter(Boolean);
  const yearMatched = !contextYear || !itemYears.length || itemYears.includes(contextYear);
  return leadMatched && yearMatched;
}

function buildQuotationFromContext(context) {
  if (!context) return { ...emptyQuotation, leadDetails: { ...emptyLeadDetails }, items: [], terms: [], scopeOfWork: [] };
  const isClientContext = context.sourceType === 'client' || Boolean(context.clientId && context.clientName);
  const contextServices = Array.isArray(context.serviceSelections) && context.serviceSelections.length
    ? context.serviceSelections
    : (Array.isArray(context.quotationItems) && context.quotationItems.length
      ? context.quotationItems
      : [context]);
  return {
    ...emptyQuotation,
    leadId: isClientContext ? (context.clientId || '') : (context.leadId || ''),
    leadCode: isClientContext ? (context.clientUniqueId || context.leadCode || '') : (context.leadCode || ''),
    leadDetails: {
      ...emptyLeadDetails,
      contactPerson: context.contactPerson || '',
      designation: context.designation || '',
      mobileNo1: context.mobileNo1 || '',
      mobileNo2: context.mobileNo2 || '',
      companyName: context.clientName || context.company || '',
      addressLine1: context.addressLine1 || '',
      addressLine2: context.addressLine2 || '',
      addressLine3: context.addressLine3 || '',
      state: context.state || '',
      city: context.city || '',
      pinCode: context.pinCode || '',
      gstNumber: context.gstNumber || ''
    },
    items: contextServices.map((service, sourceServiceIndex) => {
      const applicant = quotationApplicantSelection(service);
      return {
        ...emptyItem,
        assignedServiceId: service.assignedServiceId || '',
        sourceServiceIndex: Number.isInteger(Number(service.sourceServiceIndex))
          ? Number(service.sourceServiceIndex)
          : sourceServiceIndex,
        serviceAddedBy: service.createdByName || service.createdByEmail || '',
        servicesOffered: service.servicesOffered || '',
        applicableService: service.applicableService || '',
        annualReturnEprCreditYears: quotationEprCreditYears(service),
        industryType: service.industryType || '',
        serviceCategory: service.eprCategory || '',
        serviceStartDate: normalizeDateInputValue(service.serviceStartDate),
        serviceEndDate: normalizeDateInputValue(service.serviceEndDate),
        servicesForYear: service.firstAnnualReturnYearApplicable || service.annualYear || '',
        eprCategory: service.eprCategory || '',
        businessCategory: service.businessCategory || '',
        applicantType: service.applicantType || '',
        subApplicantType: service.subApplicantType || service.piboCategory || '',
        piboParent: applicant.parent,
        piboCategory: applicant.child,
        unit: service.unit || '1'
      };
    }),
    terms: [],
    scopeOfWork: []
  };
}

function normalizeQuotationSnapshot(row) {
  if (!row) return null;
  const normalized = {
    ...row,
    _id: row._id || row.quotationId || row.id,
    id: row.id || row.quotationId || row._id,
    quotationNumber: row.quotationNumber || row.uniqueId || '',
    leadId: row.leadId || '',
    leadCode: row.leadCode || '',
    leadDetails: {
      ...emptyLeadDetails,
      ...(row.leadDetails || {}),
      contactPerson: row.leadDetails?.contactPerson || row.contactPerson || '',
      mobileNo1: row.leadDetails?.mobileNo1 || row.mobileNo1 || '',
      companyName: row.leadDetails?.companyName || row.companyName || ''
    },
    validUntil: row.validUntil || '',
    pricingMode: row.pricingMode || '',
    combinedBasicAmount: row.combinedBasicAmount ?? '',
    items: Array.isArray(row.items) && row.items.length
      ? row.items.map((item) => ({
          ...emptyItem,
          ...item,
          serviceStartDate: normalizeDateInputValue(item?.serviceStartDate),
          serviceEndDate: normalizeDateInputValue(item?.serviceEndDate),
          unit: item?.unit || '1',
          basicAmount: item?.basicAmount ?? ''
        }))
      : [{
          serviceCategory: row.service || '',
          serviceStartDate: normalizeDateInputValue(row.serviceStartDate),
          serviceEndDate: normalizeDateInputValue(row.serviceEndDate),
          servicesForYear: row.servicesForYear || '',
          eprCategory: row.category || row.eprCategory || '',
          businessCategory: row.businessCategory || '',
          piboCategory: row.piboCategory || '',
          unit: row.unit || '1',
          basicAmount: row.basicAmount || ''
        }],
    terms: Array.isArray(row.terms) ? row.terms : [],
    paymentTerm: quotationPaymentTerm(row),
    scopeOfWork: Array.isArray(row.scopeOfWork) ? row.scopeOfWork : [],
    status: row.status || 'draft'
  };
  normalized.combinedPricingGroups = normalizeCombinedPricingGroups(normalized, normalized.items);
  return normalized;
}

function readQuotationStatus(row = {}) {
  const status = String(row.status || row.quotationStatus || 'draft').trim().toLowerCase();
  return ['approved', 'rejected', 'closed'].includes(status) ? 'closed' : 'open';
}

function readAdminApprovalStatus(row = {}) {
  const status = String(row.approvalStatus || row.adminApproval || row.status || 'approved').trim().toLowerCase();
  if (status.includes('reject')) return 'rejected';
  return 'approved';
}


function quotationUserNames(row = {}) {
  return [...new Set([
    row.assignedUserName,
    row.createdBy?.name,
    row.createdBy?.email,
    row.createdByName,
    row.leadGeneratedBy,
    row.leadDetails?.referredBy
  ].map((value) => String(value || '').trim()).filter(Boolean))];
}

function quotationBelongsToUser(row = {}, currentUser = null) {
  if (adminRoles.map(normalizeSearchValue).includes(normalizeSearchValue(currentUser?.role))) return true;
  const userTokens = [
    currentUser?._id, currentUser?.id, currentUser?.crmUserId, currentUser?.userId,
    currentUser?.name, currentUser?.email
  ].map(normalizeSearchValue).filter(Boolean);
  const creatorTokens = [
    row.createdBy?._id, row.createdBy?.id, row.createdBy?.name, row.createdBy?.email,
    row.createdByName, row.createdByEmail
  ].map(normalizeSearchValue).filter(Boolean);
  return creatorTokens.some((token) => userTokens.includes(token));
}

function getLeadMergeKey(lead = {}) {
  return String(lead._id || lead.id || lead.sourceLeadId || lead.leadCode || lead.company || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function mergeLeadLists(...lists) {
  const merged = [];
  const indexByKey = new Map();
  lists.flat().filter(Boolean).forEach((lead) => {
    const key = getLeadMergeKey(lead);
    if (key && indexByKey.has(key)) {
      const index = indexByKey.get(key);
      merged[index] = { ...merged[index], ...lead };
      return;
    }
    if (key) indexByKey.set(key, merged.length);
    merged.push(lead);
  });
  return merged;
}

function excelDate(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const match = String(value).trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : String(value).trim();
}

function excelAmount(value) {
  const parsed = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitTerms(value) {
  return String(value || '').split(/\r?\n/).map((term) => term.trim()).filter(Boolean);
}

function parseQuotationWorkbook(fileRows, leads = []) {
  const grouped = new Map();
  fileRows.forEach((row, index) => {
    const quotationNumber = String(row['Quotation Number'] || '').trim();
    const companyName = String(row['Company Name'] || '').trim();
    const sourceLeadRow = String(row['Lead Row'] || '').trim();
    const key = quotationNumber || `missing-${sourceLeadRow || `${companyName}-${excelDate(row['Quotation Date'])}` || index + 2}`;
    if (!grouped.has(key)) {
      const lead = leads.find((item) => normalizeSearchValue(item.company || item.companyName) === normalizeSearchValue(companyName));
      grouped.set(key, {
        quotationNumber,
        leadId: lead?._id || lead?.id || '',
        leadCode: lead ? displayLeadCode(lead, leads.indexOf(lead)) : '',
        quotationDate: excelDate(row['Quotation Date']),
        validUntil: excelDate(row['Quotation Valid Until']),
        leadDetails: {
          ...emptyLeadDetails,
          salutation: row.Salutation || '', contactPerson: row['Contact Person'] || '', designation: row.Designation || '',
          companyName, addressLine1: row['Address Line 1'] || '', addressLine2: row['Address Line 2'] || '',
          addressLine3: row['Address Line 3'] || '', city: row.City || '', state: row.State || '',
          pinCode: String(row.Pincode || ''), referredBy: row['Referred By'] || ''
        },
        terms: splitTerms(row['Terms and Conditions']), items: [], status: 'draft', __sourceRows: []
      });
    }
    const quotation = grouped.get(key);
    const piboCategory = String(row['Item PIBO Category'] || row['PIBO Category'] || '').trim();
    quotation.items.push({
      ...emptyItem,
      serviceCategory: String(row['Item Service Category'] || row['Service Category'] || '').trim(),
      businessCategory: String(row['Business Category'] || row['Item Business Category'] || '').trim(),
      serviceStartDate: normalizeDateInputValue(row['Service Start Date']),
      serviceEndDate: normalizeDateInputValue(row['Service End Date']),
      servicesForYear: deriveFinancialYearFromDate(row['Service Start Date']) || String(row['Services for the Year'] || '').trim(),
      eprCategory: String(row['Item EPR Category'] || row['EPR Category'] || '').trim(),
      piboParent: inferPiboParent(piboCategory), piboCategory,
      unit: String(row['Item Unit'] || row['Quantity/Unit'] || '').trim() || '1',
      unitName: String(row['Item Unit Name'] || row['Unit Name'] || '').trim(),
      unitLabel: String(row['Item UOM'] || row.UOM || '').trim().toUpperCase(),
      basicAmount: excelAmount(row['Item Basic Amount (INR)'] || row['Basic Amount (INR)'])
    });
    quotation.__sourceRows.push(index + 2);
  });
  return [...grouped.values()].map((quotation) => {
    const errors = [];
    if (!quotation.quotationNumber) errors.push('Quotation Number');
    if (!quotation.leadDetails.companyName) errors.push('Company Name');
    if (!quotation.validUntil) errors.push('Valid Until');
    quotation.items.forEach((item, index) => {
      if (!item.serviceCategory) errors.push(`Item ${index + 1} Service`);
      if (!item.piboCategory) errors.push(`Item ${index + 1} PIBO Category`);
      if (!item.basicAmount) errors.push(`Item ${index + 1} Amount`);
    });
    return { ...quotation, __errors: errors };
  });
}

export default function Quotations() {
  const [currentUser, setCurrentUser] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [leads, setLeads] = useState([]);
  const [quotations, setQuotations] = useState([]);
  const [customServiceCategories, setCustomServiceCategories] = useState([]);
  const [customDropdownOptions, setCustomDropdownOptions] = useState([]);
  const [piboCategories, setPiboCategories] = useState([]);
  const [piboCategoriesLoading, setPiboCategoriesLoading] = useState(true);
  const [quotation, setQuotation] = useState(emptyQuotation);
  const [editingId, setEditingId] = useState('');
  const [viewMode, setViewMode] = useState('list');
  const [query, setQuery] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [quotationStatusFilter, setQuotationStatusFilter] = useState('');
  const [adminApprovalFilter, setAdminApprovalFilter] = useState('');
  const [validityFilter, setValidityFilter] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [expandedCompany, setExpandedCompany] = useState('');
  const [listMode, setListMode] = useState('company');
  const [menuId, setMenuId] = useState('');
  const [previewQuotation, setPreviewQuotation] = useState(null);
  const [detailQuotation, setDetailQuotation] = useState(null);
  const [successModal, setSuccessModal] = useState(null);
  const [managementApproval, setManagementApproval] = useState(null);
  const [managementApprovers, setManagementApprovers] = useState([]);
  const [managementApproversLoading, setManagementApproversLoading] = useState(false);
  const [managementApprovalSaving, setManagementApprovalSaving] = useState(false);
  const [managementSourceOpen, setManagementSourceOpen] = useState(false);
  const [editingItemIndex, setEditingItemIndex] = useState(null);
  const [itemDrafts, setItemDrafts] = useState({});
  const [financialYearItemIndex, setFinancialYearItemIndex] = useState(null);
  const [financialYearDraft, setFinancialYearDraft] = useState(null);
  const [financialYearError, setFinancialYearError] = useState('');
  const financialYearIsPwpEprCredit = isPwpEprCreditItem(financialYearDraft || {});
  const financialYearNeedsEprData = !financialYearIsPwpEprCredit && requiresEprDataYear(financialYearDraft?.serviceCategory || financialYearDraft?.eprCategory);
  const financialYearNeedsEprCreditYears = isEprCreditItem(financialYearDraft || {}) && !financialYearIsPwpEprCredit;
  const normalizedFinancialYearService = String(financialYearDraft?.servicesOffered || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  const financialYearIsRegistration = normalizedFinancialYearService === 'registration' || normalizedFinancialYearService.includes('newregistration');
  const financialYearEprYearHeading = financialYearIsRegistration ? 'Registration EPR Year' : 'Annual Return EPR Year';
  const financialYearDisplayEnd = financialYearDraft?.transitionPeriod === 'Yes'
    ? normalizeDateInputValue(financialYearDraft?.serviceEndDate)
    : serviceEndDateFrom(financialYearDraft?.serviceStartDate, financialYearDraft?.servicePeriod || 1, financialYearDraft?.periodUnit || 'annual');
  const financialYearRenewalDate = financialYearDisplayEnd
    ? addServiceDays(financialYearDisplayEnd, 1)
    : renewalDateFrom(financialYearDraft?.serviceStartDate, financialYearDraft?.servicePeriod || 1, financialYearDraft?.periodUnit || 'annual');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [bulkPreview, setBulkPreview] = useState(null);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [leadIdentityPrompt, setLeadIdentityPrompt] = useState(null);
  const [leadIdentityError, setLeadIdentityError] = useState('');
  const bulkInputRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const quotationContext = location.state?.quotationContext || null;
  const [fromPendingApproval, setFromPendingApproval] = useState(Boolean(location.state?.fromPendingApproval));

  const selectedLead = useMemo(() => {
    if (quotationContext?.sourceType === 'client' || (quotationContext?.clientId && quotationContext?.clientName)) return null;
    if (!quotation.leadId) return null;
    return leads.find((lead) => String(lead._id || lead.id) === String(quotation.leadId));
  }, [leads, quotation.leadId, quotationContext]);
  const fetchedQuoteDetailsLocked = Boolean(selectedLead || quotationContext);
  const isFetchedLeadDetailLocked = (field) => field !== 'gstNumber'
    && fetchedQuoteDetailsLocked
    && hasFetchedQuotationValue(quotation.leadDetails[field]);
  const currentQuotationServiceCategories = useMemo(
    () => (quotation.items || []).map((item) => String(item?.serviceCategory || '').trim()).filter(Boolean),
    [quotation.items]
  );
  const allServiceCategoryOptions = useMemo(
    () => [...new Set([...customServiceCategories, ...currentQuotationServiceCategories])].sort((left, right) => left.localeCompare(right)),
    [currentQuotationServiceCategories, customServiceCategories]
  );
  const canManageDropdownOptions = adminRoles.includes(String(currentUser?.role || '').toLowerCase());
  const canRequestManagementApproval = Boolean(currentUser);
  const optionsFor = (field, builtIn) => [...new Set([
    ...builtIn,
    ...customDropdownOptions.filter((option) => option.field === field).map((option) => option.name)
  ])].sort((left, right) => left.localeCompare(right));
  const allIndustryTypeOptions = optionsFor('industryType', industryTypeOptions);
  const allEprCategoryOptions = optionsFor('eprCategory', eprCategoryOptions);
  const leadBusinessCategories = leads.flatMap((lead) => [
    lead.businessCategory,
    ...(Array.isArray(lead.serviceSelections) ? lead.serviceSelections.map((service) => service?.businessCategory) : [])
  ]).filter(Boolean);
  const allBusinessCategoryOptions = [...new Set([
    ...optionsFor('businessCategory', businessCategoryOptions),
    ...leadBusinessCategories
  ])].sort((left, right) => left.localeCompare(right));
  const showUomColumn = (quotation.items || []).some((item, index) => isEprCreditItem({
    ...item,
    businessCategory: readItemDraftValue(index, 'businessCategory', item.businessCategory || '')
  }));

  const userOptions = useMemo(() => {
    return [...new Set(quotations.flatMap(quotationUserNames))]
      .sort((left, right) => left.localeCompare(right));
  }, [quotations]);

  const filteredQuotations = useMemo(() => {
    const term = query.trim().toLowerCase();
    return quotations.filter((row) => {
      if (!contextMatchesQuotation(row, quotationContext)) return false;
      const rowUsers = quotationUserNames(row);
      const firstItem = row.items?.[0] || {};
      const haystack = [
        row.quotationNumber,
        row.leadDetails?.companyName,
        row.leadDetails?.contactPerson,
        row.leadDetails?.mobileNo1,
        row.leadDetails?.mobileNo2,
        firstItem.serviceCategory,
        firstItem.eprCategory,
        firstItem.piboCategory,
        ...rowUsers
      ].join(' ').toLowerCase();
      const matchesQuotationStatus = !quotationStatusFilter || readQuotationStatus(row) === quotationStatusFilter;
      const matchesAdminApproval = !adminApprovalFilter || readAdminApprovalStatus(row) === adminApprovalFilter;
      const validDate = row.validUntil ? new Date(row.validUntil) : null;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const matchesValidity = !validityFilter || (validityFilter === 'valid' ? validDate && validDate >= today : validDate && validDate < today);
      const matchesUser = !userFilter || rowUsers.some((name) => normalizeSearchValue(name) === normalizeSearchValue(userFilter));
      return (!term || haystack.includes(term)) && matchesUser && matchesQuotationStatus && matchesAdminApproval && matchesValidity;
    });
  }, [adminApprovalFilter, query, quotationContext, quotationStatusFilter, quotations, userFilter, validityFilter]);

  const companyGroups = useMemo(() => {
    const groups = new Map();
    filteredQuotations.forEach((row) => {
      const company = String(row.companyName || row.leadDetails?.companyName || 'Unnamed company').trim();
      const key = normalizeSearchValue(company) || `unknown-${row._id || row.id}`;
      if (!groups.has(key)) groups.set(key, { key, company, quotations: [] });
      groups.get(key).quotations.push(row);
    });
    const quotationTime = (row = {}) => {
      const value = row.quotationDate || row.createdAt || row.updatedAt;
      const timestamp = value ? new Date(value).getTime() : 0;
      return Number.isNaN(timestamp) ? 0 : timestamp;
    };
    return [...groups.values()]
      .map((group) => {
        const sortedQuotations = [...group.quotations].sort((left, right) => quotationTime(right) - quotationTime(left));
        return { ...group, quotations: sortedQuotations, latestQuotation: sortedQuotations[0] || null };
      })
      .sort((left, right) => quotationTime(right.latestQuotation) - quotationTime(left.latestQuotation) || left.company.localeCompare(right.company));
  }, [filteredQuotations]);
  const allQuotations = useMemo(() => [...filteredQuotations].sort((left, right) => {
    const time = (row) => {
      const timestamp = new Date(row.quotationDate || row.createdAt || row.updatedAt || 0).getTime();
      return Number.isNaN(timestamp) ? 0 : timestamp;
    };
    return time(right) - time(left);
  }), [filteredQuotations]);
  const listTotal = listMode === 'company' ? companyGroups.length : allQuotations.length;
  const totalPages = Math.max(1, Math.ceil(listTotal / rowsPerPage));
  const scopeBasicAmount = quotation.pricingMode === 'combined'
    ? combinedQuotationTotal(quotation, quotation.items)
    : quotationItemsTotal(quotation.items);
  const eligibleScopePresetKey = scopePresetKeyForAmount(scopeBasicAmount);
  const visibleCompanyGroups = companyGroups.slice((page - 1) * rowsPerPage, page * rowsPerPage);
  const visibleQuotations = allQuotations.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  useEffect(() => {
    loadPage();
  }, []);

  useEffect(() => {
    const mode = new URLSearchParams(location.search).get('mode');
    if (mode === 'add') startNew(quotationContext);
  }, [location.search, quotationContext]);

  useEffect(() => {
    if (
      viewMode !== 'form'
      || editingId
      || quotationContext?.sourceType !== 'lead'
      || !selectedLead
      || !currentUser
    ) return;
    const ownedItems = mapLeadServiceRows(selectedLead, [], 'open', currentUser);
    setQuotation((current) => ({
      ...current,
      leadDetails: mapLeadToDetails(selectedLead),
      items: ownedItems
    }));
  }, [currentUser, editingId, quotationContext?.sourceType, selectedLead, viewMode]);

  useEffect(() => {
    const editQuotationId = location.state?.editQuotationId;
    const previewQuotationId = location.state?.previewQuotationId;
    const leadAction = String(location.state?.leadAction || '').trim().toLowerCase();
    const quotationSnapshot = normalizeQuotationSnapshot(location.state?.quotationSnapshot);
    if (leadAction === 'revise' && quotationContext && !loading) {
      const target = [...quotations]
        .filter((row) => contextMatchesQuotation(row, quotationContext))
        .filter(canReviseQuotation)
        .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0))[0];
      if (target) {
        editQuotation(target);
      } else {
        setNotice('Quotation can be revised only after it is approved or rejected.');
      }
      navigate(location.pathname, { replace: true, state: {} });
      return;
    }
    if ((!editQuotationId && !previewQuotationId) || (!quotations.length && !quotationSnapshot)) return;
    if (previewQuotationId) {
      const previewKey = String(previewQuotationId).trim();
      const target = quotations.find((row) => {
        const keys = [row._id, row.id, row.quotationId, row.quotationNumber, row.quotationNo, row.uniqueId]
          .map((value) => String(value || '').trim())
          .filter(Boolean);
        return keys.includes(previewKey);
      }) || quotationSnapshot;
      if (target) {
        if (location.state?.fromPendingApproval) setFromPendingApproval(true);
        setPreviewQuotation(normalizeQuotationSnapshot(target));
        navigate(location.pathname, { replace: true, state: {} });
      }
      return;
    }
    const target = quotations.find((row) => String(row._id || row.id) === String(editQuotationId)) || quotationSnapshot;
    if (target) {
      editQuotation(target);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [loading, location.pathname, location.state, navigate, quotationContext, quotations]);

  useEffect(() => {
    setPage(1);
  }, [adminApprovalFilter, listMode, query, quotationStatusFilter, rowsPerPage, userFilter, validityFilter]);

  useEffect(() => {
    if (!quotationContext || viewMode !== 'form' || editingId || quotation.pricingMode || !quotations.length) return;
    const savedQuotation = [...quotations]
      .filter((row) => contextMatchesQuotation(row, quotationContext)
        && quotationBelongsToUser(row, currentUser)
        && ['combined', 'individual'].includes(row.pricingMode)
        && !['approved', 'rejected'].includes(String(row.status || '').toLowerCase()))
      .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0))[0];
    if (!savedQuotation) return;
    setQuotation((current) => ({
      ...current,
      pricingMode: savedQuotation.pricingMode,
      combinedBasicAmount: savedQuotation.pricingMode === 'combined' ? (savedQuotation.combinedBasicAmount ?? '') : '',
      combinedPricingGroups: normalizeCombinedPricingGroups(savedQuotation, savedQuotation.items || []),
      validUntil: savedQuotation.validUntil || current.validUntil || '',
      items: Array.isArray(savedQuotation.items)
        ? savedQuotation.items.map((item) => ({ ...emptyItem, ...item, basicAmount: item.basicAmount ?? '' }))
        : current.items,
      terms: Array.isArray(savedQuotation.terms)
        ? savedQuotation.terms.map((term) => String(term ?? ''))
        : current.terms,
      paymentTerm: quotationPaymentTerm(savedQuotation),
      scopeOfWork: Array.isArray(savedQuotation.scopeOfWork) ? savedQuotation.scopeOfWork.map(String) : current.scopeOfWork,
      status: savedQuotation.status || current.status
    }));
    setEditingId(savedQuotation._id || savedQuotation.id || '');
  }, [currentUser, editingId, quotation.pricingMode, quotationContext, quotations, viewMode]);

  async function loadPage() {
    setLoading(true);
    setError('');
    try {
      const meResponse = await api.get(API_ENDPOINTS.auth.me);
      const me = meResponse.data.user;
      const [crmLeadsResult, quotationsResponse, categoriesResponse, piboCategoriesResponse, dropdownOptionsResponse] = await Promise.all([
        api.get(API_ENDPOINTS.leads.list).catch(() => ({ data: { leads: [] } })),
        api.get(API_ENDPOINTS.quotations.list),
        api.get(API_ENDPOINTS.quotations.serviceCategories).catch(() => ({ data: { categories: [] } })),
        api.get(API_ENDPOINTS.quotations.piboCategories).catch(() => ({ data: { categories: [] } })),
        api.get(API_ENDPOINTS.quotations.dropdownOptions).catch(() => ({ data: { options: [] } }))
      ]);
      setCurrentUser(me);
      const liveLeads = mergeLeadLists(crmLeadsResult.data.leads || []);
      const liveQuotations = (quotationsResponse.data.quotations || []).map((savedQuotation) => {
        const lead = findLeadForQuotation(savedQuotation, liveLeads);
        return lead ? { ...savedQuotation, items: syncQuotationItemsWithLead(savedQuotation.items, lead) } : savedQuotation;
      });
      setLeads(liveLeads);
      setQuotations(liveQuotations);
      setCustomServiceCategories(categoriesResponse.data.categories || []);
      setPiboCategories(piboCategoriesResponse.data.categories || []);
      setCustomDropdownOptions(dropdownOptionsResponse.data.options || []);
      setPiboCategoriesLoading(false);
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to load quotations.');
    } finally {
      setLoading(false);
      setPiboCategoriesLoading(false);
    }
  }

  async function openManagementApproval(row) {
    if (!canRequestManagementApproval || ['approved', 'rejected'].includes(String(row?.status || '').toLowerCase())) return;
    setManagementApproval({ row, approverId: '', source: '', note: '' });
    setManagementSourceOpen(false);
    setManagementApproversLoading(true);
    setError('');
    try {
      const id = row?._id || row?.id;
      const [approversResult, quotationResult] = await Promise.allSettled([
        managementApprovers.length
          ? Promise.resolve({ data: { approvers: managementApprovers } })
          : api.get(API_ENDPOINTS.quotations.managementApprovers),
        api.get(API_ENDPOINTS.quotations.detail(id))
      ]);
      if (approversResult.status === 'rejected') throw approversResult.reason;
      const approvers = approversResult.value.data?.approvers || [];
      const fullQuotation = quotationResult.status === 'fulfilled' ? quotationResult.value.data?.quotation : null;
      setManagementApprovers(approvers);
      setManagementApproval((current) => current ? {
        ...current,
        approverId: approvers.length === 1 ? String(approvers[0].id) : current.approverId,
        row: fullQuotation ? { ...current.row, ...fullQuotation } : current.row
      } : current);
      if (!approvers.length) setError('No active Super Admin is available for final approval.');
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to load Super Admin approvers.');
    } finally {
      setManagementApproversLoading(false);
    }
  }

  async function submitManagementApproval(event) {
    event.preventDefault();
    if (!managementApproval?.row || !managementApproval.approverId || !managementApproval.source) return;
    const id = managementApproval.row._id || managementApproval.row.id;
    setManagementApprovalSaving(true);
    setError('');
    try {
      const response = await api.patch(API_ENDPOINTS.quotations.managementApproval(id), {
        approverId: managementApproval.approverId,
        source: managementApproval.source,
        note: String(managementApproval.note || '').trim()
      });
      setManagementApproval(null);
      setManagementSourceOpen(false);
      setSuccessModal({
        title: 'Sent to Super Admin',
        message: response.data?.message || 'Quotation is now visible in Pending Approval for final Super Admin approval.'
      });
      await loadPage();
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to send the quotation for final approval.');
    } finally {
      setManagementApprovalSaving(false);
    }
  }

  async function readBulkFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '', raw: true });
      const parsed = parseQuotationWorkbook(rows, leads);
      if (!parsed.length) throw new Error('No quotation rows were found in the workbook.');
      setBulkPreview({ fileName: file.name, quotations: parsed });
    } catch (readError) {
      setError(readError.message || 'Unable to read this Excel file.');
    }
  }

  async function importBulkQuotations() {
    if (!bulkPreview) return;
    const readyRows = bulkPreview.quotations.filter((row) => !row.__errors.length);
    const skippedCount = bulkPreview.quotations.length - readyRows.length;
    if (!readyRows.length) {
      setError('No valid quotations are available to import. Fix the missing fields and upload the Excel again.');
      return;
    }
    setBulkImporting(true);
    setError('');
    try {
      const quotationsToSave = readyRows.map(({ __errors, __sourceRows, ...row }) => row);
      const response = await api.post(API_ENDPOINTS.quotations.bulk, { quotations: quotationsToSave });
      const summary = response.data.summary || {};
      setBulkPreview(null);
      await loadPage();
      setSuccessModal({ title: 'Bulk quotation import complete', message: `${summary.created || 0} created, ${summary.updated || 0} updated, ${summary.failed || 0} failed, and ${skippedCount} incomplete quotation${skippedCount === 1 ? ' was' : 's were'} skipped. Saved quotations remain drafts until Management Approval is requested from Actions.` });
    } catch (importError) {
      const failures = importError.response?.data?.failures || [];
      setError(failures.length ? failures.slice(0, 3).map((row) => `${row.quotationNumber || `Row ${row.row}`}: ${row.error}`).join(' · ') : (importError.response?.data?.error || 'Bulk quotation import failed.'));
    } finally {
      setBulkImporting(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('login_email');
    navigate('/', { replace: true });
  }

  function startNew(context = null) {
    const nextQuotation = buildQuotationFromContext(context);
    setQuotation(nextQuotation);
    if (context && (context.leadId || context.leadCode || context.clientId)) {
      const defaultName = String(currentUser?.name || '').trim();
      setLeadIdentityError('');
      setLeadIdentityPrompt({ applyToCurrent: true, leadId: context.leadId || context.clientId || '', fromName: defaultName, preparedByName: defaultName });
    }
    setEditingId('');
    setNotice('');
    setError('');
    setEditingItemIndex(null);
    setItemDrafts({});
    setViewMode('form');
  }

  async function addServiceCategory(name) {
    const normalized = String(name || '').trim().replace(/\s+/g, ' ').toUpperCase();
    if (!normalized) throw new Error('Enter a category name.');
    if (allServiceCategoryOptions.some((option) => option.toUpperCase() === normalized)) throw new Error('This category already exists.');
    const response = await api.post(API_ENDPOINTS.quotations.serviceCategories, { name: normalized });
    const savedCategory = response.data.category || normalized;
    setCustomServiceCategories((current) => [...new Set([...current, savedCategory])]);
    return savedCategory;
  }

  async function addPiboCategory(parent, name) {
    const response = await api.post(API_ENDPOINTS.quotations.piboCategories, { parent, name });
    const category = response.data.category;
    setPiboCategories((current) => [...current, category]);
    return category;
  }

  function showQuotationList() {
    setViewMode('list');
    setDetailQuotation(null);
    if (location.search) navigate('/sales/quotations', { replace: true });
  }

  function showQuotationDetail(row) {
    setPreviewQuotation(normalizeQuotationSnapshot(row));
    setMenuId('');
  }

  function editQuotation(row) {
    if (!canReviseQuotation(row)) {
      setNotice('Quotation can be revised only after it is approved or rejected.');
      setError('');
      setMenuId('');
      return;
    }
    const latestLead = findLeadForQuotation(row, leads);
    const syncedItems = latestLead ? syncQuotationItemsWithLead(row.items, latestLead) : row.items;
    setQuotation({
      leadId: row.leadId || '',
      leadCode: row.leadCode || '',
      fromName: row.fromName || quotationOwnerName(row),
      preparedByName: row.preparedByName || quotationPreparedByName(row),
      leadDetails: latestLead
        ? mapLeadToDetails(latestLead)
        : { ...emptyLeadDetails, ...(row.leadDetails || {}) },
      validUntil: row.validUntil || '',
      pricingMode: row.pricingMode || (Array.isArray(row.items) && row.items.length ? 'individual' : ''),
      combinedBasicAmount: row.combinedBasicAmount ?? '',
      combinedPricingGroups: normalizeCombinedPricingGroups(row, syncedItems || []),
      items: Array.isArray(syncedItems) ? syncedItems.map((item) => ({ ...emptyItem, ...item, basicAmount: item.basicAmount ?? '' })) : [],
      terms: Array.isArray(row.terms) ? row.terms.map((term) => String(term ?? '')) : [],
      paymentTerm: quotationPaymentTerm(row),
      scopeOfWork: Array.isArray(row.scopeOfWork) ? row.scopeOfWork.map((item) => String(item ?? '')) : [],
      status: row.status || 'draft'
    });
    setEditingId(row._id || row.id);
    setNotice('');
    setError('');
    setDetailQuotation(null);
    setViewMode('form');
  }

  function requestLeadSelection(leadId) {
    if (!leadId) return;
    const defaultName = String(currentUser?.name || '').trim();
    setLeadIdentityError('');
    setLeadIdentityPrompt({ leadId, fromName: defaultName, preparedByName: defaultName });
  }

  function selectLead(leadId, identity) {
    const leadIndex = leads.findIndex((item) => String(item._id || item.id) === String(leadId));
    const lead = leadIndex >= 0 ? leads[leadIndex] : null;
    const businessLeadCode = displayLeadCode(lead, leadIndex);
    const savedQuotation = [...quotations]
      .filter((row) => String(row.leadId || '') === String(leadId || '')
        && quotationBelongsToUser(row, currentUser)
        && ['combined', 'individual'].includes(row.pricingMode)
        && !['approved', 'rejected'].includes(String(row.status || '').toLowerCase()))
      .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0))[0];
    setQuotation((current) => ({
      ...current,
      leadId,
      leadCode: businessLeadCode === '-' ? '' : businessLeadCode,
      fromName: String(identity?.fromName || '').trim(),
      preparedByName: String(identity?.preparedByName || '').trim(),
      leadDetails: mapLeadToDetails(lead),
      pricingMode: savedQuotation?.pricingMode || current.pricingMode || '',
      combinedBasicAmount: savedQuotation?.pricingMode === 'combined' ? (savedQuotation.combinedBasicAmount ?? '') : '',
      combinedPricingGroups: savedQuotation?.pricingMode === 'combined'
        ? normalizeCombinedPricingGroups(savedQuotation, savedQuotation.items || [])
        : [],
      validUntil: savedQuotation?.validUntil || '',
      items: mapLeadServiceRows(lead, Array.isArray(savedQuotation?.items) ? savedQuotation.items : [], 'open', currentUser),
      terms: Array.isArray(savedQuotation?.terms)
        ? savedQuotation.terms.map((term) => String(term ?? ''))
        : [],
      paymentTerm: quotationPaymentTerm(savedQuotation),
      scopeOfWork: Array.isArray(savedQuotation?.scopeOfWork) ? savedQuotation.scopeOfWork.map(String) : [],
      status: savedQuotation?.status || 'draft'
    }));
    setEditingId(savedQuotation?._id || savedQuotation?.id || '');
    setEditingItemIndex(null);
    setItemDrafts({});
  }

  function confirmLeadIdentity() {
    const fromName = String(leadIdentityPrompt?.fromName || '').trim();
    const preparedByName = String(leadIdentityPrompt?.preparedByName || '').trim();
    if (!fromName || !preparedByName) {
      setLeadIdentityError('From Name and Prepared By Name are required.');
      return;
    }
    if (leadIdentityPrompt.applyToCurrent) {
      setQuotation((current) => ({ ...current, fromName, preparedByName }));
    } else {
      selectLead(leadIdentityPrompt.leadId, { fromName, preparedByName });
    }
    setLeadIdentityPrompt(null);
    setLeadIdentityError('');
  }

  async function addDropdownOption(field, name) {
    if (!canManageDropdownOptions) throw new Error('Only Admin or Superadmin can add dropdown options.');
    const normalized = String(name || '').trim().replace(/\s+/g, ' ');
    if (!normalized) throw new Error('Enter an option name.');
    const response = await api.post(API_ENDPOINTS.quotations.dropdownOptions, { field, name: normalized });
    const saved = response.data.option;
    setCustomDropdownOptions((current) => [...current, saved]);
    return saved.name;
  }

  function setLeadDetail(field, value) {
    setQuotation((current) => ({
      ...current,
      leadDetails: { ...current.leadDetails, [field]: value }
    }));
  }

  function setItem(index, field, value) {
    setQuotation((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item)
    }));
  }

  function addItem() {
    if (!quotation.pricingMode) {
      setError('Select Combined Price or Individual Price before adding quotation rows.');
      return;
    }
    setQuotation((current) => {
      const nextIndex = current.items.length;
      const nextItem = { ...emptyItem, id: `quote-item-${Date.now()}-${nextIndex}` };
      setEditingItemIndex(nextIndex);
      setItemDrafts((drafts) => ({ ...drafts, [nextIndex]: nextItem }));
      return { ...current, items: [...current.items, nextItem] };
    });
  }

  function selectPricingMode(mode) {
    setError('');
    setEditingItemIndex(null);
    setItemDrafts({});
    setQuotation((current) => ({
      ...current,
      pricingMode: mode,
      combinedBasicAmount: '',
      combinedPricingGroups: mode === 'combined'
        ? [createCombinedPricingGroup(0, current.items.map(quotationItemKey))]
        : [],
      items: current.items.map((item) => ({
        ...emptyItem,
        ...item,
        basicAmount: mode === 'combined' ? '' : (item.basicAmount ?? '')
      }))
    }));
  }

  function removeItem(index) {
    setQuotation((current) => {
      const removedKey = quotationItemKey(current.items[index] || {}, index);
      return {
        ...current,
        items: current.items.filter((_, itemIndex) => itemIndex !== index),
        combinedPricingGroups: (current.combinedPricingGroups || []).map((group) => ({
          ...group,
          itemKeys: (group.itemKeys || []).filter((key) => String(key) !== removedKey)
        }))
      };
    });
    setEditingItemIndex(null);
    setItemDrafts({});
  }

  function addCombinedPricingGroup() {
    setError('');
    setQuotation((current) => {
      const groups = current.combinedPricingGroups || [];
      const assignedKeys = new Set(groups.flatMap((group) => group.itemKeys || []).map(String));
      const unassignedKeys = current.items
        .map(quotationItemKey)
        .filter((itemKey) => !assignedKeys.has(itemKey));
      if (!unassignedKeys.length) {
        setError('Remove at least one service from an existing group before adding another Combined Pricing Group.');
        return current;
      }
      return {
        ...current,
        combinedPricingGroups: [...groups, createCombinedPricingGroup(groups.length, unassignedKeys)]
      };
    });
  }

  function updateCombinedPricingGroup(groupId, update) {
    setQuotation((current) => ({
      ...current,
      combinedPricingGroups: (current.combinedPricingGroups || []).map((group) => group.id === groupId ? { ...group, ...update } : group)
    }));
  }

  function deleteCombinedPricingGroup(groupId) {
    setQuotation((current) => ({
      ...current,
      combinedPricingGroups: (current.combinedPricingGroups || []).filter((group) => group.id !== groupId)
    }));
  }

  function removeServiceFromCombinedGroup(groupId, itemKey) {
    setQuotation((current) => ({
      ...current,
      combinedPricingGroups: (current.combinedPricingGroups || []).map((group) => group.id === groupId
        ? { ...group, itemKeys: (group.itemKeys || []).filter((key) => key !== itemKey) }
        : group)
    }));
  }

  function startEditItem(index) {
    setEditingItemIndex(index);
    setItemDrafts((drafts) => ({ ...drafts, [index]: { ...emptyItem, ...(quotation.items[index] || {}), unit: quotation.items[index]?.unit || '1' } }));
  }

  function setItemDraft(index, field, value, transformFn) {
    setItemDrafts((drafts) => {
      let base = { ...emptyItem, ...(drafts[index] || {}), [field]: value };
      if (field === 'businessCategory') {
        if (isEprCreditItem(base)) {
          base = { ...base, servicePeriod: 0, periodUnit: 'annual', transitionPeriod: 'No', serviceStartDate: '', serviceEndDate: '' };
        } else if (isEprCreditItem(drafts[index] || {})) {
          base = { ...base, servicePeriod: 1, periodUnit: 'annual', transitionPeriod: 'No' };
        }
      }
      return {
        ...drafts,
        [index]: typeof transformFn === 'function' ? transformFn(base) : base
      };
    });
  }

  function setPiboCategoryDraft(index, parent, child) {
    setItemDrafts((drafts) => ({
      ...drafts,
      [index]: {
        ...emptyItem,
        ...(drafts[index] || {}),
        piboParent: parent,
        piboCategoryParent: '',
        piboCategory: child
      }
    }));
  }

  function readItemDraftValue(index, field, fallback = '') {
    const draft = itemDrafts[index];
    if (!draft || !Object.prototype.hasOwnProperty.call(draft, field)) return fallback;
    return draft[field] ?? fallback;
  }

  function setServiceStartDate(index, value) {
    setItemDrafts((drafts) => {
      const draft = { ...emptyItem, ...(quotation.items[index] || {}), ...(drafts[index] || {}), serviceStartDate: value };
      if (draft.transitionPeriod === 'Yes') return drafts;
      return { ...drafts, [index]: { ...draft, serviceEndDate: serviceEndDateFrom(value, draft.servicePeriod, draft.periodUnit) } };
    });
  }

  function openFinancialYearModal(index) {
    const item = { ...emptyItem, ...(quotation.items[index] || {}), ...(itemDrafts[index] || {}) };
    const sourceIndex = Number.isInteger(Number(item.sourceServiceIndex)) ? Number(item.sourceServiceIndex) : index;
    const leadServices = Array.isArray(selectedLead?.serviceSelections) && selectedLead.serviceSelections.length
      ? selectedLead.serviceSelections
      : (selectedLead ? [selectedLead] : []);
    const sourceService = leadServices[sourceIndex] || {};
    const sourceApplicant = quotationApplicantSelection(sourceService);
    const selectedYears = Array.isArray(item.annualReturnYears) ? item.annualReturnYears : [];
    const selectedEprCreditYears = quotationEprCreditYears(item);
    setFinancialYearItemIndex(index);
    setFinancialYearDraft({
      ...item,
      eprCategory: sourceService.eprCategory || item.eprCategory || '',
      businessCategory: item.businessCategory || sourceService.businessCategory || '',
      serviceCategory: sourceService.eprCategory || item.eprCategory || item.serviceCategory || '',
      piboParent: sourceApplicant.parent || item.piboParent || '',
      piboCategory: sourceApplicant.child || item.piboCategory || '',
      applicantType: sourceService.applicantType || item.applicantType || '',
      subApplicantType: sourceService.subApplicantType || sourceService.piboCategory || item.subApplicantType || '',
      servicesOffered: sourceService.servicesOffered || item.servicesOffered || '',
      validityPeriod: String(item.validityPeriod || selectedYears.length || 1),
      servicePeriod: isEprCreditItem({ ...item, businessCategory: sourceService.businessCategory || item.businessCategory }) ? '0' : String(item.servicePeriod || 1),
      periodUnit: ['days', 'months', 'annual'].includes(String(item.periodUnit || '').trim()) ? String(item.periodUnit).trim() : 'annual',
      transitionPeriod: ['Yes', 'No'].includes(String(item.transitionPeriod || '').trim()) ? String(item.transitionPeriod).trim() : 'No',
      annualReturnYears: selectedYears,
      annualReturnEprCreditYears: selectedEprCreditYears
    });
    setFinancialYearError('');
  }

  function toggleAnnualReturnYear(year) {
    setFinancialYearDraft((current) => {
      const selected = current.annualReturnYears || [];
      const applyTransitionDates = (nextYears) => current.transitionPeriod === 'Yes'
        ? { ...current, annualReturnYears: nextYears, ...datesFromAnnualYears(nextYears) }
        : { ...current, annualReturnYears: nextYears };
      if (selected.includes(year)) return applyTransitionDates(selected.filter((value) => value !== year));
      const limit = Math.max(1, Number(current.validityPeriod) || 1);
      if (selected.length >= limit) return current;
      return applyTransitionDates([...selected, year].sort());
    });
  }

  function saveFinancialYearSelection() {
    const pwpEprCredit = isPwpEprCreditItem(financialYearDraft || {});
    const eprYearRequired = !pwpEprCredit && requiresEprDataYear(financialYearDraft?.serviceCategory || financialYearDraft?.eprCategory);
    const validityPeriod = Math.max(1, Number(financialYearDraft?.validityPeriod) || 1);
    const annualReturnYears = financialYearDraft?.annualReturnYears || [];
    const annualReturnEprCreditYears = quotationEprCreditYears(financialYearDraft);
    if (eprYearRequired && !annualReturnYears.length) {
      setError('Select at least one Annual Return EPR Year.');
      return;
    }
    if (eprYearRequired && annualReturnYears.length > validityPeriod) {
      setError(`You can select maximum ${validityPeriod} Annual Return year(s).`);
      return;
    }
    if (isEprCreditItem(financialYearDraft) && !pwpEprCredit && !annualReturnEprCreditYears.length) {
      setFinancialYearError('Please select at least one Annual Return EPR Credit Year.');
      return;
    }
    const sortedYears = eprYearRequired ? [...annualReturnYears].sort() : [];
    const financialYear = !sortedYears.length ? '' : sortedYears.length === 1 ? sortedYears[0] : `${sortedYears[0]} to ${sortedYears.at(-1)}`;
    const eprCredit = isEprCreditItem(financialYearDraft);
    const periodUnit = ['days', 'months', 'annual'].includes(String(financialYearDraft?.periodUnit || '').trim())
      ? String(financialYearDraft.periodUnit).trim()
      : 'annual';
    const servicePeriodMax = periodUnit === 'days' ? 3650 : periodUnit === 'months' ? 600 : 100;
    const transitionPeriod = ['Yes', 'No'].includes(String(financialYearDraft?.transitionPeriod || '').trim())
      ? String(financialYearDraft.transitionPeriod).trim()
      : 'No';
    const servicePeriod = eprCredit ? 0 : Math.max(1, Math.min(servicePeriodMax, Number(financialYearDraft?.servicePeriod) || 1));
    const update = {
      validityPeriod: eprYearRequired ? validityPeriod : '',
      servicePeriod,
      periodUnit,
      transitionPeriod,
      annualReturnYears: sortedYears,
      annualReturnEprCreditYears: isEprCreditItem(financialYearDraft) && !pwpEprCredit ? annualReturnEprCreditYears : [],
      financialYear,
      serviceCategory: financialYearDraft.serviceCategory || '',
      eprCategory: financialYearDraft.eprCategory || '',
      businessCategory: financialYearDraft.businessCategory || '',
      piboParent: financialYearDraft.piboParent || '',
      piboCategory: financialYearDraft.piboCategory || '',
      applicantType: financialYearDraft.applicantType || '',
      subApplicantType: financialYearDraft.subApplicantType || '',
      servicesOffered: financialYearDraft.servicesOffered || '',
      applicableService: financialYearDraft.applicableService || ''
    };
    const existingStartDate = normalizeDateInputValue(financialYearDraft.serviceStartDate || quotation.items[financialYearItemIndex]?.serviceStartDate || itemDrafts[financialYearItemIndex]?.serviceStartDate);
    if (eprCredit) {
      update.transitionPeriod = 'No';
      update.serviceStartDate = '';
      update.serviceEndDate = '';
    } else if (transitionPeriod === 'Yes' && sortedYears.length) {
      Object.assign(update, datesFromAnnualYears(sortedYears));
    } else if (existingStartDate) {
      update.serviceStartDate = existingStartDate;
      update.serviceEndDate = transitionPeriod === 'Yes'
        ? normalizeDateInputValue(financialYearDraft.serviceEndDate || quotation.items[financialYearItemIndex]?.serviceEndDate)
        : serviceEndDateFrom(existingStartDate, update.servicePeriod, periodUnit);
    }
    setQuotation((current) => ({ ...current, items: current.items.map((item, index) => index === financialYearItemIndex ? { ...item, ...update } : item) }));
    setItemDrafts((current) => ({ ...current, [financialYearItemIndex]: { ...emptyItem, ...(current[financialYearItemIndex] || quotation.items[financialYearItemIndex]), ...update } }));
    setFinancialYearItemIndex(null);
    setFinancialYearDraft(null);
    setFinancialYearError('');
    setError('');
  }

  function saveItem(index) {
    const draft = { ...emptyItem, ...(itemDrafts[index] || {}) };
    const parent = draft.piboParent || draft.piboCategoryParent || inferPiboParent(draft.piboCategory);
    const serviceStartDate = normalizeDateInputValue(draft.serviceStartDate);
    const periodUnit = ['days', 'months', 'annual'].includes(String(draft.periodUnit || '').trim())
      ? String(draft.periodUnit).trim()
      : 'annual';
    const servicePeriodMax = periodUnit === 'days' ? 3650 : periodUnit === 'months' ? 600 : 100;
    const eprCredit = isEprCreditItem(draft);
    const servicePeriod = eprCredit ? 0 : Math.max(1, Math.min(servicePeriodMax, Number(draft.servicePeriod) || 1));
    const transitionPeriod = ['Yes', 'No'].includes(String(draft.transitionPeriod || '').trim())
      ? String(draft.transitionPeriod).trim()
      : 'No';
    const serviceEndDate = transitionPeriod === 'Yes'
      ? normalizeDateInputValue(draft.serviceEndDate)
      : serviceEndDateFrom(serviceStartDate, servicePeriod, periodUnit);
    if (!eprCredit && !serviceStartDate) {
      setError(requiresEprDataYear(draft.eprCategory || draft.serviceCategory)
        ? 'Select EPR Data Year and Annual Return EPR Year before saving the quotation item.'
        : 'Select Service Start Date and Service Period before saving the quotation item.');
      return;
    }
    if (!eprCredit && !serviceEndDate) {
      setError('Select Service End Date before saving the quotation item.');
      return;
    }
    if (!eprCredit && serviceEndDate < serviceStartDate) {
      setError('Service End Date must be on or after Service Start Date.');
      return;
    }
    if (!parent || !draft.piboCategory) {
      setError('Select both Applicant Type and its child category before saving the quotation item.');
      return;
    }
    const validChild = normalizePiboCategories(piboCategories).some((category) => category.parent === parent && category.name.toLowerCase() === String(draft.piboCategory).toLowerCase());
    if (!validChild) {
      setError(`${draft.piboCategory} is not a valid ${parent} category.`);
      return;
    }
    if (isEprCreditItem(draft) && !EPR_CREDIT_UOM_OPTIONS.includes(String(draft.unitLabel || '').trim().toUpperCase())) {
      setError('Select UOM as KG or MT for the EPR Credit quotation item.');
      return;
    }
    if (isEprCreditItem(draft) && !isPwpEprCreditItem(draft) && !quotationEprCreditYears(draft).length) {
      setError('Select at least one Annual Return EPR Credit Year for the EPR Credit quotation item.');
      return;
    }
    draft.piboParent = parent;
    draft.serviceStartDate = eprCredit ? '' : serviceStartDate;
    draft.serviceEndDate = eprCredit ? '' : serviceEndDate;
    draft.servicePeriod = servicePeriod;
    draft.periodUnit = periodUnit;
    draft.transitionPeriod = eprCredit ? 'No' : transitionPeriod;
    draft.servicesForYear = deriveFinancialYearFromDate(serviceStartDate);
    draft.unit = '1';
    draft.unitName = String(draft.unitName || '').trim();
    draft.unitLabel = isEprCreditItem(draft) ? String(draft.unitLabel).trim().toUpperCase() : '';
    draft.annualReturnEprCreditYears = isEprCreditItem(draft) && !isPwpEprCreditItem(draft) ? quotationEprCreditYears(draft) : [];
    delete draft.piboCategoryParent;
    setError('');
    setQuotation((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? draft : item)
    }));
    setEditingItemIndex(null);
  }

  function cancelItemEdit(index) {
    const original = quotation.items[index] || {};
    const isEmpty = !isMeaningfulQuotationItem(original);
    if (isEmpty) removeItem(index);
    else setEditingItemIndex(null);
  }

  function togglePaymentTerm(term) {
    setQuotation((current) => ({
      ...current,
      terms: [term, ...current.terms.filter((item) => !PAYMENT_TERM_OPTIONS.includes(item))],
      paymentTerm: term
    }));
  }

  function addCustomTerm() {
    setQuotation((current) => ({ ...current, terms: [...current.terms, ''] }));
  }

  function setCustomTerm(termIndex, value) {
    setQuotation((current) => {
      const previous = current.terms[termIndex];
      return {
        ...current,
        terms: current.terms.map((term, index) => index === termIndex ? value : term),
        paymentTerm: current.paymentTerm === previous ? value : current.paymentTerm
      };
    });
  }

  function removeCustomTerm(termIndex) {
    setQuotation((current) => ({
      ...current,
      terms: current.terms.filter((_, index) => index !== termIndex),
      paymentTerm: current.paymentTerm === current.terms[termIndex] ? '' : current.paymentTerm
    }));
  }

  function addScopeItem() {
    setNotice('');
    setQuotation((current) => ({ ...current, scopeOfWork: [...(current.scopeOfWork || []), ''] }));
  }

  function setScopeItem(index, value) {
    setNotice('');
    setQuotation((current) => ({ ...current, scopeOfWork: (current.scopeOfWork || []).map((item, itemIndex) => itemIndex === index ? value : item) }));
  }

  function removeScopeItem(index) {
    setNotice('');
    setQuotation((current) => ({ ...current, scopeOfWork: (current.scopeOfWork || []).filter((_, itemIndex) => itemIndex !== index) }));
  }

  function applyScopePreset(presetKey) {
    const preset = QUOTATION_SCOPE_PRESETS[presetKey];
    const presetLabel = QUOTATION_SCOPE_PRESET_OPTIONS.find((option) => option.key === presetKey)?.label || 'Selected';
    if (!Array.isArray(preset) || !preset.length) {
      setError('This scope preset is not available.');
      return;
    }
    setError('');
    setNotice(`${presetLabel} package scope of work applied. You can still edit the lines below.`);
    setQuotation((current) => ({ ...current, scopeOfWork: preset.map(cleanScopePresetItem) }));
  }

  async function saveQuotation(status = quotation.status) {
    if (!String(quotation.fromName || '').trim() || !String(quotation.preparedByName || '').trim()) {
      setError('Select the lead again and enter both From Name and Prepared By Name.');
      return;
    }
    const gstNumber = String(quotation.leadDetails.gstNumber || '').trim().toUpperCase();
    const gstPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
    if (gstNumber && gstNumber.length !== 15) {
      setError('GST Number must contain exactly 15 characters.');
      return;
    }
    if (gstNumber && !gstPattern.test(gstNumber)) {
      setError('Please enter a valid 15-character GST Number.');
      return;
    }
    if (!String(quotation.paymentTerm || '').trim() || !quotation.terms.map((term) => String(term || '').trim()).includes(String(quotation.paymentTerm || '').trim())) {
      setError('Select exactly one Terms & Conditions payment option before saving the quotation.');
      return;
    }
    if (!quotation.items.length) {
      setError('Add at least one quotation item and select its Applicant Type and child category.');
      return;
    }
    if (!quotation.pricingMode) {
      setError('Select Combined Price or Individual Price.');
      return;
    }
    if (quotation.pricingMode === 'combined') {
      const groups = quotation.combinedPricingGroups || [];
      if (!groups.length) {
        setError('Add at least one Combined Pricing Group.');
        return;
      }
      const emptyGroupIndex = groups.findIndex((group) => !(group.itemKeys || []).length);
      if (emptyGroupIndex >= 0) {
        setError(`Combined pricing group ${emptyGroupIndex + 1}: select at least one service.`);
        return;
      }
      const invalidGroupAmountIndex = groups.findIndex((group) => String(group.basicAmount ?? '').trim() === '' || !Number.isFinite(Number(group.basicAmount)) || Number(group.basicAmount) < 0);
      if (invalidGroupAmountIndex >= 0) {
        setError(`Combined pricing group ${invalidGroupAmountIndex + 1}: enter a valid Basic Amount.`);
        return;
      }
      const assignedKeys = groups.flatMap((group) => group.itemKeys || []).map(String);
      const duplicateKey = assignedKeys.find((key, index) => assignedKeys.indexOf(key) !== index);
      if (duplicateKey) {
        setError('A quotation service cannot belong to more than one combined pricing group.');
        return;
      }
      const unassignedIndex = quotation.items.findIndex((item, index) => !assignedKeys.includes(quotationItemKey(item, index)));
      if (unassignedIndex >= 0) {
        setError(`Quotation item ${unassignedIndex + 1}: assign this service to a combined pricing group.`);
        return;
      }
    }
    if (quotation.pricingMode === 'individual') {
      const missingAmountIndex = quotation.items.findIndex((item) => String(item.basicAmount ?? '').trim() === '' || Number(item.basicAmount) < 0);
      if (missingAmountIndex >= 0) {
        setError(`Quotation item ${missingAmountIndex + 1}: enter a valid Basic Amount.`);
        return;
      }
    }
    const missingUomIndex = quotation.items.findIndex((item) => isEprCreditItem(item) && !EPR_CREDIT_UOM_OPTIONS.includes(String(item.unitLabel || '').trim().toUpperCase()));
    if (missingUomIndex >= 0) {
      setError(`Quotation item ${missingUomIndex + 1}: select UOM as KG or MT for EPR Credit.`);
      return;
    }
    const missingEprCreditYearsIndex = quotation.items.findIndex((item) => isEprCreditItem(item) && !isPwpEprCreditItem(item) && !quotationEprCreditYears(item).length);
    if (missingEprCreditYearsIndex >= 0) {
      setError(`Quotation item ${missingEprCreditYearsIndex + 1}: select at least one Annual Return EPR Credit Year.`);
      return;
    }
    const availableCategories = normalizePiboCategories(piboCategories);
    const invalidItemIndex = quotation.items.findIndex((item) => {
      const parent = item.piboParent || item.piboCategoryParent || inferPiboParent(item.piboCategory);
      return !parent || !item.piboCategory || !availableCategories.some((category) => category.parent === parent && category.name.toLowerCase() === String(item.piboCategory).toLowerCase());
    });
    if (invalidItemIndex >= 0) {
      setError(`Quotation item ${invalidItemIndex + 1}: select a valid Applicant Type and child category.`);
      return;
    }
    const invalidPeriodIndex = quotation.items.findIndex((item) => {
      if (isEprCreditItem(item)) return Number(item.servicePeriod) !== 0;
      const unit = String(item.periodUnit || '').trim();
      const period = Number(item.servicePeriod);
      const max = unit === 'days' ? 3650 : unit === 'months' ? 600 : 100;
      return !['days', 'months', 'annual'].includes(unit) || !Number.isInteger(period) || period < 1 || period > max;
    });
    if (invalidPeriodIndex >= 0) {
      setError(`Quotation item ${invalidPeriodIndex + 1}: enter a valid whole Service Period and select Days, Month, or Annual.`);
      return;
    }
    const invalidDateIndex = quotation.items.findIndex((item) => {
      if (isEprCreditItem(item)) return false;
      const start = normalizeDateInputValue(item.serviceStartDate);
      const end = normalizeDateInputValue(item.serviceEndDate);
      return !start || !end || end < start;
    });
    if (invalidDateIndex >= 0) {
      const item = quotation.items[invalidDateIndex] || {};
      if (!normalizeDateInputValue(item.serviceStartDate)) {
        setError(requiresEprDataYear(item.eprCategory || item.serviceCategory)
          ? `Quotation item ${invalidDateIndex + 1}: select EPR Data Year and Annual Return EPR Year.`
          : `Quotation item ${invalidDateIndex + 1}: select Service Start Date and Service Period.`);
      } else if (!normalizeDateInputValue(item.serviceEndDate)) {
        setError(`Quotation item ${invalidDateIndex + 1}: select Service End Date.`);
      } else {
        setError(`Quotation item ${invalidDateIndex + 1}: Service End Date must be on or after Service Start Date.`);
      }
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        ...quotation,
        serviceState: quotation.serviceState || 'open',
        combinedBasicAmount: quotation.pricingMode === 'combined' ? combinedQuotationTotal(quotation, quotation.items) : 0,
        combinedPricingGroups: quotation.pricingMode === 'combined' ? quotation.combinedPricingGroups : [],
        leadDetails: { ...quotation.leadDetails, gstNumber },
        items: quotation.items.map((item) => ({
          ...item,
          serviceStartDate: normalizeDateInputValue(item.serviceStartDate),
          serviceEndDate: normalizeDateInputValue(item.serviceEndDate),
          servicesForYear: deriveFinancialYearFromDate(item.serviceStartDate) || item.servicesForYear || '',
          basicAmount: quotation.pricingMode === 'combined' ? 0 : item.basicAmount,
          unit: '1',
          unitName: String(item.unitName || '').trim(),
          unitLabel: isEprCreditItem(item) ? String(item.unitLabel || '').trim().toUpperCase() : '',
          annualReturnEprCreditYears: isEprCreditItem(item) ? quotationEprCreditYears(item) : [],
          piboParent: item.piboParent || item.piboCategoryParent || inferPiboParent(item.piboCategory),
          piboCategoryParent: undefined
        })),
        status
      };
      const response = editingId
        ? await api.put(API_ENDPOINTS.quotations.detail(editingId), payload)
        : await api.post(API_ENDPOINTS.quotations.create, payload);
      setSuccessModal({
        title: editingId ? 'Quotation updated' : 'Quotation saved',
        message: `${response.data.quotation?.quotationNumber || 'Quotation'} was saved successfully. Use Management Approval in quotation Actions to send it to Pending Approval.`
      });
      setQuotation({ ...emptyQuotation, leadDetails: { ...emptyLeadDetails }, items: [], terms: [] });
      setEditingId('');
      setViewMode('list');
      if (location.search) navigate('/sales/quotations', { replace: true });
      await loadPage();
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to save quotation.');
    } finally {
      setSaving(false);
    }
  }

  function renderManagementApprovalAction(row) {
    if (!canRequestManagementApproval) return null;
    const requestStatus = String(row?.managementApproval?.status || '').toUpperCase();
    if (requestStatus === 'PENDING') {
      return <span className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700"><Users className="h-3.5 w-3.5" /> Approval Requested</span>;
    }
    if (requestStatus === 'APPROVED' || String(row?.status || '').toLowerCase() === 'approved') {
      return <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700"><Check className="h-3.5 w-3.5" /> Final Approved</span>;
    }
    if (String(row?.status || '').toLowerCase() === 'rejected') return null;
    return <button type="button" onClick={() => openManagementApproval(row)} className="inline-flex items-center gap-1 rounded-lg border border-orange-300 bg-white px-3 py-2 text-xs font-black text-orange-600"><Users className="h-3.5 w-3.5" /> Management Approval</button>;
  }

  if (viewMode === 'list') {
    return (
      <DashboardShell currentUser={currentUser} onOpenProfile={() => setProfileOpen(true)} onLogout={handleLogout}>
        <div className="bg-[#f5f7fb] px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <button type="button" onClick={() => navigate('/dashboard')} className="btn-lift grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-orange-600 shadow-sm" title="Back">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-3">
                  <h1 className="text-3xl font-black text-slate-950">Quotations</h1>
                  <span className="text-sm font-black text-slate-500">{companyGroups.length} companies · {filteredQuotations.length} quotations</span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <input value={String(query ?? '')} onChange={(event) => setQuery(event.target.value)} placeholder="Quotation, company, lead or contact..." className="h-11 w-64 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold outline-none placeholder:text-slate-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-100" />
              <select value={validityFilter} onChange={(event) => setValidityFilter(event.target.value)} className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600"><option value="">Any validity</option><option value="valid">Valid</option><option value="expired">Expired</option></select>
              <select value={userFilter} onChange={(event) => setUserFilter(event.target.value)} className="h-11 w-60 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600 outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-100">
                <option value="">Filter by User</option>
                {userOptions.map((user) => <option key={user} value={user}>{user}</option>)}
              </select>
              <div className="relative">
                <button type="button" onClick={() => setFilterOpen((value) => !value)} className="btn-lift inline-flex h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-slate-700">
                  <Filter className="h-4 w-4" /> Quotation filter
                </button>
                {filterOpen && (
                  <QuotationFilterPopover
                    quotationStatusFilter={quotationStatusFilter}
                    adminApprovalFilter={adminApprovalFilter}
                    onQuotationStatusChange={setQuotationStatusFilter}
                    onAdminApprovalChange={setAdminApprovalFilter}
                    onClear={() => {
                      setQuery('');
                      setUserFilter('');
                      setQuotationStatusFilter('');
                      setAdminApprovalFilter('');
                    }}
                  />
                )}
              </div>
              <button type="button" onClick={loadPage} className="btn-lift inline-flex h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-slate-700">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
              <button type="button" onClick={() => startNew(quotationContext)} className="btn-lift inline-flex h-11 items-center gap-2 rounded-lg bg-orange-500 px-4 text-sm font-black text-white shadow-lg shadow-orange-500/20">
                <Plus className="h-4 w-4" /> New
              </button>
            </div>
          </div>

          {quotationContext && (
            <div className="mt-5 flex flex-col gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-black text-orange-700 sm:flex-row sm:items-center sm:justify-between">
              <span>Showing quotations for {quotationContext.clientName || 'selected client'}{quotationContext.annualYear ? ` (${quotationContext.annualYear})` : ''}.</span>
              <button type="button" onClick={() => navigate('/sales/quotations', { replace: true, state: {} })} className="btn-lift h-9 rounded-lg border border-orange-200 bg-white px-3 text-xs font-black text-orange-700">Show All</button>
            </div>
          )}

          {(error || notice) && (
            <div className={`mt-5 rounded-lg border px-4 py-3 font-bold ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
              {error || notice}
            </div>
          )}

          <div className="mt-5 flex items-center justify-between gap-4">
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm" role="group" aria-label="Quotation list view">
              <button type="button" onClick={() => { setListMode('company'); setExpandedCompany(''); }} aria-pressed={listMode === 'company'} className={`rounded-lg px-5 py-2.5 text-sm font-black transition ${listMode === 'company' ? 'bg-emerald-700 text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}>Company Wise</button>
              <button type="button" onClick={() => { setListMode('all'); setExpandedCompany(''); }} aria-pressed={listMode === 'all'} className={`rounded-lg px-5 py-2.5 text-sm font-black transition ${listMode === 'all' ? 'bg-emerald-700 text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}>All Quotations</button>
            </div>
            <p className="hidden text-xs font-bold text-slate-500 sm:block">{listMode === 'company' ? 'Grouped by company · latest company activity first' : 'Every quotation · latest quotation first'}</p>
          </div>

          <section className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-900/5">
            <div className="hidden-scrollbar max-h-[610px] overflow-auto">
              <table className="w-full min-w-[1050px] table-fixed text-left text-sm">
                <thead className="sticky top-0 z-20 bg-slate-50 text-xs font-black uppercase tracking-[0.06em] text-slate-600 shadow-sm">
                  <tr>
                    {(listMode === 'company' ? [
                      ['Company', 'w-[260px]'],
                      ['Lead Code', 'w-[140px]'],
                      ['Contact Person', 'w-[170px]'],
                      ['Quotations', 'w-[130px]'],
                      ['Item Count', 'w-[110px]'],
                      ['Grand Total', 'w-[150px]'],
                      ['Lead Status', 'w-[130px]']
                    ] : [
                      ['Quotation', 'w-[170px]'], ['Company', 'w-[250px]'], ['Lead Code', 'w-[130px]'], ['Date', 'w-[125px]'], ['Valid Until', 'w-[125px]'], ['Amount', 'w-[140px]'], ['Status / Actions', 'w-[210px]']
                    ]).map(([header, width]) => (
                      <th key={header} className={`border-r border-slate-100 px-4 py-5 last:border-r-0 ${width}`}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {loading ? (
                    <tr><td colSpan={7} className="px-5 py-14 text-center font-black text-slate-400">Loading quotations...</td></tr>
                  ) : listTotal === 0 ? (
                    <tr><td colSpan={7} className="px-5 py-14 text-center font-black text-slate-400">No quotations found.</td></tr>
                  ) : listMode === 'all' ? visibleQuotations.map((row, index) => (
                    <tr key={row._id || row.id} className={`transition hover:bg-emerald-50/40 ${index === 0 && page === 1 ? 'bg-emerald-50/60' : 'bg-white'}`}>
                      <td className="px-4 py-5"><span className="inline-flex items-center gap-2 font-black text-orange-600">{row.quotationNumber || '-'}{index === 0 && page === 1 && <em className="not-italic rounded-full bg-emerald-600 px-2 py-1 text-[9px] font-black uppercase text-white">Latest</em>}</span></td>
                      <td className="px-4 py-5"><strong className="block uppercase text-slate-800">{row.companyName || row.leadDetails?.companyName || 'Unnamed company'}</strong><small className="font-bold text-slate-500">{row.leadDetails?.contactPerson || '-'}</small></td>
                      <td className="px-4 py-5 font-black text-slate-600">{displayLeadCode(row)}</td>
                      <td className="px-4 py-5 font-bold text-slate-700">{formatDisplayDate(row.quotationDate || row.createdAt)}</td>
                      <td className="px-4 py-5 font-bold text-slate-700">{formatDisplayDate(row.validUntil)}</td>
                      <td className="px-4 py-5 font-black text-orange-600">{formatInr(Number(row.grandTotal) || 0)}</td>
                      <td className="px-4 py-5"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black uppercase text-slate-600">{row.status || 'draft'}</span><button type="button" onClick={() => showQuotationDetail(row)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-3 py-2 text-xs font-black text-emerald-700"><Eye className="h-3.5 w-3.5" /> View</button>{renderManagementApprovalAction(row)}{canReviseQuotation(row) && <button type="button" onClick={() => editQuotation(row)} className="rounded-lg border px-3 py-2 text-xs font-black text-orange-600">Edit</button>}</div></td>
                    </tr>
                  )) : visibleCompanyGroups.map((group) => {
                    const quotationCount = group.quotations.length;
                    const itemCount = group.quotations.reduce((sum, row) => sum + (row.items?.length || 0), 0);
                    const grandTotal = group.quotations.reduce((sum, row) => sum + (Number(row.grandTotal) || 0), 0);
                    const openCount = group.quotations.filter((row) => String(row.serviceState || 'open').toLowerCase() !== 'closed').length;
                    const leadStatus = openCount ? 'Open' : 'Closed';
                    const first = group.latestQuotation || group.quotations[0] || {};
                    const isOpen = expandedCompany === group.key;
                    return <React.Fragment key={group.key}>
                      <tr className="bg-white transition hover:bg-emerald-50/30">
                        <td className="px-4 py-5"><button type="button" onClick={() => setExpandedCompany(isOpen ? '' : group.key)} className="flex w-full items-center gap-3 text-left"><ChevronDown className={`h-5 w-5 shrink-0 text-emerald-700 transition ${isOpen ? 'rotate-180' : '-rotate-90'}`} /><span><strong className="block break-words uppercase text-slate-800">{group.company}</strong><small className="font-bold text-emerald-700">Click to view {quotationCount} quotation{quotationCount === 1 ? '' : 's'}</small><small className="mt-1 block font-bold text-slate-400">Latest: {first.quotationNumber || '-'} · {formatDisplayDate(first.quotationDate || first.createdAt)}</small></span></button></td>
                        <td className="px-4 py-5 font-black text-slate-600">{displayLeadCode(first)}</td>
                        <td className="px-4 py-5 font-black uppercase text-slate-600">{first.leadDetails?.contactPerson || '-'}</td>
                        <td className="px-4 py-5"><span className="rounded-full bg-blue-50 px-3 py-2 font-black text-blue-700">{quotationCount}</span></td>
                        <td className="px-4 py-5 font-black text-slate-700">{itemCount}</td>
                        <td className="px-4 py-5 font-black text-orange-600">{formatInr(grandTotal)}</td>
                        <td className="px-4 py-5"><span className={`rounded-full border px-3 py-2 text-xs font-black uppercase ${leadStatus === 'Open' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{leadStatus}{openCount && openCount !== quotationCount ? ` (${openCount})` : ''}</span></td>
                      </tr>
                      {isOpen && <tr><td colSpan={7} className="bg-slate-50 p-5"><div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="font-black text-slate-900">Company Wise Quotations</h3><p className="text-xs font-bold text-slate-500">Latest quotation is always listed first. Select View to open an individual quotation.</p></div><span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-700">{quotationCount} total</span></div><div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[1050px] text-left text-xs"><thead className="bg-slate-100 uppercase text-slate-500"><tr>{['Quotation No.', 'Date', 'Valid Until', 'Items', 'Amount', 'Lead Status', 'Quotation Status', 'Actions'].map((heading) => <th key={heading} className="p-3">{heading}</th>)}</tr></thead><tbody>{group.quotations.map((row, quotationIndex) => <tr key={row._id || row.id} className={`border-t ${quotationIndex === 0 ? 'bg-emerald-50/60' : ''}`}><td className="p-3 font-black text-orange-600"><span className="inline-flex items-center gap-2">{row.quotationNumber || '-'}{quotationIndex === 0 && <em className="not-italic rounded-full bg-emerald-600 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-white">Latest</em>}</span></td><td className="p-3 font-bold">{formatDisplayDate(row.quotationDate || row.createdAt)}</td><td className="p-3 font-bold">{formatDisplayDate(row.validUntil)}</td><td className="p-3 font-black">{row.items?.length || 0}</td><td className="p-3 font-black text-orange-600">{formatInr(Number(row.grandTotal) || 0)}</td><td className="p-3"><span className={`font-black uppercase ${String(row.serviceState || 'open').toLowerCase() === 'closed' ? 'text-red-600' : 'text-emerald-700'}`}>{row.serviceState || 'open'}</span></td><td className="p-3 font-black uppercase">{row.status || 'draft'}</td><td className="p-3"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => showQuotationDetail(row)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-white px-3 py-2 font-black text-emerald-700"><Eye className="h-3.5 w-3.5" /> View</button>{renderManagementApprovalAction(row)}{canReviseQuotation(row) && <button type="button" onClick={() => editQuotation(row)} className="rounded-lg border px-3 py-2 font-black text-orange-600">Edit</button>}</div></td></tr>)}</tbody></table></div></td></tr>}
                    </React.Fragment>;
                  })}
                </tbody>
              </table>
            </div>
            <QuotationPager
              page={page}
              rowsPerPage={rowsPerPage}
              setPage={setPage}
              setRowsPerPage={setRowsPerPage}
              total={listTotal}
              totalPages={totalPages}
              showing={listMode === 'company' ? visibleCompanyGroups.length : visibleQuotations.length}
              label={listMode === 'company' ? 'companies' : 'quotations'}
            />
          </section>
        </div>
        {detailQuotation && (
          <QuotationDetailModal
            quotation={detailQuotation}
            revisionCount={Math.max(0, filteredQuotations.filter((row) => normalizeSearchValue(row.leadDetails?.companyName) === normalizeSearchValue(detailQuotation.leadDetails?.companyName)).length - 1)}
            onClose={() => setDetailQuotation(null)}
            onRevise={() => editQuotation(detailQuotation)}
          />
        )}
        {managementApproval && (
          <div className="pending-decision-backdrop management-approval-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !managementApprovalSaving) setManagementApproval(null); }}>
            <form onSubmit={submitManagementApproval} className="management-approval-modal">
              <header className="management-approval-header">
                <div className="management-approval-title-icon"><Users className="h-6 w-6" /></div>
                <div><p>Final approval request</p><h2>Management Approval</h2></div>
                <button type="button" disabled={managementApprovalSaving} onClick={() => setManagementApproval(null)} aria-label="Close management approval"><X className="h-5 w-5" /></button>
              </header>
              <div className="management-approval-body">
                <div className="management-approval-info"><AlertTriangle className="h-5 w-5" /><p>Fill these details to send the quotation to Pending Approval. The selected Super Admin will give the final approval there.</p></div>
                <dl className="management-approval-summary">
                  <div><dt>Quotation No.</dt><dd>{managementApproval.row.quotationNumber || '-'}</dd></div>
                  <div><dt>Company</dt><dd>{managementApproval.row.companyName || managementApproval.row.leadDetails?.companyName || '-'}</dd></div>
                  <div><dt>Date</dt><dd>{formatDisplayDate(managementApproval.row.quotationDate || managementApproval.row.createdAt)}</dd></div>
                </dl>
                <div className="management-approval-grid">
                  <label><span>Price approved by <b>*</b></span><select required disabled={managementApproversLoading || managementApprovalSaving} value={managementApproval.approverId} onChange={(event) => setManagementApproval((current) => ({ ...current, approverId: event.target.value }))}><option value="">{managementApproversLoading ? 'Loading Super Admins...' : 'Select Super Admin'}</option>{managementApprovers.map((approver) => <option key={approver.id} value={approver.id}>{approver.name}{approver.email && approver.email !== approver.name ? ` (${approver.email})` : ''}</option>)}</select></label>
                  <label><span>Amount (₹)</span><div className="management-approval-amount"><i>₹</i><input readOnly aria-readonly="true" value={formatInr(Number(managementApproval.row.grandTotal) || 0).replace('₹', '').trim()} /></div><small>Auto-fetched from quotation</small></label>
                  <div className="management-source-field"><span>Approval Source <b>*</b></span><div className={`management-source-picker ${managementSourceOpen ? 'is-open' : ''}`}><button type="button" className="management-source-trigger" disabled={managementApprovalSaving} aria-haspopup="listbox" aria-expanded={managementSourceOpen} onClick={() => setManagementSourceOpen((open) => !open)}>{managementApproval.source ? <><i className={`management-source-icon is-${managementApproval.source.toLowerCase()}`}><ApprovalSourceIcon source={managementApproval.source} className="h-5 w-5" /></i><strong>{MANAGEMENT_APPROVAL_SOURCES.find((option) => option.value === managementApproval.source)?.label}</strong></> : <strong className="is-placeholder">Select Source</strong>}<ChevronDown className="ml-auto h-4 w-4" /></button>{managementSourceOpen && <div className="management-source-menu" role="listbox" aria-label="Approval Source">{MANAGEMENT_APPROVAL_SOURCES.map((option) => <button type="button" role="option" aria-selected={managementApproval.source === option.value} key={option.value} onClick={() => { setManagementApproval((current) => ({ ...current, source: option.value })); setManagementSourceOpen(false); }}><i className={`management-source-icon is-${option.value.toLowerCase()}`}><ApprovalSourceIcon source={option.value} className="h-5 w-5" /></i><span>{option.label}</span>{managementApproval.source === option.value && <Check className="ml-auto h-4 w-4 text-emerald-600" />}</button>)}</div>}</div></div>
                  <label><span>Note <em>(Optional)</em></span><textarea maxLength={500} rows={5} disabled={managementApprovalSaving} value={managementApproval.note} onChange={(event) => setManagementApproval((current) => ({ ...current, note: event.target.value }))} placeholder="Add any note (optional)..." /><small className="management-note-count">{managementApproval.note.length}/500</small></label>
                </div>
              </div>
              <footer className="management-approval-footer"><button type="button" disabled={managementApprovalSaving} onClick={() => setManagementApproval(null)}>Cancel</button><button type="submit" disabled={managementApprovalSaving || managementApproversLoading || !managementApproval.approverId || !managementApproval.source}>{managementApprovalSaving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Send to Pending Approval</button></footer>
            </form>
          </div>
        )}
        {previewQuotation && <QuotationPreviewDrawer quotation={previewQuotation} currentUser={currentUser} onClose={() => setPreviewQuotation(null)} onBackToPendingApproval={fromPendingApproval ? () => navigate('/pending-approval') : null} />}
        {successModal && (
          <SuccessDialog
            title={successModal.title}
            message={successModal.message}
            onClose={() => setSuccessModal(null)}
          />
        )}
        {profileOpen && <ProfileModal user={currentUser} saving={false} onClose={() => setProfileOpen(false)} onLogout={handleLogout} onSave={() => {}} onUpdatePassword={() => {}} />}
      </DashboardShell>
    );
  }

  return (
    <DashboardShell currentUser={currentUser} onOpenProfile={() => setProfileOpen(true)} onLogout={handleLogout}>
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-4">
          <button type="button" onClick={showQuotationList} className="btn-lift inline-flex h-11 w-11 items-center justify-center rounded-lg border border-emerald-100 bg-white text-orange-600 shadow-sm">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-emerald-700">Quotation Desk</p>
            <h1 className="mt-1 text-3xl font-black text-slate-950">{editingId ? 'Edit Quotation' : 'Create Quotation'}</h1>
          </div>
          </div>
          <div className="flex flex-wrap gap-2"><input ref={bulkInputRef} type="file" accept=".xlsx,.xls" onChange={readBulkFile} className="hidden" /><button type="button" onClick={() => bulkInputRef.current?.click()} className="btn-lift inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 font-black text-white shadow-lg shadow-emerald-700/20"><UploadCloud className="h-4 w-4" /> Bulk Upload</button><button type="button" onClick={showQuotationList} className="btn-lift inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 font-black text-slate-700 shadow-sm"><Eye className="h-4 w-4" /> View Quotations</button></div>
        </div>

        {bulkPreview && <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"><div className="max-h-[88vh] w-full max-w-6xl overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-2xl"><header className="flex items-center justify-between border-b border-emerald-100 bg-gradient-to-r from-emerald-50 to-orange-50 p-5"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-700 text-white"><FileSpreadsheet /></span><div><h2 className="text-xl font-black text-slate-950">Quotation bulk preview</h2><p className="text-sm font-bold text-slate-500">{bulkPreview.fileName} · {bulkPreview.quotations.length} quotations scanned</p></div></div><button onClick={() => setBulkPreview(null)} className="grid h-10 w-10 place-items-center rounded-xl border bg-white"><X /></button></header><div className="max-h-[60vh] overflow-auto p-5"><div className="mb-4 grid grid-cols-3 gap-3"><div className="rounded-2xl bg-emerald-50 p-4"><small className="font-black uppercase text-emerald-700">Ready to import</small><strong className="block text-2xl text-slate-950">{bulkPreview.quotations.filter((row) => !row.__errors.length).length}</strong></div><div className="rounded-2xl bg-amber-50 p-4"><small className="font-black uppercase text-amber-700">Will be skipped</small><strong className="block text-2xl text-slate-950">{bulkPreview.quotations.filter((row) => row.__errors.length).length}</strong></div><div className="rounded-2xl bg-sky-50 p-4"><small className="font-black uppercase text-sky-700">Valid items</small><strong className="block text-2xl text-slate-950">{bulkPreview.quotations.filter((row) => !row.__errors.length).reduce((sum, row) => sum + row.items.length, 0)}</strong></div></div><table className="w-full min-w-[850px] overflow-hidden rounded-2xl text-left text-sm"><thead className="bg-slate-100 text-xs uppercase text-slate-500"><tr><th className="p-3">Quotation</th><th className="p-3">Company</th><th className="p-3">Date</th><th className="p-3">Items</th><th className="p-3">Amount</th><th className="p-3">Import status</th></tr></thead><tbody>{bulkPreview.quotations.slice(0, 200).map((row) => <tr key={`${row.quotationNumber}-${row.__sourceRows[0]}`} className={`border-b ${row.__errors.length ? 'bg-amber-50/50' : ''}`}><td className="p-3 font-black">{row.quotationNumber || 'Missing'}</td><td className="p-3 font-bold">{row.leadDetails.companyName || 'Missing'}</td><td className="p-3">{row.quotationDate || '-'}</td><td className="p-3">{row.items.length}</td><td className="p-3 font-black">₹{row.items.reduce((sum, item) => sum + ((Number(item.unit) || 1) * item.basicAmount), 0).toLocaleString('en-IN')}</td><td className="p-3">{row.__errors.length ? <span className="font-bold text-amber-700">Skipped · {row.__errors.join(', ')}</span> : <span className="inline-flex items-center gap-1 font-black text-emerald-700"><Check className="h-4 w-4" /> Ready</span>}</td></tr>)}</tbody></table></div><footer className="flex items-center justify-between gap-4 border-t bg-slate-50 p-5"><p className="text-sm font-bold text-slate-500">Incomplete quotations will be skipped automatically. Valid quotations will still be imported.</p><div className="flex shrink-0 gap-2"><button onClick={() => setBulkPreview(null)} className="rounded-xl border bg-white px-5 py-3 font-black text-slate-600">Cancel</button><button disabled={bulkImporting || !bulkPreview.quotations.some((row) => !row.__errors.length)} onClick={importBulkQuotations} className="rounded-xl bg-emerald-700 px-6 py-3 font-black text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-40">{bulkImporting ? 'Importing…' : `Import ${bulkPreview.quotations.filter((row) => !row.__errors.length).length} Ready Quotations`}</button></div></footer></div></div>}

        {(error || notice) && (
          <div className={`mt-5 rounded-lg border px-4 py-3 font-bold ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
            {error || notice}
          </div>
        )}

        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-emerald-700" />
            <h2 className="text-lg font-black text-slate-950">Auto-Fetched Quote Details</h2>
          </div>
          <div className="mt-5">
            <Field label={quotationContext?.sourceType === 'client' ? 'Client Reference' : 'Select Lead'}>
              <LeadSelect
                value={quotation.leadId || ''}
                disabled={fetchedQuoteDetailsLocked}
                onChange={requestLeadSelection}
                options={[
                  ...(quotationContext?.sourceType === 'client' && quotationContext.clientId ? [{
                    value: quotationContext.clientId,
                    code: quotationContext.clientUniqueId || quotationContext.leadCode || 'Client',
                    company: quotationContext.clientName || 'Selected client'
                  }] : []),
                  ...leads.map((lead, index) => ({
                    value: lead._id || lead.id,
                    code: displayLeadCode(lead, index),
                    company: lead.company || 'Untitled company'
                  }))
                ]}
              />
            </Field>
          </div>
          <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {[
              ['referredBy', 'Referred By'],
              ['salutation', 'Salutation'],
              ['contactPerson', 'Contact Person'],
              ['designation', 'Designation'],
              ['mobileNo1', 'Mobile No. 1'],
              ['mobileNo2', 'Mobile No. 2'],
              ['companyName', 'Company Name'],
              ['addressLine1', 'Address Line 1'],
              ['addressLine2', 'Address Line 2'],
              ['addressLine3', 'Address Line 3'],
              ['state', 'State'],
              ['city', 'City'],
              ['pinCode', 'Pincode'],
              ['gstNumber', 'GST Number']
            ].map(([field, label]) => (
              <Field key={field} label={label}>
                {field === 'salutation' ? (
                  <div className="quotation-salutation-control">
                    <select value={quotation.leadDetails.salutation || ''} onChange={(event) => setLeadDetail('salutation', event.target.value)} disabled={fetchedQuoteDetailsLocked && hasFetchedQuotationValue(quotation.leadDetails.salutation)} className={`form-input quotation-salutation-select ${fetchedQuoteDetailsLocked && hasFetchedQuotationValue(quotation.leadDetails.salutation) ? 'quotation-fetched-locked' : 'quotation-missing-editable'}`}>
                      <option value="">Select salutation</option>
                      {salutationOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <ChevronDown className="quotation-salutation-chevron h-4 w-4" />
                  </div>
                ) : (
                  <div>
                    <input
                      value={quotation.leadDetails[field] || ''}
                      onChange={(event) => setLeadDetail(field, field === 'gstNumber' ? event.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 15) : event.target.value)}
                      maxLength={field === 'gstNumber' ? 15 : undefined}
                      minLength={field === 'gstNumber' ? 15 : undefined}
                      autoComplete={field === 'gstNumber' ? 'off' : undefined}
                      className={`form-input font-black uppercase ${isFetchedLeadDetailLocked(field) ? 'quotation-fetched-locked' : 'quotation-missing-editable'}`}
                      placeholder={field === 'gstNumber' ? 'Enter 15-character GST number' : `Enter ${label.toLowerCase()}`}
                      readOnly={isFetchedLeadDetailLocked(field)}
                    />
                    {field === 'gstNumber' && <p className={`mt-1 text-right text-xs font-black ${(quotation.leadDetails.gstNumber || '').length === 15 ? 'text-emerald-600' : 'text-slate-400'}`}>{(quotation.leadDetails.gstNumber || '').length}/15</p>}
                  </div>
                )}
              </Field>
            ))}
          </div>
          {selectedLead && <p className="mt-4 text-sm font-bold text-emerald-700">Lead details auto-fetched from {selectedLead.leadCode || selectedLead.company}.</p>}
          {!selectedLead && quotationContext && <p className="mt-4 text-sm font-bold text-emerald-700">Client details auto-fetched from {quotationContext.clientUniqueId || quotationContext.leadCode || 'selected client'} - {quotationContext.clientName || 'Selected client'}.</p>}
        </section>

        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-black text-slate-950">Manual Quote Details</h2>
              <p className="text-sm font-bold text-slate-500">Only this section is editable while fetched lead data stays fixed.</p>
            </div>
          </div>
          <div className="mt-5 max-w-sm">
            <Field label="Quotation Valid Until" required>
              <PremiumDatePicker value={quotation.validUntil || ''} onChange={(event) => setQuotation((current) => ({ ...current, validUntil: event.target.value }))} />
            </Field>
          </div>

          <div className="mt-8 rounded-lg border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div><h3 className="font-black text-slate-900">Quotation Items</h3><p className="mt-0.5 text-xs font-bold text-slate-500">{quotation.pricingMode ? `${quotation.pricingMode === 'combined' ? 'Combined' : 'Individual'} pricing selected` : 'Choose the pricing type first.'}</p></div>
              {quotation.pricingMode && !fetchedQuoteDetailsLocked && <button type="button" onClick={addItem} className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 font-black text-white">
                <Plus className="h-4 w-4" /> Add Row
              </button>}
            </div>
            {!quotation.pricingMode ? <div className="grid gap-4 p-5 sm:grid-cols-2">
              <button type="button" onClick={() => selectPricingMode('combined')} className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/70 p-5 text-left transition hover:-translate-y-0.5 hover:border-emerald-500 hover:shadow-lg"><span className="text-base font-black text-emerald-800">Combined Price</span><span className="mt-1 block text-sm font-bold text-emerald-700/80">Create manual service groups with a separate combined price for each group.</span></button>
              <button type="button" onClick={() => selectPricingMode('individual')} className="rounded-2xl border-2 border-blue-200 bg-blue-50/70 p-5 text-left transition hover:-translate-y-0.5 hover:border-blue-500 hover:shadow-lg"><span className="text-base font-black text-blue-800">Individual Price</span><span className="mt-1 block text-sm font-bold text-blue-700/80">Separate basic amount for every quotation row.</span></button>
            </div> : <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3"><div className="flex items-center gap-3"><span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider ${quotation.pricingMode === 'combined' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}`}>{quotation.pricingMode} Price</span>{quotation.pricingMode === 'combined' && <span className="text-sm font-black text-emerald-700">Combined total: {formatInr(combinedQuotationTotal(quotation, quotation.items))}</span>}</div><button type="button" onClick={() => setQuotation((current) => ({ ...current, pricingMode: '', combinedBasicAmount: '', combinedPricingGroups: [] }))} className="text-xs font-black text-slate-500 hover:text-orange-600">Change pricing type</button></div>}
            {quotation.pricingMode === 'combined' && (
              <div className="space-y-4 border-b border-slate-200 bg-emerald-50/30 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><h4 className="font-black text-slate-950">Combined Pricing Groups</h4><p className="mt-1 text-xs font-bold text-slate-500">Each group starts with all currently unassigned services. Remove any rows you do not want, then enter one Basic Amount for the group.</p></div>
                  <button type="button" onClick={addCombinedPricingGroup} className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-black text-white"><Plus className="h-4 w-4" /> Add Combined Group</button>
                </div>
                {(quotation.combinedPricingGroups || []).map((group, groupIndex) => {
                  const indexedItems = quotation.items.map((item, itemIndex) => ({ item, itemIndex, itemKey: quotationItemKey(item, itemIndex) }));
                  const groupItems = indexedItems.filter((row) => (group.itemKeys || []).includes(row.itemKey));
                  return (
                    <section key={group.id} className="overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-sm">
                      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100 bg-emerald-50 px-4 py-3">
                        <input value={group.name || ''} maxLength={120} onChange={(event) => updateCombinedPricingGroup(group.id, { name: event.target.value })} className="h-10 min-w-56 rounded-lg border border-emerald-200 bg-white px-3 font-black text-slate-900 outline-none focus:ring-4 focus:ring-emerald-100" aria-label={`Combined group ${groupIndex + 1} name`} />
                        <button type="button" onClick={() => deleteCombinedPricingGroup(group.id)} className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-black text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /> Delete Group</button>
                      </header>
                      <div className="overflow-auto">
                        <table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-[11px] font-black uppercase text-slate-500"><tr><th className="px-3 py-3">Remove</th><th className="px-3 py-3">Sr.No</th><th className="px-3 py-3">Service Category</th><th className="px-3 py-3">Services Offered</th><th className="px-3 py-3">Applicant Type</th><th className="px-3 py-3">Period</th></tr></thead><tbody className="divide-y divide-slate-100">{groupItems.length ? groupItems.map(({ item, itemIndex, itemKey }) => <tr key={itemKey}><td className="px-3 py-3"><button type="button" onClick={() => removeServiceFromCombinedGroup(group.id, itemKey)} className="grid h-8 w-8 place-items-center rounded-lg text-red-600 hover:bg-red-50" title="Remove from this group"><X className="h-4 w-4" /></button></td><td className="px-3 py-3 font-black">{itemIndex + 1}</td><td className="px-3 py-3 font-black">{item.eprCategory || item.serviceCategory || '-'}</td><td className="px-3 py-3 font-bold text-emerald-700">{item.servicesOffered || '-'}</td><td className="px-3 py-3 font-bold">{getQuotationApplicantType(item)}</td><td className="px-3 py-3 font-bold">{quotationServicePeriodDisplay(item)}</td></tr>) : <tr><td colSpan={6} className="px-4 py-8 text-center font-black text-slate-400">No services remain in this group. Delete the group or create a group from the unassigned rows.</td></tr>}</tbody></table>
                      </div>
                      <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-emerald-100 bg-emerald-50/50 px-4 py-3"><label className="text-xs font-black uppercase tracking-wider text-emerald-800">Group Basic Amount</label><div className="flex h-10 w-56 overflow-hidden rounded-lg border border-emerald-300 bg-white focus-within:ring-4 focus-within:ring-emerald-100"><span className="grid w-10 place-items-center border-r border-emerald-100 font-black">₹</span><input type="number" min="0" value={group.basicAmount ?? ''} onChange={(event) => updateCombinedPricingGroup(group.id, { basicAmount: event.target.value })} className="min-w-0 flex-1 px-3 font-black outline-none" placeholder="50000" /></div></footer>
                    </section>
                  );
                })}
                {!(quotation.combinedPricingGroups || []).length && <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center font-black text-slate-400">No pricing groups. Use Add Combined Group.</div>}
              </div>
            )}
            <div className="overflow-auto p-4">
              {!quotation.pricingMode ? null : quotation.items.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center font-black text-slate-400">No quotation items added.</div>
              ) : (
                <table className="w-full min-w-[1180px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500">
                    <tr>
                      {['Sr.No', 'EPR / Service Period', 'Industry Type', 'Business Category', 'Service Category', 'Service Start Date', 'Service End Date', 'Applicant Type', 'Added By', ...(showUomColumn ? ['UOM'] : []), 'Unit', 'Unit Name', ...(quotation.pricingMode === 'individual' ? ['Basic Amount (INR)'] : []), 'Actions'].map((header) => (
                        <th key={header} className="px-3 py-3">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {quotation.items.map((item, index) => {
                      const freezeDates = readItemDraftValue(index, 'transitionPeriod', item.transitionPeriod || 'No') === 'Yes';
                      return (
                      <tr key={index} className="align-middle">
                        <td className="px-3 py-4 text-center font-black">{index + 1}</td>
                        <td className="px-3 py-4">{isPwpEprCreditItem(item) ? <span className="inline-flex min-w-40 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 font-black text-slate-500">Not required</span> : <button type="button" onClick={() => openFinancialYearModal(index)} className="min-w-40 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-left font-black text-[#30737B] shadow-sm transition hover:border-teal-400 hover:bg-teal-100"><span className="block text-[10px] uppercase tracking-wider text-teal-600">{requiresEprDataYear(item.eprCategory || item.serviceCategory) ? 'Select EPR Data Year' : 'Select Service Period'}</span><span className="mt-0.5 block">{requiresEprDataYear(item.eprCategory || item.serviceCategory) ? (item.financialYear || 'Select EPR Data Year') : quotationServicePeriodDisplay(item)}</span></button>}</td>
                        {editingItemIndex === index ? (
                          <>
                            {selectedLead ? <>
                              <td className="px-3 py-4 font-black text-slate-700">{item.industryType || '-'}</td>
                              <td className="px-3 py-4 font-black uppercase text-slate-700">{item.businessCategory || '-'}</td>
                              <td className="px-3 py-4 font-black uppercase text-slate-700">{item.eprCategory || item.serviceCategory || '-'}</td>
                              <td className="px-3 py-4"><input type="date" disabled={freezeDates} value={String(readItemDraftValue(index, 'serviceStartDate', normalizeDateInputValue(item.serviceStartDate)) ?? '')} onChange={(event) => setServiceStartDate(index, event.target.value)} className={`h-10 w-40 rounded-lg border border-slate-300 px-3 font-black outline-none ${freezeDates ? 'cursor-not-allowed bg-slate-50 text-slate-600' : 'bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-100'}`} /></td>
                              <td className="px-3 py-4"><input type="date" disabled value={String(readItemDraftValue(index, 'serviceEndDate', normalizeDateInputValue(item.serviceEndDate)) ?? '')} readOnly className={`h-10 w-40 rounded-lg border border-slate-300 px-3 font-black text-slate-600 outline-none ${freezeDates ? 'cursor-not-allowed bg-slate-50' : 'bg-slate-50 cursor-not-allowed'}`} /></td>
                              <td className="px-3 py-4 font-black text-slate-700">{getQuotationApplicantType(item)}</td>
                              <td className="px-3 py-4 font-black text-emerald-700">{item.serviceAddedBy || '-'}</td>
                            </> : <>
                              <td className="px-3 py-4"><QuoteSelect value={readItemDraftValue(index, 'industryType', item.industryType || '')} options={allIndustryTypeOptions} placeholder="Select industry" onChange={(value) => setItemDraft(index, 'industryType', value)} categoryLabel="Industry Type" onAddOption={canManageDropdownOptions ? (name) => addDropdownOption('industryType', name) : undefined} /></td>
                              <td className="px-3 py-4"><QuoteSelect value={readItemDraftValue(index, 'businessCategory', item.businessCategory || '')} options={allBusinessCategoryOptions} placeholder="Select business category" onChange={(value) => setItemDraft(index, 'businessCategory', value, (draft) => ({ ...draft, unitLabel: String(value).trim().toLowerCase() === 'epr credit' ? draft.unitLabel : '', annualReturnEprCreditYears: String(value).trim().toLowerCase() === 'epr credit' ? quotationEprCreditYears(draft) : [] }))} categoryLabel="Business Category" onAddOption={canManageDropdownOptions ? (name) => addDropdownOption('businessCategory', name) : undefined} /></td>
                              <td className="px-3 py-4 font-black uppercase text-slate-700">{item.eprCategory || item.serviceCategory || '-'}</td>
                              <td className="px-3 py-4"><input type="date" disabled={freezeDates} value={String(readItemDraftValue(index, 'serviceStartDate', normalizeDateInputValue(item.serviceStartDate)) ?? '')} onChange={(event) => setServiceStartDate(index, event.target.value)} className={`h-10 w-40 rounded-lg border border-slate-300 px-3 font-black outline-none ${freezeDates ? 'cursor-not-allowed bg-slate-50 text-slate-600' : 'bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-100'}`} /></td>
                              <td className="px-3 py-4"><input type="date" disabled value={String(readItemDraftValue(index, 'serviceEndDate', normalizeDateInputValue(item.serviceEndDate)) ?? '')} readOnly className={`h-10 w-40 rounded-lg border border-slate-300 px-3 font-black text-slate-600 outline-none ${freezeDates ? 'cursor-not-allowed bg-slate-50' : 'bg-slate-50 cursor-not-allowed'}`} /></td>
                              <td className="min-w-[230px] px-3 py-4"><PiboDependentSelect compact required parent={readItemDraftValue(index, 'piboParent', item.piboParent || item.piboCategoryParent || inferPiboParent(item.piboCategory))} value={readItemDraftValue(index, 'piboCategory', item.piboCategory || '')} categories={piboCategories} loading={piboCategoriesLoading} onChange={(parent, child) => setPiboCategoryDraft(index, parent, child)} onAddCategory={canManageDropdownOptions ? addPiboCategory : undefined} /></td>
                              <td className="px-3 py-4 font-black text-emerald-700">{item.serviceAddedBy || '-'}</td>
                            </>}
                            {showUomColumn && <td className="px-3 py-4">{isEprCreditItem({ ...item, businessCategory: readItemDraftValue(index, 'businessCategory', item.businessCategory || '') }) ? <select aria-label={`UOM for quotation item ${index + 1}`} value={String(readItemDraftValue(index, 'unitLabel', item.unitLabel || '') || '').toUpperCase()} onChange={(event) => setItemDraft(index, 'unitLabel', event.target.value)} className="h-10 min-w-24 rounded-lg border border-slate-300 bg-white px-3 font-black uppercase outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"><option value="">Select UOM</option>{EPR_CREDIT_UOM_OPTIONS.map((uom) => <option key={uom} value={uom}>{uom}</option>)}</select> : <span className="font-black text-slate-400">-</span>}</td>}
                            <td className="px-3 py-4"><input value="1" disabled className="h-10 w-24 cursor-not-allowed rounded-lg border border-slate-300 bg-slate-50 px-3 font-black text-slate-600 outline-none" placeholder="1" /></td>
                            <td className="px-3 py-4"><input aria-label={`Unit Name for quotation item ${index + 1}`} maxLength={120} value={String(readItemDraftValue(index, 'unitName', item.unitName || '') ?? '')} onChange={(event) => setItemDraft(index, 'unitName', event.target.value)} className="h-10 min-w-40 rounded-lg border border-slate-300 bg-white px-3 font-black outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" placeholder="Enter unit name" /></td>
                            {quotation.pricingMode === 'individual' && <td className="px-3 py-4">
                              <div className="flex h-10 min-w-48 overflow-hidden rounded-lg border border-slate-300 bg-white focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-100">
                                <span className="grid w-10 place-items-center border-r border-slate-200 font-black text-slate-800">₹</span>
                                <input type="number" min="0" value={String(readItemDraftValue(index, 'basicAmount', item.basicAmount ?? '') ?? '')} onChange={(event) => setItemDraft(index, 'basicAmount', event.target.value)} className="min-w-0 flex-1 px-3 font-black outline-none" placeholder="20000" />
                              </div>
                            </td>}
                            <td className="px-3 py-4">
                              <div className="flex items-center gap-2">
                                <button type="button" onClick={() => saveItem(index)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-black text-white"><Save className="h-4 w-4" /> Save</button>
                                <button type="button" onClick={() => cancelItemEdit(index)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-slate-700"><X className="h-4 w-4" /> Cancel</button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-4 font-black">{item.industryType || '-'}</td>
                            <td className="px-3 py-4 font-black uppercase">{item.businessCategory || '-'}</td>
                            <td className="px-3 py-4 font-black uppercase">{item.eprCategory || item.serviceCategory || '-'}</td>
                            <td className="px-3 py-4 font-black">{formatServiceDate(item.serviceStartDate)}</td>
                            <td className="px-3 py-4 font-black">{formatServiceDate(item.serviceEndDate)}</td>
                            <td className="px-3 py-4 font-black uppercase">{getQuotationApplicantType(item)}</td>
                            <td className="px-3 py-4 font-black text-emerald-700">{item.serviceAddedBy || '-'}</td>
                            {showUomColumn && <td className="px-3 py-4 font-black uppercase">{isEprCreditItem(item) ? (item.unitLabel || '-') : '-'}</td>}
                            <td className="px-3 py-4 font-black uppercase">{item.unit || '-'}</td>
                            <td className="px-3 py-4 font-black uppercase">{item.unitName || '-'}</td>
                            {quotation.pricingMode === 'individual' && <td className="px-3 py-4 font-black text-orange-600">{formatInr(item.basicAmount)}</td>}
                            <td className="px-3 py-4">
                              <div className="flex items-center gap-3">
                                <button type="button" onClick={() => startEditItem(index)} className="inline-flex h-9 items-center gap-2 rounded-lg px-2 text-sm font-black text-blue-600 hover:bg-blue-50"><Edit3 className="h-4 w-4" /> Edit</button>
                                <button type="button" onClick={() => removeItem(index)} className="inline-flex h-9 items-center gap-2 rounded-lg px-2 text-sm font-black text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /> Delete</button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    ); })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">Terms & Conditions</h2>
          <p className="mt-1 text-sm font-bold text-slate-500">Select exactly one payment term. Additional custom terms can be added below.</p>
          <div className="mt-4 grid gap-3">{PAYMENT_TERM_OPTIONS.map((term) => { const checked = quotation.paymentTerm === term; return <label key={term} className={`flex cursor-pointer items-center gap-4 rounded-xl border p-4 transition ${checked ? 'border-emerald-400 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-100' : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-200'}`}><input type="radio" name="quotation-payment-term" checked={checked} onChange={() => togglePaymentTerm(term)} className="h-5 w-5 border-slate-300 accent-emerald-700" /><span className="font-black">{term}</span></label>; })}</div>
          <div className="mt-4 space-y-3">{quotation.terms.map((term, index) => PAYMENT_TERM_OPTIONS.includes(term) ? null : <div key={`custom-term-${index}`} className={`flex items-center gap-3 rounded-xl border p-3 transition ${quotation.paymentTerm === term && String(term || '').trim() ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-100' : 'border-slate-200 bg-white'}`}><input type="radio" name="quotation-payment-term" checked={quotation.paymentTerm === term && Boolean(String(term || '').trim())} disabled={!String(term || '').trim()} onChange={() => setQuotation((current) => ({ ...current, paymentTerm: term }))} className="h-5 w-5 shrink-0 border-slate-300 accent-emerald-700 disabled:cursor-not-allowed" aria-label="Select this custom payment term" /><input value={String(term || '')} onChange={(event) => setCustomTerm(index, event.target.value)} className="form-input flex-1 font-black" placeholder="Enter additional term or condition" /><button type="button" onClick={() => removeCustomTerm(index)} className="inline-flex h-10 items-center gap-2 rounded-lg px-3 font-black text-red-500 hover:bg-red-50"><X className="h-4 w-4" />Remove</button></div>)}</div>
          <button type="button" onClick={addCustomTerm} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 font-black text-slate-700 hover:bg-slate-50"><Plus className="h-4 w-4" />Add Term</button>
        </section>

        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">Scope of Work</h2>
          <p className="mt-1 text-sm font-bold text-slate-500">The available package is selected from the Basic Amount: up to ₹75,000 Basic, above ₹75,000 and up to ₹1,00,000 Premium, and above ₹1,00,000 Super Premium.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {QUOTATION_SCOPE_PRESET_OPTIONS.filter((option) => option.key === eligibleScopePresetKey).map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => applyScopePreset(option.key)}
                className={`inline-flex min-h-11 items-center rounded-lg px-4 font-black shadow-sm transition ${
                  option.key === 'basic'
                    ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : option.key === 'premium'
                      ? 'border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                      : 'border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100'
                }`}
              >
                {option.label}
              </button>
            ))}
            {!eligibleScopePresetKey && <p className="py-3 text-sm font-black text-slate-400">Enter the Basic Amount to view the applicable scope package.</p>}
          </div>
          <p className="mt-2 text-xs font-bold text-slate-500">Selecting a package replaces the current scope list with the standard package deliverables from your EPR package matrix.</p>
          <div className="mt-4 space-y-3">
            {(quotation.scopeOfWork || []).map((item, index) => <div key={index} className="flex items-center gap-3"><span className="w-8 text-right font-black">{index + 1}.</span><input value={String(item ?? '')} onChange={(event) => setScopeItem(index, event.target.value)} className="form-input flex-1 font-black" placeholder="Enter scope of work" /><button type="button" onClick={() => removeScopeItem(index)} className="inline-flex h-10 items-center gap-2 rounded-lg px-3 font-black text-red-500 hover:bg-red-50"><X className="h-4 w-4" /> Remove</button></div>)}
            {!(quotation.scopeOfWork || []).length && <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center font-black text-slate-400">No scope of work added.</div>}
          </div>
          <button type="button" onClick={addScopeItem} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 font-black text-slate-700 hover:bg-slate-50"><Plus className="h-4 w-4" /> Add Scope</button>
        </section>

        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" disabled={saving} onClick={() => saveQuotation('draft')} className="btn-lift inline-flex min-h-11 items-center gap-2 rounded-lg bg-orange-500 px-6 font-black text-white shadow-lg shadow-orange-500/20 disabled:opacity-60">
            <Save className="h-4 w-4" /> {editingId ? 'Update Quotation' : 'Save Quotation'}
          </button>
          <button type="button" onClick={showQuotationList} className="btn-lift min-h-11 rounded-lg border border-slate-200 bg-white px-5 font-black text-slate-600">Cancel</button>
        </div>
      </div>
      {financialYearDraft && createPortal((
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm">
          <section className="max-h-[92vh] w-full max-w-[1450px] overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-[0_35px_100px_rgba(15,23,42,.4)]">
            <header className="flex items-start justify-between border-b border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-orange-50 px-6 py-5"><div><p className="text-[11px] font-black uppercase tracking-[.2em] text-emerald-700">{financialYearNeedsEprData ? 'EPR Data Year Mapping' : 'Service Period Mapping'}</p><h2 className="mt-1 text-2xl font-black text-slate-950">{financialYearNeedsEprData ? 'Select EPR data validity and Annual Return years' : 'Select Service Period'}</h2><p className="mt-1 text-sm font-bold text-slate-500">Quotation item #{Number(financialYearItemIndex) + 1}</p></div><button type="button" onClick={() => { setFinancialYearDraft(null); setFinancialYearItemIndex(null); setFinancialYearError(''); }} className="grid h-11 w-11 place-items-center rounded-xl border bg-white text-slate-500"><X className="h-5 w-5" /></button></header>
            <div className="max-h-[calc(92vh-165px)] overflow-y-auto p-6">
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className={`w-full text-left text-sm ${financialYearNeedsEprData ? (financialYearNeedsEprCreditYears ? 'min-w-[1720px]' : 'min-w-[1450px]') : (financialYearNeedsEprCreditYears ? 'min-w-[1380px]' : 'min-w-[1120px]')}`}>
                  <thead className="bg-gradient-to-r from-teal-50 to-cyan-50 text-[10px] uppercase tracking-[.13em] text-teal-900"><tr>{['Sr. No', ...(financialYearNeedsEprData ? ['EPR Data Validity'] : []), 'Service Period', 'Select Period', 'Transition Period', ...(financialYearNeedsEprData ? [financialYearEprYearHeading] : []), ...(financialYearNeedsEprCreditYears ? ['Annual Return EPR Credit Years'] : []), 'Applicant Type', 'Service Category', 'Business Category', 'Services Offered'].map((heading) => <th key={heading} className={`px-4 py-4 ${heading === 'Annual Return EPR Credit Years' || heading === financialYearEprYearHeading ? 'min-w-[220px]' : heading === 'Applicant Type' ? 'min-w-[140px]' : ''}`}>{heading}</th>)}</tr></thead>
                  <tbody><tr className="align-top">
                    <td className="p-4"><span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 font-black">{Number(financialYearItemIndex) + 1}</span></td>
                    {financialYearNeedsEprData && <td className="p-4"><div className="flex h-12 w-40 overflow-hidden rounded-xl border border-slate-200"><input type="number" min="1" max="50" value={financialYearDraft.validityPeriod || ''} onChange={(event) => { const limit = Math.max(1, Math.min(50, Number(event.target.value) || 1)); setFinancialYearDraft((current) => ({ ...current, validityPeriod: String(limit), annualReturnYears: (current.annualReturnYears || []).slice(0, limit) })); }} className="min-w-0 flex-1 px-4 font-black outline-none" /><span className="grid place-items-center border-l bg-slate-50 px-3 text-xs font-black text-slate-500">Year</span></div></td>}
                    <td className="p-4"><div className={`flex h-12 w-40 overflow-hidden rounded-xl border border-slate-200 ${financialYearNeedsEprCreditYears ? 'bg-slate-100' : ''}`}><input type="number" min={financialYearNeedsEprCreditYears ? 0 : 1} disabled={financialYearNeedsEprCreditYears} max={financialYearDraft.periodUnit === 'days' ? 3650 : financialYearDraft.periodUnit === 'months' ? 600 : 100} value={financialYearNeedsEprCreditYears ? 0 : (financialYearDraft.servicePeriod || '')} onChange={(event) => { const max = financialYearDraft.periodUnit === 'days' ? 3650 : financialYearDraft.periodUnit === 'months' ? 600 : 100; const period = Math.max(1, Math.min(max, Number(event.target.value) || 1)); setFinancialYearDraft((current) => ({ ...current, servicePeriod: String(period), ...(current.transitionPeriod === 'Yes' ? {} : { serviceEndDate: serviceEndDateFrom(current.serviceStartDate, period, current.periodUnit || 'annual') }) })); }} className="min-w-0 flex-1 px-4 font-black outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500" /><span className="grid place-items-center border-l bg-slate-50 px-3 text-xs font-black text-slate-500">{financialYearNeedsEprCreditYears ? 'N/A' : periodUnitLabel(financialYearDraft.periodUnit || 'annual', financialYearDraft.servicePeriod)}</span></div></td>
                    <td className="p-4"><QuoteSelect disabled={financialYearNeedsEprCreditYears} value={financialYearNeedsEprCreditYears ? '' : (financialYearDraft.periodUnit || 'annual')} options={PERIOD_UNIT_OPTIONS} placeholder={financialYearNeedsEprCreditYears ? 'N/A' : 'Select period'} categoryLabel="Select Period" onChange={(value) => setFinancialYearDraft((current) => { const unit = normalizePeriodUnit(value); const max = unit === 'days' ? 3650 : unit === 'months' ? 600 : 100; const period = Math.max(1, Math.min(max, Number(current.servicePeriod) || 1)); return { ...current, periodUnit: unit, servicePeriod: String(period), ...(current.transitionPeriod === 'Yes' ? {} : { serviceEndDate: serviceEndDateFrom(current.serviceStartDate, period, unit) }) }; })} /></td>
                    <td className="p-4"><QuoteSelect value={financialYearDraft.transitionPeriod || 'No'} options={TRANSITION_PERIOD_OPTIONS} placeholder="Transition Period" categoryLabel="Transition Period" onChange={(value) => setFinancialYearDraft((current) => {
                      if (value === 'Yes') {
                        const yearDates = datesFromAnnualYears(current.annualReturnYears || []);
                        if (yearDates.serviceStartDate) return { ...current, transitionPeriod: value, ...yearDates };
                        const serviceStartDate = normalizeDateInputValue(current.serviceStartDate || quotation.quotationDate) || new Date().toISOString().slice(0, 10);
                        return { ...current, transitionPeriod: value, serviceStartDate, serviceEndDate: serviceEndDateFrom(serviceStartDate, current.servicePeriod || 1, current.periodUnit || 'annual') };
                      }
                      return { ...current, transitionPeriod: value, serviceEndDate: serviceEndDateFrom(current.serviceStartDate, current.servicePeriod || 1, current.periodUnit || 'annual') };
                    })} /></td>
                    {financialYearNeedsEprData && <td className="p-4"><div className="grid w-72 grid-cols-2 gap-2">{quotationFyOptions().map((year) => { const checked = (financialYearDraft.annualReturnYears || []).includes(year); const limitReached = !checked && (financialYearDraft.annualReturnYears || []).length >= Math.max(1, Number(financialYearDraft.validityPeriod) || 1); return <label key={year} className={`flex items-center gap-2 rounded-xl border px-3 py-2 font-black ${checked ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : limitReached ? 'cursor-not-allowed bg-slate-50 text-slate-300' : 'cursor-pointer bg-white text-slate-600'}`}><input type="checkbox" checked={checked} disabled={limitReached} onChange={() => toggleAnnualReturnYear(year)} />{year}</label>; })}</div></td>}
                    {financialYearNeedsEprCreditYears && <td className="p-4"><QuoteYearMultiSelect value={financialYearDraft.annualReturnEprCreditYears || []} options={EPR_CREDIT_YEAR_OPTIONS} error={financialYearError} onChange={(years) => { setFinancialYearDraft((current) => ({ ...current, annualReturnEprCreditYears: years })); setFinancialYearError(''); }} /></td>}
                    <td className="min-w-[140px] p-4 font-black text-slate-700">{getQuotationApplicantType(financialYearDraft)}</td><td className="p-4 font-black text-slate-700">{financialYearDraft.serviceCategory || financialYearDraft.eprCategory || '-'}</td><td className="p-4 font-black text-slate-700">{financialYearDraft.businessCategory || '-'}</td><td className="p-4 font-black text-teal-700">{financialYearDraft.servicesOffered || '-'}</td>
                  </tr></tbody>
                </table>
              </div>
              <div className="mt-5 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-5"><p className="text-xs font-black uppercase tracking-[.16em] text-emerald-700">Service Period Validity Note</p>{financialYearNeedsEprCreditYears ? <p className="mt-2 text-lg font-black text-slate-900">{servicePeriodValidityNote(financialYearDraft, quotation.validUntil)}</p> : <><p className="mt-2 text-lg font-black text-slate-900">Your service period is {periodDisplay(financialYearDraft.servicePeriod, financialYearDraft.periodUnit)}{financialYearDraft.serviceStartDate ? ` (${formatServiceDate(financialYearDraft.serviceStartDate)} to ${formatServiceDate(financialYearDisplayEnd)})` : ''}{financialYearDraft.businessCategory ? ` for ${financialYearDraft.businessCategory}` : ''}.</p><p className="mt-1 text-sm font-bold text-slate-600">{financialYearDraft.serviceStartDate ? `Renewal will be applicable from ${formatServiceDate(financialYearRenewalDate)}.` : 'Select the Service Start Date in the quotation row to calculate the Service End Date and renewal date automatically.'}</p></>}</div>
            </div>
            <footer className="flex justify-end gap-3 border-t bg-slate-50 px-6 py-4"><button type="button" onClick={() => { setFinancialYearDraft(null); setFinancialYearItemIndex(null); setFinancialYearError(''); }} className="rounded-xl border bg-white px-5 py-3 font-black text-slate-600">Cancel</button><button type="button" onClick={saveFinancialYearSelection} className="rounded-xl bg-[#30737B] px-6 py-3 font-black text-white shadow-lg">{financialYearNeedsEprData ? 'Apply EPR Data Year' : 'Apply Service Period'}</button></footer>
          </section>
        </div>
      ), document.body)}
      {successModal && (
        <SuccessDialog
          title={successModal.title}
          message={successModal.message}
          onClose={() => setSuccessModal(null)}
        />
      )}
      {leadIdentityPrompt && (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="quotation-identity-title">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-4 bg-gradient-to-r from-emerald-50 via-white to-orange-50 p-6">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Quotation identity</p>
                <h2 id="quotation-identity-title" className="mt-1 text-2xl font-black text-slate-950">From &amp; Prepared By</h2>
                <p className="mt-2 text-sm font-bold text-slate-500">These names will appear in the quotation preview and downloaded PDF.</p>
              </div>
              <button type="button" onClick={() => { setLeadIdentityPrompt(null); setLeadIdentityError(''); }} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500" title="Cancel"><X className="h-5 w-5" /></button>
            </header>
            <div className="space-y-4 p-6">
              <label className="block">
                <span className="mb-2 block text-sm font-black text-slate-700">From Name <b className="text-red-500">*</b></span>
                <input autoFocus maxLength={120} value={leadIdentityPrompt.fromName} onChange={(event) => { setLeadIdentityPrompt((current) => ({ ...current, fromName: event.target.value })); setLeadIdentityError(''); }} placeholder="Enter From Name" className="form-input w-full font-black uppercase" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-black text-slate-700">Prepared By Name <b className="text-red-500">*</b></span>
                <input maxLength={120} value={leadIdentityPrompt.preparedByName} onChange={(event) => { setLeadIdentityPrompt((current) => ({ ...current, preparedByName: event.target.value })); setLeadIdentityError(''); }} onKeyDown={(event) => { if (event.key === 'Enter') confirmLeadIdentity(); }} placeholder="Enter Prepared By Name" className="form-input w-full font-black uppercase" />
              </label>
              {leadIdentityError && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-600">{leadIdentityError}</p>}
            </div>
            <footer className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50 p-5">
              <button type="button" onClick={() => { setLeadIdentityPrompt(null); setLeadIdentityError(''); }} className="rounded-xl border border-slate-200 bg-white px-5 py-3 font-black text-slate-600">Cancel</button>
              <button type="button" onClick={confirmLeadIdentity} className="rounded-xl bg-emerald-700 px-6 py-3 font-black text-white shadow-lg shadow-emerald-700/20">Continue</button>
            </footer>
          </div>
        </div>
      )}
      {profileOpen && <ProfileModal user={currentUser} saving={false} onClose={() => setProfileOpen(false)} onLogout={handleLogout} onSave={() => {}} onUpdatePassword={() => {}} />}
    </DashboardShell>
  );
}

function SuccessDialog({ title, message, onClose }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 5000);
    return () => window.clearTimeout(timer);
  }, [onClose]);
  return (
    <div className="quotation-approval-toast" role="status" aria-live="polite">
      <div className="quotation-approval-toast-icon"><Check className="h-5 w-5" /></div>
      <div><strong>{title}</strong><p>{message}</p><span>Approval workflow has been notified.</span></div>
      <button type="button" onClick={onClose} aria-label="Dismiss notification"><X className="h-4 w-4" /></button>
      <i />
    </div>
  );
}

function QuotationTableRow({ row, expanded, menuOpen, onToggleItems, onToggleMenu, onEdit, onPreview }) {
  const itemCount = row.items?.length || 0;
  const total = Number(row.grandTotal) || (row.items || []).reduce((sum, item) => sum + ((Number(item.unit) || 1) * (Number(item.basicAmount) || 0)), 0);
  const revisable = canReviseQuotation(row);

  return (
    <tr className="relative bg-white transition hover:bg-slate-50">
      <td className="px-4 py-5 font-black text-orange-600">{row.quotationNumber || '-'}</td>
      <td className="px-4 py-5 font-black uppercase text-slate-700">{row.companyName || row.leadDetails?.companyName || '-'}</td>
      <td className="px-4 py-5 font-black text-slate-600">{displayLeadCode(row)}</td>
      <td className="px-4 py-5 font-black uppercase text-slate-600">{row.leadDetails?.contactPerson || '-'}</td>
      <td className="px-4 py-5 font-bold text-slate-600">{formatDisplayDate(row.quotationDate || row.createdAt)}</td>
      <td className="px-4 py-5 font-bold text-slate-600">{formatDisplayDate(row.validUntil)}</td>
      <td className="px-4 py-5">
        <button type="button" onClick={onToggleItems} className="inline-flex items-center gap-2 text-sm font-black text-orange-600"><ChevronDown className={`h-4 w-4 transition ${expanded ? 'rotate-180' : '-rotate-90'}`} />{itemCount}</button>
      </td>
      <td className="px-4 py-5 font-black text-orange-600">{formatInr(total)}</td>
      <td className="px-4 py-5">
        <span className={`rounded-full border px-3 py-2 text-xs font-black uppercase ${row.status === 'submitted' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-blue-200 bg-blue-50 text-blue-700'}`}>{row.status || 'draft'}</span>
      </td>
      <td className="px-4 py-5 text-xs font-bold text-slate-600">{row.lastSyncedAt ? formatDisplayDate(row.lastSyncedAt) : '-'}</td>
      <td className="px-4 py-5">
        <div className="relative">
          <button type="button" onClick={onToggleMenu} className="grid h-9 w-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100" title="Actions">
            <MoreHorizontal className="h-5 w-5" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-10 z-30 w-36 overflow-hidden rounded-lg border border-slate-200 bg-white py-2 shadow-xl">
              <button type="button" onClick={onPreview} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-black text-slate-700 hover:bg-slate-50"><Eye className="h-4 w-4" /> Preview</button>
              {String(row.source || 'crm').toLowerCase() === 'crm' && <button type="button" disabled={!revisable} title={revisable ? 'Revise quotation' : 'Approve or reject this quotation first'} onClick={onEdit} className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-black ${revisable ? 'text-slate-700 hover:bg-slate-50' : 'cursor-not-allowed text-slate-300'}`}><Edit3 className="h-4 w-4" /> Revise</button>}
              <button type="button" onClick={onPreview} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-black text-slate-700 hover:bg-slate-50"><Download className="h-4 w-4" /> Download</button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

function QuotationItemsPanel({ quotation, items }) {
  const combined = isCombinedQuotation(quotation);
  const displayRows = combined ? combinedPricingRows(quotation, items) : items.map((item, index) => ({ item, index }));
  const hasEprCreditItems = items.some(isEprCreditItem);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
      <table className={`w-full text-left text-sm ${hasEprCreditItems ? 'min-w-[1240px]' : 'min-w-[1080px]'}`}>
        <thead className="bg-slate-50 text-xs font-black uppercase text-slate-600">
          <tr>
            {['Business Category', 'Service Category', 'Service Period', ...(hasEprCreditItems ? ['Annual Return EPR Credit Years'] : []), 'Applicant Type', 'Unit', 'Unit Name', 'Basic Amount (INR)', 'Start Date', 'End Date'].map((header) => (
              <th key={header} className="border-r border-slate-100 px-4 py-4 last:border-r-0">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {displayRows.length === 0 ? (
            <tr><td colSpan={hasEprCreditItems ? 10 : 9} className="px-4 py-8 text-center font-black text-slate-400">No items added.</td></tr>
          ) : displayRows.map(({ item, index, group, groupSize, firstInGroup }) => (
            <tr key={`${group?.id || 'item'}-${index}`} className="font-black uppercase text-slate-600">
              <td className="px-4 py-4">{item.businessCategory || '-'}</td>
              <td className="px-4 py-4">{item.eprCategory || item.serviceCategory || '-'}</td>
              <td className="px-4 py-4">{quotationServicePeriodDisplay(item)}</td>
              {hasEprCreditItems && <td className="px-4 py-4">{isEprCreditItem(item) ? (quotationEprCreditYears(item).join(', ') || '-') : '-'}</td>}
              <td className="px-4 py-4">{getQuotationApplicantType(item)}</td>
              <td className="px-4 py-4">{quotationUnitLabel(item)}</td>
              <td className="px-4 py-4">{item.unitName || '-'}</td>
              {(!combined || firstInGroup) && <td rowSpan={combined ? groupSize : undefined} className={`px-4 py-4 ${combined ? 'align-middle text-center text-orange-600' : ''}`}>{formatInr(combined ? group.basicAmount : item.basicAmount)}</td>}
              <td className="px-4 py-4">{formatServiceDate(item.serviceStartDate)}</td>
              <td className="px-4 py-4">{formatServiceDate(item.serviceEndDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuotationPager({ page, rowsPerPage, setPage, setRowsPerPage, total, totalPages, showing, label = 'quotations' }) {
  const start = total ? (page - 1) * rowsPerPage + 1 : 0;
  const end = total ? start + showing - 1 : 0;
  const pages = Array.from({ length: Math.min(5, totalPages) }, (_, index) => index + 1);

  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
      <span className="font-black text-slate-900">{start}-{end} of {total} {label}</span>
      <button type="button" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="px-2 font-black text-slate-400 disabled:opacity-40">‹</button>
      <div className="flex items-center gap-2">
        {pages.map((item) => (
          <button key={item} type="button" onClick={() => setPage(item)} className={`grid h-8 w-8 place-items-center rounded-lg text-sm font-black ${page === item ? 'border border-blue-600 text-blue-600' : 'text-slate-900 hover:bg-slate-100'}`}>{item}</button>
        ))}
        {totalPages > 6 && <span className="font-black text-slate-400">...</span>}
        {totalPages > 5 && <button type="button" onClick={() => setPage(totalPages)} className="grid h-8 w-8 place-items-center rounded-lg text-sm font-black text-slate-900 hover:bg-slate-100">{totalPages}</button>}
      </div>
      <button type="button" disabled={page === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="px-2 font-black text-slate-400 disabled:opacity-40">›</button>
      <select value={rowsPerPage} onChange={(event) => setRowsPerPage(Number(event.target.value))} className="h-10 rounded-lg border border-slate-200 bg-white px-3 font-black outline-none">
        {[10, 25, 50, 100].map((count) => <option key={count} value={count}>{count} / page</option>)}
      </select>
    </div>
  );
}

function QuotationFilterPopover({ quotationStatusFilter, adminApprovalFilter, onQuotationStatusChange, onAdminApprovalChange, onClear }) {
  return (
    <div className="absolute right-0 top-14 z-40 w-[342px] overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xl shadow-slate-900/15 animate-[app-loader-card-in_.2s_cubic-bezier(.22,1,.36,1)]">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4">
        <h3 className="text-base font-black">Filters</h3>
        <button type="button" onClick={onClear} className="rounded-lg px-2 py-1 text-xs font-black text-slate-500 hover:bg-slate-100">Clear</button>
      </div>

      <div className="border-b border-slate-100 px-4 py-4">
        <p className="mb-3 font-black text-slate-800">Quotation status</p>
        <div className="space-y-3">
          <FilterRadio checked={quotationStatusFilter === 'open'} label="Open" tone="blue" onClick={() => onQuotationStatusChange(quotationStatusFilter === 'open' ? '' : 'open')} />
          <FilterRadio checked={quotationStatusFilter === 'closed'} label="Closed" tone="red" onClick={() => onQuotationStatusChange(quotationStatusFilter === 'closed' ? '' : 'closed')} />
        </div>
      </div>

      <div className="px-4 py-4">
        <p className="mb-3 font-black text-slate-800">Admin approval</p>
        <div className="space-y-3">
          <FilterRadio checked={!adminApprovalFilter} label="All (approved and rejected)" tone="slate" onClick={() => onAdminApprovalChange('')} />
          <FilterRadio checked={adminApprovalFilter === 'approved'} label="Approved" tone="green" onClick={() => onAdminApprovalChange(adminApprovalFilter === 'approved' ? '' : 'approved')} />
          <FilterRadio checked={adminApprovalFilter === 'rejected'} label="Rejected" tone="red" onClick={() => onAdminApprovalChange(adminApprovalFilter === 'rejected' ? '' : 'rejected')} />
        </div>
      </div>
    </div>
  );
}

function FilterRadio({ checked, label, tone, onClick }) {
  const pillClass = tone === 'blue'
    ? 'border-sky-300 bg-sky-50 text-sky-600'
    : tone === 'green'
      ? 'border-lime-300 bg-lime-50 text-lime-600'
      : tone === 'red'
        ? 'border-red-200 bg-red-50 text-red-500'
        : 'border-transparent bg-transparent text-slate-600';

  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 text-left">
      <span className={`grid h-5 w-5 place-items-center rounded-full border ${checked ? 'border-blue-600' : 'border-slate-300'}`}>
        {checked && <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />}
      </span>
      <span className={`rounded-md border px-3 py-1 text-sm font-black ${pillClass}`}>{label}</span>
    </button>
  );
}

function QuotationDetailModal({ quotation, revisionCount = 0, onClose, onRevise }) {
  const details = quotation.leadDetails || {};
  const items = Array.isArray(quotation.items) ? quotation.items : [];
  const combined = isCombinedQuotation(quotation);
  const combinedTotal = combinedQuotationTotal(quotation, items);
  const displayRows = combined ? combinedPricingRows(quotation, items) : items.map((item, index) => ({ item, index }));
  const meaningfulItems = items.filter((item) => isMeaningfulQuotationItem(item));
  const latestItem = meaningfulItems[meaningfulItems.length - 1] || items[items.length - 1] || {};
  const userName = quotation.createdBy?.name || quotation.createdBy?.email || details.referredBy || '-';
  const totalAmount = Number(quotation.grandTotal) || items.reduce((sum, item) => sum + ((Number(item.unit) || 1) * (Number(item.basicAmount) || 0)), 0);
  const displayRevisionCount = Math.max(revisionCount, meaningfulItems.length || items.length);
  const revisable = canReviseQuotation(quotation);
  const hasEprCreditItems = items.some(isEprCreditItem);

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/45 px-4 py-5 backdrop-blur-sm animate-[fadeIn_.18s_ease-out]" role="presentation" onClick={onClose}>
      <div className="w-full max-w-5xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/25 animate-[app-loader-card-in_.28s_cubic-bezier(.22,1,.36,1)]" role="dialog" aria-modal="true" aria-label="Quotation Details" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-gradient-to-r from-teal-50 via-white to-orange-50 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-[#30737B]">Quotation Details</p>
            <h2 className="mt-1 truncate text-xl font-black text-slate-950">{details.companyName || 'Quotation'}</h2>
            <p className="mt-1 text-sm font-black text-slate-500">{quotation.quotationNumber || quotation.uniqueId || '-'}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            {String(quotation.source || 'crm').toLowerCase() === 'crm' && <button type="button" disabled={!revisable} title={revisable ? 'Revise quotation' : 'Approve or reject this quotation first'} onClick={onRevise} className={`btn-lift inline-flex min-h-10 items-center gap-2 rounded-lg border px-4 text-sm font-black ${revisable ? 'border-orange-300 bg-white text-orange-600' : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'}`}>
              <Edit3 className="h-4 w-4" /> Revise
            </button>}
            <button type="button" onClick={onClose} className="btn-lift grid h-10 w-10 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600" aria-label="Close quotation details">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="max-h-[calc(100vh-150px)] overflow-auto p-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <QuoteModalStat label="Company Name" value={details.companyName || '-'} />
            <QuoteModalStat label="User Name" value={userName} />
            <QuoteModalStat label="Basic Amount (INR)" value={formatInr(totalAmount)} tone="amount" />
            <QuoteModalStat label="Applicant Type" value={getQuotationApplicantType(latestItem)} />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <QuoteModalStat label="Number of Revision" value={displayRevisionCount} tone="revision" />
            <QuoteModalStat label="Business Category" value={latestItem.businessCategory || '-'} />
            <QuoteModalStat label="Service Category" value={latestItem.serviceCategory || '-'} />
          </div>

          <DetailSection title="Quotation Items">
            <div className="overflow-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[1180px] text-left text-sm">
                <thead className="bg-slate-50 text-xs font-black text-slate-600">
                  <tr>
                    {['Sr.No', 'Business Category', 'Service Category', 'Service Period', ...(hasEprCreditItems ? ['Annual Return EPR Credit Years'] : []), 'Service Start Date', 'Service End Date', 'Basic Amount (INR)', 'Applicant Type', 'Unit', 'Unit Name', 'Line Total'].map((header) => (
                      <th key={header} className="border-b border-r border-slate-200 px-4 py-4 last:border-r-0">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.length ? displayRows.map(({ item, index, group, groupSize, firstInGroup }) => (
                    <tr key={`${group?.id || 'item'}-${index}`} className="font-black uppercase text-slate-700">
                      <td className="border-b border-r border-slate-100 px-4 py-4 text-center">{index + 1}</td>
                      <td className="border-b border-r border-slate-100 px-4 py-4">{item.businessCategory || '-'}</td>
                      <td className="border-b border-r border-slate-100 px-4 py-4">{item.serviceCategory || '-'}</td>
                      <td className="border-b border-r border-slate-100 px-4 py-4">{quotationServicePeriodDisplay(item)}</td>
                      {hasEprCreditItems && <td className="border-b border-r border-slate-100 px-4 py-4">{isEprCreditItem(item) ? (quotationEprCreditYears(item).join(', ') || '-') : '-'}</td>}
                      <td className="border-b border-r border-slate-100 px-4 py-4">{formatServiceDate(item.serviceStartDate)}</td>
                      <td className="border-b border-r border-slate-100 px-4 py-4">{formatServiceDate(item.serviceEndDate)}</td>
                      {(!combined || firstInGroup) && <td rowSpan={combined ? groupSize : undefined} className="border-b border-slate-100 px-4 py-4 text-center align-middle text-orange-600">{formatInr(combined ? group.basicAmount : item.basicAmount)}</td>}
                      <td className="border-b border-r border-slate-100 px-4 py-4">{getQuotationApplicantType(item)}</td>
                      <td className="border-b border-r border-slate-100 px-4 py-4">{quotationUnitLabel(item)}</td>
                      <td className="border-b border-r border-slate-100 px-4 py-4">{item.unitName || '-'}</td>
                      {(!combined || firstInGroup) && <td rowSpan={combined ? groupSize : undefined} className="border-b border-slate-100 px-4 py-4 text-center align-middle font-black text-orange-600">{formatInr(combined ? group.basicAmount : ((Number(item.unit) || 1) * (Number(item.basicAmount) || 0)))}</td>}
                    </tr>
                  )) : (
                    <tr><td colSpan={hasEprCreditItems ? 12 : 11} className="px-4 py-10 text-center font-black text-slate-400">No quotation items added.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </DetailSection>
          <div className="mt-4 ml-auto max-w-sm rounded-lg border border-slate-200 bg-slate-50 p-4"><div className="flex justify-between text-sm font-bold text-slate-600"><span>Subtotal</span><span>{formatInr(quotation.subtotal || totalAmount)}</span></div><div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-base font-black text-slate-950"><span>Grand Total</span><span className="text-orange-600">{formatInr(totalAmount)}</span></div></div>
          <DetailSection title="Terms & Conditions"><ol className="list-decimal space-y-2 pl-5 text-sm font-bold text-slate-700">{(quotation.terms || []).length ? quotation.terms.map((term, index) => <li key={`${term}-${index}`}>{term}</li>) : <li className="list-none text-slate-400">No terms added.</li>}</ol></DetailSection>
          <DetailSection title="Scope of Work"><ol className="list-decimal space-y-2 pl-5 text-sm font-bold text-slate-700">{(quotation.scopeOfWork || []).length ? quotation.scopeOfWork.map((item, index) => <li key={`${item}-${index}`}>{item}</li>) : <li className="list-none text-slate-400">No scope of work added.</li>}</ol></DetailSection>
        </div>
      </div>
    </div>
  );
}

function QuoteModalStat({ label, value, tone = 'default' }) {
  const toneClass = tone === 'amount' ? 'text-orange-600' : tone === 'revision' ? 'text-blue-600' : 'text-slate-950';
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <span className="text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">{label}</span>
      <strong className={`mt-2 block break-words text-base font-black uppercase ${toneClass}`}>{value || '-'}</strong>
    </div>
  );
}

function QuotationDetailPage({ quotation, onBack, onRevise }) {
  const details = quotation.leadDetails || {};
  const items = Array.isArray(quotation.items) ? quotation.items : [];
  const combined = isCombinedQuotation(quotation);
  const combinedTotal = combinedQuotationTotal(quotation, items);
  const displayRows = combined ? combinedPricingRows(quotation, items) : items.map((item, index) => ({ item, index }));
  const terms = Array.isArray(quotation.terms) ? quotation.terms : [];
  const firstItem = items[0] || {};
  const createdDate = formatDisplayDate(quotation.createdAt);
  const revisable = canReviseQuotation(quotation);
  const hasEprCreditItems = items.some(isEprCreditItem);
  const infoRows = [
    ['Salutation', details.salutation || '-'],
    ['Contact Person', details.contactPerson || '-'],
    ['Designation', details.designation || '-'],
    ['Company Name', details.companyName || '-'],
    ['Address Line 1', details.addressLine1 || '-'],
    ['Address Line 2', details.addressLine2 || '-'],
    ['Address Line 3', details.addressLine3 || '-'],
    ['City', details.city || '-'],
    ['State', details.state || '-'],
    ['Pincode', details.pinCode || '-'],
    ['GST Number', details.gstNumber || '-'],
    ['Referred By', details.referredBy || quotation.createdBy?.name || quotation.createdBy || '-'],
    ['Quotation Number', quotation.quotationNumber || quotation.uniqueId || '-'],
    ['Business Category', firstItem.businessCategory || '-'],
    ['Service Category', firstItem.serviceCategory || '-'],
    ['Service Start Date', formatServiceDate(firstItem.serviceStartDate)],
    ['Service End Date', formatServiceDate(firstItem.serviceEndDate)],
    ['Service Category', firstItem.eprCategory || '-'],
    ['Applicant Type', getQuotationApplicantType(firstItem)],
    ...(isEprCreditItem(firstItem) ? [['Annual Return EPR Credit Years', quotationEprCreditYears(firstItem).join(', ') || '-']] : []),
    ['Quantity/Unit', quotationUnitLabel(firstItem)],
    ['Unit Name', firstItem.unitName || '-'],
    ['Basic Amount (INR)', formatInr(combined ? combinedTotal : firstItem.basicAmount)],
    ['Quotation Valid Until', quotation.validUntil || '-'],
    ['Quotation Date', createdDate]
  ];

  return (
    <div className="min-h-screen bg-white px-3 py-5 sm:px-5 lg:px-7">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="btn-lift grid h-9 w-9 place-items-center rounded-lg border border-orange-200 bg-white text-orange-600 shadow-sm" title="Back">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-xl font-black text-slate-950">Quote Details</h1>
        </div>
        <button type="button" disabled={!revisable} title={revisable ? 'Revise quotation' : 'Approve or reject this quotation first'} onClick={onRevise} className={`btn-lift inline-flex min-h-10 items-center gap-2 rounded-lg border px-4 text-sm font-black ${revisable ? 'border-orange-300 bg-white text-orange-600' : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'}`}>
          <Edit3 className="h-4 w-4" />
          Revise
        </button>
      </div>

      <DetailSection title="Quotation Information">
        <div className="grid overflow-hidden rounded-lg border border-slate-200 md:grid-cols-2">
          {infoRows.map(([label, value]) => (
            <React.Fragment key={`${label}-${value}`}>
              <div className="border-b border-r border-slate-200 bg-slate-50 px-4 py-3 text-xs font-black text-slate-600">{label}</div>
              <div className="border-b border-slate-200 px-4 py-3 text-xs font-black uppercase text-slate-950">{value}</div>
            </React.Fragment>
          ))}
        </div>
      </DetailSection>

      <DetailSection title="Quotation Items">
        <div className="overflow-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-black text-slate-600">
              <tr>
                {['Sr.No', 'Business Category', 'Service Category', 'Service Period', ...(hasEprCreditItems ? ['Annual Return EPR Credit Years'] : []), 'Service Start Date', 'Service End Date', 'Basic Amount (INR)', 'Applicant Type', 'Unit', 'Unit Name'].map((header) => (
                  <th key={header} className="border-b border-r border-slate-200 px-4 py-4 last:border-r-0">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.length ? displayRows.map(({ item, index, group, groupSize, firstInGroup }) => (
                <tr key={`${group?.id || 'item'}-${index}`} className="font-black uppercase text-slate-700">
                  <td className="border-b border-r border-slate-100 px-4 py-4 text-center">{index + 1}</td>
                  <td className="border-b border-r border-slate-100 px-4 py-4">{item.businessCategory || '-'}</td>
                  <td className="border-b border-r border-slate-100 px-4 py-4">{item.serviceCategory || '-'}</td>
                  <td className="border-b border-r border-slate-100 px-4 py-4">{quotationServicePeriodDisplay(item)}</td>
                  {hasEprCreditItems && <td className="border-b border-r border-slate-100 px-4 py-4">{isEprCreditItem(item) ? (quotationEprCreditYears(item).join(', ') || '-') : '-'}</td>}
                  <td className="border-b border-r border-slate-100 px-4 py-4">{formatServiceDate(item.serviceStartDate)}</td>
                  <td className="border-b border-r border-slate-100 px-4 py-4">{formatServiceDate(item.serviceEndDate)}</td>
                  {(!combined || firstInGroup) && <td rowSpan={combined ? groupSize : undefined} className="border-b border-slate-100 px-4 py-4 text-center align-middle text-orange-600">{formatInr(combined ? group.basicAmount : item.basicAmount)}</td>}
                  <td className="border-b border-r border-slate-100 px-4 py-4">{getQuotationApplicantType(item)}</td>
                  <td className="border-b border-r border-slate-100 px-4 py-4">{quotationUnitLabel(item)}</td>
                  <td className="border-b border-r border-slate-100 px-4 py-4">{item.unitName || '-'}</td>
                </tr>
              )) : (
                <tr><td colSpan={hasEprCreditItems ? 11 : 10} className="px-4 py-10 text-center font-black text-slate-400">No quotation items added.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </DetailSection>

      <DetailSection title="Terms and Conditions">
        <div className="space-y-2 rounded-lg border border-slate-200 p-4 text-xs font-bold leading-6 text-slate-950">
          {terms.length ? terms.map((term, index) => <p key={index}>{index + 1}. {term}</p>) : <p>No terms added.</p>}
          <h4 className="mt-4 font-black">Scope of Work</h4>
          {(quotation.scopeOfWork || []).length ? quotation.scopeOfWork.map((item, index) => <p key={index}>{index + 1}. {item}</p>) : <p>No scope of work added.</p>}
        </div>
      </DetailSection>

      <DetailSection title="Quote History">
        <div className="space-y-4 rounded-lg border border-slate-200 p-4">
          <HistoryRow tone="emerald" title="Quote created / updated" by={quotation.createdBy?.name || quotation.createdBy?.email || details.referredBy || '-'} date={createdDate} status={quotation.status || 'draft'} />
          {quotation.managementApproval?.status && <HistoryRow tone="blue" title={String(quotation.managementApproval.status).toUpperCase() === 'APPROVED' ? 'Final Super Admin approval completed' : 'Sent to Pending Approval for final Super Admin review'} by={quotation.managementApproval.requestedByName || quotation.createdBy?.name || quotation.createdBy?.email || details.referredBy || '-'} date={formatDisplayDate(quotation.managementApproval.actionAt || quotation.managementApproval.requestedAt)} status={quotation.managementApproval.status} />}
        </div>
      </DetailSection>
    </div>
  );
}

function DetailSection({ title, children }) {
  return (
    <section className="mb-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-sm font-black text-slate-950">{title}</h2>
      {children}
    </section>
  );
}

function HistoryRow({ tone, title, by, date, status }) {
  const classes = tone === 'emerald'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : 'border-blue-200 bg-blue-50 text-blue-700';

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${classes}`}>{String(status || '').toUpperCase()}</span>
          <p className="mt-3 text-sm font-black text-slate-950">{title}</p>
          <p className="mt-1 text-xs font-bold text-slate-500">By: {by || '-'}</p>
        </div>
        <p className="text-xs font-black text-slate-500">{date || '-'}</p>
      </div>
    </div>
  );
}

function QuotationPreviewDrawer({ quotation, currentUser, onClose, onBackToPendingApproval }) {
  const details = quotation.leadDetails || {};
  const items = meaningfulQuotationItems(quotation.items);
  const combined = isCombinedQuotation(quotation);
  const combinedTotal = combinedQuotationTotal(quotation, items);
  const displayRows = combined ? combinedPricingRows(quotation, items) : items.map((item, index) => ({ item, index }));
  const hasReturnYearItems = items.some(isEprConsultancyItem);
  const normalizedRole = String(currentUser?.role || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  const isAdminUser = normalizedRole === 'admin' || normalizedRole === 'superadmin';
  const approvalStatus = String(quotation.approvalStatus || quotation.adminApproval || quotation.status || '').trim().toLowerCase();
  const isQuotationApproved = approvalStatus === 'approved';
  const isAdminApproved = approvalStatus === 'admin_approved'
    || String(quotation.managementApproval?.adminApprovalStatus || '').toUpperCase() === 'APPROVED'
    || (String(quotation.approvalDecision?.approvalKind || '').toUpperCase() === 'ADMIN' && String(quotation.approvalDecision?.status || '').toUpperCase() === 'APPROVED');
  const canDownloadPdf = isAdminUser || isQuotationApproved || isAdminApproved;
  const date = quotation.createdAt ? new Date(quotation.createdAt).toLocaleDateString('en-GB').replace(/\//g, '-') : new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
  const scopeItems = (quotation.scopeOfWork || []).filter(Boolean);
  const scopeItemsPerPage = 22;
  const scopePages = scopeItems.length
    ? Array.from({ length: Math.ceil(scopeItems.length / scopeItemsPerPage) }, (_, pageIndex) => scopeItems.slice(pageIndex * scopeItemsPerPage, (pageIndex + 1) * scopeItemsPerPage))
    : [[]];
  const documentRef = useRef(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [quotationLogoUrl, setQuotationLogoUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    const source = new Image();
    source.onload = () => {
      const width = Math.min(900, source.naturalWidth);
      const height = Math.round((source.naturalHeight * width) / source.naturalWidth);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(source, 0, 0, width, height);
      const imageData = context.getImageData(0, 0, width, height);
      const pixels = imageData.data;
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const dominance = green - Math.max(red, blue);
        if (green > 75 && dominance > 14) {
          const opacity = dominance >= 75 ? 0 : Math.max(0, 1 - ((dominance - 14) / 61));
          pixels[index + 3] = Math.round(pixels[index + 3] * opacity);
          pixels[index + 1] = Math.min(green, Math.max(red, blue));
        }
      }
      context.putImageData(imageData, 0, 0);
      if (!cancelled) setQuotationLogoUrl(canvas.toDataURL('image/png'));
    };
    source.onerror = () => { if (!cancelled) setDownloadError('Company logo could not be loaded.'); };
    source.src = ANANT_LOGO_SOURCE_URL;
    return () => { cancelled = true; };
  }, []);

  async function handleDownloadPdf() {
    if (!canDownloadPdf) {
      setDownloadError('Quotation PDF can be downloaded only after Admin or Super Admin approval.');
      return;
    }
    if (downloadingPdf || !documentRef.current) return;
    setDownloadingPdf(true);
    setDownloadError('');
    try {
      const pdf = await createQuotationPdf(buildQuotationPrintHtml(quotation), quotationLogoUrl);
      const clientFileName = String(details.companyName || quotation.quotationNumber || 'quotation')
        .trim()
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '') || 'quotation';
      const filename = `${clientFileName}.pdf`;
      pdf.save(filename);
    } catch (error) {
      console.error('Quotation PDF download failed', error);
      setDownloadError('PDF download failed. Please retry.');
    } finally {
      setDownloadingPdf(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] overflow-hidden">
      <button type="button" aria-label="Close quotation preview" onClick={onClose} className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm animate-[fadeIn_.18s_ease-out]" />
      <aside className="relative ml-auto flex h-full w-full max-w-5xl animate-[drawerIn_.28s_cubic-bezier(.22,1,.36,1)] flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl shadow-slate-950/25">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white/95 px-6 py-4 shadow-sm backdrop-blur">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={onClose} className="btn-lift grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm hover:text-orange-600" title="Close">
              <X className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-500">Document Preview</p>
              <h2 className="truncate text-xl font-black text-slate-950">{quotation.quotationNumber || 'Quotation Preview'}</h2>
            </div>
          </div>
          <div className="flex gap-2">
            {onBackToPendingApproval && <button type="button" onClick={onBackToPendingApproval} className="btn-lift inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-5 font-black text-emerald-800"><ArrowLeft className="h-4 w-4" />Back to Pending Approval</button>}
            <button type="button" onClick={onClose} className="btn-lift min-h-10 rounded-lg border border-slate-200 bg-white px-5 font-black text-slate-700">Close</button>
            <button type="button" disabled={downloadingPdf || !canDownloadPdf} title={!canDownloadPdf ? 'Admin approval is required before downloading this quotation.' : 'Download quotation PDF'} onClick={handleDownloadPdf} className="btn-lift inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-600 px-5 font-black text-white disabled:cursor-not-allowed disabled:opacity-60"><Download className={`h-4 w-4 ${downloadingPdf ? 'animate-bounce' : ''}`} />{downloadingPdf ? 'Generating PDF...' : canDownloadPdf ? 'Download PDF' : 'Approval Required'}</button>
          </div>
        </div>
        <div className="hidden-scrollbar flex-1 overflow-auto bg-[radial-gradient(circle_at_top_left,#fff7ed_0,#f8fafc_36%,#eef2f7_100%)] p-5 sm:p-8">
          {downloadError && <div className="mx-auto mb-3 max-w-[760px] rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-600">{downloadError}</div>}
          {!canDownloadPdf && <div className="mx-auto mb-3 max-w-[760px] rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-800">PDF download will be available after Admin approval. Final Super Admin approval completes the full quotation workflow.</div>}
          <div ref={documentRef} data-quotation-pdf className="mx-auto max-w-[760px]">
            <section className="min-h-[1020px] rounded-sm border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-950/15">
              <div className="flex items-center justify-between pb-2">
                <img data-pdf-logo src={quotationLogoUrl || ANANT_LOGO_SOURCE_URL} alt="Anant Tattva" className="h-14 w-32 object-contain object-left" />
                <div className="text-xl font-black uppercase tracking-[0.2em] text-orange-500">Quotation</div>
              </div>
              <div className="border-t border-slate-950 pt-5">
                <div className="grid gap-8 md:grid-cols-2">
                  <div className="text-[11px] font-bold leading-5 text-slate-950">
                    <p className="font-black">From:</p>
                    <p>{quotationOwnerName(quotation)}</p>
                    <p>AnantTattva Private Limited</p>
                    <p>{ANANT_TATTVA_ADDRESS}</p>
                    <p>GST Number: {ANANT_TATTVA_GST_NUMBER}</p>
                  </div>
                  <div className="text-right text-[11px] font-normal leading-5 text-slate-950">
                    <p>Quotation Date: {date}</p>
                    <p>Quotation No.: {quotation.quotationNumber || '-'}</p>
                    <p>Quotation Valid Until: {formatDisplayDate(quotation.validUntil)}</p>
                    <p>Created: {date}</p>
                    <p>Prepared By: {quotationPreparedByName(quotation)}</p>
                  </div>
                </div>
              </div>
              <div className="mt-5 border-t border-slate-200 pt-4 text-[11px] font-bold leading-5 text-slate-950">
                <p className="font-black">To:</p>
                <p>{details.salutation || ''} {details.contactPerson || '-'} {details.designation ? `- ${details.designation}` : ''}</p>
                <p>Mobile No.1: {details.mobileNo1 || '-'}</p>
                <p>{details.companyName || '-'}</p>
                <p>{[details.addressLine1, details.addressLine2, details.addressLine3].filter(Boolean).join(', ') || '-'}</p>
                <p>State: {details.state || '-'}</p>
                <p>City: {details.city || '-'}</p>
                <p>Pincode: {details.pinCode || '-'}</p>
                <p>GST Number: {details.gstNumber || '-'}</p>
              </div>
              {combined && <div className="mt-5 px-1 py-2.5 text-[11px] font-black uppercase tracking-[0.12em] text-slate-950">Bulk Product Package Service</div>}
              <div className={`${combined ? '' : 'mt-5'} overflow-hidden border border-slate-950`}>
                <table className="w-full table-fixed text-[10px]">
                  <colgroup><col className="w-[5%]" /><col className="w-[14%]" /><col className="w-[16%]" /><col className="w-[9%]" /><col className="w-[11%]" /><col className="w-[15%]" /><col className="w-[6%]" /><col className="w-[12%]" /><col className="w-[12%]" /></colgroup>
                  <thead className="bg-orange-500 text-left text-[9px] font-black uppercase text-white">
                    <tr>
                      {['Sr.No', 'Business Category', 'Service Category', 'Service Period', 'Applicant Type', 'Services Offered', 'Unit', 'Unit Name', 'Basic Amount (INR)'].map((header) => <th key={header} className="border-r border-slate-950 px-1.5 py-2 last:border-r-0">{header}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map(({ item, index, group, groupSize, firstInGroup }, rowIndex) => (
                      <tr key={`${group?.id || 'item'}-${index}`} className="font-black uppercase">
                        <td className="border-r border-t border-slate-950 px-1.5 py-2 text-center">{rowIndex + 1}</td>
                        <td className="break-words border-r border-t border-slate-950 px-1.5 py-2 [overflow-wrap:anywhere]">{item.businessCategory || '-'}</td>
                        <td className="break-words border-r border-t border-slate-950 px-1.5 py-2 [overflow-wrap:anywhere]">{item.eprCategory || item.serviceCategory || '-'}</td>
                        <td className="border-r border-t border-slate-950 px-1.5 py-2 text-center"><QuotationServiceDateRangeCell item={item} /></td>
                        <td className="border-r border-t border-slate-950 px-1.5 py-2">{getQuotationApplicantType(item)}</td>
                        <td className="break-words border-r border-t border-slate-950 px-1.5 py-2">{item.servicesOffered || '-'}</td>
                        <td className="border-r border-t border-slate-950 px-1.5 py-2 text-center">{quotationUnitLabel(item)}</td>
                        <td className="break-words border-r border-t border-slate-950 px-1.5 py-2">{item.unitName || '-'}</td>
                        {(!combined || firstInGroup) && <td rowSpan={combined ? groupSize : undefined} className="border-t border-slate-950 px-1.5 py-2 text-center align-middle">{formatInr(combined ? group.basicAmount : item.basicAmount)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="financial-year-print-table mt-5 overflow-hidden bg-white">
                <div className="bg-white px-3 py-2.5 text-[11px] font-black uppercase tracking-[0.16em] text-slate-950">EPR / Service Period Mapping</div>
                <table className="w-full table-fixed text-[10px] font-bold leading-4 text-slate-950">
                  {hasReturnYearItems ? <colgroup><col className="w-[8%]" /><col className="w-[24%]" /><col className="w-[20%]" /><col className="w-[24%]" /><col className="w-[24%]" /></colgroup> : <colgroup><col className="w-[10%]" /><col className="w-[32%]" /><col className="w-[26%]" /><col className="w-[32%]" /></colgroup>}
                  <thead><tr className="bg-orange-50 text-left text-[9px] font-black uppercase text-slate-950"><th className="border-r border-t border-slate-950 px-2 py-3">Sr.No</th><th className="border-r border-t border-slate-950 px-2 py-3">Service Category</th><th className="border-r border-t border-slate-950 px-2 py-3">Applicant Type</th>{hasReturnYearItems && <th className="border-r border-t border-slate-950 px-2 py-3">{quotationYearMappingHeader(items)}</th>}<th className="border-t border-slate-950 px-2 py-3">Services Offered</th></tr></thead>
                  <tbody>{displayRows.map(({ item }, index) => <tr key={index} className={index % 2 ? 'bg-orange-50/40' : 'bg-white'}><td className="border-r border-t border-slate-950 px-2 py-3 text-center font-black">{index + 1}</td><td className="border-r border-t border-slate-950 px-2 py-3 font-black">{item.eprCategory || item.serviceCategory || '-'}</td><td className="border-r border-t border-slate-950 px-2 py-3">{getQuotationApplicantType(item)}</td>{hasReturnYearItems && <td className="border-r border-t border-slate-950 px-2 py-3">{quotationAnnualReturnRegistrationYear(item)}</td>}<td className="break-words border-t border-slate-950 px-2 py-3">{item.servicesOffered || '-'}</td></tr>)}</tbody>
                </table>
              </div>
              <div className="mt-5 text-[10px] font-bold leading-5 text-slate-950">
                <p className="font-black">Terms & Conditions:</p>
                {(quotation.terms || []).length ? quotation.terms.map((term, index) => <p key={index}>{index + 1}. {term}</p>) : <p>No terms added.</p>}
              </div>
              <div className="mt-5 text-[10px] font-bold leading-5 text-slate-950">
                <p className="font-black text-red-600">Important Note:</p>
                <p>1. GST tax will be extra @ 18%.</p>
                <p>2. Any Government Charges to be paid by Client directly.</p>
              </div>
              <div className="mt-6 border-t border-slate-950 pt-3 text-center">
                <p className="text-[10px] font-black text-slate-950">For more details please contact us on : info@ananttattva.com | +91 8169727341 / 9004005520</p>
                <p className="mt-5 text-[10px] font-black text-slate-950">This is a computer-generated quotation and does not require a signature.</p>
              </div>
            </section>
            {scopePages.map((pageItems, pageIndex) => (
              <section key={`scope-page-${pageIndex}`} className="mt-6 flex min-h-[1020px] flex-col rounded-sm border border-slate-200 bg-white p-8 shadow-2xl shadow-slate-950/15">
                <div className="flex items-end justify-between border-b border-slate-950 pb-3">
                  <p className="text-xl font-black uppercase tracking-[0.18em] text-orange-500">Scope of Work</p>
                  {scopePages.length > 1 && <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Page {pageIndex + 1} of {scopePages.length}</p>}
                </div>
                <div className="mt-7 text-[12px] font-semibold leading-6 text-slate-950">
                  <p className="mb-4 text-[13px] font-black">Scope of Work:</p>
                  {pageItems.length ? (
                    <div className="space-y-3">
                      {pageItems.map((item, itemIndex) => {
                        const scopeIndex = (pageIndex * scopeItemsPerPage) + itemIndex;
                        return <div key={`${item}-${scopeIndex}`} className="grid break-inside-avoid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-2"><span className="text-right font-black text-slate-700">{scopeIndex + 1}.</span><span className="min-w-0 break-words font-semibold">{item}</span></div>;
                      })}
                    </div>
                  ) : (
                    <p>No scope of work added.</p>
                  )}
                </div>
                <div className="mt-auto border-t border-slate-950 pt-3 text-center">
                  <p className="text-[10px] font-black text-slate-950">For more details please contact us on : info@ananttattva.com | +91 8169727341 / 9004005520</p>
                  <p className="mt-4 text-[10px] font-black text-slate-950">This is a computer-generated quotation and does not require a signature.</p>
                </div>
              </section>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

function formatInr(value) {
  return (Number(value) || 0).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function meaningfulQuotationItems(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => isMeaningfulQuotationItem(item));
}

function formatDisplayDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB').replace(/\//g, '-');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function buildQuotationPrintHtml(quotation) {
  const details = quotation.leadDetails || {};
  const items = meaningfulQuotationItems(quotation.items);
  const combined = isCombinedQuotation(quotation);
  const combinedTotal = combinedQuotationTotal(quotation, items);
  const hasReturnYearItems = items.some(isEprConsultancyItem);
  const yearMappingHeader = quotationYearMappingHeader(items);
  const createdDate = quotation.createdAt ? new Date(quotation.createdAt).toLocaleDateString('en-GB').replace(/\//g, '-') : new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
  const displayRows = combined ? combinedPricingRows(quotation, items) : items.map((item, index) => ({ item, index }));
  const rows = displayRows.map(({ item, index, group, groupSize, firstInGroup }, rowIndex) => `
    <tr>
      <td class="center">${rowIndex + 1}</td>
      <td>${escapeHtml(item.businessCategory || '-')}</td>
      <td>${escapeHtml(item.eprCategory || item.serviceCategory || '-')}</td>
      <td class="center" style="white-space:nowrap">${quotationServiceDateRangeHtml(item)}</td>
      <td>${escapeHtml(getQuotationApplicantType(item))}</td>
      <td>${escapeHtml(item.servicesOffered || '-')}</td>
      <td class="center">${escapeHtml(quotationUnitLabel(item))}</td>
      <td>${escapeHtml(item.unitName || '-')}</td>
      ${!combined || firstInGroup ? `<td class="amount${combined ? ' combined-amount' : ''}"${combined ? ` rowspan="${groupSize}"` : ''}>${escapeHtml(formatInr(combined ? group.basicAmount : item.basicAmount))}</td>` : ''}
    </tr>
  `).join('');
  const terms = (quotation.terms || []).length
    ? quotation.terms.map((term, index) => `<p>${index + 1}. ${escapeHtml(term)}</p>`).join('')
    : '<p>No terms added.</p>';
  const scopeOfWork = (quotation.scopeOfWork || []).length
    ? `<div class="scope-list">${quotation.scopeOfWork.map((item, index) => `<div class="scope-row"><span class="scope-number">${index + 1}.</span><span class="scope-text">${escapeHtml(item)}</span></div>`).join('')}</div>`
    : '<p>No scope of work added.</p>';
  const combinedPackageHeader = combined ? '<div class="package-header">Bulk Product Package Service</div>' : '';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(quotation.quotationNumber || 'Quotation')}</title>
    <style>
      @page { size: A4; margin: 10mm; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #fff; color: #111827; font-family: Arial, Helvetica, sans-serif; font-size: 10px; font-weight: 400; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { width: 100%; min-height: 277mm; padding: 0; }
      .page + .page { page-break-before: always; }
      .header { display: flex; align-items: center; justify-content: space-between; padding: 12px 0 8px; border-bottom: 1px solid #020617; }
      .logo { width: 105px; height: 42px; object-fit: contain; object-position: left center; }
      .title { color: #f97316; font-size: 18px; font-weight: 900; letter-spacing: 4px; text-transform: uppercase; }
      .top { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 16px 0 16px; border-bottom: 1px solid #d1d5db; line-height: 1.5; }
      .right { text-align: right; }
      .amount { text-align: right; }
      .to { padding: 15px 0 12px; line-height: 1.55; }
      .label { font-weight: 900; }
      .strong { font-weight: 800; }
      .value { font-weight: 400; }
      p { margin: 0 0 4px; }
      table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 4px; }
      th { background: #f97316; color: white; border: 1px solid #020617; padding: 7px 6px; text-align: left; font-size: 9px; line-height: 1.15; font-weight: 900; text-transform: uppercase; overflow-wrap: anywhere; }
      td { background: #fff; border: 1px solid #020617; padding: 7px 6px; font-size: 9px; line-height: 1.2; font-weight: 700; text-transform: uppercase; overflow-wrap: anywhere; word-break: normal; }
      table:first-of-type th:nth-child(1), table:first-of-type td:nth-child(1) { text-align: center; }
      td.amount { font-weight: 800; }
      td.combined-amount { text-align: center; vertical-align: middle; font-size: 11px; }
      .center { text-align: center; }
      .package-header { margin-top: 4px; color: #020617; padding: 8px 2px; font-size: 10px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; }
      .package-header + table { margin-top: 0; }
      .terms { margin-top: 16px; line-height: 1.45; }
      .terms p { margin: 2px 0; font-weight: 400; }
      .terms li { margin: 0 0 6px; font-weight: 400; }
      .important { margin-top: 14px; line-height: 1.55; }
      .important-title { color: #ef0000; font-weight: 900; }
      .footer { margin-top: 16px; border-top: 1px solid #020617; padding-top: 14px; text-align: center; font-weight: 900; }
      .signature { margin-top: 16px; }
      .scope-page { padding-top: 18px; padding-bottom: 10mm; display: block; }
      .scope-page .terms { margin-top: 0; }
      .scope-page .footer { margin-top: 24px; break-inside: avoid; page-break-inside: avoid; }
      .scope-page-title { color: #f97316; font-size: 18px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; border-bottom: 1px solid #020617; padding-bottom: 10px; margin-bottom: 18px; }
      .scope-list { margin-top: 12px; display: grid; gap: 9px; }
      .scope-row { display: grid; grid-template-columns: 22px minmax(0, 1fr); align-items: start; column-gap: 4px; break-inside: avoid; page-break-inside: avoid; font-weight: 400; line-height: 1.5; }
      .scope-number { text-align: right; font-weight: 800; line-height: 1.5; }
      .scope-text { min-width: 0; overflow-wrap: anywhere; }
      @media print {
        html, body { width: 210mm; min-height: 297mm; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="header">
        <img class="logo" src="${ANANT_LOGO_SOURCE_URL}" alt="Anant Tattva">
        <div class="title">Quotation</div>
      </section>
      <section class="top">
        <div>
          <p class="label">From:</p>
          <p>${escapeHtml(quotationOwnerName(quotation))}</p>
          <p class="strong">AnantTattva Private Limited</p>
          <p>${escapeHtml(ANANT_TATTVA_ADDRESS)}</p>
          <p><span class="strong">GST Number:</span> ${ANANT_TATTVA_GST_NUMBER}</p>
        </div>
        <div class="right">
          <p>Quotation Date: ${escapeHtml(createdDate)}</p>
          <p>Quotation No.: ${escapeHtml(quotation.quotationNumber || '-')}</p>
          <p>Quotation Valid Until: ${escapeHtml(formatDisplayDate(quotation.validUntil))}</p>
          <p>Created: ${escapeHtml(createdDate)}</p>
          <p>Prepared By: ${escapeHtml(quotationPreparedByName(quotation))}</p>
        </div>
      </section>
      <section class="to">
        <p class="label">To:</p>
        <p>${escapeHtml(details.salutation || '')} ${escapeHtml(details.contactPerson || '-')} ${details.designation ? `- ${escapeHtml(details.designation)}` : ''}</p>
          <p><span class="strong">Mobile No.1:</span> ${escapeHtml(details.mobileNo1 || '-')}</p>
          <p class="strong">${escapeHtml(details.companyName || '-')}</p>
        <p>${escapeHtml([details.addressLine1, details.addressLine2, details.addressLine3].filter(Boolean).join(', ') || '-')}</p>
        <p><span class="strong">State:</span> ${escapeHtml(details.state || '-')}</p>
        <p><span class="strong">City:</span> ${escapeHtml(details.city || '-')}</p>
        <p><span class="strong">Pincode:</span> ${escapeHtml(details.pinCode || '-')}</p>
        <p><span class="strong">GST Number:</span> ${escapeHtml(details.gstNumber || '-')}</p>
      </section>
      ${combinedPackageHeader}
      <table>
        <colgroup>${[5, 14, 16, 9, 11, 15, 6, 12, 12].map((width) => `<col style="width:${width}%">`).join('')}</colgroup>
        <thead>
          <tr><th>Sr.No</th><th>Business Category</th><th>Service Category</th><th>Service Period</th><th>Applicant Type</th><th>Services Offered</th><th>Unit</th><th>Unit Name</th><th>Basic Amount (INR)</th></tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="9" class="center">No quotation items added.</td></tr>'}</tbody>
      </table>
      <div class="package-header">EPR / Service Period Mapping</div>
      <table>
        <thead><tr><th>Sr.No</th><th>Service Category</th><th>Applicant Type</th>${hasReturnYearItems ? `<th>${escapeHtml(yearMappingHeader)}</th>` : ''}<th>Services Offered</th></tr></thead>
        <tbody>${displayRows.map(({ item }, index) => `<tr><td class="center">${index + 1}</td><td>${escapeHtml(item.eprCategory || item.serviceCategory || '-')}</td><td>${escapeHtml(getQuotationApplicantType(item))}</td>${hasReturnYearItems ? `<td>${escapeHtml(quotationAnnualReturnRegistrationYear(item))}</td>` : ''}<td>${escapeHtml(item.servicesOffered || '-')}</td></tr>`).join('') || `<tr><td colspan="${hasReturnYearItems ? 5 : 4}" class="center">No quotation items added.</td></tr>`}</tbody>
      </table>
      <section class="terms">
        <p class="label">Terms & Conditions:</p>
        ${terms}
      </section>
      <section class="important">
        <p class="important-title">Important Note:</p>
        <p>1. GST tax will be extra @ 18%.</p>
        <p>2. Any Government Charges to be paid by Client directly.</p>
      </section>
      <section class="footer">
        <p>For more details please contact us on : info@ananttattva.com | +91 8169727341 / 9004005520</p>
        <p class="signature">This is a computer-generated quotation and does not require a signature.</p>
      </section>
    </main>
    <main class="page scope-page">
      <section class="scope-page-title">Scope of Work</section>
      <section class="terms">
        <p class="label">Scope of Work:</p>
        ${scopeOfWork}
      </section>
      <section class="footer">
        <p>For more details please contact us on : info@ananttattva.com | +91 8169727341 / 9004005520</p>
        <p class="signature">This is a computer-generated quotation and does not require a signature.</p>
      </section>
    </main>
  </body>
</html>`;
}

function QuoteYearMultiSelect({ value = [], options = [], onChange, error = '' }) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const selected = Array.isArray(value) ? value.filter((year) => options.includes(year)) : [];

  function positionMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, 320);
    setMenuPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: rect.bottom + 7, width });
  }

  useEffect(() => {
    if (!open) return undefined;
    positionMenu();
    function closeOnOutside(event) {
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    }
    function reposition() { positionMenu(); }
    document.addEventListener('mousedown', closeOnOutside);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  function toggle(year) {
    onChange(selected.includes(year) ? selected.filter((item) => item !== year) : [...selected, year].sort());
  }

  return (
    <div className="min-w-[220px]">
      <button ref={triggerRef} type="button" onClick={() => setOpen((current) => !current)} className={`quote-category-trigger min-h-12 ${open ? 'is-open' : ''} ${error ? '!border-red-400 !ring-4 !ring-red-100' : ''}`} aria-haspopup="listbox" aria-expanded={open}>
        <span className="truncate">{selected.length ? selected.join(', ') : 'Select EPR Credit years'}</span><ChevronDown className="h-4 w-4 shrink-0" />
      </button>
      {error && <p className="mt-2 text-xs font-black leading-5 text-red-600">{error}</p>}
      {open && menuPosition && createPortal(
        <div ref={menuRef} className="fixed z-[160] overflow-hidden rounded-xl border border-emerald-100 bg-white p-2 shadow-2xl" style={menuPosition} role="listbox" aria-multiselectable="true">
          <p className="px-2 pb-2 pt-1 text-[10px] font-black uppercase tracking-wider text-emerald-700">Annual Return EPR Credit Years</p>
          <div className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto">
            {options.map((year) => { const checked = selected.includes(year); return <label key={year} className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-black ${checked ? 'bg-emerald-50 text-emerald-800' : 'text-slate-600 hover:bg-slate-50'}`}><input type="checkbox" checked={checked} onChange={() => toggle(year)} />{year}</label>; })}
          </div>
          <button type="button" onClick={() => setOpen(false)} className="mt-2 h-10 w-full rounded-lg bg-[#30737B] text-sm font-black text-white">Done</button>
        </div>, document.body
      )}
    </div>
  );
}

function QuoteSelect({ value, options, placeholder, onChange, onAddOption, categoryLabel = 'Service Category', disabled = false }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [addError, setAddError] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const normalizedOptions = (Array.isArray(options) ? options : [])
    .map((option) => {
      if (option && typeof option === 'object') {
        return {
          value: String(option.value ?? option.label ?? ''),
          label: String(option.label ?? option.value ?? '')
        };
      }
      const optionValue = String(option ?? '');
      return { value: optionValue, label: optionValue };
    })
    .filter((option) => option.value && option.label);
  const selectedOption = normalizedOptions.find((option) => String(option.value) === String(value));
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = normalizedOptions.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(normalizedSearch));

  function positionMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, 300);
    const left = Math.min(rect.left, window.innerWidth - width - 12);
    setMenuPosition({ left: Math.max(12, left), top: rect.bottom + 7, width });
  }

  useEffect(() => {
    if (!open) return undefined;
    positionMenu();
    function closeOnOutside(event) {
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    }
    function reposition() { positionMenu(); }
    document.addEventListener('mousedown', closeOnOutside);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  function choose(option) {
    const optionValue = option && typeof option === 'object' ? option.value : option;
    onChange(optionValue);
    setOpen(false);
    setSearch('');
  }

  async function saveCategory(event) {
    event.preventDefault();
    setAddError('');
    setSavingCategory(true);
    try {
      const saved = await onAddOption(newCategory);
      setNewCategory('');
      setAdding(false);
      choose(saved);
    } catch (err) {
      setAddError(err?.response?.data?.error || err.message || 'Unable to add category.');
    } finally {
      setSavingCategory(false);
    }
  }

  return (
    <>
      <button ref={triggerRef} type="button" disabled={disabled} className={`quote-category-trigger ${open ? 'is-open' : ''} ${disabled ? 'cursor-not-allowed bg-slate-100 text-slate-400 opacity-80' : ''}`} onClick={() => { if (!disabled) setOpen((current) => !current); }} aria-haspopup="listbox" aria-expanded={open}>
        <span>{selectedOption?.label || value || placeholder}</span><ChevronDown className="h-4 w-4" />
      </button>
      {open && !disabled && menuPosition && createPortal(
        <div ref={menuRef} className="quote-category-menu" style={menuPosition}>
          <div className="quote-category-search"><Search className="h-4 w-4" /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search category..." />{search && <button type="button" onClick={() => setSearch('')}><X className="h-4 w-4" /></button>}</div>
          <div className="quote-category-options" role="listbox">
            {filtered.map((option) => <button key={option.value} type="button" role="option" aria-selected={String(option.value) === String(value)} onClick={() => choose(option)}><span>{option.label}</span>{String(option.value) === String(value) && <Check className="h-4 w-4" />}</button>)}
            {!filtered.length && <div className="quote-category-empty">No matching category</div>}
          </div>
          {onAddOption && <button type="button" className="quote-category-add" onClick={() => { setNewCategory(search); setOpen(false); setAdding(true); setAddError(''); }}><Plus className="h-4 w-4" /><span><strong>Add New {categoryLabel}</strong><small>Save permanently for future quotations</small></span></button>}
        </div>, document.body
      )}
      {adding && createPortal(
        <div className="quote-category-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAdding(false); }}>
          <form className="quote-category-modal" onSubmit={saveCategory}>
            <div className="quote-category-modal-head"><div><small>Quotation settings</small><h3>Add New {categoryLabel}</h3></div><button type="button" onClick={() => setAdding(false)}><X className="h-5 w-5" /></button></div>
            <label><span>{categoryLabel} Name</span><input autoFocus value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder={`Enter ${String(categoryLabel).toLowerCase()}`} maxLength={100} /></label>
            <p className="quote-category-modal-note">This {String(categoryLabel).toLowerCase()} will be saved permanently and available in all future quotations.</p>
            {addError && <p className="quote-category-modal-error">{addError}</p>}
            <div className="quote-category-modal-actions"><button type="button" onClick={() => setAdding(false)}>Cancel</button><button type="submit" disabled={savingCategory || !newCategory.trim()}><Plus className="h-4 w-4" />{savingCategory ? 'Adding...' : 'Add Category'}</button></div>
          </form>
        </div>, document.body
      )}
    </>
  );
}

function LeadSelect({ value, options, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [menuPosition, setMenuPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const selected = options.find((option) => String(option.value) === String(value));
  const filtered = options.filter((option) => `${option.code} ${option.company}`.toLowerCase().includes(search.trim().toLowerCase()));

  useEffect(() => {
    if (!open) return undefined;
    function positionMenu() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(rect.width, 420);
      const left = Math.min(rect.left, window.innerWidth - width - 12);
      setMenuPosition({ left: Math.max(12, left), top: rect.bottom + 7, width });
    }
    positionMenu();
    function closeOnOutsideClick(event) {
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    }
    function reposition() { positionMenu(); }
    document.addEventListener('mousedown', closeOnOutsideClick);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  function choose(nextValue) {
    onChange(nextValue);
    setOpen(false);
    setSearch('');
  }

  return (
    <div className={`quotation-lead-select ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <button ref={triggerRef} type="button" className="quotation-lead-trigger" disabled={disabled} onClick={() => setOpen((current) => !current)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="quotation-lead-trigger-icon"><FileText className="h-4 w-4" /></span>
        <span className="quotation-lead-trigger-copy">
          <small>{selected ? selected.code : 'Choose a lead'}</small>
          <strong>{selected ? selected.company : 'Select lead to auto-fetch details'}</strong>
        </span>
        <ChevronDown className="quotation-lead-trigger-chevron h-5 w-5" />
      </button>
      {open && !disabled && menuPosition && createPortal(
        <div ref={menuRef} className="quotation-lead-menu" style={{ position: 'fixed', zIndex: 10000, ...menuPosition }}>
          <div className="quotation-lead-search">
            <Search className="h-4 w-4" />
            <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search lead code or company..." />
            {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><X className="h-4 w-4" /></button>}
          </div>
          <div className="quotation-lead-options" role="listbox">
            {filtered.length ? filtered.map((option) => (
              <button key={option.value} type="button" role="option" aria-selected={String(option.value) === String(value)} className="quotation-lead-option" onClick={() => choose(option.value)}>
                <span><strong>{option.code}</strong><small>{option.company}</small></span>
                {String(option.value) === String(value) && <Check className="h-4 w-4" />}
              </button>
            )) : <div className="quotation-lead-empty">No matching lead found</div>}
          </div>
          <div className="quotation-lead-menu-foot">{filtered.length} lead{filtered.length === 1 ? '' : 's'} available</div>
        </div>,
        document.body
      )}
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="text-sm font-black text-slate-700">{label} {required && <span className="text-red-500">*</span>}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}
