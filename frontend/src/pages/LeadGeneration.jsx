import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BadgeIndianRupee, BellRing, Building2, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Clock3, ContactRound, CreditCard, Download, Edit3, EllipsisVertical, Eye, FileText, History, Mail, MapPin, Phone, Plus, RefreshCw, Search, TrendingUp, Trash2, Upload, UserCheck, UserPlus, UsersRound, X } from 'lucide-react';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import DashboardShell from '../components/dashboard/DashboardShell';
import ProfileModal from '../components/dashboard/ProfileModal';
import ToastMessage from '../components/ToastMessage';
import SearchableSelect from '../components/form/SearchableSelect';
import PremiumDatePicker from '../components/form/PremiumDatePicker';
import PiboDependentSelect from '../components/form/PiboDependentSelect';
import { adminRoles } from '../constants/dashboard';
import api from '../services/api';
import { API_ENDPOINTS } from '../services/apiEndpoints';
import { inferPiboParent, normalizeLegacyPiboCategory, normalizePiboCategories, PIBO_PARENTS } from '../constants/piboCategories';
import { uploadMedia } from '../services/mediaUpload';
import { fetchIndiaStateCities, fetchIndiaStates } from '../services/countriesNow';
import { buildManualClosurePoRow, hydrateClosurePoRows, selectLeadClosureQuotation } from '../utils/leadClosureQuotation';
import PoCommercialFields from '../components/PoCommercialFields';
import PoProofView from '../components/PoProofView';
import LeadDeleteDialog from '../components/LeadDeleteDialog';
import { poCommercialError, poYearLabel, hasSavedPoDetails } from '../utils/poCommercialDetails.mjs';
import { formatDisplayDate } from '../utils/dateFormat';

const emptyLead = {
  sourceLeadId: '',
  communicationMode: '',
  status: '',
  company: '',
  industryType: '',
  eprCategory: '',
  piboParent: '',
  piboCategoryParent: '',
  piboCategory: '',
  applicantType: '',
  serviceSelections: [],
  servicesOffered: '',
  applicableService: '',
  firstAnnualReturnYearApplicable: '',
  addresses: [],
  contacts: [],
  assignments: [],
  assignedStaff: '',
  assignedStaffText: '',
  assignedStaffEmail: '',
  addressLine1: '',
  addressLine2: '',
  addressLine3: '',
  landmark: '',
  state: '',
  city: '',
  pinCode: '',
  existingClient: 'No',
  website: '',
  salutation: '',
  contactPerson: '',
  designation: '',
  emails: '',
  emailsSentCount: '',
  lastEmailSent: '',
  mobileNo1: '',
  mobileNo2: '',
  whatsappNo: '',
  linkedinUrl: '',
  businessCardUrl: '',
  referredBy: '',
  source: '',
  notes: '',
  assignedTo: '',
  assignedToText: '',
  assignedBy: '',
  importedCreatedBy: '',
  updatedBy: '',
  closedBy: '',
  closedByText: '',
  closedByEmail: '',
  closedOnBehalfOfUser: '',
  closedOnBehalfOfName: '',
  closedOnBehalfOfEmail: '',
  leadDate: '',
  nextFollowUpDate: '',
  nextFollowUpTime: '',
  followUpRemarks: '',
  importedCreatedAt: '',
  importedUpdatedAt: ''
};

const emptyComplianceHealthReport = {
  otpMobile: '',
  cpcbLoginId: '',
  cpcbPassword: '',
  ssoCpcbLoginId: '',
  ssoCpcbPassword: '',
  yearOfCommencement: '',
  establishmentDate: '',
  organizationType: '',
  keyProductsBrands: '',
  productCategory: '',
  eprRegistrationNumber: '',
  financialYearReviewed: '',
  objectiveReview: '',
  keyObservations: '',
  annualReturnObservations: '',
  checklistReview: '',
  conclusion: '',
  recommendations: '',
  finalNotes: '',
  screenshotReferences: '',
  sharedFolderUploads: [],
  keyObservationDetails: [],
  annualReturnDetails: [],
  checklistItems: [],
  conclusionNotes: [],
  reviewedConfirmation: false
};

const defaultComplianceHealthRows = {
  keyObservations: [
    'Part A General Information',
    'Part B Liquid and gaseous emissions',
    'Part C Waste',
    'Part D Waste Action Plan'
  ],
  annualReturnObservations: ['Annual Return'],
  checklistReview: [
    'PART A',
    'Legal / Trade Name of Company',
    'Type of Company',
    'Type of Business',
    'CIN',
    'PAN',
    'Registered Address',
    'Authorized Person Details',
    'Name',
    'Designation',
    'PAN',
    'Mobile Number',
    'Email ID',
    'Operational & Production',
    'States/UTs where PIBO operates',
    'Confirmation of Production Facility',
    'Total Capital Invested in the Project',
    'Year of Commencement of Operations',
    'Documents Uploaded on Portal',
    'Company PAN, CIN & GST',
    'Authorized Person PAN',
    'Product details and quantity',
    'PART B',
    'Air / Water Consent',
    'PART C',
    'Raw plastic material details',
    'Plastic raw material sold details',
    'PART D',
    'Geo-tagged photographs of facility',
    'Picture of machine',
    'Electricity bill',
    'Covering Letter',
    'Scanned Signature',
    'Any other supporting information'
  ]
};

function reportToDraft(report = {}) {
  const listText = (value) => Array.isArray(value) ? value.join('\n') : String(value || '');
  const attachmentList = Array.isArray(report.sharedFolderUploads)
    ? report.sharedFolderUploads.map((item) => (typeof item === 'string' ? { label: item, url: item } : item))
    : [];
  const checklistLabels = Array.isArray(report.checklistReview) && report.checklistReview.length
    ? report.checklistReview
    : defaultComplianceHealthRows.checklistReview;
  return {
    ...emptyComplianceHealthReport,
    ...report,
    keyObservations: listText(report.keyObservations) || defaultComplianceHealthRows.keyObservations.join('\n'),
    annualReturnObservations: listText(report.annualReturnObservations) || defaultComplianceHealthRows.annualReturnObservations.join('\n'),
    checklistReview: listText(report.checklistReview) || defaultComplianceHealthRows.checklistReview.join('\n'),
    finalNotes: listText(report.finalNotes),
    screenshotReferences: listText(report.screenshotReferences),
    sharedFolderUploads: attachmentList,
    keyObservationDetails: Array.isArray(report.keyObservationDetails) ? report.keyObservationDetails : [],
    annualReturnDetails: Array.isArray(report.annualReturnDetails) ? report.annualReturnDetails : [],
    checklistItems: Array.isArray(report.checklistItems) && report.checklistItems.length
      ? report.checklistItems
      : checklistLabels.map((requirement) => ({ requirement, status: '', remark: '' })),
    conclusionNotes: Array.isArray(report.conclusionNotes) && report.conclusionNotes.length
      ? report.conclusionNotes
      : (report.conclusion || report.recommendations
          ? [{ conclusion: String(report.conclusion || ''), recommendation: String(report.recommendations || '') }]
          : [{ conclusion: '', recommendation: '' }]),
    reviewedConfirmation: Boolean(report.reviewedConfirmation)
  };
}

const tabs = [
  { id: 'basic', label: 'Company', icon: Building2 },
  { id: 'address', label: 'Address', icon: MapPin },
  { id: 'contact', label: 'Contact', icon: ContactRound },
  { id: 'assign', label: 'Assign', icon: UserCheck }
];
const annualReturnYearOptions = Array.from({ length: 7 }, (_, index) => `${2023 + index}-${String(24 + index).padStart(2, '0')}`);
const BUSINESS_CATEGORY_OPTIONS = ['EPR Consultancy', 'EPR Credit'];
const options = {
  communicationMode: ['TeleCalling', 'Referral', 'Physical Visit', 'Campaign', 'Existing Client', 'Web Database', 'Webinar', 'Seminar', 'Exhibition', 'Associate Reference', 'Government'],
  status: ['Potential - Registered', 'Potential - Unregistered', 'Existing Client', 'Existing Client - Not Renewed'],
  industryType: ["Automotive", "Chemicals", "Construction", "Consumer Goods", "E-commerce" , "Electronics" , "Energy" , "FMCG","Financial Services" , "Healthcare" , "Hospitality", "IT & Software" , "Logistics" , "Manufacturing","Pharmaceuticals", "Renewables", "Retail", "Telecom", "Waste Management", "Other" , "Food Manufacturing" , "Mechinical Industry" ,"Petrochemical", "Packaging Manufacture" , "Plastic Recycling" , "E-Waste Recycler" , "E-Waste Recycling"],
  states: [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Lakshadweep",
  "Puducherry"
],
  cities: ['Ahmedabad', 'Bengaluru', 'Delhi', 'Jaipur', 'Mumbai', 'Noida', 'Pune'],
    salutations: ["Mr.", "Ms.", "Mrs.", "Dr.", "Prfo." , "ER.","CA", "Adv."],
  designation: ["Manager", "Assistant Manager", "Compliance Head", "Compliance Officer", "Director", "Managing Director", "Partner" , "Proprietor" , "Operations Head" , "Sales Head" , "Purchase Head" , "Owner" , "CEO" , "CTO" , "CFO" , "Consultant" , "Executive" , "Officer" , "ASSITANT MANAGER" , "Other" , "Senior Executive - EHS" , "GENERAL MANAGER" , "Assistant Manager -EHS" , "Chief Accountant" , "HR & ACCOUNTS" , "Plant Accounts Manager" , "Company Secratary (CS)" , "Accounts Manager" , "Sales coordination" , "Purchase" , "AGM-Corporate Quality & MR", "HSE" , "Accountant" , "Manager - Environment Health & Safety" , "Sr Manager Procurement" , "HEAD- PRODUCTION & MAINTAINANCE - OPERATIONS" , "FOUNDER & CEO" , "Sr. Manager, Procurement" , "Global Procurement" , "PepsiCo Positive" , "Executive Purchase" , "HEAD-BUSINESS OPERATIONS" , "EHS" , "Sr. Executive Sustainability" , "Asst. Manager (Supply Chain)" , "Manager Environment" , "VICE PRESIDENT" , "Account Executive" , "EHS Manager – MRS" , "PLANT MANAGER" , "FOUNDER" , "Manager, HR & Admin" , "Business Head" , "Global Head-Collaborative ventures" , "General Service and Supplies, Global Procurement & Logistics, India" , "Commercial Executive" , "Sr. Officer (Eng.)" , "Joint Manager – Engineering Procurement"],
  source: ['Referral', 'Website', 'LinkedIn', 'Cold Call', 'Event', 'Existing Client']
};

const stateCities = {
  Gujarat: ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Gandhinagar', 'Bhavnagar'],
  Maharashtra: ['Mumbai', 'Pune', 'Nagpur', 'Nashik', 'Thane', 'Aurangabad'],
  Karnataka: ['Bengaluru', 'Mysuru', 'Mangaluru', 'Hubballi', 'Belagavi'],
  Delhi: ['New Delhi', 'North Delhi', 'South Delhi', 'East Delhi', 'West Delhi'],
  Rajasthan: ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Ajmer'],
  'Uttar Pradesh': ['Noida', 'Lucknow', 'Kanpur', 'Ghaziabad', 'Varanasi'],
  Haryana: ['Gurugram', 'Faridabad', 'Panipat', 'Ambala', 'Sonipat'],
  'Tamil Nadu': ['Chennai', 'Coimbatore', 'Madurai', 'Salem', 'Tiruchirappalli'],
  Telangana: ['Hyderabad', 'Warangal', 'Nizamabad', 'Karimnagar'],
  'West Bengal': ['Kolkata', 'Howrah', 'Durgapur', 'Siliguri'],
  Kerala: ['Kochi', 'Thiruvananthapuram', 'Kozhikode', 'Thrissur'],
  Punjab: ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala'],
  Goa: ['Panaji', 'Margao', 'Vasco da Gama', 'Mapusa']
};

function displayLeadId(item = {}) {
  const value = String(item.leadCode || item.leadNumber || item.sourceLeadId || '').trim();
  const businessMatch = value.match(/^ATPL(?:-LEAD)?-(\d+)$/i);
  if (businessMatch) return `ATPL-LEAD-${businessMatch[1].padStart(4, '0')}`;
  return /^[a-f\d]{24}$/i.test(value) ? '-' : (value || '-');
}

function nextVisibleLeadCode(leads = []) {
  const maximum = leads.reduce((max, item) => {
    const match = String(item.leadCode || item.leadNumber || '').match(/^ATPL(?:-LEAD)?-(\d+)$/i);
    return match ? Math.max(max, Number(match[1]) || 0) : max;
  }, 0);
  return `ATPL-LEAD-${String(maximum + 1).padStart(4, '0')}`;
}

function normalizeCompanyIdentity(value) {
  let normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/\bCORPORATION\b/g, ' CORP ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  const legalSuffix = /\s+(?:(?:PRIVATE|PVT)\s+(?:LIMITED|LTD)|LIMITED\s+LIABILITY(?:\s+PARTNERSHIP)?|LLP|LIMITED|LTD)$/;
  while (legalSuffix.test(normalized)) normalized = normalized.replace(legalSuffix, '').trim();
  return normalized;
}

function leadRecordId(item = {}) {
  return String(item._id || item.id || item.sourceLeadId || item.externalLeadId || '').trim();
}

function leadOwnerLabel(item = {}) {
  return String(item.importedCreatedBy || item.createdByName || item.createdBy?.name || item.createdBy?.email || item.assignedToText || item.assignedTo?.name || 'another user').trim();
}

function primaryLeadOwner(item = {}, users = [], currentUser = null) {
  const ownerRef = item.generatedForUser || item.createdOnBehalfOfUser || item.createdBy || null;
  const ownerId = String(ownerRef?._id || ownerRef?.id || ownerRef || '').trim();
  const matchedUser = [...users, ...(currentUser ? [currentUser] : [])].find((user) => [user?._id, user?.id, user?.crmUserId, user?.userId]
    .some((id) => ownerId && String(id || '') === ownerId));
  return {
    id: String(matchedUser?._id || matchedUser?.id || ownerId || currentUser?._id || currentUser?.id || '').trim(),
    name: matchedUser?.name || ownerRef?.name || item.generatedForName || item.createdOnBehalfOfName || item.createdByName || item.createdBy?.name || currentUser?.name || currentUser?.email || 'Lead Owner',
    email: matchedUser?.email || ownerRef?.email || item.generatedForEmail || item.createdOnBehalfOfEmail || item.createdByEmail || item.createdBy?.email || ''
  };
}

function userHasManagerRole(user = {}) {
  return [user.role, ...(Array.isArray(user.roles) ? user.roles : []), user.designation]
    .some((role) => /(^|[\s_-])manager($|[\s_-])/i.test(String(role || '')));
}

function personLabel(value, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') {
    return String(value.name || value.fullName || value.email || value.username || value._id || fallback);
  }
  return String(value);
}

function isTyreWasteCategory(value) {
  return /\btyre\b/i.test(String(value || ''));
}

function directApplicantOptions(value) {
  const category = String(value || '').toLowerCase();
  if (category.includes('plastic')) return null;
  if (category.includes('e-waste')) return ['Producer', 'Manufacturer', 'Recycler', 'Refurbisher'];
  if (category.includes('battery')) return ['Producer', 'Recycler', 'Refurbisher'];
  if (category.includes('tyre')) return ['Producer', 'Recycler', 'Retreader'];
  if (category.includes('used oil')) return ['Producers', 'Collection Agents', 'Recyclers', 'Used Oil Importers'];
  if (category) return ['Producer', 'Manufacturer', 'Importer', 'Recycler', 'Refurbisher', 'Service Provider'];
  return [];
}

function applicableServiceOptions(value) {
  const service = String(value || '').toLowerCase();
  if (service.includes('plastic') && service.includes('compliance')) {
    return ['Registration', 'Annual Return Filing', 'Audits - Producer / PWP', 'Credit Procurement'];
  }
  if (service.includes('e-waste') && service.includes('compliance')) {
    return ['Registration', 'Quarterly Filing', 'Annual Filing', 'Training & Awareness', 'Credit Procurements', 'Audit Support'];
  }
  if (service.includes('battery') && service.includes('compliance')) {
    return ['Registration', 'Quarterly Filing', 'Annual Filing', 'Credit Procurements', 'Audit Support'];
  }
  if (service.includes('tyre') && service.includes('compliance')) {
    return ['Registration', 'Quarterly Filing', 'Annual Filing', 'Credit Procurements', 'Audit Support'];
  }
  return [];
}

function createServiceSelection(source = {}) {
  return {
    assignedServiceId: source.assignedServiceId || source.serviceAssignmentId || `service_assignment_${crypto.randomUUID()}`,
    industryType: source.industryType || '',
    eprCategory: source.eprCategory || '',
    businessCategory: source.businessCategory || '',
    applicantType: source.applicantType || source.piboParent || source.piboCategoryParent || '',
    piboCategory: source.subApplicantType || source.piboCategory || '',
    servicesOffered: source.servicesOffered || '',
    applicableService: source.applicableService || '',
    plantUnit: source.plantUnit || '',
    firstAnnualReturnYearApplicable: source.firstAnnualReturnYearApplicable || '',
    createdByCrmUserId: source.createdByCrmUserId || '',
    createdByName: source.createdByName || source.leadGeneratedBy || '',
    createdByEmail: source.createdByEmail || ''
  };
}

const SERVICE_DUPLICATE_FIELDS = ['industryType', 'eprCategory', 'businessCategory', 'applicantType', 'piboCategory', 'servicesOffered', 'plantUnit', 'firstAnnualReturnYearApplicable'];
const PLANT_UNIT_OPTIONS = Array.from({ length: 10 }, (_, index) => `Unit ${index + 1}`);

function serviceSelectionIdentity(row = {}) {
  return SERVICE_DUPLICATE_FIELDS.map((field) => String(row[field] || '').trim().toLowerCase()).join('|');
}

function isCompleteServiceSelection(row = {}) {
  return SERVICE_DUPLICATE_FIELDS.every((field) => field === 'piboCategory' && directApplicantOptions(row.eprCategory)
    ? true
    : Boolean(String(row[field] || '').trim()));
}

function normalizeLegacyServiceSelections(source = {}) {
  const saved = (Array.isArray(source.serviceSelections) ? source.serviceSelections : []).map((row) => createServiceSelection(row));
  const topLevel = createServiceSelection({
    ...source,
    applicableService: source.applicableService || saved[0]?.applicableService || ''
  });
  const fields = ['industryType', 'eprCategory', 'businessCategory', 'applicantType', 'piboCategory', 'servicesOffered', 'applicableService', 'firstAnnualReturnYearApplicable'];
  const hasService = (row) => fields.some((field) => String(row?.[field] || '').trim());
  const identity = (row) => fields.map((field) => String(row?.[field] || '').trim().toLowerCase()).join('|');
  // Once the canonical array exists it is authoritative. Re-inserting stale
  // top-level compatibility fields made a confirmed deletion appear again.
  if (!Array.isArray(source.serviceSelections) && hasService(topLevel) && !saved.some((row) => identity(row) === identity(topLevel))) saved.unshift(topLevel);
  return saved.length ? saved : [topLevel];
}

function createAddressRow(source = {}) {
  return {
    assignedServiceId: source.assignedServiceId || '',
    plantUnit: source.plantUnit || '',
    addressLine1: source.addressLine1 || '',
    addressLine2: source.addressLine2 || '',
    addressLine3: source.addressLine3 || '',
    landmark: source.landmark || '',
    state: source.state || '',
    city: source.city || '',
    pinCode: source.pinCode || '',
    existingClient: source.existingClient || 'No',
    website: source.website || ''
  };
}

function uniqueDataRows(rows = []) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = JSON.stringify(Object.entries(row || {}).filter(([field]) => !['_id', 'id', 'createdAt', 'updatedAt'].includes(field)).sort(([left], [right]) => left.localeCompare(right)));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createContactRow(source = {}) {
  return {
    assignedServiceId: source.assignedServiceId || '',
    plantUnit: source.plantUnit || '',
    salutation: source.salutation || '',
    contactPerson: source.contactPerson || '',
    designation: source.designation || '',
    emails: source.emails || '',
    mobileNo1: source.mobileNo1 || '',
    mobileNo2: source.mobileNo2 || '',
    whatsappNo: source.whatsappNo || '',
    linkedinUrl: source.linkedinUrl || '',
    referredBy: source.referredBy || '',
    source: source.source || '',
    businessCardUrl: source.businessCardUrl || ''
  };
}

function plantUnitGroups(services = []) {
  const seen = new Set();
  return services.filter((service) => {
    const key = String(service?.plantUnit || service?.assignedServiceId || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const DETAIL_ROW_STRUCTURAL_FIELDS = new Set(['_id', 'id', 'createdAt', 'updatedAt', 'assignedServiceId', 'plantUnit']);

function hasDetailRowData(row = {}) {
  return Object.entries(row || {}).some(([field, value]) => !DETAIL_ROW_STRUCTURAL_FIELDS.has(field) && String(value || '').trim());
}

function compactDetailRows(savedRows = []) {
  const rows = Array.isArray(savedRows) ? savedRows : [];
  const hasPopulatedRow = rows.some(hasDetailRowData);
  return hasPopulatedRow ? rows.filter(hasDetailRowData) : rows.slice(0, 1);
}

function alignRowsToPlantUnits(services = [], savedRows = [], factory) {
  const rows = compactDetailRows(savedRows);
  const groups = plantUnitGroups(services);
  const activeUnits = new Set(groups.map((service) => String(service?.plantUnit || '').trim().toLowerCase()).filter(Boolean));
  const usedRows = new Set();
  const alignedRows = groups.map((service) => {
    const unit = String(service?.plantUnit || '').trim();
    let matchIndex = rows.findIndex((row, index) => !usedRows.has(index) && unit && String(row?.plantUnit || '').trim().toLowerCase() === unit.toLowerCase());
    if (matchIndex < 0) {
      matchIndex = rows.findIndex((row, index) => {
        const savedUnit = String(row?.plantUnit || '').trim().toLowerCase();
        return !usedRows.has(index)
          && row?.assignedServiceId === service.assignedServiceId
          && (!savedUnit || !activeUnits.has(savedUnit));
      });
    }
    // Older drafts could save the actual first record as Unit 2 after a blank
    // Unit 1 placeholder. Reuse that real record instead of generating another
    // blank row and appending the saved details underneath it.
    if (matchIndex < 0) {
      matchIndex = rows.findIndex((row, index) => {
        const savedUnit = String(row?.plantUnit || '').trim().toLowerCase();
        return !usedRows.has(index) && hasDetailRowData(row) && (!savedUnit || !activeUnits.has(savedUnit));
      });
    }
    if (matchIndex >= 0) usedRows.add(matchIndex);
    const match = matchIndex >= 0 ? rows[matchIndex] : factory(service);
    return { ...match, assignedServiceId: service.assignedServiceId, plantUnit: unit };
  });
  const additionalRows = rows.filter((row, index) => !usedRows.has(index) && hasDetailRowData(row));
  const result = [...alignedRows, ...additionalRows];
  return result.length ? result : [factory({ plantUnit: 'Unit 1' })];
}

function nextPlantUnit(...rowGroups) {
  const usedUnits = new Set(rowGroups.flat().map((row) => String(row?.plantUnit || '').trim().toLowerCase()).filter(Boolean));
  let unitNumber = 1;
  while (usedUnits.has(`unit ${unitNumber}`)) unitNumber += 1;
  return `Unit ${unitNumber}`;
}

function createAssignmentRow(source = {}) {
  return {
    assignedServiceId: source.assignedServiceId || '',
    plantUnit: source.plantUnit || '',
    assignedTo: source.assignedTo?._id || source.assignedTo || '',
    assignedToText: source.assignedToText || source.assignedTo?.name || '',
    assignedToEmail: source.assignedToEmail || source.assignedTo?.email || '',
    closedBy: source.closedBy?._id || source.closedBy || '',
    closedByText: source.closedByText || source.closedBy?.name || '',
    closedByEmail: source.closedByEmail || source.closedBy?.email || '',
    closedOnBehalfOfUser: source.closedOnBehalfOfUser?._id || source.closedOnBehalfOfUser || '',
    closedOnBehalfOfName: source.closedOnBehalfOfName || source.closedOnBehalfOfUser?.name || '',
    closedOnBehalfOfEmail: source.closedOnBehalfOfEmail || source.closedOnBehalfOfUser?.email || '',
    assignedStaff: source.assignedStaff?._id || source.assignedStaff || '',
    assignedStaffText: source.assignedStaffText || source.assignedStaff?.name || '',
    assignedStaffEmail: source.assignedStaffEmail || source.assignedStaff?.email || '',
    assignedBy: source.assignedBy || '',
    poStatus: source.poStatus || '',
    poYearRows: Array.isArray(source.poYearRows) ? source.poYearRows : [],
    poApprovalStatus: source.poApprovalStatus || '',
    quotationSent: source.quotationSent || '',
    earlierQuotationProofUrl: source.earlierQuotationProofUrl || '',
    earlierQuotationProofName: source.earlierQuotationProofName || '',
    closureRequestedBy: source.closureRequestedBy?._id || source.closureRequestedBy || '',
    closureRequestedByText: source.closureRequestedByText || source.closureRequestedBy?.name || '',
    closureFinalizedByManager: Boolean(source.closureFinalizedByManager),
    closureApprovalProofUrl: source.closureApprovalProofUrl || '',
    closureApprovalProofName: source.closureApprovalProofName || '',
    provisionalCloseExpiresAt: source.provisionalCloseExpiresAt || '',
    provisionalCloseDeadlineBusinessDays: Number(source.provisionalCloseDeadlineBusinessDays) || 0,
    originalPoConfirmed: Boolean(source.originalPoConfirmed),
    permanentClosedAt: source.permanentClosedAt || '',
    permanentClosedBy: source.permanentClosedBy?._id || source.permanentClosedBy || '',
    permanentClosedByText: source.permanentClosedByText || source.permanentClosedBy?.name || '',
    kickoffEmailConsent: source.kickoffEmailConsent === 'yes' ? 'yes' : source.kickoffEmailConsent === 'no' ? 'no' : ''
  };
}

export default function LeadGeneration() {
  const [currentUser, setCurrentUser] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [staff, setStaff] = useState([]);
  const [leads, setLeads] = useState([]);
  const [leadPagination, setLeadPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [leadSummary, setLeadSummary] = useState({ total: 0, existing: 0, converted: 0, new: 0 });
  const [allCcpLeads, setAllCcpLeads] = useState([]);
  const [companySearchResults, setCompanySearchResults] = useState([]);
  const [quotations, setQuotations] = useState([]);
  const [piboCategories, setPiboCategories] = useState([]);
  const [piboCategoriesLoading, setPiboCategoriesLoading] = useState(true);
  const [lead, setLead] = useState(emptyLead);
  const [editingLeadId, setEditingLeadId] = useState('');
  const [viewLead, setViewLead] = useState(null);
  const [activeTab, setActiveTab] = useState('basic');
  const [viewMode, setViewMode] = useState('list');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [excelFileName, setExcelFileName] = useState('');
  const [excelRows, setExcelRows] = useState([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const formStartedAtRef = useRef('');
  const leadListRequestRef = useRef(0);

  useEffect(() => {
    if (viewMode !== 'form') return;
    if (!formStartedAtRef.current) formStartedAtRef.current = lead.formStartedAt || new Date().toISOString();
    if (activeTab === 'assign' && !lead.assignReachedAt) {
      setLead((current) => ({ ...current, formStartedAt: current.formStartedAt || formStartedAtRef.current, assignReachedAt: new Date().toISOString() }));
    }
  }, [viewMode, activeTab, lead.formStartedAt, lead.assignReachedAt]);
  const [healthPromptOpen, setHealthPromptOpen] = useState(false);
  const [introductionPromptOpen, setIntroductionPromptOpen] = useState(false);
  const [introductionConsent, setIntroductionConsent] = useState(false);
  const [healthReportLead, setHealthReportLead] = useState(null);
  const [healthReport, setHealthReport] = useState(emptyComplianceHealthReport);
  const [healthReportSaving, setHealthReportSaving] = useState(false);
  const [healthReportError, setHealthReportError] = useState('');
  const [healthAssignmentOpen, setHealthAssignmentOpen] = useState(false);
  const [healthManagerId, setHealthManagerId] = useState('');
  const [companySearch, setCompanySearch] = useState('');
  const [companySearchTouched, setCompanySearchTouched] = useState(false);
  const [companySearchLoading, setCompanySearchLoading] = useState(false);
  const [selectedSearchLead, setSelectedSearchLead] = useState(null);
  const [duplicateDecisionOpen, setDuplicateDecisionOpen] = useState(false);
  const [generatedForOpen, setGeneratedForOpen] = useState(false);
  const [generatedForAction, setGeneratedForAction] = useState('new');
  const [generatedForMode, setGeneratedForMode] = useState('');
  const [generatedForUserId, setGeneratedForUserId] = useState('');
  const [generatedForConfirmed, setGeneratedForConfirmed] = useState(false);
  const [duplicateApprovalMode, setDuplicateApprovalMode] = useState(false);
  const [duplicateNoOptions, setDuplicateNoOptions] = useState(false);
  const [serviceOnlyMode, setServiceOnlyMode] = useState(false);
  const [duplicateApprovalSaving, setDuplicateApprovalSaving] = useState(false);
  const [duplicateApproval, setDuplicateApproval] = useState({ reason: '', requesterEmail: '', screenshotUrl: '', screenshotName: '' });
  const [duplicateLeadApprovals, setDuplicateLeadApprovals] = useState([]);
  const [countryStates, setCountryStates] = useState([]);
  const [citiesByState, setCitiesByState] = useState({});
  const [locationLoading, setLocationLoading] = useState({ states: false, cities: {} });
  const [locationError, setLocationError] = useState('');
  const [frozenServiceRowCount, setFrozenServiceRowCount] = useState(0);
  const [frozenAddressRowCount, setFrozenAddressRowCount] = useState(0);
  const [frozenContactRowCount, setFrozenContactRowCount] = useState(0);
  const [frozenAssignmentRowCount, setFrozenAssignmentRowCount] = useState(0);
  const [specifyDialog, setSpecifyDialog] = useState(null);
  const [specifyNote, setSpecifyNote] = useState('');
  const [royaltyClaiming, setRoyaltyClaiming] = useState(false);
  const [royaltyClaimed, setRoyaltyClaimed] = useState(false);
  const [closureDialog, setClosureDialog] = useState(null);
  const [closureSaving, setClosureSaving] = useState(false);
  const [kickoffDialog, setKickoffDialog] = useState(null);
  const [closureUploading, setClosureUploading] = useState(false);
  const [serviceCatalog, setServiceCatalog] = useState([]);
  const [customDropdownOptions, setCustomDropdownOptions] = useState({});
  const [catalogDialog, setCatalogDialog] = useState(null);
  const [catalogValue, setCatalogValue] = useState('');
  const [catalogServices, setCatalogServices] = useState(['']);
  const [catalogSaving, setCatalogSaving] = useState(false);
  const [dropdownDialog, setDropdownDialog] = useState(null);
  const [dropdownValue, setDropdownValue] = useState('');
  const [dropdownSaving, setDropdownSaving] = useState(false);
  const [serviceRemoveIndex, setServiceRemoveIndex] = useState(null);
  const [addRowConfirmation, setAddRowConfirmation] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { leadId: complianceRouteLeadId } = useParams();

  const resolvedPiboParent = lead.piboParent || lead.piboCategoryParent || inferPiboParent(lead.piboCategory);
  const primaryDirectSelection = Boolean(directApplicantOptions(lead.eprCategory));
  const resolvedApplicantType = primaryDirectSelection ? lead.applicantType : resolvedPiboParent;
  const basicStepServiceRows = normalizeLegacyServiceSelections(lead);
  const areBasicServiceRowsComplete = basicStepServiceRows.every((row) => row.industryType && row.businessCategory && row.eprCategory && row.applicantType && row.servicesOffered && row.plantUnit && row.firstAnnualReturnYearApplicable && (directApplicantOptions(row.eprCategory) || row.piboCategory));
  const isFirstStepReady = Boolean(lead.status && lead.company && resolvedApplicantType && (primaryDirectSelection || lead.piboCategory) && lead.servicesOffered && areBasicServiceRowsComplete);
  const ownershipRequired = Boolean(!editingLeadId && !serviceOnlyMode && lead.company.trim() && !generatedForConfirmed);
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTab);
  const canUseExcelBulkImport = adminRoles.includes(String(currentUser?.role || '').toLowerCase());
  const canManageServiceCatalog = adminRoles.includes(String(currentUser?.role || '').toLowerCase());
  const canRemoveFrozenAddress = adminRoles.includes(String(currentUser?.role || '').trim().toLowerCase());
  const serviceCategoryOptions = serviceCatalog.map((entry) => entry.category);
  const servicesForCategory = (category) => serviceCatalog.find((entry) => entry.category === category)?.servicesOffered || [];
  const withCustomOptions = (field, base = []) => [...new Map([...(base || []), ...(customDropdownOptions[field] || [])].filter(Boolean).map((item) => [String(item).trim().toLowerCase(), item])).values()];

  async function addCustomDropdownOption(field, name, label) {
    try {
      const response = await api.post(API_ENDPOINTS.leads.dropdownOptions, { field, name });
      const added = response.data.option.name;
      setCustomDropdownOptions((current) => ({ ...current, [field]: withCustomOptions(field, [...(current[field] || []), added]) }));
      showToast(`${added} added to ${label}.`, 'success');
      return added;
    } catch (requestError) {
      showToast(requestError?.response?.data?.error || `Unable to add ${label}.`, 'error');
      return '';
    }
  }

  function openDropdownDialog(config) {
    setDropdownValue('');
    setDropdownDialog(config);
  }

  async function submitDropdownDialog() {
    const name = dropdownValue.trim();
    if (!dropdownDialog || !name || dropdownSaving) return;
    setDropdownSaving(true);
    const added = await addCustomDropdownOption(dropdownDialog.field, name, dropdownDialog.label);
    if (added) {
      if (dropdownDialog.scope === 'lead') updateField(dropdownDialog.targetField, added);
      if (dropdownDialog.scope === 'service') updateServiceRow(dropdownDialog.index, dropdownDialog.targetField, added);
      if (dropdownDialog.scope === 'address') updateAddressRow(dropdownDialog.index, dropdownDialog.targetField, added);
      if (dropdownDialog.scope === 'contact') updateContactRow(dropdownDialog.index, dropdownDialog.targetField, added);
      setDropdownDialog(null);
      setDropdownValue('');
    }
    setDropdownSaving(false);
  }

  const staffOptions = useMemo(() => {
    const seen = new Set();
    return staff.flatMap((user) => {
      const label = `${user.name || user.email} (${user.team || 'No team assigned'})`;
      return [user._id, user.id, user.crmUserId, user.userId]
        .filter(Boolean)
        .filter((id) => {
          const key = String(id);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((id) => ({ value: String(id), label }));
    });
  }, [staff]);
  const managerOptions = useMemo(() => {
    const managers = staff.filter(userHasManagerRole);
    const seen = new Set();
    return managers.flatMap((user) => {
      const label = `${user.name || user.email} (${user.role || user.designation || 'Manager'})`;
      return [user._id, user.id, user.crmUserId, user.userId].filter(Boolean).filter((id) => {
        const key = String(id);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).map((id) => ({ value: String(id), label }));
    });
  }, [staff]);
  const generatedForOptions = useMemo(() => {
    const seen = new Set();
    return staff.map((user) => ({
      value: String(user._id || user.id || user.crmUserId || user.userId || ''),
      label: `${user.name || user.email} (${user.role || 'User'})`
    })).filter((option) => option.value && !seen.has(option.value) && seen.add(option.value));
  }, [staff]);
  const selectedGeneratedForUser = generatedForMode === 'self'
    ? currentUser
    : staff.find((user) => [user._id, user.id, user.crmUserId, user.userId].some((id) => String(id || '') === String(generatedForUserId)));
  const cityOptions = lead.state ? stateCities[lead.state] || [] : [];
  const serviceRows = normalizeLegacyServiceSelections(lead);
  const alignRowsToServices = (savedRows, factory) => serviceRows.map((service, index) => {
    const match = (Array.isArray(savedRows) ? savedRows : []).find((row) => row?.assignedServiceId && row.assignedServiceId === service.assignedServiceId)
      || (Array.isArray(savedRows) ? savedRows[index] : null)
      || factory(index === 0 ? lead : {});
    return { ...match, assignedServiceId: service.assignedServiceId, plantUnit: service.plantUnit || match.plantUnit || '' };
  });
  const unitServices = plantUnitGroups(serviceRows);
  const addressRows = alignRowsToPlantUnits(serviceRows, lead.addresses, createAddressRow);
  const contactRows = alignRowsToPlantUnits(serviceRows, lead.contacts, createContactRow);
  const savedAssignmentRows = Array.isArray(lead.assignments) ? lead.assignments : [];
  const assignmentRows = alignRowsToServices(savedAssignmentRows, createAssignmentRow);
  const assignmentHasPlastic = serviceRows.some((row) => /plastic\s+waste/i.test(String(row?.eprCategory || '')));
  const assignmentHasNonPlastic = serviceRows.some((row) => row?.eprCategory && !/plastic\s+waste/i.test(String(row.eprCategory)));
  const assignmentApplicantLabel = assignmentHasPlastic && assignmentHasNonPlastic
    ? 'Applicant / Sub Applicant Type'
    : assignmentHasPlastic ? 'Sub Applicant Type' : 'Applicant Type';
  const normalizedCompanySearch = normalizeCompanyIdentity(companySearch);
  const companySearchMatches = useMemo(() => {
    if (normalizedCompanySearch.length < 2) return [];
    return companySearchResults;
  }, [companySearchResults, normalizedCompanySearch]);
  const approvedCompanyIdentities = useMemo(() => new Set(
    duplicateLeadApprovals.filter((item) => item.approvalStatus === 'APPROVED').map((item) => item.payload?.companyIdentity).filter(Boolean)
  ), [duplicateLeadApprovals]);
  const duplicateCompanyLead = useMemo(() => {
    const identity = normalizeCompanyIdentity(lead.company);
    if (!identity) return null;
    const approved = duplicateLeadApprovals.some((item) => item.approvalStatus === 'APPROVED' && item.payload?.companyIdentity === identity);
    if (approved) return null;
    return allCcpLeads.find((item) => normalizeCompanyIdentity(item.company) === identity && leadRecordId(item) !== String(editingLeadId || '')) || null;
  }, [allCcpLeads, lead.company, editingLeadId, duplicateLeadApprovals]);
  const canClaimRoyalty = useMemo(() => {
    if (!serviceOnlyMode || !selectedSearchLead) return false;
    const identityTokens = (source = {}) => [
      source.createdByCrmUserId,
      source.createdByEmail,
      source.createdByName,
      source.importedCreatedBy,
      source.createdBy?._id,
      source.createdBy?.id,
      source.createdBy?.crmUserId,
      source.createdBy?.email,
      source.createdBy?.name
    ].filter(Boolean).map((value) => String(value).trim().toLowerCase());
    const currentTokens = [
      currentUser?._id,
      currentUser?.id,
      currentUser?.crmUserId,
      currentUser?.email,
      currentUser?.name
    ].filter(Boolean).map((value) => String(value).trim().toLowerCase());
    const originalTokens = identityTokens(selectedSearchLead);
    const creatorGroups = serviceRows
      .map((row, index) => {
        const tokens = identityTokens(row);
        return tokens.length ? tokens : index < frozenServiceRowCount ? originalTokens : currentTokens;
      })
      .filter((tokens) => tokens.length);
    const distinctCreators = [];
    creatorGroups.forEach((tokens) => {
      if (!distinctCreators.some((known) => known.some((token) => tokens.includes(token)))) distinctCreators.push(tokens);
    });
    const currentUserContributed = distinctCreators.some((tokens) => tokens.some((token) => currentTokens.includes(token)));
    const currentUserIsOriginal = originalTokens.some((token) => currentTokens.includes(token));
    return distinctCreators.length >= 2 && currentUserContributed && !currentUserIsOriginal;
  }, [serviceOnlyMode, selectedSearchLead, currentUser, serviceRows, frozenServiceRowCount]);
  const royaltyClaimRowIndex = useMemo(() => {
    if (!canClaimRoyalty) return -1;
    const currentTokens = [currentUser?._id, currentUser?.id, currentUser?.crmUserId, currentUser?.userId, currentUser?.email, currentUser?.name]
      .filter(Boolean).map((value) => String(value).trim().toLowerCase());
    const ownedIndexes = serviceRows.map((row, index) => ({
      index,
      tokens: [row.createdByCrmUserId, row.createdByEmail, row.createdByName]
        .filter(Boolean).map((value) => String(value).trim().toLowerCase())
    })).filter(({ index, tokens }) => tokens.some((token) => currentTokens.includes(token)) || (index >= frozenServiceRowCount && !tokens.length));
    return ownedIndexes.at(-1)?.index ?? -1;
  }, [canClaimRoyalty, currentUser, frozenServiceRowCount, serviceRows]);
  const approvedRoyalty = useMemo(() => duplicateLeadApprovals.find((item) =>
    item.type === 'lead_royalty'
    && item.approvalStatus === 'APPROVED'
    && String(item.payload?.leadId || '') === String(editingLeadId || leadRecordId(selectedSearchLead || {}))
  ), [duplicateLeadApprovals, editingLeadId, selectedSearchLead]);

  function updateServiceRow(index, field, value) {
    const next = serviceRows.map((row) => ({ ...row }));
    next[index] = { ...next[index], [field]: value };
    if (field === 'eprCategory') {
      next[index].applicantType = '';
      next[index].piboCategory = '';
      next[index].servicesOffered = '';
      next[index].applicableService = '';
    }
    if (field === 'applicantType') next[index].piboCategory = '';
    if (field === 'servicesOffered') next[index].applicableService = '';
    if (isCompleteServiceSelection(next[index])) {
      const duplicateIndex = next.findIndex((row, rowIndex) => rowIndex !== index && isCompleteServiceSelection(row) && serviceSelectionIdentity(row) === serviceSelectionIdentity(next[index]));
      if (duplicateIndex >= 0) {
        showToast(`This service combination already exists in row ${duplicateIndex + 1}. Please change at least one field.`, 'warning');
        return;
      }
    }
    const first = next[0];
    const direct = Boolean(directApplicantOptions(first.eprCategory));
    setLead((current) => ({
      ...current,
      serviceSelections: next,
      industryType: first.industryType,
      eprCategory: first.eprCategory,
      applicantType: first.applicantType,
      piboParent: direct ? '' : first.applicantType,
      piboCategoryParent: '',
      piboCategory: direct ? '' : first.piboCategory,
      subApplicantType: direct ? '' : first.piboCategory,
      servicesOffered: first.servicesOffered,
      applicableService: first.applicableService
      ,firstAnnualReturnYearApplicable: first.firstAnnualReturnYearApplicable
    }));
  }

  function openCatalogDialog(type, rowIndex = null, category = '') {
    setCatalogValue('');
    setCatalogServices(['']);
    setCatalogDialog({ type, rowIndex, category });
  }

  async function submitCatalogDialog() {
    const value = catalogValue.trim();
    const services = [...new Map(catalogServices.map((service) => String(service || '').trim()).filter(Boolean).map((service) => [service.toLowerCase(), service])).values()];
    if (catalogSaving || !catalogDialog || (catalogDialog.type === 'category' ? !value : !services.length)) return;
    setCatalogSaving(true);
    try {
      if (catalogDialog.type === 'category') {
        const response = await api.post(API_ENDPOINTS.leads.serviceCatalogCategories, { category: value });
        const entry = response.data.catalog;
        setServiceCatalog((current) => [...current, entry].sort((a, b) => a.category.localeCompare(b.category)));
        setCatalogValue('');
        setCatalogServices(['']);
        setCatalogDialog({ type: 'service', rowIndex: catalogDialog.rowIndex, category: entry.category, afterCategory: true });
        if (Number.isInteger(catalogDialog.rowIndex)) updateServiceRow(catalogDialog.rowIndex, 'eprCategory', entry.category);
        showToast(`${entry.category} Service Category added. Now add its Services Offered.`, 'success');
      } else {
        const response = await api.post(API_ENDPOINTS.leads.serviceCatalogServices(catalogDialog.category), { services });
        const entry = response.data.catalog;
        setServiceCatalog((current) => current.map((item) => item.category === entry.category ? entry : item));
        if (Number.isInteger(catalogDialog.rowIndex)) updateServiceRow(catalogDialog.rowIndex, 'servicesOffered', response.data.addedServices?.[0] || services[0]);
        setCatalogDialog(null);
        setCatalogValue('');
        setCatalogServices(['']);
        showToast(`${response.data.addedServices?.length || services.length} Services Offered added under ${entry.category}.`, 'success');
      }
    } catch (requestError) {
      showToast(requestError?.response?.data?.error || 'Unable to update the service catalog.', 'error');
    } finally {
      setCatalogSaving(false);
    }
  }

  function addServiceRow() {
    setLead((current) => {
      const service = createServiceSelection({ createdByCrmUserId: currentUser?._id || currentUser?.id, createdByName: currentUser?.name || currentUser?.email, createdByEmail: currentUser?.email });
      return {
        ...current,
        serviceSelections: [...serviceRows, service],
        addresses: [...addressRows, createAddressRow(service)],
        contacts: [...contactRows, createContactRow(service)],
        assignments: [...assignmentRows, createAssignmentRow(service)]
      };
    });
  }

  function removeServiceRow(index) {
    setLead((current) => {
      const currentRows = normalizeLegacyServiceSelections(current);
      if (currentRows.length === 1 || index < 0 || index >= currentRows.length) return current;
      const next = currentRows.filter((_, rowIndex) => rowIndex !== index);
      const currentAssignments = Array.isArray(current.assignments) ? current.assignments : [];
      const nextAssignments = currentAssignments.filter((_, rowIndex) => rowIndex !== index);
      const nextAddresses = (Array.isArray(current.addresses) ? current.addresses : []).filter((_, rowIndex) => rowIndex !== index);
      const nextContacts = (Array.isArray(current.contacts) ? current.contacts : []).filter((_, rowIndex) => rowIndex !== index);
      const first = next[0];
      const direct = Boolean(directApplicantOptions(first.eprCategory));
      return {
        ...current,
        serviceSelections: next,
        assignments: nextAssignments,
        addresses: nextAddresses,
        contacts: nextContacts,
        industryType: first.industryType,
        eprCategory: first.eprCategory,
        applicantType: first.applicantType,
        piboParent: direct ? '' : first.applicantType,
        piboCategoryParent: '',
        piboCategory: direct ? '' : first.piboCategory,
        subApplicantType: direct ? '' : first.piboCategory,
        servicesOffered: first.servicesOffered,
        applicableService: first.applicableService,
        firstAnnualReturnYearApplicable: first.firstAnnualReturnYearApplicable
      };
    });
    if (index < frozenServiceRowCount) {
      setFrozenServiceRowCount((count) => Math.max(0, count - 1));
      setFrozenAssignmentRowCount((count) => Math.max(0, count - 1));
    }
    showToast(`Service row ${index + 1} removed.`, 'success');
  }

  function openExistingLeadDecision(item) {
    setSelectedSearchLead(item);
    setDuplicateApprovalMode(false);
    setDuplicateNoOptions(false);
    setDuplicateApproval({ reason: '', requesterEmail: currentUser?.email || '', screenshotUrl: '', screenshotName: '' });
    setDuplicateDecisionOpen(true);
  }

  async function runCompanySearch() {
    const query = companySearch.trim();
    if (query.length < 2 || companySearchLoading) {
      if (query.length < 2) setCompanySearchResults([]);
      return;
    }
    setCompanySearchLoading(true);
    setCompanySearchTouched(false);
    try {
      const response = await api.get(API_ENDPOINTS.leads.companySearch, { params: { q: query } });
      setCompanySearchResults(response.data?.leads || []);
      setCompanySearchTouched(true);
    } catch (requestError) {
      setCompanySearchResults([]);
      showToast(requestError?.response?.data?.error || 'Company search could not be completed. Please retry.', 'error');
    } finally {
      setCompanySearchLoading(false);
    }
  }

  function continueWithDuplicateTemplate() {
    setLead({ ...emptyLead });
    setEditingLeadId('');
    setServiceOnlyMode(false);
    setDuplicateDecisionOpen(false);
    setCompanySearch('');
    setCompanySearchTouched(false);
    showToast('Blank new lead form opened. Duplicate validation will run before save.', 'success');
  }

  function startAddServicesMode() {
    if (!selectedSearchLead) return;
    const rows = normalizeLegacyServiceSelections(selectedSearchLead);
    setLead({ ...emptyLead, ...selectedSearchLead, leadCode: displayLeadId(selectedSearchLead) === '-' ? nextVisibleLeadCode(allCcpLeads) : selectedSearchLead.leadCode, serviceSelections: rows.map((row, index) => ({ ...row, firstAnnualReturnYearApplicable: row.firstAnnualReturnYearApplicable || (index === 0 ? selectedSearchLead.firstAnnualReturnYearApplicable : '') })), addresses: Array.isArray(selectedSearchLead.addresses) && selectedSearchLead.addresses.length ? selectedSearchLead.addresses : [createAddressRow(selectedSearchLead)] });
    setEditingLeadId(leadRecordId(selectedSearchLead));
    setRoyaltyClaimed(false);
    setRoyaltyClaiming(false);
    setServiceOnlyMode(true);
    setFrozenServiceRowCount(rows.length);
    setFrozenAddressRowCount(Array.isArray(selectedSearchLead.addresses) && selectedSearchLead.addresses.length ? selectedSearchLead.addresses.length : 1);
    setFrozenContactRowCount(Array.isArray(selectedSearchLead.contacts) && selectedSearchLead.contacts.length ? selectedSearchLead.contacts.length : 1);
    setFrozenAssignmentRowCount(Array.isArray(selectedSearchLead.assignments) && selectedSearchLead.assignments.length ? selectedSearchLead.assignments.length : 1);
    setActiveTab('basic');
    setDuplicateDecisionOpen(false);
    setCompanySearch(selectedSearchLead.company || '');
    setCompanySearchTouched(false);
    showToast('Add Services mode opened. Existing lead details are frozen; only service rows can be changed.', 'success');
  }

  function openGeneratedForChooser(action = 'new') {
    setGeneratedForAction(action);
    setGeneratedForMode('');
    setGeneratedForUserId('');
    if (action === 'services') setDuplicateDecisionOpen(false);
    setGeneratedForOpen(true);
  }

  function confirmGeneratedFor() {
    if (!generatedForMode) return showToast('Please choose Yourself or Other User.', 'error');
    const userId = generatedForMode === 'self'
      ? String(currentUser?._id || currentUser?.id || currentUser?.crmUserId || currentUser?.userId || '')
      : generatedForUserId;
    if (!userId) return showToast('Please select the user who owns this lead.', 'error');
    setGeneratedForUserId(userId);
    setGeneratedForConfirmed(true);
    setGeneratedForOpen(false);
    if (generatedForAction === 'services') startAddServicesMode();
  }

  function openAddServicesMode() {
    openGeneratedForChooser('services');
  }

  function updateAddressRow(index, field, value) {
    if (field === 'pinCode') value = String(value || '').replace(/\D/g, '').slice(0, 6);
    const next = addressRows.map((row) => ({ ...row }));
    next[index] = { ...next[index], [field]: value, ...(field === 'state' ? { city: '' } : {}) };
    const first = next[0];
    setLead((current) => ({ ...current, addresses: next, ...first }));
    if (field === 'state' && value) loadCitiesForState(value);
  }

  async function loadCitiesForState(state) {
    const key = String(state || '').trim();
    if (!key || citiesByState[key]) return;
    setLocationLoading((current) => ({ ...current, cities: { ...current.cities, [key]: true } }));
    try {
      const cities = await fetchIndiaStateCities(key);
      setCitiesByState((current) => ({ ...current, [key]: cities }));
      setLocationError('');
    } catch (requestError) {
      setLocationError(requestError?.message || 'Live city list could not be loaded. Showing available local options.');
    } finally {
      setLocationLoading((current) => ({ ...current, cities: { ...current.cities, [key]: false } }));
    }
  }

  function addAddressRow() {
    const plantUnit = nextPlantUnit(serviceRows, addressRows);
    setLead((current) => ({ ...current, addresses: [...addressRows, createAddressRow({ plantUnit })] }));
    setAddRowConfirmation(null);
  }

  function removeAddressRow(index) {
    if (addressRows.length === 1) return;
    const next = addressRows.filter((_, rowIndex) => rowIndex !== index);
    setLead((current) => ({ ...current, addresses: next, ...next[0] }));
    if (index < frozenAddressRowCount) {
      setFrozenAddressRowCount((count) => Math.max(0, count - 1));
    }
  }

  function updateContactRow(index, field, value) {
    const next = contactRows.map((row) => ({ ...row }));
    next[index] = { ...next[index], [field]: value };
    setLead((current) => ({ ...current, contacts: next, ...next[0] }));
  }

  function addContactRow() {
    const plantUnit = nextPlantUnit(serviceRows, contactRows);
    setLead((current) => ({ ...current, contacts: [...contactRows, createContactRow({ plantUnit })] }));
    setAddRowConfirmation(null);
  }

  function removeContactRow(index) {
    if (contactRows.length === 1) return;
    const next = contactRows.filter((_, rowIndex) => rowIndex !== index);
    setLead((current) => ({ ...current, contacts: next, ...next[0] }));
  }

  async function uploadContactBusinessCard(index, event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const uploaded = await uploadMedia(file, 'crm/leads/business-cards');
      updateContactRow(index, 'businessCardUrl', uploaded.secureUrl);
      showToast('Business card uploaded.', 'success');
    } catch (uploadError) {
      showToast(uploadError?.message || 'Business card upload failed.', 'error');
    }
  }

  function buildUpdatedAssignmentRows(index, field, value, extra = {}) {
    const user = staff.find((item) => [item._id, item.id, item.crmUserId, item.userId].filter(Boolean).some((id) => String(id) === String(value)));
    const next = assignmentRows.map((row) => ({ ...row }));
    next[index] = field === 'assignedTo'
      ? { ...next[index], assignedTo: value, assignedToText: user?.name || user?.email || '', assignedToEmail: user?.email || '', ...(value && String(next[index].poApprovalStatus || '').toUpperCase() === 'APPROVED' && next[index].closureRequestedBy ? { closedBy: next[index].closureRequestedBy, closedByText: next[index].closureRequestedByText || '', closedAt: new Date().toISOString(), closureFinalizedByManager: true } : {}) }
      : field === 'assignedStaff'
        ? { ...next[index], assignedStaff: value, assignedStaffText: user?.name || user?.email || '', assignedStaffEmail: user?.email || '', ...extra }
        : {
            ...next[index],
            closedBy: value,
            closedByText: user?.name || user?.email || '',
            closedByEmail: user?.email || '',
            ...(!value ? { assignedTo: '', assignedToText: '', assignedToEmail: '', assignedStaff: '', assignedStaffText: '', assignedStaffEmail: '', poStatus: '', poYearRows: [], closureApprovalProofUrl: '', closureApprovalProofName: '', provisionalCloseExpiresAt: '', kickoffEmailConsent: '' } : {}),
            ...extra
          };
    return next;
  }

  function updateAssignmentRow(index, field, value, extra = {}) {
    const next = buildUpdatedAssignmentRows(index, field, value, extra);
    setLead((current) => ({
      ...current,
      assignments: next,
      ...next[0],
      assignedToCrmUserId: next[0].assignedTo,
      assignedStaff: next[0].assignedStaff,
      assignedStaffText: next[0].assignedStaffText,
      assignedStaffEmail: next[0].assignedStaffEmail,
      closedByCrmUserId: next[0].closedBy,
      assignedBy: currentUser?.name || currentUser?.email || ''
    }));
  }

  function requestLeadClosure(index, value, sourceLead = lead) {
    if (!value) return updateAssignmentRow(index, 'closedBy', '');
    const matchingService = normalizeLegacyServiceSelections(sourceLead)[index] || {};
    const sourceAssignments = sourceLead.assignments || [];
    const matchingAssignment = sourceAssignments.find((assignment) => matchingService.assignedServiceId
      && assignment?.assignedServiceId === matchingService.assignedServiceId) || sourceAssignments[index] || {};
    const reviewMode = matchingAssignment.poStatus === 'provisional';
    const relevantQuotations = quotations.filter((quote) => {
      const leadMatch = [quote.leadId, quote.leadCode, quote.businessLeadCode].filter(Boolean).some((id) => [sourceLead._id, sourceLead.id, sourceLead.sourceLeadId, sourceLead.leadCode].filter(Boolean).map(String).includes(String(id?._id || id?.id || id)));
      return leadMatch && !['rejected'].includes(String(quote.status || '').toLowerCase());
    }).sort((left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0));
    const quotationSelection = selectLeadClosureQuotation(relevantQuotations, {
      service: matchingService,
      assignment: matchingAssignment,
      serviceIndex: index
    });
    const latestQuotation = quotationSelection.quotation;
    const selectedQuotationItems = quotationSelection.items;
    const defaultAmount = latestQuotation?.pricingMode === 'combined'
      ? Number(latestQuotation.combinedBasicAmount || latestQuotation.grandTotal || 0)
      : selectedQuotationItems.reduce((sum, item) => sum + ((Number(item.unit) || 1) * (Number(item.basicAmount) || 0)), 0);
    const quoteRow = (item = matchingService, itemIndex = 0) => ({
      fy: item.servicesForYear || item.financialYear || item.firstAnnualReturnYearApplicable || matchingService.firstAnnualReturnYearApplicable || '',
      poNumber: '', poDate: '', poEndDate: '', poFinancialYear: '', annualReturnYear: '', registrationYear: '', paymentTerm: latestQuotation?.paymentTerm || '', poAmount: latestQuotation?.pricingMode === 'combined' ? defaultAmount : ((Number(item.unit) || 1) * (Number(item.basicAmount) || 0)), poFileUrl: '', poFileName: '', poFileMimeType: '', poFileSize: null, currency: 'INR', poReceivedDate: '',
      services: [item.servicesOffered || item.applicableService || matchingService.servicesOffered].filter(Boolean),
      quotationItemIndex: itemIndex,
      quotationId: latestQuotation?._id || latestQuotation?.id || '', quotationNumber: latestQuotation?.quotationNumber || '',
      quotationBasicAmount: latestQuotation?.pricingMode === 'combined'
        ? (itemIndex === 0 ? defaultAmount : 0)
        : ((Number(item.unit) || 1) * (Number(item.basicAmount) || 0)),
      quotationItems: selectedQuotationItems, quotationCreatedById: latestQuotation?.createdBy?._id || latestQuotation?.createdBy || '',
      quotationCreatedByEmail: latestQuotation?.createdBy?.email || latestQuotation?.createdByEmail || ''
    });
    const fetchedPoRows = selectedQuotationItems.length ? selectedQuotationItems.map(quoteRow) : [quoteRow()];
    const savedPoRows = Array.isArray(matchingAssignment.poYearRows) ? matchingAssignment.poYearRows : [];
    const poYearRows = hydrateClosurePoRows(fetchedPoRows, savedPoRows, matchingService);
    const actorId = String(currentUser?._id || currentUser?.id || '');
    const leadOwner = primaryLeadOwner(sourceLead, staff, currentUser);
    setClosureDialog({ index, value: actorId || value, behalfMode: 'lead-owner', behalfUserId: leadOwner.id, leadOwnerName: leadOwner.name, leadOwnerEmail: leadOwner.email, selectedService: matchingService, reviewMode, choice: reviewMode ? 'yes' : '', quotationSent: reviewMode ? 'yes' : '', quotation: latestQuotation, quotationItems: selectedQuotationItems, poModeConfirmed: true, poMode: 'quotation', poYearRows, crmPoYearRows: poYearRows, approvalProofUrl: '', approvalProofName: '', earlierQuotationProofUrl: '', earlierQuotationProofName: '' });
  }

  async function uploadClosureFile(event, type, rowIndex = 0) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setClosureUploading(true);
    console.info('[POProof:upload:start]', { type, rowIndex, fileName: file.name, fileType: file.type, fileSize: file.size });
    try {
      const uploaded = await uploadMedia(file, type === 'po' ? 'crm/leads/purchase-orders' : 'crm/leads/closure-approvals');
      console.info('[POProof:upload:complete]', { type, rowIndex, fileName: uploaded.name || file.name, hasSecureUrl: Boolean(uploaded.secureUrl), publicId: uploaded.publicId || '' });
      setClosureDialog((current) => type === 'po'
        ? { ...current, poYearRows: current.poYearRows.map((row, index) => index === rowIndex ? { ...row, poFileUrl: uploaded.secureUrl, poFileName: uploaded.name || file.name, poFileMimeType: uploaded.type || file.type || '', poFileSize: Number.isFinite(uploaded.bytes) ? uploaded.bytes : (Number.isFinite(uploaded.size) ? uploaded.size : null), poReceivedDate: row.poReceivedDate || new Date().toISOString(), currency: row.currency || 'INR' } : row) }
        : type === 'quotation'
          ? { ...current, earlierQuotationProofUrl: uploaded.secureUrl, earlierQuotationProofName: uploaded.name || file.name }
          : { ...current, approvalProofUrl: uploaded.secureUrl, approvalProofName: file.name });
    } catch (uploadError) {
      console.error('[POProof:upload:error]', { type, rowIndex, message: uploadError?.message || 'File upload failed' });
      showToast(uploadError?.message || 'File upload failed.', 'error');
    } finally { setClosureUploading(false); }
  }

  function selectClosureQuotationMode(mode) {
    setClosureDialog((current) => {
      if (!current) return current;
      if (mode === 'no') {
        const switchingToEarlierProof = current.quotationSent !== 'no';
        const selectedRow = (current.poYearRows || []).find((row) => !current.selectedService?.assignedServiceId
          || String(row.assignedServiceId || '') === String(current.selectedService.assignedServiceId))
          || current.poYearRows?.[0]
          || {};
        return {
          ...current,
          quotationSent: 'no',
          poYearRows: [buildManualClosurePoRow(selectedRow, current.selectedService || {}, switchingToEarlierProof)]
        };
      }
      const currentRows = current.poYearRows || [];
      return {
        ...current,
        quotationSent: 'yes',
        earlierQuotationProofUrl: '',
        earlierQuotationProofName: '',
        poYearRows: (current.crmPoYearRows || currentRows).map((quotationRow, index) => {
          const entered = currentRows[index] || {};
          return {
            ...quotationRow,
            poNumber: entered.poNumber || '',
            poDate: entered.poDate || '',
            poEndDate: entered.poEndDate || '',
            poFinancialYear: entered.poFinancialYear || '',
            annualReturnYear: entered.annualReturnYear || '',
            registrationYear: entered.registrationYear || '',
            paymentTerm: entered.paymentTerm || quotationRow.paymentTerm || '',
            poAmount: entered.poAmount || quotationRow.poAmount,
            poFileUrl: entered.poFileUrl || '',
            poFileName: entered.poFileName || '',
            poFileMimeType: entered.poFileMimeType || '',
            poFileSize: entered.poFileSize ?? null,
            poReceivedDate: entered.poReceivedDate || ''
          };
        })
      };
    });
  }

  async function confirmLeadClosure() {
    if (!closureDialog?.choice) return showToast('Please select Yes or No.', 'warning');
    if (!closureDialog?.leadOwnerName) return showToast('The primary lead owner could not be identified. Refresh the lead and try again.', 'warning');
    const behalfUser = [...staff, ...(currentUser ? [currentUser] : [])].find((user) => [user?._id, user?.id, user?.crmUserId, user?.userId].some((id) => String(id || '') === String(closureDialog.behalfUserId || '')));
    const behalfFields = { closedOnBehalfOfUser: behalfUser?._id || behalfUser?.id || closureDialog.behalfUserId, closedOnBehalfOfName: behalfUser?.name || behalfUser?.email || closureDialog.leadOwnerName, closedOnBehalfOfEmail: behalfUser?.email || closureDialog.leadOwnerEmail || '' };
    let closurePatch;
    if (closureDialog.choice === 'yes') {
      if (!closureDialog.quotationSent) return showToast('Please select whether a quotation was sent.', 'warning');
      if (closureDialog.quotationSent === 'yes' && !(closureDialog.quotation?._id || closureDialog.quotation?.id)) return showToast('No CRM quotation was found for this lead. Select No and upload the earlier quotation proof.', 'warning');
      if (closureDialog.quotationSent === 'no' && !closureDialog.earlierQuotationProofUrl) return showToast('Upload the earlier quotation proof before entering PO details.', 'warning');
      const commercialError = closureDialog.poYearRows.map(poCommercialError).find(Boolean);
      if (commercialError) return showToast(commercialError, 'warning');
      const incomplete = closureDialog.poYearRows.some((row) => !row.fy || !String(row.poNumber || '').trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.poDate || '')) || Number.isNaN(new Date(`${row.poDate}T00:00:00`).getTime()) || !(Number(row.poAmount) > 0) || !row.poFileUrl || !row.services.length);
      if (incomplete) return showToast('Complete FY Year, PO Number, PO Date, PO Amount, PO Upload, and Services for every PO row.', 'warning');
      closurePatch = { poStatus: 'received', poApprovalStatus: 'PENDING', quotationSent: closureDialog.quotationSent, earlierQuotationProofUrl: closureDialog.earlierQuotationProofUrl || '', earlierQuotationProofName: closureDialog.earlierQuotationProofName || '', poYearRows: closureDialog.poYearRows.map((row) => ({ ...row, quotationSent: closureDialog.quotationSent, quotationBasicAmount: closureDialog.quotationSent === 'no' ? 0 : row.quotationBasicAmount, earlierQuotationProofUrl: closureDialog.earlierQuotationProofUrl || '', earlierQuotationProofName: closureDialog.earlierQuotationProofName || '' })), closureRequestedBy: closureDialog.value, closureRequestedByText: currentUser?.name || currentUser?.email || '', closureApprovalProofUrl: '', closureApprovalProofName: '', provisionalCloseExpiresAt: '', kickoffEmailConsent: '' };
    } else {
      if (!closureDialog.approvalProofUrl) return showToast('Upload Super Admin approval proof before closing without PO.', 'warning');
      closurePatch = { poStatus: 'provisional', poYearRows: [], closureApprovalProofUrl: closureDialog.approvalProofUrl, closureApprovalProofName: closureDialog.approvalProofName, provisionalCloseExpiresAt: '', kickoffEmailConsent: '' };
    }
    closurePatch = { ...closurePatch, ...behalfFields };
    const nextAssignments = buildUpdatedAssignmentRows(closureDialog.index, 'closedBy', closureDialog.value, closurePatch);
    if (closureDialog.choice === 'yes') {
      nextAssignments[closureDialog.index].closedBy = '';
      nextAssignments[closureDialog.index].closedByText = '';
      nextAssignments[closureDialog.index].closedByEmail = '';
    }
    if (!editingLeadId) return showToast('Save the lead before recording closure details.', 'warning');
    const poDebugId = globalThis.crypto?.randomUUID?.() || `po-${Date.now()}`;
    setClosureSaving(true);
    try {
      // Closure is an assignment workflow, not a lead-profile edit. Sending the
      // complete legacy lead here caused valid PO submissions to be rejected by
      // newer Company/Contact/PIBO creation rules before the PO could be saved.
      const payload = {
        assignments: nextAssignments,
        workflowStatus: lead.workflowStatus || 'submitted',
        modifyPoDetails: closureDialog.poEditor === true
      };
      console.info('[POProof:closure:submit]', { poDebugId, leadId: editingLeadId, assignmentIndex: closureDialog.index, quotationSent: closureDialog.quotationSent, rows: closureDialog.poYearRows.map((row, rowIndex) => ({ rowIndex, poNumber: row.poNumber, poAmount: row.poAmount, hasPoFileUrl: Boolean(row.poFileUrl), poFileName: row.poFileName || '' })) });
      const response = await api.put(API_ENDPOINTS.leads.detail(editingLeadId), payload, { headers: { 'X-PO-Debug-ID': poDebugId } });
      const savedLead = response.data.lead || response.data.data?.lead || response.data.data;
      if (!savedLead || !Array.isArray(savedLead.assignments)) throw new Error('CRM did not return saved PO details.');
      const savedAssignment = savedLead.assignments[closureDialog.index] || {};
      console.info('[POProof:closure:saved]', { poDebugId, leadCode: savedLead.leadCode || '', assignmentIndex: closureDialog.index, rows: (savedAssignment.poYearRows || []).map((row, rowIndex) => ({ rowIndex, poNumber: row.poNumber, hasPoFileUrl: Boolean(row.poFileUrl), poFileName: row.poFileName || '' })) });
      // This endpoint intentionally submits assignment/PO workflow state only.
      // Keep the already-loaded service profile authoritative so a partial API
      // response cannot blank Business Category or Services Offered rows.
      setLead((current) => ({
        ...current,
        assignments: savedLead.assignments,
        workflowStatus: savedLead.workflowStatus || current.workflowStatus,
        updatedAt: savedLead.updatedAt || current.updatedAt
      }));
      if (closureDialog.poEditor) {
        const updated = { ...lead, assignments: savedLead.assignments, updatedAt: savedLead.updatedAt };
        setViewLead(updated);
        setLeads((current) => current.map((item) => String(item._id || item.id) === String(updated._id || updated.id) ? updated : item));
      }
      setClosureDialog(null);
      const directlyApproved = closureDialog.poEditor && savedLead.assignments?.[closureDialog.index]?.poApprovalStatus === 'APPROVED';
      showToast(closureDialog.choice === 'no' ? 'Special approval closure saved in the database.' : directlyApproved ? 'PO details updated and approved. No approval request sent.' : 'PO details saved and submitted for Admin approval.', 'success');
    } catch (saveError) {
      console.error('[POProof:closure:error]', {
        poDebugId,
        leadId: editingLeadId,
        assignmentIndex: closureDialog.index,
        status: saveError?.response?.status || 0,
        code: saveError?.response?.data?.code || '',
        error: saveError?.response?.data?.error || saveError?.message || 'Unable to save PO details.'
      });
      showToast(saveError?.response?.data?.error || saveError.message || 'Unable to save PO details.', 'error');
    } finally {
      setClosureSaving(false);
    }
  }

  function requestStaffAssignment(index, value) {
    if (!value) return updateAssignmentRow(index, 'assignedStaff', '', { kickoffEmailConsent: '' });
    setKickoffDialog({ index, value });
  }

  function confirmKickoffEmail(sendEmail) {
    if (!kickoffDialog) return;
    updateAssignmentRow(kickoffDialog.index, 'assignedStaff', kickoffDialog.value, { kickoffEmailConsent: sendEmail ? 'yes' : 'no' });
    setKickoffDialog(null);
    showToast(sendEmail
      ? 'Staff assigned. The kick-off email will be sent when the form is submitted.'
      : 'Staff assigned without a kick-off email.', 'success');
  }

  function addAssignmentRow() {
    setLead((current) => ({ ...current, assignments: [...assignmentRows, createAssignmentRow()] }));
  }

  function removeAssignmentRow(index) {
    if (assignmentRows.length === 1) return;
    const next = assignmentRows.filter((_, rowIndex) => rowIndex !== index);
    setLead((current) => ({ ...current, assignments: next, ...next[0] }));
  }

  async function claimRoyalty() {
    if (!canClaimRoyalty || royaltyClaiming || royaltyClaimed || !editingLeadId) return;
    const latestFinancialYear = [...serviceRows].reverse().find((row) => row.firstAnnualReturnYearApplicable)?.firstAnnualReturnYearApplicable || '';
    setRoyaltyClaiming(true);
    try {
      const leadPayload = buildLeadPayload('draft');
      const saveResponse = await api.put(API_ENDPOINTS.leads.detail(editingLeadId), leadPayload);
      const savedLead = saveResponse.data.lead || saveResponse.data.data?.lead || saveResponse.data.data;
      if (!savedLead || typeof savedLead !== 'object') throw new Error('The added service could not be saved before claiming royalty.');
      await api.post(API_ENDPOINTS.leads.claimRoyalty(editingLeadId), { financialYear: latestFinancialYear });
      setRoyaltyClaimed(true);
      showToast('Royalty claim sent to Admin and Super Admin by email and notification.', 'success');
    } catch (claimError) {
      showToast(claimError?.response?.data?.error || 'Unable to submit royalty claim.', 'error');
    } finally {
      setRoyaltyClaiming(false);
    }
  }

  function requestSpecification(field, value, label) {
    if (!value) {
      updateField(field, '');
      return;
    }
    setSpecifyNote('');
    setSpecifyDialog({ field, value, label });
  }

  async function submitSpecification() {
    if (!specifyDialog || !specifyNote.trim()) {
      showToast('Please add a note before submitting.', 'warning');
      return;
    }
    if (Number.isInteger(specifyDialog.categoryRow)) {
      try {
        const category = await addPiboCategory(specifyDialog.applicantType, specifyNote.trim());
        updateServiceRow(specifyDialog.categoryRow, 'piboCategory', category.name);
        setSpecifyDialog(null);
        setSpecifyNote('');
        showToast(`${category.name} added.`, 'success');
      } catch (requestError) {
        showToast(requestError?.response?.data?.error || 'Unable to add category.', 'error');
      }
      return;
    }
    setLead((current) => ({
      ...current,
      [specifyDialog.field]: specifyDialog.value,
      [`${specifyDialog.field}Note`]: specifyNote.trim()
    }));
    setSpecifyDialog(null);
    setSpecifyNote('');
    showToast(`${specifyDialog.label} details added.`, 'success');
  }

  async function uploadDuplicateApprovalScreenshot(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const uploaded = await uploadMedia(file, 'crm/leads/duplicate-approvals');
      setDuplicateApproval((current) => ({ ...current, screenshotUrl: uploaded.secureUrl, screenshotName: file.name }));
    } catch (err) {
      showToast(err?.message || 'Screenshot upload failed.', 'error');
    }
  }

  async function sendDuplicateApprovalRequest() {
    if (!selectedSearchLead || duplicateApprovalSaving) return;
    if (duplicateApproval.reason.trim().length < 10) return showToast('Please enter a reason of at least 10 characters.', 'error');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(duplicateApproval.requesterEmail.trim())) return showToast('Enter a valid email address.', 'error');
    setDuplicateApprovalSaving(true);
    try {
      await api.post(API_ENDPOINTS.leads.duplicateApprovals, {
        existingLeadId: leadRecordId(selectedSearchLead),
        leadAssignedTo: selectedSearchLead.assignedToText || selectedSearchLead.assignedTo?.name || selectedSearchLead.assignedStaffText || selectedSearchLead.importedCreatedBy || '',
        company: selectedSearchLead.company,
        reason: duplicateApproval.reason.trim(),
        requesterEmail: duplicateApproval.requesterEmail.trim(),
        screenshotUrl: duplicateApproval.screenshotUrl,
        candidateUsers: [
          { id: selectedSearchLead.createdByCrmUserId || selectedSearchLead.createdByEmail || selectedSearchLead.importedCreatedBy, name: selectedSearchLead.importedCreatedBy || selectedSearchLead.createdByEmail || 'Original lead creator' },
          ...((selectedSearchLead.assignments || []).flatMap((row) => [
            { id: row.assignedTo, name: row.assignedToText },
            { id: row.closedBy, name: row.closedByText },
            { id: row.assignedStaff, name: row.assignedStaffText }
          ]))
        ].filter((item, index, rows) => item.id && rows.findIndex((entry) => String(entry.id) === String(item.id)) === index)
      });
      setDuplicateDecisionOpen(false);
      showToast('Special approval request sent to Admin and Super Admin.', 'success');
    } catch (err) {
      showToast(err?.response?.data?.error || 'Unable to send special approval request.', 'error');
    } finally {
      setDuplicateApprovalSaving(false);
    }
  }

  useEffect(() => {
    loadPage();
  }, []);

  useEffect(() => {
    if (!ownershipRequired || generatedForOpen) return undefined;
    const timer = window.setTimeout(() => openGeneratedForChooser('new'), 300);
    return () => window.clearTimeout(timer);
  }, [lead.company, ownershipRequired, generatedForOpen]);

  useEffect(() => {
    let active = true;
    setLocationLoading((current) => ({ ...current, states: true }));
    fetchIndiaStates()
      .then((states) => {
        if (!active) return;
        setCountryStates(states);
        setLocationError('');
      })
      .catch((requestError) => {
        if (!active) return;
        setLocationError(requestError?.message || 'Live state list could not be loaded. Showing available local options.');
      })
      .finally(() => {
        if (active) setLocationLoading((current) => ({ ...current, states: false }));
      });
    return () => { active = false; };
  }, []);

  const addressStateKey = addressRows.map((row) => row.state).filter(Boolean).join('|');
  useEffect(() => {
    if (activeTab !== 'address') return;
    [...new Set(addressRows.map((row) => row.state).filter(Boolean))]
      .forEach((state) => loadCitiesForState(state));
  }, [activeTab, addressStateKey]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function getVisibleUserTokens(currentUser = null, staff = []) {
    if (!currentUser) return [];

    const normalized = new Set();
    const ownTokens = [
      currentUser?._id,
      currentUser?.id,
      currentUser?.crmUserId,
      currentUser?.userId,
      currentUser?.name,
      currentUser?.email
    ]
      .map((value) => normalizePersonName(value))
      .filter(Boolean);

    ownTokens.forEach((token) => normalized.add(token));

    const isManagerLevel = ['manager', 'operation head', 'operations head', 'team manager'].includes(String(currentUser?.role || '').trim().toLowerCase());
    if (isManagerLevel) {
      const directReports = (Array.isArray(staff) ? staff : []).filter((user) => {
        const sameTeam = currentUser?.teamId && user?.teamId && String(user.teamId) === String(currentUser.teamId);
        const reportsToManager = String(user?.managerId || '') === String(currentUser?._id || '');
        const reportsToOperationHead = String(user?.operationHeadId || '') === String(currentUser?._id || '');
        return sameTeam || reportsToManager || reportsToOperationHead || String(user?._id || user?.id || '') === String(currentUser?._id || currentUser?.id || '');
      });

      directReports.forEach((user) => {
        [
          user?._id,
          user?.id,
          user?.crmUserId,
          user?.userId,
          user?.name,
          user?.email
        ].forEach((value) => {
          const token = normalizePersonName(value);
          if (token) normalized.add(token);
        });
      });
    }

    return [...normalized];
  }

  function leadBelongsToCurrentUser(item, currentUser = null, staff = []) {
    if (!currentUser || adminRoles.includes(String(currentUser?.role || '').toLowerCase())) return true;

    const userTokens = getVisibleUserTokens(currentUser, staff);

    const candidates = [
      item?.assignedTo,
      item?.assignedToText,
      item?.assignedToEmail,
      item?.assignedStaff,
      item?.assignedStaffText,
      item?.assignedStaffEmail,
      item?.assignedBy,
      item?.importedCreatedBy,
      item?.createdBy,
      item?.createdBy?.name,
      item?.createdBy?.email,
      item?.createdBy?._id,
      item?.createdBy?.id,
      item?.assignedTo?.name,
      item?.assignedTo?.email,
      item?.assignedTo?._id,
      item?.assignedTo?.id,
      item?.sourceLeadId,
      item?.leadCode,
      item?.leadNumber,
      item?.company,
      item?.importedCreatedAt
    ]
      .flatMap((value) => {
        if (!value) return [];
        if (typeof value === 'object') {
          return [value._id, value.id, value.crmUserId, value.userId, value.name, value.email].map((nestedValue) => normalizePersonName(nestedValue)).filter(Boolean);
        }
        return [normalizePersonName(value)].filter(Boolean);
      });

    (Array.isArray(item?.assignments) ? item.assignments : []).forEach((assignment) => {
      [
        assignment?.assignedTo,
        assignment?.assignedToText,
        assignment?.assignedToEmail,
        assignment?.assignedStaff,
        assignment?.assignedStaffText,
        assignment?.assignedStaffEmail,
        assignment?.closedBy,
        assignment?.closedByText,
        assignment?.closedByEmail
      ].forEach((value) => {
        if (!value) return;
        if (typeof value === 'object') {
          [value._id, value.id, value.crmUserId, value.userId, value.name, value.email]
            .map((nestedValue) => normalizePersonName(nestedValue))
            .filter(Boolean)
            .forEach((token) => candidates.push(token));
          return;
        }
        const token = normalizePersonName(value);
        if (token) candidates.push(token);
      });
    });

    (Array.isArray(item?.serviceSelections) ? item.serviceSelections : []).forEach((service) => {
      [
        service?.createdByCrmUserId,
        service?.createdByName,
        service?.createdByEmail
      ].forEach((value) => {
        const token = normalizePersonName(value);
        if (token) candidates.push(token);
      });
    });

    return candidates.some((candidate) => userTokens.includes(candidate));
  }

  async function loadPage() {
    setLoading(true);
    setError('');
    try {
      const meResponse = await api.get(API_ENDPOINTS.auth.me);
      const me = meResponse.data.user;
      setCurrentUser(me);

      let staffList = [];
      try {
        const usersResponse = await api.get(API_ENDPOINTS.leads.assignmentUsers);
        staffList = usersResponse.data.users || [];
        setStaff(staffList);
      } catch {
        staffList = [meResponse.data.user];
        setStaff(staffList);
      }

      void Promise.allSettled([
        api.get(API_ENDPOINTS.quotations.list),
        api.get(API_ENDPOINTS.quotations.piboCategories),
        api.get(API_ENDPOINTS.leads.duplicateApprovals),
        api.get(API_ENDPOINTS.leads.serviceCatalog),
        api.get(API_ENDPOINTS.leads.dropdownOptions)
      ]).then(([quotationsResult, piboCategoriesResult, duplicateApprovalsResult, serviceCatalogResult, dropdownOptionsResult]) => {
        setQuotations(quotationsResult.status === 'fulfilled' ? (quotationsResult.value.data.quotations || []) : []);
        setPiboCategories(piboCategoriesResult.status === 'fulfilled' ? (piboCategoriesResult.value.data.categories || []) : []);
        setDuplicateLeadApprovals(duplicateApprovalsResult.status === 'fulfilled' ? (duplicateApprovalsResult.value.data.approvals || []) : []);
        setServiceCatalog(serviceCatalogResult.status === 'fulfilled' ? (serviceCatalogResult.value.data.catalog || []) : []);
        setCustomDropdownOptions(dropdownOptionsResult.status === 'fulfilled' ? (dropdownOptionsResult.value.data.options || {}) : {});
        setPiboCategoriesLoading(false);
      }).catch(() => setPiboCategoriesLoading(false));

      const initialWorkspace = new URLSearchParams(location.search).get('tab') === 'notified' ? 'notified' : 'leads';
      const crmLeadsResponse = await api.get(API_ENDPOINTS.leads.list, { params: { paginated: true, page: 1, limit: 10, workspace: initialWorkspace } });
      const crmLeads = crmLeadsResponse.data.leads || [];
      setAllCcpLeads(crmLeads);
      setLeads(crmLeads);
      setLeadPagination(crmLeadsResponse.data.pagination || { page: 1, limit: 10, total: crmLeads.length, totalPages: 1 });
      setLeadSummary(crmLeadsResponse.data.summary || { total: crmLeads.length, existing: 0, converted: 0, new: crmLeads.length });
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to fetch lead data.');
      setLeads([]);
      setAllCcpLeads([]);
      setQuotations([]);
    } finally {
      setLoading(false);
      setPiboCategoriesLoading(false);
    }
  }

  const loadLeadDirectory = useCallback(async (params = {}) => {
    const requestId = ++leadListRequestRef.current;
    const requestStartedAt = window.performance.now();
    const isNotifiedRequest = String(params.workspace || '').toLowerCase() === 'notified';
    if (isNotifiedRequest) console.info('[Lead Notifications] fetch started', { page: params.page || 1, limit: params.limit || 10, search: params.search || '', status: params.status || '', staff: params.staff || '' });
    setLoading(true);
    setError('');
    try {
      const response = await api.get(API_ENDPOINTS.leads.list, {
        params: { paginated: true, ...params }
      });
      if (requestId !== leadListRequestRef.current) return;
      const rows = response.data?.leads || [];
      if (isNotifiedRequest) {
        const pendingRows = pendingManagerAssignmentRows(rows, currentUser);
        console.info('[Lead Notifications] fetch complete', {
          durationMs: Math.round(window.performance.now() - requestStartedAt),
          rowsReceived: rows.length,
          pendingRowsOnPage: pendingRows.length,
          totalPendingLeads: Number(response.data?.pagination?.total || 0),
          page: Number(response.data?.pagination?.page || 1),
          totalPages: Number(response.data?.pagination?.totalPages || 1),
          serverTiming: response.headers?.['server-timing'] || 'not provided'
        });
        if (!rows.length) console.warn('[Lead Notifications] No manager-assigned, staff-pending leads matched the current user visibility scope and filters.');
      }
      setLeads(rows);
      setAllCcpLeads(rows);
      setLeadPagination(response.data?.pagination || { page: 1, limit: 10, total: rows.length, totalPages: 1 });
      setLeadSummary(response.data?.summary || { total: rows.length, existing: 0, converted: 0, new: rows.length });
    } catch (err) {
      if (requestId !== leadListRequestRef.current || err?.code === 'ERR_CANCELED') return;
      if (isNotifiedRequest) console.error('[Lead Notifications] fetch failed', { durationMs: Math.round(window.performance.now() - requestStartedAt), message: err?.message, status: err?.response?.status, apiError: err?.response?.data?.error });
      if (isNotifiedRequest) {
        setLeads([]);
        setAllCcpLeads([]);
        setLeadPagination({ page: 1, limit: Number(params.limit || 10), total: 0, totalPages: 1 });
      }
      setError(err?.response?.data?.error || 'Unable to fetch leads from CRM. Please retry.');
    } finally {
      if (requestId === leadListRequestRef.current) setLoading(false);
    }
  }, []);

  const loadAllLeadsForExport = useCallback(async (params = {}) => {
    const first = await api.get(API_ENDPOINTS.leads.list, { params: { paginated: true, export: true, ...params, page: 1, limit: 100 } });
    const pages = Number(first.data?.pagination?.totalPages || 1);
    const remaining = pages > 1
      ? await Promise.all(Array.from({ length: pages - 1 }, (_, index) => api.get(API_ENDPOINTS.leads.list, { params: { paginated: true, export: true, ...params, page: index + 2, limit: 100 } })))
      : [];
    return [first, ...remaining].flatMap((response) => response.data?.leads || []);
  }, []);

  async function fetchLeadDetail(item) {
    const id = leadRecordId(item);
    if (!id) return item;
    const response = await api.get(API_ENDPOINTS.leads.detail(id));
    return response.data?.lead || item;
  }

  function applyLeadEdit(item) {
    const normalizedServices = normalizeLegacyServiceSelections(item).map((row, index) => ({ ...row, firstAnnualReturnYearApplicable: row.firstAnnualReturnYearApplicable || (index === 0 ? item.firstAnnualReturnYearApplicable : '') }));
    const ownerId = item.generatedForUser?._id || item.generatedForUser?.id || item.generatedForUser || item.createdOnBehalfOfUser?._id || item.createdOnBehalfOfUser || item.createdBy?._id || item.createdBy?.id || item.createdBy || currentUser?._id || currentUser?.id || '';
    const currentUserId = currentUser?._id || currentUser?.id || currentUser?.crmUserId || currentUser?.userId || '';
    setLead({ ...emptyLead, ...item, serviceSelections: normalizedServices, applicableService: normalizedServices[0]?.applicableService || item.applicableService || '', addresses: item.addresses?.length ? item.addresses : [createAddressRow(item)], contacts: item.contacts?.length ? item.contacts : [createContactRow(item)], assignments: item.assignments?.length ? item.assignments : [createAssignmentRow(item)] });
    setGeneratedForUserId(String(ownerId));
    setGeneratedForMode(String(ownerId) === String(currentUserId) ? 'self' : 'other');
    setGeneratedForConfirmed(true);
    setEditingLeadId(leadRecordId(item));
    setServiceOnlyMode(false);
    setActiveTab('basic');
    setViewMode('form');
  }

  async function addPiboCategory(parent, name) {
    const response = await api.post(API_ENDPOINTS.quotations.piboCategories, { parent, name });
    const category = response.data.category;
    setPiboCategories((current) => [...current, category]);
    return category;
  }

  function updateField(field, value) {
    setLead((current) => ({
      ...current,
      [field]: value,
      ...(field === 'state' ? { city: '' } : {})
    }));
  }

  function showToast(message, type = 'info') {
    setToast({ message, type });
  }

  function openTab(tabId) {
    if (tabId !== 'basic' && duplicateCompanyLead) {
      const message = 'Existing company detected. Choose Add Services or request Special Approval.';
      setError(message);
      showToast(message, 'error');
      return;
    }
    if (tabId !== 'basic' && !isFirstStepReady) {
      showToast('Complete Company, Status, and every required Service & Applicant field.', 'warning');
      return;
    }
    setActiveTab(tabId);
    showToast(`${tabs.find((tab) => tab.id === tabId)?.label || 'Step'} step opened.`, 'success');
  }

  function nextTab() {
    if (duplicateCompanyLead) {
      const message = 'Existing company detected. Choose Add Services or request Special Approval.';
      setError(message);
      showToast(message, 'error');
      return;
    }
    if (!isFirstStepReady) {
      setError('Complete Company, Status, Industry Type, Business Category, Applicant Type, Services Offered, and Financial Year before moving ahead.');
      showToast('Complete required first-step fields before next step.', 'warning');
      return;
    }
    setError('');
    const next = tabs[Math.min(activeIndex + 1, tabs.length - 1)];
    setActiveTab(next.id);
    showToast(`${next.label} step unlocked.`, 'success');
  }

  async function handleBusinessCard(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const uploaded = await uploadMedia(file, 'crm/leads/business-cards');
    updateField('businessCardUrl', uploaded.secureUrl);
  }

  function resolveUserId(value) {
    const raw = normalizePersonName(value);
    if (!raw) return '';
    const match = staff.find((user) => normalizePersonName(user.name) === raw);
    return match ? (match._id || match.id) : '';
  }

  function downloadLeadImportTemplate() {
    const headers = [
      'Communication Mode', 'Lead ID', 'Status', 'Company', 'Industry', 'Service Category', 'Business Category', 'Applicant Type', 'Sub Applicant Type',
      'Services Offered', 'Applicable Services', 'Financial Year', 'Address', 'Address Line 2', 'Address Line 3', 'Landmark',
      'State', 'City', 'PIN', 'Existing Client', 'Website', 'Salutation', 'Contact Person', 'Designation', 'Email',
      'Emails Sent Count', 'Last Email Sent', 'Mobile 1', 'Mobile 2', 'WhatsApp No', 'LinkedIn URL', 'Business Card URL', 'Referred By', 'Source', 'Notes',
      'Assigned To', 'Assigned By', 'Created By', 'Lead Date', 'Next Follow-Up Date', 'Next Follow-Up Time',
      'Follow-Up Remarks', 'Form Started At', 'Assign Reached At', 'Submitted At', 'Lead Fill Duration', 'Created At', 'Updated At'
    ];
    const templateRows = allCcpLeads.flatMap((item) => {
      const services = normalizeLegacyServiceSelections(item);
      const assignments = Array.isArray(item.assignments) ? item.assignments : [];
      return services.map((service, index) => {
        const assignment = assignments[index] || createAssignmentRow(item);
        return {
          'Communication Mode': item.communicationMode || '', 'Lead ID': displayLeadId(item).replace(/^-$/, ''), Status: item.status || '', Company: item.company || '',
          Industry: service.industryType || '', 'Service Category': service.eprCategory || '', 'Business Category': service.businessCategory || '', 'Applicant Type': service.applicantType || '',
          'Sub Applicant Type': service.piboCategory || '', 'Services Offered': service.servicesOffered || '', 'Applicable Services': service.applicableService || '',
          'Financial Year': service.firstAnnualReturnYearApplicable || '', Address: item.addressLine1 || item.addresses?.[0]?.addressLine1 || '',
          'Address Line 2': item.addressLine2 || item.addresses?.[0]?.addressLine2 || '', 'Address Line 3': item.addressLine3 || item.addresses?.[0]?.addressLine3 || '',
          Landmark: item.landmark || item.addresses?.[0]?.landmark || '', State: item.state || item.addresses?.[0]?.state || '', City: item.city || item.addresses?.[0]?.city || '',
          PIN: item.pinCode || item.addresses?.[0]?.pinCode || '', 'Existing Client': item.existingClient || item.addresses?.[0]?.existingClient || 'No', Website: item.website || item.addresses?.[0]?.website || '',
          Salutation: item.salutation || item.contacts?.[0]?.salutation || '', 'Contact Person': item.contactPerson || item.contacts?.[0]?.contactPerson || '',
          Designation: item.designation || item.contacts?.[0]?.designation || '', Email: item.emails || item.contacts?.[0]?.emails || '',
          'Emails Sent Count': item.emailsSentCount || 0, 'Last Email Sent': item.lastEmailSent || '',
          'Mobile 1': item.mobileNo1 || item.contacts?.[0]?.mobileNo1 || '', 'Mobile 2': item.mobileNo2 || item.contacts?.[0]?.mobileNo2 || '',
          'WhatsApp No': item.whatsappNo || item.contacts?.[0]?.whatsappNo || '', 'LinkedIn URL': item.linkedinUrl || item.contacts?.[0]?.linkedinUrl || '',
          'Business Card URL': item.businessCardUrl || item.contacts?.[0]?.businessCardUrl || '', 'Referred By': item.referredBy || item.contacts?.[0]?.referredBy || '',
          Source: item.source || item.contacts?.[0]?.source || '', Notes: item.notes || '', 'Assigned To': assignment.assignedToText || assignment.assignedTo?.name || item.assignedToText || item.assignedTo?.name || '',
          'Assigned By': assignment.assignedBy || item.assignedBy || '', 'Created By': service.createdByName || item.importedCreatedBy || item.createdBy?.name || '',
          'Lead Date': item.leadDate || '', 'Next Follow-Up Date': item.nextFollowUpDate || '', 'Next Follow-Up Time': item.nextFollowUpTime || '',
          'Follow-Up Remarks': item.followUpRemarks || '', 'Form Started At': item.formStartedAt || '', 'Assign Reached At': item.assignReachedAt || '',
          'Submitted At': item.submittedAt || '', 'Lead Fill Duration': formatDuration(item.fillDurationSeconds),
          'Created At': item.createdAt || item.importedCreatedAt || '', 'Updated At': item.updatedAt || item.importedUpdatedAt || ''
        };
      });
    });
    const leadsSheet = templateRows.length ? XLSX.utils.json_to_sheet(templateRows, { header: headers }) : XLSX.utils.aoa_to_sheet([headers]);
    leadsSheet['!cols'] = headers.map((header) => ({ wch: Math.max(14, Math.min(34, header.length + 4)) }));
    const required = new Set(['Company']);
    const helpRows = headers.map((field) => ({
      Field: field,
      Required: required.has(field) ? 'Yes' : 'No (draft import)',
      Guidance: field === 'Company' ? 'Required. Repeated company names append service rows to one lead.'
        : field === 'PIN' ? 'Use exactly 6 digits. Format the Excel cell as Text to preserve leading zeroes.'
            : field === 'Assigned To' ? 'Enter an existing CRM staff name; exact names are matched automatically.'
            : field === 'Created By' ? 'Bulk upload only: enter the exact active CRM user name, email, or CRM User ID. This user becomes the lead creator and receives pending-lead reminders.'
            : ['Industry', 'Service Category', 'Applicant Type', 'Sub Applicant Type', 'Services Offered', 'Applicable Services', 'Financial Year'].includes(field) ? 'This value belongs to the service row.'
              : 'Optional for draft import; existing CRM business rules remain applicable.'
    }));
    const helpSheet = XLSX.utils.json_to_sheet(helpRows);
    helpSheet['!cols'] = [{ wch: 28 }, { wch: 20 }, { wch: 75 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, leadsSheet, 'Lead Import');
    XLSX.utils.book_append_sheet(workbook, helpSheet, 'Help');
    XLSX.writeFile(workbook, `crm-lead-import-template-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function handleExcelUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError('');
    setNotice('');
    setExcelFileName(file.name);
    setExcelRows([]);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames?.[0];
      if (!sheetName) {
        showToast('No sheet found in this file.', 'error');
        return;
      }
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const parsed = rows
        .map((row) => mapExcelRowToLead(row, staff))
        .filter((row) => Object.values(row).some((value) => String(value || '').trim() !== ''));

      if (!parsed.length) {
        showToast('Excel has no usable rows.', 'warning');
        return;
      }

      setExcelRows(parsed);
      showToast(`Loaded ${parsed.length} Excel row${parsed.length === 1 ? '' : 's'}. Ready to import as drafts.`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Unable to read Excel file. Please upload a valid .xlsx file.', 'error');
    }
  }

  async function importExcelRows() {
    if (!excelRows.length) return;
    setImporting(true);
    setError('');
    setNotice('');
    try {
      const payload = excelRows.map((row) => {
        const assignedToText = row.assignedToText || row.assignedTo || '';
        return {
          ...row,
          assignedToText: String(assignedToText || '').trim(),
          assignedBy: String(row.assignedBy || '').trim(),
          importedCreatedBy: String(row.importedCreatedBy || '').trim(),
          existingClient: normalizeExistingClient(row.existingClient),
          assignedTo: resolveUserId(row.assignedTo || assignedToText) || '',
          workflowStatus: 'draft'
        };
      });
      const response = await api.post(API_ENDPOINTS.leads.bulk, { leads: payload });
      const successCount = Number(response.data?.imported || response.data?.leads?.length || 0);
      const failures = Array.isArray(response.data?.failures) ? response.data.failures : [];

      if (successCount) {
        setNotice(`${successCount} lead${successCount === 1 ? '' : 's'} imported as drafts.`);
        showToast(`${successCount} lead${successCount === 1 ? '' : 's'} imported.`, 'success');
        await loadPage();
      }
      if (failures.length) {
        const message = `${failures.length} row${failures.length === 1 ? '' : 's'} failed. First: row ${failures[0].row} (${failures[0].error})`;
        setError(message);
        showToast(message, 'error');
      }
    } catch (err) {
      const failures = err?.response?.data?.failures || [];
      const message = failures.length
        ? `${failures.length} row${failures.length === 1 ? '' : 's'} failed. First: row ${failures[0].row} (${failures[0].error})`
        : err?.response?.data?.error || 'Unable to import leads';
      setError(message);
      showToast(message, 'error');
    } finally {
      setImporting(false);
    }
  }

  function validateLeadForSubmit(workflowStatus) {
    const required = workflowStatus === 'submitted' ? ['status', 'company', 'servicesOffered', 'addressLine1', 'state', 'city', 'pinCode'] : [];
    const missing = required.find((field) => !String(lead[field] ?? '').trim());
    if (missing) return `${missing.replace(/([A-Z])/g, ' $1')} is required before submit.`;
    if (workflowStatus === 'submitted') {
      const incompleteRow = serviceRows.findIndex((row) => !row.industryType || !row.businessCategory || !row.eprCategory || !row.applicantType || !row.servicesOffered || !row.plantUnit || !row.firstAnnualReturnYearApplicable || (!directApplicantOptions(row.eprCategory) && !row.piboCategory));
      if (incompleteRow >= 0) return `Complete Industry Type, Business Category, Service Category, Applicant Type, ${directApplicantOptions(serviceRows[incompleteRow].eprCategory) ? '' : 'Sub Applicant Type, '}Services Offered, Plant Unit, and Financial Year in service row ${incompleteRow + 1}.`;
      const missingAddressUnit = unitServices.find((service) => !addressRows.some((row) => row.plantUnit === service.plantUnit));
      const missingContactUnit = unitServices.find((service) => !contactRows.some((row) => row.plantUnit === service.plantUnit));
      if (missingAddressUnit || missingContactUnit || assignmentRows.length !== serviceRows.length) return 'Every selected Plant Unit must have at least one matching Address and Contact row, and every service must have one Assignment row.';
      const seenServices = new Map();
      for (let index = 0; index < serviceRows.length; index += 1) {
        const identity = serviceSelectionIdentity(serviceRows[index]);
        if (seenServices.has(identity)) return `Service row ${index + 1} duplicates row ${seenServices.get(identity) + 1}. Change at least one service field.`;
        seenServices.set(identity, index);
      }
      const incompleteAddress = addressRows.findIndex((row) => !row.addressLine1 || !row.state || !row.city || !row.pinCode);
      if (incompleteAddress >= 0) return `Complete Address Line 1, State, City, and PIN in address row ${incompleteAddress + 1}.`;
      const invalidPin = addressRows.findIndex((row) => !/^\d{6}$/.test(String(row.pinCode || '')));
      if (invalidPin >= 0) return `Enter a valid 6-digit PIN code in address row ${invalidPin + 1}.`;
      const incompleteContact = contactRows.findIndex((row) => !row.salutation || !row.contactPerson || !row.designation || !row.emails || !row.mobileNo1 || !row.referredBy || !row.source);
      if (incompleteContact >= 0) return `Complete all required fields in contact row ${incompleteContact + 1}. Mobile No. 2 is optional.`;
      const invalidContactEmail = contactRows.findIndex((row) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(row.emails || '').trim()));
      if (invalidContactEmail >= 0) return `Enter a valid email address in contact row ${invalidContactEmail + 1}.`;
      const invalidContactMobile = contactRows.findIndex((row) => !/^\d{10}$/.test(String(row.mobileNo1 || '').replace(/\D/g, '')));
      if (invalidContactMobile >= 0) return `Mobile No. 1 must contain exactly 10 digits in contact row ${invalidContactMobile + 1}.`;
      const invalidWhatsApp = contactRows.findIndex((row) => row.whatsappNo && !/^\d{10}$/.test(String(row.whatsappNo).replace(/\D/g, '')));
      if (invalidWhatsApp >= 0) return `WhatsApp No. must contain exactly 10 digits in contact row ${invalidWhatsApp + 1}.`;
      const invalidLinkedIn = contactRows.findIndex((row) => row.linkedinUrl && !/^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\//i.test(String(row.linkedinUrl).trim()));
      if (invalidLinkedIn >= 0) return `Enter a valid LinkedIn URL in contact row ${invalidLinkedIn + 1}.`;
    }
    const invalidEmail = String(lead.emails || '').split(',').map((email) => email.trim()).filter(Boolean).find((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    if (invalidEmail) return `Invalid email: ${invalidEmail}`;
    if (duplicateCompanyLead) return 'Existing company detected. Choose Add Services or request Special Approval.';
    return '';
  }

  function requestLeadSubmit() {
    const validationError = validateLeadForSubmit('submitted');
    if (validationError) {
      setError(validationError);
      showToast(validationError, 'error');
      return;
    }
    setError('');
    setIntroductionPromptOpen(true);
  }

  function buildLeadPayload(workflowStatus, overrides = {}) {
    const payloadLead = { ...lead, ...overrides };
    const {
      assignedStaff: _legacyAssignedStaff,
      assignedStaffText: _legacyAssignedStaffText,
      assignedStaffEmail: _legacyAssignedStaffEmail,
      ...leadWithoutLegacyStaff
    } = payloadLead;
    const primaryService = serviceRows[0] || {};
    const primaryUsesDirectApplicant = Boolean(directApplicantOptions(primaryService.eprCategory));
    const generatedForOwner = [...staff, ...(currentUser ? [currentUser] : [])].find((user) => [user?._id, user?.id, user?.crmUserId, user?.userId]
      .filter(Boolean).some((value) => String(value) === String(generatedForUserId || currentUser?._id || currentUser?.id || '')));
    const generatedForOwnerId = generatedForOwner?._id || generatedForOwner?.id || generatedForOwner?.crmUserId || generatedForOwner?.userId || generatedForUserId || currentUser?._id || currentUser?.id || '';
    const generatedForOwnerName = generatedForOwner?.name || generatedForOwner?.email || currentUser?.name || currentUser?.email || '';
    const generatedForOwnerEmail = generatedForOwner?.email || currentUser?.email || '';
    const actualCreatorId = currentUser?._id || currentUser?.id || currentUser?.crmUserId || currentUser?.userId || '';
    const actualCreatorName = currentUser?.name || currentUser?.email || '';
    const actualCreatorEmail = currentUser?.email || '';
    const submittedAt = workflowStatus === 'submitted' ? new Date().toISOString() : payloadLead.submittedAt;
    const formStartedAt = payloadLead.formStartedAt || formStartedAtRef.current || new Date().toISOString();
    return {
      ...leadWithoutLegacyStaff,
      generatedForUser: generatedForOwnerId,
      generatedForName: generatedForOwnerName,
      generatedForEmail: generatedForOwnerEmail,
      creationMode: String(generatedForOwnerId) === String(actualCreatorId) ? 'self' : 'other',
      createdOnBehalfOfUser: generatedForOwnerId,
      createdOnBehalfOfName: generatedForOwnerName,
      createdOnBehalfOfEmail: generatedForOwnerEmail,
      serviceSelections: serviceRows.map((row, index) => ({
        ...row,
        createdByCrmUserId: index < frozenServiceRowCount ? (row.createdByCrmUserId || '') : String(actualCreatorId),
        createdByName: index < frozenServiceRowCount ? (row.createdByName || '') : actualCreatorName,
        createdByEmail: index < frozenServiceRowCount ? (row.createdByEmail || '') : actualCreatorEmail
      })),
      addresses: addressRows,
      contacts: contactRows,
      assignments: overrides.assignments || assignmentRows,
      addServicesMode: serviceOnlyMode,
      industryType: primaryService.industryType || lead.industryType || '',
      eprCategory: primaryService.eprCategory || lead.eprCategory || '',
      applicantType: primaryService.applicantType || lead.applicantType || '',
      piboCategory: primaryUsesDirectApplicant ? '' : (primaryService.piboCategory || lead.piboCategory || ''),
      subApplicantType: primaryUsesDirectApplicant ? '' : (primaryService.piboCategory || lead.subApplicantType || lead.piboCategory || ''),
      piboParent: primaryUsesDirectApplicant ? '' : (primaryService.piboParent || lead.piboParent || lead.piboCategoryParent || inferPiboParent(primaryService.piboCategory || lead.piboCategory)),
      servicesOffered: primaryService.servicesOffered || lead.servicesOffered || '',
      applicableService: primaryService.applicableService || lead.applicableService || '',
      firstAnnualReturnYearApplicable: primaryService.firstAnnualReturnYearApplicable || lead.firstAnnualReturnYearApplicable || '',
      workflowStatus,
      formStartedAt,
      assignReachedAt: payloadLead.assignReachedAt || '',
      submittedAt,
      fillDurationSeconds: workflowStatus === 'submitted' ? Math.max(0, Math.round((new Date(submittedAt).getTime() - new Date(formStartedAt).getTime()) / 1000)) : payloadLead.fillDurationSeconds
    };
  }

  async function saveLead(workflowStatus, { openHealthReport = false } = {}) {
    if (saving) return;
    const validationError = validateLeadForSubmit(workflowStatus);
    if (validationError) { setError(validationError); showToast(validationError, 'error'); return null; }
    const invalidAssignmentIndex = assignmentRows.findIndex((row) => row.assignedTo && !row.closedBy);
    if (invalidAssignmentIndex >= 0) {
      const message = `Assignment row ${invalidAssignmentIndex + 1}: close the lead before assigning it to a manager.`;
      setError(message);
      showToast(message, 'error');
      return null;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const introductionRequested = workflowStatus === 'submitted' && introductionConsent;
      const leadPayload = { ...buildLeadPayload(workflowStatus), ...(workflowStatus === 'submitted' ? { sendIntroductionEmail: introductionRequested } : {}) };
      const response = editingLeadId ? await api.put(API_ENDPOINTS.leads.detail(editingLeadId), leadPayload) : await api.post(API_ENDPOINTS.leads.create, leadPayload);
      const savedLead = response.data.lead || response.data.data?.lead || response.data.data;
      if (!savedLead || typeof savedLead !== 'object') throw new Error('CRM did not return the saved lead.');
      const introductionResult = response.data?.introductionEmail || null;
      const introductionSent = Boolean(introductionRequested && introductionResult?.sent);
      const introductionFailed = Boolean(introductionRequested && !introductionSent);
      const introductionMessage = introductionSent
        ? ` Introduction email sent to ${Number(introductionResult?.recipients?.length || 0)} client recipient(s).`
        : introductionFailed
          ? ` Lead was saved, but the introduction email was not sent${introductionResult?.reason === 'no-lead-email-recipients' ? ' because no valid client email address was found.' : '. Please retry the submission.'}`
          : '';
      setHealthPromptOpen(false);
      setIntroductionConsent(false);
      if (openHealthReport) {
        setHealthReportLead(savedLead);
        setHealthReport(reportToDraft(savedLead.complianceHealthReport));
        setHealthReportError('');
        setHealthAssignmentOpen(false);
        setNotice(`Lead submitted.${introductionMessage} Complete the Compliance Health Report details before selecting a Manager.`);
        showToast(introductionFailed ? introductionMessage.trim() : `Lead submitted.${introductionMessage} Please complete the Compliance Health Report.`, introductionFailed ? 'error' : 'success');
        return savedLead;
      }
      const successMessage = workflowStatus === 'submitted' ? `Lead submitted successfully.${introductionMessage}` : 'Lead draft saved successfully.';
      setNotice(successMessage);
      showToast(introductionFailed ? introductionMessage.trim() : successMessage, introductionFailed ? 'error' : 'success');
      if (workflowStatus === 'submitted') { setLead(emptyLead); formStartedAtRef.current = ''; }
      setEditingLeadId('');
      setActiveTab('basic');
      await loadPage();
      if (workflowStatus === 'submitted') setViewMode('list');
      return savedLead;
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to save lead');
      showToast(err?.response?.data?.error || 'Unable to save lead', 'error');
      return null;
    } finally {
      setSaving(false);
    }
  }

  function updateHealthReport(field, value) {
    setHealthReport((current) => ({ ...current, [field]: value }));
  }

  async function assignHealthReportManager() {
    const leadId = healthReportLead?._id || healthReportLead?.id;
    if (!leadId || !healthManagerId || healthReportSaving) return;
    setHealthReportSaving(true); setHealthReportError('');
    try {
      await api.post(API_ENDPOINTS.healthReports.create, { leadId, managerId: healthManagerId });
      setHealthAssignmentOpen(false); setHealthManagerId(''); setHealthReportLead(null); setHealthReport(emptyComplianceHealthReport);
      setLead(emptyLead); setEditingLeadId(''); setActiveTab('basic'); setViewMode('list');
      setNotice('Compliance Health Report sent to the selected Manager for user assignment.');
      await loadPage();
    } catch (err) { setHealthReportError(err?.response?.data?.error || 'Unable to assign the Health Report Manager.'); }
    finally { setHealthReportSaving(false); }
  }

  function buildHealthReportPayload(reviewConfirmed = false, allocation = false) {
    const toList = (value) => String(value || '').split('\n').map((item) => item.trim()).filter(Boolean);
    const sharedUploads = Array.isArray(healthReport.sharedFolderUploads)
      ? healthReport.sharedFolderUploads.map((item) => ({
          label: String(item?.label || item?.name || '').trim(),
          url: String(item?.url || item?.secureUrl || item?.file?.secureUrl || item?.file?.url || '').trim(),
          source: String(item?.source || 'shared-folder').trim(),
          uploadedAt: String(item?.uploadedAt || new Date().toISOString()).trim()
        })).filter((item) => item.label && item.url)
      : [];
    return {
      yearOfCommencement: String(healthReport.yearOfCommencement || '').trim(),
      establishmentDate: String(healthReport.establishmentDate || '').trim(),
      organizationType: String(healthReport.organizationType || '').trim(),
      keyProductsBrands: String(healthReport.keyProductsBrands || '').trim(),
      productCategory: String(healthReport.productCategory || '').trim(),
      eprRegistrationNumber: String(healthReport.eprRegistrationNumber || '').trim(),
      financialYearReviewed: String(healthReport.financialYearReviewed || '').trim(),
      objectiveReview: String(healthReport.objectiveReview || '').trim(),
      keyObservations: toList(healthReport.keyObservations),
      annualReturnObservations: toList(healthReport.annualReturnObservations),
      checklistReview: toList(healthReport.checklistReview),
      conclusion: String(healthReport.conclusion || '').trim(),
      recommendations: String(healthReport.recommendations || '').trim(),
      finalNotes: toList(healthReport.finalNotes),
      screenshotReferences: toList(healthReport.screenshotReferences),
      otpMobile: String(healthReport.otpMobile || '').trim(),
      cpcbLoginId: String(healthReport.cpcbLoginId || '').trim(),
      cpcbPassword: String(healthReport.cpcbPassword || ''),
      ssoCpcbLoginId: String(healthReport.ssoCpcbLoginId || '').trim(),
      ssoCpcbPassword: String(healthReport.ssoCpcbPassword || ''),
      sharedFolderUploads: sharedUploads,
      keyObservationDetails: Array.isArray(healthReport.keyObservationDetails)
        ? healthReport.keyObservationDetails.map((item, index) => ({
            area: String(item?.area || toList(healthReport.keyObservations)[index] || '').trim(),
            observation: String(item?.observation || '').trim(),
            potentialRisk: String(item?.potentialRisk || '').trim(),
            evidence: Array.isArray(item?.evidence) ? item.evidence : []
          }))
        : [],
      annualReturnDetails: Array.isArray(healthReport.annualReturnDetails) ? healthReport.annualReturnDetails : [],
      checklistItems: Array.isArray(healthReport.checklistItems)
        ? healthReport.checklistItems.map((item) => ({
            requirement: String(item?.requirement || '').trim(),
            status: String(item?.status || '').trim(),
            remark: String(item?.remark || '').trim()
          })).filter((item) => item.requirement)
        : [],
      conclusionNotes: Array.isArray(healthReport.conclusionNotes) ? healthReport.conclusionNotes : [],
      reviewedConfirmation: Boolean(reviewConfirmed || healthReport.reviewedConfirmation),
      reportName: allocation ? 'COMPLIANCE HEALTH REPORT ALLOCATION' : 'COMPLIANCE HEALTH REPORT',
      allocationSubmittedAt: allocation ? new Date().toISOString() : String(healthReport.allocationSubmittedAt || ''),
      schemaVersion: 2,
      submittedAt: new Date().toISOString()
    };
  }

  async function submitHealthReport({ confirmed = false, allocation = false } = {}) {
    const leadId = healthReportLead?._id || healthReportLead?.id;
    if (!leadId || healthReportSaving) return;
    if (allocation) {
      if (!/^\d{10}$/.test(String(healthReport.otpMobile || '').replace(/\D/g, ''))) {
        setHealthReportError('Mobile Number for OTP must contain exactly 10 digits.');
        return;
      }
      const requiredCredentials = ['cpcbLoginId', 'cpcbPassword', 'ssoCpcbLoginId', 'ssoCpcbPassword'];
      if (requiredCredentials.some((field) => !String(healthReport[field] || '').trim())) {
        setHealthReportError('Please complete all CPCB and SSO CPCB credentials.');
        return;
      }
    } else if (!confirmed && !healthReport.reviewedConfirmation) {
      setHealthReportError('Review confirmation is required before saving the report.');
      return;
    }
    setHealthReportSaving(true);
    setHealthReportError('');
    try {
      const response = await api.put(API_ENDPOINTS.leads.detail(leadId), {
        workflowStatus: 'submitted',
        complianceHealthReport: buildHealthReportPayload(confirmed, allocation)
      });
      const savedLead = response.data.lead || response.data.data?.lead || response.data.data;
      if (!savedLead || typeof savedLead !== 'object') throw new Error('CRM did not return the saved lead.');
      if (complianceRouteLeadId) {
        setHealthReportLead(null);
        setHealthReport(emptyComplianceHealthReport);
        setNotice('Compliance Health Report saved successfully.');
        showToast('Compliance Health Report saved successfully.', 'success');
        await loadPage();
        navigate('/sales/lead-generation');
        return;
      }
      setHealthReportLead(savedLead);
      setHealthReport(reportToDraft(savedLead.complianceHealthReport));
      setHealthAssignmentOpen(true);
      setNotice('Compliance Health Report saved. Please select a Manager for review.');
      showToast('Report saved. Please select a Manager.', 'success');
    } catch (err) {
      const message = err?.response?.data?.error || err.message || 'Unable to save Compliance Health Report.';
      setHealthReportError(message);
      showToast(message, 'error');
    } finally {
      setHealthReportSaving(false);
    }
  }

  useEffect(() => {
    if (!complianceRouteLeadId || loading) return;
    const routeId = String(complianceRouteLeadId || '').trim();
    const match = leads.find((item) => [
      item._id,
      item.id,
      item.sourceLeadId,
      item.externalLeadId,
      item.leadCode,
      item.importMeta?.uniqueId
    ].some((value) => String(value || '').trim() === routeId));
    if (!match) {
      setHealthReportLead({ _id: routeId, id: routeId });
      setHealthReport(reportToDraft({}));
      setHealthReportError('');
      return;
    }
    setHealthReportLead(match);
    setHealthReport(reportToDraft(match.complianceHealthReport));
    setHealthReportError('');
  }, [complianceRouteLeadId, loading, leads]);

  function handleLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('login_email');
    navigate('/', { replace: true });
  }

  if (complianceRouteLeadId) {
    return (
      <DashboardShell currentUser={currentUser} onOpenProfile={() => setProfileOpen(true)} onLogout={handleLogout}>
        <ComplianceHealthReportModal
          lead={healthReportLead || {}}
          report={healthReport}
          saving={healthReportSaving}
          error={healthReportError}
          onChange={updateHealthReport}
          onSubmit={submitHealthReport}
          pageMode
          loading={loading}
          onBack={() => navigate('/sales/lead-generation')}
        />
        {profileOpen && <ProfileModal user={currentUser} saving={false} onClose={() => setProfileOpen(false)} onLogout={handleLogout} onSave={() => {}} onUpdatePassword={() => {}} />}
      </DashboardShell>
    );
  }

  function openLeadPoDetails(sourceLead, index = Math.max(0, (sourceLead.assignments || []).findIndex(hasSavedPoDetails))) {
    const selected = normalizeLegacyServiceSelections(sourceLead)[index] || {};
    const savedAssignment = sourceLead.assignments?.find(row => selected.assignedServiceId && row.assignedServiceId === selected.assignedServiceId) || sourceLead.assignments?.[index];
    if (!hasSavedPoDetails(savedAssignment)) {
      showToast('Enter and save PO details through the lead closure flow first.', 'error');
      return;
    }
    const normalized = { ...emptyLead, ...sourceLead, serviceSelections: normalizeLegacyServiceSelections(sourceLead) };
    setLead(normalized);
    setEditingLeadId(sourceLead._id || sourceLead.id || '');
    requestLeadClosure(index, String(currentUser?._id || currentUser?.id || ''), normalized);
    const selectedService = normalized.serviceSelections[index] || {};
    const assignment = sourceLead.assignments?.find((row) => selectedService.assignedServiceId
      && row?.assignedServiceId === selectedService.assignedServiceId) || sourceLead.assignments?.[index] || {};
    setClosureDialog((current) => ({ ...current, poEditor: true, reviewMode: false, choice: 'yes', quotationSent: assignment.quotationSent || (current.quotation ? 'yes' : 'no'), earlierQuotationProofUrl: assignment.earlierQuotationProofUrl || assignment.poYearRows?.[0]?.earlierQuotationProofUrl || '', earlierQuotationProofName: assignment.earlierQuotationProofName || assignment.poYearRows?.[0]?.earlierQuotationProofName || '' }));
  }

  const renderClosureDialog = () => (closureDialog && createPortal((
        <div className="fixed inset-0 z-[12000] bg-slate-50" role="dialog" aria-modal="true">
          <section className="flex h-screen w-full flex-col overflow-hidden bg-white">
            <header className="flex flex-col gap-4 border-b bg-gradient-to-r from-emerald-50 to-orange-50 px-6 py-5 lg:flex-row lg:items-start lg:justify-between"><div><p className="text-xs font-black uppercase tracking-[.18em] text-emerald-700">Lead Closure Verification</p><h2 className="mt-1 text-2xl font-black">Have you received the Purchase Order?</h2><p className="mt-1 text-sm font-bold text-slate-500">PO or Super Admin approval proof is required before closing this service.</p></div><div className="flex items-start gap-3">{closureDialog.quotationSent === 'yes' && String(closureDialog.quotation?.approvalDecision?.status || closureDialog.quotation?.status || '').toLowerCase() === 'approved' && (() => { const decision = closureDialog.quotation.approvalDecision || {}; const reviewer = decision.actionBy || {}; const role = String(reviewer.role || decision.reviewerRole || 'Admin').replace(/[_-]+/g, ' '); return <div className="min-w-[310px] rounded-2xl border border-emerald-200 bg-white/95 p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><span className="rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-800">Quotation Approved</span><span className="text-xs font-black text-slate-500">{closureDialog.quotation.leadCode || closureDialog.quotation.businessLeadCode || lead.leadCode || '-'}</span></div><p className="mt-3 text-sm font-black text-slate-900">Approved by {reviewer.name || reviewer.email || role}</p><p className="mt-1 text-xs font-bold capitalize text-slate-500">{role}{decision.actionAt ? ` • ${new Date(decision.actionAt).toLocaleString('en-IN')}` : ''}</p>{decision.proofUrl ? <a href={decision.proofUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800"><Eye className="h-4 w-4" />View approval proof{decision.proofName ? ` • ${decision.proofName}` : ''}</a> : <p className="mt-3 text-xs font-bold text-slate-400">Direct approval — no proof uploaded.</p>}</div> })()}<button type="button" onClick={() => setClosureDialog(null)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border bg-white"><X className="h-5 w-5" /></button></div></header>
            <div className="flex-1 overflow-y-auto p-6 lg:px-10">{closureDialog.poEditor && <label className="mb-5 block text-sm font-bold text-slate-700">Service<select aria-label="Select PO service" className="form-input mt-2 max-w-2xl" value={closureDialog.index} disabled={closureSaving || closureUploading} onChange={(event) => openLeadPoDetails(lead, Number(event.target.value))}>{normalizeLegacyServiceSelections(lead).map((service, index) => <option key={index} value={index} disabled={!hasSavedPoDetails(lead.assignments?.[index])}>{index + 1}. {service.servicesOffered || service.applicableService || service.eprCategory || 'Service'} · {service.subApplicantType || service.piboCategory || ''}</option>)}</select></label>}
              <section className="mb-6 rounded-2xl border border-indigo-200 bg-indigo-50 p-5">
                <h3 className="font-black text-indigo-950">Primary Lead Owner</h3>
                <p className="mt-1 text-sm font-bold text-indigo-700">The closure credit remains with the main lead owner. You remain recorded separately as the actual Closed By user.</p>
                <div className="mt-4 flex items-center gap-3 rounded-xl border-2 border-indigo-400 bg-white p-4 text-indigo-900"><span className="grid h-11 w-11 place-items-center rounded-full bg-indigo-100 font-black">{String(closureDialog.leadOwnerName || 'LO').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</span><span><strong className="block text-base font-black">{closureDialog.leadOwnerName}</strong>{closureDialog.leadOwnerEmail && <small className="mt-1 block font-bold text-slate-500">{closureDialog.leadOwnerEmail}</small>}</span></div>
              </section>
              {!closureDialog.reviewMode && <div className="grid gap-3 sm:grid-cols-2"><button type="button" onClick={() => setClosureDialog((current) => ({ ...current, choice: 'yes', poModeConfirmed: true, poMode: 'quotation' }))} className={`rounded-2xl border-2 p-5 text-left ${closureDialog.choice === 'yes' ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200'}`}><strong className="text-lg font-black">Yes — PO Received</strong><span className="mt-1 block text-sm font-bold">Enter PO details against every quotation service.</span></button><button type="button" onClick={() => setClosureDialog((current) => ({ ...current, choice: 'no' }))} className={`rounded-2xl border-2 p-5 text-left ${closureDialog.choice === 'no' ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-slate-200'}`}><strong className="text-lg font-black">No — Close with Approval</strong><span className="mt-1 block text-sm font-bold">Upload Super Admin email/message approval proof.</span></button></div>}
              {closureDialog.reviewMode && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-900"><p className="font-black">Purchase Order follow-up required</p><p className="mt-1 text-sm font-bold text-blue-700">This service was closed under special approval. Upload the received PO before the 7-business-day deadline to keep it closed.</p></div>}
              {closureDialog.choice === 'yes' && <div className="mt-6 space-y-5"><section className="rounded-2xl border border-blue-200 bg-blue-50 p-5"><h3 className="font-black text-blue-950">Was a quotation sent to the customer?</h3><div className="mt-4 grid gap-3 sm:grid-cols-2"><button type="button" onClick={() => selectClosureQuotationMode('yes')} className={`rounded-xl border-2 p-4 text-left font-black ${closureDialog.quotationSent === 'yes' ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-white bg-white text-slate-700'}`}>Yes — Quotation Sent</button><button type="button" onClick={() => selectClosureQuotationMode('no')} className={`rounded-xl border-2 p-4 text-left font-black ${closureDialog.quotationSent === 'no' ? 'border-amber-500 bg-amber-50 text-amber-900' : 'border-white bg-white text-slate-700'}`}>No — Use Earlier Quotation Proof</button></div>{closureDialog.quotationSent === 'no' && <div className="mt-4"><p className="mb-3 text-sm font-bold text-amber-900">Upload proof of the earlier quotation. No CRM quotation will be linked; enter the PO details manually for Admin approval.</p><label className="flex min-h-14 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-amber-400 bg-white px-4 font-black text-amber-900"><Upload className="mr-2 h-5 w-5" />{closureDialog.earlierQuotationProofName || 'Upload Earlier Quotation Proof'}<input type="file" className="sr-only" accept="image/*,.pdf" onChange={(event) => uploadClosureFile(event, 'quotation')} /></label></div>}</section>{closureDialog.quotationSent === 'yes' && <QuotationClosureSummary quotation={closureDialog.quotation} items={closureDialog.quotationItems} selectedService={closureDialog.selectedService} poRows={closureDialog.poYearRows} setClosureDialog={setClosureDialog} uploadClosureFile={uploadClosureFile} />}{closureDialog.quotationSent === 'no' && closureDialog.earlierQuotationProofUrl && <EarlierQuotationPoDetails selectedService={closureDialog.selectedService} poRows={closureDialog.poYearRows} setClosureDialog={setClosureDialog} uploadClosureFile={uploadClosureFile} />}</div>}
              {closureDialog.choice === 'no' && <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5"><h3 className="font-black text-amber-950">Close under special approval</h3><p className="mt-2 text-sm font-bold leading-6 text-amber-900">This service will be closed provisionally and the user and Super Admin will be notified by email. The PO must be uploaded within 7 business days (Monday?Friday, excluding weekends). If it is still missing after the deadline, only this service will reopen automatically; services with received POs will remain closed.</p><label className="mt-4 flex min-h-14 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-amber-400 bg-white px-4 font-black text-amber-900"><Upload className="mr-2 h-5 w-5" />{closureDialog.approvalProofName || 'Upload Super Admin approval proof'}<input type="file" className="sr-only" accept="image/*,.pdf" onChange={(event) => uploadClosureFile(event, 'approval')} /></label><p className="mt-2 text-xs font-bold text-amber-700">Accepted formats: image or PDF.</p></div>}
            </div>
            <footer className="flex justify-end gap-3 border-t bg-slate-50 px-6 py-4"><button type="button" disabled={closureSaving} onClick={() => setClosureDialog(null)} className="rounded-xl border bg-white px-5 py-3 font-black disabled:opacity-50">Cancel</button><button type="button" disabled={!closureDialog.choice || closureUploading || closureSaving} onClick={confirmLeadClosure} className="rounded-xl bg-[#0f5d46] px-6 py-3 font-black text-white disabled:opacity-50">{closureUploading ? 'Uploading...' : closureSaving ? 'Saving PO...' : 'Confirm & Save Closure'}</button></footer>
          </section>
        </div>
      ), document.body));

  if (viewMode === 'list') {
    if (viewLead) {
      return (
        <DashboardShell currentUser={currentUser} onOpenProfile={() => setProfileOpen(true)} onLogout={handleLogout}>
          {renderClosureDialog()}
          {toast && <div className="fixed right-5 top-24 z-[13000] w-[min(430px,calc(100vw-40px))]"><ToastMessage type={toast.type} actionLabel="Close" onAction={() => setToast(null)}>{toast.message}</ToastMessage></div>}
          <LeadDetailView
            lead={viewLead}
            onModifyPo={openLeadPoDetails}
            quotations={quotations}
            staff={staff}
            currentUser={currentUser}
            onBack={() => setViewLead(null)}
            onLeadUpdated={(updatedLead) => {
              setViewLead(updatedLead);
              setLeads((current) => current.map((item) => String(item._id || item.id) === String(updatedLead._id || updatedLead.id) ? updatedLead : item));
            }}
            onQuotationAction={(action) => {
              if (action === 'revise') {
                const currentUserTokens = [
                  currentUser?._id, currentUser?.id, currentUser?.crmUserId, currentUser?.userId,
                  currentUser?.name, currentUser?.email
                ].map(normalizePersonName).filter(Boolean);
                const leadCreatorTokens = [
                  viewLead.createdBy?._id, viewLead.createdBy?.id, viewLead.createdBy?.name,
                  viewLead.createdBy?.email, viewLead.createdByCrmUserId, viewLead.createdByName,
                  viewLead.createdByEmail, viewLead.importedCreatedBy
                ].map(normalizePersonName).filter(Boolean);
                const allServices = Array.isArray(viewLead.serviceSelections) && viewLead.serviceSelections.length
                  ? viewLead.serviceSelections
                  : [createServiceSelection(viewLead)];
                const leadParticipantTokens = [
                  ...leadCreatorTokens,
                  viewLead.generatedForUser?._id, viewLead.generatedForUser?.id,
                  viewLead.generatedForUser?.name, viewLead.generatedForUser?.email,
                  viewLead.generatedForName, viewLead.generatedForEmail
                ].map(normalizePersonName).filter(Boolean);
                const participantCanSeeAllServices = adminRoles.includes(String(currentUser?.role || '').toLowerCase())
                  || leadParticipantTokens.some((token) => currentUserTokens.includes(token));
                const ownedServices = allServices.map((service, sourceServiceIndex) => ({
                  ...service,
                  sourceServiceIndex
                })).filter((service) => {
                  if (participantCanSeeAllServices) return true;
                  const explicitOwnerTokens = [
                    service.createdByCrmUserId, service.createdByName, service.createdByEmail
                  ].map(normalizePersonName).filter(Boolean);
                  const ownerTokens = explicitOwnerTokens.length ? explicitOwnerTokens : leadCreatorTokens;
                  return ownerTokens.some((token) => currentUserTokens.includes(token));
                });
                const primaryOwnedService = ownedServices[0] || {};
                const quotationContext = {
                  sourceType: 'lead',
                  leadId: viewLead._id || viewLead.id || viewLead.sourceLeadId || '',
                  leadCode: viewLead.leadCode || '',
                  company: viewLead.company || '',
                  clientName: viewLead.company || '',
                  contactPerson: viewLead.contactPerson || '',
                  designation: viewLead.designation || '',
                  mobileNo1: viewLead.mobileNo1 || '',
                  mobileNo2: viewLead.mobileNo2 || '',
                  addressLine1: viewLead.addressLine1 || '',
                  addressLine2: viewLead.addressLine2 || '',
                  addressLine3: viewLead.addressLine3 || '',
                  state: viewLead.state || '',
                  city: viewLead.city || '',
                  pinCode: viewLead.pinCode || '',
                  serviceSelections: ownedServices,
                  industryType: primaryOwnedService.industryType || '',
                  servicesOffered: primaryOwnedService.servicesOffered || '',
                  annualYear: primaryOwnedService.firstAnnualReturnYearApplicable || '',
                  eprCategory: primaryOwnedService.eprCategory || '',
                  applicantType: primaryOwnedService.applicantType || '',
                  piboParent: primaryOwnedService.piboParent || '',
                  piboCategory: primaryOwnedService.piboCategory || ''
                };
                navigate('/sales/quotations', { state: { quotationContext, leadAction: 'revise' } });
                return;
              }
                const currentUserTokens = [
                  currentUser?._id, currentUser?.id, currentUser?.crmUserId, currentUser?.userId,
                  currentUser?.name, currentUser?.email
                ].map(normalizePersonName).filter(Boolean);
                const leadCreatorTokens = [
                  viewLead.createdBy?._id, viewLead.createdBy?.id, viewLead.createdBy?.name,
                  viewLead.createdBy?.email, viewLead.createdByCrmUserId, viewLead.createdByName,
                  viewLead.createdByEmail, viewLead.importedCreatedBy
                ].map(normalizePersonName).filter(Boolean);
                const allServices = Array.isArray(viewLead.serviceSelections) && viewLead.serviceSelections.length
                  ? viewLead.serviceSelections
                  : [createServiceSelection(viewLead)];
                const leadParticipantTokens = [
                  ...leadCreatorTokens,
                  viewLead.generatedForUser?._id, viewLead.generatedForUser?.id,
                  viewLead.generatedForUser?.name, viewLead.generatedForUser?.email,
                  viewLead.generatedForName, viewLead.generatedForEmail
                ].map(normalizePersonName).filter(Boolean);
                const participantCanSeeAllServices = adminRoles.includes(String(currentUser?.role || '').toLowerCase())
                  || leadParticipantTokens.some((token) => currentUserTokens.includes(token));
                const ownedServices = allServices.map((service, sourceServiceIndex) => ({
                  ...service,
                  sourceServiceIndex
                })).filter((service) => {
                  if (participantCanSeeAllServices) return true;
                  const explicitOwnerTokens = [
                    service.createdByCrmUserId, service.createdByName, service.createdByEmail
                  ].map(normalizePersonName).filter(Boolean);
                  const ownerTokens = explicitOwnerTokens.length ? explicitOwnerTokens : leadCreatorTokens;
                  return ownerTokens.some((token) => currentUserTokens.includes(token));
                });
                const primaryOwnedService = ownedServices[0] || {};
                const quotationContext = {
                  sourceType: 'lead',
                  leadId: viewLead._id || viewLead.id || viewLead.sourceLeadId || '',
                  leadCode: viewLead.leadCode || '',
                  company: viewLead.company || '',
                  clientName: viewLead.company || '',
                  contactPerson: viewLead.contactPerson || '',
                  designation: viewLead.designation || '',
                  mobileNo1: viewLead.mobileNo1 || '',
                  mobileNo2: viewLead.mobileNo2 || '',
                  addressLine1: viewLead.addressLine1 || '',
                  addressLine2: viewLead.addressLine2 || '',
                  addressLine3: viewLead.addressLine3 || '',
                  state: viewLead.state || '',
                  city: viewLead.city || '',
                  pinCode: viewLead.pinCode || '',
                  serviceSelections: ownedServices,
                  industryType: primaryOwnedService.industryType || '',
                  servicesOffered: primaryOwnedService.servicesOffered || '',
                  annualYear: primaryOwnedService.firstAnnualReturnYearApplicable || '',
                  eprCategory: primaryOwnedService.eprCategory || '',
                  applicantType: primaryOwnedService.applicantType || '',
                  piboParent: primaryOwnedService.piboParent || '',
                  piboCategory: primaryOwnedService.piboCategory || ''
                };
                navigate('/sales/quotations?mode=add', {
                state: {
                  quotationContext,
                  leadAction: 'add'
                }
              });
            }}
            onProformaAction={(action) => {
              const leadContext = {
                leadId: viewLead._id || viewLead.id || viewLead.sourceLeadId || '',
                leadCode: viewLead.leadCode || '',
                company: viewLead.company || '',
                clientName: viewLead.company || '',
                contactPerson: viewLead.contactPerson || '',
                designation: viewLead.designation || '',
                mobileNo1: viewLead.mobileNo1 || '',
                mobileNo2: viewLead.mobileNo2 || '',
                addressLine1: viewLead.addressLine1 || '',
                addressLine2: viewLead.addressLine2 || '',
                addressLine3: viewLead.addressLine3 || '',
                state: viewLead.state || '',
                city: viewLead.city || '',
                pinCode: viewLead.pinCode || '',
                referredBy: viewLead.referredBy || '',
                salutation: viewLead.salutation || '',
                gstNumber: viewLead.gstNumber || '',
                serviceSelections: Array.isArray(viewLead.serviceSelections) ? viewLead.serviceSelections : []
              };
              navigate('/sales/proforma-invoices', { state: { leadContext, leadAction: action === 'revise' ? 'revise' : 'add' } });
            }}
            onEdit={() => {
              const normalizedServices = normalizeLegacyServiceSelections(viewLead).map((row, index) => ({ ...row, firstAnnualReturnYearApplicable: row.firstAnnualReturnYearApplicable || (index === 0 ? viewLead.firstAnnualReturnYearApplicable : '') }));
              const ownerId = viewLead.generatedForUser?._id || viewLead.generatedForUser?.id || viewLead.generatedForUser || viewLead.createdOnBehalfOfUser?._id || viewLead.createdOnBehalfOfUser || viewLead.createdBy?._id || viewLead.createdBy?.id || viewLead.createdBy || currentUser?._id || currentUser?.id || '';
              const currentUserId = currentUser?._id || currentUser?.id || currentUser?.crmUserId || currentUser?.userId || '';
              setLead({
                ...emptyLead,
                ...viewLead,
                leadCode: displayLeadId(viewLead) === '-' ? nextVisibleLeadCode(allCcpLeads) : viewLead.leadCode,
                serviceSelections: normalizedServices,
                applicableService: normalizedServices[0]?.applicableService || viewLead.applicableService || '',
                assignedTo: viewLead.assignedTo?._id || viewLead.assignedTo?.id || viewLead.assignedTo || '',
                closedBy: viewLead.closedBy?._id || viewLead.closedBy?.id || viewLead.closedBy || ''
              });
              setGeneratedForUserId(String(ownerId));
              setGeneratedForMode(String(ownerId) === String(currentUserId) ? 'self' : 'other');
              setGeneratedForConfirmed(true);
              setEditingLeadId(viewLead._id || viewLead.id || '');
              setServiceOnlyMode(false);
              setViewLead(null);
              setActiveTab('basic');
              setViewMode('form');
            }}
            canEdit={canUserEditLead(viewLead, currentUser)}
          />
          {profileOpen && <ProfileModal user={currentUser} saving={false} onClose={() => setProfileOpen(false)} onLogout={handleLogout} onSave={() => {}} onUpdatePassword={() => {}} />}
        </DashboardShell>
      );
    }

    return (
      <DashboardShell currentUser={currentUser} onOpenProfile={() => setProfileOpen(true)} onLogout={handleLogout}>
        <LeadDirectoryView
          leads={leads}
          pagination={leadPagination}
          summary={leadSummary}
          staff={staff}
          currentUser={currentUser}
          loading={loading}
          error={error}
          onRefresh={loadPage}
          initialWorkspace={['temporary', 'notified'].includes(new URLSearchParams(location.search).get('tab')) ? new URLSearchParams(location.search).get('tab') : 'leads'}
          onDirectoryQueryChange={loadLeadDirectory}
          onExportAll={loadAllLeadsForExport}
          onView={async (item) => setViewLead(await fetchLeadDetail(item))}
          onEdit={async (item) => applyLeadEdit(await fetchLeadDetail(item))}
          onDelete={async (item) => {
            const id = leadRecordId(item);
            await api.delete(API_ENDPOINTS.leads.delete(id));
            setLeads((current) => current.filter((row) => leadRecordId(row) !== id));
            setAllCcpLeads((current) => current.filter((row) => leadRecordId(row) !== id));
            showToast('Lead deleted successfully.', 'success');
          }}
          onToggleActive={async (item, recordStatus) => {
            const id = leadRecordId(item);
            const response = await api.put(API_ENDPOINTS.leads.detail(id), { ...item, recordStatus });
            const updated = response.data?.lead || response.data?.data?.lead || { ...item, recordStatus };
            setLeads((current) => current.map((row) => leadRecordId(row) === id ? { ...row, ...updated, recordStatus } : row));
            showToast(`Lead marked ${recordStatus.toLowerCase()}.`, 'success');
          }}
          canEdit={adminRoles.includes(String(currentUser?.role || '').toLowerCase())}
          onCreate={() => { const startedAt = new Date().toISOString(); formStartedAtRef.current = startedAt; setLead({ ...emptyLead, formStartedAt: startedAt }); setEditingLeadId(''); setServiceOnlyMode(false); setActiveTab('basic'); setViewMode('form'); }}
        />
        {profileOpen && <ProfileModal user={currentUser} saving={false} onClose={() => setProfileOpen(false)} onLogout={handleLogout} onSave={() => {}} onUpdatePassword={() => {}} />}
      </DashboardShell>
    );
  }

  return (
    <DashboardShell currentUser={currentUser} onOpenProfile={() => setProfileOpen(true)} onLogout={handleLogout}>
      {toast && (
        <div className="fixed right-5 top-24 z-[13000] w-[min(430px,calc(100vw-40px))]">
          <ToastMessage type={toast.type} actionLabel="Close" onAction={() => setToast(null)}>{toast.message}</ToastMessage>
        </div>
      )}
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-[28px] bg-gradient-to-br from-emerald-50 via-white to-cyan-50 p-4 shadow-sm ring-1 ring-emerald-100 sm:p-5 lg:p-6">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="flex items-center gap-4">
              <button type="button" onClick={() => setViewMode('list')} className="btn-lift inline-flex h-11 w-11 items-center justify-center rounded-lg border border-emerald-100 bg-white text-emerald-700 shadow-sm">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <p className="text-sm font-black uppercase tracking-[0.18em] text-emerald-700">Customer Hub</p>
                <h1 className="mt-1 text-3xl font-black text-slate-950">Lead Generation</h1>
              </div>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Step {activeIndex + 1} of {tabs.length}</p>
              <p className="mt-1 font-black text-emerald-700">{isFirstStepReady ? 'Workflow unlocked' : 'Complete first step'}</p>
            </div>
          </div>

          {canUseExcelBulkImport && <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-black text-slate-950">Excel upload (Lead Import)</p>
              <p className="mt-1 text-xs font-bold text-slate-500">
                Upload .xlsx with headers: Company, Status, Service Category, Applicant Type, Sub Applicant Type, Services Offered, Address, City, PIN, State, Contact Person.
              </p>
              {excelFileName && (
                <p className="mt-2 text-xs font-black text-slate-700">
                  File: <span className="font-extrabold">{excelFileName}</span> {excelRows.length ? `(${excelRows.length} row${excelRows.length === 1 ? '' : 's'})` : ''}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={downloadLeadImportTemplate} className="btn-lift inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-5 font-black text-emerald-800 hover:bg-emerald-100"><Download className="h-4 w-4" /> Download Template</button>
              <label className="btn-lift inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 font-black text-slate-800 hover:bg-slate-50">
                <Upload className="h-4 w-4" /> Upload Excel
                <input type="file" accept=".xlsx,.xls" onChange={handleExcelUpload} className="sr-only" />
              </label>
              <button
                type="button"
                disabled={!excelRows.length || importing || saving}
                onClick={importExcelRows}
                className="btn-lift min-h-11 rounded-xl bg-gradient-to-r from-emerald-700 to-teal-700 px-6 font-black text-white shadow-lg shadow-emerald-700/20 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {importing ? 'Importing...' : 'Import Drafts'}
              </button>
            </div>
          </div>}

          <section className="mt-6 rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-cyan-50 p-3 shadow-lg shadow-emerald-900/5">
            <div className="grid gap-2 sm:grid-cols-4">
              {tabs.map((tab, index) => {
                const Icon = tab.icon;
                const locked = ownershipRequired || (tab.id !== 'basic' && !isFirstStepReady);
                const active = activeTab === tab.id;
                const complete = index === 0 && isFirstStepReady;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => openTab(tab.id)}
                    aria-disabled={locked}
                    title={locked ? 'Complete first step to unlock this tab' : tab.label}
                    className={`group relative min-h-14 overflow-hidden rounded-xl px-4 font-black transition duration-300 ${
                      active
                        ? 'bg-[#30737B] text-white shadow-lg shadow-teal-900/15'
                        : locked
                          ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                          : 'bg-white text-slate-600 hover:bg-teal-50 hover:text-[#30737B]'
                    }`}
                  >
                    <span className={`absolute inset-x-0 bottom-0 h-1 transition ${active ? 'bg-cyan-200' : 'bg-transparent'}`} />
                    <span className="relative flex items-center justify-center gap-2">
                      {complete ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <Icon className="h-5 w-5" />}
                      {tab.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {error && <ToastMessage type="error" className="mt-5">{error}</ToastMessage>}
          {notice && <ToastMessage type="success" className="mt-5">{notice}</ToastMessage>}

          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            {activeTab === 'basic' && (
              <div className="grid gap-7">
                {serviceOnlyMode && <div className="lead-service-only-banner"><CheckCircle2 className="h-5 w-5" /><div><strong>Add Services mode</strong><p>Existing lead details are frozen. Only Service &amp; Applicant can be edited.</p></div></div>}
                {!serviceOnlyMode && <section className="lead-company-search">
                  <div className="flex flex-wrap items-end gap-3">
                    <Field label="Lead Search Company" className="min-w-[260px] flex-1">
                      <div className="relative">
                        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input className="form-input pl-11" value={companySearch} onChange={(event) => { setCompanySearch(event.target.value); setCompanySearchResults([]); setCompanySearchTouched(false); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); runCompanySearch(); } }} placeholder="For example: 20 MICRONS NANO MINERALS LIMITED" />
                      </div>
                    </Field>
                    <button type="button" disabled={companySearch.trim().length < 2 || companySearchLoading} onClick={runCompanySearch} className="min-h-[50px] rounded-xl bg-emerald-700 px-7 font-black text-white shadow-lg shadow-emerald-700/20 disabled:cursor-not-allowed disabled:opacity-50"><Search className="mr-2 inline h-4 w-4" />{companySearchLoading ? 'Searching...' : 'Search'}</button>
                  </div>
                  {companySearchTouched && (
                    <div className="mt-4">
                      {companySearchMatches.length ? (
                        <div className="grid gap-2">
                          {companySearchMatches.map((item) => {
                            const exact = normalizeCompanyIdentity(item.company) === normalizedCompanySearch;
                            const approved = approvedCompanyIdentities.has(normalizeCompanyIdentity(item.company));
                            return <button type="button" key={leadRecordId(item)} onClick={() => openExistingLeadDecision(item)} className={`lead-search-result w-full text-left ${exact && !approved ? 'duplicate' : ''}`}>
                              <div><strong>{item.company}</strong><p>{displayLeadId(item)} · Generated by {leadOwnerLabel(item)}</p></div>
                              <span>{approved ? 'Approved override' : exact ? 'Already exists' : 'Existing lead'}</span>
                            </button>;
                          })}
                          {companySearchMatches.some((item) => normalizeCompanyIdentity(item.company) === normalizedCompanySearch) && !approvedCompanyIdentities.has(normalizedCompanySearch) && <div className="lead-duplicate-warning"><CircleAlert className="h-5 w-5" /><div><strong>This lead already exists</strong><p>Open the company result to add services or request special approval.</p></div></div>}
                        </div>
                      ) : (
                        <div className="lead-search-available"><CheckCircle2 className="h-5 w-5" /><div><strong>Company name is available</strong><p>No matching lead was found in CRM.</p></div><button type="button" onClick={() => { updateField('company', companySearch.trim()); showToast('Company added to the new lead form.', 'success'); }}>Use this company</button></div>
                      )}
                    </div>
                  )}
                </section>}
                <LeadSection title="Company Information">
                  <Field label="Lead ID"><input className="form-input bg-slate-100" value={displayLeadId(lead) === '-' ? 'Generated after save' : displayLeadId(lead)} readOnly /></Field>
                  <Field required label="Company">
                    <input disabled={serviceOnlyMode} className={`form-input disabled:bg-slate-100 disabled:text-slate-500 ${duplicateCompanyLead ? 'border-red-400 bg-red-50 ring-4 ring-red-100' : ''}`} value={lead.company} onChange={(event) => { updateField('company', event.target.value); if (!event.target.value.trim()) setGeneratedForConfirmed(false); }} onBlur={() => { if (lead.company) { setCompanySearch(lead.company); setCompanySearchTouched(true); if (!editingLeadId && !generatedForConfirmed) openGeneratedForChooser('new'); } }} />
                  </Field>
                </LeadSection>
                <section className={`lead-communication-matrix ${ownershipRequired ? 'pointer-events-none select-none opacity-45' : ''}`} aria-disabled={ownershipRequired}>
                  <h2>Client Communication Mode</h2>
                  <div className="lead-communication-head"><span>Client Communication Mode</span><span>Status *</span></div>
                  <div className="lead-communication-row">
                    <div className="lead-service-select-cell"><SearchableSelect disabled={serviceOnlyMode} value={lead.communicationMode} options={withCustomOptions('communicationMode', options.communicationMode)} onChange={(value) => requestSpecification('communicationMode', value, 'Communication mode')} placeholder="Select communication mode" allowCustom={false} />{canManageServiceCatalog && !serviceOnlyMode && <button type="button" onClick={() => openDropdownDialog({ field: 'communicationMode', label: 'Communication Mode', scope: 'lead', targetField: 'communicationMode' })} className="lead-service-catalog-add"><Plus className="h-3.5 w-3.5" />Add Communication Mode</button>}</div>
                    <div className="lead-service-select-cell"><SearchableSelect multiple disabled={serviceOnlyMode} value={lead.status} options={withCustomOptions('status', options.status)} onChange={(value) => updateField('status', value)} placeholder="Select one or more statuses" allowCustom={false} />{canManageServiceCatalog && !serviceOnlyMode && <button type="button" onClick={() => openDropdownDialog({ field: 'status', label: 'Status', scope: 'lead', targetField: 'status' })} className="lead-service-catalog-add"><Plus className="h-3.5 w-3.5" />Add Status</button>}</div>
                  </div>
                  {lead.communicationModeNote && (
                    <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-slate-700">
                      <strong className="text-emerald-800">Communication details:</strong> {lead.communicationModeNote}
                    </div>
                  )}
                </section>
                <div className={`lead-service-matrix ${ownershipRequired ? 'pointer-events-none select-none opacity-45' : ''}`} aria-disabled={ownershipRequired}>
                  <div className="lead-service-matrix-title"><div><p>Service &amp; Applicant</p><span>Add one or more service combinations for this lead.</span></div><button type="button" onClick={addServiceRow}><Plus className="h-4 w-4" />Add</button></div>
                  <div className="overflow-x-auto">
                    <div className="lead-service-matrix-head"><span>#</span><span>Industry Type <b aria-label="required">*</b></span><span>Business Category <b aria-label="required">*</b></span><span>Service Category <b aria-label="required">*</b></span><span>Applicant Type <b aria-label="required">*</b></span><span>Sub Applicant Type <b aria-label="required">*</b></span><span>Services Offered <b aria-label="required">*</b></span><span>Plant Unit <b aria-label="required">*</b></span><span>Financial Year <b aria-label="required">*</b></span><span>Action</span></div>
                    {serviceRows.map((row, index) => {
                      const currentIds = [currentUser?._id, currentUser?.id, currentUser?.crmUserId, currentUser?.userId, currentUser?.email, currentUser?.name].filter(Boolean).map((value) => String(value).toLowerCase());
                      const rowOwners = [
                        row.createdByCrmUserId, row.createdByEmail, row.createdByName,
                        (!row.createdByCrmUserId && index < frozenServiceRowCount) ? selectedSearchLead?.createdByCrmUserId : '',
                        (!row.createdByEmail && index < frozenServiceRowCount) ? selectedSearchLead?.createdByEmail : '',
                        (!row.createdByName && index < frozenServiceRowCount) ? selectedSearchLead?.importedCreatedBy : '',
                        (!row.createdByCrmUserId && index < frozenServiceRowCount) ? selectedSearchLead?.createdBy?._id : '',
                        (!row.createdByEmail && index < frozenServiceRowCount) ? selectedSearchLead?.createdBy?.email : '',
                        (!row.createdByName && index < frozenServiceRowCount) ? selectedSearchLead?.createdBy?.name : ''
                      ].filter(Boolean).map((value) => String(value).toLowerCase());
                      // Ownership protection applies only to rows that were already
                      // persisted. A newly added row must remain editable even when
                      // the lead is being generated on behalf of another user.
                      const isAdminUser = adminRoles.includes(String(currentUser?.role || '').trim().toLowerCase());
                      const ownedByAnotherUser = !isAdminUser && index < frozenServiceRowCount && rowOwners.length > 0 && !rowOwners.some((value) => currentIds.includes(value));
                      const rowFrozen = ownedByAnotherUser;
                      const directOptions = directApplicantOptions(row.eprCategory);
                      const direct = Boolean(directOptions);
                      const applicantOptions = directOptions || PIBO_PARENTS;
                      const categoryOptions = direct ? [] : normalizePiboCategories(piboCategories).filter((category) => category.parent === row.applicantType).map((category) => category.name);
                      return <div className="lead-service-matrix-row" key={index}>
                        <span className="lead-service-row-number" title={row.plantUnit || ''}>{index + 1}<small className="block text-[8px] text-teal-700">{row.plantUnit || ''}</small></span>
                        <div className="lead-service-select-cell"><SearchableSelect disabled={rowFrozen} value={row.industryType} options={withCustomOptions('industryType', options.industryType)} onChange={(value) => updateServiceRow(index, 'industryType', value)} placeholder="Select industry" allowCustom={false} />{canManageServiceCatalog && !rowFrozen && <button type="button" onClick={() => openDropdownDialog({ field: 'industryType', label: 'Industry Type', scope: 'service', index, targetField: 'industryType' })} className="lead-service-catalog-add"><Plus className="h-3.5 w-3.5" />Add Industry Type</button>}</div>
                        <div className="lead-service-select-cell"><SearchableSelect disabled={rowFrozen} value={row.businessCategory} options={withCustomOptions('businessCategory', BUSINESS_CATEGORY_OPTIONS)} onChange={(value) => updateServiceRow(index, 'businessCategory', value)} placeholder="Select Business Category" allowCustom={false} />{canManageServiceCatalog && !rowFrozen && <button type="button" onClick={() => openDropdownDialog({ field: 'businessCategory', label: 'Business Category', scope: 'service', index, targetField: 'businessCategory' })} className="lead-service-catalog-add"><Plus className="h-3.5 w-3.5" />Add Business Category</button>}</div>
                        <div className="lead-service-select-cell"><SearchableSelect allowCustom={false} disabled={rowFrozen} value={row.eprCategory} options={serviceCategoryOptions} onChange={(value) => updateServiceRow(index, 'eprCategory', value)} placeholder="Select Service Category" />{canManageServiceCatalog && !rowFrozen && <button type="button" onClick={() => openCatalogDialog('category', index)} className="lead-service-catalog-add"><Plus className="h-3.5 w-3.5" />Add Service Category</button>}</div>
                        <div className="lead-service-select-cell"><SearchableSelect disabled={rowFrozen} value={row.applicantType} options={withCustomOptions('applicantType', applicantOptions)} onChange={(value) => updateServiceRow(index, 'applicantType', value)} placeholder="Select Applicant Type" allowCustom={false} />{canManageServiceCatalog && !rowFrozen && <button type="button" onClick={() => openDropdownDialog({ field: 'applicantType', label: 'Applicant Type', scope: 'service', index, targetField: 'applicantType' })} className="lead-service-catalog-add"><Plus className="h-3.5 w-3.5" />Add Applicant Type</button>}</div>
                        {direct ? <div className="lead-service-not-applicable"><CheckCircle2 className="h-4 w-4" />Not applicable</div> : <div className="lead-service-select-cell"><SearchableSelect allowCustom={false} value={row.piboCategory} options={categoryOptions} disabled={rowFrozen || !row.applicantType || piboCategoriesLoading} onChange={(value) => updateServiceRow(index, 'piboCategory', value)} placeholder={row.applicantType ? `Select ${row.applicantType} category` : 'Select applicant first'} />{canManageServiceCatalog && !rowFrozen && row.applicantType && <button type="button" onClick={() => { setSpecifyNote(''); setSpecifyDialog({ categoryRow: index, applicantType: row.applicantType, label: 'Sub Applicant Type' }); }} className="lead-service-catalog-add"><Plus className="h-3.5 w-3.5" />Add Sub Applicant Type</button>}</div>}
                        <div className="lead-service-select-cell"><SearchableSelect allowCustom={false} disabled={rowFrozen || !row.eprCategory} value={row.servicesOffered} options={servicesForCategory(row.eprCategory)} onChange={(value) => updateServiceRow(index, 'servicesOffered', value)} placeholder={row.eprCategory ? 'Select Services Offered' : 'Select category first'} />{canManageServiceCatalog && !rowFrozen && row.eprCategory && <button type="button" onClick={() => openCatalogDialog('service', index, row.eprCategory)} className="lead-service-catalog-add"><Plus className="h-3.5 w-3.5" />Add Services Offered</button>}</div>
                        <div className="lead-service-select-cell"><SearchableSelect allowCustom={false} disabled={rowFrozen} value={row.plantUnit || ''} options={PLANT_UNIT_OPTIONS} onChange={(value) => updateServiceRow(index, 'plantUnit', value)} placeholder="Select unit" /></div>
                        <div className="lead-service-select-cell"><SearchableSelect disabled={rowFrozen} value={row.firstAnnualReturnYearApplicable || ''} options={withCustomOptions('financialYear', annualReturnYearOptions)} onChange={(value) => updateServiceRow(index, 'firstAnnualReturnYearApplicable', value)} placeholder="Select FY" allowCustom={false} />{canManageServiceCatalog && !rowFrozen && <button type="button" onClick={() => openDropdownDialog({ field: 'financialYear', label: 'Financial Year', scope: 'service', index, targetField: 'firstAnnualReturnYearApplicable' })} className="lead-service-catalog-add"><Plus className="h-3.5 w-3.5" />Add Financial Year</button>}</div>
                        <button type="button" disabled={rowFrozen || serviceRows.length === 1} onClick={() => setServiceRemoveIndex(index)} className="lead-matrix-remove" title="Remove row"><X className="h-4 w-4" /></button>
                      </div>;
                    })}
                  </div>
                </div>
                {Number.isInteger(serviceRemoveIndex) && (
                  <div className="fixed inset-0 z-[10020] grid place-items-center bg-slate-950/55 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="remove-service-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setServiceRemoveIndex(null); }}>
                    <section className="w-full max-w-md overflow-hidden rounded-3xl border border-red-100 bg-white shadow-2xl">
                      <div className="p-6 sm:p-7">
                        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-red-50 text-red-600 ring-1 ring-red-100"><CircleAlert className="h-7 w-7" /></span>
                        <h2 id="remove-service-title" className="mt-5 text-2xl font-black text-slate-950">Remove this service?</h2>
                        <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">Are you sure you want to remove service row {serviceRemoveIndex + 1}? This will also remove its matching assignment details.</p>
                        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <strong className="block text-sm text-slate-900">{serviceRows[serviceRemoveIndex]?.eprCategory || 'Selected service'}</strong>
                          <span className="mt-1 block text-xs font-bold text-slate-500">{serviceRows[serviceRemoveIndex]?.servicesOffered || serviceRows[serviceRemoveIndex]?.applicantType || 'Service details'}</span>
                        </div>
                      </div>
                      <div className="flex flex-col-reverse gap-3 border-t border-slate-100 bg-slate-50/70 p-5 sm:flex-row sm:justify-end">
                        <button type="button" onClick={() => setServiceRemoveIndex(null)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-5 text-sm font-black text-slate-700 hover:bg-slate-100">No, Keep It</button>
                        <button type="button" onClick={() => { const index = serviceRemoveIndex; setServiceRemoveIndex(null); removeServiceRow(index); }} className="min-h-11 rounded-xl bg-red-600 px-5 text-sm font-black text-white shadow-lg shadow-red-200 hover:bg-red-700">Yes, Remove</button>
                      </div>
                    </section>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'address' && (
              <section className="min-w-0 max-w-full overflow-hidden">
                <div className="lead-address-title"><div><h2>Address Information</h2><p>Add one or more office, registered, factory, or correspondence addresses.</p></div><button type="button" onClick={() => setAddRowConfirmation('address')}><Plus className="h-4 w-4" />Add Address</button></div>
                {serviceOnlyMode && <div className="lead-service-only-banner mt-4"><CheckCircle2 className="h-5 w-5" /><div><strong>Existing addresses are frozen</strong><p>{canRemoveFrozenAddress ? 'Admin and Super Admin can remove an existing address; use Add Address to create an editable new row.' : 'Use Add Address to create an editable new row.'}</p></div></div>}
                {locationError && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800" role="status">{locationError}</div>}
                <fieldset className="mt-5 min-w-0 max-w-full">
                  <div className="lead-address-matrix">
                    <div className="lead-address-head"><span>#</span><span>Address Line 1 *</span><span>Address Line 2</span><span>Address Line 3</span><span>Landmark</span><span>State *</span><span>City *</span><span>PIN *</span><span>Website</span><span>Action</span></div>
                    {addressRows.map((row, index) => {
                      const rowCities = row.state ? citiesByState[row.state] || stateCities[row.state] || [] : [];
                      const citiesLoading = Boolean(row.state && locationLoading.cities[row.state]);
                      const rowFrozen = serviceOnlyMode && index < frozenAddressRowCount;
                      return <div className="lead-address-row" key={index}>
                        <span className="lead-service-row-number" title={row.plantUnit || ''}>{index + 1}<small className="block text-[8px] text-teal-700">{row.plantUnit || ''}</small></span>
                        <input disabled={rowFrozen} className="form-input" value={row.addressLine1} onChange={(event) => updateAddressRow(index, 'addressLine1', event.target.value)} placeholder="Address line 1" />
                        <input disabled={rowFrozen} className="form-input" value={row.addressLine2} onChange={(event) => updateAddressRow(index, 'addressLine2', event.target.value)} placeholder="Address line 2" />
                        <input disabled={rowFrozen} className="form-input" value={row.addressLine3} onChange={(event) => updateAddressRow(index, 'addressLine3', event.target.value)} placeholder="Address line 3" />
                        <input disabled={rowFrozen} className="form-input" value={row.landmark} onChange={(event) => updateAddressRow(index, 'landmark', event.target.value)} placeholder="Landmark" />
                        <div className="lead-service-select-cell"><SearchableSelect value={row.state} options={withCustomOptions('state', countryStates.length ? countryStates : options.states)} disabled={rowFrozen || (locationLoading.states && !countryStates.length && !options.states.length)} onChange={(value) => updateAddressRow(index, 'state', value)} placeholder={locationLoading.states ? 'Loading states...' : 'Select state'} allowCustom={false} />{canManageServiceCatalog && !rowFrozen && <button type="button" onClick={() => openDropdownDialog({ field: 'state', label: 'State', scope: 'address', index, targetField: 'state' })} className="lead-service-catalog-add"><Plus className="h-3.5 w-3.5" />Add State</button>}</div>
                        <div className="lead-service-select-cell"><SearchableSelect value={row.city} options={withCustomOptions('city', rowCities)} disabled={rowFrozen || !row.state || citiesLoading} onChange={(value) => updateAddressRow(index, 'city', value)} placeholder={!row.state ? 'State first' : citiesLoading ? 'Loading cities...' : 'Select city'} allowCustom={false} />{canManageServiceCatalog && !rowFrozen && row.state && <button type="button" onClick={() => openDropdownDialog({ field: 'city', label: 'City', scope: 'address', index, targetField: 'city' })} className="lead-service-catalog-add"><Plus className="h-3.5 w-3.5" />Add City</button>}</div>
                        <input disabled={rowFrozen} className="form-input" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={row.pinCode} onChange={(event) => updateAddressRow(index, 'pinCode', event.target.value)} placeholder="6-digit PIN" />
                        <input disabled={rowFrozen} className="form-input" value={row.website} onChange={(event) => updateAddressRow(index, 'website', event.target.value)} placeholder="https://" />
                        <button type="button" disabled={(rowFrozen && hasDetailRowData(row) && !canRemoveFrozenAddress) || addressRows.length === 1} onClick={() => removeAddressRow(index)} className="lead-matrix-remove" aria-label={`Remove address ${index + 1}`} title={rowFrozen && !canRemoveFrozenAddress ? 'Existing addresses can only be removed by Admin or Super Admin' : 'Remove address'}><X className="h-4 w-4" /></button>
                      </div>;
                    })}
                  </div>
                </fieldset>
              </section>
            )}

            {activeTab === 'contact' && (
              <fieldset className="min-w-0 max-w-full">
                <div className="lead-address-title"><div><h2>Contact Information</h2><p>Add company contacts, including optional WhatsApp and LinkedIn information.</p></div><button type="button" onClick={() => setAddRowConfirmation('contact')}><Plus className="h-4 w-4" />Add Contact</button></div>
                <div className="lead-contact-matrix mt-5">
                  <div className="lead-contact-head"><span>#</span><span>Salutation *</span><span>Contact Person *</span><span>Designation *</span><span>Email *</span><span>Mobile No. 1 *</span><span>Mobile No. 2</span><span>WhatsApp No.</span><span>LinkedIn</span><span>Referred By *</span><span>Source *</span><span>Business Card</span><span>Action</span></div>
                  {contactRows.map((row, index) => {
                    const rowFrozen = serviceOnlyMode && index < frozenContactRowCount;
                    return <div className="lead-contact-row" key={index}>
                    <span className="lead-service-row-number" title={row.plantUnit || ''}>{index + 1}<small className="block text-[8px] text-teal-700">{row.plantUnit || ''}</small></span>
                    <div className="lead-service-select-cell"><SearchableSelect disabled={rowFrozen} value={row.salutation} options={withCustomOptions('salutation', options.salutations)} onChange={(value) => updateContactRow(index, 'salutation', value)} placeholder="Select" allowCustom={false} />{canManageServiceCatalog && !rowFrozen && <button type="button" onClick={() => openDropdownDialog({ field: 'salutation', label: 'Salutation', scope: 'contact', index, targetField: 'salutation' })} className="lead-service-catalog-add"><Plus className="h-3.5 w-3.5" />Add Salutation</button>}</div>
                    <input disabled={rowFrozen} className="form-input" value={row.contactPerson} onChange={(event) => updateContactRow(index, 'contactPerson', event.target.value)} placeholder="Contact person" />
                    <div className="lead-service-select-cell"><SearchableSelect disabled={rowFrozen} value={row.designation} options={withCustomOptions('designation', options.designation)} onChange={(value) => updateContactRow(index, 'designation', value)} placeholder="Designation" allowCustom={false} />{canManageServiceCatalog && !rowFrozen && <button type="button" onClick={() => openDropdownDialog({ field: 'designation', label: 'Designation', scope: 'contact', index, targetField: 'designation' })} className="lead-service-catalog-add"><Plus className="h-3.5 w-3.5" />Add Designation</button>}</div>
                    <input disabled={rowFrozen} className="form-input" type="email" value={row.emails} onChange={(event) => updateContactRow(index, 'emails', event.target.value)} placeholder="email@example.com" />
                    <input disabled={rowFrozen} className="form-input" inputMode="numeric" maxLength={10} value={row.mobileNo1} onChange={(event) => updateContactRow(index, 'mobileNo1', event.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile" />
                    <input disabled={rowFrozen} className="form-input" inputMode="numeric" maxLength={10} value={row.mobileNo2} onChange={(event) => updateContactRow(index, 'mobileNo2', event.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="Optional" />
                    <input disabled={rowFrozen} className="form-input" inputMode="numeric" maxLength={10} value={row.whatsappNo} onChange={(event) => updateContactRow(index, 'whatsappNo', event.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="WhatsApp number" />
                    <input disabled={rowFrozen} className="form-input" type="url" value={row.linkedinUrl} onChange={(event) => updateContactRow(index, 'linkedinUrl', event.target.value)} placeholder="linkedin.com/in/..." />
                    <SearchableSelect disabled={rowFrozen} value={row.referredBy} options={[...new Set(staffOptions.map((item) => item.label))]} onChange={(value) => updateContactRow(index, 'referredBy', value)} placeholder="Select staff" />
                    <div className="lead-service-select-cell"><SearchableSelect disabled={rowFrozen} value={row.source} options={withCustomOptions('source', options.source)} onChange={(value) => updateContactRow(index, 'source', value)} placeholder="Select source" allowCustom={false} />{canManageServiceCatalog && !rowFrozen && <button type="button" onClick={() => openDropdownDialog({ field: 'source', label: 'Source', scope: 'contact', index, targetField: 'source' })} className="lead-service-catalog-add"><Plus className="h-3.5 w-3.5" />Add Source</button>}</div>
                    <div className="lead-contact-upload"><label className={rowFrozen ? 'pointer-events-none opacity-60' : ''}><Upload className="h-4 w-4" />{row.businessCardUrl ? 'Replace' : 'Upload'}<input disabled={rowFrozen} type="file" accept="image/*,.pdf" onChange={(event) => uploadContactBusinessCard(index, event)} className="sr-only" /></label>{row.businessCardUrl && <button type="button" onClick={() => window.open(row.businessCardUrl, '_blank', 'noopener,noreferrer')}><Eye className="h-4 w-4" />View</button>}</div>
                    <button type="button" disabled={(rowFrozen && hasDetailRowData(row)) || contactRows.length === 1} onClick={() => removeContactRow(index)} className="lead-matrix-remove"><X className="h-4 w-4" /></button>
                  </div>})}
                </div>
              </fieldset>
            )}

            {addRowConfirmation && (
              <div className="fixed inset-0 z-[10020] grid place-items-center bg-slate-950/55 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="add-row-confirmation-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setAddRowConfirmation(null); }}>
                <section className="w-full max-w-md overflow-hidden rounded-3xl border border-teal-100 bg-white shadow-2xl">
                  <div className="p-6 sm:p-7">
                    <span className="grid h-14 w-14 place-items-center rounded-2xl bg-teal-50 text-teal-700 ring-1 ring-teal-100"><CircleAlert className="h-7 w-7" /></span>
                    <h2 id="add-row-confirmation-title" className="mt-5 text-2xl font-black text-slate-950">Add another {addRowConfirmation}?</h2>
                    <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">Are you sure you want to add a new {addRowConfirmation} row? It will be assigned the next available unit number.</p>
                  </div>
                  <div className="flex flex-col-reverse gap-3 border-t border-slate-100 bg-slate-50/70 p-5 sm:flex-row sm:justify-end">
                    <button type="button" onClick={() => setAddRowConfirmation(null)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-5 text-sm font-black text-slate-700 hover:bg-slate-100">No, Cancel</button>
                    <button type="button" onClick={addRowConfirmation === 'address' ? addAddressRow : addContactRow} className="min-h-11 rounded-xl bg-teal-700 px-5 text-sm font-black text-white shadow-lg shadow-teal-200 hover:bg-teal-800">Yes, Add {addRowConfirmation === 'address' ? 'Address' : 'Contact'}</button>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'assign' && (
              <fieldset className="min-w-0 max-w-full">
                <div className="lead-address-title"><div><h2>Assign Lead</h2><p>Add one or more responsible staff and closure owners.</p></div><button type="button" onClick={addAssignmentRow}><Plus className="h-4 w-4" />Add Assignment</button></div>
                <div className="lead-assign-matrix mt-5">
                  <div className="lead-assign-head"><span>#</span><span>Industry Type</span><span>Business Category</span><span>Service Category</span><span>{assignmentApplicantLabel} <b className="text-red-500">*</b></span><span>Services Offered</span><span>Lead Closed By</span><span>Assign To Manager</span><span>Manager Assigned to Staff</span><span>Claim Royalty</span><span>Action</span></div>
                  {assignmentRows.map((row, index) => {
                    const matchingService = serviceRows[index] || serviceRows[serviceRows.length - 1] || {};
                    const currentUserIds = [currentUser?._id, currentUser?.id, currentUser?.crmUserId, currentUser?.userId].filter(Boolean).map(String);
                    const currentUserOwnerTokens = [
                      ...currentUserIds,
                      currentUser?.name,
                      currentUser?.email
                    ].filter(Boolean).map((value) => String(value).trim().toLowerCase());
                    const serviceOwnerTokens = [
                      matchingService.createdByCrmUserId,
                      matchingService.createdByName,
                      matchingService.createdByEmail
                    ].filter(Boolean).map((value) => String(value).trim().toLowerCase());
                    const leadOwnerTokens = [
                      selectedSearchLead?.createdBy?._id,
                      selectedSearchLead?.createdBy?.name,
                      selectedSearchLead?.createdBy?.email,
                      selectedSearchLead?.createdByCrmUserId,
                      selectedSearchLead?.createdByName,
                      selectedSearchLead?.createdByEmail,
                      selectedSearchLead?.importedCreatedBy
                    ].filter(Boolean).map((value) => String(value).trim().toLowerCase());
                    const effectiveOwnerTokens = serviceOwnerTokens.length ? serviceOwnerTokens : leadOwnerTokens;
                    const ownsService = effectiveOwnerTokens.some((token) => currentUserOwnerTokens.includes(token));
                    const rowFrozen = serviceOnlyMode && index < frozenAssignmentRowCount && !ownsService;
                    const leadClosed = Boolean(row.closedBy);
                    const managerAssignmentReady = leadClosed || (String(row.poApprovalStatus || '').toUpperCase() === 'APPROVED' && Boolean(row.closureRequestedBy));
                    const canAssignStaff = String(currentUser?.role || '').toLowerCase() === 'manager' && currentUserIds.includes(String(row.assignedTo || ''));
                    const assignedManagerOptions = row.assignedTo && !managerOptions.some((option) => String(option.value) === String(row.assignedTo))
                      ? [{ value: String(row.assignedTo), label: row.assignedToText || lead.assignedToText || 'Previously assigned manager' }, ...managerOptions]
                      : managerOptions;
                    const intendedCloser = currentUser;
                    const intendedCloserIds = [intendedCloser?._id, intendedCloser?.id, intendedCloser?.crmUserId, intendedCloser?.userId].filter(Boolean);
                    const intendedCloserOption = intendedCloserIds.length ? [{
                      value: String(intendedCloserIds[0]),
                      label: `${intendedCloser?.name || intendedCloser?.email}${intendedCloser?.team ? ` (${intendedCloser.team})` : ' (No team assigned)'}`
                    }] : [];
                    const closedByOptions = row.closedBy && !intendedCloserIds.some((id) => String(id) === String(row.closedBy))
                      ? [{ value: String(row.closedBy), label: row.closedByText || lead.closedByText || 'Previously selected user' }, ...intendedCloserOption]
                      : intendedCloserOption;
                    const assignedStaffOptions = row.assignedStaff && !staffOptions.some((option) => String(option.value) === String(row.assignedStaff))
                      ? [{ value: String(row.assignedStaff), label: row.assignedStaffText || 'Previously assigned staff' }, ...staffOptions]
                      : staffOptions;
                    return <div className="lead-assign-row" key={index}>
                    <span className="lead-service-row-number" title={serviceRows[index]?.plantUnit || ''}>{index + 1}<small className="block text-[8px] text-teal-700">{serviceRows[index]?.plantUnit || ''}</small></span>
                    <div className="form-input flex min-h-11 items-center bg-slate-50 font-black text-slate-700">{matchingService.industryType || '-'}</div>
                    <div className="form-input flex min-h-11 items-center bg-slate-50 font-black text-slate-700">{matchingService.businessCategory || '-'}</div>
                    <div className="form-input flex min-h-11 items-center bg-slate-50 font-black text-slate-700">{matchingService.eprCategory || '-'}</div>
                    <div className="form-input flex min-h-11 items-center bg-violet-50 font-black text-violet-800">{/plastic\s+waste/i.test(String(matchingService.eprCategory || '')) ? (matchingService.piboCategory || '-') : (matchingService.applicantType || '-')}</div>
                    <div className="form-input flex min-h-11 items-center bg-slate-50 font-black text-slate-700">{matchingService.servicesOffered || '-'}</div>
                    <div className="flex items-center gap-2"><div className="min-w-0 flex-1"><SearchableSelect disabled={rowFrozen} value={row.closedBy} options={closedByOptions} placeholder="Select user who closed the lead" onChange={(value) => requestLeadClosure(index, value)} /></div>{row.poStatus === 'provisional' && <button type="button" onClick={() => requestLeadClosure(index, row.closedBy)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700" title="Review provisional closure and upload PO"><RefreshCw className="h-4 w-4" /></button>}</div>
                    <SearchableSelect disabled={rowFrozen || !managerAssignmentReady} value={row.assignedTo} options={assignedManagerOptions} placeholder={managerAssignmentReady ? 'Select manager to close service' : 'PO approval required'} onChange={(value) => updateAssignmentRow(index, 'assignedTo', value)} />
                    <SearchableSelect disabled={!canAssignStaff} value={row.assignedStaff} options={assignedStaffOptions} placeholder={canAssignStaff ? 'Select staff member' : 'Assigned manager only'} onChange={(value) => requestStaffAssignment(index, value)} />
                    <div className="flex justify-center">
                      {approvedRoyalty && index === royaltyClaimRowIndex ? (
                        <span className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">
                          Original {approvedRoyalty.payload?.originalCreatorRatio}% · Claimant {approvedRoyalty.payload?.claimantRatio}%
                        </span>
                      ) : canClaimRoyalty && index === royaltyClaimRowIndex ? (
                        <button type="button" disabled={royaltyClaiming || royaltyClaimed} onClick={claimRoyalty} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-amber-500 px-4 text-xs font-black text-white shadow-sm disabled:opacity-60">
                          <BadgeIndianRupee className="h-4 w-4" />{royaltyClaimed ? 'Claim Sent' : royaltyClaiming ? 'Sending...' : 'Claim Royalty'}
                        </button>
                      ) : <span className="text-xs font-bold text-slate-400">Not applicable</span>}
                    </div>
                    <button type="button" disabled={rowFrozen || assignmentRows.length === 1} onClick={() => removeAssignmentRow(index)} className="lead-matrix-remove"><X className="h-4 w-4" /></button>
                  </div>})}
                </div>
              </fieldset>
            )}

            <div className="mt-8 flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setViewMode('list')} className="btn-lift min-h-11 rounded-xl border border-slate-200 px-8 font-black text-slate-700">Cancel</button>
              <button type="button" disabled={saving || ownershipRequired} onClick={() => saveLead('draft')} className="btn-lift min-h-11 rounded-xl border border-orange-200 px-8 font-black text-orange-600 hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-50">Save Draft</button>
              {activeTab === 'assign' ? (
                <button type="button" disabled={saving} onClick={requestLeadSubmit} className="btn-lift min-h-11 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-8 font-black text-white shadow-lg shadow-orange-600/20">Submit</button>
              ) : (
                <button type="button" disabled={ownershipRequired} onClick={nextTab} className="btn-lift min-h-11 rounded-xl bg-gradient-to-r from-emerald-700 to-teal-700 px-8 font-black text-white shadow-lg shadow-emerald-700/20 disabled:cursor-not-allowed disabled:opacity-50">Next Step</button>
              )}
            </div>
          </section>
        </div>
      </div>
      {generatedForOpen && (
        <div className="lead-duplicate-modal-overlay" style={{ zIndex: 10000 }} role="dialog" aria-modal="true" aria-labelledby="generated-for-title">
          <section className="lead-duplicate-modal">
            <header><div><p>Lead ownership · Required</p><h2 id="generated-for-title">Who should this lead be generated for?</h2><span>Select one option before continuing. The selected user receives the lead credit.</span></div></header>
            <div className="p-6">
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => { setGeneratedForMode('self'); setGeneratedForUserId(''); }} className={`lead-duplicate-choice ${generatedForMode === 'self' ? 'yes' : ''}`}><UserCheck className="h-6 w-6" /><span><b>Yourself</b><small>Generate under your name</small></span></button>
                <button type="button" onClick={() => setGeneratedForMode('other')} className={`lead-duplicate-choice ${generatedForMode === 'other' ? 'yes' : ''}`}><UsersRound className="h-6 w-6" /><span><b>Other User</b><small>Select the actual lead owner</small></span></button>
              </div>
              {generatedForMode === 'other' && <div className="mt-5"><Field label="Select User" required><SearchableSelect value={generatedForUserId} options={generatedForOptions} onChange={setGeneratedForUserId} placeholder="Search and select user" /></Field></div>}
              <div className="mt-6 flex items-center justify-between gap-3"><p className="text-xs font-bold text-slate-500">Selection is mandatory to continue.</p><button type="button" disabled={!generatedForMode || (generatedForMode === 'other' && !generatedForUserId)} onClick={confirmGeneratedFor} className="min-h-11 rounded-xl bg-emerald-700 px-6 font-black text-white disabled:cursor-not-allowed disabled:opacity-40">Continue</button></div>
            </div>
          </section>
        </div>
      )}
      {duplicateDecisionOpen && selectedSearchLead && (
        <div className="lead-duplicate-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="duplicate-lead-title">
          <section className="lead-duplicate-modal">
            <header><div><p>Existing lead found</p><h2 id="duplicate-lead-title">{selectedSearchLead.company}</h2><span>{displayLeadId(selectedSearchLead)} · Generated by {leadOwnerLabel(selectedSearchLead)}</span></div><button type="button" onClick={() => setDuplicateDecisionOpen(false)}><X className="h-5 w-5" /></button></header>
            {!duplicateApprovalMode ? (
              <div className="p-6">
                <div className="lead-duplicate-question"><CircleAlert className="h-6 w-6" /><div><strong>The lead has already been generated under this company name.</strong><p>Do you want to generate a completely new lead? A blank form will open and duplicate validation will run again before save.</p></div></div>
                {!duplicateNoOptions ? <div className="mt-5 grid grid-cols-2 gap-3">
                  <button type="button" onClick={continueWithDuplicateTemplate} className="lead-duplicate-choice yes"><Check className="h-6 w-6" /><span><b>Yes</b><small>Open blank new lead</small></span></button>
                  <button type="button" onClick={() => setDuplicateNoOptions(true)} className="lead-duplicate-choice no"><X className="h-6 w-6" /><span><b>No</b><small>Show available actions</small></span></button>
                </div> : <div className="mt-5 grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => setDuplicateApprovalMode(true)} className="lead-duplicate-choice no"><CircleAlert className="h-6 w-6" /><span><b>Special Approval</b><small>Request duplicate permission</small></span></button>
                  <button type="button" onClick={openAddServicesMode} className="lead-duplicate-choice yes"><Plus className="h-6 w-6" /><span><b>Add Services</b><small>Edit only service configuration</small></span></button>
                </div>}
              </div>
            ) : (
              <div className="p-6">
                <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-widest text-orange-600">Special Approval</p><h3 className="mt-1 text-lg font-black">Request duplicate lead permission</h3></div><button type="button" onClick={() => setDuplicateApprovalMode(false)} className="text-xs font-black text-slate-500">Back</button></div>
                <div className="mt-5 grid gap-4">
                  <Field label="Reason" required><textarea className="form-input min-h-[105px] resize-y py-3" value={duplicateApproval.reason} onChange={(event) => setDuplicateApproval((current) => ({ ...current, reason: event.target.value }))} placeholder="Explain why another lead is required for this company..." /></Field>
                  <Field label="Email" required><input type="email" className="form-input" value={duplicateApproval.requesterEmail} onChange={(event) => setDuplicateApproval((current) => ({ ...current, requesterEmail: event.target.value }))} /></Field>
                  <Field label="Screenshot / Evidence">
                    <label className="lead-approval-upload"><Upload className="h-4 w-4" />{duplicateApproval.screenshotName || 'Upload screenshot'}<input type="file" accept="image/*,.pdf" className="sr-only" onChange={uploadDuplicateApprovalScreenshot} /></label>
                  </Field>
                </div>
                <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={() => setDuplicateDecisionOpen(false)} className="min-h-11 rounded-xl border border-slate-200 px-5 font-black">Continue Search</button><button type="button" disabled={duplicateApprovalSaving} onClick={sendDuplicateApprovalRequest} className="min-h-11 rounded-xl bg-orange-600 px-5 font-black text-white disabled:opacity-60">{duplicateApprovalSaving ? 'Sending...' : 'Send to Admin / Super Admin'}</button></div>
              </div>
            )}
          </section>
        </div>
      )}
      {renderClosureDialog()}
      {catalogDialog && (
        <div className="fixed inset-0 z-[115] grid place-items-center bg-slate-950/50 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="catalog-title">
          <section className="w-full max-w-lg overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-2xl shadow-slate-950/25">
            <header className="flex items-start justify-between gap-4 bg-gradient-to-r from-emerald-50 to-cyan-50 px-6 py-5">
              <div><p className="text-xs font-black uppercase tracking-[.18em] text-emerald-700">Admin Service Catalog</p><h2 id="catalog-title" className="mt-1 text-xl font-black text-slate-950">{catalogDialog.type === 'category' ? 'Please add Service Category' : 'Please enter Services Offered'}</h2>{catalogDialog.type === 'service' && <p className="mt-1 text-sm font-bold text-slate-500">For {catalogDialog.category}</p>}</div>
              <button type="button" onClick={() => setCatalogDialog(null)} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500" aria-label="Close"><X className="h-5 w-5" /></button>
            </header>
            <div className="p-6">
              {catalogDialog.type === 'category' ? <Field label="Service Category" required><input autoFocus className="form-input" value={catalogValue} onChange={(event) => setCatalogValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitCatalogDialog(); } }} placeholder="e.g. EPR - Plastic Waste" /></Field> : <div>
                <div className="flex items-center justify-between gap-3"><label className="text-sm font-black text-slate-700">Services Offered <span className="text-red-500">*</span></label><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700">{catalogServices.length} {catalogServices.length === 1 ? 'service' : 'services'}</span></div>
                <div className="mt-2 grid max-h-[300px] gap-2.5 overflow-y-auto pr-1">{catalogServices.map((service, index) => <div key={index} className="flex items-center gap-2"><span className="grid h-10 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-black text-slate-500">{index + 1}</span><input autoFocus={index === 0} className="form-input min-w-0 flex-1" value={service} onChange={(event) => setCatalogServices((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (service.trim()) setCatalogServices((current) => [...current, '']); } }} placeholder={`Service offered for ${catalogDialog.category}`} />{catalogServices.length > 1 && <button type="button" onClick={() => setCatalogServices((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-red-100 text-red-500 hover:bg-red-50" aria-label={`Remove service ${index + 1}`}><X className="h-4 w-4" /></button>}</div>)}</div>
                <button type="button" onClick={() => setCatalogServices((current) => [...current, ''])} disabled={!catalogServices.at(-1)?.trim()} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-dashed border-emerald-300 bg-emerald-50 px-4 text-xs font-black text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"><Plus className="h-4 w-4" />Add Another Service</button>
              </div>}
              {catalogDialog.afterCategory && <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">Service Category saved. Add its first Services Offered value to complete the mapping.</p>}
              <div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => setCatalogDialog(null)} className="min-h-11 rounded-xl border border-slate-200 px-5 font-black text-slate-700">Cancel</button><button type="button" onClick={submitCatalogDialog} disabled={(catalogDialog.type === 'category' ? !catalogValue.trim() : !catalogServices.some((service) => service.trim())) || catalogSaving} className="min-h-11 rounded-xl bg-emerald-700 px-6 font-black text-white disabled:opacity-50">{catalogSaving ? 'Saving...' : `Save${catalogDialog.type === 'service' && catalogServices.filter((service) => service.trim()).length > 1 ? ` ${catalogServices.filter((service) => service.trim()).length} Services` : ''}`}</button></div>
            </div>
          </section>
        </div>
      )}
      {kickoffDialog && (
        <div className="fixed inset-0 z-[130] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="kickoff-email-title">
          <section className="w-full max-w-lg overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-2xl">
            <div className="p-7 sm:p-8">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><Mail className="h-7 w-7" /></span>
              <p className="mt-5 text-xs font-black uppercase tracking-[.18em] text-emerald-700">Kick-Off Communication</p>
              <h2 id="kickoff-email-title" className="mt-2 text-2xl font-black text-slate-950">Send the kick-off email?</h2>
              <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">You are assigning this lead to a staff member. Would you also like to send the client a virtual kick-off meeting email when this assignment is submitted?</p>
              <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm font-bold leading-6 text-blue-900">Choose <strong>Yes</strong> to assign the staff member and enable the kick-off email. Choose <strong>No</strong> to assign the staff member without sending the email.</div>
            </div>
            <div className="flex flex-col-reverse gap-3 border-t border-slate-100 bg-slate-50/70 p-5 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => confirmKickoffEmail(false)} className="min-h-12 rounded-xl border border-slate-200 bg-white px-5 text-sm font-black text-slate-700 hover:bg-slate-100">No, Continue Without Email</button>
              <button type="button" onClick={() => confirmKickoffEmail(true)} className="min-h-12 rounded-xl bg-emerald-700 px-5 text-sm font-black text-white shadow-lg shadow-emerald-200 hover:bg-emerald-800">Yes, Send Kick-Off Email</button>
            </div>
          </section>
        </div>
      )}
      {dropdownDialog && (
        <div className="fixed inset-0 z-[116] grid place-items-center bg-slate-950/55 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="dropdown-option-title">
          <section className="w-full max-w-lg overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-2xl shadow-slate-950/25">
            <header className="flex items-start justify-between gap-4 bg-gradient-to-r from-emerald-50 via-white to-cyan-50 px-6 py-5">
              <div><p className="text-xs font-black uppercase tracking-[.18em] text-emerald-700">Admin Dropdown Manager</p><h2 id="dropdown-option-title" className="mt-1 text-xl font-black text-slate-950">Add {dropdownDialog.label}</h2><p className="mt-1 text-sm font-bold text-slate-500">Create a new option for the {dropdownDialog.label} dropdown.</p></div>
              <button type="button" onClick={() => setDropdownDialog(null)} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50" aria-label="Close"><X className="h-5 w-5" /></button>
            </header>
            <div className="p-6">
              <Field label={dropdownDialog.label} required><input autoFocus className="form-input" value={dropdownValue} maxLength={120} onChange={(event) => setDropdownValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitDropdownDialog(); } }} placeholder={`Enter new ${dropdownDialog.label}`} /></Field>
              <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-bold leading-5 text-emerald-800">After saving, this value will be available in the dropdown for every CRM user and selected automatically in this row.</div>
              <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setDropdownDialog(null)} className="min-h-11 rounded-xl border border-slate-200 px-5 font-black text-slate-700 hover:bg-slate-50">Cancel</button><button type="button" onClick={submitDropdownDialog} disabled={!dropdownValue.trim() || dropdownSaving} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-6 font-black text-white shadow-lg shadow-emerald-700/20 disabled:cursor-not-allowed disabled:opacity-50">{dropdownSaving ? 'Saving...' : <><Plus className="h-4 w-4" />Save {dropdownDialog.label}</>}</button></div>
            </div>
          </section>
        </div>
      )}
      {specifyDialog && (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-slate-950/50 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="specify-title">
          <section className="w-full max-w-lg overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-2xl shadow-slate-950/25">
            <header className="flex items-start justify-between gap-4 bg-gradient-to-r from-emerald-50 to-cyan-50 px-6 py-5">
              <div><p className="text-xs font-black uppercase tracking-[.18em] text-emerald-700">{Number.isInteger(specifyDialog.categoryRow) ? 'Admin Dropdown Manager' : 'Additional details'}</p><h2 id="specify-title" className="mt-1 text-xl font-black text-slate-950">{Number.isInteger(specifyDialog.categoryRow) ? 'Add Sub Applicant Type' : 'Please Specify'}</h2><p className="mt-1 text-sm font-bold text-slate-500">{Number.isInteger(specifyDialog.categoryRow) ? `Create a new option under ${specifyDialog.applicantType}.` : `${specifyDialog.label}${specifyDialog.value ? `: ${specifyDialog.value}` : ''}`}</p></div>
              <button type="button" onClick={() => setSpecifyDialog(null)} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50" aria-label="Close"><X className="h-5 w-5" /></button>
            </header>
            <div className="p-6">
              <label className="block text-sm font-black text-slate-700">{Number.isInteger(specifyDialog.categoryRow) ? 'Sub Applicant Type' : 'Note'} <span className="text-red-500">*</span>
                <textarea autoFocus value={specifyNote} onChange={(event) => setSpecifyNote(event.target.value)} className="form-input mt-2 min-h-[120px] resize-y py-3" placeholder={Number.isInteger(specifyDialog.categoryRow) ? `Enter new ${specifyDialog.applicantType} category` : 'Add relevant details or remarks...'} />
              </label>
              <div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => setSpecifyDialog(null)} className="min-h-11 rounded-xl border border-slate-200 px-5 font-black text-slate-700 hover:bg-slate-50">Cancel</button><button type="button" onClick={submitSpecification} disabled={!specifyNote.trim()} className="min-h-11 rounded-xl bg-emerald-700 px-6 font-black text-white shadow-lg shadow-emerald-700/20 disabled:cursor-not-allowed disabled:opacity-50">Submit</button></div>
            </div>
          </section>
        </div>
      )}
      {introductionPromptOpen && (
        <div className="fixed inset-0 z-[145] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="introduction-email-title">
          <section className="w-full max-w-lg overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-2xl">
            <div className="p-7 sm:p-8"><span className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-[#0f5d46]"><Mail className="h-7 w-7" /></span><p className="mt-5 text-xs font-black uppercase tracking-[.18em] text-[#0f5d46]">Client Communication</p><h2 id="introduction-email-title" className="mt-2 text-2xl font-black text-slate-950">Send Introduction Email?</h2><p className="mt-3 text-sm font-semibold leading-6 text-slate-600">Would you like to send the AnantTattva introduction email to the client with this lead submission?</p><div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-bold leading-6 text-emerald-900">Choose <strong>Yes</strong> to submit the lead and send the introduction email. Choose <strong>No</strong> to submit without sending it.</div></div>
            <div className="flex flex-col-reverse gap-3 border-t bg-slate-50/70 p-5 sm:flex-row sm:justify-end"><button type="button" onClick={() => { setIntroductionConsent(false); setIntroductionPromptOpen(false); setHealthPromptOpen(true); }} className="min-h-12 rounded-xl border border-slate-200 bg-white px-5 text-sm font-black text-slate-700">No, Submit Without Email</button><button type="button" onClick={() => { setIntroductionConsent(true); setIntroductionPromptOpen(false); setHealthPromptOpen(true); }} className="min-h-12 rounded-xl bg-[#0f5d46] px-5 text-sm font-black text-white shadow-lg">Yes, Send Introduction Email</button></div>
          </section>
        </div>
      )}
      {healthPromptOpen && (
        <ComplianceHealthPrompt
          saving={saving}
          onCancel={() => setHealthPromptOpen(false)}
          onSubmitLeadOnly={() => saveLead('submitted')}
          onContinue={() => saveLead('submitted', { openHealthReport: true })}
        />
      )}
      {healthAssignmentOpen && (
        <div className="fixed inset-0 z-[130] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="health-manager-title">
          <section className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <p className="text-xs font-black uppercase tracking-[.2em] text-orange-500">Compliance Health Report Allocation</p><h2 id="health-manager-title" className="mt-2 text-2xl font-black">Please select Manager</h2>
            <p className="mt-2 text-sm font-semibold text-slate-500">The selected Manager will receive an email and must assign a CRM user before work begins.</p>
            <div className="mt-5"><SearchableSelect value={healthManagerId} onChange={setHealthManagerId} options={staff.filter((user) => String(user.role || '').toLowerCase() === 'manager' && user.isActive !== false).map((user) => ({ value: user._id || user.id, label: `${user.name || user.email} (Manager)` }))} placeholder="Please select Manager" /></div>
            {healthReportError && <p className="mt-3 text-sm font-bold text-red-600">{healthReportError}</p>}
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setHealthAssignmentOpen(false)} className="h-11 rounded-xl border px-5 font-black">Cancel</button><button type="button" disabled={!healthManagerId || healthReportSaving} onClick={assignHealthReportManager} className="h-11 rounded-xl bg-emerald-700 px-6 font-black text-white disabled:opacity-50">{healthReportSaving ? 'Assigning...' : 'Submit to Manager'}</button></div>
          </section>
        </div>
      )}
      {healthReportLead && !healthAssignmentOpen && (
        <ComplianceHealthAllocationModal
          lead={healthReportLead}
          report={healthReport}
          saving={healthReportSaving}
          error={healthReportError}
          onChange={updateHealthReport}
          onSubmit={submitHealthReport}
        />
      )}
      {profileOpen && <ProfileModal user={currentUser} saving={false} onClose={() => setProfileOpen(false)} onLogout={handleLogout} onSave={() => {}} onUpdatePassword={() => {}} />}
    </DashboardShell>
  );
}

function ComplianceHealthAllocationModal({ lead, report, saving, error, onChange, onSubmit }) {
  const fields = [
    ['otpMobile', 'Mobile Number for OTP'],
    ['cpcbLoginId', 'CPCB Login ID'],
    ['cpcbPassword', 'CPCB Password'],
    ['ssoCpcbLoginId', 'SSO CPCB Login ID'],
    ['ssoCpcbPassword', 'SSO CPCB Password']
  ];
  return (
    <div className="fixed inset-0 z-[95] overflow-y-auto bg-slate-950/50 px-4 py-8 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="health-allocation-title">
      <section className="mx-auto w-full max-w-2xl rounded-3xl border border-emerald-100 bg-white p-6 shadow-2xl shadow-slate-950/20 sm:p-8">
        <header className="border-b border-slate-100 pb-5">
          <p className="text-xs font-black uppercase tracking-[.2em] text-orange-600">New Allocation</p>
          <h2 id="health-allocation-title" className="mt-2 text-2xl font-black text-slate-950">COMPLIANCE HEALTH REPORT ALLOCATION</h2>
          <p className="mt-2 text-sm font-semibold text-slate-500">Enter the portal credentials below. The company is automatically fetched from the submitted lead.</p>
        </header>
        {error && <ToastMessage type="error" className="mt-5">{error}</ToastMessage>}
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field label="Company Name"><input className="form-input bg-slate-50 font-bold text-slate-700" value={lead.company || ''} readOnly /></Field>
          {fields.map(([field, label]) => (
            <Field key={field} label={label}>
              <input
                className="form-input"
                type={field.toLowerCase().includes('password') ? 'password' : 'text'}
                inputMode={field === 'otpMobile' ? 'numeric' : undefined}
                maxLength={field === 'otpMobile' ? 10 : undefined}
                value={report[field] || ''}
                onChange={(event) => onChange(field, field === 'otpMobile' ? event.target.value.replace(/\D/g, '').slice(0, 10) : event.target.value)}
              />
            </Field>
          ))}
        </div>
        <footer className="mt-7 flex justify-end border-t border-slate-100 pt-5">
          <button type="button" disabled={saving} onClick={() => onSubmit({ allocation: true })} className="min-h-11 rounded-xl bg-emerald-700 px-7 font-black text-white shadow-lg shadow-emerald-700/20 disabled:cursor-not-allowed disabled:opacity-60">{saving ? 'Saving Allocation...' : 'Submit Allocation'}</button>
        </footer>
      </section>
    </div>
  );
}

function LeadSection({ title, children, columns = 'sm:grid-cols-2 xl:grid-cols-3' }) {
  return (
    <section>
      <h2 className="text-2xl font-black text-slate-950">{title}</h2>
      <div className={`mt-5 grid gap-5 ${columns}`}>{children}</div>
    </section>
  );
}

function ComplianceHealthPrompt({ saving, onCancel, onSubmitLeadOnly, onContinue }) {
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/45 px-4 backdrop-blur-sm">
      <section className="w-full max-w-xl rounded-2xl border border-orange-100 bg-white p-6 shadow-2xl shadow-slate-950/20">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-600">Final Submit</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">COMPLIANCE HEALTH REPORT ALLOCATION</h2>
            <p className="mt-3 text-sm font-bold leading-6 text-slate-600">Do you want to create a COMPLIANCE HEALTH REPORT ALLOCATION?</p>
          </div>
          <button type="button" onClick={onCancel} disabled={saving} className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" title="Cancel">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={saving} className="min-h-11 rounded-xl border border-slate-200 px-5 font-black text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={onSubmitLeadOnly} disabled={saving} className="min-h-11 rounded-xl border border-orange-200 px-5 font-black text-orange-600 hover:bg-orange-50">{saving ? 'Submitting...' : 'No, Submit Lead Only'}</button>
          <button type="button" onClick={onContinue} disabled={saving} className="min-h-11 rounded-xl bg-orange-600 px-5 font-black text-white shadow-lg shadow-orange-600/20">{saving ? 'Submitting...' : 'Yes, Continue'}</button>
        </div>
      </section>
    </div>
  );
}

function ComplianceHealthReportModal({ lead, report, saving, error, onChange, onSubmit, pageMode = false, loading = false, onBack }) {
  const [annualReturnExpanded, setAnnualReturnExpanded] = useState(false);
  const [checklistExpanded, setChecklistExpanded] = useState(false);
  const [keyProductsOpen, setKeyProductsOpen] = useState(false);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [submitConfirmed, setSubmitConfirmed] = useState(false);
  const overviewFields = [
    ['otpMobile', 'Mobile Number for OTP'],
    ['cpcbLoginId', 'CPCB Login ID'],
    ['cpcbPassword', 'CPCB Password'],
    ['ssoCpcbLoginId', 'SSO CPCB Login ID'],
    ['ssoCpcbPassword', 'SSO CPCB Password'],
    ['yearOfCommencement', 'Year Of Commencement'],
    ['establishmentDate', 'Establishment Date'],
    ['organizationType', 'Organization Type'],
    ['keyProductsBrands', 'Key Products / Brands'],
    ['productCategory', 'Product Category'],
    ['eprRegistrationNumber', 'EPR Registration Number'],
    ['financialYearReviewed', 'Financial Year Reviewed']
  ];
  const parseEditableRows = (value) => String(value || '').length ? String(value || '').split('\n') : [];
  const countFilledRows = (rows) => rows.filter((row) => String(row || '').trim()).length;
  const observationLines = parseEditableRows(report.keyObservations);
  const annualReturnLines = parseEditableRows(report.annualReturnObservations);
  const checklistItems = Array.isArray(report.checklistItems) ? report.checklistItems : [];
  const conclusionNotes = Array.isArray(report.conclusionNotes) && report.conclusionNotes.length
    ? report.conclusionNotes
    : [{ conclusion: '', recommendation: '' }];
  const checklistGroups = useMemo(() => {
    const groups = [];
    const headings = new Set(['PART A', 'PART B', 'PART C', 'PART D', 'Authorized Person Details', 'Operational & Production', 'Documents Uploaded on Portal']);
    let current = { title: 'General', items: [] };
    checklistItems.forEach((item, index) => {
      if (headings.has(item.requirement)) {
        if (current.items.length) groups.push(current);
        current = { title: item.requirement, items: [] };
      } else {
        current.items.push({ ...item, sourceIndex: index });
      }
    });
    if (current.items.length) groups.push(current);
    return groups;
  }, [checklistItems]);

  useEffect(() => {
    if (!submitConfirmOpen) return undefined;
    function closeOnEscape(event) {
      if (event.key === 'Escape' && !saving) setSubmitConfirmOpen(false);
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [submitConfirmOpen, saving]);

  function updateListField(field, nextLines) {
    onChange(field, nextLines.join('\n'));
  }

  function addListRow(field) {
    const current = parseEditableRows(report[field]);
    current.push(' ');
    onChange(field, current.join('\n'));
  }

  function removeListRow(field, index) {
    const current = parseEditableRows(report[field]);
    current.splice(index, 1);
    onChange(field, current.join('\n'));
    if (field === 'keyObservations') {
      const details = Array.isArray(report.keyObservationDetails) ? [...report.keyObservationDetails] : [];
      details.splice(index, 1);
      onChange('keyObservationDetails', details);
    } else if (field === 'annualReturnObservations') {
      const details = Array.isArray(report.annualReturnDetails) ? [...report.annualReturnDetails] : [];
      details.splice(index, 1);
      onChange('annualReturnDetails', details);
    }
  }

  function updateKeyObservationDetail(index, field, value) {
    const details = Array.isArray(report.keyObservationDetails) ? [...report.keyObservationDetails] : [];
    details[index] = { ...(details[index] || {}), [field]: value };
    onChange('keyObservationDetails', details);
  }

  function updateChecklistItem(index, field, value) {
    const next = [...checklistItems];
    next[index] = { ...(next[index] || {}), [field]: value };
    onChange('checklistItems', next);
  }

  function updateAnnualReturnDetail(index, field, value) {
    const next = Array.isArray(report.annualReturnDetails) ? [...report.annualReturnDetails] : [];
    next[index] = { ...(next[index] || {}), [field]: value };
    onChange('annualReturnDetails', next);
  }

  function updateConclusionNote(index, field, value) {
    const next = [...conclusionNotes];
    next[index] = { ...(next[index] || {}), [field]: value };
    onChange('conclusionNotes', next);
    onChange(field === 'conclusion' ? 'conclusion' : 'recommendations', next.map((item) => item[field]).filter(Boolean).join('\n'));
  }

  function handleDownloadPdf() {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const lines = [
      'COMPLIANCE HEALTH REPORT',
      `Lead: ${lead.company || '-'}`,
      `Lead Code: ${lead.leadCode || '-'}`,
      '',
      `Year of Commencement: ${report.yearOfCommencement || '-'}`,
      `Establishment Date: ${report.establishmentDate || '-'}`,
      `Organization Type: ${report.organizationType || '-'}`,
      `Key Products / Brands: ${report.keyProductsBrands || '-'}`,
      `Product Category: ${report.productCategory || '-'}`,
      `EPR Registration Number: ${report.eprRegistrationNumber || '-'}`,
      `Financial Year Reviewed: ${report.financialYearReviewed || '-'}`,
      '',
      'Objective Review:',
      report.objectiveReview || '-',
      '',
      'Key Observations:',
      ...toPdfLines(report.keyObservations),
      '',
      'Annual Return Observations:',
      ...toPdfLines(report.annualReturnObservations),
      '',
      'Checklist Review:',
      ...toPdfLines(report.checklistReview),
      '',
      'Conclusion:',
      report.conclusion || '-',
      '',
      'Recommendations:',
      report.recommendations || '-',
      '',
      'Screenshot References:',
      ...toPdfLines(report.screenshotReferences)
    ];

    let cursorY = 48;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(lines[0], 40, cursorY);
    cursorY += 26;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    for (const line of lines.slice(1)) {
      if (cursorY > 760) {
        doc.addPage();
        cursorY = 48;
      }
      doc.text(String(line || '-'), 40, cursorY);
      cursorY += 15;
    }
    doc.save(`${String(lead.company || 'compliance-health-report').replace(/\s+/g, '-').toLowerCase()}.pdf`);
  }

  async function handleEvidenceUpload(type, event, observationIndex = null, detailField = 'keyObservationDetails') {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    try {
      const uploadedFiles = await Promise.all(files.map(async (file) => {
        const uploaded = await uploadMedia(file, type === 'screenshot' ? 'crm/leads/compliance-health/screenshots' : 'crm/leads/compliance-health/shared-folder');
        return { label: file.webkitRelativePath || file.name, url: uploaded.secureUrl, publicId: uploaded.publicId, source: type, uploadedAt: new Date().toISOString() };
      }));
      const nextUploads = [...(Array.isArray(report.sharedFolderUploads) ? report.sharedFolderUploads : []), ...uploadedFiles];
      onChange('sharedFolderUploads', nextUploads);
      if (observationIndex !== null) {
        const details = Array.isArray(report[detailField]) ? [...report[detailField]] : [];
        details[observationIndex] = {
          ...(details[observationIndex] || {}),
          evidence: [...(Array.isArray(details[observationIndex]?.evidence) ? details[observationIndex].evidence : []), ...uploadedFiles]
        };
        onChange(detailField, details);
      }
    } catch (err) {
      onChange('screenshotReferences', `${String(report.screenshotReferences || '').trim()}\nUpload failed: ${err.message || 'Unknown error'}`.trim());
    }
  }

  function removeUpload(uploadIndex) {
    const item = report.sharedFolderUploads?.[uploadIndex];
    onChange('sharedFolderUploads', report.sharedFolderUploads.filter((_, index) => index !== uploadIndex));
    if (item?.url) {
      onChange('keyObservationDetails', (report.keyObservationDetails || []).map((detail) => ({
        ...detail,
        evidence: (detail?.evidence || []).filter((evidence) => evidence.url !== item.url)
      })));
    }
  }

  function toPdfLines(value) {
    return String(value || '')
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const wrapperClass = pageMode
    ? 'compliance-health-page'
    : 'fixed inset-0 z-[95] overflow-y-auto bg-slate-950/50 px-4 py-8 backdrop-blur-sm';
  const panelClass = pageMode
    ? 'compliance-health-shell'
    : 'mx-auto w-full max-w-6xl rounded-2xl border border-emerald-100 bg-white p-6 shadow-2xl shadow-slate-950/20';

  return (
    <div className={wrapperClass}>
      <section className={panelClass}>
        <header className={`${pageMode ? 'compliance-health-page-hero' : 'flex flex-col gap-4 border-b border-slate-100 pb-5 md:flex-row md:items-start md:justify-between'}`}>
          <div>
            {pageMode && <button type="button" onClick={onBack} className="compliance-health-back" title="Back"><ArrowLeft className="h-5 w-5" /></button>}
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">{pageMode ? 'Compliance' : 'Saved Lead Context'}</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">COMPLIANCE HEALTH REPORT</h2>
            <p className="mt-2 text-sm font-bold text-slate-600">{loading ? 'Loading lead...' : (lead.company || '-')} {lead.leadCode ? `| ${lead.leadCode}` : ''}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <span className="rounded-full bg-emerald-50 px-4 py-2 text-xs font-black uppercase text-emerald-700">CRM Lead Document</span>
            <button type="button" onClick={handleDownloadPdf} className={`${pageMode ? 'compliance-health-download' : 'btn-lift inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 font-black text-slate-700 hover:bg-slate-50'}`}><Download className="h-4 w-4" />{pageMode ? 'Download Complete PDF' : 'Download PDF'}</button>
            {pageMode && (
              <div className="compliance-health-stats">
                <strong>7<span>Overview Fields</span></strong>
                <strong>{countFilledRows(observationLines) + countFilledRows(annualReturnLines)}<span>Observation Rows</span></strong>
                <strong>{checklistGroups.reduce((total, group) => total + group.items.length, 0)}<span>Checklist Items</span></strong>
                <strong>{Array.isArray(report.sharedFolderUploads) ? report.sharedFolderUploads.length : 0}<span>Screenshots</span></strong>
              </div>
            )}
          </div>
        </header>

        {pageMode && (
          <nav className="compliance-health-steps">
            {['1. Overview', '2. Objective', '3. Observations', '4. Evidence'].map((step) => <span key={step}><CheckCircle2 className="h-4 w-4" />{step}</span>)}
          </nav>
        )}

        {error && <ToastMessage type="error" className="mt-5">{error}</ToastMessage>}

        <div className="mt-6 grid gap-6">
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <h3 className="text-xl font-black text-slate-950">1. Company Overview</h3>
            <div className="mt-4 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {overviewFields.map(([field, label]) => (
                <Field key={field} label={label}>
                  {field === 'keyProductsBrands' ? (
                    <div className="compliance-products-select">
                      <button type="button" className={`form-input flex w-full items-center justify-between text-left ${keyProductsOpen ? 'border-emerald-400 ring-4 ring-emerald-100' : ''}`} onClick={() => setKeyProductsOpen((value) => !value)} aria-expanded={keyProductsOpen}>
                        {report.keyProductsBrands ? <span className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800"><CheckCircle2 className="h-4 w-4" />{report.keyProductsBrands}</span> : <span className="text-slate-400">Select an option</span>}
                        <ChevronDown className={`h-4 w-4 text-slate-400 transition ${keyProductsOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {keyProductsOpen && (
                        <div className="compliance-products-panel">
                          <button type="button" className="compliance-products-option" onClick={() => onChange('keyProductsBrands', 'Uploaded in shared folder')}>
                            <span>Uploaded in shared folder</span>
                            <span className={report.keyProductsBrands === 'Uploaded in shared folder' ? 'selected' : ''}>{report.keyProductsBrands === 'Uploaded in shared folder' && <Check className="h-3.5 w-3.5" />}</span>
                          </button>
                          {report.keyProductsBrands === 'Uploaded in shared folder' && (
                            <div className="compliance-shared-upload">
                              <div className="flex items-start justify-between gap-3"><div><strong>Shared folder upload</strong><p>Upload files or choose a full folder. Paths are saved with this report.</p></div><b>{report.sharedFolderUploads?.filter((item) => item.source === 'shared-folder').length || 0}<small>files</small></b></div>
                              <div className="mt-3 grid grid-cols-2 gap-2">
                                <label><Upload className="h-4 w-4" />Choose Files<input type="file" multiple className="sr-only" onChange={(event) => handleEvidenceUpload('shared-folder', event)} /></label>
                                <label className="primary"><Upload className="h-4 w-4" />Choose Folder<input type="file" multiple webkitdirectory="" directory="" className="sr-only" onChange={(event) => handleEvidenceUpload('shared-folder', event)} /></label>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <input
                      type={field === 'establishmentDate' ? 'date' : (field === 'yearOfCommencement' ? 'number' : (field.toLowerCase().includes('password') ? 'password' : 'text'))}
                      min={field === 'yearOfCommencement' ? '1800' : undefined}
                      max={field === 'yearOfCommencement' ? String(new Date().getFullYear()) : undefined}
                      className="form-input"
                      value={report[field] || ''}
                      onChange={(event) => onChange(field, event.target.value)}
                    />
                  )}
                </Field>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-xl font-black text-slate-950">2. Objective of Review</h3>
            <div className="mt-4">
              <textarea className="form-input min-h-[130px] resize-y py-3" value={report.objectiveReview || ''} onChange={(event) => onChange('objectiveReview', event.target.value)} />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xl font-black text-slate-950">3.1 Key Compliance Observations</h3>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">{observationLines.length} rows</span>
            </div>
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-[0.08em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-center">Sr. No.</th>
                    <th className="px-4 py-3 text-center">Area</th>
                    <th className="px-4 py-3 text-center">Observation</th>
                    <th className="px-4 py-3 text-center">Potential Risk</th>
                    <th className="px-4 py-3 text-center">Screenshot Reference</th>
                    <th className="px-4 py-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {observationLines.length ? observationLines.map((row, index) => (
                    <tr key={`${row}-${index}`} className="border-t border-slate-100">
                      <td className="px-3 py-5 text-center"><input className="form-input text-center" value={index + 1} readOnly /></td>
                      <td className="px-3 py-5"><input className="form-input text-center" value={row} onChange={(event) => { const next = [...observationLines]; next[index] = event.target.value; updateListField('keyObservations', next); }} /></td>
                      <td className="px-3 py-5"><input className="form-input" value={report.keyObservationDetails?.[index]?.observation || ''} onChange={(event) => updateKeyObservationDetail(index, 'observation', event.target.value)} /></td>
                      <td className="px-3 py-5"><input className="form-input" value={report.keyObservationDetails?.[index]?.potentialRisk || ''} onChange={(event) => updateKeyObservationDetail(index, 'potentialRisk', event.target.value)} /></td>
                      <td className="px-3 py-5">
                        <label className="compliance-health-file-button">
                          <Upload className="h-4 w-4" /> Choose Files
                          <input type="file" multiple accept="image/*,.pdf" className="sr-only" onChange={(event) => handleEvidenceUpload('screenshot', event, index)} />
                        </label>
                        <div className="compliance-health-file-name">
                          {report.keyObservationDetails?.[index]?.evidence?.length
                            ? `${report.keyObservationDetails[index].evidence.length} file(s) attached`
                            : 'No file selected'}
                        </div>
                      </td>
                      <td className="px-3 py-5 text-center"><button type="button" onClick={() => removeListRow('keyObservations', index)} className="compliance-health-delete" title="Remove row"><X className="h-4 w-4" /></button></td>
                    </tr>
                  )) : <tr><td colSpan={6} className="px-4 py-10 text-center font-black text-slate-400">No observations yet.</td></tr>}
                </tbody>
              </table>
              <div className="border-t border-slate-200 bg-white p-4">
                <button type="button" onClick={() => addListRow('keyObservations')} className="btn-lift inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-5 font-black text-white shadow-lg shadow-emerald-700/20"><Plus className="h-4 w-4" />Add Row</button>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <button type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setAnnualReturnExpanded((value) => !value)} aria-expanded={annualReturnExpanded}>
              <h3 className="text-xl font-black text-slate-950">3.2 Key Compliance Observations For Annual Return</h3>
              <span className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">{annualReturnLines.length} rows <ChevronDown className={`h-4 w-4 transition ${annualReturnExpanded ? 'rotate-180' : ''}`} /></span>
            </button>
            {annualReturnExpanded && <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-[0.08em] text-slate-500"><tr><th className="px-4 py-3 text-center">Sr. No.</th><th className="px-4 py-3 text-center">Area</th><th className="px-4 py-3 text-center">Observation</th><th className="px-4 py-3 text-center">Potential Risk</th><th className="px-4 py-3 text-center">Screenshot Reference</th><th className="px-4 py-3 text-center">Action</th></tr></thead>
                <tbody>{annualReturnLines.length ? annualReturnLines.map((row, index) => <tr key={`${row}-${index}`} className="border-t border-slate-100">
                  <td className="px-3 py-4"><input className="form-input text-center" value={index + 1} readOnly /></td>
                  <td className="px-3 py-4"><input className="form-input text-center" value={row} onChange={(event) => { const next = [...annualReturnLines]; next[index] = event.target.value; updateListField('annualReturnObservations', next); }} /></td>
                  <td className="px-3 py-4"><input className="form-input" value={report.annualReturnDetails?.[index]?.observation || ''} onChange={(event) => updateAnnualReturnDetail(index, 'observation', event.target.value)} /></td>
                  <td className="px-3 py-4"><input className="form-input" value={report.annualReturnDetails?.[index]?.potentialRisk || ''} onChange={(event) => updateAnnualReturnDetail(index, 'potentialRisk', event.target.value)} /></td>
                  <td className="px-3 py-4"><label className="compliance-health-file-button"><Upload className="h-4 w-4" />Choose Files<input type="file" multiple accept="image/*,.pdf" className="sr-only" onChange={(event) => handleEvidenceUpload('screenshot', event, index, 'annualReturnDetails')} /></label><div className="compliance-health-file-name">{report.annualReturnDetails?.[index]?.evidence?.length ? `${report.annualReturnDetails[index].evidence.length} file(s)` : 'No file selected'}</div></td>
                  <td className="px-3 py-4 text-center"><button type="button" onClick={() => removeListRow('annualReturnObservations', index)} className="compliance-health-delete"><X className="h-4 w-4" /></button></td>
                </tr>) : <tr><td colSpan={6} className="px-4 py-10 text-center font-black text-slate-400">No annual return observation yet.</td></tr>}</tbody>
              </table>
              <div className="border-t border-slate-200 bg-white p-4"><button type="button" onClick={() => addListRow('annualReturnObservations')} className="btn-lift inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-700 px-4 font-black text-white"><Plus className="h-4 w-4" />Add Row</button></div>
            </div>}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 compliance-checklist-card">
            <button type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setChecklistExpanded((value) => !value)} aria-expanded={checklistExpanded}>
              <h3 className="text-xl font-black text-slate-950">4. Compliance Checklist Review</h3>
              <span className="flex items-center gap-2 rounded-full bg-orange-50 px-3 py-1 text-xs font-black text-orange-700">{checklistGroups.reduce((total, group) => total + group.items.length, 0)} checks <ChevronDown className={`h-4 w-4 transition ${checklistExpanded ? 'rotate-180' : ''}`} /></span>
            </button>
            {checklistExpanded && <div className="compliance-checklist-scroll mt-4 overflow-auto rounded-2xl border border-slate-200">
              <div className="compliance-checklist-head"><span>Sr. No.</span><span>Compliance Requirement</span><span>Status</span><span>Remark</span></div>
              {checklistGroups.map((group) => (
                <div key={group.title}>
                  <div className="compliance-checklist-group"><strong>{group.title}</strong><span>{group.items.length} items</span></div>
                  {group.items.map((item) => {
                    const displayNumber = checklistItems.slice(0, item.sourceIndex + 1).filter((entry) => !new Set(['PART A', 'PART B', 'PART C', 'PART D', 'Authorized Person Details', 'Operational & Production', 'Documents Uploaded on Portal']).has(entry.requirement)).length;
                    return (
                      <div className="compliance-checklist-row" key={`${item.requirement}-${item.sourceIndex}`}>
                        <span className="compliance-checklist-number">{displayNumber}</span>
                        <strong>{item.requirement}</strong>
                        <select className="form-input" value={item.status || ''} onChange={(event) => updateChecklistItem(item.sourceIndex, 'status', event.target.value)}>
                          <option value="">Select</option>
                          <option value="Compliant">Compliant</option>
                          <option value="Non-Compliant">Non-Compliant</option>
                          <option value="Partial">Partial</option>
                          <option value="Not Applicable">Not Applicable</option>
                        </select>
                        <input className="form-input" placeholder="Add remark" value={item.remark || ''} onChange={(event) => updateChecklistItem(item.sourceIndex, 'remark', event.target.value)} />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 compliance-conclusion-card">
            <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[.18em] text-emerald-700">Final notes</p><h3 className="mt-1 text-xl font-black text-slate-950">Conclusion &amp; Next Steps</h3></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">{conclusionNotes.length} item(s)</span></div>
            <div className="mt-5 grid gap-4">
              {conclusionNotes.map((note, index) => (
                <div className="compliance-conclusion-row" key={index}>
                  <span>{index + 1}</span>
                  <textarea className="form-input min-h-[72px] resize-y py-3" placeholder="Enter conclusion" value={note.conclusion || ''} onChange={(event) => updateConclusionNote(index, 'conclusion', event.target.value)} />
                  <textarea className="form-input min-h-[72px] resize-y py-3" placeholder="Enter recommendations or next steps" value={note.recommendation || ''} onChange={(event) => updateConclusionNote(index, 'recommendation', event.target.value)} />
                  <button type="button" className="compliance-health-delete" title="Remove note" disabled={conclusionNotes.length === 1} onClick={() => onChange('conclusionNotes', conclusionNotes.filter((_, itemIndex) => itemIndex !== index))}><X className="h-4 w-4" /></button>
                </div>
              ))}
              <button type="button" className="compliance-add-note" onClick={() => onChange('conclusionNotes', [...conclusionNotes, { conclusion: '', recommendation: '' }])}><Plus className="h-4 w-4" /> Add Note</button>
            </div>
          </section>

        </div>

        <footer className="mt-8 flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-end">
          {pageMode && <button type="button" disabled={saving} onClick={onBack} className="min-h-11 rounded-xl border border-slate-200 px-7 font-black text-slate-700 hover:bg-slate-50">Back</button>}
          <button type="button" disabled={saving || loading || !(lead?._id || lead?.id)} onClick={() => { setSubmitConfirmed(false); setSubmitConfirmOpen(true); }} className="min-h-11 rounded-xl bg-orange-600 px-7 font-black text-white shadow-lg shadow-orange-600/20 disabled:cursor-not-allowed disabled:opacity-70">
            {saving ? 'Saving Report...' : 'Submit Report'}
          </button>
        </footer>
        {submitConfirmOpen && (
          <div className="compliance-submit-overlay" role="dialog" aria-modal="true" aria-labelledby="compliance-submit-title">
            <button type="button" className="absolute inset-0 cursor-default" aria-label="Close confirmation" onClick={() => setSubmitConfirmOpen(false)} />
            <section className="compliance-submit-modal">
              <header>
                <span><CheckCircle2 className="h-5 w-5" /></span>
                <div><p>Final Review</p><h3 id="compliance-submit-title">Submit COMPLIANCE HEALTH REPORT</h3></div>
                <button type="button" onClick={() => setSubmitConfirmOpen(false)} aria-label="Close"><X className="h-5 w-5" /></button>
              </header>
              <div className="p-6">
                <label className="compliance-submit-check">
                  <input type="checkbox" checked={submitConfirmed} onChange={(event) => setSubmitConfirmed(event.target.checked)} />
                  <span>I have reviewed all the details I entered, and they are correct.</span>
                </label>
                <div className="mt-5 flex justify-end">
                  <button type="button" disabled={!submitConfirmed || saving} onClick={() => onSubmit({ confirmed: true })} className="compliance-submit-button">{saving ? 'Submitting...' : 'Submit'}</button>
                </div>
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

function StaffFilterSelect({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef(null);
  const selected = options.find((option) => String(option.value) === String(value));
  const filtered = options.filter((option) => option.label.toLowerCase().includes(search.trim().toLowerCase()));

  useEffect(() => {
    function closeOnOutsideClick(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  function choose(nextValue) {
    onChange(nextValue);
    setOpen(false);
    setSearch('');
  }

  return (
    <div ref={rootRef} className={`lead-staff-filter ${open ? 'is-open' : ''}`}>
      <button type="button" className="lead-staff-trigger" onClick={() => setOpen((current) => !current)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="lead-staff-icon"><UserCheck className="h-4 w-4" /></span>
        <span className="lead-staff-copy"><small>Staff filter</small><strong>{selected?.label || 'All Staff'}</strong></span>
        <ChevronDown className="lead-staff-chevron h-4 w-4" />
      </button>
      {open && (
        <div className="lead-staff-menu">
          <div className="lead-staff-search">
            <Search className="h-4 w-4" />
            <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search staff..." />
            {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><X className="h-4 w-4" /></button>}
          </div>
          <div className="lead-staff-options" role="listbox">
            {!search && <button type="button" role="option" aria-selected={!value} className="lead-staff-option" onClick={() => choose('')}><span className="lead-staff-option-avatar"><UsersRound className="h-4 w-4" /></span><strong>All Staff</strong>{!value && <CheckCircle2 className="h-4 w-4" />}</button>}
            {filtered.map((option) => (
              <button key={option.value} type="button" role="option" aria-selected={String(option.value) === String(value)} className="lead-staff-option" onClick={() => choose(option.value)}>
                <span className="lead-staff-option-avatar">{option.label.slice(0, 1).toUpperCase()}</span>
                <strong>{option.label}</strong>
                {String(option.value) === String(value) && <CheckCircle2 className="h-4 w-4" />}
              </button>
            ))}
            {!filtered.length && search && <div className="lead-staff-empty">No staff member found</div>}
          </div>
          <div className="lead-staff-foot">{filtered.length} staff member{filtered.length === 1 ? '' : 's'}</div>
        </div>
      )}
    </div>
  );
}

function pendingManagerAssignmentRows(leads = [], currentUser = {}) {
  const currentRole = String(currentUser?.role || '').trim().toLowerCase();
  const restrictToCurrentManager = currentRole === 'manager';
  const currentUserTokens = personIdentityTokens(currentUser);
  return leads.flatMap((lead) => {
    const services = Array.isArray(lead.serviceSelections) ? lead.serviceSelections : [];
    const savedAssignments = Array.isArray(lead.assignments) ? lead.assignments : [];
    const assignmentsHaveManager = savedAssignments.some((assignment, index) => personIdentityTokens(
      assignment?.assignedTo, assignment?.assignedToText, assignment?.assignedToEmail, services[index]?.assignedManagerName, services[index]?.assignedManagerEmail
    ).length > 0);
    const assignments = savedAssignments.length && assignmentsHaveManager ? savedAssignments : [lead];
    return assignments.flatMap((assignment, index) => {
      const service = services.find((row) => assignment?.assignedServiceId && row?.assignedServiceId === assignment.assignedServiceId) || services[index] || {};
      const isClosed = personIdentityTokens(assignment?.closedBy, assignment?.closedByText, assignment?.closedByEmail).length > 0 || Boolean(assignment?.closedAt);
      const managerTokens = personIdentityTokens(assignment?.assignedTo, assignment?.assignedToText, assignment?.assignedToEmail, service.assignedManagerName, service.assignedManagerEmail);
      const hasManager = managerTokens.length > 0;
      const hasStaff = personIdentityTokens(assignment?.assignedStaff, assignment?.assignedStaffText, assignment?.assignedStaffEmail, service.managerAssignedStaffName, service.managerAssignedStaffEmail).length > 0;
      if (!isClosed || !hasManager || hasStaff) return [];
      if (restrictToCurrentManager && !managerTokens.some((token) => currentUserTokens.includes(token))) return [];
      return [{
        lead,
        assignment,
        service,
        rowIndex: index,
        managerName: assignment?.assignedTo?.name || assignment?.assignedToText || service.assignedManagerName || lead.assignedTo?.name || lead.assignedToText || '-',
        assignedBy: assignment?.assignedBy || lead.assignedBy || lead.createdBy?.name || lead.createdByName || lead.importedCreatedBy || '-',
        assignedAt: assignment?.assignedAt || lead.updatedAt || lead.createdAt || ''
      }];
    });
  });
}

function LeadDirectoryView({ leads, pagination, summary, staff, currentUser, loading, error, onRefresh, onDirectoryQueryChange, onExportAll, onView, onCreate, onEdit, onDelete, onToggleActive, initialWorkspace = 'leads', canEdit = false }) {
  const currentRole = String(currentUser?.role || '').trim().toLowerCase();
  const canViewNotifiedLeads = ['manager', 'admin', 'superadmin'].includes(currentRole);
  const allowedInitialWorkspace = initialWorkspace === 'notified' && !canViewNotifiedLeads ? 'leads' : initialWorkspace;
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [staffFilter, setStaffFilter] = useState('');
  const [metricFilter, setMetricFilter] = useState('');
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const [actionMenuId, setActionMenuId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const canDeleteLead = [currentUser?.role, ...(currentUser?.roles || [])]
    .some((role) => ['admin', 'superadmin'].includes(String(role || '').toLowerCase().replace(/[^a-z0-9]/g, '')));
  const [temporaryLeadCount, setTemporaryLeadCount] = useState(0);
  const [workspaceTab, setWorkspaceTab] = useState(allowedInitialWorkspace);
  const directoryEffectReady = useRef(false);
  const previousDirectoryFilterRef = useRef('');

  useEffect(() => {
    api.get(API_ENDPOINTS.leads.temporaryLeads, { params: { page: 1, limit: 1 } })
      .then((response) => setTemporaryLeadCount(Number(response.data?.counts?.total || 0)))
      .catch(() => setTemporaryLeadCount(0));
  }, [leads.length]);

  useEffect(() => {
    setWorkspaceTab(initialWorkspace === 'notified' && !canViewNotifiedLeads ? 'leads' : initialWorkspace);
  }, [canViewNotifiedLeads, initialWorkspace]);

  const filteredLeads = useMemo(() => leads.slice().sort(compareLeadCode), [leads]);

  const notifiedRows = useMemo(() => canViewNotifiedLeads ? pendingManagerAssignmentRows(filteredLeads, currentUser) : [], [canViewNotifiedLeads, currentUser, filteredLeads]);

  useEffect(() => {
    if (!directoryEffectReady.current) {
      directoryEffectReady.current = true;
      previousDirectoryFilterRef.current = JSON.stringify([metricFilter, query, rowsPerPage, staffFilter, statusFilter, workspaceTab]);
      return undefined;
    }
    if (workspaceTab === 'temporary') return undefined;
    const filterKey = JSON.stringify([metricFilter, query, rowsPerPage, staffFilter, statusFilter, workspaceTab]);
    if (filterKey !== previousDirectoryFilterRef.current) {
      previousDirectoryFilterRef.current = filterKey;
      if (page !== 1) {
        setPage(1);
        return undefined;
      }
    }
    const timer = window.setTimeout(() => {
      onDirectoryQueryChange({
        page,
        limit: rowsPerPage,
        search: query.trim(),
        status: statusFilter,
        staff: staffFilter,
        metric: metricFilter,
        workspace: workspaceTab
      });
    }, query.trim() ? 400 : 0);
    return () => window.clearTimeout(timer);
  }, [metricFilter, onDirectoryQueryChange, page, query, rowsPerPage, staffFilter, statusFilter, workspaceTab]);

  const activeTotal = Number(pagination?.total || 0);
  const totalPages = Math.max(1, Number(pagination?.totalPages || 1));
  const visibleLeads = filteredLeads;
  const visibleNotifiedRows = notifiedRows;
  const currentDirectoryRequest = () => ({
    page,
    limit: rowsPerPage,
    search: query.trim(),
    status: statusFilter,
    staff: staffFilter,
    metric: metricFilter,
    workspace: workspaceTab
  });
  const confirmLeadDeletion = async () => {
    if (!deleteTarget || deleting || !canDeleteLead) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await onDelete(deleteTarget);
      setDeleteTarget(null);
      if (visibleLeads.length === 1 && page > 1) setPage((current) => current - 1);
      else await onDirectoryQueryChange(currentDirectoryRequest());
    } catch (error) {
      setDeleteError(error?.response?.data?.error || 'Unable to delete this lead. Please try again.');
    } finally { setDeleting(false); }
  };
  const staffFilterOptions = useMemo(() => {
    const optionsMap = new Map();
    staff.forEach((user) => {
      const value = String(user._id || user.id || user.name || user.email || '');
      const label = user.name || user.email;
      if (value && label) optionsMap.set(value, { value, label });
    });
    leads.forEach((item) => {
      const label = item.assignedTo?.name || item.assignedToText || item.generatedForUser?.name || item.generatedForName || (typeof item.assignedTo === 'string' ? item.assignedTo : '');
      if (label) optionsMap.set(`name:${label.toLowerCase()}`, { value: `name:${label}`, label });
    });
    return [...optionsMap.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [leads, staff]);
  const existingClients = Number(summary?.existing || 0);
  const newLeads = Number(summary?.new || 0);
  const converted = Number(summary?.converted || existingClients);
  const metricStats = [
    { label: 'Total Leads', value: Number(summary?.total || pagination?.total || 0), note: 'Complete lead universe', icon: UsersRound, tone: 'emerald', filter: 'all' },
    { label: 'Converted to Sales', value: converted, note: 'Sales-ready conversions', icon: TrendingUp, tone: 'sky', filter: 'converted' },
    { label: 'Existing Clients', value: existingClients, note: 'Existing or converted clients', icon: CheckCircle2, tone: 'teal', filter: 'existing' },
    { label: 'New Leads', value: newLeads, note: 'Fresh non-client records', icon: UserPlus, tone: 'violet', filter: 'new' }
  ];
  const selectedMetric = metricStats.find((stat) => stat.filter === metricFilter);

  function leadClosureDetails(item = {}) {
    const assignments = Array.isArray(item.assignments) ? item.assignments : [];
    const poRows = assignments.flatMap((row) => Array.isArray(row?.poYearRows) ? row.poYearRows : []);
    const hasPo = poRows.some((row) => String(row?.poNumber || '').trim() || String(row?.poFileUrl || row?.poProofUrl || '').trim());
    const closedAssignment = assignments.find((row) => row?.closedBy || row?.closedByText || row?.closedAt);
    const closedBy = item.closedBy?.name || item.closedByText || closedAssignment?.closedBy?.name || closedAssignment?.closedByText || '';
    const closedOnBehalfOf = item.closedOnBehalfOfName || assignments.find((row) => row?.closedOnBehalfOfName)?.closedOnBehalfOfName || '';
    const hasApprovedClosure = Boolean(item.closedBy || item.closedByText || closedAssignment?.closedBy || closedAssignment?.closedByText || closedAssignment?.closedAt);
    return {
      status: hasPo && hasApprovedClosure ? 'Closed' : 'Still Not Closed',
      pipelineStatus: item.status || '',
      closedBy,
      closedOnBehalfOf,
      poNumbers: [...new Set(poRows.map((row) => String(row?.poNumber || '').trim()).filter(Boolean))],
      poAmount: poRows.reduce((sum, row) => sum + (Number(row?.poAmount) || 0), 0)
    };
  }

  async function exportExcel() {
    const exportLeads = await onExportAll({
      search: query.trim(), status: statusFilter, staff: staffFilter, metric: metricFilter, workspace: workspaceTab
    }).catch(() => filteredLeads);
    const rows = exportLeads.map((item) => {
      const closure = leadClosureDetails(item);
      return ({
      'Lead ID': displayLeadId(item),
      'Excel Lead ID': item.sourceLeadId || '',
      Company: item.company || '',
      Industry: item.industryType || '',
      Status: closure.status,
      'Lead Pipeline Status': closure.pipelineStatus,
      'Applicant Type': item.piboParent || item.piboCategoryParent || inferPiboParent(item.piboCategory),
      'Sub Applicant Type': item.subApplicantType || item.piboCategory || '',
      'Service Category': item.eprCategory || '',
      'Services Offered': item.servicesOffered || '',
      'Contact Person': item.contactPerson || '',
      Designation: item.designation || '',
      'Mobile 1': item.mobileNo1 || '',
      'Mobile 2': item.mobileNo2 || '',
      Email: item.emails || '',
      Website: item.website || '',
      'Emails Sent Count': item.emailsSentCount || '',
      'Last Email Sent': item.lastEmailSent || '',
      'Referred By': item.referredBy || '',
      Source: item.source || '',
      Notes: item.notes || '',
      'Assigned To': resolveLeadStaffName(item, staff),
      'Assigned By': resolveLeadAssignedBy(item, staff),
      'Created By': item.createdBy?.name || item.createdByName || item.importedCreatedBy || item.createdBy?.email || '',
      'Lead Date': item.leadDate || '',
      'Next Follow-Up Date': item.nextFollowUpDate || '',
      'Next Follow-Up Time': item.nextFollowUpTime || '',
      'Follow-Up Remarks': item.followUpRemarks || '',
      'Created At': item.importedCreatedAt || item.createdAt || '',
      'Updated At': item.importedUpdatedAt || item.updatedAt || '',
      'Closed By': closure.closedBy,
      'Closed On Behalf Of': closure.closedOnBehalfOf,
      'PO Number(s)': closure.poNumbers.join(', '),
      'Total PO Amount': closure.poAmount || '',
      'Business Card URL': item.businessCardUrl || ''
      });
    });
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads');
    const suffix = selectedMetric?.label || statusFilter || 'All Leads';
    XLSX.writeFile(workbook, `${suffix.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'leads'}.xlsx`);
  }

  return (
    <div className="lead-directory-page px-4 py-6 sm:px-6 lg:px-8">
      <div className="space-y-4">
        {selectedMetric && (
          <MetricOutputCard
            stat={selectedMetric}
            leads={filteredLeads}
            onClose={() => setMetricFilter('')}
            onExport={exportExcel}
          />
        )}

        {error && <ToastMessage type="error">{error}</ToastMessage>}

        {workspaceTab !== 'temporary' && <>
        <div className="lead-directory-toolbar grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5 xl:grid-cols-[minmax(320px,1.15fr)_minmax(210px,0.72fr)_minmax(280px,1fr)_auto] xl:items-center">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search leads by ID, company, contact..." className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-12 pr-4 text-sm font-bold text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" />
          </div>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="form-input min-h-12 rounded-lg xl:max-w-none">
            <option value="">All Status</option>
            {options.status.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <StaffFilterSelect value={staffFilter} options={staffFilterOptions} onChange={setStaffFilter} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:flex xl:justify-end">
            <button type="button" onClick={onCreate} className="btn-lift inline-flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[#30737B] px-4 text-sm font-black text-white shadow-lg shadow-teal-900/20"><Plus className="h-4 w-4" />Add Lead</button>
            <button type="button" onClick={() => setWorkspaceTab('temporary')} className="btn-lift inline-flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-violet-200 bg-violet-50 px-4 text-sm font-black text-violet-700 hover:bg-violet-100"><Clock3 className="h-4 w-4" />Temp Lead</button>
            <button type="button" onClick={() => { setQuery(''); setStatusFilter(''); setStaffFilter(''); setMetricFilter(''); setPage(1); }} className="btn-lift inline-flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-slate-600 hover:bg-slate-50"><X className="h-4 w-4" />Clear</button>
            <button type="button" onClick={() => onDirectoryQueryChange(currentDirectoryRequest())} className="btn-lift inline-flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-orange-200 bg-white px-4 text-sm font-black text-orange-600 hover:bg-orange-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
            <button type="button" onClick={exportExcel} className="btn-lift inline-flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-emerald-600 px-4 text-sm font-black text-white shadow-lg shadow-emerald-600/20"><Download className="h-4 w-4" />Export</button>
          </div>
        </div>

        <DirectoryTableHeader showing={workspaceTab === 'notified' ? visibleNotifiedRows.length : visibleLeads.length} total={activeTotal} label={workspaceTab === 'notified' ? 'notified leads' : 'leads'} rowsPerPage={rowsPerPage} setRowsPerPage={setRowsPerPage} page={page} setPage={setPage} totalPages={totalPages} />
        </>}

        <LeadWorkspaceTabs
          activeTab={workspaceTab}
          temporaryLeadCount={temporaryLeadCount}
          notifiedLeadCount={workspaceTab === 'notified' ? activeTotal : null}
          showNotified={canViewNotifiedLeads}
          onChange={setWorkspaceTab}
        />

        <div key={workspaceTab} className="lead-tab-content-enter">
        {workspaceTab === 'temporary' ? (
          <TemporaryLeadsWorkspace onClose={() => setWorkspaceTab('leads')} onConverted={onRefresh} embedded />
        ) : workspaceTab === 'notified' ? (
          <NotifiedLeadsTable rows={visibleNotifiedRows} loading={loading} onView={onView} onEdit={onEdit} canEdit={canEdit} currentUser={currentUser} />
        ) : <div className="lead-directory-table-card overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-950/5">
          <div className="lead-directory-scroll max-h-[680px] overflow-auto">
            <table className="crm-data-table lead-directory-table w-full min-w-[2050px] table-fixed text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-black uppercase tracking-[0.06em] text-slate-500 shadow-sm">
                <tr>
                  {[
                    ['Lead ID', 'w-[140px]'], ['Company', 'w-[170px]'], ['Service Category', 'w-[160px]'],
                    ['Contact Person', 'w-[170px]'], ['Mobile 1', 'w-[135px]'],
                    ['Email', 'w-[215px]'], ['Assigned To', 'w-[145px]'], ['Assigned By', 'w-[145px]'],
                    ['Created By', 'w-[145px]'], ['Created For / Behalf Of', 'w-[170px]'],
                    ['Closed By', 'w-[145px]'], ['Closed On Behalf Of', 'w-[175px]'], ['Status', 'w-[135px]'], ['Actions', 'w-[180px]']
                  ].map(([header, width]) => <th key={header} className={`px-4 py-4 ${width}`}>{header}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {visibleLeads.length === 0 ? (
                  <tr><td colSpan={11} className="px-5 py-12 text-center font-black text-slate-400">{loading ? 'Loading leads...' : 'No leads found.'}</td></tr>
                ) : visibleLeads.map((item) => (
                  <tr key={item._id || item.id} className="transition hover:bg-orange-50/60">
                    <td className="lead-directory-id-cell px-4 py-4"><span title={displayLeadId(item)}>{displayLeadId(item)}</span></td>
                    <td className="px-4 py-4 font-semibold uppercase text-slate-700"><span className="cell-clamp">{item.company || '-'}</span></td>
                    <td className="px-4 py-4"><span className="lead-service-tag">{item.eprCategory || '-'}</span></td>
                    <td className="px-4 py-4"><LeadPersonCell name={item.contactPerson} /></td>
                    <td className="px-4 py-4"><span className="lead-contact-value"><Phone className="h-3.5 w-3.5" />{item.mobileNo1 || '-'}</span></td>
                    <td className="px-4 py-4"><span className="lead-contact-value normal-case"><Mail className="h-3.5 w-3.5" />{item.emails || '-'}</span></td>
                    <td className="px-4 py-4 font-medium uppercase text-slate-600"><span className="cell-clamp">{resolveLeadStaffName(item, staff)}</span></td>
                    <td className="px-4 py-4 font-medium uppercase text-slate-600"><span className="cell-clamp">{resolveLeadAssignedBy(item, staff)}</span></td>
                    <td className="px-4 py-4 font-medium uppercase text-slate-600"><span className="cell-clamp">{item.createdBy?.name || item.createdByName || item.importedCreatedBy || item.createdBy?.email || '-'}</span></td>
                    <td className="px-4 py-4 font-medium uppercase text-indigo-700"><span className="cell-clamp">{item.createdOnBehalfOfName || item.generatedForUser?.name || item.generatedForName || item.createdBy?.name || item.createdByName || '-'}</span></td>
                    <td className="px-4 py-4 font-medium uppercase text-slate-600"><span className="cell-clamp">{item.closedBy?.name || item.closedByText || item.assignments?.find((row) => row.closedBy || row.closedByText)?.closedByText || '-'}</span></td>
                    <td className="px-4 py-4 font-medium uppercase text-violet-700"><span className="cell-clamp">{item.closedOnBehalfOfName || item.assignments?.find((row) => row.closedOnBehalfOfName)?.closedOnBehalfOfName || '-'}</span></td>
                    <td className="px-4 py-4"><span className={`lead-status-badge ${leadClosureDetails(item).status === 'Closed' ? 'text-emerald-700' : 'text-amber-700'}`}>{leadClosureDetails(item).status}</span></td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => onView(item)} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50" title="View"><Eye className="h-4 w-4" /></button>
                        {canDeleteLead && <button type="button" onClick={() => { setDeleteError(''); setDeleteTarget(item); }} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100" aria-label={`Delete lead ${item.company || displayLeadId(item)}`} title="Delete lead"><Trash2 className="h-4 w-4" /></button>}
                        {(canEdit || canUserEditLead(item, currentUser)) && <button type="button" onClick={() => onEdit(item)} className="grid h-9 w-9 place-items-center rounded-lg border border-orange-200 bg-orange-50 text-orange-600 hover:bg-orange-100" title="Edit in CRM"><Edit3 className="h-4 w-4" /></button>}
                        {canEdit && <div className="relative">
                          <button type="button" onClick={() => setActionMenuId((value) => value === leadRecordId(item) ? '' : leadRecordId(item))} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50" title="More actions"><EllipsisVertical className="h-4 w-4" /></button>
                          {actionMenuId === leadRecordId(item) && <div className="absolute bottom-full right-0 z-30 mb-2 w-36 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                            {['Active', 'Inactive'].map((status) => <button key={status} type="button" onClick={async () => { await onToggleActive(item, status.toUpperCase()); setActionMenuId(''); }} className="block w-full px-4 py-2 text-left text-sm font-black text-slate-700 hover:bg-emerald-50">{status}</button>)}
                          </div>}
                        </div>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>}
        </div>
        {workspaceTab !== 'temporary' && <LeadDirectoryPagination page={page} totalPages={totalPages} setPage={setPage} />}
        {deleteTarget && <LeadDeleteDialog lead={deleteTarget} busy={deleting} error={deleteError} onCancel={() => { if (!deleting) setDeleteTarget(null); }} onConfirm={confirmLeadDeletion} />}
      </div>
    </div>
  );
}

function LeadWorkspaceTabs({ activeTab, temporaryLeadCount, notifiedLeadCount, showNotified, onChange }) {
  const tabs = [
    { id: 'leads', label: 'All Leads', note: 'Complete lead table', icon: FileText, tone: 'emerald' },
    { id: 'temporary', label: 'Temporary Leads', note: `${temporaryLeadCount.toLocaleString('en-IN')} captured`, icon: Clock3, tone: 'violet' },
    ...(showNotified ? [{ id: 'notified', label: 'Notified Leads', note: notifiedLeadCount === null ? 'Open to load' : `${Number(notifiedLeadCount || 0).toLocaleString('en-IN')} awaiting staff`, icon: BellRing, tone: 'orange' }] : [])
  ];
  return (
    <div className="flex justify-start" role="tablist" aria-label="Lead workspaces">
      <div className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm shadow-slate-950/5">
        {tabs.map(({ id, label, note, icon: Icon, tone }) => {
          const active = activeTab === id;
          const activeClass = tone === 'violet' ? 'border-violet-300 bg-violet-50 text-violet-800 shadow-violet-100' : tone === 'orange' ? 'border-orange-300 bg-orange-50 text-orange-800 shadow-orange-100' : 'border-emerald-300 bg-emerald-50 text-emerald-800 shadow-emerald-100';
          return <button key={id} type="button" role="tab" aria-selected={active} onClick={() => onChange(id)} className={`flex h-12 min-w-[150px] items-center gap-2 rounded-lg border px-3 text-left transition-all duration-300 ease-out sm:min-w-[170px] ${active ? `${activeClass} -translate-y-px shadow-sm` : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700'}`}>
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-all duration-300 ${active ? 'scale-105 bg-white/90 shadow-sm' : 'bg-slate-100'}`}><Icon className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1"><strong className="block truncate text-xs font-black">{label}</strong><small className="block truncate text-[10px] font-bold opacity-70">{note}</small></span>
            <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 transition-all duration-300 ${active ? 'scale-100 opacity-100' : 'scale-75 opacity-0'}`} />
          </button>;
        })}
      </div>
    </div>
  );
}

function NotifiedLeadsTable({ rows, loading, onView, onEdit, canEdit, currentUser }) {
  return (
    <div className="animate-[fadeIn_.25s_ease-out] overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-sm shadow-orange-950/5">
      <div className="border-b border-orange-100 bg-gradient-to-r from-orange-50 via-amber-50 to-white px-5 py-4">
        <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-orange-100 text-orange-700"><BellRing className="h-5 w-5" /></span><div><h3 className="font-black text-slate-900">Manager action pending</h3><p className="mt-0.5 text-xs font-semibold text-slate-500">Only closed leads assigned to a Manager are shown here. They remain until Manager Assigned to Staff is completed.</p></div></div>
      </div>
      <div className="max-h-[680px] overflow-auto">
        <table className="w-full min-w-[1250px] table-fixed text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500"><tr><th className="w-[145px] px-4 py-4">Lead ID</th><th className="w-[220px] px-4 py-4">Company</th><th className="w-[190px] px-4 py-4">Service Category</th><th className="w-[170px] px-4 py-4">Assigned Manager</th><th className="w-[160px] px-4 py-4">Assigned By</th><th className="w-[170px] px-4 py-4">Manager Assigned to Staff</th><th className="w-[155px] px-4 py-4">Notified On</th><th className="w-[115px] px-4 py-4">Actions</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => <tr key={`${leadRecordId(row.lead)}-${row.rowIndex}`} className="transition hover:bg-orange-50/50"><td className="px-4 py-4 font-black text-blue-700">{displayLeadId(row.lead)}</td><td className="px-4 py-4 font-black uppercase text-slate-800"><span className="cell-clamp">{row.lead.company || '-'}</span></td><td className="px-4 py-4"><span className="lead-service-tag">{row.service.eprCategory || row.lead.eprCategory || '-'}</span></td><td className="px-4 py-4 font-black uppercase text-teal-700">{row.managerName}</td><td className="px-4 py-4 font-bold uppercase text-slate-600">{personLabel(row.assignedBy)}</td><td className="px-4 py-4"><span className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-[10px] font-black uppercase text-orange-700"><Clock3 className="h-3.5 w-3.5" />Pending</span></td><td className="px-4 py-4 text-xs font-bold text-slate-500">{row.assignedAt ? new Date(row.assignedAt).toLocaleString('en-IN') : '-'}</td><td className="px-4 py-4"><div className="flex gap-2"><button type="button" onClick={() => onView(row.lead)} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50" title="View lead"><Eye className="h-4 w-4" /></button>{(canEdit || canUserEditLead(row.lead, currentUser)) && <button type="button" onClick={() => onEdit(row.lead)} className="grid h-9 w-9 place-items-center rounded-lg border border-orange-200 bg-orange-50 text-orange-600 hover:bg-orange-100" title="Assign staff"><Edit3 className="h-4 w-4" /></button>}</div></td></tr>)}
            {!loading && rows.length === 0 && <tr><td colSpan="8" className="px-5 py-16 text-center"><BellRing className="mx-auto h-10 w-10 text-emerald-300"/><p className="mt-3 font-black text-slate-500">No notified leads are pending.</p><p className="mt-1 text-xs font-semibold text-slate-400">No closed, manager-assigned lead is currently waiting for staff assignment.</p></td></tr>}
            {loading && <tr><td colSpan="8" className="px-5 py-16 text-center font-black text-slate-400">Loading notified leads...</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TemporaryLeadsWorkspace({ onClose, onConverted, embedded = false }) {
  // View table workspace with modal capture and Excel bulk import.
  const [clientName, setClientName] = useState('');
  const [tempLeadModalOpen, setTempLeadModalOpen] = useState(false);
  const [tempDraft, setTempDraft] = useState({ companyName: '', personName: '', email: '', phone: '', sector: '' });
  const [bulkUploading, setBulkUploading] = useState(false);
  const bulkInputRef = useRef(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ temporaryLeads: [], pagination: { page: 1, pages: 1, total: 0 }, counts: { total: 0, draft: 0, converted: 0 } });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [convertingId, setConvertingId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [trackerRow, setTrackerRow] = useState(null);
  const [followUpSaving, setFollowUpSaving] = useState(false);
  const [followUp, setFollowUp] = useState({ scheduledDate: '', scheduledTime: '', remarks: '', priority: 'Medium' });
  const [message, setMessage] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const response = await api.get(API_ENDPOINTS.leads.temporaryLeads, { params: { page, limit: 10, search: search.trim() || undefined, status: status || undefined } });
      setData(response.data);
    } catch (requestError) {
      setMessage({ type: 'error', text: requestError?.response?.data?.error || 'Unable to load temporary leads.' });
    } finally { setLoading(false); }
  }

  useEffect(() => { const timer = setTimeout(load, search ? 300 : 0); return () => clearTimeout(timer); }, [page, search, status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, [search, status]);

  function openTemporaryLeadModal(event) {
    event.preventDefault();
    const name = clientName.trim();
    if (name.length < 2 || saving) return;
    setTempDraft({ companyName: name, personName: '', email: '', phone: '', sector: '' });
    setTempLeadModalOpen(true);
    setMessage(null);
  }

  async function saveTemporaryLead(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setMessage(null);
    try {
      const response = await api.post(API_ENDPOINTS.leads.temporaryLeads, tempDraft);
      setClientName(''); setPage(1);
      setTempLeadModalOpen(false);
      setMessage({ type: 'success', text: `${response.data.temporaryLead.tempLeadCode} saved successfully.` });
      await load();
    } catch (requestError) {
      setMessage({ type: 'error', text: requestError?.response?.data?.error || 'Unable to save temporary lead.' });
    } finally { setSaving(false); }
  }

  function downloadTemporaryLeadTemplate() {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Company Name', 'Person Name', 'Email ID', 'Phone No', 'Sector'],
      ['Example Industries Pvt Ltd', 'Ravi Kumar', 'ravi@example.com', '9876543210', 'Manufacturing']
    ]);
    sheet['!cols'] = [{ wch: 32 }, { wch: 24 }, { wch: 30 }, { wch: 18 }, { wch: 24 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Temporary Leads');
    XLSX.writeFile(workbook, `temporary-leads-template-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function uploadTemporaryLeads(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || bulkUploading) return;
    setBulkUploading(true); setMessage(null);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const readValue = (row, names) => {
        const entries = Object.entries(row);
        const wanted = names.map((name) => name.replace(/[^a-z0-9]/gi, '').toLowerCase());
        return entries.find(([key]) => wanted.includes(key.replace(/[^a-z0-9]/gi, '').toLowerCase()))?.[1] ?? '';
      };
      const rows = rawRows.map((row) => ({
        companyName: readValue(row, ['Company Name', 'Company', 'Client Name']),
        personName: readValue(row, ['Person Name', 'Contact Person']),
        email: readValue(row, ['Email ID', 'Email']),
        phone: readValue(row, ['Phone No', 'Phone Number', 'Mobile No']),
        sector: readValue(row, ['Sector', 'Industry Type'])
      }));
      const response = await api.post(API_ENDPOINTS.leads.bulkTemporaryLeads, { rows });
      const summary = response.data.summary || {};
      const skippedPreview = (response.data.skipped || []).slice(0, 3).map((row) => `Row ${row.row}: ${row.error}`).join(' ');
      setMessage({ type: summary.skipped ? 'error' : 'success', text: `${summary.inserted || 0} temporary lead(s) saved; ${summary.skipped || 0} skipped. ${skippedPreview}`.trim() });
      setPage(1);
      await load();
    } catch (requestError) {
      setMessage({ type: 'error', text: requestError?.response?.data?.error || 'Unable to import the temporary-lead Excel file.' });
    } finally { setBulkUploading(false); }
  }

  async function convert(row) {
    if (!window.confirm(`Convert ${row.tempLeadCode} (${row.clientName}) into a permanent lead?`)) return;
    setConvertingId(row._id); setMessage(null);
    try {
      const response = await api.post(API_ENDPOINTS.leads.convertTemporaryLead(row._id));
      setMessage({ type: 'success', text: `${row.tempLeadCode} converted to ${response.data.lead?.leadCode || row.convertedLeadCode}.` });
      await Promise.all([load(), onConverted?.()]);
    } catch (requestError) {
      setMessage({ type: 'error', text: requestError?.response?.data?.error || 'Unable to convert this temporary lead.' });
    } finally { setConvertingId(''); }
  }

  function toggleDetails(row) {
    const opening = trackerRow?._id !== row._id;
    setTrackerRow(opening ? row : null);
    setSelectedId('');
    setFollowUp(opening ? { scheduledDate: row.nextFollowUpDate || '', scheduledTime: row.nextFollowUpTime || '', remarks: row.followUpRemarks || '', priority: row.followUpPriority || 'Medium' } : { scheduledDate: '', scheduledTime: '', remarks: '', priority: 'Medium' });
  }

  async function saveFollowUp(row) {
    if (!followUp.scheduledDate || !followUp.remarks.trim() || followUpSaving) return;
    setFollowUpSaving(true); setMessage(null);
    try {
      await api.post(API_ENDPOINTS.leads.temporaryLeadFollowUp(row._id), followUp);
      setMessage({ type: 'success', text: `Follow-up saved for ${row.tempLeadCode} and added to Calendar.` });
      await load();
    } catch (requestError) {
      setMessage({ type: 'error', text: requestError?.response?.data?.error || 'Unable to save follow-up.' });
    } finally { setFollowUpSaving(false); }
  }

  const counts = data.counts || {};
  return <div className={embedded ? '' : 'lead-directory-page min-h-[calc(100vh-72px)] bg-[#f6faf9] p-3 sm:p-4'}>
    <section className={`${embedded ? 'w-full' : 'min-h-[calc(100vh-104px)]'} overflow-hidden rounded-2xl border border-slate-200 bg-[#f6faf9] shadow-sm`}>
      {!embedded && <header className="relative overflow-hidden border-b border-emerald-100 bg-white px-5 py-5 sm:px-7"><div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-emerald-500 to-teal-700"/><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[.2em] text-emerald-700"><Clock3 className="h-4 w-4"/>Quick capture workspace</div><h1 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">Temporary Leads</h1><p className="mt-1 text-sm font-semibold text-slate-500">Capture a client name now and complete the full lead whenever you are ready.</p></div><button type="button" onClick={onClose} className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-600 shadow-sm hover:bg-slate-50"><ArrowLeft className="h-4 w-4"/>Back to Leads</button></div></header>}
      <div className="space-y-4 p-4 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-3">{[[counts.total,'Total Captured','border border-sky-200 bg-gradient-to-br from-sky-50 to-cyan-50 text-sky-800'],[counts.draft,'Ready to Convert','border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 text-amber-800'],[counts.converted,'Converted Leads','border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 text-emerald-800']].map(([value,label,tone]) => <article key={label} className={`rounded-2xl p-4 shadow-sm ${tone}`}><span className="text-[10px] font-black uppercase tracking-wider opacity-70">{label}</span><strong className="mt-1 block text-3xl font-black">{Number(value || 0).toLocaleString('en-IN')}</strong></article>)}</div>
        <form onSubmit={openTemporaryLeadModal} className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm"><label className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Company name</label><div className="mt-2 flex flex-col gap-2 lg:flex-row"><div className="relative flex-1"><Building2 className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"/><input autoFocus value={clientName} maxLength={240} onChange={(event) => setClientName(event.target.value)} placeholder="Enter company name" className="h-12 w-full rounded-xl border border-slate-200 pl-12 pr-4 text-sm font-bold outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"/></div><button disabled={saving || clientName.trim().length < 2} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-6 text-sm font-black text-white shadow-lg shadow-emerald-700/20 disabled:opacity-40"><Plus className="h-4 w-4"/>Submit Temp Lead</button><button type="button" onClick={() => bulkInputRef.current?.click()} disabled={bulkUploading} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-5 text-sm font-black text-violet-700 disabled:opacity-40"><Upload className="h-4 w-4"/>{bulkUploading ? 'Uploading...' : 'Bulk Upload Excel'}</button><button type="button" onClick={downloadTemporaryLeadTemplate} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-black text-slate-600"><Download className="h-4 w-4"/>Template</button><input ref={bulkInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={uploadTemporaryLeads}/></div><p className="mt-2 text-xs font-semibold text-slate-400">Details are checked against temporary and permanent leads before a unique ATPL-TEMP ID is generated.</p></form>
        {message && <div className={`rounded-xl border px-4 py-3 text-sm font-bold ${message.type === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{message.text}</div>}
        {tempLeadModalOpen && <div className="fixed inset-0 z-[180] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && !saving && setTempLeadModalOpen(false)}><form onSubmit={saveTemporaryLead} className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl"><header className="flex items-start justify-between border-b border-emerald-100 bg-emerald-50 p-5"><div><p className="text-[10px] font-black uppercase tracking-wider text-emerald-700">New temporary lead</p><h3 className="mt-1 text-xl font-black text-slate-950">Complete lead details</h3><p className="mt-1 text-sm font-semibold text-slate-500">All fields are required and checked for duplicates before saving.</p></div><button type="button" disabled={saving} onClick={() => setTempLeadModalOpen(false)} className="grid h-9 w-9 place-items-center rounded-xl bg-white text-slate-500 disabled:opacity-40"><X className="h-4 w-4"/></button></header><div className="grid gap-4 p-5 sm:grid-cols-2"><Field label="Company Name" required className="sm:col-span-2"><input autoFocus required minLength="2" maxLength="240" className="form-input" value={tempDraft.companyName} onChange={(event) => setTempDraft((current) => ({...current,companyName:event.target.value}))} placeholder="Company name"/></Field><Field label="Person Name" required><input required minLength="2" maxLength="160" className="form-input" value={tempDraft.personName} onChange={(event) => setTempDraft((current) => ({...current,personName:event.target.value}))} placeholder="Contact person"/></Field><Field label="Email ID" required><input required type="email" maxLength="254" className="form-input" value={tempDraft.email} onChange={(event) => setTempDraft((current) => ({...current,email:event.target.value}))} placeholder="name@company.com"/></Field><Field label="Phone No." required><input required type="tel" inputMode="numeric" pattern="[0-9 +()-]{10,20}" className="form-input" value={tempDraft.phone} onChange={(event) => setTempDraft((current) => ({...current,phone:event.target.value}))} placeholder="10 to 15 digits"/></Field><Field label="Sector" required><input required minLength="2" maxLength="160" className="form-input" value={tempDraft.sector} onChange={(event) => setTempDraft((current) => ({...current,sector:event.target.value}))} placeholder="e.g. Manufacturing"/></Field></div><footer className="flex justify-end gap-2 border-t bg-slate-50 p-4"><button type="button" disabled={saving} onClick={() => setTempLeadModalOpen(false)} className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black disabled:opacity-40">Cancel</button><button type="submit" disabled={saving} className="h-10 rounded-xl bg-emerald-700 px-5 text-sm font-black text-white disabled:opacity-40">{saving ? 'Checking & Saving...' : 'Save Temporary Lead'}</button></footer></form></div>}
        {trackerRow && <TemporaryLeadFollowUpTracker row={data.temporaryLeads?.find((item) => item._id === trackerRow._id) || trackerRow} onClose={() => setTrackerRow(null)} onSaved={load} />}
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-[1fr_220px_auto]"><label className="relative"><Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ID, company, person, email or phone..." className="h-11 w-full rounded-xl border border-slate-200 pl-10 pr-3 text-sm font-bold outline-none focus:border-violet-400"/></label><select value={status} onChange={(event) => setStatus(event.target.value)} className="h-11 rounded-xl border border-slate-200 px-3 text-sm font-bold"><option value="">All Status</option><option value="DRAFT">Ready to Convert</option><option value="CONVERTED">Converted</option></select><button type="button" onClick={load} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-black text-slate-600"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}/>Refresh</button></div>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500"><tr><th className="p-4">Temp Lead ID</th><th className="p-4">Client Name</th><th className="p-4">Created By</th><th className="p-4">Created At</th><th className="p-4">Next Follow-up</th><th className="p-4">Status</th><th className="p-4">Permanent Lead</th><th className="p-4 text-right">Action</th></tr></thead><tbody>{loading ? <tr><td colSpan="8" className="p-12 text-center font-bold text-slate-400">Loading temporary leads...</td></tr> : data.temporaryLeads?.map((row) => <React.Fragment key={row._id}><tr className="border-t border-slate-100 hover:bg-emerald-50/30"><td className="p-4"><button type="button" onClick={() => toggleDetails(row)} className="font-black text-violet-700 underline decoration-violet-200 underline-offset-4">{row.tempLeadCode}</button></td><td className="p-4"><button type="button" onClick={() => toggleDetails(row)} className="text-left font-black uppercase text-slate-800 hover:text-violet-700">{row.clientName}</button></td><td className="p-4"><strong className="block">{row.createdBy?.name || row.createdByName || '-'}</strong><small className="text-slate-400">{row.createdBy?.email || row.createdByEmail}</small></td><td className="p-4 text-xs font-bold text-slate-500">{new Date(row.createdAt).toLocaleString('en-IN')}</td><td className="p-4 text-xs font-bold text-slate-600">{row.nextFollowUpDate ? `${row.nextFollowUpDate}${row.nextFollowUpTime ? ` · ${row.nextFollowUpTime}` : ''}` : '-'}</td><td className="p-4"><span className={`rounded-full px-3 py-1 text-[10px] font-black ${row.status === 'CONVERTED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{row.status === 'CONVERTED' ? 'Converted' : 'Ready'}</span></td><td className="p-4 font-black text-emerald-700">{row.convertedLeadCode || '-'}</td><td className="p-4 text-right"><div className="flex justify-end gap-2"><button type="button" onClick={() => toggleDetails(row)} className="h-9 rounded-lg border border-violet-200 bg-violet-50 px-3 text-xs font-black text-violet-700">{selectedId === row._id ? 'Hide Details' : 'View Details'}</button><button type="button" disabled={row.status === 'CONVERTED' || convertingId === row._id} onClick={() => convert(row)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-violet-700 px-3 text-xs font-black text-white disabled:bg-slate-200 disabled:text-slate-400">{convertingId === row._id ? 'Converting...' : row.status === 'CONVERTED' ? 'Converted' : <>Convert to Lead<ArrowRight className="h-3.5 w-3.5"/></>}</button></div></td></tr>{selectedId === row._id && <tr className="border-t border-violet-100 bg-violet-50/40"><td colSpan="8" className="p-5"><div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]"><section className="rounded-2xl border border-violet-100 bg-white p-5"><p className="text-[10px] font-black uppercase tracking-wider text-violet-600">Temporary lead details</p><h3 className="mt-1 text-xl font-black text-slate-900">{row.clientName}</h3><div className="mt-4 grid gap-3 sm:grid-cols-3"><FollowUpDetail label="Temp Lead ID" value={row.tempLeadCode}/><FollowUpDetail label="Created By" value={row.createdBy?.name || row.createdByName || '-'}/><FollowUpDetail label="Current Follow-up" value={row.nextFollowUpDate ? `${row.nextFollowUpDate} ${row.nextFollowUpTime || ''}` : 'Not scheduled'}/></div><h4 className="mt-5 text-xs font-black uppercase tracking-wider text-slate-500">Follow-up history</h4><div className="mt-2 max-h-40 space-y-2 overflow-y-auto">{row.followUpHistory?.length ? row.followUpHistory.map((item,index) => <div key={item.calendarItemId || index} className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs"><strong className="text-slate-800">{item.scheduledDate || '-'} {item.scheduledTime || ''}</strong><span className="ml-2 rounded-full bg-white px-2 py-1 font-black uppercase text-slate-500">{item.status || 'saved'}</span><p className="mt-1 font-semibold text-slate-600">{item.remarks}</p></div>) : <p className="rounded-xl bg-slate-50 p-4 text-sm font-bold text-slate-400">No follow-up history yet.</p>}</div></section><section className="rounded-2xl border border-emerald-100 bg-white p-5"><p className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Schedule follow-up</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><input type="date" value={followUp.scheduledDate} onChange={(event) => setFollowUp((current) => ({...current,scheduledDate:event.target.value}))} className="form-input"/><input type="time" value={followUp.scheduledTime} onChange={(event) => setFollowUp((current) => ({...current,scheduledTime:event.target.value}))} className="form-input"/><select value={followUp.priority} onChange={(event) => setFollowUp((current) => ({...current,priority:event.target.value}))} className="form-input sm:col-span-2"><option>Low</option><option>Medium</option><option>High</option><option>Urgent</option></select><textarea value={followUp.remarks} onChange={(event) => setFollowUp((current) => ({...current,remarks:event.target.value}))} placeholder="Follow-up remarks" rows="3" className="form-input sm:col-span-2"/></div><button type="button" disabled={row.status === 'CONVERTED' || followUpSaving || !followUp.scheduledDate || !followUp.remarks.trim()} onClick={() => saveFollowUp(row)} className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-black text-white disabled:opacity-40"><CalendarDays className="h-4 w-4"/>{followUpSaving ? 'Saving...' : 'Save Follow-up'}</button><p className="mt-2 text-xs font-semibold text-slate-400">This follow-up will also appear in Calendar with the same completion workflow.</p></section></div></td></tr>}</React.Fragment>)}{!loading && !data.temporaryLeads?.length && <tr><td colSpan="8" className="p-12 text-center font-bold text-slate-400">No temporary leads match these filters.</td></tr>}</tbody></table></div><footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs font-bold text-slate-500"><span>Showing {data.temporaryLeads?.length || 0} of {data.pagination?.total || 0}</span><div className="flex items-center gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} className="grid h-9 w-9 place-items-center rounded-lg border disabled:opacity-30"><ChevronLeft className="h-4 w-4"/></button><span>Page {page} of {data.pagination?.pages || 1}</span><button type="button" disabled={page >= (data.pagination?.pages || 1)} onClick={() => setPage((current) => current + 1)} className="grid h-9 w-9 place-items-center rounded-lg border disabled:opacity-30"><ChevronRight className="h-4 w-4"/></button></div><span>10 per page</span></footer></div>
      </div>
    </section>
  </div>;
}

function TemporaryLeadFollowUpTracker({ row, onClose, onSaved }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeRemarks, setCloseRemarks] = useState('');
  const [draft, setDraft] = useState({ scheduledDate: row.nextFollowUpDate || '', scheduledTime: row.nextFollowUpTime || '', remarks: row.followUpRemarks || '', priority: row.followUpPriority || 'Medium' });
  const upcoming = row.nextFollowUpDate || row.nextFollowUpTime || row.followUpRemarks ? [{ scheduledDate: row.nextFollowUpDate, scheduledTime: row.nextFollowUpTime, remarks: row.followUpRemarks, priority: row.followUpPriority || 'Medium', status: 'open' }] : [];
  const previous = (row.followUpHistory || []).filter((item) => {
    const isCurrent = String(item.status || '').toLowerCase() === 'open' && item.scheduledDate === row.nextFollowUpDate && item.scheduledTime === row.nextFollowUpTime && item.remarks === row.followUpRemarks;
    return !isCurrent;
  });

  async function save() {
    if (!draft.scheduledDate || !draft.remarks.trim() || saving) return;
    setSaving(true); setError('');
    try {
      await api.post(API_ENDPOINTS.leads.temporaryLeadFollowUp(row._id), draft);
      await onSaved?.();
      setModalOpen(false);
    } catch (requestError) { setError(requestError?.response?.data?.error || 'Unable to save follow-up.'); }
    finally { setSaving(false); }
  }

  async function closeCurrentFollowUp() {
    if (!closeRemarks.trim() || saving) return;
    setSaving(true); setError('');
    try {
      await api.post(API_ENDPOINTS.leads.temporaryLeadFollowUpClose(row._id), { remarks: closeRemarks.trim() });
      await onSaved?.();
      setCloseOpen(false); setCloseRemarks('');
    } catch (requestError) { setError(requestError?.response?.data?.error || 'Unable to close follow-up.'); }
    finally { setSaving(false); }
  }

  const Item = ({ item, previousItem = false }) => <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm font-black text-slate-900">{item.scheduledDate || '-'}{item.scheduledTime ? ` at ${item.scheduledTime}` : ''}</strong><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${previousItem ? 'bg-slate-100 text-slate-500' : 'bg-orange-100 text-orange-700'}`}>{previousItem ? item.status || 'Previous' : 'Upcoming'}</span></div><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-black text-violet-700">{item.priority || 'Medium'} Priority</span>{!previousItem && <button type="button" onClick={() => { setError(''); setCloseOpen(true); }} className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-700 px-3 text-xs font-black text-white shadow-sm"><CheckCircle2 className="h-4 w-4"/>Close Follow-Up</button>}</div><p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-600">{item.remarks || 'No remarks added.'}</p></article>;

  return <section className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm"><header className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100 bg-gradient-to-r from-white to-emerald-50 px-5 py-4"><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-orange-600">Temporary lead follow-up workflow</p><h3 className="mt-1 text-xl font-black text-slate-950">Follow-Up Tracker · {row.clientName}</h3></div><div className="flex gap-2"><button type="button" onClick={() => setModalOpen(true)} disabled={row.status === 'CONVERTED'} className="inline-flex h-10 items-center gap-2 rounded-xl bg-orange-500 px-4 text-sm font-black text-white shadow-lg shadow-orange-500/20 disabled:opacity-40"><Plus className="h-4 w-4"/>Add Follow-Up</button><button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500"><X className="h-4 w-4"/></button></div></header><div className="space-y-4 p-5"><div className="grid gap-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 sm:grid-cols-2 xl:grid-cols-5"><FollowUpDetail label="Company Name" value={row.clientName}/><FollowUpDetail label="Person Name" value={row.personName || '-'}/><FollowUpDetail label="Email ID" value={row.email || '-'}/><FollowUpDetail label="Phone No." value={row.phone || '-'}/><FollowUpDetail label="Sector" value={row.sector || '-'}/></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><FollowUpMetric icon={CalendarDays} label="Upcoming" value={upcoming.length} tone="orange"/><FollowUpMetric icon={History} label="Previous" value={previous.length} tone="slate"/><FollowUpMetric icon={Clock3} label="Next Time" value={upcoming[0] ? `${upcoming[0].scheduledDate}${upcoming[0].scheduledTime ? ` · ${upcoming[0].scheduledTime}` : ''}` : '-'} tone="teal"/><FollowUpMetric icon={CircleAlert} label="Priority" value={upcoming[0]?.priority || 'Medium'} tone="violet"/></div><div className="grid gap-4 lg:grid-cols-2"><section className="overflow-hidden rounded-xl border border-orange-200"><h4 className="border-b border-orange-200 bg-orange-50 px-4 py-3 font-black text-orange-900">Upcoming Follow-Ups</h4><div className="min-h-36 space-y-3 p-4">{upcoming.length ? upcoming.map((item,index) => <Item key={index} item={item}/>) : <div className="grid min-h-28 place-items-center text-sm font-black text-slate-400">No upcoming follow-ups.</div>}</div></section><section className="overflow-hidden rounded-xl border border-slate-200"><h4 className="border-b border-slate-200 bg-slate-50 px-4 py-3 font-black text-slate-900">Previous Follow-Ups</h4><div className="max-h-72 min-h-36 space-y-3 overflow-y-auto p-4">{previous.length ? previous.map((item,index) => <Item key={item.calendarItemId || index} item={item} previousItem/>) : <div className="grid min-h-28 place-items-center text-sm font-black text-slate-400">No previous follow-ups.</div>}</div></section></div></div>
    {modalOpen && <div className="fixed inset-0 z-[180] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && setModalOpen(false)}><section className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl"><header className="flex items-start justify-between border-b p-5"><div><p className="text-[10px] font-black uppercase tracking-wider text-orange-600">Follow-Up</p><h3 className="mt-1 text-xl font-black">Add Temporary Lead Follow-Up</h3></div><button type="button" onClick={() => setModalOpen(false)} className="grid h-9 w-9 place-items-center rounded-xl bg-slate-50"><X className="h-4 w-4"/></button></header><div className="grid gap-4 p-5 sm:grid-cols-2"><Field label="Scheduled Date" required><input type="date" className="form-input" value={draft.scheduledDate} onChange={(event) => setDraft((current) => ({...current,scheduledDate:event.target.value}))}/></Field><Field label="Scheduled Time"><input type="time" className="form-input" value={draft.scheduledTime} onChange={(event) => setDraft((current) => ({...current,scheduledTime:event.target.value}))}/></Field><Field label="Priority" className="sm:col-span-2"><select className="form-input" value={draft.priority} onChange={(event) => setDraft((current) => ({...current,priority:event.target.value}))}><option>Low</option><option>Medium</option><option>High</option><option>Urgent</option></select></Field><Field label="Follow-Up Remarks" required className="sm:col-span-2"><textarea rows="3" className="form-input" value={draft.remarks} onChange={(event) => setDraft((current) => ({...current,remarks:event.target.value}))} placeholder="Enter follow-up note or outcome"/></Field>{error && <p className="sm:col-span-2 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}</div><footer className="flex justify-end gap-2 border-t bg-slate-50 p-4"><button type="button" onClick={() => setModalOpen(false)} className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black">Cancel</button><button type="button" disabled={saving || !draft.scheduledDate || !draft.remarks.trim()} onClick={save} className="h-10 rounded-xl bg-orange-500 px-5 text-sm font-black text-white disabled:opacity-40">{saving ? 'Saving...' : 'Save Follow-Up'}</button></footer></section></div>}
    {closeOpen && <div className="fixed inset-0 z-[190] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && setCloseOpen(false)}><section className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"><header className="flex items-start justify-between border-b border-emerald-100 bg-emerald-50 p-5"><div><p className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Complete Follow-Up</p><h3 className="mt-1 text-xl font-black text-emerald-950">Close Temporary Lead Follow-Up</h3><p className="mt-1 text-sm font-semibold text-slate-500">{row.tempLeadCode} · {row.clientName}</p></div><button type="button" onClick={() => setCloseOpen(false)} className="grid h-9 w-9 place-items-center rounded-xl bg-white text-slate-500"><X className="h-4 w-4"/></button></header><div className="p-5"><Field label="Closing Remarks" required><textarea autoFocus rows="4" maxLength="500" className="form-input" value={closeRemarks} onChange={(event) => setCloseRemarks(event.target.value)} placeholder="Enter follow-up outcome or closing reason"/></Field><div className="mt-2 flex justify-between text-xs font-bold text-slate-400"><span>This moves the follow-up to Previous Follow-Ups and stops reminders.</span><span>{closeRemarks.length}/500</span></div>{error && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}</div><footer className="flex justify-end gap-2 border-t bg-slate-50 p-4"><button type="button" onClick={() => setCloseOpen(false)} className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black">Cancel</button><button type="button" disabled={saving || !closeRemarks.trim()} onClick={closeCurrentFollowUp} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-700 px-5 text-sm font-black text-white disabled:opacity-40"><CheckCircle2 className="h-4 w-4"/>{saving ? 'Closing...' : 'Close Follow-Up'}</button></footer></section></div>}
  </section>;
}

function QuotationClosureSummary({ quotation, items = [], poRows = [], selectedService = {}, setClosureDialog, uploadClosureFile }) {
  if (!quotation) return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">No quotation was found for this lead. Enter the PO information manually.</div>;
  const combined = quotation.pricingMode === 'combined';
  const rows = poRows.length > items.length ? [...items, ...Array(poRows.length - items.length).fill({})] : items;
  const quotationValue = Number(quotation.combinedBasicAmount || quotation.grandTotal || 0)
    || items.reduce((sum, item) => sum + ((Number(item.unit) || 1) * (Number(item.basicAmount) || 0)), 0);
  const updatePo = (rowIndex, patch) => setClosureDialog((current) => ({ ...current, poYearRows: current.poYearRows.map((row, index) => index === rowIndex ? { ...row, ...patch } : row) }));
  return <section className="overflow-hidden rounded-2xl border border-teal-200 bg-white shadow-sm"><header className="flex flex-wrap items-center justify-between gap-2 bg-teal-50 px-5 py-4"><div><p className="text-xs font-black uppercase tracking-wider text-teal-700">Quotation details auto-fetched</p><strong className="text-slate-900">{quotation.quotationNumber || 'Latest quotation'}</strong></div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-white px-3 py-1 text-xs font-black text-teal-700">CRM Quotation Value: ₹{quotationValue.toLocaleString('en-IN')}</span><span className="rounded-full bg-white px-3 py-1 text-xs font-black text-teal-700">{combined ? 'Combined Price' : 'Individual Price'}</span></div></header><div className="overflow-auto"><table className="w-full min-w-[2200px] text-left text-xs"><thead className="bg-slate-100 uppercase text-slate-500"><tr>{['#', 'EPR / Service Period', 'Industry Type', 'Business Category', 'Service Category', 'Service Start Date', 'Service End Date', 'Applicant Type', 'Unit', 'UOM', 'Basic Amount (INR)', 'PO Number', 'PO Date', 'PO End Date', 'PO Financial Year', poYearLabel(poRows, selectedService), 'Payment Term', 'PO Amount (INR)', 'PO Proof', 'Service'].map((heading) => <th key={heading} className="whitespace-nowrap p-3">{heading}</th>)}</tr></thead><tbody>{rows.map((item, index) => { const po = poRows[index] || {}; return <tr key={item.id || index} className="border-t align-middle"><td className="p-3 font-black">{index + 1}</td><td className="p-3 font-black text-slate-700">{po.fy || item.servicesForYear || item.financialYear || '-'}</td><td className="p-3">{item.industryType || '-'}</td><td className="p-3">{item.businessCategory || '-'}</td><td className="p-3">{item.serviceCategory || item.eprCategory || '-'}</td><td className="p-3">{item.serviceStartDate || '-'}</td><td className="p-3">{item.serviceEndDate || '-'}</td><td className="p-3">{item.subApplicantType || item.piboCategory || item.applicantType || '-'}</td><td className="p-3">{item.unit || '1'}</td><td className="p-3">{item.unitLabel || '-'}</td>{(!combined || index === 0) && <td rowSpan={combined ? rows.length : 1} className={`p-3 font-black text-emerald-700 ${combined ? 'border-l border-r bg-emerald-50 align-middle' : ''}`}>₹{Number(combined ? quotation.combinedBasicAmount || quotation.grandTotal : (Number(item.unit) || 1) * (Number(item.basicAmount) || 0)).toLocaleString('en-IN')}</td>}<td className="p-3"><input required className="form-input min-w-36" value={po.poNumber || ''} onChange={(event) => updatePo(index, { poNumber: event.target.value })} placeholder="PO Number" /></td><td className="p-3"><input required type="date" aria-label={`PO Date row ${index + 1}`} className="form-input min-w-40" value={po.poDate || ''} onChange={(event) => updatePo(index, { poDate: event.target.value })} /></td><PoCommercialFields po={po} selectedService={selectedService} index={index} onChange={(patch) => updatePo(index, patch)} /><td className="p-3"><div className="relative min-w-40"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-black text-slate-500">₹</span><input required type="number" min="0.01" step="0.01" className="form-input pl-7" value={po.poAmount ?? ''} onChange={(event) => updatePo(index, { poAmount: event.target.value })} placeholder="PO Amount" /></div></td><td className="p-3"><label className="flex min-h-11 min-w-36 cursor-pointer items-center justify-center rounded-xl border border-emerald-300 bg-emerald-50 px-3 font-black text-emerald-700"><Upload className="mr-2 h-4 w-4" />{po.poFileName || 'Choose File'}<input type="file" className="sr-only" accept="image/*,.pdf" onChange={(event) => uploadClosureFile(event, 'po', index)} /></label><PoProofView po={po} /></td><td className="p-3 font-bold">{po.services?.[0] || item.servicesOffered || item.applicableService || '-'}</td></tr>; })}{!rows.length && <tr><td colSpan="20" className="p-8 text-center font-bold text-slate-400">No quotation service rows available.</td></tr>}</tbody></table></div></section>;
}

function EarlierQuotationPoDetails({ poRows = [], selectedService = {}, setClosureDialog, uploadClosureFile }) {
  const updatePo = (rowIndex, patch) => setClosureDialog((current) => ({ ...current, poYearRows: current.poYearRows.map((row, index) => index === rowIndex ? { ...row, ...patch } : row) }));
  return <section className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm"><header className="flex flex-wrap items-center justify-between gap-2 bg-amber-50 px-5 py-4"><div><p className="text-xs font-black uppercase tracking-wider text-amber-700">Manual PO details</p><strong className="text-slate-900">Earlier quotation proof attached</strong></div><span className="rounded-full bg-white px-3 py-1 text-xs font-black text-amber-700">CRM quotation not used</span></header><div className="overflow-auto"><table className="w-full min-w-[1100px] text-left text-xs"><thead className="bg-slate-100 uppercase text-slate-500"><tr>{['#', 'EPR / Service Period', 'PO Number', 'PO Date', 'PO End Date', 'PO Financial Year', poYearLabel(poRows, selectedService), 'Payment Term', 'PO Amount (INR)', 'PO Proof', 'Service'].map((heading) => <th key={heading} className="whitespace-nowrap p-3">{heading}</th>)}</tr></thead><tbody>{poRows.map((po, index) => <tr key={index} className="border-t align-middle"><td className="p-3 font-black">{index + 1}</td><td className="p-3 font-black text-slate-700">{po.fy || '-'}</td><td className="p-3"><input required className="form-input min-w-36" value={po.poNumber || ''} onChange={(event) => updatePo(index, { poNumber: event.target.value })} placeholder="PO Number" /></td><td className="p-3"><input required type="date" aria-label={`PO Date row ${index + 1}`} className="form-input min-w-40" value={po.poDate || ''} onChange={(event) => updatePo(index, { poDate: event.target.value })} /></td><PoCommercialFields po={po} selectedService={selectedService} index={index} onChange={(patch) => updatePo(index, patch)} /><td className="p-3"><div className="relative min-w-40"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-black text-slate-500">₹</span><input required type="number" min="0.01" step="0.01" className="form-input pl-7" value={po.poAmount ?? ''} onChange={(event) => updatePo(index, { poAmount: event.target.value })} placeholder="Enter PO Amount" /></div></td><td className="p-3"><label className="flex min-h-11 min-w-36 cursor-pointer items-center justify-center rounded-xl border border-amber-300 bg-amber-50 px-3 font-black text-amber-700"><Upload className="mr-2 h-4 w-4" />{po.poFileName || 'Choose File'}<input type="file" className="sr-only" accept="image/*,.pdf" onChange={(event) => uploadClosureFile(event, 'po', index)} /></label><PoProofView po={po} /></td><td className="p-3 font-bold">{po.services?.[0] || '-'}</td></tr>)}{!poRows.length && <tr><td colSpan="11" className="p-8 text-center font-bold text-slate-400">No service rows available.</td></tr>}</tbody></table></div></section>;
}

function Field({ label, required, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-black text-slate-700">{label} {required && <span className="text-red-500">*</span>}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

function SelectLike({ label, required, value, options = [], onChange, disabled = false, placeholder = 'Select or type to create new' }) {
  return (
    <Field label={label} required={required}>
      <SearchableSelect value={value} options={options} onChange={onChange} disabled={disabled} placeholder={placeholder} />
    </Field>
  );
}

function useCountUp(value, active, duration = 850) {
  const [displayValue, setDisplayValue] = useState(active ? value : 0);

  useEffect(() => {
    if (!active) {
      setDisplayValue(0);
      return undefined;
    }

    const start = performance.now();
    const from = 0;
    const to = Number(value) || 0;
    let frameId;

    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(from + (to - from) * eased));
      if (progress < 1) frameId = requestAnimationFrame(tick);
    }

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [active, duration, value]);

  return displayValue;
}

function LeadStoryStats({ stats, activeFilter, onFilterChange }) {
  const [visibleCount, setVisibleCount] = useState(1);

  useEffect(() => {
    setVisibleCount(1);
    const timers = stats.slice(1).map((_, index) =>
      window.setTimeout(() => setVisibleCount(index + 2), 900 * (index + 1))
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [stats.length]);

  return (
    <section className="lead-story-panel">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">Lead Performance Flow</p>
          <h2 className="mt-2 text-3xl font-black text-slate-950">Live lead movement</h2>
        </div>
        <p className="max-w-xl text-sm font-bold text-slate-500">
          Each number opens in sequence so the dashboard feels alive while still staying clear and scan-friendly.
        </p>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4 xl:gap-6">
        {stats.map((stat, index) => (
          <LeadStoryCard
            key={stat.label}
            stat={stat}
            index={index}
            active={index < visibleCount}
            selected={Boolean(stat.filter && activeFilter === stat.filter)}
            onSelect={stat.filter ? () => onFilterChange(stat.filter) : undefined}
            showArrow={index < stats.length - 1}
            arrowActive={index < visibleCount - 1}
          />
        ))}
      </div>
    </section>
  );
}

function LeadStoryCard({ stat, index, active, selected, onSelect, showArrow, arrowActive }) {
  const Icon = stat.icon;
  const value = useCountUp(stat.value, active);
  const Component = onSelect ? 'button' : 'article';

  return (
    <Component type={onSelect ? 'button' : undefined} onClick={onSelect} className={`lead-story-card lead-story-${stat.tone} ${active ? 'lead-story-card-active' : ''} ${selected ? 'lead-story-card-selected' : ''}`} style={{ '--delay': `${index * 110}ms` }}>
      {showArrow && <span className={`lead-story-arrow ${arrowActive ? 'lead-story-arrow-active' : ''}`} />}
      <div className="lead-story-topline" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-black uppercase tracking-[0.14em] text-slate-500">{stat.label}</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
        </div>
        <span className="lead-story-icon">
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-3 text-[11px] font-black uppercase leading-4 text-slate-500">{stat.note}</p>
    </Component>
  );
}

function MetricOutputCard({ stat, leads, onClose, onExport }) {
  const Icon = stat.icon;
  const preview = leads.slice(0, 10);

  return (
    <section className={`metric-output-card lead-story-${stat.tone}`}>
      <div className="flex flex-col gap-4 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="lead-story-icon">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Selected Output</p>
            <h3 className="truncate text-xl font-black text-slate-950">{stat.label}</h3>
          </div>
          <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-black text-slate-700">{leads.length} records</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onExport} className="btn-lift inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-black text-white shadow-lg shadow-emerald-600/20">
            <Download className="h-4 w-4" /> Export
          </button>
          <button type="button" onClick={onClose} className="btn-lift inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-slate-600 hover:bg-slate-50">
            <X className="h-4 w-4" /> Close
          </button>
        </div>
      </div>

      <div className="hidden-scrollbar max-h-[320px] overflow-auto">
        <table className="crm-data-table w-full min-w-[980px] table-fixed text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-black uppercase tracking-[0.06em] text-slate-500">
            <tr>
              {['Lead ID', 'Company', 'City', 'State', 'Contact', 'Mobile', 'Status'].map((header) => (
                <th key={header} className="px-4 py-3">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {preview.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center font-black text-slate-400">No records found.</td></tr>
            ) : preview.map((item) => (
              <tr key={item._id || item.id} className="transition hover:bg-orange-50/60">
                <td className="px-4 py-3 font-black text-slate-900"><span className="cell-clip">{displayLeadId(item)}</span></td>
                <td className="px-4 py-3 font-black uppercase text-slate-600"><span className="cell-clamp">{item.company || '-'}</span></td>
                <td className="px-4 py-3 font-black uppercase text-slate-500"><span className="cell-clip">{item.city || '-'}</span></td>
                <td className="px-4 py-3 font-black uppercase text-slate-500"><span className="cell-clip">{item.state || '-'}</span></td>
                <td className="px-4 py-3 font-black uppercase text-slate-500"><span className="cell-clip">{item.contactPerson || '-'}</span></td>
                <td className="px-4 py-3 font-black text-slate-500"><span className="cell-clip">{item.mobileNo1 || '-'}</span></td>
                <td className="px-4 py-3"><span className="rounded-lg bg-lime-50 px-3 py-1 text-xs font-black text-lime-700 ring-1 ring-lime-200">{item.status || 'Draft'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {leads.length > preview.length && (
        <p className="border-t border-slate-100 px-4 py-3 text-sm font-bold text-slate-500">
          Showing first {preview.length} records here. Export includes all {leads.length} filtered records.
        </p>
      )}
    </section>
  );
}

function todayDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function formatFollowUpDate(value) {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function buildLeadFollowUpRows(lead = {}) {
  const rows = [];
  if (lead.nextFollowUpDate || lead.nextFollowUpTime || lead.followUpRemarks) {
    rows.push({
      id: 'current-follow-up',
      isCurrent: true,
      scheduledDate: lead.nextFollowUpDate || '',
      scheduledTime: lead.nextFollowUpTime || '',
      remarks: lead.followUpRemarks || '',
      reason: 'Current follow-up',
      status: 'open',
      priority: lead.followUpPriority || 'Medium',
      owner: lead.importedCreatedBy || lead.createdByName || lead.createdByEmail || 'Lead creator',
      serviceName: lead.servicesOffered || 'Lead follow-up',
      createdAt: lead.updatedAt || lead.createdAt || ''
    });
  }
  (Array.isArray(lead.followUpHistory) ? lead.followUpHistory : []).forEach((item, index) => {
    rows.push({
      id: item.id || `history-${index}`,
      isCurrent: false,
      scheduledDate: item.scheduledDate || item.nextFollowUpDate || '',
      scheduledTime: item.scheduledTime || item.nextFollowUpTime || '',
      remarks: item.remarks || item.followUpRemarks || '',
      reason: item.reason || item.updateReason || '',
      status: item.status || 'closed',
      closedAt: item.closedAt || item.updatedAt || item.createdAt || '',
      priority: item.priority || item.followUpPriority || 'Medium',
      createdAt: item.createdAt || ''
    });
  });
  (Array.isArray(lead.serviceSelections) ? lead.serviceSelections : []).forEach((service, serviceIndex) => {
    if (service.nextFollowUpDate || service.nextFollowUpTime || service.followUpRemarks) rows.push({
      id: `service-current-${serviceIndex}`, isCurrent: true, serviceIndex,
      scheduledDate: service.nextFollowUpDate || '', scheduledTime: service.nextFollowUpTime || '',
      remarks: service.followUpRemarks || '', reason: 'Current service follow-up',
      status: 'open',
      priority: service.followUpPriority || 'Medium', owner: service.createdByName || service.createdByEmail || 'Service owner',
      serviceName: service.servicesOffered || service.applicableService || `Service ${serviceIndex + 1}`,
      createdAt: service.followUpUpdatedAt || lead.updatedAt || ''
    });
    (Array.isArray(service.followUpHistory) ? service.followUpHistory : []).forEach((item, historyIndex) => rows.push({
      ...item, id: item.id || `service-${serviceIndex}-history-${historyIndex}`, isCurrent: false, serviceIndex,
      status: item.status || 'closed',
      closedAt: item.closedAt || item.updatedAt || item.createdAt || '',
      owner: item.owner || service.createdByName || service.createdByEmail || 'Service owner',
      serviceName: service.servicesOffered || service.applicableService || `Service ${serviceIndex + 1}`
    }));
  });
  return rows;
}

function LeadToolbarMenu({ label, icon: Icon, tone = 'emerald', options = [] }) {
  const [open, setOpen] = useState(false);
  const palette = tone === 'blue'
    ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
    : tone === 'violet'
      ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/20'
      : 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20';

  return (
    <div className="relative z-[90]">
      <button type="button" onClick={() => setOpen((current) => !current)} className={`btn-lift inline-flex min-h-10 items-center gap-2 rounded-lg px-5 text-sm font-black ${palette}`}>
        <Icon className="h-4 w-4" />{label}<ChevronDown className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <button type="button" aria-label={`Close ${label} menu`} onClick={() => setOpen(false)} className="fixed inset-0 z-[85] cursor-default" />
          <div className="absolute right-0 top-[calc(100%+10px)] z-[95] min-w-[220px] overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
            {options.map((option) => {
              const OptionIcon = option.icon || Plus;
              return (
                <button
                  key={option.label}
                  type="button"
                  disabled={option.disabled}
                  onClick={() => {
                    setOpen(false);
                    if (!option.disabled) option.onClick?.();
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-black transition ${
                    option.disabled
                      ? 'cursor-not-allowed text-slate-300'
                      : 'text-slate-700 hover:bg-emerald-50 hover:text-emerald-700'
                  }`}
                >
                  <OptionIcon className="h-4 w-4" />
                  <span className="flex-1">{option.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function SavedLeadPoDetails({ assignments = [], services = [] }) {
  const rows = assignments.flatMap((assignment, index) => [...(assignment.poYearRows || []), ...(assignment.originalPoDetails ? [assignment.originalPoDetails] : [])].map((po) => ({ ...po, serviceLabel: po.service || (po.services || []).join(', ') || services[index]?.servicesOffered || 'Service' })));
  if (!rows.length) return null;
  return <section className="overflow-hidden rounded-xl border border-emerald-200 bg-white"><header className="border-b border-emerald-100 bg-emerald-50 px-5 py-4"><h3 className="font-black text-slate-900">Purchase Order Details</h3><p className="mt-1 text-xs text-slate-500">Saved PO dates, financial year and payment terms</p></header><div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Service', 'PO Number', 'PO Date', 'PO End Date', 'PO Financial Year', 'Annual Return Year', 'Registration Year', 'Payment Term', 'Amount (INR)', 'Proof'].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody>{rows.map((po, index) => <tr key={index} className="border-t border-slate-100"><td className="px-4 py-4 font-bold">{po.serviceLabel}</td><td className="px-4 py-4 font-black text-emerald-800">{po.poNumber || '-'}</td><td className="whitespace-nowrap px-4 py-4">{formatDisplayDate(po.poDate)}</td><td className="whitespace-nowrap px-4 py-4">{formatDisplayDate(po.poEndDate)}</td><td className="px-4 py-4"><span className="rounded-lg bg-indigo-50 px-3 py-1 font-bold text-indigo-700">{po.poFinancialYear || '-'}</span></td><td className="px-4 py-4">{po.annualReturnYear || '-'}</td><td className="px-4 py-4">{po.registrationYear || '-'}</td><td className="max-w-xs whitespace-pre-wrap break-words px-4 py-4">{po.paymentTerm || '-'}</td><td className="whitespace-nowrap px-4 py-4 font-bold">{Number(po.poAmount || 0).toLocaleString('en-IN')}</td><td className="px-4 py-4">{po.poFileUrl ? <a href={po.poFileUrl} target="_blank" rel="noopener noreferrer" className="font-bold text-emerald-700">View PO</a> : '-'}</td></tr>)}</tbody></table></div></section>;
}

function LeadDetailView({ lead, quotations = [], staff = [], currentUser = null, onBack, onEdit, onQuotationAction, onProformaAction, onLeadUpdated, onModifyPo, canEdit = false }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [detailLead, setDetailLead] = useState(lead);
  const [followUpModalOpen, setFollowUpModalOpen] = useState(false);
  const [followUpEditing, setFollowUpEditing] = useState(false);
  const [followUpCloseMode, setFollowUpCloseMode] = useState(false);
  const [viewFollowUp, setViewFollowUp] = useState(null);
  const [followUpSaving, setFollowUpSaving] = useState(false);
  const [followUpError, setFollowUpError] = useState('');
  const [assignmentSavingIndex, setAssignmentSavingIndex] = useState(-1);
  const [detailKickoffDialog, setDetailKickoffDialog] = useState(null);
  const [permanentCloseStep, setPermanentCloseStep] = useState('');
  const [permanentCloseSaving, setPermanentCloseSaving] = useState(false);
  const [permanentCloseError, setPermanentCloseError] = useState('');
  const [originalPoRows, setOriginalPoRows] = useState([]);
  const [originalPoUploadingIndex, setOriginalPoUploadingIndex] = useState(-1);
  const [detailToast, setDetailToast] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyData, setHistoryData] = useState({ events: [], summary: {} });
  const [historyFilter, setHistoryFilter] = useState('all');
  const [followUpDraft, setFollowUpDraft] = useState({
    serviceIndex: '',
    scheduledDate: todayDateKey(),
    scheduledTime: '',
    remarks: '',
    reason: '',
    priority: 'Medium'
  });
  useEffect(() => {
    setDetailLead(lead);
  }, [lead]);
  const detailLeadIdentity = String(lead?._id || lead?.id || lead?.sourceLeadId || '').trim();
  useEffect(() => {
    if (!detailLeadIdentity) return undefined;
    let mounted = true;
    api.get(API_ENDPOINTS.leads.list)
      .then((response) => {
        if (!mounted) return;
        const freshLead = (response.data?.leads || []).find((item) => [item?._id, item?.id, item?.sourceLeadId, item?.externalLeadId]
          .filter(Boolean).some((value) => String(value) === detailLeadIdentity));
        if (!freshLead) return;
        setDetailLead(freshLead);
        onLeadUpdated?.(freshLead);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [detailLeadIdentity]);
  const activeLead = detailLead || lead;
  const leadIsClosed = Boolean(
    activeLead.closedBy
    || activeLead.closedByText
    || activeLead.closedAt
    || (Array.isArray(activeLead.assignments) && activeLead.assignments.some((row) => row?.closedBy || row?.closedByText))
  );
  const detailAssignments = Array.isArray(activeLead.assignments) && activeLead.assignments.length
    ? activeLead.assignments
    : [createAssignmentRow(activeLead)];
  const hasProvisionalClosure = detailAssignments.some((row) => row?.poStatus === 'provisional');
  // API rows use subApplicantType while older CCP payloads use piboCategory.
  // Normalize once so every detail table renders the same service values.
  const detailServices = normalizeLegacyServiceSelections(activeLead);
  const buildOriginalPoRows = () => detailAssignments.flatMap((assignment, assignmentIndex) => {
    if (assignment?.poStatus !== 'provisional') return [];
    const service = detailServices[assignmentIndex] || detailServices.at(-1) || {};
    return [{
      assignmentIndex,
      assignedServiceId: assignment.assignedServiceId || service.assignedServiceId || '',
      fy: service.firstAnnualReturnYearApplicable || activeLead.firstAnnualReturnYearApplicable || '',
      poNumber: '', poDate: '', poAmount: '',
      service: service.servicesOffered || service.applicableService || service.eprCategory || `Service ${assignmentIndex + 1}`,
      poFileUrl: '', poFileName: '', poFileType: '', poFileSize: 0, poPublicId: '', poUploadedAt: ''
    }];
  });
  const currentUserTokens = [currentUser?._id, currentUser?.id, currentUser?.crmUserId, currentUser?.userId, currentUser?.email, currentUser?.name]
    .filter(Boolean).map((item) => String(item).trim().toLowerCase());
  const ownedServiceOptions = detailServices.map((service, index) => ({ service, index, ownerTokens: [service.createdByCrmUserId, service.createdByEmail, service.createdByName].filter(Boolean).map((item) => String(item).trim().toLowerCase()) }))
    .filter(({ ownerTokens }) => ownerTokens.some((token) => currentUserTokens.includes(token)))
    .map(({ service, index }) => ({ value: String(index), label: `${service.servicesOffered || service.applicableService || `Service ${index + 1}`} · ${service.createdByName || service.createdByEmail || 'You'}` }));
  const currentUserHasOpenService = ownedServiceOptions.some((option) => {
    const index = Number(option.value);
    const service = detailServices[index] || {};
    const assignment = detailAssignments[index] || {};
    return !(service.closedBy || service.closedByText || service.closedAt || assignment.closedBy || assignment.closedByText || assignment.closedAt);
  });
  const showCurrentUserServiceActions = canEdit || !leadIsClosed || currentUserHasOpenService;
  const isManager = String(currentUser?.role || '').toLowerCase() === 'manager';
  const isAssignmentAdmin = adminRoles.includes(String(currentUser?.role || '').toLowerCase());
  const detailStaffOptions = staff.flatMap((user) => {
    const label = `${user.name || user.email} (${user.team || 'No team assigned'})`;
    return [user._id, user.id, user.crmUserId, user.userId]
      .filter(Boolean)
      .map((id) => ({ value: String(id), label }));
  });

  async function requestTemporaryUser(index, value) {
    if (!value) return;
    const selected = staff.find((user) => [user._id, user.id, user.crmUserId, user.userId].filter(Boolean).some((id) => String(id) === String(value)));
    const row = detailAssignments[index];
    const currentTemporary = row?.temporaryUser;
    const isExtension = currentTemporary?.status === 'ACTIVE';
    const message = isExtension
      ? `Request a 7-day extension for ${selected?.name || selected?.email || 'this temporary user'}? Permanent ownership will not change and Super Admin approval is required.`
      : `Request 7-day temporary access for ${selected?.name || selected?.email || 'this user'}? Permanent ownership will not change and Super Admin approval is required.`;
    if (!window.confirm(message)) return;
    setAssignmentSavingIndex(index);
    try {
      const leadId = activeLead._id || activeLead.id || activeLead.sourceLeadId;
      const response = await api.post(API_ENDPOINTS.leads.temporaryAssignment(leadId), { rowIndex: index, temporaryUserId: value, days: 7 });
      const assignments = detailAssignments.map((item, rowIndex) => rowIndex === index ? { ...item, temporaryUser: response.data?.temporaryUser } : item);
      const updatedLead = { ...activeLead, assignments };
      setDetailLead(updatedLead);
      onLeadUpdated?.(updatedLead);
      window.alert('Temporary assignment request sent to Super Admin for approval.');
    } catch (requestError) {
      window.alert(requestError?.response?.data?.error || 'Unable to request temporary assignment.');
    } finally {
      setAssignmentSavingIndex(-1);
    }
  }

  async function assignStaffFromDetail(index, value, kickoffEmailConsent = '') {
    const row = detailAssignments[index];
    const managerOwnsRow = currentUserTokens.includes(String(row?.assignedTo?._id || row?.assignedTo || ''));
    if ((!isManager || !managerOwnsRow) && !isAssignmentAdmin) return;
    const selected = staff.find((user) => [user._id, user.id, user.crmUserId, user.userId]
      .filter(Boolean).some((id) => String(id) === String(value)));
    setAssignmentSavingIndex(index);
    try {
      const leadId = activeLead._id || activeLead.id || activeLead.sourceLeadId;
      const response = await api.patch(API_ENDPOINTS.leads.staffAssignment(leadId, index), {
        staffUserId: value,
        kickoffEmailConsent: value ? kickoffEmailConsent : ''
      });
      const responseLead = response.data?.lead || response.data?.data?.lead || response.data?.data;
      const savedAssignment = response.data?.assignment || {};
      const savedAssignments = Array.isArray(responseLead?.assignments)
        ? responseLead.assignments
        : detailAssignments.map((item, rowIndex) => rowIndex === index ? {
          ...item,
          ...savedAssignment,
          assignedStaff: savedAssignment.assignedStaff || value,
          assignedStaffText: savedAssignment.assignedStaffText || selected?.name || selected?.email || '',
          assignedStaffEmail: savedAssignment.assignedStaffEmail || selected?.email || '',
          kickoffEmailConsent: value ? kickoffEmailConsent : ''
        } : item);
      const updatedLead = {
        ...activeLead,
        ...(responseLead && typeof responseLead === 'object' ? responseLead : {}),
        assignments: savedAssignments
      };
      setDetailLead(updatedLead);
      onLeadUpdated?.(updatedLead);
      setDetailToast({ id: Date.now(), type: 'success', message: response.data?.message || (value ? 'Staff member assigned successfully.' : 'Staff assignment removed.') });
    } catch (error) {
      setDetailToast({
        id: Date.now(),
        type: 'error',
        message: error?.response?.data?.error
          || error?.response?.data?.message
          || error?.message
          || 'Unable to assign the staff member. Please try again.'
      });
    } finally {
      setAssignmentSavingIndex(-1);
    }
  }

  function requestStaffAssignmentFromDetail(index, value) {
    if (!value) {
      assignStaffFromDetail(index, '', '');
      return;
    }
    setDetailKickoffDialog({ index, value });
  }

  function confirmDetailKickoffEmail(sendEmail) {
    const pendingAssignment = detailKickoffDialog;
    if (!pendingAssignment) return;
    setDetailKickoffDialog(null);
    assignStaffFromDetail(pendingAssignment.index, pendingAssignment.value, sendEmail ? 'yes' : 'no');
  }

  async function permanentlyCloseLead() {
    const commercialError = originalPoRows.map(poCommercialError).find(Boolean);
    if (commercialError) { setPermanentCloseError(commercialError); return; }
    const incompletePoRow = !originalPoRows.length || originalPoRows.some((row) => poCommercialError(row) || !row.fy || !row.poNumber.trim() || !row.poDate || !(Number(row.poAmount) > 0) || !row.poFileUrl || !row.service);
    if (incompletePoRow) {
      setPermanentCloseError('Complete PO Number, PO Date, PO Amount, and PO Proof for every service before permanently closing the lead.');
      return;
    }
    const leadId = activeLead._id || activeLead.id || activeLead.sourceLeadId;
    setPermanentCloseSaving(true);
    setPermanentCloseError('');
    try {
      const response = await api.post(API_ENDPOINTS.leads.permanentClosure(leadId), { originalPoReceived: true, originalPoRows });
      const updatedLead = response.data?.lead;
      if (!updatedLead) throw new Error('CRM did not return the permanently closed lead.');
      setDetailLead(updatedLead);
      onLeadUpdated?.(updatedLead);
      setPermanentCloseStep('');
      setOriginalPoRows([]);
      setDetailToast({ id: Date.now(), type: 'success', message: 'All original PO details were saved and the lead was permanently closed. It will not reopen automatically.' });
    } catch (error) {
      setPermanentCloseError(error?.response?.data?.error || error.message || 'Unable to permanently close the lead.');
    } finally {
      setPermanentCloseSaving(false);
    }
  }

  function updateOriginalPoRow(rowIndex, patch) {
    setOriginalPoRows((current) => current.map((row, index) => index === rowIndex ? { ...row, ...patch } : row));
  }

  async function uploadOriginalPo(event, rowIndex) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.type.startsWith('image/')) {
      setPermanentCloseError('Upload the original PO as a PDF or image file.');
      return;
    }
    setOriginalPoUploadingIndex(rowIndex);
    setPermanentCloseError('');
    try {
      const uploaded = await uploadMedia(file, 'crm/leads/original-purchase-orders');
      updateOriginalPoRow(rowIndex, {
        poFileUrl: uploaded.secureUrl || uploaded.url,
        poFileName: uploaded.name || file.name,
        poFileType: uploaded.type || file.type,
        poFileSize: uploaded.bytes || uploaded.size || file.size,
        poPublicId: uploaded.publicId || '',
        poUploadedAt: uploaded.uploadedAt || new Date().toISOString()
      });
    } catch (error) {
      updateOriginalPoRow(rowIndex, { poFileUrl: '', poFileName: '', poFileType: '', poFileSize: 0, poPublicId: '', poUploadedAt: '' });
      setPermanentCloseError(error?.message || 'Original PO upload failed. Please retry.');
    } finally {
      setOriginalPoUploadingIndex(-1);
    }
  }

  function declineOriginalPoConfirmation() {
    setPermanentCloseStep('');
    setDetailToast({ id: Date.now(), type: 'warning', message: 'This lead will reopen automatically within 7 business days. Kindly permanently close the lead before the deadline.' });
  }

  const hasBusinessCard = Boolean(activeLead.businessCardUrl);
  const companyName = activeLead.company || 'Lead Details';
  const initials = companyName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'LD';
  const leadQuotations = quotations.filter((quotation) => {
    const normalize = (value) => String(value || '').trim().toLowerCase();
    const crmLeadIds = [activeLead._id, activeLead.id].map(normalize).filter(Boolean);
    const sourceLeadIds = [activeLead.sourceLeadId, activeLead.externalLeadId, activeLead._id, activeLead.id].map(normalize).filter(Boolean);
    const quotationLeadId = normalize(quotation.leadId?._id || quotation.leadId?.id || quotation.leadId);
    const quotationSourceLeadId = normalize(quotation.sourceLeadId || quotation.externalLeadId || quotation.leadId);
    const quotationLeadCode = normalize(quotation.leadCode);
    return Boolean(
      (quotationLeadId && crmLeadIds.includes(quotationLeadId))
      || (quotationSourceLeadId && sourceLeadIds.includes(quotationSourceLeadId))
      || (quotationLeadCode && quotationLeadCode === normalize(activeLead.leadCode))
    );
  });
  const revisableLeadQuotations = leadQuotations.filter((quotation) => {
    const status = String(quotation?.status || '').trim().toLowerCase();
    return status === 'approved' || status === 'rejected';
  });
  const ownedServiceIndexes = new Set(ownedServiceOptions.map((option) => Number(option.value)));
  const followUpRows = buildLeadFollowUpRows(activeLead).map((item) => ({
    ...item,
    canEdit: item.isCurrent && (Number.isInteger(item.serviceIndex) ? ownedServiceIndexes.has(item.serviceIndex) : ownedServiceIndexes.has(0))
  }));
  const todayKey = todayDateKey();
  const upcomingFollowUps = followUpRows
    .filter((item) => item.isCurrent && item.scheduledDate && item.scheduledDate >= todayKey)
    .sort((a, b) => `${a.scheduledDate} ${a.scheduledTime}`.localeCompare(`${b.scheduledDate} ${b.scheduledTime}`));
  const previousFollowUps = followUpRows
    .filter((item) => !item.isCurrent || !item.scheduledDate || item.scheduledDate < todayKey)
    .sort((a, b) => `${b.scheduledDate} ${b.scheduledTime}`.localeCompare(`${a.scheduledDate} ${a.scheduledTime}`));
  const basicInfoRows = [
    ['Lead ID', displayLeadId(activeLead), FileText],
    ['Company', activeLead.company, Building2],
    ['Industry', activeLead.industryType, Building2],
    ['Status', activeLead.status, CheckCircle2, 'pill'],
    ['Service Category', activeLead.eprCategory, FileText],
    ['Applicant Type', activeLead.piboCategory, FileText],
    ['Services Offered', activeLead.servicesOffered, CheckCircle2],
    ['Source', activeLead.source, FileText]
  ];
  const addressInfoRows = [
    ['Address Line 1', activeLead.addressLine1, MapPin],
    ['Address Line 2', activeLead.addressLine2, MapPin],
    ['Address Line 3', activeLead.addressLine3, MapPin],
    ['State', activeLead.state, MapPin],
    ['City', activeLead.city, MapPin],
    ['PIN', activeLead.pinCode, MapPin],
    ['Website', activeLead.website, Eye],
    ['Notes', activeLead.notes || 'Not specified', FileText]
  ];
  const contactInfoRows = [
    ['Contact Person', activeLead.contactPerson, ContactRound],
    ['Designation', activeLead.designation, ContactRound],
    ['Mobile 1', activeLead.mobileNo1, Phone],
    ['Mobile 2', activeLead.mobileNo2, Phone],
    ['WhatsApp', activeLead.whatsappNo, Phone],
    ['LinkedIn', activeLead.linkedinUrl, Eye],
    ['Email', activeLead.emails, Mail],
    ['Referred By', activeLead.referredBy, UserCheck]
  ];
  const tabs = [
    { id: 'overview', label: 'Overview', icon: FileText },
    { id: 'followup', label: 'Follow-Up', icon: Clock3 }
  ];

  async function sendIntroMail() {
    const email = String(activeLead.emails || '').split(/[,\s;]+/).find(Boolean);
    // A mailto handoff cannot confirm delivery, so no success audit is recorded here.
    if (email) window.location.href = `mailto:${email}?subject=${encodeURIComponent(`Introduction from Anant Tattva`)}`;
  }

  async function openHistory() {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryFilter('all');
    const leadId = activeLead._id || activeLead.id || activeLead.sourceLeadId;
    const identifiers = Object.fromEntries(Object.entries({ leadCode: activeLead.leadCode, company: activeLead.company }).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== ''));
    const fallbackEvents = [
        { id: 'lead-created', type: 'lead_created', title: 'Lead created', description: `${activeLead.leadCode || 'Lead'} created for ${activeLead.company || 'the company'}`, actor: activeLead.importedCreatedBy || activeLead.assignedBy || 'Imported user', at: activeLead.createdAt || activeLead.importedCreatedAt || activeLead.leadDate },
        ...(activeLead.serviceSelections || []).map((row, index) => ({ id: `service-${index}`, type: 'service_added', title: `Service row ${index + 1} added`, description: `${row.industryType || 'Industry not set'} · ${row.servicesOffered || row.eprCategory || 'Service not set'}`, actor: row.createdByName || row.createdByEmail || activeLead.importedCreatedBy || 'CRM User', at: row.createdAt || activeLead.createdAt || activeLead.importedCreatedAt || activeLead.leadDate })),
        ...detailAssignments.map((row, index) => ({ id: `assignment-${index}`, type: 'lead_assignment', title: `Assignment row ${index + 1}`, description: `Manager: ${row.assignedTo?.name || row.assignedToText || '-'} · Staff: ${row.assignedStaff?.name || row.assignedStaffText || 'Not assigned'} · Closed by: ${row.closedBy?.name || row.closedByText || '-'}`, actor: row.assignedBy || activeLead.assignedBy || activeLead.importedCreatedBy || 'CRM User', at: row.assignedAt || row.updatedAt || activeLead.updatedAt || activeLead.importedUpdatedAt || activeLead.createdAt })),
        ...(activeLead.emailHistory || []).map((item, index) => ({ id: `email-${item.id || index}`, type: 'email_sent', title: item.subject || 'Email sent', description: `Email sent to ${item.recipient || item.to || activeLead.emails || 'client'}`, actor: item.sentBy || item.actor || 'CRM User', at: item.sentAt || item.createdAt })),
        ...(activeLead.updatedAt || activeLead.importedUpdatedAt ? [{ id: 'lead-last-updated', type: 'lead_updated', title: 'Lead last updated', description: `Current status: ${activeLead.status || 'Draft'}`, actor: activeLead.updatedByText || activeLead.updatedBy || activeLead.assignedBy || 'CRM User', at: activeLead.updatedAt || activeLead.importedUpdatedAt }] : []),
        ...leadQuotations.map((item) => ({ id: `quote-${item._id || item.id}`, type: 'quotation_created', title: 'Quotation created', description: `${item.quotationNumber || 'Quotation'} added`, actor: item.createdBy?.name || item.createdBy?.email || 'CRM User', at: item.createdAt })),
        ...followUpRows.map((item, index) => ({ id: `follow-${index}`, type: 'follow_up', title: 'Lead follow-up', description: item.remarks || 'Follow-up updated', actor: item.updatedBy || 'CRM User', at: item.createdAt || item.updatedAt || item.scheduledDate }))
      ].filter((item) => item.at);
    try {
      const [crmResult] = await Promise.allSettled([
        api.get(API_ENDPOINTS.leads.history(leadId), { params: identifiers })
      ]);
      const remoteEvents = [crmResult].flatMap((result) => result.status === 'fulfilled' ? (result.value.data?.events || []) : []);
      const unique = new Map();
      [...remoteEvents, ...fallbackEvents].forEach((event) => { if (event?.id && !unique.has(String(event.id))) unique.set(String(event.id), event); });
      const events = [...unique.values()].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
      const group = (type = '') => type.includes('quotation') || type.includes('approval') ? 'quotation' : type.includes('follow') ? 'followup' : type.includes('todo') ? 'todo' : type.includes('email') ? 'email' : 'lead';
      setHistoryData({ lead: { leadCode: activeLead.leadCode, company: activeLead.company }, events, summary: { total: events.length, quotations: events.filter((event) => group(event.type) === 'quotation').length, followUps: events.filter((event) => group(event.type) === 'followup').length, todos: events.filter((event) => group(event.type) === 'todo').length, emails: events.filter((event) => group(event.type) === 'email').length }, sourceStatus: { crm: crmResult.status } });
    } finally {
      setHistoryLoading(false);
    }
  }

  function openFollowUpModal(item = null) {
    const serviceIndex = item?.serviceIndex ?? Number(ownedServiceOptions[0]?.value ?? -1);
    const service = detailServices[serviceIndex] || {};
    if (serviceIndex < 0) {
      setFollowUpError('You can add follow-ups only for a service added by you.');
      setFollowUpModalOpen(true);
      return;
    }
    setFollowUpEditing(Boolean(item));
    setFollowUpCloseMode(false);
    setFollowUpDraft({
      serviceIndex: String(serviceIndex),
      scheduledDate: item?.scheduledDate || service.nextFollowUpDate || todayDateKey(),
      scheduledTime: item?.scheduledTime || service.nextFollowUpTime || '',
      remarks: item?.remarks || service.followUpRemarks || '',
      reason: '',
      priority: item?.priority || service.followUpPriority || 'Medium'
    });
    setFollowUpError('');
    setFollowUpModalOpen(true);
  }

  async function saveFollowUp() {
    if (!followUpDraft.scheduledDate || !followUpDraft.remarks.trim()) {
      setFollowUpError('Scheduled date and follow-up remarks are required.');
      return;
    }
    if (followUpEditing && !followUpDraft.reason.trim()) {
      setFollowUpError('Please provide a reason for updating this follow-up.');
      return;
    }
    const leadId = activeLead._id || activeLead.id;
    if (!leadId) {
      setFollowUpError('This lead cannot be updated because its CRM id is missing.');
      return;
    }
    const serviceIndex = Number(followUpDraft.serviceIndex);
    const selectedService = detailServices[serviceIndex];
    if (!selectedService || !ownedServiceOptions.some((option) => Number(option.value) === serviceIndex)) {
      setFollowUpError('Select a service added by you.');
      return;
    }
    const previousCurrent = selectedService.nextFollowUpDate || selectedService.nextFollowUpTime || selectedService.followUpRemarks
      ? [{
          id: `previous-${Date.now()}`,
          scheduledDate: selectedService.nextFollowUpDate || '',
          scheduledTime: selectedService.nextFollowUpTime || '',
          remarks: selectedService.followUpRemarks || '',
          reason: followUpDraft.reason.trim() || 'Previous current follow-up',
          status: 'closed',
          owner: currentUser?.name || currentUser?.email || 'CRM User',
          closedBy: currentUser?.name || currentUser?.email || 'CRM User',
          closedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString()
        }]
      : [];
    const newEntry = {
      id: `follow-up-${Date.now()}`,
      scheduledDate: followUpDraft.scheduledDate,
      scheduledTime: followUpDraft.scheduledTime,
      remarks: followUpDraft.remarks.trim(),
      reason: followUpDraft.reason.trim(),
      priority: followUpDraft.priority,
      createdAt: new Date().toISOString()
    };
    const payload = {
      ...activeLead,
      assignedTo: activeLead.assignedTo?._id || activeLead.assignedTo?.id || activeLead.assignedTo || '',
      serviceSelections: detailServices.map((service, index) => index === serviceIndex ? {
        ...service,
        nextFollowUpDate: newEntry.scheduledDate,
        nextFollowUpTime: newEntry.scheduledTime,
        followUpRemarks: newEntry.remarks,
        followUpPriority: newEntry.priority,
        followUpClosedAt: '',
        followUpClosedBy: '',
        followUpCloseReason: '',
        followUpUpdatedAt: new Date().toISOString(),
        followUpHistory: [...previousCurrent, ...(Array.isArray(service.followUpHistory) ? service.followUpHistory : [])]
      } : service)
    };
    setFollowUpSaving(true);
    setFollowUpError('');
    try {
      const response = await api.put(API_ENDPOINTS.leads.detail(leadId), payload);
      const updatedLead = response.data?.lead || payload;
      await api.post(API_ENDPOINTS.calendarItems.create, {
        type: 'followup',
        title: `Lead follow-up: ${activeLead.company || activeLead.leadCode || 'Lead'}`,
        description: newEntry.remarks,
        clientName: activeLead.company || '',
        leadId,
        scheduledDate: newEntry.scheduledDate,
        scheduledTime: newEntry.scheduledTime,
        priority: newEntry.priority,
        status: 'open',
        assignedTo: currentUser?._id || currentUser?.id || '',
        assignedToName: currentUser?.name || currentUser?.email || '',
        leadNumber: activeLead.leadCode || '',
        leadCompanyName: activeLead.company || '',
        metadata: {
          serviceIndex,
          assignedServiceId: selectedService.assignedServiceId || '',
          serviceName: selectedService.servicesOffered || selectedService.applicableService || ''
        }
      }).catch(() => null);
      setDetailLead(updatedLead);
      onLeadUpdated?.(updatedLead);
      setFollowUpModalOpen(false);
    } catch (err) {
      setFollowUpError(err?.response?.data?.error || 'Unable to save follow-up.');
    } finally {
      setFollowUpSaving(false);
    }
  }

  async function closeFollowUp() {
    if (!followUpDraft.remarks.trim() || !followUpDraft.reason.trim()) {
      setFollowUpError('Follow-Up close remarks and close reason are required.');
      return;
    }
    const leadId = activeLead._id || activeLead.id;
    const serviceIndex = Number(followUpDraft.serviceIndex);
    const selectedService = detailServices[serviceIndex];
    if (!leadId || !selectedService || !ownedServiceOptions.some((option) => Number(option.value) === serviceIndex)) {
      setFollowUpError('This follow-up cannot be closed for the selected service.');
      return;
    }
    const closedAt = new Date().toISOString();
    const closedEntry = {
      id: `follow-up-closed-${Date.now()}`,
      scheduledDate: selectedService.nextFollowUpDate || followUpDraft.scheduledDate || '',
      scheduledTime: selectedService.nextFollowUpTime || followUpDraft.scheduledTime || '',
      remarks: followUpDraft.remarks.trim(),
      previousRemarks: selectedService.followUpRemarks || '',
      reason: followUpDraft.reason.trim(),
      priority: selectedService.followUpPriority || followUpDraft.priority,
      status: 'closed',
      owner: currentUser?.name || currentUser?.email || 'CRM User',
      closedBy: currentUser?.name || currentUser?.email || 'CRM User',
      closedAt,
      updatedAt: closedAt,
      createdAt: closedAt
    };
    const payload = {
      ...activeLead,
      assignedTo: activeLead.assignedTo?._id || activeLead.assignedTo?.id || activeLead.assignedTo || '',
      serviceSelections: detailServices.map((service, index) => index === serviceIndex ? {
        ...service,
        nextFollowUpDate: '',
        nextFollowUpTime: '',
        followUpRemarks: '',
        followUpFlag: 'GREEN',
        followUpClosedAt: closedAt,
        followUpClosedBy: closedEntry.closedBy,
        followUpCloseReason: closedEntry.reason,
        followUpUpdatedAt: closedAt,
        followUpHistory: [closedEntry, ...(Array.isArray(service.followUpHistory) ? service.followUpHistory : [])]
      } : service)
    };
    setFollowUpSaving(true);
    setFollowUpError('');
    try {
      const response = await api.put(API_ENDPOINTS.leads.detail(leadId), payload);
      const updatedLead = response.data?.lead || payload;
      setDetailLead(updatedLead);
      onLeadUpdated?.(updatedLead);
      setFollowUpModalOpen(false);
      setFollowUpCloseMode(false);
    } catch (err) {
      setFollowUpError(err?.response?.data?.error || 'Unable to close follow-up.');
    } finally {
      setFollowUpSaving(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-72px)] bg-[#f3f8f6] px-4 py-5 sm:px-6 lg:px-8">
      {detailToast && <div key={detailToast.id} className="fixed right-5 top-24 z-[10100] w-[min(430px,calc(100vw-40px))]"><ToastMessage type={detailToast.type} actionLabel="Close" onAction={() => setDetailToast(null)}>{detailToast.message}</ToastMessage></div>}
      {permanentCloseStep === 'confirm' && (
        <div className="fixed inset-0 z-[10060] grid place-items-center bg-slate-950/50 px-4 py-6 backdrop-blur-sm" onClick={() => setPermanentCloseStep('')}>
          <section className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/25" onClick={(event) => event.stopPropagation()}>
            <div className="border-b border-slate-100 px-6 py-6">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Lead Closure Confirmation</p>
              <h3 className="mt-2 text-2xl font-black text-slate-950">Have you received the original Purchase Order?</h3>
              <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">Confirm only after the original PO has been received. Selecting No will close this message without changing the lead.</p>
            </div>
            <div className="flex flex-col-reverse gap-3 bg-slate-50 px-6 py-5 sm:flex-row sm:justify-end">
              <button type="button" onClick={declineOriginalPoConfirmation} className="min-h-11 rounded-lg border border-slate-200 bg-white px-6 font-black text-slate-700">No</button>
              <button type="button" onClick={() => { setPermanentCloseError(''); setPermanentCloseStep('details'); }} className="min-h-11 rounded-lg bg-emerald-700 px-6 font-black text-white shadow-lg shadow-emerald-700/20">Yes</button>
            </div>
          </section>
        </div>
      )}
      {permanentCloseStep === 'details' && (
        <div className="fixed inset-0 z-[10060] grid place-items-center overflow-y-auto bg-slate-950/50 px-4 py-6 backdrop-blur-sm" onClick={() => !permanentCloseSaving && setPermanentCloseStep('')}>
          <section className="my-auto w-full max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/25" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-orange-50 px-6 py-5">
              <div><p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Permanent Lead Closure</p><h3 className="mt-1 text-2xl font-black text-slate-950">Verify frozen lead details</h3><p className="mt-2 text-sm font-semibold text-slate-600">These saved details are read-only. Permanent closure disables the 7-business-day automatic reopening.</p></div>
              <button type="button" disabled={permanentCloseSaving} onClick={() => setPermanentCloseStep('')} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 disabled:opacity-50" aria-label="Close permanent closure dialog"><X className="h-5 w-5" /></button>
            </header>
            <div className="max-h-[70vh] space-y-5 overflow-y-auto p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-black uppercase tracking-wider text-slate-500">Lead ID<input readOnly value={displayLeadId(activeLead) || ''} className="mt-2 h-12 w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 px-4 text-sm font-black normal-case tracking-normal text-slate-700" /></label>
                <label className="text-xs font-black uppercase tracking-wider text-slate-500">Company<input readOnly value={activeLead.company || ''} className="mt-2 h-12 w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 px-4 text-sm font-black normal-case tracking-normal text-slate-700" /></label>
              </div>
              <div className="overflow-auto rounded-xl border border-slate-200">
                <div className="border-b border-slate-200 bg-emerald-50 px-5 py-4"><h4 className="font-black text-slate-900">Service &amp; Applicant</h4></div>
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['#', 'Industry Type', 'Service Category', 'Applicant Type', 'Sub Applicant Type', 'Services Offered', 'Financial Year', 'Closure'].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
                  <tbody>{detailServices.map((row, index) => <tr key={index} className="border-t border-slate-100"><td className="px-4 py-3 font-black">{index + 1}</td><td className="px-4 py-3">{row.industryType || '-'}</td><td className="px-4 py-3">{row.eprCategory || '-'}</td><td className="px-4 py-3">{row.applicantType || '-'}</td><td className="px-4 py-3 font-black text-violet-700">{directApplicantOptions(row.eprCategory) ? 'Not applicable' : (row.piboCategory || '-')}</td><td className="px-4 py-3">{row.servicesOffered || '-'}</td><td className="px-4 py-3 font-black">{row.firstAnnualReturnYearApplicable || '-'}</td><td className="px-4 py-3"><span className={`rounded-full px-3 py-1 text-[10px] font-black ${detailAssignments[index]?.poStatus === 'provisional' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}`}>{detailAssignments[index]?.poStatus === 'provisional' ? 'PERMANENT CLOSE' : 'UNCHANGED'}</span></td></tr>)}</tbody>
                </table>
              </div>
              <section className="overflow-hidden rounded-xl border border-amber-300 bg-white">
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-4"><div><p className="text-[10px] font-black uppercase tracking-wider text-amber-700">Manual PO Details</p><h4 className="font-black text-slate-950">Enter original Purchase Order details</h4></div><span className="rounded-full bg-white px-3 py-1 text-[10px] font-black text-amber-700">Original PO required</span></header>
                <div className="overflow-auto">
                  <table className="w-full min-w-[1250px] text-left text-xs">
                    <thead className="bg-slate-100 uppercase text-slate-500"><tr>{['#', 'EPR / Service Period', 'PO Number', 'PO Date', 'PO End Date', 'PO Financial Year', poYearLabel(originalPoRows), 'Payment Term', 'PO Amount (INR)', 'PO Proof', 'Service'].map((heading) => <th key={heading} className="whitespace-nowrap p-3">{heading}</th>)}</tr></thead>
                    <tbody>{originalPoRows.map((po, rowIndex) => <tr key={po.assignmentIndex} className="border-t align-middle">
                      <td className="p-3 font-black">{rowIndex + 1}</td>
                      <td className="p-3 font-black text-slate-700">{po.fy || '-'}</td>
                      <td className="p-3"><input required className="form-input min-w-48" value={po.poNumber} onChange={(event) => updateOriginalPoRow(rowIndex, { poNumber: event.target.value })} placeholder="PO Number" /></td>
                      <td className="p-3"><input required type="date" aria-label={`Original PO Date row ${rowIndex + 1}`} className="form-input min-w-40" value={po.poDate} onChange={(event) => updateOriginalPoRow(rowIndex, { poDate: event.target.value })} /></td>
                      <PoCommercialFields po={po} index={rowIndex} onChange={(patch) => updateOriginalPoRow(rowIndex, patch)} />
                      <td className="p-3"><div className="relative min-w-48"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-black text-slate-500">₹</span><input required type="number" min="0.01" step="0.01" className="form-input pl-7" value={po.poAmount} onChange={(event) => updateOriginalPoRow(rowIndex, { poAmount: event.target.value })} placeholder="Enter PO Amount" /></div></td>
                      <td className="p-3"><div className="flex items-center gap-2"><label className={`flex min-h-11 min-w-40 items-center justify-center rounded-xl border border-amber-300 bg-amber-50 px-3 font-black text-amber-700 ${originalPoUploadingIndex === rowIndex ? 'cursor-wait opacity-60' : 'cursor-pointer'}`}><Upload className="mr-2 h-4 w-4" />{originalPoUploadingIndex === rowIndex ? 'Uploading...' : (po.poFileName || 'Choose File')}<input type="file" disabled={originalPoUploadingIndex >= 0 || permanentCloseSaving} className="sr-only" accept="image/*,.pdf" onChange={(event) => uploadOriginalPo(event, rowIndex)} /></label>{po.poFileUrl && <a href={po.poFileUrl} target="_blank" rel="noopener noreferrer" className="font-black text-emerald-700">View</a>}</div></td>
                      <td className="p-3 font-bold text-slate-800">{po.service || '-'}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
              </section>
              {permanentCloseError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{permanentCloseError}</div>}
            </div>
            <footer className="flex flex-col-reverse gap-3 border-t border-slate-100 bg-slate-50 px-6 py-5 sm:flex-row sm:justify-end">
              <button type="button" disabled={permanentCloseSaving} onClick={() => setPermanentCloseStep('')} className="min-h-11 rounded-lg border border-slate-200 bg-white px-6 font-black text-slate-700 disabled:opacity-50">Cancel</button>
              <button type="button" disabled={permanentCloseSaving || originalPoUploadingIndex >= 0 || !hasProvisionalClosure || !originalPoRows.length || originalPoRows.some((row) => poCommercialError(row) || !row.fy || !row.poNumber.trim() || !row.poDate || !(Number(row.poAmount) > 0) || !row.poFileUrl)} onClick={permanentlyCloseLead} className="min-h-11 rounded-lg bg-emerald-700 px-6 font-black text-white shadow-lg shadow-emerald-700/20 disabled:opacity-50">{permanentCloseSaving ? 'Closing Lead...' : 'Permanently Close Lead'}</button>
            </footer>
          </section>
        </div>
      )}
      {detailKickoffDialog && (
        <div className="fixed inset-0 z-[10050] grid place-items-center bg-slate-950/50 px-4 py-6 backdrop-blur-sm" onClick={() => setDetailKickoffDialog(null)}>
          <section className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/25" onClick={(event) => event.stopPropagation()}>
            <div className="border-b border-slate-100 px-6 py-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Staff Assignment</p>
              <h3 className="mt-1 text-2xl font-black text-slate-950">Send the kick-off email?</h3>
              <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">The staff member will be assigned now. Would you also like to send the client the virtual kick-off email?</p>
            </div>
            <div className="flex flex-col-reverse gap-3 bg-slate-50 px-6 py-5 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => confirmDetailKickoffEmail(false)} className="min-h-11 rounded-lg border border-slate-200 bg-white px-5 font-black text-slate-700">No, Assign Without Email</button>
              <button type="button" onClick={() => confirmDetailKickoffEmail(true)} className="min-h-11 rounded-lg bg-emerald-700 px-5 font-black text-white shadow-lg shadow-emerald-700/20">Yes, Assign &amp; Send Email</button>
            </div>
          </section>
        </div>
      )}
      <div className="relative z-[80] -mx-4 -mt-5 border-b border-slate-200/80 bg-white/90 px-4 py-4 shadow-sm backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={onBack} className="btn-lift grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-orange-600 shadow-sm" title="Back">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#30737B]">Lead Details</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          {hasProvisionalClosure && <button type="button" onClick={() => { setPermanentCloseError(''); setOriginalPoRows(buildOriginalPoRows()); setPermanentCloseStep('confirm'); }} className="btn-lift inline-flex min-h-10 items-center gap-2 rounded-lg bg-amber-500 px-5 text-sm font-black text-white shadow-lg shadow-amber-500/20"><CheckCircle2 className="h-4 w-4" />Original PO Received?</button>}
          {showCurrentUserServiceActions && <button type="button" onClick={onEdit} className="btn-lift inline-flex min-h-10 items-center gap-2 rounded-lg bg-violet-600 px-5 text-sm font-black text-white shadow-lg shadow-violet-600/20"><Edit3 className="h-4 w-4" />Change Status</button>}
          {showCurrentUserServiceActions && <button type="button" disabled={!detailAssignments.some(hasSavedPoDetails)} title={detailAssignments.some(hasSavedPoDetails) ? 'Modify saved PO details' : 'Save PO through lead closure first'} onClick={() => onModifyPo?.(activeLead)} className="disabled:opacity-40 disabled:cursor-not-allowed btn-lift inline-flex min-h-10 items-center gap-2 rounded-lg bg-teal-700 px-5 text-sm font-black text-white shadow-lg shadow-teal-700/20"><FileText className="h-4 w-4" />Modify PO Details</button>}
          {showCurrentUserServiceActions && (
            <>
              <LeadToolbarMenu
                label="Quotation"
                icon={Plus}
                tone="emerald"
                options={[
                  { label: 'Add Quotation', icon: Plus, onClick: () => onQuotationAction?.('add') },
                  {
                    label: revisableLeadQuotations.length ? 'Revise' : 'Revise (Approve/Reject first)',
                    icon: Edit3,
                    disabled: !revisableLeadQuotations.length,
                    onClick: () => onQuotationAction?.('revise')
                  }
                ]}
              />
              <LeadToolbarMenu
                label="Proforma Invoice"
                icon={CreditCard}
                tone="blue"
                options={[
                  { label: 'Add Proforma Invoice', icon: Plus, onClick: () => onProformaAction?.('add') },
                  { label: 'Revise', icon: Edit3, onClick: () => onProformaAction?.('revise') }
                ]}
              />
            </>
          )}
          <button type="button" onClick={openHistory} className="btn-lift inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-black text-white shadow-lg shadow-blue-600/20"><RefreshCw className="h-4 w-4" />View History</button>
          {canEdit && <button type="button" onClick={onEdit} className="btn-lift inline-flex min-h-10 items-center gap-2 rounded-lg bg-orange-500 px-5 text-sm font-black text-white shadow-lg shadow-orange-500/20"><Edit3 className="h-4 w-4" />Edit</button>}
        </div>
        </div>
      </div>

      <div className="mt-6 w-full max-w-none">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/6">
          <div className="bg-[linear-gradient(135deg,#ffffff_0%,#f0fdfa_58%,#fff7ed_100%)] p-5 sm:p-6">
            <div className="grid gap-5 xl:grid-cols-[1fr_auto] xl:items-center">
              <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
                <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl border border-white bg-[#30737B] text-2xl font-black text-white shadow-lg shadow-teal-900/20">{initials}</div>
                <div className="min-w-0">
                  <h1 className="text-3xl font-black leading-tight text-slate-950 sm:text-4xl">{companyName}</h1>
                </div>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/80 p-4 shadow-sm shadow-teal-900/5 backdrop-blur xl:min-w-[500px]">
                <div className="grid gap-4 sm:grid-cols-3">
                  <LeadInlineMeta label="Lead ID" value={displayLeadId(activeLead)} icon={FileText} />
                  <LeadInlineMeta label="Contact" value={activeLead.contactPerson} icon={ContactRound} />
                  <LeadInlineMeta label="Mobile" value={activeLead.mobileNo1} icon={Phone} />
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-5 grid gap-5">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-900/5">
          <div className="grid grid-cols-2 gap-2 border-b border-emerald-100 bg-emerald-50/70 p-3">
            {tabs.map((tab) => { const TabIcon = tab.icon; const active = activeTab === tab.id; return <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`flex min-h-14 items-center justify-center gap-2 rounded-xl font-black ${active ? 'bg-[#30737B] text-white shadow-lg' : 'bg-white text-slate-500'}`}><TabIcon className="h-4 w-4" />{tab.label}</button>; })}
          </div>
          {activeTab === 'overview' && (
            <div className="p-6">
              <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-[#30737B]">Overview</p>
                  <h2 className="text-2xl font-black text-slate-950">Complete Lead Information</h2>
                </div>
                <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-black uppercase text-slate-600">Updated {activeLead.importedUpdatedAt || activeLead.updatedAt || 'Recently'}</span>
              </div>
              <div className="space-y-4">
                <>
                  <div className="overflow-auto rounded-xl border border-slate-200">
                  <div className="border-b border-slate-200 bg-emerald-50 px-5 py-4"><h3 className="font-black text-slate-900">Service &amp; Applicant</h3></div>
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['#', 'Industry Type', 'Service Category', 'Applicant Type', 'Sub Applicant Type', 'Services Offered', 'Financial Year'].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
                    <tbody>{detailServices.map((row, index) => <tr key={index} className="border-t border-slate-100"><td className="px-4 py-3 font-black">{index + 1}</td><td className="px-4 py-3">{row.industryType || '-'}</td><td className="px-4 py-3">{row.eprCategory || '-'}</td><td className="px-4 py-3">{row.applicantType || '-'}</td><td className="px-4 py-3 font-black text-violet-700">{directApplicantOptions(row.eprCategory) ? 'Not applicable' : (row.piboCategory || '-')}</td><td className="px-4 py-3">{row.servicesOffered || '-'}</td><td className="px-4 py-3 font-black">{row.firstAnnualReturnYearApplicable || '-'}</td></tr>)}</tbody>
                  </table>
                  </div>
                </>
                <SavedLeadPoDetails assignments={detailAssignments} services={detailServices} />
                <ReadOnlyInfoTable title="Address Information" icon={MapPin} rows={addressInfoRows} />
                <ReadOnlyInfoTable title="Contact Information" icon={ContactRound} rows={contactInfoRows} />
                <section className="rounded-2xl border border-teal-200 bg-gradient-to-r from-teal-50 via-white to-emerald-50 p-5 shadow-sm">
                  <div className="mb-4 flex items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-700 text-white"><UserCheck className="h-5 w-5" /></span>
                    <div><h3 className="text-xl font-black text-slate-950">Temporary Assignment</h3><p className="mt-1 text-sm font-semibold text-slate-500">Assign another user for 7 days without changing the permanently assigned staff. Super Admin approval is required.</p></div>
                  </div>
                  <div className="grid gap-3">
                    {detailAssignments.map((row, index) => {
                      const matchingService = detailServices[index] || detailServices.at(-1) || createServiceSelection(activeLead);
                      const managerId = row.assignedTo?._id || row.assignedTo || '';
                      const managerOwnsRow = currentUserTokens.includes(String(managerId));
                      const canAssignThisRow = isAssignmentAdmin || (isManager && managerOwnsRow);
                      return <div key={`temporary-${index}`} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_minmax(260px,1.4fr)_minmax(180px,1fr)] lg:items-end">
                        <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Service</p><p className="mt-2 font-black text-slate-800">{matchingService.servicesOffered || matchingService.eprCategory || `Service ${index + 1}`}</p></div>
                        <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Permanent Staff</p><p className="mt-2 font-black text-slate-800">{row.assignedStaff?.name || row.assignedStaffText || 'Not assigned'}</p></div>
                        <div><p className="mb-2 text-[10px] font-black uppercase tracking-wider text-slate-400">Temporary User</p>{canAssignThisRow ? <SearchableSelect allowCustom={false} disabled={assignmentSavingIndex === index || row.temporaryUser?.status === 'PENDING'} value={row.temporaryUser?.temporaryUserId || ''} options={detailStaffOptions} placeholder="Select temporary user" onChange={(value) => requestTemporaryUser(index, value)} /> : <p className="font-black text-slate-700">{row.temporaryUser?.temporaryUserName || 'Not assigned'}</p>}</div>
                        <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Status / Expiry</p><div className="mt-2 flex flex-wrap items-center gap-2"><span className={`rounded-full px-3 py-1 text-[10px] font-black ${row.temporaryUser?.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : row.temporaryUser?.status === 'PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{row.temporaryUser?.status || 'NOT ASSIGNED'}</span>{row.temporaryUser?.expiresAt && <small className="font-bold text-slate-500">Until {new Date(row.temporaryUser.expiresAt).toLocaleString('en-IN')}</small>}</div>{canAssignThisRow && row.temporaryUser?.status === 'ACTIVE' && <button type="button" onClick={() => requestTemporaryUser(index, row.temporaryUser.temporaryUserId)} className="mt-2 rounded-lg border border-teal-200 px-3 py-2 text-xs font-black text-teal-700">Request 7-day extension</button>}</div>
                      </div>;
                    })}
                  </div>
                </section>
                <div className="overflow-auto rounded-xl border border-slate-200">
                  <div className="flex items-center gap-3 border-b border-slate-200 bg-gradient-to-r from-emerald-50 to-sky-50 px-5 py-4">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-[#30737B] shadow-sm"><UserCheck className="h-4 w-4" /></span>
                    <div><h3 className="font-black text-slate-900">Assign Lead</h3><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{detailAssignments.length} assignment row{detailAssignments.length === 1 ? '' : 's'}</p></div>
                  </div>
                  <table className="w-full min-w-[2150px] text-left text-sm">
                    <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500">
                      <tr>{['#', 'Industry Type', 'Service Category', 'Applicant Type', 'Sub Applicant Type', 'Services Offered', 'Lead Closed By', 'Assigned to Manager', 'Manager Email', 'Manager Assigned to Staff', 'Temporary User', 'Temporary Status', 'Staff Email', 'Assigned By'].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr>
                    </thead>
                    <tbody>
                      {detailAssignments.map((row, index) => {
                        const matchingService = detailServices[index]
                          || detailServices.at(-1)
                          || createServiceSelection(activeLead);
                        const managerId = row.assignedTo?._id || row.assignedTo || '';
                        const managerOwnsRow = currentUserTokens.includes(String(managerId));
                        const canAssignThisRow = isAssignmentAdmin || (isManager && managerOwnsRow);
                        const selectedStaffOptions = row.assignedStaff && !detailStaffOptions.some((option) => String(option.value) === String(row.assignedStaff?._id || row.assignedStaff))
                          ? [{ value: String(row.assignedStaff?._id || row.assignedStaff), label: row.assignedStaffText || row.assignedStaff?.name || 'Assigned staff' }, ...detailStaffOptions]
                          : detailStaffOptions;
                        return <tr key={index} className="border-t border-slate-100">
                          <td className="px-4 py-3 font-black">{index + 1}</td>
                          <td className="px-4 py-3 font-black">{matchingService.industryType || '-'}</td>
                          <td className="px-4 py-3">{matchingService.eprCategory || '-'}</td>
                          <td className="px-4 py-3">{matchingService.applicantType || '-'}</td>
                          <td className="px-4 py-3 font-black text-violet-700">{directApplicantOptions(matchingService.eprCategory) ? 'Not applicable' : (matchingService.piboCategory || '-')}</td>
                          <td className="px-4 py-3">{matchingService.servicesOffered || '-'}</td>
                          <td className="px-4 py-3 font-black">{row.closedBy?.name || row.closedByText || '-'}</td>
                          <td className="px-4 py-3 font-black">{row.assignedTo?.name || row.assignedToText || '-'}</td>
                          <td className="px-4 py-3">{row.assignedTo?.email || row.assignedToEmail || '-'}</td>
                          <td className="min-w-[270px] px-4 py-3">
                            {canAssignThisRow
                              ? <SearchableSelect allowCustom={false} disabled={assignmentSavingIndex === index} value={row.assignedStaff?._id || row.assignedStaff || ''} options={selectedStaffOptions} placeholder="Select staff member" onChange={(value) => requestStaffAssignmentFromDetail(index, value)} />
                              : <span className="font-black">{row.assignedStaff?.name || row.assignedStaffText || '-'}</span>}
                          </td>
                          <td className="min-w-[280px] px-4 py-3">
                            {canAssignThisRow
                              ? <SearchableSelect allowCustom={false} disabled={assignmentSavingIndex === index || row.temporaryUser?.status === 'PENDING'} value={row.temporaryUser?.temporaryUserId || ''} options={detailStaffOptions} placeholder={row.temporaryUser?.status === 'ACTIVE' ? 'Select user to request extension' : 'Select temporary user'} onChange={(value) => requestTemporaryUser(index, value)} />
                              : <span className="font-black">{row.temporaryUser?.temporaryUserName || '-'}</span>}
                          </td>
                          <td className="px-4 py-3"><div className="flex flex-col gap-1"><span className={`w-fit rounded-full px-2 py-1 text-[10px] font-black ${row.temporaryUser?.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : row.temporaryUser?.status === 'PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{row.temporaryUser?.status || 'NOT ASSIGNED'}</span>{row.temporaryUser?.expiresAt && <small className="font-bold text-slate-500">Until {new Date(row.temporaryUser.expiresAt).toLocaleString('en-IN')}</small>}{canAssignThisRow && row.temporaryUser?.status === 'ACTIVE' && <button type="button" onClick={() => requestTemporaryUser(index, row.temporaryUser.temporaryUserId)} className="mt-1 w-fit rounded-lg border border-teal-200 px-2 py-1 text-[10px] font-black text-teal-700">Request 7-day extension</button>}</div></td>
                          <td className="px-4 py-3">{row.assignedStaff?.email || row.assignedStaffEmail || '-'}</td>
                          <td className="px-4 py-3">{personLabel(row.assignedBy || activeLead.assignedBy)}</td>
                        </tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'followup' && (
            <div className="p-6">
              <div className="mb-5 flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-[.18em] text-orange-600">Lead follow-up workflow</p><h2 className="text-2xl font-black">Follow-Up Tracker</h2></div><button type="button" onClick={() => openFollowUpModal()} className="flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 font-black text-white"><Plus className="h-4 w-4" /> Add Follow-Up</button></div>
              <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <FollowUpMetric icon={CalendarDays} label="Upcoming" value={upcomingFollowUps.length} tone="orange" />
                <FollowUpMetric icon={History} label="Previous" value={previousFollowUps.length} tone="slate" />
                <FollowUpMetric icon={Clock3} label="Next Time" value={upcomingFollowUps[0]?.scheduledTime || '-'} tone="teal" />
                <FollowUpMetric icon={CircleAlert} label="Priority" value={upcomingFollowUps[0]?.priority || 'Medium'} tone="violet" />
              </div>
              <div className="grid gap-5 lg:grid-cols-2">
                <FollowUpBox title="Upcoming Follow-Ups" tone="orange" items={upcomingFollowUps} emptyMessage="No upcoming follow-ups." onView={setViewFollowUp} onEdit={openFollowUpModal} onAssignment={() => setActiveTab('overview')} onHistory={openHistory} />
                <FollowUpBox title="Previous Follow-Ups" tone="slate" items={previousFollowUps} emptyMessage="No past follow-ups." onView={setViewFollowUp} onEdit={openFollowUpModal} onAssignment={() => setActiveTab('overview')} onHistory={openHistory} />
              </div>
            </div>
          )}
        </section>
        </div>
      </div>
      {historyOpen && <LeadHistoryDrawer data={historyData} loading={historyLoading} filter={historyFilter} onFilter={setHistoryFilter} onRefresh={openHistory} onClose={() => setHistoryOpen(false)} />}
      {viewFollowUp && (
        <div className="fixed inset-0 z-[125] grid place-items-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm" onClick={() => setViewFollowUp(null)}>
          <section className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-orange-50 to-white px-6 py-5">
              <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl border border-orange-200 bg-orange-50 text-orange-600"><CalendarDays className="h-5 w-5" /></span><div><p className="text-[10px] font-black uppercase tracking-widest text-orange-600">Follow-Up Details</p><h3 className="text-xl font-black text-slate-950">{formatFollowUpDate(viewFollowUp.scheduledDate)}</h3></div></div>
              <button type="button" onClick={() => setViewFollowUp(null)} className="grid h-9 w-9 place-items-center rounded-full bg-white text-slate-500 shadow-sm"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 p-6">
              <div className="grid grid-cols-2 gap-3"><FollowUpDetail label="Service" value={viewFollowUp.serviceName || 'Lead service'} /><FollowUpDetail label="Follow-Up Owner" value={viewFollowUp.owner || 'CRM User'} /></div>
              <div className="grid grid-cols-2 gap-3"><FollowUpDetail label="Scheduled Time" value={viewFollowUp.scheduledTime || 'Not set'} /><FollowUpDetail label="Priority" value={viewFollowUp.priority || 'Medium'} /></div>
              <FollowUpDetail label="Remarks" value={viewFollowUp.remarks || 'No remarks added.'} />
              <FollowUpDetail label="Update Reason" value={viewFollowUp.reason || 'Not provided'} />
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4">
              <button type="button" onClick={() => setViewFollowUp(null)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 font-black text-slate-600">Close</button>
              {viewFollowUp.canEdit && <button type="button" onClick={() => { const item = viewFollowUp; setViewFollowUp(null); openFollowUpModal(item); }} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 font-black text-white"><Edit3 className="h-4 w-4" /> Update</button>}
            </div>
          </section>
        </div>
      )}
      {followUpModalOpen && (
        <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm" onClick={() => !followUpSaving && setFollowUpModalOpen(false)}>
          <section className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/25" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-600">Follow-Up</p>
                <h3 className="mt-1 text-2xl font-black text-slate-950">{followUpCloseMode ? 'Close Lead Follow-Up' : followUpEditing ? 'Update Lead Follow-Up' : 'Add Lead Follow-Up'}</h3>
              </div>
              <button type="button" disabled={followUpSaving} onClick={() => setFollowUpModalOpen(false)} className="grid h-10 w-10 place-items-center rounded-full bg-slate-50 text-slate-600 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-4 px-6 py-5 sm:grid-cols-2">
              <Field label="Your Service" required className="sm:col-span-2"><select className="form-input" value={followUpDraft.serviceIndex} disabled={followUpEditing} onChange={(event) => { const serviceIndex = event.target.value; const service = detailServices[Number(serviceIndex)] || {}; setFollowUpDraft((current) => ({ ...current, serviceIndex, scheduledDate: service.nextFollowUpDate || todayDateKey(), scheduledTime: service.nextFollowUpTime || '', remarks: service.followUpRemarks || '', priority: service.followUpPriority || 'Medium' })); }}><option value="">Select your service</option>{ownedServiceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
              {!followUpCloseMode && <><Field label="Scheduled Date" required><PremiumDatePicker value={followUpDraft.scheduledDate} onChange={(event) => setFollowUpDraft((current) => ({ ...current, scheduledDate: event.target.value }))} /></Field><Field label="Scheduled Time"><input type="time" className="form-input" value={followUpDraft.scheduledTime} onChange={(event) => setFollowUpDraft((current) => ({ ...current, scheduledTime: event.target.value }))} /></Field><Field label="Priority"><select className="form-input" value={followUpDraft.priority} onChange={(event) => setFollowUpDraft((current) => ({ ...current, priority: event.target.value }))}><option>Low</option><option>Medium</option><option>High</option></select></Field></>}
              <Field label={followUpCloseMode ? 'Follow-Up Close Remarks' : 'Follow-Up Remarks'} required className="sm:col-span-2"><textarea className="form-input min-h-28 resize-y" value={followUpDraft.remarks} onChange={(event) => setFollowUpDraft((current) => ({ ...current, remarks: event.target.value }))} placeholder={followUpCloseMode ? 'Enter the final follow-up outcome' : 'Enter follow-up note or outcome'} /></Field>
              <Field label={followUpCloseMode ? 'Close Reason' : 'Update Reason'} required={followUpEditing || followUpCloseMode} className="sm:col-span-2"><textarea className="form-input min-h-20 resize-y" value={followUpDraft.reason} onChange={(event) => setFollowUpDraft((current) => ({ ...current, reason: event.target.value }))} placeholder={followUpCloseMode ? 'Why is this follow-up being closed?' : followUpEditing ? 'Why is this follow-up being updated?' : 'Why is this follow-up being added?'} /></Field>
              {followUpError && <p className="sm:col-span-2 rounded-lg bg-red-50 px-4 py-3 text-sm font-black text-red-600">{followUpError}</p>}
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4">
              <button type="button" disabled={followUpSaving} onClick={() => setFollowUpModalOpen(false)} className="min-h-10 rounded-lg border border-slate-200 bg-white px-5 font-black text-slate-700">Cancel</button>
              {followUpEditing && !followUpCloseMode && <button type="button" disabled={followUpSaving} onClick={() => { setFollowUpCloseMode(true); setFollowUpDraft((current) => ({ ...current, remarks: '', reason: '' })); setFollowUpError(''); }} className="min-h-10 rounded-lg bg-red-600 px-5 font-black text-white">Follow-Up Close</button>}
              {followUpCloseMode ? <button type="button" disabled={followUpSaving || !followUpDraft.remarks.trim() || !followUpDraft.reason.trim()} onClick={closeFollowUp} className="min-h-10 rounded-lg bg-red-600 px-5 font-black text-white disabled:cursor-not-allowed disabled:opacity-60">{followUpSaving ? 'Closing...' : 'Close Follow-Up'}</button> : <button type="button" disabled={followUpSaving || followUpDraft.serviceIndex === '' || !followUpDraft.scheduledDate || !followUpDraft.remarks.trim() || (followUpEditing && !followUpDraft.reason.trim())} onClick={saveFollowUp} className="min-h-10 rounded-lg bg-orange-500 px-5 font-black text-white disabled:cursor-not-allowed disabled:opacity-60">{followUpSaving ? 'Saving...' : followUpEditing ? 'Update Follow-Up' : 'Save Follow-Up'}</button>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function LeadHistoryDrawer({ data, loading, filter, onFilter, onRefresh, onClose }) {
  const events = data.events || [];
  const groupFor = (type = '') => type.includes('quotation') || type.includes('approval') ? 'quotation' : type.includes('follow') ? 'followup' : type.includes('todo') ? 'todo' : type.includes('email') ? 'email' : 'lead';
  const visible = filter === 'all' ? events : events.filter((event) => groupFor(event.type) === filter);
  const tones = { quotation: 'violet', followup: 'orange', todo: 'blue', email: 'emerald', lead: 'slate' };
  const filters = [['all', 'All Activity'], ['lead', 'Lead'], ['quotation', 'Quotation'], ['followup', 'Follow-Ups'], ['todo', 'Todos'], ['email', 'Email']];

  return (
    <div className="lead-history-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="lead-history-drawer">
        <header className="lead-history-head">
          <div><p>Complete activity trail</p><h2><Clock3 className="h-5 w-5" />Lead History</h2><span>{data.lead?.leadCode || ''} {data.lead?.company ? `• ${data.lead.company}` : ''}</span></div>
          <div><button type="button" onClick={onRefresh} title="Refresh"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button><button type="button" onClick={onClose} title="Close"><X className="h-5 w-5" /></button></div>
        </header>
        <section className="lead-history-stats"><div><strong>{data.summary?.total || events.length}</strong><span>Activities</span></div><div><strong>{data.summary?.quotations || 0}</strong><span>Quotations</span></div><div><strong>{data.summary?.followUps || 0}</strong><span>Follow-Ups</span></div><div><strong>{data.summary?.todos || 0}</strong><span>Todos</span></div><div><strong>{data.summary?.emails || 0}</strong><span>Emails</span></div></section>
        <nav className="lead-history-filters">{filters.map(([id, label]) => <button type="button" key={id} className={filter === id ? 'active' : ''} onClick={() => onFilter(id)}>{label}<small>{id === 'all' ? events.length : events.filter((event) => groupFor(event.type) === id).length}</small></button>)}</nav>
        <div className="lead-history-body">
          {loading ? <div className="lead-history-loading"><RefreshCw className="h-6 w-6 animate-spin" /><strong>Building activity timeline...</strong></div> : data.error ? <div className="lead-history-empty"><strong>History unavailable</strong><p>{data.error}</p></div> : visible.length ? <div className="lead-history-timeline">{visible.map((event) => {
            const group = groupFor(event.type); const date = event.at ? new Date(event.at) : null;
            return <article key={event.id} className={`is-${tones[group]}`}><i>{group === 'quotation' ? <FileText /> : group === 'email' ? <Mail /> : group === 'followup' ? <Phone /> : group === 'todo' ? <CheckCircle2 /> : <Edit3 />}</i><div><header><span>{String(event.type || 'activity').replace(/_/g, ' ')}</span><time>{date && !Number.isNaN(date.getTime()) ? `${date.toLocaleDateString('en-GB').replace(/\//g, '-')} • ${date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'Date unavailable'}</time></header><h3>{event.title}</h3><p>{event.description}</p><footer><UserCheck className="h-3.5 w-3.5" />By {event.actor || 'CRM User'}</footer></div></article>;
          })}</div> : <div className="lead-history-empty"><Clock3 className="h-8 w-8" /><strong>No activity found</strong><p>No events match this filter yet.</p></div>}
        </div>
        <footer className="lead-history-footer"><span>Audit timeline • newest activity first</span><button type="button" onClick={onClose}>Close History</button></footer>
      </aside>
    </div>
  );
}

function LeadDetailRows({ rows }) {
  return (
    <dl className="grid gap-4 md:grid-cols-2">
      {rows.map(([label, value, kind]) => (
        <div key={label} className="rounded-xl border border-slate-100 bg-slate-50/80 p-4">
          <dt className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{label}</dt>
          <dd className="mt-2 break-words text-sm font-black uppercase text-slate-950">
            {kind === 'pill' ? <span className="rounded-full bg-blue-600 px-3 py-1 text-xs text-white">{value || 'Draft'}</span> : value || '-'}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function LeadDetailGroup({ title, icon: Icon, rows, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="overflow-hidden rounded-xl border border-emerald-100 bg-white shadow-sm">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex min-h-12 w-full items-center justify-between border-b border-emerald-100 bg-emerald-50/60 px-4 py-3 text-left transition hover:bg-emerald-50">
        <span className="flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-[#30737B] shadow-sm">
            <Icon className="h-4 w-4" />
          </span>
          <span>
            <span className="block text-sm font-black text-slate-900">{title}</span>
            <span className="mt-0.5 block text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">{rows.length} fields</span>
          </span>
        </span>
        <span className="grid h-8 w-8 place-items-center rounded-full bg-[#30737B] text-white shadow-sm">
          <ChevronDown className={`h-4 w-4 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      <div className={`grid transition-all duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="grid md:grid-cols-2">
            {rows.map(([label, value, ValueIcon, kind]) => (
              <LeadDetailValue key={label} label={label} value={value} icon={ValueIcon} kind={kind} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ReadOnlyInfoTable({ title, icon: Icon, rows = [] }) {
  const renderValue = (row) => {
    if (!row) return <span className="text-slate-300">—</span>;
    const [, value, , kind] = row;
    return kind === 'pill'
      ? <span className="inline-flex rounded-full bg-blue-600 px-3 py-1 text-[11px] font-black uppercase text-white">{value || 'Draft'}</span>
      : <span className="break-words font-black text-slate-900">{value || '-'}</span>;
  };
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center gap-3 border-b border-emerald-100 bg-gradient-to-r from-emerald-50 to-sky-50 px-5 py-4">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-[#30737B] shadow-sm"><Icon className="h-4 w-4" /></span>
        <h3 className="font-black text-slate-950">{title}</h3>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-left text-sm">
          <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-[.1em] text-slate-500">
            <tr>
              {rows.map(([label]) => <th key={label} className="min-w-[180px] whitespace-nowrap px-5 py-3">{label}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-100 bg-white">
              {rows.map((row) => <td key={row[0]} className="min-w-[180px] whitespace-nowrap px-5 py-4">{renderValue(row)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LeadDetailValue({ label, value, icon: Icon, kind }) {
  return (
    <div className="grid min-h-12 grid-cols-[auto_130px_minmax(0,1fr)] items-center gap-3 border-b border-r border-emerald-50 px-4 py-3 last:border-b-0">
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-50 text-[#30737B]">
        {Icon ? <Icon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
      </span>
      <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">{label}</span>
      <span className="break-words text-xs font-black uppercase text-slate-950">
        {kind === 'pill' ? <span className="rounded-full bg-blue-600 px-3 py-1 text-[11px] text-white">{value || 'Draft'}</span> : value || '-'}
      </span>
    </div>
  );
}

function LeadInlineMeta({ label, value, icon: Icon }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-slate-400">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="text-[11px] font-black uppercase tracking-[0.12em]">{label}</span>
      </div>
      <p className="mt-2 truncate text-sm font-black text-slate-900">{value || '-'}</p>
    </div>
  );
}

function EmptyDetailState({ title, actionLabel, onAction }) {
  return (
    <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
      <div>
        <p className="font-black text-slate-500">{title}</p>
        {actionLabel && (
          <button type="button" onClick={onAction} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-600 px-5 text-sm font-black text-white">
            <Plus className="h-4 w-4" />{actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function QuotationPreviewCard({ quotation, onOpen }) {
  const items = Array.isArray(quotation.items) ? quotation.items : [];
  const created = quotation.createdAt ? new Date(quotation.createdAt).toLocaleDateString('en-GB').replace(/\//g, '-') : '-';
  const quotationNumber = quotation.quotationNumber || 'Quotation';
  const quotationId = quotation._id || quotation.id;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-900/5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-xl font-black text-slate-950">{quotationNumber}</h3>
          <p className="mt-1 text-xs font-black text-slate-500">Created: {created}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onOpen(quotationId)} className="btn-lift min-h-9 rounded-lg border border-blue-200 bg-blue-50 px-4 text-sm font-black text-blue-600">Open</button>
          <button type="button" onClick={() => onOpen(quotationId)} className="btn-lift min-h-9 rounded-lg px-4 text-sm font-black text-orange-600 hover:bg-orange-50">View Details</button>
          <button type="button" onClick={() => onOpen(quotationId)} className="btn-lift min-h-9 rounded-lg border border-orange-300 bg-white px-4 text-sm font-black text-orange-600">Revise</button>
        </div>
      </div>

      <div className="mt-8">
        <h4 className="font-black text-slate-900">Quotation Items</h4>
        <div className="mt-3 overflow-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500">
              <tr>
                {['#', 'Service Category', 'Services for the Year', 'Service Category', 'PIBO Category', 'Unit', 'Basic Amount (Rs)'].map((header) => (
                  <th key={header} className="border-r border-slate-200 px-4 py-3 last:border-r-0">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {items.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center font-black text-slate-400">No quotation items added.</td></tr>
              ) : items.map((item, index) => (
                <tr key={index} className="font-black text-slate-950">
                  <td className="border-r border-slate-200 px-4 py-3 text-center">{index + 1}</td>
                  <td className="border-r border-slate-200 px-4 py-3 uppercase">{item.serviceCategory || '-'}</td>
                  <td className="border-r border-slate-200 px-4 py-3">{item.servicesForYear || '-'}</td>
                  <td className="border-r border-slate-200 px-4 py-3 uppercase">{item.eprCategory || '-'}</td>
                  <td className="border-r border-slate-200 px-4 py-3 uppercase">{item.piboCategory || '-'}</td>
                  <td className="border-r border-slate-200 px-4 py-3 uppercase">{item.unit || '-'}</td>
                  <td className="px-4 py-3 text-right text-orange-600">{formatInr(item.basicAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function formatInr(value) {
  const amount = Number(value) || 0;
  return amount.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function FollowUpBox({ title, tone, items = [], emptyMessage, onView, onEdit, onAssignment, onHistory }) {
  const colors = tone === 'orange'
    ? 'border-orange-200 bg-orange-50 text-orange-900'
    : 'border-slate-200 bg-slate-50 text-slate-900';

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200">
      <div className={`border-b px-5 py-4 ${colors}`}>
        <h3 className="font-black">{title}</h3>
      </div>
      <div className="min-h-32 p-5">
        {items.length ? (
          <div className="space-y-3">
            {items.map((item) => (
              <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm shadow-slate-900/5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-sm font-black text-slate-950">{formatFollowUpDate(item.scheduledDate)}{item.scheduledTime ? ` at ${item.scheduledTime}` : ''}</strong>
                  {(item.status === 'closed' || item.reason) && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black uppercase text-slate-500">{item.status === 'closed' ? 'Follow up closed' : item.reason}</span>}
                </div>
                <div className="mt-2 flex flex-wrap gap-2"><span className="rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-black text-sky-700">{item.serviceName || 'Lead service'}</span><span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-black text-violet-700">By {item.owner || 'CRM User'}</span></div>
                <p className="mt-2 whitespace-pre-wrap text-sm font-bold leading-6 text-slate-600">{item.remarks || 'No remarks added.'}</p>
                <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
                  <FollowUpAction icon={Eye} label="View follow-up" tone="blue" onClick={() => onView?.(item)} />
                  <FollowUpAction icon={Edit3} label={item.canEdit ? 'Update your follow-up' : 'This follow-up belongs to another user or is read-only'} tone="teal" disabled={!item.canEdit} onClick={() => onEdit?.(item)} />
                  <FollowUpAction icon={UserPlus} label="View lead assignment" tone="violet" onClick={() => onAssignment?.(item)} />
                  <FollowUpAction icon={History} label="View complete history" tone="slate" onClick={() => onHistory?.()} />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="grid min-h-24 place-items-center text-center">
            <p className="font-black text-slate-500">{emptyMessage}</p>
          </div>
        )}
      </div>
    </section>
  );
}

function FollowUpAction({ icon: Icon, label, tone, disabled = false, onClick }) {
  const tones = {
    blue: 'text-blue-600 hover:border-blue-200 hover:bg-blue-50',
    teal: 'text-teal-600 hover:border-teal-200 hover:bg-teal-50',
    violet: 'text-violet-600 hover:border-violet-200 hover:bg-violet-50',
    slate: 'text-slate-600 hover:border-slate-300 hover:bg-slate-50'
  };
  return (
    <button type="button" disabled={disabled} onClick={onClick} title={label} aria-label={label} className={`grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white transition ${tones[tone] || tones.slate} disabled:cursor-not-allowed disabled:opacity-35`}>
      <Icon className="h-4 w-4" />
    </button>
  );
}

function FollowUpDetail({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm font-black leading-6 text-slate-800">{value}</p>
    </div>
  );
}

function FollowUpMetric({ icon: Icon, label, value, tone }) {
  const tones = {
    orange: 'border-orange-200 bg-orange-50 text-orange-600',
    slate: 'border-slate-200 bg-slate-50 text-slate-600',
    teal: 'border-teal-200 bg-teal-50 text-teal-600',
    violet: 'border-violet-200 bg-violet-50 text-violet-600'
  };
  return (
    <div className="flex min-h-20 items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border ${tones[tone] || tones.slate}`}><Icon className="h-5 w-5" /></span>
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p>
        <p className="truncate text-base font-black text-slate-900">{value}</p>
      </div>
    </div>
  );
}

function DirectoryMetric({ label, value, note }) {
  return (
    <div className="min-h-32 rounded-lg border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5">
      <p className="text-sm font-black text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
      {note && <p className="mt-5 text-xs font-black uppercase text-slate-500">{note}</p>}
    </div>
  );
}

function LeadPersonCell({ name }) {
  const label = String(name || '-').trim() || '-';
  const initials = label === '-' ? '?' : label.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return <span className="lead-person-cell"><span className="lead-person-avatar">{initials}</span><span className="cell-clamp">{label}</span></span>;
}

function resolveLeadStaffName(item = {}, staff = []) {
  const assignments = Array.isArray(item.assignments) ? item.assignments : [];
  const candidates = [
    ...assignments.flatMap((row) => [row?.assignedStaff?.name, row?.assignedStaffText, row?.assignedStaffEmail, row?.assignedStaff]),
    item.assignedStaff?.name, item.assignedStaffText, item.assignedStaffEmail, item.assignedStaff
  ].filter(Boolean);
  const labels = [...new Set(candidates.map((value) => {
    const raw = typeof value === 'object' ? (value.name || value.email || value._id || value.id) : value;
    const matched = staff.find((user) => [user._id, user.id, user.crmUserId, user.userId, user.email, user.name]
      .some((identity) => normalizePersonName(identity) === normalizePersonName(raw)));
    return String(matched?.name || matched?.email || raw || '').trim();
  }).filter((value) => value && !/^[a-f0-9]{24}$/i.test(value)))];
  return labels.join(', ') || item.assignedTo?.name || item.assignedToText || item.generatedForUser?.name || item.generatedForName || '-';
}

function resolveLeadAssignedBy(item = {}, staff = []) {
  const assignments = Array.isArray(item.assignments) ? item.assignments : [];
  const assignment = assignments.find((row) => (row?.assignedStaff || row?.assignedStaffText) && row?.assignedBy)
    || assignments.find((row) => row?.assignedBy)
    || {};
  const raw = assignment.assignedBy || item.assignedBy || '';
  const matched = staff.find((user) => [user._id, user.id, user.crmUserId, user.userId, user.email, user.name]
    .some((identity) => normalizePersonName(identity) === normalizePersonName(raw)));
  return personLabel(matched?.name || matched?.email || raw || (item.generatedForUser || item.generatedForName ? (item.createdBy?.name || item.createdByName || '-') : '-'));
}

function LeadDirectoryPagination({ page, totalPages, setPage }) {
  const pages = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
    const values = new Set([1, 2, totalPages - 1, totalPages, page - 1, page, page + 1]);
    const sorted = [...values].filter((value) => value >= 1 && value <= totalPages).sort((a, b) => a - b);
    return sorted.reduce((items, value, index) => {
      if (index && value - sorted[index - 1] > 1) items.push(`gap-${value}`);
      items.push(value);
      return items;
    }, []);
  }, [page, totalPages]);

  return (
    <div className="lead-directory-pagination">
      <span>Showing page {page} of {totalPages}</span>
      <nav aria-label="Lead directory pagination">
        <button type="button" aria-label="Previous page" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button>
        {pages.map((item) => typeof item === 'string'
          ? <span key={item} className="lead-pagination-gap">…</span>
          : <button type="button" key={item} aria-current={item === page ? 'page' : undefined} className={item === page ? 'is-active' : ''} onClick={() => setPage(item)}>{item}</button>)}
        <button type="button" aria-label="Next page" disabled={page === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>›</button>
      </nav>
    </div>
  );
}

function DirectoryTableHeader({ showing, total, label, rowsPerPage, setRowsPerPage, page, setPage, totalPages }) {
  const start = total ? (page - 1) * rowsPerPage + 1 : 0;
  const end = total ? start + showing - 1 : 0;
  const [draftPage, setDraftPage] = useState(String(page));

  useEffect(() => {
    setDraftPage(String(page));
  }, [page]);

  function jumpToPage(event) {
    event.preventDefault();
    const nextPage = Math.min(totalPages, Math.max(1, Number.parseInt(draftPage, 10) || 1));
    setPage(nextPage);
  }

  return (
    <div className="lead-directory-summary flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-4"><div className="flex items-center gap-3"><span className="lead-directory-summary-icon"><FileText className="h-5 w-5" /></span><div><p className="font-semibold text-slate-800">Showing {showing} of {total} {label}</p><small className="text-slate-400">Page {page} of {totalPages}</small></div></div>
      </div><div className="flex flex-wrap items-center gap-3 font-black text-slate-600">
        <span>{start} - {end} of {total}</span>
        <form onSubmit={jumpToPage} className="inline-flex items-center gap-2">
          <span>Go to:</span>
          <input value={draftPage} onChange={(event) => setDraftPage(event.target.value)} className="h-11 w-20 rounded-lg border border-slate-200 bg-white px-3 text-center font-black outline-none focus:border-emerald-400" inputMode="numeric" />
        </form>
        <span>Rows per page:</span>
        <select value={rowsPerPage} onChange={(event) => setRowsPerPage(Number(event.target.value))} className="h-11 rounded-lg border border-slate-200 bg-white px-3 font-black outline-none">
          {[5, 10, 25, 50, 100].map((count) => <option key={count} value={count}>{count}</option>)}
        </select>
      </div>
    </div>
  );
}

function normalizeHeaderKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s._-]+/g, '')
    .trim();
}

function normalizeExistingClient(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'No';
  if (raw === 'yes' || raw === 'y' || raw === 'true' || raw === '1') return 'Yes';
  return 'No';
}

function normalizePersonName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function personIdentityTokens(...values) {
  return [...new Set(values.flatMap((value) => {
    if (!value) return [];
    if (typeof value === 'object') {
      return [value._id, value.id, value.crmUserId, value.userId, value.name, value.email]
        .map(normalizePersonName).filter(Boolean);
    }
    return [normalizePersonName(value)].filter(Boolean);
  }))];
}

function canUserEditLead(item = {}, currentUser = {}) {
  if (adminRoles.includes(String(currentUser?.role || '').trim().toLowerCase())) return true;
  const userTokens = personIdentityTokens(currentUser);
  if (!userTokens.length) return false;
  const ownerTokens = personIdentityTokens(
    item.createdBy, item.createdByCrmUserId, item.createdByName, item.createdByEmail, item.importedCreatedBy,
    item.generatedForUser, item.generatedForName, item.generatedForEmail,
    item.createdOnBehalfOfUser, item.createdOnBehalfOfName, item.createdOnBehalfOfEmail,
    item.assignedTo, item.assignedToText, item.assignedToEmail,
    item.assignedStaff, item.assignedStaffText, item.assignedStaffEmail
  );
  (Array.isArray(item.assignments) ? item.assignments : []).forEach((assignment) => {
    ownerTokens.push(...personIdentityTokens(
      assignment.assignedTo, assignment.assignedToText, assignment.assignedToEmail,
      assignment.assignedStaff, assignment.assignedStaffText, assignment.assignedStaffEmail
    ));
  });
  (Array.isArray(item.serviceSelections) ? item.serviceSelections : []).forEach((service) => {
    ownerTokens.push(...personIdentityTokens(service.createdByCrmUserId, service.createdByName, service.createdByEmail));
  });
  return ownerTokens.some((identity) => userTokens.includes(identity));
}

function leadStaffIdentityTokens(item = {}) {
  const creatorTokens = personIdentityTokens(
    item.createdBy, item.createdByCrmUserId, item.createdByName, item.createdByEmail, item.importedCreatedBy
  );
  if (creatorTokens.length) return creatorTokens;

  const fallbackTokens = personIdentityTokens(
    item.assignedTo, item.assignedToText, item.assignedToEmail,
    item.assignedStaff, item.assignedStaffText, item.assignedStaffEmail,
    item.generatedForUser, item.generatedForName, item.generatedForEmail
  );
  (Array.isArray(item.assignments) ? item.assignments : []).forEach((assignment) => {
    fallbackTokens.push(...personIdentityTokens(
      assignment.assignedTo, assignment.assignedToText, assignment.assignedToEmail,
      assignment.assignedStaff, assignment.assignedStaffText, assignment.assignedStaffEmail
    ));
  });
  (Array.isArray(item.serviceSelections) ? item.serviceSelections : []).forEach((service) => {
    fallbackTokens.push(...personIdentityTokens(service.createdByCrmUserId, service.createdByName, service.createdByEmail));
  });
  return [...new Set(fallbackTokens)];
}

function compareLeadCode(a, b) {
  const left = Number.parseInt(String(a.leadCode || '').replace(/\D/g, ''), 10) || 0;
  const right = Number.parseInt(String(b.leadCode || '').replace(/\D/g, ''), 10) || 0;
  if (left !== right) return left - right;
  return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
}

function formatExcelValue(value, field) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    const iso = value.toISOString();
    return field === 'nextFollowUpTime' ? iso.slice(11, 16) : iso.slice(0, 10);
  }
  if (typeof value === 'number' && ['lastEmailSent', 'leadDate', 'nextFollowUpDate', 'importedCreatedAt', 'importedUpdatedAt'].includes(field)) {
    return XLSX.SSF.format('yyyy-mm-dd', value);
  }
  if (typeof value === 'number' && field === 'nextFollowUpTime') {
    return XLSX.SSF.format('hh:mm', value);
  }
  return typeof value === 'string' ? value.trim() : value;
}

function mapExcelRowToLead(row, staff) {
  const mapping = {
    communicationmode: 'communicationMode',
    leadid: 'sourceLeadId',
    status: 'status',
    company: 'company',
    industry: 'industryType',
    industrytype: 'industryType',
    servicecategory: 'eprCategory',
    eprcategory: 'eprCategory',
    applicanttype: 'applicantType',
    pibocategorytype: 'piboParent',
    pibosubcategory: 'piboCategory',
    subapplicanttype: 'piboCategory',
    pibocategoryparent: 'piboParent',
    piboparent: 'piboParent',
    pibocategory: 'piboCategory',
    servicesoffered: 'servicesOffered',
    applicableservices: 'applicableService',
    applicableservice: 'applicableService',
    financialyear: 'firstAnnualReturnYearApplicable',
    address: 'addressLine1',
    addressline1: 'addressLine1',
    address1: 'addressLine1',
    addressline2: 'addressLine2',
    address2: 'addressLine2',
    addressline3: 'addressLine3',
    address3: 'addressLine3',
    landmark: 'landmark',
    state: 'state',
    city: 'city',
    pincode: 'pinCode',
    pin: 'pinCode',
    existingclient: 'existingClient',
    website: 'website',
    salutation: 'salutation',
    contactperson: 'contactPerson',
    designation: 'designation',
    emails: 'emails',
    email: 'emails',
    emailssentcount: 'emailsSentCount',
    lastemailsent: 'lastEmailSent',
    mobileno1: 'mobileNo1',
    mobile1: 'mobileNo1',
    phone1: 'mobileNo1',
    mobileno2: 'mobileNo2',
    mobile2: 'mobileNo2',
    phone2: 'mobileNo2',
    whatsappno: 'whatsappNo',
    whatsappnumber: 'whatsappNo',
    linkedin: 'linkedinUrl',
    linkedinurl: 'linkedinUrl',
    businesscardurl: 'businessCardUrl',
    referredby: 'referredBy',
    source: 'source',
    notes: 'notes',
    assignedto: 'assignedToText',
    assignto: 'assignedToText',
    assignedtotext: 'assignedToText',
    assignedby: 'assignedBy',
    createdby: 'importedCreatedBy',
    leaddate: 'leadDate',
    nextfollowupdate: 'nextFollowUpDate',
    nextfollowuptime: 'nextFollowUpTime',
    followupremarks: 'followUpRemarks',
    createdat: 'importedCreatedAt',
    updatedat: 'importedUpdatedAt'
  };

  const data = {};

  Object.entries(row || {}).forEach(([key, value]) => {
    const normalized = normalizeHeaderKey(key);
    const field = mapping[normalized];
    if (!field) return;
    const clean = formatExcelValue(value, field);
    if (field === 'pinCode') data.pinCode = String(clean || '').trim();
    else if (field === 'emailsSentCount') data.emailsSentCount = Number(clean) || 0;
    else if (field === 'existingClient') data.existingClient = normalizeExistingClient(clean);
    else data[field] = clean === null || clean === undefined ? '' : clean;
  });

  if (data.assignedToText && Array.isArray(staff) && staff.length) {
    const raw = normalizePersonName(data.assignedToText);
    const match = staff.find((user) => normalizePersonName(user.name) === raw);
    if (match) data.assignedTo = match._id || match.id;
  }

  if (data.importedCreatedBy && Array.isArray(staff) && staff.length) {
    const raw = normalizePersonName(data.importedCreatedBy);
    const match = staff.find((user) => [user.name, user.email, user.crmUserId, user._id, user.id]
      .some((value) => normalizePersonName(value) === raw));
    if (match) {
      data.createdByCrmUserId = match._id || match.id || match.crmUserId || '';
      data.createdByName = match.name || match.email || '';
      data.createdByEmail = match.email || '';
      data.importedCreatedBy = data.createdByName;
    }
  }

  if (data.piboCategory) {
    const normalizedPibo = normalizeLegacyPiboCategory(data.piboCategory);
    data.piboParent = data.piboParent || normalizedPibo.parent;
    data.piboCategory = normalizedPibo.child;
  }
  if (!data.piboParent && PIBO_PARENTS.includes(data.applicantType)) data.piboParent = data.applicantType;

  return data;
}
