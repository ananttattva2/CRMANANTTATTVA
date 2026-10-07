import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Building2, Briefcase, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Clock3, Database, Download, Edit3, Eye, EyeOff, Factory, FileCheck2, FileText, FolderCheck, Images, KeyRound, MapPin, Package, Plus, RefreshCw, Save, Search, ShieldCheck, Sparkles, Tag, Trash2, Upload, UserRound, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import DashboardShell from '../components/dashboard/DashboardShell';
import ProfileModal from '../components/dashboard/ProfileModal';
import ToastMessage from '../components/ToastMessage';
import SearchableSelect from '../components/form/SearchableSelect';
import PremiumDatePicker from '../components/form/PremiumDatePicker';
import { adminRoles } from '../constants/dashboard';
import api from '../services/api';
import { API_ENDPOINTS } from '../services/apiEndpoints';
import ClientDirectoryView from '../features/clientMaster/ClientDirectoryView';
import ClientSlaPage from '../features/clientMaster/ClientSlaPage';
import ClientLifecycleTracker from '../features/clientMaster/ClientLifecycleTracker';
import { selectOptions } from '../features/clientMaster/clientMaster.constants';
import {
  AddressTab,
  Card,
  CpcbTab,
  CpcbScreenshotTab,
  ComplianceTab,
  ContactsTab,
  CteTab,
  Field,
  SelectLike,
  UploadButton,
} from '../features/clientMaster/ClientMasterFormSections';
import {
  annualDraftLegacyKeys,
  buildAnnualReturnYears,
  enrichClientsFromLeads,
  findClientByRouteKey,
  formatDateInputValue,
  getAnnualDraftAliasValue,
  getAssignedName,
  getClientAliases,
  getClientQuotationContext,
  getClientQuotations,
  getClientUniqueId,
  getFirstAnnualReturnYear,
  getMsmeRows,
  getMsmeSummary,
  getVisibilityStatus,
  mapExcelRowToClient,
  mergeClientData,
  mergeLeadSources,
  normalizeHeaderKey,
  normalizePersonName,
  normalizeFinancialYearLabel,
  readClientData
} from '../features/clientMaster/clientMaster.utils';
import {
  AnnualReturnHistory,
  DetailAccordion,
  EmptyTab,
  annualProcessingTabIds,
  annualProcessingTabLabels,
  formatDisplayDate,
  formatInrValue,
  getAnnualCompletedTabs,
  getAnnualReviewStage,
  getDocumentLinkName,
  getStoredAnnualReturnFiling,
  mapClientDocuments,
  mergeAnnualWorkflowState,
  normalizeAnnualApprovalWorkflow,
  normalizeDocumentUrl,
  normalizeRoleName,
  safeDecode
} from '../features/clientMaster/ClientMasterAnnualReturn';

const tabs = [
  { id: 'companyOverview', label: 'Company Overview', icon: ClipboardList },
  { id: 'basic', label: 'Client Basic Info', icon: Building2 },
  { id: 'address', label: 'Address Details', icon: MapPin },
  { id: 'compliance', label: 'Document', icon: FileCheck2 },
  { id: 'cte', label: 'CTE & CTO / CCA', icon: FolderCheck },
  { id: 'cpcb', label: 'CPCB Login Credential', icon: ShieldCheck },
  { id: 'cpcbScreenshots', label: 'CPCB Screenshot', icon: Images },
  { id: 'contacts', label: 'Authorized Person Details', icon: UserRound }
];

const cpcbApplicationStatuses = ['Fresh Application', 'In Process', 'Client Submit'];
const cpcbRestrictedTabIds = ['compliance', 'cte', 'cpcb', 'cpcbScreenshots'];

function isCpcbRestricted(client = {}) {
  return client.cpcbOnboarding?.cpcbPortalRegistered === false;
}

const complianceRows = [
  ['gst', 'GST Number', 'GST Certificate Date', 'GST Certificate'],
  ['cin', 'CIN', 'CIN Document Date', 'CIN Document'],
  ['pan', 'PAN', 'PAN Document Date', 'PAN Document'],
  ['factoryLicense', 'Factory License No', 'Factory License Document Date', 'Factory License Document'],
  ['eprCertificate', 'EPR Certificate No', 'EPR Certificate File Date', 'EPR Certificate File'],
  ['iec', 'IEC Certificate', 'IEC Certificate Date', 'IEC Certificate File'],
  ['dicDcssi', 'DIC/DCSSI Certificate No', 'DIC/DCSSI Certificate Date', 'DIC/DCSSI Certificate File']
];

function isTyreWasteRecyclerClient(client = {}) {
  const snapshot = client.selectedLeadSnapshot || {};
  const category = String(client.basic?.piboCategory || snapshot.subApplicantType || snapshot.piboCategory || '').trim().toLowerCase();
  const service = String(client.basic?.eprCategory || snapshot.eprCategory || snapshot.serviceCategory || snapshot.servicesOffered || '').trim().toLowerCase();
  return category.includes('recycler') && service.includes('tyre');
}

function isTyreWasteProducerClient(client = {}) {
  const snapshot = client.selectedLeadSnapshot || {};
  const category = String(client.basic?.piboCategory || snapshot.subApplicantType || snapshot.piboCategory || '').trim().toLowerCase();
  const service = String(client.basic?.eprCategory || snapshot.eprCategory || snapshot.serviceCategory || snapshot.servicesOffered || '').trim().toLowerCase();
  return category.includes('producer') && service.includes('tyre');
}

function getApplicableComplianceRows(client = {}) {
  const category = String(client.basic?.piboCategory || client.selectedLeadSnapshot?.piboCategory || '').trim().toLowerCase();
  const applicantType = String(client.selectedLeadSnapshot?.applicantType || client.selectedLeadSnapshot?.piboParent || '').trim().toLowerCase();
  const companyType = String(client.basic?.companyType || '').trim().toLowerCase();
  const isCorporate = ['private limited', 'public limited'].includes(companyType);
  const isNonCorporate = ['llp', 'partnership', 'proprietorship'].includes(companyType);
  if (isTyreWasteRecyclerClient(client)) {
    return complianceRows
      .filter(([key]) => !['factoryLicense', 'dicDcssi'].includes(key))
      .map((row) => (['partnership', 'proprietorship'].includes(companyType) && row[0] === 'cin'
        ? [row[0], 'CIN (Optional)', 'CIN Document Date (Optional)', 'CIN Document (Optional)']
        : row));
  }
  if (applicantType === 'pwp' || category === 'pwp') return complianceRows.filter(([key]) => !['cin', 'factoryLicense', 'iec', 'dicDcssi'].includes(key));
  if (category.includes('producer')) return complianceRows.filter(([key]) => ![
    'iec', 'dicDcssi', ...(isNonCorporate ? ['cin'] : [])
  ].includes(key));
  if (category.includes('brand owner')) {
    const productionFacility = client.compliance?.brandOwnerProductionFacility
      || (client.compliance?.factoryLicenseApplicability === 'Applicable' ? 'Yes' : 'No');
    const factoryApplicable = productionFacility === 'Yes';
    const excluded = new Set([
      'dicDcssi',
      ...(isCorporate || isNonCorporate ? ['iec'] : []),
      ...(isNonCorporate ? ['cin'] : []),
      ...(!factoryApplicable ? ['factoryLicense'] : [])
    ]);
    return complianceRows.filter(([key]) => !excluded.has(key));
  }
  if (category.includes('importer')) {
    const excluded = new Set(['factoryLicense', ...(isNonCorporate ? ['cin'] : ['dicDcssi'])]);
    return complianceRows.filter(([key]) => !excluded.has(key));
  }
  if (isCorporate) return complianceRows.filter(([key]) => !['iec', 'dicDcssi'].includes(key));
  return complianceRows;
}

function getClientApplicability(client = {}) {
  const category = String(client.basic?.piboCategory || client.selectedLeadSnapshot?.subApplicantType || client.selectedLeadSnapshot?.piboCategory || '').trim().toLowerCase();
  const applicantType = String(client.selectedLeadSnapshot?.applicantType || client.selectedLeadSnapshot?.piboParent || '').trim().toLowerCase();
  const isImporter = category === 'importer';
  const isBrandOwner = category.includes('brand owner');
  const isPwp = applicantType === 'pwp' || category === 'pwp';
  const isTyreWasteRecycler = isTyreWasteRecyclerClient(client);
  const isTyreWasteProducer = isTyreWasteProducerClient(client);
  const factoryLicenseApplicability = client.compliance?.factoryLicenseApplicability;
  const brandOwnerProductionFacility = client.compliance?.brandOwnerProductionFacility
    || (factoryLicenseApplicability === 'Applicable' ? 'Yes' : factoryLicenseApplicability === 'Not Applicable' ? 'No' : '');
  const cteTabApplicable = !isImporter && !(isBrandOwner && brandOwnerProductionFacility === 'No');
  const cteApplicable = cteTabApplicable && client.cte?.cteApplicable !== 'No';
  const processDiagramChoiceRequired = isImporter || isBrandOwner;
  const processDiagramRequired = isTyreWasteRecycler
    ? false
    : (processDiagramChoiceRequired ? client.cpcb?.processDiagramRequired === 'Yes' : true);
  return { isImporter, isBrandOwner, isPwp, isTyreWasteRecycler, isTyreWasteProducer, hideProcessDiagram: isTyreWasteRecycler, cteTabApplicable, cteApplicable, processDiagramChoiceRequired: isTyreWasteRecycler ? false : processDiagramChoiceRequired, processDiagramRequired };
}

const tabProgressFields = {
  companyOverview: [
    ['companyOverview', 'companyName'],
    ['companyOverview', 'companySummary'],
    ['companyOverview', 'productName'],
    ['companyOverview', 'productImage'],
    ['companyOverview', 'category']
  ],
  basic: [
    ['basic', 'clientLegalName'],
    ['basic', 'tradeName'],
    ['basic', 'companyType'],
    ['basic', 'piboCategory'],
    ['basic', 'eprCategory'],
    ['basic', 'onboardingYear'],
    ['basic', 'firstAnnualReturnYear']
  ],
  address: [
    ['registeredAddress', 'address1'],
    ['registeredAddress', 'address2'],
    ['registeredAddress', 'address3'],
    ['registeredAddress', 'state'],
    ['registeredAddress', 'city'],
    ['registeredAddress', 'pincode'],
    ['communicationAddress', 'address1'],
    ['communicationAddress', 'address2'],
    ['communicationAddress', 'address3'],
    ['communicationAddress', 'state'],
    ['communicationAddress', 'city'],
    ['communicationAddress', 'pincode']
  ],
  cpcb: [
    ['cpcb', 'linkedToCommonPortal'],
    ['cpcb', 'status'],
    ['cpcb', 'remark'],
    ['cpcb', 'homePageFile'],
    ['cpcb', 'registrationNumber'],
    ['cpcb', 'applicationDate'],
    ['cpcb', 'approvalDate'],
    ['cpcb', 'applicationNumber'],
    ['cpcb', 'ceprUserId'],
    ['cpcb', 'ceprPassword'],
    ['cpcb', 'loginId'],
    ['cpcb', 'loginPassword'],
    ['cpcb', 'unitId']
  ],
  contacts: [
    ['otp', 'mobile'],
    ['otp', 'personName'],
    ['otp', 'designation'],
    ['authorised', 'name'],
    ['authorised', 'designation'],
    ['authorised', 'department'],
    ['authorised', 'reporting'],
    ['authorised', 'mobile'],
    ['authorised', 'email'],
    ['authorised', 'pan'],
    ['authorised', 'panDocument'],
    ['coordinating', 'name'],
    ['coordinating', 'designation'],
    ['coordinating', 'department'],
    ['coordinating', 'reporting'],
    ['coordinating', 'mobile'],
    ['coordinating', 'email']
  ]
};

function isProgressValueFilled(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') {
    return Boolean(value.url || value.secureUrl || value.dataUrl || value.path || value.publicId || value.name || value.fileName);
  }
  return String(value ?? '').trim().length > 0;
}

function countFields(client, fields) {
  return fields.reduce((summary, [section, field]) => {
    const filled = isProgressValueFilled(client?.[section]?.[field]);
    return { total: summary.total + 1, filled: summary.filled + (filled ? 1 : 0) };
  }, { filled: 0, total: 0 });
}

function countRows(rows = [], fields = []) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { filled: 0, total: fields.length };
  }
  return rows.reduce((summary, row) => {
    const rowSummary = fields.reduce((fieldSummary, field) => {
      const filled = isProgressValueFilled(row?.[field]);
      return { total: fieldSummary.total + 1, filled: fieldSummary.filled + (filled ? 1 : 0) };
    }, { filled: 0, total: 0 });
    return { filled: summary.filled + rowSummary.filled, total: summary.total + rowSummary.total };
  }, { filled: 0, total: 0 });
}

function countOptionalRows(rows = [], fields = []) {
  if (!Array.isArray(rows) || rows.length === 0) return { filled: 0, total: 0 };
  return countRows(rows, fields);
}

function addProgressParts(...parts) {
  return parts.reduce((summary, part) => ({
    filled: summary.filled + part.filled,
    total: summary.total + part.total
  }), { filled: 0, total: 0 });
}

function buildClientTabProgress(client = {}) {
  const applicability = getClientApplicability(client);
  const restricted = isCpcbRestricted(client);
  const tyreRecyclerCinOptional = applicability.isTyreWasteRecycler && ['partnership', 'proprietorship'].includes(String(client.basic?.companyType || '').trim().toLowerCase());
  const complianceDocumentFields = getApplicableComplianceRows(client).flatMap(([key]) => [`${key}Number`, `${key}Date`, `${key}File`])
    .filter((field) => !(tyreRecyclerCinOptional && field.startsWith('cin')));
  const ctePlants = Array.isArray(client.cte?.plantWiseDetails) ? client.cte.plantWiseDetails : [];
  const ctePlantFields = [
    'plantName',
    ...(applicability.cteApplicable ? ['cteConsentNo', 'cteCategory', 'cteIssuedDate', 'cteValidDate', 'plantLocation', 'cteDocument'] : []),
    'ctoOrderNo', 'ctoIssueDate', 'ctoValidDate', 'ctoDocument'
  ];
  const progressByTab = {
    companyOverview: countFields(client, tabProgressFields.companyOverview),
    basic: countFields(client, tabProgressFields.basic),
    address: countFields(client, tabProgressFields.address),
    compliance: addProgressParts(
      countRows([client.compliance || {}], complianceDocumentFields),
      countFields(client, [['compliance', 'msmeApplicable']]),
      client.compliance?.msmeApplicable === 'Yes'
        ? countRows(client.msmeRows, ['classificationYear', 'status', 'majorActivity', 'udyamNumber', 'turnover', 'file'])
        : { filled: 0, total: 0 }
    ),
    cte: !applicability.cteTabApplicable ? { filled: 0, total: 0 } : addProgressParts(
      countFields(client, [['cte', 'numberOfPlantsLocations']]),
      countRows(ctePlants, ctePlantFields),
      ...ctePlants.map((plant) => addProgressParts(
        applicability.cteApplicable ? countRows(plant.cteProductionRows, ['productName', 'capacity']) : { filled: 0, total: 0 },
        countRows(plant.ctoProductRows, ['productName', 'quantity'])
      ))
    ),
    cpcb: countFields(client, applicability.isPwp
      ? tabProgressFields.cpcb.filter(([, field]) => !['registrationNumber', 'applicationNumber'].includes(field))
      : tabProgressFields.cpcb),
    cpcbScreenshots: addProgressParts(
      countRows(client.cpcbScreenshots, ['name', 'file']),
      applicability.processDiagramChoiceRequired ? countFields(client, [['cpcb', 'processDiagramRequired']]) : { filled: 0, total: 0 },
      applicability.processDiagramRequired ? countRows(client.processDiagrams, ['name', 'file']) : { filled: 0, total: 0 }
    ),
    contacts: addProgressParts(
      countFields(client, restricted
        ? tabProgressFields.contacts.filter(([section]) => section !== 'authorised')
        : [...tabProgressFields.contacts, ...(applicability.isTyreWasteRecycler ? [['authorised', 'aadhaarNumber'], ['authorised', 'aadhaarDocument']] : [])]),
      countOptionalRows(client.otpContacts, ['mobile', 'personName', 'designation']),
      restricted
        ? { filled: 0, total: 0 }
        : countOptionalRows(client.authorisedPersons, ['name', 'designation', 'department', 'reporting', 'mobile', 'email', 'pan', 'panDocument', ...(applicability.isTyreWasteRecycler ? ['aadhaarNumber', 'aadhaarDocument'] : [])]),
      countOptionalRows(client.coordinatingPersons, ['name', 'designation', 'department', 'reporting', 'mobile', 'email'])
    )
  };

  return tabs.map((tab) => {
    const summary = progressByTab[tab.id] || { filled: 0, total: 0 };
    const percent = summary.total ? Math.round((summary.filled / summary.total) * 100) : 0;
    const locked = restricted && cpcbRestrictedTabIds.includes(tab.id);
    return { ...tab, ...summary, percent, locked, notApplicable: tab.id === 'cte' && !applicability.cteTabApplicable };
  });
}

function normalizeAnnualClientKey(value = '') {
  return String(value || '').trim().toLowerCase();
}

function getAnnualClientMatchKeys(client = {}) {
  const data = readClientData(client);
  const lead = typeof client?.selectedLead === 'object' ? client.selectedLead : {};
  return [
    client?._id,
    client?.id,
    data.importMeta?.uniqueId,
    data.importMeta?.leadNumber,
    lead?._id,
    lead?.id,
    lead?.leadCode,
    getClientUniqueId(client)
  ].map(normalizeAnnualClientKey).filter(Boolean);
}

function getAnnualReturnMatchKeys(row = {}) {
  const client = row.client && typeof row.client === 'object' ? row.client : {};
  const clientData = row.clientData && typeof row.clientData === 'object' ? row.clientData : {};
  return [
    row.clientKey,
    row.client,
    client._id,
    client.id,
    clientData.importMeta?.uniqueId,
    clientData.importMeta?.leadNumber
  ].map(normalizeAnnualClientKey).filter(Boolean);
}

function mapAnnualReturnRecordToFiling(row = {}) {
  return {
    annualYear: row.annualYear,
    status: row.status || row.approvalWorkflow?.status || 'draft',
    activeTab: row.activeTab || '',
    activeSection: row.activeSection || '',
    draft: row.draft || {},
    basicInfo: row.basicInfo || {},
    financials: row.financials || {},
    data: row.data || {},
    brandOwner: row.brandOwner || {},
    importer: row.importer || {},
    annual: row.annual || {},
    approvalWorkflow: row.approvalWorkflow || {},
    savedAt: row.savedAt || row.updatedAt || ''
  };
}

function getSavedAnnualYearLabels(data = {}) {
  const annualReturn = data.annualReturn && typeof data.annualReturn === 'object' && !Array.isArray(data.annualReturn)
    ? data.annualReturn
    : {};
  const filingYears = annualReturn.filings && typeof annualReturn.filings === 'object' && !Array.isArray(annualReturn.filings)
    ? Object.keys(annualReturn.filings)
    : [];
  return [...new Set([
    ...filingYears,
    annualReturn.selectedYear,
    annualReturn.lastSavedYear
  ].map(normalizeFinancialYearLabel).filter(Boolean))];
}

function buildAnnualHubYears(firstAnnualReturnYear, data = {}, routeAnnualYear = '') {
  const computedYears = buildAnnualReturnYears(firstAnnualReturnYear);
  const existingByLabel = new Map(computedYears.map((year) => [year.label, year]));
  const labels = [...new Set([
    ...computedYears.map((year) => year.label),
    ...getSavedAnnualYearLabels(data),
    normalizeFinancialYearLabel(routeAnnualYear)
  ].filter(Boolean))];

  return labels
    .map((label) => {
      const startYear = Number(label.split('-')[0]);
      const filing = data.annualReturn?.filings?.[label] || {};
      return {
        ...(existingByLabel.get(label) || {}),
        startYear,
        label,
        period: 'April - March',
        status: filing.status
          ? `Saved ${filing.status}`
          : existingByLabel.get(label)?.status || 'Open hub'
      };
    })
    .sort((first, second) => first.startYear - second.startYear);
}

function debugAnnualFlow(label, payload = {}) {
  const snapshot = { label, at: new Date().toISOString(), ...payload };
  window.__crmAnnualDebug = snapshot;
  console.debug('[CRM AnnualReturn]', snapshot);
}

function getLeadSelectValue(lead = {}) {
  return String(lead._id || lead.id || lead.sourceLeadId || lead.leadCode || lead.uniqueId || lead.company || '').trim();
}

const CCP_LEAD_SEQUENCE_START = 353;

function getLeadDisplayCode(lead = {}, index = -1) {
  const value = String(
    lead.businessLeadCode
    || lead.leadNumber
    || lead['Lead Number']
    || lead.data?.importMeta?.leadNumber
    || lead.importMeta?.leadNumber
    || lead.leadCode
    || lead.sourceLeadId
    || ''
  ).trim();
  const generatedCode = /^ATPL(?:-LEAD)?-[A-F\d]{10,}$/i.test(value);
  if (generatedCode && index >= 0) return `ATPL-${String(CCP_LEAD_SEQUENCE_START + index).padStart(4, '0')}`;
  const numericMatch = value.match(/^ATPL(?:-LEAD)?-(\d+)$/i);
  return numericMatch ? `ATPL-${numericMatch[1].padStart(4, '0')}` : (value || '-');
}

function getLeadIdentityValues(lead = {}) {
  return [
    lead._id,
    lead.id,
    lead.sourceLeadId,
    lead.leadCode,
    lead.uniqueId,
    lead.leadId,
    lead.company,
    lead.companyName,
    lead.clientName
  ].map((value) => String(value || '').trim()).filter(Boolean);
}

function findLeadByValue(leads = [], value = '') {
  const selected = String(value || '').trim();
  if (!selected) return null;
  const selectedLower = selected.toLowerCase();
  return leads.find((lead) => getLeadIdentityValues(lead).some((candidate) => candidate === selected || candidate.toLowerCase() === selectedLower)) || null;
}

function getMongoObjectIdOrEmpty(value = '') {
  const raw = String(value || '').trim();
  return /^[a-f\d]{24}$/i.test(raw) ? raw : '';
}

function hydrateClientsWithAnnualReturns(clients = [], annualReturns = []) {
  if (!Array.isArray(annualReturns) || !annualReturns.length) return clients;
  const rowsByClientKey = new Map();

  annualReturns.forEach((row) => {
    getAnnualReturnMatchKeys(row).forEach((key) => {
      const rows = rowsByClientKey.get(key) || [];
      rows.push(row);
      rowsByClientKey.set(key, rows);
    });
  });

  return clients.map((client) => {
    const matchingRows = getAnnualClientMatchKeys(client)
      .flatMap((key) => rowsByClientKey.get(key) || []);
    const uniqueRows = [...new Map(matchingRows.map((row) => [`${row.clientKey || ''}:${row.annualYear || ''}:${row._id || ''}`, row])).values()];
    if (!uniqueRows.length) return client;

    const data = readClientData(client);
    const currentAnnualReturn = data.annualReturn && typeof data.annualReturn === 'object' && !Array.isArray(data.annualReturn)
      ? data.annualReturn
      : {};
    const filings = { ...(currentAnnualReturn.filings || {}) };

    uniqueRows.forEach((row) => {
      if (!row.annualYear) return;
      const existing = filings[row.annualYear] || {};
      const incomingFiling = mapAnnualReturnRecordToFiling(row);
      const mergedWorkflow = mergeAnnualWorkflowState(existing.approvalWorkflow || {}, incomingFiling.approvalWorkflow || {});
      filings[row.annualYear] = {
        ...existing,
        ...incomingFiling,
        status: mergedWorkflow.status || incomingFiling.status || existing.status || 'draft',
        draft: { ...(existing.draft || {}), ...(row.draft || {}) },
        approvalWorkflow: mergedWorkflow
      };
    });

    return {
      ...client,
      data: {
        ...data,
        annualReturn: {
          ...currentAnnualReturn,
          lastSavedYear: uniqueRows[0]?.annualYear || currentAnnualReturn.lastSavedYear,
          lastSavedAt: uniqueRows[0]?.savedAt || uniqueRows[0]?.updatedAt || currentAnnualReturn.lastSavedAt,
          filings
        }
      }
    };
  });
}

function isLeadPlaceholderRow(item = {}) {
  const uniqueId = getClientUniqueId(item);
  if (!/^ATPL-LEA(?:D)?/i.test(uniqueId)) return false;

  // A completed Client Master can legitimately retain the source lead number
  // (for example ATPL-LEAD-...).  Treat it as a placeholder only while it has
  // no client-specific data; otherwise the saved client disappears from the
  // directory immediately after submit.
  const data = readClientData(item);
  return ![
    data.basic?.clientLegalName,
    data.basic?.tradeName,
    data.registeredAddress?.address1,
    data.registeredAddress?.state,
    data.otp?.mobile,
    data.authorised?.email,
    data.cpcb?.linkedToCommonPortal,
    item?.workflowStatus
  ].some((value) => String(value || '').trim());
}

function isMeaningfulClientMasterRow(item = {}) {
  const data = readClientData(item);
  return [
    getClientUniqueId(item).replace(/^-$/, ''),
    data.basic?.clientLegalName,
    data.basic?.tradeName,
    data.importMeta?.leadNumber,
    data.importMeta?.uniqueId,
    item?.selectedLead?._id,
    item?.selectedLead?.leadCode,
    typeof item?.selectedLead === 'string' ? item.selectedLead : ''
  ].some((value) => String(value || '').trim());
}

function getClientMasterRows(crmClients = [], ccpClients = []) {
  const rows = [...ccpClients, ...crmClients].filter((item) => isMeaningfulClientMasterRow(item) && !isLeadPlaceholderRow(item));
  const merged = [];
  const indexByStrongKey = new Map();

  const strongKeys = (item) => {
    const data = readClientData(item);
    const assignedServiceId = String(item.assignedServiceId || data.assignedServiceId || data.selectedLeadSnapshot?.assignedServiceId || '').trim().toLowerCase();
    const legacyServiceFingerprint = [
      data.basic?.piboCategory,
      data.basic?.eprCategory,
      data.basic?.servicesOffered,
      data.selectedLeadSnapshot?.subApplicantType,
      data.selectedLeadSnapshot?.servicesOffered
    ].map((value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean).join(':');
    const serviceSuffix = assignedServiceId
      ? `:service:${assignedServiceId}`
      : (legacyServiceFingerprint ? `:legacy-service:${legacyServiceFingerprint}` : '');
    const quotationNumbers = [
      data.quotation?.quotationNumber,
      ...(Array.isArray(data.quotations) ? data.quotations.map((row) => row?.quotationNumber) : [])
    ];
    return [...new Set([
      data.importMeta?.uniqueId && `uid:${String(data.importMeta.uniqueId).trim().toLowerCase()}${serviceSuffix}`,
      data.importMeta?.leadNumber && `lead:${String(data.importMeta.leadNumber).trim().toLowerCase()}${serviceSuffix}`,
      (typeof item.selectedLead === 'string' || typeof item.selectedLead === 'number') && `lead-id:${String(item.selectedLead).trim().toLowerCase()}${serviceSuffix}`,
      ...quotationNumbers.filter(Boolean).map((value) => `quote:${String(value).trim().toLowerCase()}${serviceSuffix}`)
    ].filter(Boolean))];
  };

  const completeness = (item) => {
    const data = readClientData(item);
    return [
      data.importMeta?.uniqueId, data.basic?.tradeName, data.registeredAddress?.state,
      data.basic?.piboCategory, data.basic?.eprCategory, data.cpcb?.status,
      data.otp?.mobile, data.otp?.personName
    ].filter((value) => String(value || '').trim()).length;
  };

  rows.forEach((item) => {
    const keys = strongKeys(item);
    const existingIndex = keys.map((key) => indexByStrongKey.get(key)).find((index) => index !== undefined);
    if (existingIndex === undefined) {
      const index = merged.length;
      merged.push(item);
      keys.forEach((key) => indexByStrongKey.set(key, index));
      return;
    }

    const existing = merged[existingIndex];
    const itemIsMoreComplete = completeness(item) > completeness(existing);
    const primary = itemIsMoreComplete ? item : existing;
    const fallback = itemIsMoreComplete ? existing : item;
    merged[existingIndex] = {
      ...fallback,
      ...primary,
      adminControls: { ...(fallback.adminControls || {}), ...(primary.adminControls || {}) },
      data: mergeClientData(readClientData(primary), readClientData(fallback))
    };
    strongKeys(merged[existingIndex]).forEach((key) => indexByStrongKey.set(key, existingIndex));
  });

  return merged;
}

function getClientServiceIdentityTokens(item = {}) {
  const data = readClientData(item);
  const selectedLead = typeof item.selectedLead === 'object' ? item.selectedLead : {};
  return [...new Set([
    item.companyIdentity && `company:${String(item.companyIdentity).trim().toLowerCase()}`,
    (selectedLead?._id || (typeof item.selectedLead === 'string' ? item.selectedLead : '')) && `lead-id:${String(selectedLead?._id || item.selectedLead).trim().toLowerCase()}`,
    (selectedLead?.leadCode || data.importMeta?.leadNumber) && `lead-code:${String(selectedLead?.leadCode || data.importMeta?.leadNumber).trim().toLowerCase()}`,
    (data.basic?.clientLegalName || data.basic?.tradeName || selectedLead?.company) && `company-name:${String(data.basic?.clientLegalName || data.basic?.tradeName || selectedLead?.company).trim().toLowerCase().replace(/[^a-z0-9]/g, '')}`
  ].filter(Boolean))];
}

function normalizeChooserServiceCategory(value = '') {
  const token = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (token.includes('plastic')) return 'plastic-waste';
  if (token.includes('ewaste') || token.includes('electronic')) return 'e-waste';
  if (token.includes('battery')) return 'battery-waste';
  if (token.includes('tyre') || token.includes('tire')) return 'tyre-waste';
  if (token.includes('usedoil')) return 'used-oil-waste';
  return token;
}

function dedupeClientServiceChooserOptions(services = []) {
  const optionsByApplicantAndCategory = new Map();
  services.forEach((service, index) => {
    const data = readClientData(service);
    const groupedIdentity = clientMasterGroupingIdentity({
      applicantType: data.selectedLeadSnapshot?.applicantType || data.selectedLeadSnapshot?.piboParent || data.selectedLeadSnapshot?.piboCategoryParent,
      subApplicantType: data.basic?.piboCategory || data.selectedLeadSnapshot?.subApplicantType || data.selectedLeadSnapshot?.piboCategory,
      plantUnit: data.selectedLeadSnapshot?.plantUnit
    });
    const applicant = String(data.basic?.piboCategory || data.selectedLeadSnapshot?.subApplicantType || data.selectedLeadSnapshot?.piboCategory || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const category = data.basic?.eprCategory || data.selectedLeadSnapshot?.eprCategory || '';
    const categoryKey = normalizeChooserServiceCategory(category);
    const semanticKey = groupedIdentity || (applicant && categoryKey ? `${applicant}:${categoryKey}` : `record:${getClientServiceViewKey(service) || index}`);
    const canonicalCategory = /^EPR\s*-\s*(?:Plastic|E-Waste|Battery|Tyre|Used Oil)\s+Waste$/i.test(String(category).trim());
    const score = (String(service.workflowStatus || '').toLowerCase() === 'submitted' ? 10000 : 0)
      + (canonicalCategory ? 100 : 0)
      + [data.basic?.clientLegalName, data.basic?.tradeName, data.importMeta?.uniqueId, data.cpcb?.status].filter((value) => String(value || '').trim()).length;
    const current = optionsByApplicantAndCategory.get(semanticKey);
    if (!current || score > current.score) optionsByApplicantAndCategory.set(semanticKey, { service, score });
  });
  return [...optionsByApplicantAndCategory.values()].map(({ service }) => service);
}

function getRelatedClientServices(clients = [], selectedClient = null) {
  if (!selectedClient) return [];
  const selectedTokens = new Set(getClientServiceIdentityTokens(selectedClient));
  const related = clients.filter((item) => getClientServiceIdentityTokens(item).some((token) => selectedTokens.has(token)));
  const clientRows = related.length ? related : [selectedClient];
  const persistedRecords = [];
  const persistedRecordKeys = new Set();
  clientRows.forEach((item) => {
    const data = readClientData(item);
    const recordId = String(item?._id || item?.id || item?.clientMasterId || '').trim();
    const assignedServiceId = String(item?.assignedServiceId || data.assignedServiceId || data.selectedLeadSnapshot?.assignedServiceId || '').trim();
    const key = [recordId, assignedServiceId].filter(Boolean).join(':') || getClientServiceViewKey(item);
    if (!key || persistedRecordKeys.has(key)) return;
    persistedRecordKeys.add(key);
    persistedRecords.push({
      ...item,
      clientMasterId: recordId || item?.clientMasterId,
      assignedServiceId,
      _serviceViewKey: key
    });
  });
  // When separate Client Master documents exist for the same company, keep
  // those exact records as the chooser options. Rebuilding them from a Lead's
  // services can mix an Importer record with a Brand Owner record.
  if (persistedRecords.length > 1) return dedupeClientServiceChooserOptions(persistedRecords);
  const populatedLead = clientRows.map((item) => item?.selectedLead).find((lead) => lead && typeof lead === 'object' && Array.isArray(lead.serviceSelections));
  const services = populatedLead?.serviceSelections || [];
  if (services.length < 2) return clientRows;

  const normalize = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const serviceFingerprint = (service = {}) => [
    service.subApplicantType || service.piboCategory,
    service.eprCategory,
    service.servicesOffered
  ].map(normalize).filter(Boolean).join(':');
  return dedupeClientServiceChooserOptions(services.map((service, index) => {
    const assignedServiceId = readAssignedServiceId(service);
    const exactMatches = clientRows.filter((item) => {
      const data = readClientData(item);
      const itemServiceId = String(item.assignedServiceId || data.assignedServiceId || data.selectedLeadSnapshot?.assignedServiceId || '').trim();
      return Boolean(assignedServiceId && itemServiceId && itemServiceId === assignedServiceId);
    });
    const legacyMatches = exactMatches.length ? [] : clientRows.filter((item) => {
      const data = readClientData(item);
      const itemServiceId = String(item.assignedServiceId || data.assignedServiceId || data.selectedLeadSnapshot?.assignedServiceId || '').trim();
      return !itemServiceId && legacyServiceFingerprintCompatible({
        ...data.selectedLeadSnapshot,
        eprCategory: data.basic?.eprCategory || data.selectedLeadSnapshot?.eprCategory,
        subApplicantType: data.basic?.piboCategory || data.selectedLeadSnapshot?.subApplicantType || data.selectedLeadSnapshot?.piboCategory,
        servicesOffered: data.basic?.servicesOffered || data.selectedLeadSnapshot?.servicesOffered
      }, service);
    });
    const matched = exactMatches[0] || (legacyMatches.length === 1 ? legacyMatches[0] : null);
    // An unpersisted lead service must not inherit another service's Client
    // Master document merely because both services belong to the same lead.
    const source = matched || { selectedLead: populatedLead, data: {} };
    const sourceData = readClientData(source);
    const activeData = activateAssignedService(sourceData, service, services.length);
    return {
      ...source,
      _serviceViewKey: assignedServiceId || `legacy-service-${index}-${serviceFingerprint(service) || index}`,
      assignedServiceId,
      selectedLead: populatedLead,
      data: {
        ...activeData,
        selectedLeadSnapshot: { ...(activeData.selectedLeadSnapshot || {}), ...service, assignedServiceId },
        basic: {
          ...(activeData.basic || {}),
          piboCategory: service.subApplicantType || service.piboCategory || activeData.basic?.piboCategory || '',
          eprCategory: service.eprCategory || activeData.basic?.eprCategory || '',
          servicesOffered: service.servicesOffered || activeData.basic?.servicesOffered || ''
        }
      }
    };
  }));
}

function getClientServiceViewKey(item = {}) {
  const data = readClientData(item);
  return String(item._serviceViewKey || item.assignedServiceId || data.assignedServiceId || data.selectedLeadSnapshot?.assignedServiceId || item._id || item.id || getClientUniqueId(item));
}

function getClientServiceOptionLabel(item = {}, index = 0) {
  const data = readClientData(item);
  const serviceCategory = data.basic?.eprCategory || 'Service category not set';
  const applicant = data.basic?.piboCategory || 'Applicant type not set';
  const serviceName = data.basic?.servicesOffered;
  return [applicant, serviceCategory, serviceName].filter(Boolean).join(' · ') || `Service ${index + 1}`;
}

function getApplicantCardTheme(applicantType = '') {
  const normalized = String(applicantType || '').trim().toLowerCase();
  if (normalized.includes('brand')) {
    return {
      icon: ShieldCheck,
      iconClass: 'bg-blue-50 text-blue-700 ring-blue-100',
      badgeClass: 'bg-blue-50 text-blue-700 ring-blue-100',
      buttonClass: 'from-blue-700 to-indigo-700 shadow-blue-900/20',
      hoverClass: 'hover:border-blue-300 hover:shadow-blue-100'
    };
  }
  if (normalized.includes('producer') || normalized.includes('manufacturer')) {
    return {
      icon: Factory,
      iconClass: 'bg-orange-50 text-orange-600 ring-orange-100',
      badgeClass: 'bg-orange-50 text-orange-700 ring-orange-100',
      buttonClass: 'from-orange-500 to-orange-600 shadow-orange-900/20',
      hoverClass: 'hover:border-orange-300 hover:shadow-orange-100'
    };
  }
  return {
    icon: Building2,
    iconClass: 'bg-emerald-50 text-teal-700 ring-emerald-100',
    badgeClass: 'bg-emerald-50 text-teal-700 ring-emerald-100',
    buttonClass: 'from-teal-700 to-emerald-600 shadow-emerald-900/20',
    hoverClass: 'hover:border-emerald-300 hover:shadow-emerald-100'
  };
}

function ClientServiceChooserModal({ selection, onClose, onSelect }) {
  const [visibleCredentials, setVisibleCredentials] = useState(() => new Set());
  const hasMultipleServices = selection.services.length > 1;
  const toggleCredential = (key) => setVisibleCredentials((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  return (
    <div className="fixed inset-0 z-[10000] grid place-items-center overflow-y-auto bg-slate-950/65 p-4 backdrop-blur-md sm:p-6" role="dialog" aria-modal="true" aria-labelledby="client-service-view-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="relative my-auto w-full max-w-6xl overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.35)]">
        <div className="pointer-events-none absolute -right-16 top-24 h-64 w-64 rounded-full bg-emerald-50/70 blur-3xl" />
        <header className="relative flex items-start gap-4 border-b border-slate-100 px-5 py-6 sm:px-8 sm:py-7">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-teal-700 ring-1 ring-emerald-100">
            <Briefcase className="h-7 w-7" />
          </span>
          <div className="min-w-0 pr-10">
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-teal-700">Select Client Master Type</p>
            <h2 id="client-service-view-title" className="mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Which Client Master do you want to view?</h2>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500 sm:text-base">{hasMultipleServices
              ? 'This company has multiple service-specific records. Select the applicant and sub-applicant type to open its exact Client Master data.'
              : 'Confirm the applicant and sub-applicant type before opening this Client Master.'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close applicant type selection" className="absolute right-5 top-5 grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md sm:right-7 sm:top-7"><X className="h-5 w-5" /></button>
        </header>

        <div className="relative grid gap-4 p-5 sm:p-8 md:grid-cols-3">
          {selection.services.map((service, index) => {
            const serviceData = readClientData(service);
            const applicantType = serviceData.selectedLeadSnapshot?.applicantType || serviceData.selectedLeadSnapshot?.piboParent || serviceData.selectedLeadSnapshot?.piboCategoryParent || service.applicantType || service.piboParent || service.piboCategoryParent || 'Not provided';
            const subApplicantType = serviceData.basic?.piboCategory || serviceData.selectedLeadSnapshot?.subApplicantType || serviceData.selectedLeadSnapshot?.piboCategory || service.subApplicantType || service.piboCategory || 'Not applicable';
            const category = serviceData.basic?.eprCategory || serviceData.selectedLeadSnapshot?.eprCategory || 'Service category not provided';
            const theme = getApplicantCardTheme(applicantType);
            const ApplicantIcon = theme.icon;
            const ceprUserId = service.ceprUserId || serviceData.cpcb?.ceprUserId || '';
            const ceprPassword = service.ceprPassword || serviceData.cpcb?.ceprPassword || '';
            const credentialKey = `${getClientServiceViewKey(service) || index}:password`;
            const passwordVisible = visibleCredentials.has(credentialKey);
            return (
              <article key={getClientServiceViewKey(service) || index} className={`group relative flex min-h-[270px] flex-col rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-xl ${theme.hoverClass}`}>
                <span className={`grid h-16 w-16 place-items-center rounded-2xl ring-1 ${theme.iconClass}`}><ApplicantIcon className="h-8 w-8" /></span>
                {(ceprUserId || ceprPassword) && <div className="absolute right-5 top-5 max-w-[58%] space-y-1.5 text-right">
                  {ceprUserId && <p className="truncate text-[10px] font-black text-slate-500" title={ceprUserId}>CEPR ID: <span className="text-slate-900">{ceprUserId}</span></p>}
                  {ceprPassword && <div className="flex items-center justify-end gap-1 text-[10px] font-black text-slate-500"><span>CEPR Password:</span><span className="max-w-20 truncate text-slate-900">{passwordVisible ? ceprPassword : '••••••••'}</span><button type="button" onClick={(event) => { event.stopPropagation(); toggleCredential(credentialKey); }} className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50" aria-label={passwordVisible ? 'Hide CEPR password' : 'View CEPR password'}>{passwordVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button></div>}
                </div>}
                <div className="mt-5 space-y-3">
                  <div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Applicant Type</p><h3 className="mt-1 text-2xl font-black tracking-tight text-slate-950">{applicantType}</h3></div>
                  <div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Sub Applicant Type</p><p className="mt-1 text-base font-black text-slate-700">{subApplicantType}</p></div>
                </div>
                <span className={`mt-3 w-fit rounded-xl px-3 py-2 text-sm font-black ring-1 ${theme.badgeClass}`}>{category}</span>
                <div className="my-4 h-px bg-slate-100" />
                <p className="flex items-center gap-2 text-sm font-bold text-slate-500"><ShieldCheck className="h-5 w-5 text-slate-500" />Service-specific record available</p>
                <button type="button" onClick={() => onSelect(service)} className={`mt-auto inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r px-4 text-sm font-black text-white shadow-lg transition group-hover:brightness-105 ${theme.buttonClass}`}>View Client Master<ChevronRight className="h-5 w-5" /></button>
              </article>
            );
          })}
        </div>

        <footer className="relative flex items-center gap-3 border-t border-emerald-100 bg-gradient-to-r from-emerald-50/80 to-cyan-50/60 px-5 py-4 text-sm font-bold text-slate-600 sm:px-8">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-teal-700 shadow-sm ring-1 ring-emerald-100"><ShieldCheck className="h-5 w-5" /></span>
          {hasMultipleServices
            ? `You can switch between this company's Client Master records at any time.`
            : 'The service-specific Client Master record shown above will open.'}
        </footer>
      </section>
    </div>
  );
}

const emptyClient = {
  selectedLead: '',
  assignedServiceId: '',
  cpcbOnboarding: {},
  cpcbDataByAssignedServiceId: {},
  serviceDetailsByAssignedServiceId: {},
  adminControls: { approvalStatus: 'PENDING', visibilityStatus: 'LIVE', assignedTo: '' },
  companyOverview: {
    companyName: '',
    companySummary: '',
    overviewItems: ['What about company', 'Company deal', 'Product name and user'],
    productName: '',
    productManufacturer: '',
    productImage: null,
    category: [],
    numberOfEmployees: ''
  },
  basic: { clientLegalName: '', tradeName: '', companyType: '', piboCategory: '', eprCategory: '', onboardingYear: '', firstAnnualReturnYear: '' },
  registeredAddress: {},
  communicationAddress: {},
  compliance: {},
  msmeRows: [],
  cte: { numberOfPlantsLocations: '', plantWiseDetails: [] },
  cpcb: { linkedToCommonPortal: '' },
  cpcbScreenshots: [],
  processDiagrams: [],
  otp: {},
  otpContacts: [],
  authorised: {},
  authorisedPersons: [],
  coordinating: {},
  coordinatingPersons: []
};

function readAssignedServiceId(service = {}) {
  return String(service.assignedServiceId || service.serviceAssignmentId || service.assignmentId || '').trim();
}

function normalizeClientMasterSearchValue(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function isLeadClosedForClientMaster(lead = {}) {
  const services = Array.isArray(lead.serviceSelections) && lead.serviceSelections.length ? lead.serviceSelections : [lead];
  const assignments = Array.isArray(lead.assignments) && lead.assignments.length ? lead.assignments : [lead];
  return services.some((service, index) => {
    const assignment = assignments[index] || {};
    return Boolean(
      service?.closedBy || service?.closedByText || service?.closedAt
      || assignment.closedBy || assignment.closedByText || assignment.closedAt
      || (services.length === 1 && (lead.closedBy || lead.closedByText || lead.closedAt))
    );
  });
}

function isLeadServiceClosedForClientMaster(lead = {}, service = {}, index = 0) {
  if (service?._existingClientMaster || service?.clientMasterId) return true;
  const assignedServiceId = readAssignedServiceId(service);
  if (Array.isArray(lead?.clientMasterEligibleServiceIds)) {
    return lead.clientMasterEligibleServiceIds
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .includes(assignedServiceId);
  }
  const services = Array.isArray(lead.serviceSelections) && lead.serviceSelections.length ? lead.serviceSelections : [lead];
  const assignments = Array.isArray(lead.assignments) && lead.assignments.length ? lead.assignments : [lead];
  const assignment = assignments.find((row) => assignedServiceId && readAssignedServiceId(row) === assignedServiceId)
    || assignments[index]
    || {};
  return Boolean(
    service?.closedBy || service?.closedByText || service?.closedAt
    || assignment.closedBy || assignment.closedByText || assignment.closedAt
    || (services.length === 1 && (lead.closedBy || lead.closedByText || lead.closedAt))
  );
}

function filterClientMasterSearchItems(items = [], leads = []) {
  const leadByIdentity = new Map();
  (Array.isArray(leads) ? leads : []).forEach((lead) => {
    [lead._id, lead.id, lead.sourceLeadId, lead.leadCode].map(normalizeClientMasterSearchValue).filter(Boolean)
      .forEach((identity) => leadByIdentity.set(identity, lead));
  });
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (item.clientMasterId) return true;
    // Remote discovery already applies the authenticated visibility filter and
    // returns closure totals. Keep eligible closed leads even when they are not
    // present in the page's small local lead cache yet.
    if (Number(item.closedServiceCount) > 0) return true;
    const lead = [item.leadId, item.selectionKey, item.leadCode]
      .map(normalizeClientMasterSearchValue).filter(Boolean)
      .map((identity) => leadByIdentity.get(identity)).find(Boolean);
    return Boolean(lead && isLeadClosedForClientMaster(lead));
  });
}

function buildSearchableClientMasterLeads(leads = [], clientMasters = []) {
  const sourceLeads = (Array.isArray(leads) ? leads : []).map((lead) => ({ ...lead, _clientMasterServices: [] }));
  const companyCounts = new Map();
  sourceLeads.forEach((lead) => {
    const company = normalizeClientMasterSearchValue(lead.company || lead.companyName || lead.clientName);
    if (company) companyCounts.set(company, (companyCounts.get(company) || 0) + 1);
  });

  const unmatched = [];
  (Array.isArray(clientMasters) ? clientMasters : []).forEach((master) => {
    const masterIds = [master.selectedLead, master.leadCode].map(normalizeClientMasterSearchValue).filter(Boolean);
    const masterCompany = normalizeClientMasterSearchValue(master.companyName);
    const match = sourceLeads.find((lead) => {
      const stableLeadIds = [lead._id, lead.id, lead.sourceLeadId, lead.leadCode, lead.uniqueId, lead.leadId]
        .map(normalizeClientMasterSearchValue).filter(Boolean);
      if (masterIds.some((id) => stableLeadIds.includes(id))) return true;
      const leadCompany = normalizeClientMasterSearchValue(lead.company || lead.companyName || lead.clientName);
      return Boolean(masterCompany && leadCompany === masterCompany && companyCounts.get(masterCompany) === 1);
    });
    if (match) match._clientMasterServices.push(master);
    else unmatched.push(master);
  });

  const legacyGroups = new Map();
  unmatched.forEach((master) => {
    const key = normalizeClientMasterSearchValue(master.selectedLead || master.leadCode || master.companyName || master.clientMasterId);
    if (!key) return;
    const group = legacyGroups.get(key) || {
      _id: master.selectedLead || `client-master:${master.clientMasterId}`,
      sourceLeadId: master.selectedLead || '',
      leadCode: master.leadCode || '',
      company: master.companyName || 'Existing Client Master',
      _clientMasterServices: []
    };
    group._clientMasterServices.push(master);
    legacyGroups.set(key, group);
  });
  return [...sourceLeads, ...legacyGroups.values()];
}

function getClientRecordAssignedServiceIds(item = {}) {
  const data = readClientData(item);
  // IDs on a populated Lead describe every service on that lead; they are not
  // identities of this individual Client Master document.
  return [...new Set([
    item.assignedServiceId,
    data.assignedServiceId,
    data.selectedLeadSnapshot?.assignedServiceId
  ].map(normalizeDraftKey).filter(Boolean))];
}

function clientMasterServiceFingerprint(service = {}) {
  const normalize = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return [
    service.industryType,
    service.businessCategory,
    service.eprCategory || service.serviceCategory,
    service.applicantType || service.piboParent || service.piboCategoryParent,
    service.subApplicantType || service.piboCategory,
    service.servicesOffered,
    service.applicableService,
    service.plantUnit
  ].map(normalize).join(':');
}

function clientMasterGroupingIdentity(service = {}) {
  const normalize = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const applicantType = normalize(service.applicantType || service.piboParent || service.piboCategoryParent);
  const subApplicantType = normalize(service.subApplicantType || service.piboCategory || 'not-applicable') || 'notapplicable';
  const plantUnit = normalize(service.plantUnit);
  if (!applicantType || !plantUnit) return '';
  return `${applicantType}:${subApplicantType}:${plantUnit}`;
}

function legacyServiceFingerprintCompatible(lhsRaw, rhsRaw) {
  const normalize = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const build = (svc = {}) => [
    normalize(svc.industryType),
    normalize(svc.businessCategory),
    normalize(svc.eprCategory || svc.serviceCategory),
    normalize(svc.applicantType || svc.piboParent || svc.piboCategoryParent),
    normalize(svc.subApplicantType || svc.piboCategory),
    normalize(svc.servicesOffered),
    normalize(svc.applicableService),
    normalize(svc.plantUnit)
  ];
  const lhs = build(lhsRaw);
  const rhs = build(rhsRaw);
  const piboIndex = 4;
  const servicesOfferedIndex = 5;
  const industryIndex = 0;
  const eprIndex = 2;
  const applicantIndex = 3;
  const plantIndex = 7;
  if (lhs[piboIndex] && rhs[piboIndex] && lhs[piboIndex] !== rhs[piboIndex]) return false;
  if (lhs[eprIndex] && rhs[eprIndex] && lhs[eprIndex] !== rhs[eprIndex]) return false;
  if (lhs[applicantIndex] && rhs[applicantIndex] && lhs[applicantIndex] !== rhs[applicantIndex]) return false;
  if (lhs[industryIndex] && rhs[industryIndex] && lhs[industryIndex] !== rhs[industryIndex]) return false;
  if (lhs[plantIndex] && rhs[plantIndex] && lhs[plantIndex] !== rhs[plantIndex]) return false;
  return true;
}

function uniqueClientMasterServices(services = []) {
  const seen = new Set();
  return services.filter((service, index) => {
    const fingerprint = clientMasterServiceFingerprint(service);
    const groupingIdentity = clientMasterGroupingIdentity(service);
    const key = groupingIdentity
      ? `client-master-group:${groupingIdentity}`
      : (service.clientMasterId
          ? `client-master:${service.clientMasterId}`
          : (readAssignedServiceId(service) || (fingerprint.replace(/:/g, '') ? fingerprint : `service-${index}`)));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function activateAssignedService(data = {}, service = {}, serviceCount = 1) {
  const assignedServiceId = readAssignedServiceId(service);
  const scoped = data.cpcbDataByAssignedServiceId?.[assignedServiceId];
  const savedAssignmentId = String(data.assignedServiceId || data.selectedLeadSnapshot?.assignedServiceId || '').trim();
  const legacyServiceName = String(data.selectedLeadSnapshot?.servicesOffered || '').trim();
  const selectedServiceName = String(service.servicesOffered || '').trim();
  const scopedDetails = data.serviceDetailsByAssignedServiceId?.[assignedServiceId];
  const address = service.addressData || {};
  const contact = service.contactData || {};
  const allowLegacy = savedAssignmentId
    ? String(savedAssignmentId).trim().toLowerCase() === String(assignedServiceId).trim().toLowerCase()
    : (serviceCount === 1
        || (legacyServiceName && legacyServiceName.toLowerCase() === selectedServiceName.toLowerCase())
        || legacyServiceFingerprintCompatible(data.selectedLeadSnapshot || {}, service)
        || legacyServiceFingerprintCompatible({
            industryType: data.selectedLeadSnapshot?.industryType,
            businessCategory: data.selectedLeadSnapshot?.businessCategory,
            eprCategory: data.basic?.eprCategory || data.selectedLeadSnapshot?.eprCategory,
            applicantType: data.selectedLeadSnapshot?.applicantType,
            subApplicantType: data.basic?.piboCategory || data.selectedLeadSnapshot?.piboCategory,
            servicesOffered: data.basic?.servicesOffered || data.selectedLeadSnapshot?.servicesOffered,
            applicableService: data.selectedLeadSnapshot?.applicableService,
            plantUnit: data.selectedLeadSnapshot?.plantUnit
          }, service));
  const hasScopedAddress = scopedDetails?.registeredAddress &&
    (String(scopedDetails.registeredAddress.address1 || '').trim() || String(scopedDetails.registeredAddress.state || '').trim() || String(scopedDetails.registeredAddress.city || '').trim());
  const hasScopedCommunication = scopedDetails?.communicationAddress &&
    (String(scopedDetails.communicationAddress.address1 || '').trim() || String(scopedDetails.communicationAddress.state || '').trim() || String(scopedDetails.communicationAddress.city || '').trim());
  const hasScopedOtp = scopedDetails?.otp && (String(scopedDetails.otp.mobile || '').trim() || String(scopedDetails.otp.personName || '').trim());
  const hasScopedAuth = scopedDetails?.authorised &&
    (String(scopedDetails.authorised.name || '').trim() || String(scopedDetails.authorised.email || '').trim() || String(scopedDetails.authorised.mobile || '').trim());
  const hasScopedCoord = scopedDetails?.coordinating &&
    (String(scopedDetails.coordinating.name || '').trim() || String(scopedDetails.coordinating.email || '').trim() || String(scopedDetails.coordinating.mobile || '').trim());
  const hasScopedCpcb = scoped?.cpcb || scoped?.details
    ? Object.keys(scoped.cpcb || scoped.details || {}).length > 0
    : false;
  const hasScopedScreenshots = scoped && (
    (Array.isArray(scoped.cpcbScreenshots) && scoped.cpcbScreenshots.length > 0) ||
    (Array.isArray(scoped.documents) && scoped.documents.length > 0)
  );
  const hasDataAddress = data.registeredAddress &&
    (String(data.registeredAddress.address1 || '').trim() || String(data.registeredAddress.state || '').trim() || String(data.registeredAddress.city || '').trim());
  const hasDataCommunication = data.communicationAddress &&
    (String(data.communicationAddress.address1 || '').trim() || String(data.communicationAddress.state || '').trim() || String(data.communicationAddress.city || '').trim());
  const hasDataOtp = data.otp && (String(data.otp.mobile || '').trim() || String(data.otp.personName || '').trim());
  const hasDataAuth = data.authorised &&
    (String(data.authorised.name || '').trim() || String(data.authorised.email || '').trim() || String(data.authorised.mobile || '').trim());
  const hasDataCoord = data.coordinating &&
    (String(data.coordinating.name || '').trim() || String(data.coordinating.email || '').trim() || String(data.coordinating.mobile || '').trim());
  const hasDataCpcb = data.cpcb ? Object.keys(data.cpcb).filter((k) => k !== 'linkedToCommonPortal').length > 0 : false;
  const hasDataScreenshots = Array.isArray(data.cpcbScreenshots) && data.cpcbScreenshots.length > 0;
  const useFallback = (scoped, hasScoped, hasData, dataFallback, leadFallback) => {
    if (scoped && hasScoped) return scoped;
    if (allowLegacy && hasData) return dataFallback;
    return leadFallback;
  };
  const servicePibo = String(service.subApplicantType || service.piboCategory || '').trim();
  const serviceEpr = String(service.eprCategory || '').trim();
  const serviceOffered = String(service.servicesOffered || service.serviceName || '').trim();
  return {
    ...data,
    assignedServiceId,
    registeredAddress: useFallback(
      scopedDetails?.registeredAddress,
      hasScopedAddress,
      hasDataAddress,
      data.registeredAddress || {},
      { address1: address.addressLine1 || '', address2: address.addressLine2 || '', address3: address.addressLine3 || '', state: address.state || '', city: address.city || '', pincode: address.pinCode || '' }
    ),
    communicationAddress: useFallback(
      scopedDetails?.communicationAddress,
      hasScopedCommunication,
      hasDataCommunication,
      data.communicationAddress || {},
      { address1: address.addressLine1 || '', address2: address.addressLine2 || '', address3: address.addressLine3 || '', state: address.state || '', city: address.city || '', pincode: address.pinCode || '' }
    ),
    otp: useFallback(
      scopedDetails?.otp,
      hasScopedOtp,
      hasDataOtp,
      data.otp || {},
      { mobile: contact.mobileNo1 || '', personName: contact.contactPerson || '', designation: contact.designation || '' }
    ),
    otpContacts: scopedDetails?.otpContacts && Array.isArray(scopedDetails.otpContacts) && scopedDetails.otpContacts.length
      ? scopedDetails.otpContacts
      : (allowLegacy && Array.isArray(data.otpContacts) && data.otpContacts.length ? data.otpContacts : []),
    authorised: useFallback(
      scopedDetails?.authorised,
      hasScopedAuth,
      hasDataAuth,
      data.authorised || {},
      { name: contact.contactPerson || '', designation: contact.designation || '', mobile: contact.mobileNo1 || '', email: contact.emails || '' }
    ),
    authorisedPersons: scopedDetails?.authorisedPersons && Array.isArray(scopedDetails.authorisedPersons) && scopedDetails.authorisedPersons.length
      ? scopedDetails.authorisedPersons
      : (allowLegacy && Array.isArray(data.authorisedPersons) && data.authorisedPersons.length ? data.authorisedPersons : []),
    coordinating: useFallback(
      scopedDetails?.coordinating,
      hasScopedCoord,
      hasDataCoord,
      data.coordinating || {},
      { name: contact.contactPerson || '', designation: contact.designation || '', mobile: contact.mobileNo1 || '', email: contact.emails || '' }
    ),
    coordinatingPersons: scopedDetails?.coordinatingPersons && Array.isArray(scopedDetails.coordinatingPersons) && scopedDetails.coordinatingPersons.length
      ? scopedDetails.coordinatingPersons
      : (allowLegacy && Array.isArray(data.coordinatingPersons) && data.coordinatingPersons.length ? data.coordinatingPersons : []),
    cpcb: hasScopedCpcb
      ? { linkedToCommonPortal: '', ...(scoped.cpcb || scoped.details || {}) }
      : allowLegacy && hasDataCpcb
        ? { linkedToCommonPortal: '', ...(data.cpcb || {}) }
        : { linkedToCommonPortal: '' },
    cpcbScreenshots: hasScopedScreenshots
      ? (Array.isArray(scoped.cpcbScreenshots) ? scoped.cpcbScreenshots : (Array.isArray(scoped.documents) ? scoped.documents : []))
      : allowLegacy && hasDataScreenshots
        ? data.cpcbScreenshots
        : [],
    basic: {
      ...(data.basic || {}),
      clientLegalName: String(data.basic?.clientLegalName || '').trim() || String(data.companyOverview?.companyName || '').trim(),
      tradeName: String(data.basic?.tradeName || '').trim() || String(data.companyOverview?.companyName || '').trim(),
      piboCategory: servicePibo || (data.basic?.piboCategory ?? ''),
      eprCategory: serviceEpr || (data.basic?.eprCategory ?? ''),
      servicesOffered: serviceOffered || (data.basic?.servicesOffered ?? '')
    },
    selectedLeadSnapshot: {
      ...(data.selectedLeadSnapshot || {}),
      assignedServiceId,
      piboCategory: servicePibo || (data.selectedLeadSnapshot?.piboCategory ?? ''),
      subApplicantType: servicePibo || (data.selectedLeadSnapshot?.subApplicantType ?? ''),
      eprCategory: serviceEpr || (data.selectedLeadSnapshot?.eprCategory ?? ''),
      serviceCategory: serviceEpr || (data.selectedLeadSnapshot?.serviceCategory ?? ''),
      servicesOffered: serviceOffered || (data.selectedLeadSnapshot?.servicesOffered ?? ''),
      industryType: service.industryType || (data.selectedLeadSnapshot?.industryType ?? ''),
      plantUnit: service.plantUnit || (data.selectedLeadSnapshot?.plantUnit ?? ''),
      businessCategory: service.businessCategory || (data.selectedLeadSnapshot?.businessCategory ?? ''),
      applicantType: service.applicantType || (data.selectedLeadSnapshot?.applicantType ?? '')
    },
    compliance: allowLegacy ? (data.compliance || {}) : {},
    msmeRows: allowLegacy && Array.isArray(data.msmeRows) ? data.msmeRows : [],
    cte: allowLegacy ? (data.cte || { numberOfPlantsLocations: '', plantWiseDetails: [] }) : { numberOfPlantsLocations: '', plantWiseDetails: [] },
    companyOverview: allowLegacy ? (data.companyOverview || {}) : {},
    cpcbScreenshotFiles: hasScopedScreenshots
      ? (Array.isArray(scoped.cpcbScreenshots) ? scoped.cpcbScreenshots : (Array.isArray(scoped.documents) ? scoped.documents : []))
      : (allowLegacy && Array.isArray(data.cpcbScreenshots) ? data.cpcbScreenshots : []),
    processDiagrams: allowLegacy && Array.isArray(data.processDiagrams) ? data.processDiagrams : []
  };
}

const calendarTodoStorageKey = 'crm.calendar.todos.v1';
const clientDraftStorageKey = 'crm.clientMaster.drafts.v1';

function readCalendarTodoItems() {
  try {
    const parsed = JSON.parse(localStorage.getItem(calendarTodoStorageKey) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCalendarTodoItems(items) {
  localStorage.setItem(calendarTodoStorageKey, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent('crm-calendar-items-updated'));
}

function normalizeDraftKey(value = '') {
  return String(value || '').trim().toLowerCase();
}

function getClientDraftKeys(data = {}, selectedLead = '') {
  const lead = typeof selectedLead === 'object' ? selectedLead : {};
  const assignedServiceId = normalizeDraftKey(data.assignedServiceId || data.selectedLeadSnapshot?.assignedServiceId);
  const leadKeys = [...new Set([
    selectedLead,
    lead?._id,
    lead?.id,
    lead?.leadCode,
    lead?.sourceLeadId,
    data.selectedLead,
    data.importMeta?.leadNumber,
    data.importMeta?.uniqueId,
    data.basic?.clientLegalName,
    data.basic?.tradeName,
    data.companyOverview?.companyName
  ].map(normalizeDraftKey).filter(Boolean))];
  return assignedServiceId ? leadKeys.map((key) => `${key}::service:${assignedServiceId}`) : leadKeys;
}

function readClientDraftCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(clientDraftStorageKey) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeClientDraftCache(cache) {
  localStorage.setItem(clientDraftStorageKey, JSON.stringify(cache));
}

function findCachedClientDraft(keys = [], assignedServiceId = '') {
  const cache = readClientDraftCache();
  const serviceKey = normalizeDraftKey(assignedServiceId);
  const scopedKeys = serviceKey
    ? keys.map((key) => `${normalizeDraftKey(key)}::service:${serviceKey}`)
    : keys.map(normalizeDraftKey);
  return scopedKeys.map((key) => cache[key]).find(Boolean) || null;
}

function removeCachedClientDraft(draft = {}) {
  if (!draft?.id) return;
  const cache = readClientDraftCache();
  let changed = false;
  Object.keys(cache).forEach((key) => {
    if (String(cache[key]?.id || '') === String(draft.id)) {
      delete cache[key];
      changed = true;
    }
  });
  if (changed) writeClientDraftCache(cache);
}

function rememberClientDraft(savedClient = {}, fallbackClient = {}) {
  const savedData = readClientData(savedClient);
  const data = { ...fallbackClient, ...savedData };
  const draft = {
    id: savedClient._id || savedClient.id || fallbackClient._id || fallbackClient.id || '',
    workflowStatus: savedClient.workflowStatus || fallbackClient.workflowStatus || 'draft',
    adminControls: { ...emptyClient.adminControls, ...(savedClient.adminControls || fallbackClient.adminControls || {}) },
    data,
    savedAt: new Date().toISOString()
  };
  const cache = readClientDraftCache();
  getClientDraftKeys(data, fallbackClient.selectedLead || savedClient.selectedLead).forEach((key) => {
    cache[key] = draft;
  });
  writeClientDraftCache(cache);
}

export default function ClientMaster() {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      return null;
    }
  });
  const [profileOpen, setProfileOpen] = useState(false);
  const [leads, setLeads] = useState([]);
  const [clients, setClients] = useState([]);
  const [clientPagination, setClientPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [clientSummary, setClientSummary] = useState({ total: 0, annual: 0, processed: 0, pending: 0, progress: 0, rejected: 0, discontinued: 0 });
  const [clientMasterCatalog, setClientMasterCatalog] = useState([]);
  const [clientSearchLoading, setClientSearchLoading] = useState(false);
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [remoteClientOptions, setRemoteClientOptions] = useState([]);
  const [totalClientCount, setTotalClientCount] = useState(0);
  const [annualReturnRecords, setAnnualReturnRecords] = useState([]);
  const [quotations, setQuotations] = useState([]);
  const [proformaInvoices, setProformaInvoices] = useState([]);
  const [staff, setStaff] = useState([]);
  const [client, setClient] = useState(emptyClient);
  const [editingClientId, setEditingClientId] = useState('');
  const [editingWorkflowStatus, setEditingWorkflowStatus] = useState('draft');
  const [viewClient, setViewClient] = useState(null);
  const [viewServiceClients, setViewServiceClients] = useState([]);
  const [viewLoading, setViewLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('companyOverview');
  const [viewMode, setViewMode] = useState('list');
  const [pendingLeadServices, setPendingLeadServices] = useState(null);
  const [pendingServiceView, setPendingServiceView] = useState(null);
  const [pendingSlaView, setPendingSlaView] = useState(null);
  const [slaAccessClient, setSlaAccessClient] = useState(null);
  const [pendingCpcbOnboarding, setPendingCpcbOnboarding] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savingMode, setSavingMode] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [excelFileName, setExcelFileName] = useState('');
  const [excelRows, setExcelRows] = useState([]);
  const [excelImportMode, setExcelImportMode] = useState('clients');
  const navigate = useNavigate();
  const location = useLocation();
  const pendingApprovalLeadHandled = useRef('');
  const clientRecordRequestRef = useRef(0);
  const pageLoadRequestRef = useRef(0);
  const directoryRequestRef = useRef(0);
  const saveRequestRef = useRef(false);
  const { clientKey: routeClientKey, annualYear: routeAnnualYear } = useParams();
  const routeAnnualYearLabel = routeAnnualYear ? decodeURIComponent(routeAnnualYear) : '';

  const normalizedCurrentRole = String(currentUser?.role || '').trim().toLowerCase();
  const canApproveClient = ['admin', 'superadmin', 'compliance'].includes(normalizedCurrentRole);
  const canSeeAdminControls = adminRoles.includes(normalizedCurrentRole) || normalizedCurrentRole === 'compliance';
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTab);
  const tabProgress = useMemo(() => buildClientTabProgress(client), [client]);
  const overallProgress = useMemo(() => {
    const summary = tabProgress.filter((tab) => !tab.locked).reduce((total, tab) => ({
      filled: total.filled + tab.filled,
      total: total.total + tab.total
    }), { filled: 0, total: 0 });
    return { ...summary, percent: summary.total ? Math.round((summary.filled / summary.total) * 100) : 0 };
  }, [tabProgress]);
  const isFirstStepReady = Boolean(String(client.companyOverview?.companyName || client.basic?.clientLegalName || client.basic?.tradeName || '').trim());
  const searchableLeads = useMemo(
    () => buildSearchableClientMasterLeads(leads, clientMasterCatalog),
    [leads, clientMasterCatalog]
  );
  const leadOptions = useMemo(() => remoteClientOptions.map((item) => ({
    value: item.selectionKey,
    label: `${item.leadCode || 'Client'} - ${item.companyName || 'Untitled client'}${Number.isFinite(item.closedServiceCount) && item.totalServiceCount ? ` - ${item.closedServiceCount} of ${item.totalServiceCount} services closed` : item.clientMasterCount ? ` - ${item.clientMasterCount} service${item.clientMasterCount === 1 ? '' : 's'}` : ''}`
  })), [remoteClientOptions]);
  const staffOptions = useMemo(() => staff.map((user) => ({ value: user._id || user.id, label: `${user.name || user.email} (${user.role})` })), [staff]);

  useEffect(() => {
    loadPage();
  }, []);

  useEffect(() => {
    const query = clientSearchQuery.trim();
    if (query.length < 2) {
      setClientSearchLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setClientSearchLoading(true);
      try {
        const response = await api.get(API_ENDPOINTS.clients.discoverySearch, {
          params: { q: query, limit: 20 },
          signal: controller.signal
        });
        setRemoteClientOptions(filterClientMasterSearchItems(response.data.items || [], []));
      } catch (err) {
        if (err?.code !== 'ERR_CANCELED' && err?.name !== 'CanceledError') {
          setRemoteClientOptions([]);
          setError(err?.response?.data?.error || 'Unable to search existing clients.');
        }
      } finally {
        if (!controller.signal.aborted) setClientSearchLoading(false);
      }
    }, 400);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [clientSearchQuery]);

  useEffect(() => {
    if (loading || !location.state?.fromPendingApproval) return;
    const requestedLead = String(location.state.selectedLeadId || '').trim();
    const requestedCompany = String(location.state.companyName || '').trim().toLowerCase();
    const matchingLead = findLeadByValue(leads, requestedLead)
      || leads.find((lead) => String(lead.company || lead.companyName || lead.clientName || '').trim().toLowerCase() === requestedCompany);
    if (!matchingLead) {
      if (!requestedLead || pendingApprovalLeadHandled.current === requestedLead) return;
      pendingApprovalLeadHandled.current = requestedLead;
      setViewMode('form');
      handleRemoteCompanySelect(requestedLead);
      navigate('/sales/client-master', { replace: true, state: null });
      return;
    }
    const leadValue = getLeadSelectValue(matchingLead);
    if (!leadValue || pendingApprovalLeadHandled.current === leadValue) return;
    pendingApprovalLeadHandled.current = leadValue;
    setViewMode('form');
    handleLeadSelect(leadValue);
    navigate('/sales/client-master', { replace: true, state: null });
  }, [leads, loading, location.state, navigate]);

  useEffect(() => {
    if (!routeClientKey || (!clients.length && !annualReturnRecords.length)) {
      if (routeClientKey) {
        debugAnnualFlow('route-waiting-for-data', {
          routeClientKey,
          routeAnnualYear: routeAnnualYearLabel,
          clients: clients.length,
          annualReturnRecords: annualReturnRecords.length
        });
      }
      return;
    }
    const matchedClient = findClientByRouteKey(clients, routeClientKey);
    if (matchedClient) {
      debugAnnualFlow('route-client-matched', {
        routeClientKey,
        routeAnnualYear: routeAnnualYearLabel,
        clientId: matchedClient._id || matchedClient.id,
        annualYears: getSavedAnnualYearLabels(readClientData(matchedClient))
      });
      setViewMode('list');
      openClientView(matchedClient);
      return;
    }
    const normalizedRouteKey = normalizeAnnualClientKey(decodeURIComponent(routeClientKey));
    const matchingAnnualRows = annualReturnRecords.filter((row) => getAnnualReturnMatchKeys(row).includes(normalizedRouteKey));
    const annualRow = matchingAnnualRows.find((row) => normalizeFinancialYearLabel(row.annualYear) === normalizeFinancialYearLabel(routeAnnualYearLabel)) || matchingAnnualRows[0];
    if (annualRow) {
      const clientData = annualRow.clientData && typeof annualRow.clientData === 'object' ? annualRow.clientData : {};
      const annualClient = hydrateClientsWithAnnualReturns([{
        _id: annualRow.clientKey || annualRow.client?._id || annualRow.client?.id || routeClientKey,
        id: annualRow.clientKey || routeClientKey,
        adminControls: annualRow.adminControls || {},
        data: clientData
      }], matchingAnnualRows.length ? matchingAnnualRows : [annualRow])[0];
      debugAnnualFlow('route-annual-record-fallback', {
        routeClientKey,
        routeAnnualYear: routeAnnualYearLabel,
        annualRowYear: annualRow.annualYear,
        hydratedYears: getSavedAnnualYearLabels(readClientData(annualClient))
      });
      setViewMode('list');
      setViewClient(annualClient);
      return;
    }
    debugAnnualFlow('route-client-not-found', {
      routeClientKey,
      routeAnnualYear: routeAnnualYearLabel,
      clients: clients.length,
      annualReturnRecords: annualReturnRecords.length
    });
  }, [annualReturnRecords, clients, routeClientKey, routeAnnualYearLabel]);

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

  function recordBelongsToCurrentUser(item, currentUser = null, staff = []) {
    if (!currentUser || adminRoles.includes(String(currentUser?.role || '').toLowerCase())) return true;

    const userTokens = getVisibleUserTokens(currentUser, staff);

    const data = readClientData(item);
    const selectedLead = typeof item?.selectedLead === 'object' ? item.selectedLead : {};
    const candidates = [
      item?._id,
      item?.id,
      item?.createdBy,
      item?.createdBy?._id,
      item?.createdBy?.id,
      item?.adminControls?.assignedTo,
      item?.adminControls?.assignedTo?._id,
      item?.adminControls?.assignedTo?.id,
      data.importMeta?.assignedTo,
      data.importMeta?.createdBy,
      selectedLead?.assignedToText,
      selectedLead?.assignedTo?.name,
      selectedLead?.assignedTo?.email,
      selectedLead?.importedCreatedBy,
      selectedLead?.createdBy?.name,
      selectedLead?.createdBy?.email,
      ...(Array.isArray(item?.assignments) ? item.assignments.flatMap((row) => [
        row?.assignedTo, row?.assignedToText, row?.assignedToEmail,
        row?.assignedStaff, row?.assignedStaffText, row?.assignedStaffEmail
      ]) : []),
      data.importMeta?.uniqueId,
      data.importMeta?.leadNumber
    ].flatMap((value) => {
      if (!value) return [];
      if (typeof value === 'object') {
        return [value._id, value.id, value.crmUserId, value.userId, value.name, value.email].map((nestedValue) => normalizePersonName(nestedValue)).filter(Boolean);
      }
      return [normalizePersonName(value)].filter(Boolean);
    });

    return candidates.some((candidate) => userTokens.includes(candidate));
  }

  function getVisibleServiceRows(lead) {
    const hasAuthoritativeLeadServices = Array.isArray(lead?.serviceSelections);
    let rows = hasAuthoritativeLeadServices
      ? lead.serviceSelections
      : [{ industryType: lead?.industryType, eprCategory: lead?.eprCategory, applicantType: lead?.applicantType || lead?.piboParent, subApplicantType: lead?.subApplicantType, piboCategory: lead?.piboCategory, servicesOffered: lead?.servicesOffered }];
    const storedServices = Array.isArray(lead?._clientMasterServices)
      ? lead._clientMasterServices.map((row) => ({
          ...row,
          subApplicantType: row.piboCategory,
          serviceCategory: row.eprCategory,
          _existingClientMaster: true
        })).sort((left, right) => {
          const workflowDifference = (String(right.workflowStatus || '').toLowerCase() === 'submitted' ? 1 : 0)
            - (String(left.workflowStatus || '').toLowerCase() === 'submitted' ? 1 : 0);
          return workflowDifference;
        })
      : [];
    if (hasAuthoritativeLeadServices) {
      const usedStoredIndexes = new Set();
      const groupedLeadServices = uniqueClientMasterServices(rows);
      rows = groupedLeadServices.map((currentService) => {
        const assignedServiceId = readAssignedServiceId(currentService);
        const groupingIdentity = clientMasterGroupingIdentity(currentService);
        let storedIndex = groupedLeadServices.length === 1
          ? storedServices.findIndex((stored) => String(stored.workflowStatus || '').toLowerCase() === 'submitted')
          : -1;
        if (storedIndex < 0 && groupingIdentity) {
          storedIndex = storedServices.findIndex((stored, index) => !usedStoredIndexes.has(index) && clientMasterGroupingIdentity(stored) === groupingIdentity);
        }
        if (storedIndex < 0 && assignedServiceId) {
          storedIndex = storedServices.findIndex((stored, index) => !usedStoredIndexes.has(index) && readAssignedServiceId(stored) === assignedServiceId);
        }
        if (storedIndex < 0) {
          storedIndex = storedServices.findIndex((stored, index) => (
            !usedStoredIndexes.has(index)
            && ((clientMasterGroupingIdentity(stored) && clientMasterGroupingIdentity(stored) === clientMasterGroupingIdentity(currentService))
              || ((!assignedServiceId || !readAssignedServiceId(stored)) && legacyServiceFingerprintCompatible(stored, currentService)))
          ));
        }
        if (storedIndex < 0) return currentService;
        usedStoredIndexes.add(storedIndex);
        const stored = storedServices[storedIndex];
        return {
          ...stored,
          ...currentService,
          clientMasterId: stored.clientMasterId,
          workflowStatus: stored.workflowStatus,
          cpcbPortalRegistered: stored.cpcbPortalRegistered,
          cpcbApplicationStatus: stored.cpcbApplicationStatus,
          assignedServiceId: assignedServiceId || readAssignedServiceId(stored),
          _existingClientMaster: true
        };
      });
    } else {
      const storedAssignmentIds = new Set(storedServices.map(readAssignedServiceId).filter(Boolean));
      const currentServices = uniqueClientMasterServices(rows).filter((row) => {
        const assignedServiceId = readAssignedServiceId(row);
        if (assignedServiceId && storedAssignmentIds.has(assignedServiceId)) return false;
        const representedByLegacyRecord = storedServices.some((stored) => (
          (clientMasterGroupingIdentity(stored) && clientMasterGroupingIdentity(stored) === clientMasterGroupingIdentity(row))
          || (!readAssignedServiceId(stored) && legacyServiceFingerprintCompatible(stored, row))
        ));
        return !representedByLegacyRecord;
      });
      rows = [...storedServices, ...currentServices];
    }
    return uniqueClientMasterServices(rows).map((row, index) => {
      const addressData = (lead.addresses || []).find((item) => row.plantUnit && item?.plantUnit === row.plantUnit)
        || (lead.addresses || []).find((item) => item?.assignedServiceId && item.assignedServiceId === row.assignedServiceId)
        || (!row.plantUnit ? lead.addresses?.[index] : null)
        || {};
      const contactData = (lead.contacts || []).find((item) => row.plantUnit && item?.plantUnit === row.plantUnit)
        || (lead.contacts || []).find((item) => item?.assignedServiceId && item.assignedServiceId === row.assignedServiceId)
        || (!row.plantUnit ? lead.contacts?.[index] : null)
        || {};
      return {
        ...row,
        _clientMasterEligible: isLeadServiceClosedForClientMaster(lead, row, index),
        applicantType: row.applicantType || row.piboParent || row.piboCategoryParent || '',
        piboCategory: row.subApplicantType || row.piboCategory || '',
        addressData,
        contactData,
        assignmentData: (lead.assignments || []).find((item) => item?.assignedServiceId && item.assignedServiceId === row.assignedServiceId) || lead.assignments?.[index] || {}
      };
    });
  }

  async function loadPage() {
    const pageLoadId = ++pageLoadRequestRef.current;
    setLoading(true);
    setError('');
    try {
      const meRequest = api.get(API_ENDPOINTS.auth.me);
      const clientsRequest = api.get(API_ENDPOINTS.clients.list, { params: { paginated: true, page: 1, limit: 10 } });
      const [meResult, crmClientsResult] = await Promise.allSettled([meRequest, clientsRequest]);
      if (meResult.status === 'rejected') throw meResult.reason;
      const meResponse = meResult.value;
      const me = meResponse.data.user;
      setCurrentUser(me);
      setStaff([me]);
      const crmClients = crmClientsResult.status === 'fulfilled'
        ? (crmClientsResult.value.data.clients || [])
        : [];
      if (crmClientsResult.status === 'rejected') {
        throw new Error(
          crmClientsResult.reason?.response?.data?.error
          || crmClientsResult.reason?.response?.data?.message
          || 'Unable to fetch saved clients.'
        );
      }
      if (pageLoadId !== pageLoadRequestRef.current) return;
      const directoryClients = getClientMasterRows(crmClients, []);
      const visibleClients = enrichClientsFromLeads(directoryClients, []);
      setTotalClientCount(visibleClients.length);
      setClients(visibleClients);
      const pagination = crmClientsResult.value.data.pagination || { page: 1, limit: 10, total: visibleClients.length, totalPages: 1 };
      setClientPagination(pagination);
      setClientSummary(crmClientsResult.value.data.summary || { total: pagination.total });
      setTotalClientCount(pagination.total);
      setLoading(false);

      void api.get(API_ENDPOINTS.auth.users).then((usersResponse) => {
        if (pageLoadId === pageLoadRequestRef.current) setStaff(usersResponse.data.users || []);
      }).catch(() => {});

      // History/report datasets load independently after the directory is
      // usable; none of them can hold back Lead search options.
      void Promise.allSettled([
        api.get(API_ENDPOINTS.annualReturns.list),
        api.get(API_ENDPOINTS.quotations.list),
        api.get(API_ENDPOINTS.proformaInvoices.list)
      ]).then(([annualResult, quotationsResult, proformaResult]) => {
        if (pageLoadId !== pageLoadRequestRef.current) return;
        const annualRows = annualResult.status === 'fulfilled'
          ? (annualResult.value.data.annualReturns || [])
          : [];
        setAnnualReturnRecords(annualRows);
        setClients((current) => hydrateClientsWithAnnualReturns(current, annualRows));
        setQuotations(quotationsResult.status === 'fulfilled' ? (quotationsResult.value.data.quotations || []) : []);
        setProformaInvoices(proformaResult.status === 'fulfilled' ? (proformaResult.value.data.proformaInvoices || []) : []);
      });
    } catch (err) {
      if (pageLoadId !== pageLoadRequestRef.current) return;
      setError(err?.response?.data?.error || err?.message || 'Unable to fetch client master data.');
      setLeads([]);
      setClientMasterCatalog([]);
      setRemoteClientOptions([]);
      setClientSearchLoading(false);
      setClients([]);
      setTotalClientCount(0);
      setQuotations([]);
      setProformaInvoices([]);
    } finally {
      if (pageLoadId === pageLoadRequestRef.current) setLoading(false);
    }
  }

  const loadClientDirectory = useCallback(async (params = {}) => {
    const requestId = ++directoryRequestRef.current;
    setLoading(true);
    setError('');
    try {
      const response = await api.get(API_ENDPOINTS.clients.list, {
        params: { paginated: true, ...params }
      });
      if (requestId !== directoryRequestRef.current) return;
      const rows = enrichClientsFromLeads(getClientMasterRows(response.data?.clients || [], []), []);
      setClients(rows);
      const pagination = response.data?.pagination || { page: 1, limit: 10, total: rows.length, totalPages: 1 };
      setClientPagination(pagination);
      setClientSummary(response.data?.summary || { total: pagination.total });
      setTotalClientCount(pagination.total);
    } catch (err) {
      if (requestId !== directoryRequestRef.current || err?.code === 'ERR_CANCELED') return;
      setError(err?.response?.data?.error || 'Unable to fetch Client Master records.');
    } finally {
      if (requestId === directoryRequestRef.current) setLoading(false);
    }
  }, []);

  const loadAllClientsForExport = useCallback(async (params = {}) => {
    const first = await api.get(API_ENDPOINTS.clients.list, { params: { paginated: true, export: true, ...params, page: 1, limit: 100 } });
    const pages = Number(first.data?.pagination?.totalPages || 1);
    const remaining = pages > 1
      ? await Promise.all(Array.from({ length: pages - 1 }, (_, index) => api.get(API_ENDPOINTS.clients.list, { params: { paginated: true, export: true, ...params, page: index + 2, limit: 100 } })))
      : [];
    return [first, ...remaining].flatMap((response) => response.data?.clients || []);
  }, []);

  function beginServiceOnboarding(pending, service) {
    if (!service?._clientMasterEligible) {
      setError('Lead is not closed for this service. Close its PO before creating the Client Master.');
      return;
    }
    if (service.cpcbPortalRegistered === true) {
      setPendingLeadServices(null);
      handleLeadSelect(pending.value, service, pending.lead);
      return;
    }
    setPendingLeadServices(null);
    setPendingCpcbOnboarding({
      lead: pending.lead,
      value: pending.value,
      service,
      recheck: service.cpcbPortalRegistered === false,
      cpcbPortalRegistered: service.cpcbPortalRegistered === false ? false : null,
      cpcbApplicationStatus: service.cpcbApplicationStatus || 'Fresh Application',
      saving: false
    });
  }

  function buildCpcbBootstrapData(pending) {
    const lead = pending.lead || {};
    const service = pending.service || {};
    const company = lead.company || lead.companyName || lead.clientName || '';
    const address = service.addressData || {};
    const contact = service.contactData || {};
    const email = String(contact.emails || lead.emails || lead.email || '').split(/[,\s;]+/).find(Boolean) || '';
    const assignedServiceId = readAssignedServiceId(service);
    const piboCategory = service.subApplicantType || service.piboCategory || '';
    const eprCategory = service.eprCategory || service.serviceCategory || '';
    const servicesOffered = service.servicesOffered || service.serviceName || '';
    const addressData = {
      address1: address.addressLine1 || lead.addressLine1 || '', address2: address.addressLine2 || lead.addressLine2 || '', address3: address.addressLine3 || lead.addressLine3 || '',
      state: address.state || lead.state || '', city: address.city || lead.city || '', pincode: address.pinCode || lead.pinCode || ''
    };
    const person = {
      name: contact.contactPerson || lead.contactPerson || '', designation: contact.designation || lead.designation || '',
      mobile: contact.mobileNo1 || lead.mobileNo1 || '', email
    };
    return {
      assignedServiceId,
      companyOverview: { ...emptyClient.companyOverview, companyName: company },
      basic: { ...emptyClient.basic, clientLegalName: company, tradeName: company, piboCategory, eprCategory, servicesOffered, companyIndustry: service.industryType || '', plantUnit: service.plantUnit || '' },
      registeredAddress: addressData,
      communicationAddress: { ...addressData },
      otp: { mobile: person.mobile, personName: person.name, designation: person.designation },
      authorised: person,
      coordinating: person,
      selectedLeadSnapshot: {
        assignedServiceId, id: getLeadSelectValue(lead), sourceLeadId: lead.sourceLeadId || '', leadCode: lead.leadCode || '', company,
        piboCategory, subApplicantType: piboCategory, eprCategory, serviceCategory: eprCategory,
        industryType: service.industryType || '', servicesOffered, plantUnit: service.plantUnit || '',
        businessCategory: service.businessCategory || '', applicantType: service.applicantType || ''
      },
      importMeta: { leadNumber: lead.leadCode || '', uniqueId: lead.leadCode || '', companyName: company }
    };
  }

  async function persistCpcbOnboarding() {
    const pending = pendingCpcbOnboarding;
    if (!pending || typeof pending.cpcbPortalRegistered !== 'boolean') {
      setError('Please select Yes or No for CPCB Portal registration.');
      return;
    }
    if (!pending.cpcbPortalRegistered && !cpcbApplicationStatuses.includes(pending.cpcbApplicationStatus)) {
      setError('Please select the CPCB application status.');
      return;
    }
    const assignedServiceId = readAssignedServiceId(pending.service);
    if (!assignedServiceId) {
      setError('The selected service has no assignedServiceId. Please refresh and try again.');
      return;
    }
    setPendingCpcbOnboarding((current) => ({ ...current, saving: true }));
    setError('');
    try {
      const response = await api.post(API_ENDPOINTS.clients.cpcbOnboarding, {
        clientMasterId: pending.service.clientMasterId || undefined,
        selectedLead: getMongoObjectIdOrEmpty(getLeadSelectValue(pending.lead)),
        assignedServiceId,
        cpcbPortalRegistered: pending.cpcbPortalRegistered,
        cpcbApplicationStatus: pending.cpcbPortalRegistered ? null : pending.cpcbApplicationStatus,
        bootstrapData: buildCpcbBootstrapData(pending)
      });
      const saved = response.data.client || response.data.data?.client || {};
      const savedData = readClientData(saved);
      const savedAssignedServiceId = String(saved.assignedServiceId || savedData.assignedServiceId || savedData.selectedLeadSnapshot?.assignedServiceId || assignedServiceId).trim();
      const nextService = {
        ...pending.service,
        clientMasterId: saved._id || saved.id || pending.service.clientMasterId,
        assignedServiceId: savedAssignedServiceId,
        workflowStatus: saved.workflowStatus || pending.service.workflowStatus || 'draft',
        cpcbPortalRegistered: pending.cpcbPortalRegistered,
        cpcbApplicationStatus: pending.cpcbPortalRegistered ? null : pending.cpcbApplicationStatus
      };
      setPendingCpcbOnboarding(null);
      if (pending.continuationClient) {
        const exact = await fetchExactClientMaster(nextService, ++clientRecordRequestRef.current);
        if (exact) applyClientEdit(exact);
      } else {
        await handleLeadSelect(pending.value, nextService, pending.lead);
        setClient((current) => ({
          ...current,
          cpcbOnboarding: {
            ...(current.cpcbOnboarding || {}),
            cpcbPortalRegistered: pending.cpcbPortalRegistered,
            cpcbApplicationStatus: pending.cpcbPortalRegistered ? null : pending.cpcbApplicationStatus
          }
        }));
      }
      setActiveTab('companyOverview');
      setNotice(pending.cpcbPortalRegistered ? 'CPCB registration confirmed. Full Client Master is unlocked.' : 'CPCB application status saved. Complete the four available sections.');
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to save CPCB registration status.');
      setPendingCpcbOnboarding((current) => ({ ...current, saving: false }));
    }
  }

  function setValue(section, field, value) {
    setClient((current) => ({ ...current, [section]: { ...current[section], [field]: value } }));
  }

  function setRoot(field, value) {
    setClient((current) => ({ ...current, [field]: value }));
  }

  function findClientDraftForLead(selectedLead, leadValue) {
    const assignedServiceId = normalizeDraftKey(readAssignedServiceId(selectedLead));
    const strongLeadKeys = [
      leadValue,
      selectedLead?._id,
      selectedLead?.id,
      selectedLead?.sourceLeadId,
      selectedLead?.leadCode,
      selectedLead?.uniqueId,
      selectedLead?.leadId
    ].map(normalizeDraftKey).filter(Boolean);
    const matchedClient = clients.find((item) => {
      const data = readClientData(item);
      const itemAssignedServiceCandidates = getClientRecordAssignedServiceIds(item);
      const itemHasMatchingServiceId = itemAssignedServiceCandidates.some((candidate) => candidate && candidate === assignedServiceId);
      if (assignedServiceId) {
        if (itemHasMatchingServiceId) {
        } else if (itemAssignedServiceCandidates.length) {
          return false;
        } else {
          const legacyCandidateServiceFields = {
            industryType: data.selectedLeadSnapshot?.industryType,
            businessCategory: data.selectedLeadSnapshot?.businessCategory,
            eprCategory: data.basic?.eprCategory || data.selectedLeadSnapshot?.eprCategory || data.selectedLeadSnapshot?.serviceCategory,
            applicantType: data.selectedLeadSnapshot?.applicantType || data.selectedLeadSnapshot?.piboParent || data.selectedLeadSnapshot?.piboCategoryParent,
            subApplicantType: data.basic?.piboCategory || data.selectedLeadSnapshot?.subApplicantType || data.selectedLeadSnapshot?.piboCategory,
            servicesOffered: data.basic?.servicesOffered || data.selectedLeadSnapshot?.servicesOffered,
            applicableService: data.selectedLeadSnapshot?.applicableService,
            plantUnit: data.selectedLeadSnapshot?.plantUnit
          };
          const itemHasLegacyMatch = legacyServiceFingerprintCompatible(legacyCandidateServiceFields, {
            industryType: selectedLead.industryType,
            businessCategory: selectedLead.businessCategory,
            eprCategory: selectedLead.eprCategory,
            applicantType: selectedLead.applicantType,
            subApplicantType: selectedLead.subApplicantType || selectedLead.piboCategory,
            servicesOffered: selectedLead.servicesOffered,
            applicableService: selectedLead.applicableService,
            plantUnit: selectedLead.plantUnit
          });
          if (!itemHasLegacyMatch) return false;
        }
      }
      const itemKeys = [
        item.selectedLead,
        typeof item.selectedLead === 'object' ? item.selectedLead?._id : '',
        typeof item.selectedLead === 'object' ? item.selectedLead?.leadCode : '',
        data.selectedLead,
        data.selectedLeadSnapshot?.id,
        data.selectedLeadSnapshot?.sourceLeadId,
        data.selectedLeadSnapshot?.leadCode,
        data.importMeta?.leadNumber,
        data.importMeta?.uniqueId,
        data.basic?.clientLegalName,
        data.basic?.tradeName,
        data.companyOverview?.companyName
      ].map(normalizeDraftKey).filter(Boolean);
      if (!itemKeys.some((key) => strongLeadKeys.includes(key))) return false;
      return true;
    });
    if (matchedClient) {
      const idValue = String(matchedClient._id || matchedClient.id || '').trim();
      return {
        id: idValue,
        record: matchedClient,
        workflowStatus: matchedClient.workflowStatus || 'draft',
        adminControls: { ...emptyClient.adminControls, ...(matchedClient.adminControls || {}) },
        data: { ...emptyClient, ...readClientData(matchedClient), selectedLead: leadValue || matchedClient.selectedLead || '' }
      };
    }
    const cachedDraft = findCachedClientDraft(strongLeadKeys, assignedServiceId);
    // A cached draft with a database id is only a convenience copy of that
    // server record. If the record was deleted from the database, do not
    // resurrect its old data in the form. Drafts that were never saved (no id)
    // remain available to the user.
    if (cachedDraft?.id) {
      removeCachedClientDraft(cachedDraft);
      return null;
    }
    return cachedDraft;
  }

  async function handleRemoteCompanySelect(selectionKey) {
    if (!selectionKey) {
      clientRecordRequestRef.current += 1;
      setClient(emptyClient);
      setEditingClientId('');
      setEditingWorkflowStatus('draft');
      setPendingLeadServices(null);
      return;
    }

    const lookupId = ++clientRecordRequestRef.current;
    setClient({ ...emptyClient, selectedLead: selectionKey });
    setEditingClientId('');
    setEditingWorkflowStatus('draft');
    setPendingLeadServices(null);
    setNotice('Loading available services...');
    setError('');
    try {
      const response = await api.get(API_ENDPOINTS.clients.discoveryServices, {
        params: { identity: selectionKey }
      });
      if (lookupId !== clientRecordRequestRef.current) return;
      const selectedOption = remoteClientOptions.find((item) => item.selectionKey === selectionKey);
      const services = response.data.services || [];
      const fetchedLead = response.data.lead || null;
      if (!fetchedLead && !services.length) {
        setNotice('');
        setError('No Client Master details were found for the selected company.');
        return;
      }
      const baseLead = {
        ...(fetchedLead || {}),
        _id: fetchedLead?._id || selectedOption?.leadId || selectionKey,
        sourceLeadId: fetchedLead?.sourceLeadId || selectedOption?.leadId || '',
        leadCode: fetchedLead?.leadCode || selectedOption?.leadCode || '',
        company: fetchedLead?.company || selectedOption?.companyName || services[0]?.companyName || '',
        _clientMasterServices: services
      };
      setLeads([baseLead]);
      setClientMasterCatalog(services);
      await handleLeadSelect(getLeadSelectValue(baseLead), null, baseLead);
    } catch (err) {
      if (lookupId !== clientRecordRequestRef.current) return;
      setNotice('');
      setError(err?.response?.data?.error || 'Existing Client Master/service options could not be loaded.');
    }
  }

  async function handleLeadSelect(value, selectedService = null, baseLeadOverride = null) {
    const baseLead = baseLeadOverride || findLeadByValue(searchableLeads, value);
    if (!baseLead) {
      clientRecordRequestRef.current += 1;
      setClient({ ...emptyClient, selectedLead: value });
      setEditingClientId('');
      setEditingWorkflowStatus('draft');
      return;
    }
    const visibleServices = getVisibleServiceRows(baseLead);
    if (!visibleServices.length) {
      clientRecordRequestRef.current += 1;
      setClient({ ...emptyClient, selectedLead: value });
      setEditingClientId('');
      setEditingWorkflowStatus('draft');
      setPendingLeadServices(null);
      setNotice('');
      setError('This Lead has no current assigned services. Add a service in Lead Generation first.');
      return;
    }
    if (!selectedService && visibleServices.length === 1) {
      beginServiceOnboarding({ lead: baseLead, value }, visibleServices[0]);
      return;
    }
    if (!selectedService && visibleServices.length > 1) {
      clientRecordRequestRef.current += 1;
      setClient({ ...emptyClient, selectedLead: value });
      setEditingClientId('');
      setEditingWorkflowStatus('draft');
      setNotice('');
      setError('');
      setPendingLeadServices({ lead: baseLead, value, services: visibleServices });
      return;
    }
    const service = selectedService || visibleServices[0] || {};
    if (!service._clientMasterEligible) {
      setNotice('');
      setError('Lead is not closed for this service. Close its PO before creating the Client Master.');
      return;
    }
    const selectedLead = { ...baseLead, ...service };
    const leadValue = getLeadSelectValue(selectedLead);
    const requestId = ++clientRecordRequestRef.current;
    setClient({ ...emptyClient, selectedLead: leadValue });
    setEditingClientId('');
    setEditingWorkflowStatus('draft');
    setNotice('Loading selected Client Master...');
    setError('');
    const existingDraft = service.clientMasterId
      ? {
          id: String(service.clientMasterId),
          record: { _id: service.clientMasterId, assignedServiceId: service.assignedServiceId || '' },
          workflowStatus: service.workflowStatus || 'draft',
          adminControls: {},
          data: { selectedLead: leadValue }
        }
      : findClientDraftForLead(selectedLead, leadValue);
    if (existingDraft?.data) {
      let exactDraft = existingDraft;
      try {
        const exactRecord = await fetchExactClientMaster({
          ...(existingDraft.record || {}),
          assignedServiceId: readAssignedServiceId(service) || existingDraft.record?.assignedServiceId || ''
        }, requestId);
        if (requestId !== clientRecordRequestRef.current) return;
        if (exactRecord) {
          exactDraft = {
            ...existingDraft,
            id: String(exactRecord._id || exactRecord.id || existingDraft.id || '').trim(),
            record: exactRecord,
            workflowStatus: exactRecord.workflowStatus || existingDraft.workflowStatus || 'draft',
            adminControls: { ...emptyClient.adminControls, ...(exactRecord.adminControls || {}) },
            data: { ...emptyClient, ...readClientData(exactRecord), selectedLead: leadValue }
          };
        }
      } catch (err) {
        if (requestId !== clientRecordRequestRef.current) return;
        setNotice('');
        setError(err?.response?.data?.error || 'Unable to load the selected Client Master record.');
        return;
      }
      const scopedData = activateAssignedService({
        ...exactDraft.data
      }, service, visibleServices.length);
      if (requestId !== clientRecordRequestRef.current) return;
      setClient({
        ...emptyClient,
        ...scopedData,
        selectedLead: leadValue,
        adminControls: { ...emptyClient.adminControls, ...(exactDraft.adminControls || exactDraft.data.adminControls || {}) }
      });
      setEditingClientId(String(exactDraft.id || '').trim());
      setEditingWorkflowStatus(exactDraft.workflowStatus || exactDraft.record?.workflowStatus || 'draft');
      setNotice('Saved draft loaded. Continue from where you left.');
      setError('');
      return;
    }
    const leadCode = selectedLead.leadCode || selectedLead.uniqueId || selectedLead.sourceLeadId || leadValue || '';
    const company = selectedLead.company || selectedLead.companyName || selectedLead.clientName || '';
    const email = String(selectedLead.emails || selectedLead.email || '').split(/[,\s;]+/).find(Boolean) || '';
    const serviceAddress = selectedLead.addressData || {};
    const serviceContact = selectedLead.contactData || {};
    const currentServicePibo = String((service && (service.subApplicantType || service.piboCategory)) || selectedLead.piboCategory || '').trim();
    const currentServiceEpr = String((service && service.eprCategory) || selectedLead.eprCategory || '').trim();
    const currentServiceOffered = String((service && (service.servicesOffered || service.serviceName)) || selectedLead.servicesOffered || '').trim();
    const currentServiceIndustry = String((service && service.industryType) || selectedLead.industryType || '').trim();
    const currentServicePlantUnit = String((service && service.plantUnit) || selectedLead.plantUnit || '').trim();
    const currentServiceApplicantType = String((service && service.applicantType) || selectedLead.applicantType || '').trim();
    const currentServiceBusiness = String((service && service.businessCategory) || selectedLead.businessCategory || '').trim();
    const sharedSearchKeys = [
      leadValue,
      selectedLead?._id,
      selectedLead?.id,
      selectedLead?.sourceLeadId,
      selectedLead?.leadCode,
      selectedLead?.uniqueId,
      selectedLead?.leadId,
      company,
      company?.toLowerCase?.()
    ].map(normalizeDraftKey).filter(Boolean);
    const matchesSameCompany = (item) => {
      const d = readClientData(item);
      const compKeys = [
        item.selectedLead,
        typeof item.selectedLead === 'object' ? item.selectedLead?._id : '',
        typeof item.selectedLead === 'object' ? item.selectedLead?.leadCode : '',
        d.selectedLead,
        d.selectedLeadSnapshot?.id,
        d.selectedLeadSnapshot?.sourceLeadId,
        d.selectedLeadSnapshot?.leadCode,
        d.importMeta?.leadNumber,
        d.importMeta?.uniqueId,
        d.basic?.clientLegalName,
        d.basic?.tradeName,
        d.companyOverview?.companyName,
        String(d.basic?.clientLegalName || '').toLowerCase(),
        String(d.basic?.tradeName || '').toLowerCase(),
        String(d.companyOverview?.companyName || '').toLowerCase()
      ].map(normalizeDraftKey).filter(Boolean);
      return compKeys.some((k) => sharedSearchKeys.includes(k));
    };
    const samePibo = String(currentServicePibo || '').trim().toLowerCase();
    const sameCompanyMatches = clients.filter(matchesSameCompany);
    const companyLevelSource = samePibo
      ? sameCompanyMatches.find((item) => {
          const d = readClientData(item);
          const pibo = String(d.basic?.piboCategory || d.selectedLeadSnapshot?.piboCategory || '').trim().toLowerCase();
          return pibo === samePibo;
        }) || sameCompanyMatches[0]
      : sameCompanyMatches[0];
    const mergeCompanyData = companyLevelSource ? readClientData(companyLevelSource) : null;
    const baseBasic = { ...emptyClient.basic };
    const baseCompliance = { ...emptyClient.compliance };
    const baseCompanyOverview = { ...emptyClient.companyOverview };
    const baseCte = { numberOfPlantsLocations: '', plantWiseDetails: [] };
    const baseMsme = [];
    const baseCpcb = { linkedToCommonPortal: '' };
    const pickExistingSafe = (obj, defaults = {}, serviceSpecificKeys = []) => {
      if (!obj || typeof obj !== 'object') return defaults;
      const out = { ...defaults };
      const forbidden = new Set(serviceSpecificKeys.map((k) => String(k).toLowerCase()));
      Object.keys(obj).forEach((k) => {
        if (forbidden.has(String(k).toLowerCase())) return;
        if (obj[k] !== null && obj[k] !== undefined && obj[k] !== '') {
          if (Array.isArray(obj[k]) && obj[k].length > 0) out[k] = obj[k];
          else if (typeof obj[k] === 'object' && !Array.isArray(obj[k])) {
            out[k] = pickExistingSafe(obj[k], defaults[k] || {}, []);
          } else if (typeof obj[k] !== 'object') {
            out[k] = obj[k];
          }
        }
      });
      return out;
    };
    const mergedBasic = mergeCompanyData
      ? {
          ...baseBasic,
          ...pickExistingSafe(mergeCompanyData.basic || {}, baseBasic, ['piboCategory', 'eprCategory', 'servicesOffered']),
          clientLegalName: mergeCompanyData.basic?.clientLegalName || company || '',
          tradeName: mergeCompanyData.basic?.tradeName || company || '',
          piboCategory: currentServicePibo,
          eprCategory: currentServiceEpr,
          servicesOffered: currentServiceOffered,
          companyIndustry: currentServiceIndustry || mergeCompanyData.basic?.companyIndustry || '',
          plantUnit: currentServicePlantUnit || mergeCompanyData.basic?.plantUnit || ''
        }
      : {
          ...baseBasic,
          clientLegalName: company || '',
          tradeName: company || '',
          piboCategory: currentServicePibo,
          eprCategory: currentServiceEpr,
          servicesOffered: currentServiceOffered,
          companyIndustry: currentServiceIndustry,
          plantUnit: currentServicePlantUnit
        };
    const mergedCompanyOverview = mergeCompanyData
      ? {
          ...baseCompanyOverview,
          ...pickExistingSafe(mergeCompanyData.companyOverview || {}, baseCompanyOverview, []),
          companyName: mergeCompanyData.companyOverview?.companyName || company || '',
          productName: mergeCompanyData.companyOverview?.productName || selectedLead.productName || '',
          productManufacturer: mergeCompanyData.companyOverview?.productManufacturer || selectedLead.productManufacturer || '',
          numberOfEmployees: mergeCompanyData.companyOverview?.numberOfEmployees || selectedLead.numberOfEmployees || ''
        }
      : {
          ...baseCompanyOverview,
          companyName: company || '',
          productName: selectedLead.productName || '',
          productManufacturer: selectedLead.productManufacturer || '',
          category: [],
          numberOfEmployees: selectedLead.numberOfEmployees || ''
        };
    const mergedCompliance = mergeCompanyData ? pickExistingSafe(mergeCompanyData.compliance || {}, baseCompliance, ['factoryLicense', 'factoryLicenseNumber', 'factoryLicenseDate', 'eprCertificate', 'eprCertificateNumber', 'eprCertificateDate']) : baseCompliance;
    const mergedCte = baseCte;
    const mergedMsme = baseMsme;
    const mergedCpcb = baseCpcb;

    setClient({
      ...emptyClient,
      selectedLead: leadValue,
      basic: mergedBasic,
      compliance: mergedCompliance,
      msmeRows: mergedMsme,
      cte: mergedCte,
      cpcb: mergedCpcb,
      importMeta: {
        leadNumber: leadCode,
        uniqueId: leadCode,
        companyName: company,
        createdBy: selectedLead.importedCreatedBy || selectedLead.referredBy || '',
        assignedTo: selectedLead.assignedToText || selectedLead.assignedTo?.name || ''
      },
      companyOverview: mergedCompanyOverview,
      selectedLeadSnapshot: {
        assignedServiceId: readAssignedServiceId(service),
        id: leadValue,
        sourceLeadId: selectedLead.sourceLeadId || '',
        leadCode,
        company,
        piboCategory: currentServicePibo,
        subApplicantType: currentServicePibo,
        eprCategory: currentServiceEpr,
        serviceCategory: currentServiceEpr,
        industryType: currentServiceIndustry,
        servicesOffered: currentServiceOffered,
        plantUnit: currentServicePlantUnit,
        businessCategory: currentServiceBusiness,
        applicantType: currentServiceApplicantType,
        contactPerson: selectedLead.contactPerson || '',
        mobileNo1: selectedLead.mobileNo1 || '',
        email,
        source: selectedLead.source || ''
      },
      registeredAddress: {
        address1: serviceAddress.addressLine1 || selectedLead.addressLine1 || '', address2: serviceAddress.addressLine2 || selectedLead.addressLine2 || '', address3: serviceAddress.addressLine3 || selectedLead.addressLine3 || '',
        state: serviceAddress.state || selectedLead.state || '', city: serviceAddress.city || selectedLead.city || '', pincode: serviceAddress.pinCode || selectedLead.pinCode || ''
      },
      communicationAddress: {
        address1: serviceAddress.addressLine1 || selectedLead.addressLine1 || '', address2: serviceAddress.addressLine2 || selectedLead.addressLine2 || '', address3: serviceAddress.addressLine3 || selectedLead.addressLine3 || '',
        state: serviceAddress.state || selectedLead.state || '', city: serviceAddress.city || selectedLead.city || '', pincode: serviceAddress.pinCode || selectedLead.pinCode || ''
      },
      otp: {
        mobile: serviceContact.mobileNo1 || selectedLead.mobileNo1 || '', personName: serviceContact.contactPerson || selectedLead.contactPerson || '', designation: serviceContact.designation || selectedLead.designation || ''
      },
      authorised: {
        name: serviceContact.contactPerson || selectedLead.contactPerson || '', designation: serviceContact.designation || selectedLead.designation || '', mobile: serviceContact.mobileNo1 || selectedLead.mobileNo1 || '', email: serviceContact.emails || email
      },
      coordinating: {
        name: serviceContact.contactPerson || selectedLead.contactPerson || '', designation: serviceContact.designation || selectedLead.designation || '', mobile: serviceContact.mobileNo1 || selectedLead.mobileNo1 || '', email: serviceContact.emails || email
      }
    });
    setEditingClientId('');
    setEditingWorkflowStatus('draft');
    setNotice(companyLevelSource ? 'Loaded shared company details pre-filled from existing client records. Review and continue.' : 'Selected lead details loaded.');
    setError('');
  }

  function setAdmin(field, value) {
    setClient((current) => ({ ...current, adminControls: { ...current.adminControls, [field]: value } }));
  }

  function openClientForm() {
    setClient(emptyClient);
    setEditingClientId('');
    setEditingWorkflowStatus('draft');
    setActiveTab('companyOverview');
    setError('');
    setNotice('');
    setViewMode('form');
  }

  async function fetchExactClientMaster(item, requestId) {
    const clientMasterId = String(item?.clientMasterId || item?._id || item?.id || '').trim();
    if (!/^[a-f\d]{24}$/i.test(clientMasterId)) return item;
    const itemData = readClientData(item);
    const assignedServiceId = String(item?.assignedServiceId || itemData.assignedServiceId || itemData.selectedLeadSnapshot?.assignedServiceId || '').trim();
    const response = await api.get(API_ENDPOINTS.clients.detail(clientMasterId), {
      params: assignedServiceId ? { assignedServiceId } : undefined
    });
    if (requestId !== clientRecordRequestRef.current) return null;
    const exactClient = response.data?.client || response.data?.data?.client || response.data?.data;
    if (!exactClient || typeof exactClient !== 'object') return exactClient;
    const resolvedData = response.data?.resolvedData;
    const exactData = readClientData(exactClient);
    const storedAssignedServiceId = String(exactClient.assignedServiceId || exactData.assignedServiceId || exactData.selectedLeadSnapshot?.assignedServiceId || '').trim();
    return {
      ...exactClient,
      ...(resolvedData && typeof resolvedData === 'object'
        ? { data: mergeClientData(resolvedData, exactData) }
        : { data: exactData }),
      _serviceViewKey: item?._serviceViewKey || assignedServiceId || storedAssignedServiceId || clientMasterId,
      activeAssignedServiceId: assignedServiceId || storedAssignedServiceId,
      assignedServiceId: storedAssignedServiceId || assignedServiceId
    };
  }

  async function openClientView(item, availableServices = null) {
    const requestId = ++clientRecordRequestRef.current;
    if (Array.isArray(availableServices) && availableServices.length) setViewServiceClients(availableServices);
    setViewClient(null);
    setViewLoading(true);
    setError('');
    try {
      const exactClient = await fetchExactClientMaster(item, requestId);
      if (requestId !== clientRecordRequestRef.current || !exactClient) return;
      setViewClient(exactClient);
    } catch (err) {
      if (requestId === clientRecordRequestRef.current) {
        setError(err?.response?.data?.error || 'Unable to load the selected Client Master record.');
      }
    } finally {
      if (requestId === clientRecordRequestRef.current) setViewLoading(false);
    }
  }

  function applyClientEdit(item) {
    const savedData = readClientData(item);
    const idValue = String(item._id || item.id || '').trim();
    const assignedServiceId = String(item.assignedServiceId || readAssignedServiceId(savedData)).trim();
    setClient({
      ...emptyClient,
      ...activateAssignedService(savedData, {
        industryType: savedData.selectedLeadSnapshot?.industryType,
        businessCategory: savedData.selectedLeadSnapshot?.businessCategory,
        eprCategory: savedData.basic?.eprCategory || savedData.selectedLeadSnapshot?.eprCategory,
        applicantType: savedData.selectedLeadSnapshot?.applicantType,
        subApplicantType: savedData.basic?.piboCategory || savedData.selectedLeadSnapshot?.piboCategory,
        servicesOffered: savedData.basic?.servicesOffered || savedData.selectedLeadSnapshot?.servicesOffered,
        applicableService: savedData.selectedLeadSnapshot?.applicableService,
        plantUnit: savedData.selectedLeadSnapshot?.plantUnit,
        assignedServiceId
      }, 1),
      selectedLead: item.selectedLead?._id || item.selectedLead?.id || item.selectedLead || savedData.selectedLead || '',
      adminControls: { ...emptyClient.adminControls, ...(item.adminControls || savedData.adminControls || {}) }
    });
    setEditingClientId(idValue);
    setEditingWorkflowStatus(item.workflowStatus || 'draft');
    setActiveTab('companyOverview');
    setViewClient(null);
    setError('');
    setNotice('Client Master opened for editing.');
    setViewMode('form');
  }

  async function openClientEdit(item) {
    const requestId = ++clientRecordRequestRef.current;
    setViewClient(null);
    setViewLoading(true);
    setError('');
    try {
      const exactClient = await fetchExactClientMaster(item, requestId);
      if (requestId !== clientRecordRequestRef.current || !exactClient) return;
      const exactData = readClientData(exactClient);
      if (exactData.cpcbOnboarding?.cpcbPortalRegistered === false) {
        const selectedLead = exactClient.selectedLead || {};
        const selectedLeadId = selectedLead?._id || selectedLead || exactData.selectedLeadSnapshot?.id || '';
        setPendingCpcbOnboarding({
          lead: {
            ...(typeof selectedLead === 'object' ? selectedLead : {}),
            _id: selectedLeadId,
            company: exactData.basic?.clientLegalName || exactData.companyOverview?.companyName || ''
          },
          value: selectedLeadId,
          service: {
            clientMasterId: exactClient._id || exactClient.id,
            assignedServiceId: exactClient.assignedServiceId || exactData.assignedServiceId || exactData.selectedLeadSnapshot?.assignedServiceId,
            cpcbPortalRegistered: false,
            cpcbApplicationStatus: exactData.cpcbOnboarding?.cpcbApplicationStatus || 'Fresh Application'
          },
          continuationClient: exactClient,
          recheck: true,
          cpcbPortalRegistered: false,
          cpcbApplicationStatus: exactData.cpcbOnboarding?.cpcbApplicationStatus || 'Fresh Application',
          saving: false
        });
        return;
      }
      applyClientEdit(exactClient);
    } catch (err) {
      if (requestId === clientRecordRequestRef.current) {
        setError(err?.response?.data?.error || 'Unable to load the selected Client Master record for editing.');
      }
    } finally {
      if (requestId === clientRecordRequestRef.current) setViewLoading(false);
    }
  }

  function openClientTab(tabId) {
    if (isCpcbRestricted(client) && cpcbRestrictedTabIds.includes(tabId)) {
      setError('This section is locked until CPCB Portal registration is confirmed.');
      return;
    }
    if (!['companyOverview', 'basic'].includes(tabId) && !isFirstStepReady) {
      setError('First enter Company Name, Client Legal Name, or Trade Name before moving to the next step.');
      return;
    }
    if (tabId === 'cte' && !getClientApplicability(client).cteTabApplicable) {
      setError(getClientApplicability(client).isImporter
        ? 'CTE & CTO / CCA is not applicable for Importer clients.'
        : 'CTE & CTO / CCA is not applicable because the Brand Owner has no production facility.');
      return;
    }
    setError('');
    setActiveTab(tabId);
  }

  function nextTab() {
    if (!isFirstStepReady) {
      setError('First enter Company Name, Client Legal Name, or Trade Name before moving to the next step.');
      return;
    }
    if (activeTab === 'cpcbScreenshots') {
      const invalidScreenshot = (client.cpcbScreenshots || []).find((item) => !String(item.name || '').trim() || !item.file);
      if (invalidScreenshot) {
        setError('Please enter a name for every CPCB screenshot/document before continuing.');
        return;
      }
      const invalidProcessDiagram = getClientApplicability(client).processDiagramRequired
        ? (client.processDiagrams || []).find((item) => !String(item.name || '').trim() || !item.file)
        : null;
      if (invalidProcessDiagram) {
        setError('Please enter a name for every PFD and Machinery Diagram PDF before continuing.');
        return;
      }
    }
    setError('');
    const next = tabs.slice(activeIndex + 1).find((tab) => !((tab.id === 'cte' && !getClientApplicability(client).cteTabApplicable) || (isCpcbRestricted(client) && cpcbRestrictedTabIds.includes(tab.id)))) || tabs[tabs.length - 1];
    setActiveTab(next.id);
  }

  function resolveUserId(value) {
    const raw = normalizePersonName(value);
    if (!raw) return '';
    const match = staff.find((user) => normalizePersonName(user.name) === raw) ||
      staff.find((user) => normalizePersonName(user.email) === raw) ||
      staff.find((user) => normalizePersonName(user.crmUserId) === raw) ||
      staff.find((user) => normalizePersonName(user.userId) === raw);
    return match ? (match._id || match.id) : '';
  }

  function resolveAssignedToId(value) {
    if (!value) return '';
    if (typeof value === 'string') {
      if (/^[a-f\d]{24}$/i.test(value)) return value;
      return resolveUserId(value);
    }
    const directId = value._id || value.id || value.userId || '';
    if (/^[a-f\d]{24}$/i.test(String(directId))) return directId;
    return resolveUserId(value.name || value.email || value.crmUserId || value.userId);
  }

  function buildAdminControlsPayload(adminControls = {}) {
    const assignedTo = resolveAssignedToId(adminControls.assignedTo);
    const payload = { ...adminControls };
    if (assignedTo) payload.assignedTo = assignedTo;
    else delete payload.assignedTo;
    return payload;
  }

  function resolveLeadId(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    const match = leads.find((leadItem) => String(leadItem.leadCode || '').toLowerCase() === raw) ||
      leads.find((leadItem) => String(leadItem.company || '').toLowerCase() === raw);
    return match ? (match._id || match.id) : '';
  }

  async function handleExcelUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError('');
    setNotice('');
    setExcelFileName(file.name);
    setExcelRows([]);
    setExcelImportMode('clients');

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames?.[0];
      if (!sheetName) {
        setError('No sheet found in this file.');
        return;
      }
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
      const headers = rows[0] ? Object.keys(rows[0]).map(normalizeHeaderKey) : [];
      const isAnnualYearUpload = headers.includes('companyuniqueid') && headers.includes('firstannualreturnyearapplicable');
      if (isAnnualYearUpload) {
        const yearRows = rows.map((row, index) => ({
          row: index + 2,
          companyUniqueId: row['Company Unique ID'] || row['Unique ID'] || '',
          onboardingYear: row['Client Onboarding Year'] || row['Onboarding Year'] || '',
          firstAnnualReturnYear: row['First Annual Return Year Applicable'] || row['First Annual Return Year'] || ''
        })).filter((row) => String(row.companyUniqueId).trim() && (String(row.onboardingYear).trim() || String(row.firstAnnualReturnYear).trim()));
        if (!yearRows.length) {
          setError('Excel has no usable annual return year rows.');
          return;
        }
        setExcelImportMode('annual-years');
        setExcelRows(yearRows);
        setNotice(`${yearRows.length} annual return year row${yearRows.length === 1 ? '' : 's'} loaded. Click Import Drafts to update matched clients.`);
        return;
      }
      let importLeads = leads;
      if (!importLeads.length) {
        const leadsResponse = await api.get(API_ENDPOINTS.leads.list);
        importLeads = leadsResponse.data.leads || [];
        setLeads(importLeads);
      }
      const parsed = rows
        .map((row) => mapExcelRowToClient(row, staff, importLeads))
        .filter((row) => Object.values(row.data || {}).some((value) => JSON.stringify(value || '').replace(/["{}[\],:]/g, '').trim() !== ''));

      if (!parsed.length) {
        setError('Excel has no usable client rows.');
        return;
      }

      setExcelRows(parsed);
      const first = parsed[0];
      setClient({
        ...emptyClient,
        ...(first.data || {}),
        selectedLead: first.selectedLead || '',
        adminControls: { ...emptyClient.adminControls, ...(first.adminControls || {}) }
      });
      setNotice(`${parsed.length} client row${parsed.length === 1 ? '' : 's'} loaded. First row applied to form.`);
    } catch (err) {
      console.error(err);
      setError('Unable to read Excel file. Please upload a valid .xlsx file.');
    }
  }

  async function importExcelRows() {
    if (!excelRows.length) return;
    setImporting(true);
    setError('');
    setNotice('');

    try {
      if (excelImportMode === 'annual-years') {
        const response = await api.post(API_ENDPOINTS.clients.bulkUpdateYears, { rows: excelRows });
        const updated = Number(response.data?.updated || 0);
        const failures = Array.isArray(response.data?.failures) ? response.data.failures : [];
        setNotice(`${updated} client${updated === 1 ? '' : 's'} updated with annual return years.`);
        if (failures.length) setError(`${failures.length} row${failures.length === 1 ? '' : 's'} failed. First: row ${failures[0].row} (${failures[0].error})`);
        await loadPage();
        return;
      }
      const payload = excelRows.map((row) => {
        const assignedText = row.data?.importMeta?.assignedTo || '';
        const leadText = row.data?.importMeta?.leadNumber || row.data?.importMeta?.uniqueId || '';
        return {
          ...row,
          selectedLead: row.selectedLead || resolveLeadId(leadText),
          adminControls: {
            ...buildAdminControlsPayload(row.adminControls),
            assignedTo: resolveAssignedToId(row.adminControls?.assignedTo) || resolveUserId(assignedText)
          },
          workflowStatus: 'draft'
        };
      });
      const response = await api.post(API_ENDPOINTS.clients.bulk, { clients: payload });
      const successCount = Number(response.data?.imported || response.data?.clients?.length || 0);
      const failures = Array.isArray(response.data?.failures) ? response.data.failures : [];

      if (successCount) {
        setNotice(`${successCount} client${successCount === 1 ? '' : 's'} imported as drafts.`);
        await loadPage();
      }
      if (failures.length) {
        setError(`${failures.length} row${failures.length === 1 ? '' : 's'} failed. First: row ${failures[0].row} (${failures[0].error})`);
      }
    } catch (err) {
      const failures = err?.response?.data?.failures || [];
      setError(failures.length
        ? `${failures.length} row${failures.length === 1 ? '' : 's'} failed. First: row ${failures[0].row} (${failures[0].error})`
        : err?.response?.data?.error || 'Unable to import clients');
    } finally {
      setImporting(false);
    }
  }

  function addRow(key, row) {
    setClient((current) => ({ ...current, [key]: [...current[key], row] }));
  }

  function updateRow(key, index, field, value) {
    setClient((current) => ({
      ...current,
      [key]: current[key].map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row))
    }));
  }

  function removeRow(key, index) {
    setClient((current) => ({ ...current, [key]: current[key].filter((_, rowIndex) => rowIndex !== index) }));
  }

  function copyRegisteredAddress(checked) {
    if (!checked) return;
    setClient((current) => ({ ...current, communicationAddress: { ...current.registeredAddress } }));
  }

  async function saveClient(workflowStatus) {
    if (saveRequestRef.current) return;
    saveRequestRef.current = true;
    setSaving(true);
    setSavingMode(workflowStatus);
    setError('');
    setNotice('');
    try {
      const normalizedClient = {
        ...client,
        companyOverview: {
          ...client.companyOverview,
          category: normalizeCompanyOverviewCategories(client.companyOverview?.category)
        },
        basic: {
          ...client.basic,
          clientLegalName: client.basic?.clientLegalName || client.companyOverview?.companyName || '',
          tradeName: client.basic?.tradeName || client.companyOverview?.companyName || ''
        }
      };
      const assignedServiceId = String(normalizedClient.assignedServiceId || normalizedClient.selectedLeadSnapshot?.assignedServiceId || '').trim();
      if (!assignedServiceId && !editingClientId) {
        setError('The selected service has no assignedServiceId. Reload the page and select the service again.');
        return;
      }
      if (assignedServiceId) {
        normalizedClient.assignedServiceId = assignedServiceId;
        normalizedClient.selectedLeadSnapshot = { ...(normalizedClient.selectedLeadSnapshot || {}), assignedServiceId };
      }
      normalizedClient.cpcbScreenshots = (normalizedClient.cpcbScreenshots || []).map((document) => ({
        ...document,
        documentId: document.documentId || document.id || crypto.randomUUID(),
        ...(assignedServiceId ? { assignedServiceId } : {})
      }));
      if (assignedServiceId) {
        normalizedClient.cpcbDataByAssignedServiceId = {
          ...(normalizedClient.cpcbDataByAssignedServiceId || {}),
          [assignedServiceId]: {
            assignedServiceId,
            cpcb: { ...(normalizedClient.cpcb || {}) },
            cpcbScreenshots: normalizedClient.cpcbScreenshots,
            updatedAt: new Date().toISOString()
          }
        };
        normalizedClient.serviceDetailsByAssignedServiceId = {
          ...(normalizedClient.serviceDetailsByAssignedServiceId || {}),
          [assignedServiceId]: {
            assignedServiceId,
            registeredAddress: { ...(normalizedClient.registeredAddress || {}) },
            communicationAddress: { ...(normalizedClient.communicationAddress || {}) },
            otp: { ...(normalizedClient.otp || {}) },
            otpContacts: Array.isArray(normalizedClient.otpContacts) ? normalizedClient.otpContacts : [],
            authorised: { ...(normalizedClient.authorised || {}) },
            authorisedPersons: Array.isArray(normalizedClient.authorisedPersons) ? normalizedClient.authorisedPersons : [],
            coordinating: { ...(normalizedClient.coordinating || {}) },
            coordinatingPersons: Array.isArray(normalizedClient.coordinatingPersons) ? normalizedClient.coordinatingPersons : [],
            updatedAt: new Date().toISOString()
          }
        };
      }
      const cpcbRestricted = isCpcbRestricted(normalizedClient);
      if (workflowStatus === 'submitted' && overallProgress.percent < 60) {
        setError(`To submit Client Master, please complete at least 60% of the data. Current completion is ${overallProgress.percent}%.`);
        return;
      }
      const invalidScreenshot = workflowStatus === 'submitted' && !cpcbRestricted
        ? (client.cpcbScreenshots || []).find((item) => !String(item.name || '').trim() || !item.file)
        : null;
      if (invalidScreenshot) {
        setError('Every CPCB screenshot/document must have a name and an uploaded file.');
        setActiveTab('cpcbScreenshots');
        return;
      }
      const applicability = getClientApplicability(normalizedClient);
      if (workflowStatus === 'submitted' && !cpcbRestricted && applicability.processDiagramChoiceRequired && !['Yes', 'No'].includes(normalizedClient.cpcb?.processDiagramRequired)) {
        setError('Select whether the Process Flow Diagram is required before submit.');
        setActiveTab('cpcbScreenshots');
        return;
      }
      const invalidProcessDiagram = workflowStatus === 'submitted' && !cpcbRestricted && applicability.processDiagramRequired
        ? (client.processDiagrams || []).find((item) => !String(item.name || '').trim() || !item.file)
        : null;
      if (invalidProcessDiagram) {
        setError('Every PFD and Machinery Diagram PDF must have a name and an uploaded PDF.');
        setActiveTab('cpcbScreenshots');
        return;
      }
      if (workflowStatus === 'submitted' && !cpcbRestricted && normalizedClient.compliance?.msmeApplicable === 'Yes') {
        const invalidMsme = !(normalizedClient.msmeRows || []).length || normalizedClient.msmeRows.some((row) => ['classificationYear', 'status', 'majorActivity', 'udyamNumber', 'turnover', 'file'].some((field) => !isProgressValueFilled(row?.[field])));
        if (invalidMsme) {
          setError('MSME is Applicable. Add at least one row and complete every MSME detail before submit.');
          setActiveTab('compliance');
          return;
        }
      }
      const isBrandOwner = String(normalizedClient.basic?.piboCategory || normalizedClient.selectedLeadSnapshot?.piboCategory || '').toLowerCase().includes('brand owner');
      const brandOwnerHasProductionFacility = normalizedClient.compliance?.brandOwnerProductionFacility === 'Yes'
        || (!normalizedClient.compliance?.brandOwnerProductionFacility && normalizedClient.compliance?.factoryLicenseApplicability === 'Applicable');
      if (workflowStatus === 'submitted' && !cpcbRestricted && isBrandOwner && brandOwnerHasProductionFacility) {
        const factoryFields = [normalizedClient.compliance?.factoryLicenseNumber, normalizedClient.compliance?.factoryLicenseDate, normalizedClient.compliance?.factoryLicenseFile];
        if (factoryFields.some((value) => !isProgressValueFilled(value))) {
          setError('Brand Owner has a Production Facility. Complete the Factory License number, document date, and upload before submit.');
          setActiveTab('compliance');
          return;
        }
      }
      const submittedRequired = [
        ['Choose Existing Lead', normalizedClient.selectedLead], ['Client Legal Name', normalizedClient.basic?.clientLegalName],
        ['Registered Address', normalizedClient.registeredAddress?.address1], ['Registered State', normalizedClient.registeredAddress?.state], ['Registered City', normalizedClient.registeredAddress?.city], ['Registered Pincode', normalizedClient.registeredAddress?.pincode],
        ['Communication Address', normalizedClient.communicationAddress?.address1], ['Communication State', normalizedClient.communicationAddress?.state], ['Communication City', normalizedClient.communicationAddress?.city], ['Communication Pincode', normalizedClient.communicationAddress?.pincode],
        ...(!cpcbRestricted ? [['MSME Applicability', normalizedClient.compliance?.msmeApplicable]] : []),
        ...(!cpcbRestricted ? [['CPCB Common Portal Link', normalizedClient.cpcb?.linkedToCommonPortal]] : []),
        ...(!cpcbRestricted && normalizedClient.cpcb?.linkedToCommonPortal === 'Yes' ? [['CPCB Status', normalizedClient.cpcb?.status]] : []),
        ['OTP Mobile', normalizedClient.otp?.mobile],
        ...(!cpcbRestricted ? [['Authorised Mobile', normalizedClient.authorised?.mobile], ['Authorised Email', normalizedClient.authorised?.email]] : []),
        ['Coordinating Mobile', normalizedClient.coordinating?.mobile], ['Coordinating Email', normalizedClient.coordinating?.email]
      ];
      const missing = workflowStatus === 'submitted' ? submittedRequired.find(([, value]) => !String(value || '').trim()) : null;
      if (missing) {
        setError(`${missing[0]} is required before submit.`);
        setActiveTab('basic');
        return;
      }
      const payload = {
        ...(editingClientId ? { recordId: editingClientId } : {}),
        selectedLead: getMongoObjectIdOrEmpty(normalizedClient.selectedLead),
        adminControls: buildAdminControlsPayload(normalizedClient.adminControls),
        data: normalizedClient,
        workflowStatus
      };
      const response = editingClientId ? await api.put(API_ENDPOINTS.clients.detail(editingClientId), payload) : await api.post(API_ENDPOINTS.clients.create, payload);
      const savedClient = response.data.client || response.data.data?.client || response.data.data;
      if (!savedClient || typeof savedClient !== 'object') throw new Error('CRM did not return the saved client.');
      const savedId = savedClient._id || savedClient.id || editingClientId || '';
      if (savedId) setEditingClientId(savedId);
      setEditingWorkflowStatus(savedClient.workflowStatus || workflowStatus);
      const savedDraft = {
        id: savedId,
        workflowStatus: savedClient.workflowStatus || workflowStatus
      };
      if (workflowStatus === 'submitted') {
        removeCachedClientDraft(savedDraft);
      } else {
        rememberClientDraft(savedClient, { ...normalizedClient, selectedLead: normalizedClient.selectedLead, workflowStatus });
      }
      setClient((current) => ({
        ...current,
        ...readClientData(savedClient),
        selectedLead: current.selectedLead,
        adminControls: { ...current.adminControls, ...(savedClient.adminControls || {}) }
      }));
      setNotice(workflowStatus === 'submitted' ? 'Record submitted successfully.' : 'Client draft saved. You can continue editing this same lead.');
      await loadPage();
      if (workflowStatus === 'submitted') {
        setClient(emptyClient);
        setEditingClientId('');
        setEditingWorkflowStatus('draft');
        setViewMode('list');
      }
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to save client');
    } finally {
      saveRequestRef.current = false;
      setSaving(false);
      setSavingMode('');
    }
  }

  function handleLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('login_email');
    navigate('/', { replace: true });
  }

  function closeViewClient() {
    setSlaAccessClient(null);
    setPendingSlaView(null);
    clientRecordRequestRef.current += 1;
    setViewClient(null);
    setViewServiceClients([]);
    setViewLoading(false);
    if (routeClientKey) navigate('/sales/client-master', { replace: true });
  }

  function handleViewedClientUpdated(updatedClient) {
    if (!updatedClient) return;
    setViewClient(updatedClient);
    setClients((current) => current.map((item) => (
      String(item._id || item.id || getClientUniqueId(item)) === String(updatedClient._id || updatedClient.id || getClientUniqueId(updatedClient))
        ? updatedClient
        : item
    )));
  }

  async function requestDirectoryClientView(selectedClient) {
    const requestId = ++clientRecordRequestRef.current;
    setPendingServiceView(null);
    setPendingSlaView(null);
    setSlaAccessClient(selectedClient);
    setViewLoading(true);
    setError('');
    try {
      const clientId = String(selectedClient?._id || selectedClient?.id || selectedClient?.clientMasterId || '').trim();
      const { data: response } = await api.get(API_ENDPOINTS.clients.sla(clientId));
      if (requestId !== clientRecordRequestRef.current) return;
      if (response.ready === true && response.sla?.status !== 'No') {
        await openDirectoryClientView(selectedClient);
      } else {
        setViewLoading(false);
        setPendingSlaView({ client: selectedClient, returnToDetails: false });
      }
    } catch (err) {
      if (requestId !== clientRecordRequestRef.current) return;
      setViewLoading(false);
      setError(err?.response?.data?.error || 'Unable to check saved SLA details. Please try again.');
    }
  }

  async function openDirectoryClientView(selectedClient) {
    const lookupId = ++clientRecordRequestRef.current;
    setViewClient(null);
    setViewLoading(true);
    setError('');
    try {
      const selectedData = readClientData(selectedClient);
      const clientMasterId = String(selectedClient?._id || selectedClient?.id || selectedClient?.clientMasterId || '').trim();
      const selectedLeadId = String(selectedClient?.selectedLead?._id || selectedClient?.selectedLead || selectedData.selectedLead || '').trim();
      const identity = clientMasterId ? `client:${clientMasterId}` : selectedLeadId;
      const response = identity
        ? await api.get(API_ENDPOINTS.clients.discoveryServices, { params: { identity } })
        : null;
      if (lookupId !== clientRecordRequestRef.current) return;

      const discoveredServices = Array.isArray(response?.data?.services) ? response.data.services : [];
      const serviceSource = discoveredServices.length ? discoveredServices : clients;
      const selectedService = discoveredServices.find((service) => String(service.clientMasterId || service._id || service.id || '') === clientMasterId) || selectedClient;
      const relatedServices = getRelatedClientServices(serviceSource, selectedService);
      const servicesToView = relatedServices.length ? relatedServices : [selectedClient];
      setViewServiceClients(servicesToView);
      setViewLoading(false);
      setPendingServiceView({ client: selectedClient, services: servicesToView });
    } catch {
      if (lookupId !== clientRecordRequestRef.current) return;
      const relatedServices = getRelatedClientServices(clients, selectedClient);
      const servicesToView = relatedServices.length ? relatedServices : [selectedClient];
      setViewServiceClients(servicesToView);
      // Service discovery enriches the chooser, but a temporary discovery
      // failure must not block a client record that is already visible.
      setViewLoading(false);
      setPendingServiceView({ client: selectedClient, services: servicesToView });
    }
  }

  if (viewMode === 'list') {
    return (
      <DashboardShell currentUser={currentUser} onOpenProfile={() => setProfileOpen(true)} onLogout={handleLogout}>
        {pendingSlaView ? (
          <ClientSlaPage key={pendingSlaView.client._id || pendingSlaView.client.id || pendingSlaView.client.clientMasterId} client={pendingSlaView.client} backLabel={pendingSlaView.returnToDetails ? 'Back to Client Details' : 'Back to Client Master list'} onClose={() => setPendingSlaView(null)} onContinue={() => {
            const { client: selectedClient, returnToDetails } = pendingSlaView;
            setPendingSlaView(null);
            if (!returnToDetails) openDirectoryClientView(selectedClient);
          }} />
        ) : viewLoading ? (
          <div className="grid min-h-[calc(100vh-64px)] place-items-center bg-[#f3f8f6] px-4">
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-5 text-sm font-black text-[#30737B] shadow-sm">Loading Client Master...</div>
          </div>
        ) : viewClient ? (
          <ClientViewModal
            client={viewClient}
            serviceClients={viewServiceClients.length ? viewServiceClients : getRelatedClientServices(clients, viewClient)}
            onServiceChange={openClientView}
            quotations={quotations}
            proformaInvoices={proformaInvoices}
            staff={staff}
            initialTab={routeClientKey ? 'annual' : 'basic'}
            initialAnnualYear={routeAnnualYearLabel}
            currentUser={currentUser}
            onClose={closeViewClient}
            onClientUpdated={handleViewedClientUpdated}
            onEditSla={() => setPendingSlaView({ client: slaAccessClient || viewClient, returnToDetails: true })}
          />
        ) : (
          <ClientDirectoryView
            clients={clients}
            pagination={clientPagination}
            summary={clientSummary}
            totalClientCount={totalClientCount}
            staff={staff}
            loading={loading}
            error={error}
            notice={notice}
            onRefresh={loadPage}
            onDirectoryQueryChange={loadClientDirectory}
            onExportAll={loadAllClientsForExport}
            onView={requestDirectoryClientView}
            onEdit={openClientEdit}
            canEdit={adminRoles.includes(String(currentUser?.role || '').toLowerCase())}
            onCreate={openClientForm}
            selectOptions={selectOptions}
          />
        )}
        {pendingServiceView && (
          <ClientServiceChooserModal
            selection={pendingServiceView}
            onClose={() => setPendingServiceView(null)}
            onSelect={(service) => {
              const availableServices = pendingServiceView.services;
              setPendingServiceView(null);
              openClientView(service, availableServices);
            }}
          />
        )}
        {profileOpen && <ProfileModal user={currentUser} saving={false} onClose={() => setProfileOpen(false)} onLogout={handleLogout} onSave={() => {}} onUpdatePassword={() => {}} />}
      </DashboardShell>
    );
  }

  return (
    <DashboardShell currentUser={currentUser} onOpenProfile={() => setProfileOpen(true)} onLogout={handleLogout}>
      <div className="px-4 pb-6 pt-3 sm:px-6 sm:pt-4 lg:px-8">
        <div className="rounded-[28px] bg-gradient-to-br from-emerald-50 via-white to-cyan-50 p-4 shadow-sm ring-1 ring-emerald-100 sm:p-5 lg:p-6">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="flex items-center gap-4">
              <button type="button" onClick={() => setViewMode('list')} className="btn-lift inline-flex h-11 w-11 items-center justify-center rounded-lg border border-emerald-100 bg-white text-[#30737B] shadow-sm">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <p className="text-sm font-black uppercase tracking-[0.18em] text-[#30737B]">Sales</p>
                <h1 className="mt-1 text-3xl font-black text-slate-950">Client Master</h1>
              </div>
            </div>
            <div className="rounded-2xl border border-teal-100 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Active Tab</p>
              <p className="mt-1 font-black text-[#30737B]">{activeIndex + 1}. {tabs[activeIndex]?.label}</p>
            </div>
          </div>

          <section className="mt-5 rounded-2xl border border-teal-100 bg-white/95 px-4 py-3 shadow-sm">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-[#30737B] ring-1 ring-teal-100">
                  {React.createElement(tabs[activeIndex]?.icon || FileText, { className: 'h-4 w-4' })}
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#30737B]">Form Progress</p>
                  <p className="truncate text-sm font-extrabold text-slate-600">
                    {editingClientId ? 'Draft open' : 'Live'} · {tabs[activeIndex]?.label || 'Client Master'} · {overallProgress.filled}/{overallProgress.total} fields filled
                  </p>
                </div>
              </div>
              <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200 xl:max-w-md">
                <div className="h-full rounded-full bg-gradient-to-r from-orange-400 via-emerald-500 to-[#30737B]" style={{ width: `${overallProgress.percent}%` }} />
              </div>
              <span className="w-fit rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700 shadow-sm">
                {overallProgress.percent}% complete
              </span>
              {typeof client.cpcbOnboarding?.cpcbPortalRegistered === 'boolean' && (
                <span className={`w-fit rounded-full border px-3 py-1 text-xs font-black shadow-sm ${client.cpcbOnboarding.cpcbPortalRegistered ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                  {client.cpcbOnboarding.cpcbPortalRegistered
                    ? 'CPCB Registered'
                    : `CPCB Pending · ${client.cpcbOnboarding.cpcbApplicationStatus || 'Status required'}`}
                </span>
              )}
            </div>
          </section>

          <Card title="Select Lead" className="mt-6">
            <Field required label="Choose Existing Lead">
              <SearchableSelect
                value={client.selectedLead}
                options={leadOptions}
                onChange={handleRemoteCompanySelect}
                remoteSearch
                onSearchQuery={setClientSearchQuery}
                loading={clientSearchLoading}
                minimumSearchCharacters={2}
                allowCustom={false}
                placeholder="Search an existing client"
                loadingMessage="Searching clients..."
                noResultsMessage="No matching clients found"
                promptMessage="Type at least 2 characters to search"
              />
            </Field>
          </Card>

          {pendingLeadServices && (
            <div className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/55 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="service-choice-title">
              <section className="w-full max-w-2xl overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-2xl">
                <header className="bg-gradient-to-r from-emerald-50 to-cyan-50 px-6 py-5">
                  <p className="text-xs font-black uppercase tracking-[.18em] text-emerald-700">Multiple assigned services</p>
                  <h2 id="service-choice-title" className="mt-1 text-xl font-black text-slate-950">{pendingLeadServices.lead.company}</h2>
                  <p className="mt-1 text-sm font-bold text-slate-500">
                    {pendingLeadServices.services.filter((service) => service._clientMasterEligible).length} of {pendingLeadServices.services.length} services are PO closed. Only closed services can be onboarded.
                  </p>
                </header>
                <div className="grid gap-3 p-6 sm:grid-cols-2">
                  {pendingLeadServices.services.map((service, index) => {
                    const applicantType = service.applicantType || service.piboParent || service.piboCategoryParent || '-';
                    const subApplicantType = service.subApplicantType || service.piboCategory || 'Not applicable';
                    const isEligible = Boolean(service._clientMasterEligible);
                    return (
                    <button
                      key={service.clientMasterId || readAssignedServiceId(service) || clientMasterServiceFingerprint(service)}
                      type="button"
                      disabled={!isEligible}
                      onClick={() => beginServiceOnboarding(pendingLeadServices, service)}
                      className={`rounded-xl border p-5 text-left transition ${isEligible ? 'border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50' : 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-75'}`}
                    >
                      <span className={`mb-3 inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${isEligible ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                        {isEligible ? 'PO Closed - Available' : 'Lead Not Closed'}
                      </span>
                      <strong className="block text-base font-black text-slate-950">{service.eprCategory || `Service ${index + 1}`} · {applicantType}</strong>
                      <span className={`mt-2 block text-sm font-bold ${isEligible ? 'text-emerald-700' : 'text-slate-500'}`}>{service.servicesOffered || '-'}</span>
                      {service.applicableService && <span className="mt-1 block rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-black text-emerald-800">Applicable: {service.applicableService}</span>}
                      <span className="mt-2 block text-xs font-bold text-slate-500">Industry Type: {service.industryType || '-'}</span>
                      <span className="mt-1 block text-xs font-black text-teal-700">Plant Unit: {service.plantUnit || '-'}</span>
                      <span className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-xs font-black text-orange-700 shadow-sm">
                          Service Category: {service.eprCategory || '-'}
                        </span>
                        <span className="rounded-lg border border-cyan-200 bg-cyan-50 px-2.5 py-1.5 text-xs font-black text-cyan-800 shadow-sm">
                          Applicant Type: {applicantType}
                        </span>
                        <span className="rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs font-black text-violet-800 shadow-sm">
                          Sub Applicant Type: {subApplicantType}
                        </span>
                      </span>
                      {!isEligible && <span className="mt-3 block text-xs font-black text-amber-700">Close the PO for this service in Lead Generation to unlock Client Master.</span>}
                    </button>
                  )})}
                </div>
              </section>
            </div>
          )}

          {pendingCpcbOnboarding && (
            <div className="fixed inset-0 z-[10010] grid place-items-center bg-slate-950/60 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="cpcb-registration-title">
              <section className="w-full max-w-xl overflow-hidden rounded-2xl border border-teal-100 bg-white shadow-2xl">
                <header className="bg-gradient-to-r from-teal-50 via-cyan-50 to-emerald-50 px-6 py-5">
                  <p className="text-xs font-black uppercase tracking-[.18em] text-[#30737B]">CPCB Portal Registration Status</p>
                  <h2 id="cpcb-registration-title" className="mt-1 text-xl font-black text-slate-950">{pendingCpcbOnboarding.lead.company || 'Selected Client'}</h2>
                  <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
                    {pendingCpcbOnboarding.recheck
                      ? 'Earlier, you selected that this client was not registered on the CPCB Portal. Has the client now been registered on the CPCB Portal?'
                      : 'Has the Client Registered on CPCB Portal?'}
                  </p>
                </header>
                <div className="space-y-5 p-6">
                  <div className="grid grid-cols-2 gap-3">
                    {[true, false].map((answer) => (
                      <button
                        key={String(answer)}
                        type="button"
                        disabled={pendingCpcbOnboarding.saving}
                        onClick={() => setPendingCpcbOnboarding((current) => ({ ...current, cpcbPortalRegistered: answer }))}
                        className={`min-h-14 rounded-xl border-2 px-5 text-sm font-black transition ${pendingCpcbOnboarding.cpcbPortalRegistered === answer ? 'border-emerald-500 bg-emerald-50 text-emerald-800 shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-teal-300'}`}
                      >
                        {answer ? 'Yes, Registered' : 'No, Not Registered'}
                      </button>
                    ))}
                  </div>
                  {pendingCpcbOnboarding.cpcbPortalRegistered === false && (
                    <label className="block">
                      <span className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-600">Application Status <span className="text-red-500">*</span></span>
                      <select
                        value={pendingCpcbOnboarding.cpcbApplicationStatus}
                        disabled={pendingCpcbOnboarding.saving}
                        onChange={(event) => setPendingCpcbOnboarding((current) => ({ ...current, cpcbApplicationStatus: event.target.value }))}
                        className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 font-bold text-slate-800 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                      >
                        {cpcbApplicationStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                      <span className="mt-2 block text-xs font-semibold leading-5 text-amber-700">Only Company Overview, Client Basic Info, Address Details, and Authorized Person Details will be required until registration is confirmed.</span>
                    </label>
                  )}
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <button type="button" disabled={pendingCpcbOnboarding.saving} onClick={() => setPendingCpcbOnboarding(null)} className="min-h-11 rounded-xl border border-slate-200 px-5 font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60">Cancel</button>
                    <button type="button" disabled={pendingCpcbOnboarding.saving || typeof pendingCpcbOnboarding.cpcbPortalRegistered !== 'boolean'} onClick={persistCpcbOnboarding} className="min-h-11 rounded-xl bg-gradient-to-r from-emerald-700 to-teal-700 px-6 font-black text-white shadow-lg shadow-emerald-700/20 disabled:cursor-not-allowed disabled:opacity-60">
                      {pendingCpcbOnboarding.saving ? 'Saving...' : 'Save & Continue'}
                    </button>
                  </div>
                </div>
              </section>
            </div>
          )}

          {canSeeAdminControls && (
            <Card title="Admin Controls" className="mt-6">
              <div className="grid gap-5 md:grid-cols-3">
                {canApproveClient && <SelectLike label="Approval Status" value={client.adminControls.approvalStatus} options={selectOptions.approvalStatus} onChange={(value) => setAdmin('approvalStatus', value)} />}
                {normalizedCurrentRole !== 'compliance' && <SelectLike label="Client Visibility Status" value={client.adminControls.visibilityStatus} options={selectOptions.visibilityStatus} onChange={(value) => setAdmin('visibilityStatus', value)} />}
                {normalizedCurrentRole !== 'compliance' && <SelectLike label="Assigned To" value={client.adminControls.assignedTo} options={staffOptions} placeholder="Search and select admin to assign" onChange={(value) => setAdmin('assignedTo', value)} />}
              </div>
            </Card>
          )}

          {canSeeAdminControls && <Card title="Excel Bulk Import" className="mt-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-950">Client Master Import</p>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  Upload .xlsx with headers like Unique ID, Trade Name, Client Name, State, City with PIN, GST Number, CPCB Reg No, OTP Mobile.
                </p>
                {excelFileName && (
                  <p className="mt-2 text-xs font-black text-slate-700">
                    File: <span className="font-extrabold">{excelFileName}</span> {excelRows.length ? `(${excelRows.length} row${excelRows.length === 1 ? '' : 's'})` : ''}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-3">
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
            </div>
          </Card>}

          <section className="client-progress-tabs-shell mt-4 rounded-2xl border border-teal-100 bg-white/95 p-2 shadow-sm">
            <div className="relative">
              <div className="client-progress-tab-rail">
              {tabProgress.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                const complete = tab.percent === 100;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    disabled={tab.notApplicable}
                    onClick={() => openClientTab(tab.id)}
                    className={`client-progress-tab ${active ? 'client-progress-tab-active' : ''} ${complete ? 'client-progress-tab-complete' : ''} ${(tab.notApplicable || tab.locked) ? 'client-progress-tab-disabled' : ''}`}
                    style={{ '--tab-progress': `${tab.percent}%` }}
                  >
                    <span className="client-progress-tab-icon"><Icon className="h-5 w-5" /></span>
                    <span className="client-progress-tab-copy"><strong>{tab.label}</strong><small>{tab.locked ? 'Locked' : tab.notApplicable ? 'Not applicable' : `${tab.percent}%`}</small></span>
                    <span className="client-progress-tab-fill" aria-hidden="true" />
                  </button>
                );
              })}
              </div>
            </div>
          </section>

          {error && <ToastMessage type="error" className="mx-auto mt-4">{error}</ToastMessage>}
          {notice && <ToastMessage type="success" className="mx-auto mt-4">{notice}</ToastMessage>}

          <div className="mt-6 grid gap-6">
            {activeTab === 'companyOverview' && <CompanyOverviewTab client={client} setValue={setValue} applicability={getClientApplicability(client)} />}
            {activeTab === 'basic' && <BasicTab client={client} setValue={setValue} />}
            {activeTab === 'address' && <AddressTab client={client} setValue={setValue} copyRegisteredAddress={copyRegisteredAddress} selectOptions={selectOptions} />}
            {activeTab === 'compliance' && <ComplianceTab client={client} setValue={setValue} addRow={addRow} updateRow={updateRow} removeRow={removeRow} complianceRows={complianceRows} applicableComplianceRows={getApplicableComplianceRows(client)} />}
            {activeTab === 'cte' && <CteTab client={client} setValue={setValue} selectOptions={selectOptions} />}
            {activeTab === 'cpcb' && <CpcbTab client={client} setValue={setValue} selectOptions={selectOptions} applicability={getClientApplicability(client)} />}
            {activeTab === 'cpcbScreenshots' && <CpcbScreenshotTab client={client} setValue={setValue} setRoot={setRoot} applicability={getClientApplicability(client)} onValidationError={setError} />}
            {activeTab === 'contacts' && <ContactsTab client={client} setValue={setValue} setRoot={setRoot} applicability={getClientApplicability(client)} />}
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button type="button" disabled={saving || editingWorkflowStatus === 'submitted'} onClick={() => saveClient('draft')} className="btn-lift min-h-11 rounded-xl border border-orange-200 bg-white px-8 font-black text-orange-600 hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-60">{savingMode === 'draft' ? 'Saving...' : 'Save Draft'}</button>
            <button type="button" disabled={saving} onClick={() => saveClient('submitted')} className="btn-lift min-h-11 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-8 font-black text-white shadow-lg shadow-orange-600/20">{savingMode === 'submitted' ? 'Submitting...' : 'Submit'}</button>
            <button type="button" disabled={saving || activeIndex === tabs.length - 1} onClick={nextTab} className="btn-lift min-h-11 rounded-xl bg-gradient-to-r from-emerald-700 to-teal-700 px-8 font-black text-white shadow-lg shadow-emerald-700/20 disabled:cursor-not-allowed disabled:opacity-60">Next Step</button>
          </div>
        </div>
      </div>
      {profileOpen && <ProfileModal user={currentUser} saving={false} onClose={() => setProfileOpen(false)} onLogout={handleLogout} onSave={() => {}} onUpdatePassword={() => {}} />}
    </DashboardShell>
  );
}

const companyOverviewCategories = ['Cat I', 'Cat II', 'Cat III', 'Cat IV'];
const tyreRecyclerCompanyOverviewCategories = ['Reclaimed Rubber', 'Crumb Rubber', 'Crumb Rubber Modified Bitumen (CRMB)', 'Recovered Carbon Black', 'Pyrolysis Oil', 'Pyrolysis Char'];
const tyreProducerCompanyOverviewCategories = ['Bias Ply', 'Radial'];

function normalizeCompanyOverviewCategories(value, options = companyOverviewCategories) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return options.filter((option) => values.some((item) => String(item || '').trim().toLowerCase() === option.toLowerCase()));
}

function CompanyCategoryMultiSelect({ value, onChange, options = companyOverviewCategories }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [menuPosition, setMenuPosition] = useState(null);
  const selected = normalizeCompanyOverviewCategories(value, options);

  useEffect(() => {
    if (!open) return undefined;
    const positionMenu = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 4;
      const viewportPadding = 8;
      const desiredHeight = 124;
      const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
      const spaceAbove = rect.top - viewportPadding;
      const openAbove = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
      const availableHeight = Math.max(72, openAbove ? spaceAbove - gap : spaceBelow - gap);
      const menuHeight = Math.min(desiredHeight, availableHeight);
      const menuWidth = Math.min(rect.width, window.innerWidth - (viewportPadding * 2));
      setMenuPosition({
        left: Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - menuWidth - viewportPadding)),
        top: openAbove ? Math.max(viewportPadding, rect.top - gap - menuHeight) : rect.bottom + gap,
        width: menuWidth,
        maxHeight: menuHeight
      });
    };
    const closeOutside = (event) => {
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    positionMenu();
    document.addEventListener('mousedown', closeOutside);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [open]);

  function toggle(option) {
    onChange(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option]);
  }

  return (
    <Field label="Category">
      <div className="relative">
        <button ref={triggerRef} type="button" onClick={() => setOpen((current) => !current)} className={`form-input flex min-h-12 h-auto items-center justify-between gap-3 py-2 text-left ${open ? 'border-emerald-400 ring-4 ring-emerald-100' : ''}`} aria-haspopup="listbox" aria-expanded={open}>
          <span className="flex min-w-0 flex-1 flex-wrap gap-2">
            {selected.length ? selected.map((option) => <span key={option} className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700">{option}</span>) : <span className="text-slate-400">Select categories</span>}
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-emerald-700 transition ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && menuPosition && createPortal(
          <div ref={menuRef} className="fixed z-[10050] overflow-y-auto rounded-xl border border-emerald-100 bg-white p-1 shadow-2xl" style={menuPosition} role="listbox" aria-multiselectable="true">
            {options.map((option) => {
              const checked = selected.includes(option);
              return <button key={option} type="button" role="option" aria-selected={checked} onClick={() => toggle(option)} className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-xs font-black transition ${checked ? 'bg-emerald-50 text-emerald-700' : 'text-slate-700 hover:bg-slate-50'}`}><span>{option}</span>{checked && <Check className="h-4 w-4" />}</button>;
            })}
          </div>, document.body
        )}
      </div>
    </Field>
  );
}

function CompanyOverviewTab({ client, setValue, applicability }) {
  const overview = client?.companyOverview || {};
  const categoryOptions = applicability?.isTyreWasteRecycler
    ? tyreRecyclerCompanyOverviewCategories
    : applicability?.isTyreWasteProducer
      ? tyreProducerCompanyOverviewCategories
      : companyOverviewCategories;
  const overviewItems = Array.isArray(overview.overviewItems) && overview.overviewItems.length
    ? overview.overviewItems
    : [''];

  function setItems(nextItems) {
    setValue('companyOverview', 'overviewItems', nextItems);
  }

  function updateItem(index, value) {
    setItems(overviewItems.map((item, itemIndex) => (itemIndex === index ? value : item)));
  }

  function addItem() {
    setItems([...overviewItems, '']);
  }

  function removeItem(index) {
    const nextItems = overviewItems.filter((_, itemIndex) => itemIndex !== index);
    setItems(nextItems.length ? nextItems : ['']);
  }

  return (
    <Card title="Company Overview">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="md:col-span-2"><Field required label="Company Name"><input className="form-input" value={overview.companyName || ''} onChange={(event) => setValue('companyOverview', 'companyName', event.target.value)} /></Field></div>
        <div className="md:col-span-2">
          <Field label="Company Summary"><textarea className="form-input min-h-[110px] resize-y py-3" value={overview.companySummary || ''} onChange={(event) => setValue('companyOverview', 'companySummary', event.target.value)} /></Field>
        </div>
        <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-black text-slate-950">Company Details</h3>
              <p className="mt-1 text-xs font-bold text-slate-500">Add company notes, deals, product users, or any custom points.</p>
            </div>
            <button type="button" onClick={addItem} className="btn-lift inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 font-black text-emerald-700 hover:bg-emerald-50">
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>
          <div className="mt-4 grid gap-3">
            {overviewItems.map((item, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[36px_minmax(0,1fr)_auto] sm:items-center">
                <span className="font-black text-slate-700">{index + 1}.</span>
                <input
                  className="form-input"
                  placeholder={index === 0 ? 'What about company' : index === 1 ? 'Company deal' : index === 2 ? 'Product name and user' : 'Add company detail'}
                  value={item || ''}
                  onChange={(event) => updateItem(index, event.target.value)}
                />
                <button type="button" onClick={() => removeItem(index)} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-xl px-3 text-xs font-black text-red-500 hover:bg-red-50">
                  <X className="h-4 w-4" /> Remove
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="md:col-span-2"><Field label="Product Name"><input className="form-input" value={overview.productName || ''} onChange={(event) => setValue('companyOverview', 'productName', event.target.value)} /></Field></div>
        <CompanyCategoryMultiSelect value={overview.category} options={categoryOptions} onChange={(value) => setValue('companyOverview', 'category', value)} />
        <Field label="Product Image Upload"><UploadButton value={overview.productImage} onChange={(value) => setValue('companyOverview', 'productImage', value)} /></Field>
      </div>
    </Card>
  );
}

function BasicTab({ client, setValue }) {
  const basic = client?.basic || {};
  return (
    <Card title="Client Basic Info">
      <div className="grid gap-5 md:grid-cols-2">
        <Field required label="Client Legal Name"><input className="form-input" value={basic.clientLegalName ?? ''} onChange={(event) => setValue('basic', 'clientLegalName', event.target.value)} /></Field>
        <Field label="Trade Name"><input className="form-input" value={basic.tradeName ?? ''} onChange={(event) => setValue('basic', 'tradeName', event.target.value)} /></Field>
        <SelectLike label="Company Type" value={basic.companyType ?? ''} options={selectOptions.companyType} placeholder="Select Company Type" onChange={(value) => setValue('basic', 'companyType', value)} />
        <SelectLike label="PIBO Category" value={basic.piboCategory ?? ''} options={selectOptions.piboCategory} onChange={(value) => setValue('basic', 'piboCategory', value)} />
        <SelectLike label="Service Category" value={basic.eprCategory ?? ''} options={selectOptions.eprCategory} onChange={(value) => setValue('basic', 'eprCategory', value)} />
        <SelectLike label="Client Onboarding Year" value={basic.onboardingYear ?? ''} options={selectOptions.years} placeholder="Select onboarding year" onChange={(value) => setValue('basic', 'onboardingYear', value)} />
        <Field label="First Annual Return Year Applicable">
          <SearchableSelect value={normalizeFinancialYearLabel(basic.firstAnnualReturnYear) || ''} options={selectOptions.annualReturnYears} onChange={(value) => setValue('basic', 'firstAnnualReturnYear', value)} placeholder="Select first annual return year" />
        </Field>
      </div>
    </Card>
  );
}

const clientDocumentKeyPattern = /(file|document|image|screenshot|proof|diagram|attachment|certificate)/i;

function clientDocumentUrl(value) {
  if (!value || typeof value !== 'object') return '';
  return String(value.secureUrl || value.url || value.dataUrl || value.fileUrl || value.path || '').trim();
}

function clientDocumentActionUrls(value) {
  const urls = [];
  const visit = (item) => {
    if (!item) return;
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (typeof item === 'string') {
      const url = item.trim();
      if (url) urls.push(url);
      return;
    }
    if (typeof item !== 'object') return;
    const directUrl = clientDocumentUrl(item);
    if (directUrl) urls.push(directUrl);
    else if (item.file) visit(item.file);
  };
  visit(value);
  return [...new Set(urls)];
}

function looksLikeClientDocument(value) {
  const text = String(value || '').trim();
  return /^(https?:|data:|blob:)/i.test(text)
    || /\.(pdf|png|jpe?g|webp|gif|docx?|xlsx?|csv|msg|eml)(?:[?#].*)?$/i.test(text)
    || (/[/\\]/.test(text) && !/\s/.test(text));
}

function clientDocumentLabel(path = [], preferredName = '') {
  if (String(preferredName || '').trim()) return String(preferredName).trim();
  const ignored = new Set(['file', 'files', 'url', 'secureUrl', 'dataUrl', 'fileUrl', 'path']);
  const key = [...path].reverse().find((part) => !/^\d+$/.test(String(part)) && !ignored.has(String(part))) || 'Document';
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function clientDocumentCategory(path = []) {
  const root = String(path[0] || '').toLowerCase();
  if (root === 'companyoverview') return 'Company Overview';
  if (root === 'compliance') return 'Compliance';
  if (root === 'msmerows') return 'MSME';
  if (root === 'cte') return 'CTE / CTO / CCA';
  if (root === 'cpcb' || root === 'cpcbscreenshots') return 'CPCB';
  if (root === 'processdiagrams') return 'Process Diagrams';
  if (root.includes('authoris') || root.includes('coordinat') || root.includes('contact')) return 'Contact Documents';
  if (root === 'annualreturn' || root === 'financials') return 'Annual Return';
  if (root === 'validation') return 'Imported Documents';
  return 'Other Documents';
}

function collectClientDocuments(data = {}) {
  const documents = [];
  const seenUrls = new Set();
  const add = (url, path, name = '') => {
    const normalizedUrl = String(url || '').trim();
    if (!normalizedUrl || seenUrls.has(normalizedUrl)) return;
    seenUrls.add(normalizedUrl);
    documents.push({ url: normalizedUrl, name: clientDocumentLabel(path, name), category: clientDocumentCategory(path), path: path.join('.') });
  };
  const visit = (value, path = [], documentContext = false, preferredName = '') => {
    if (value === null || value === undefined) return;
    if (typeof value === 'string') {
      if (documentContext && looksLikeClientDocument(value)) add(value, path, preferredName);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, index], documentContext, item?.name || preferredName));
      return;
    }
    if (typeof value !== 'object') return;
    const directUrl = clientDocumentUrl(value);
    if (directUrl && (documentContext || value.publicId || value.resourceType || value.format)) add(directUrl, path, value.name || value.fileName || preferredName);
    Object.entries(value).forEach(([key, child]) => {
      if (directUrl && ['secureUrl', 'url', 'dataUrl', 'fileUrl', 'path'].includes(key)) return;
      visit(child, [...path, key], documentContext || clientDocumentKeyPattern.test(key), value.name || preferredName);
    });
  };
  visit(data);
  return documents;
}

function openableClientDocumentUrl(url) {
  const value = String(url || '').trim();
  return /^(https?:|data:|blob:)/i.test(value) ? value : normalizeDocumentUrl(value);
}

function ClientViewModal({ client, serviceClients = [], onServiceChange, onEditSla, quotations = [], proformaInvoices = [], staff = [], onClose, initialTab = 'basic', initialAnnualYear = '', currentUser, onClientUpdated }) {
  const navigate = useNavigate();
  const data = readClientData(client);
  const msmeRows = getMsmeRows(data);
  const clientName = data.basic?.clientLegalName || data.basic?.tradeName || 'Client Details';
  const selectedServiceClient = serviceClients.find((item) => getClientServiceOptionLabel(item) === getClientServiceOptionLabel(client))
    || serviceClients.find((item) => String(item?._id || item?.id || '') === String(client?._id || client?.id || ''));
  const selectedServiceKey = getClientServiceViewKey(selectedServiceClient || client);
  const cityPin = `${data.registeredAddress?.city || ''} ${data.registeredAddress?.pincode || ''}`.trim();
  const assignedName = getAssignedName(client, staff);
  const visibility = getVisibilityStatus(client);
  const rawDocumentUrls = data.validation?.documentUrls;
  const documentUrls = Array.isArray(rawDocumentUrls)
    ? rawDocumentUrls.map((item) => (typeof item === 'string' ? item : item?.url || item?.fileUrl || item?.path || '')).map((item) => item.trim()).filter(Boolean)
    : String(rawDocumentUrls || '').split(',').map((item) => item.trim()).filter(Boolean);
  const docLinks = mapClientDocuments(documentUrls);
  const clientDocuments = useMemo(() => collectClientDocuments(data), [client]);
  const msmeDocumentFiles = msmeRows.map((row) => row?.file).filter(Boolean);
  const complianceDocument = (name, fallback = '') => data.compliance?.[`${name}File`] || fallback;
  const companyWideProfileRows = [
    ['ATPL Lead ID', data.importMeta?.leadNumber || data.importMeta?.uniqueId || getClientUniqueId(client), FileText],
    ['Company Overview Name', data.companyOverview?.companyName, Building2],
    ['Company Summary', data.companyOverview?.companySummary, FileText],
    ['Overview Points', Array.isArray(data.companyOverview?.overviewItems) ? data.companyOverview.overviewItems.filter(Boolean).join(' | ') : '', ClipboardList],
    ['Product Name', data.companyOverview?.productName, FileText],
    ...(data.companyOverview?.productImage ? [['Product Image', 'Uploaded image', Images, data.companyOverview.productImage]] : []),
    ['Product Category', normalizeCompanyOverviewCategories(data.companyOverview?.category).join(', '), FolderCheck],
    ['Client Name', clientName, Building2],
    ['Trade Name', data.basic?.tradeName, Building2],
    ['Company Type', data.basic?.companyType, Building2],
    ['Company Industry', data.basic?.companyIndustry, Building2],
    ['Website', data.basic?.website, Eye]
  ];
  const companyWideComplianceRows = [
    ['GST Number', data.compliance?.gst || data.compliance?.gstNumber, FileText, complianceDocument('gst', docLinks.gst)],
    ['PAN', data.compliance?.pan || data.compliance?.panNumber, FileText, complianceDocument('pan', docLinks.pan)],
    ['CIN', data.compliance?.cin || data.compliance?.cinNumber, FileText, complianceDocument('cin', docLinks.cin)],
    ['MSME', getMsmeSummary(data), FileCheck2, msmeDocumentFiles.length ? msmeDocumentFiles : docLinks.msme]
  ];
  const profileRows = [
    ...companyWideProfileRows,
    ['State', data.registeredAddress?.state, MapPin],
    ['City with PIN', cityPin, MapPin],
    ['PIBO Category', data.basic?.piboCategory, FolderCheck],
    ['Service Category', data.basic?.eprCategory, FileCheck2],
    ['Services Offered', data.basic?.servicesOffered, CheckCircle2],
    ['Registered on CPCB Portal', data.cpcbOnboarding?.cpcbPortalRegistered === true ? 'Yes' : data.cpcbOnboarding?.cpcbPortalRegistered === false ? 'No' : 'Not answered', ShieldCheck],
    ...(data.cpcbOnboarding?.cpcbPortalRegistered === false && data.cpcbOnboarding?.cpcbApplicationStatus ? [['CPCB Application Status', data.cpcbOnboarding.cpcbApplicationStatus, ClipboardList]] : [])
  ];
  const companyHistoryRows = [
    ['Lead ID', data.importMeta?.leadNumber || data.importMeta?.uniqueId || getClientUniqueId(client), FileText],
    ['Company Name', data.companyOverview?.companyName || clientName, Building2],
    ['Company Summary', data.companyOverview?.companySummary, FileText],
    ['Overview Points', Array.isArray(data.companyOverview?.overviewItems) ? data.companyOverview.overviewItems.filter(Boolean).join(' | ') : '', ClipboardList],
    ['Product Name', data.companyOverview?.productName, FileText],
    ['Product Category', normalizeCompanyOverviewCategories(data.companyOverview?.category).join(', '), FolderCheck],
  ];
  const contactRows = [
    ['Contact Person', data.otp?.personName || data.authorised?.name, UserRound],
    ['Contact No', data.otp?.mobile || data.authorised?.mobile, UserRound],
    ['Email', data.authorised?.email || data.coordinating?.email, FileText],
    ['Website', data.basic?.website, Eye],
    ['Authorised Person', data.authorised?.name, UserRound],
    ...(data.authorised?.panDocument ? [['Authorised Person PAN Document', 'Uploaded document', FileText, data.authorised.panDocument]] : []),
    ...(data.authorised?.aadhaarDocument ? [['Authorised Person Aadhaar Document', 'Uploaded document', FileText, data.authorised.aadhaarDocument]] : []),
    ['Coordinator', data.coordinating?.name, UserRound]
  ];
  const complianceRows = [
    ...companyWideComplianceRows,
    ['Factory License', data.compliance?.factoryLicense || data.compliance?.factoryLicenseNumber, FileText, complianceDocument('factoryLicense', docLinks.factory)],
    ['EPR Certificate', data.compliance?.eprCertificate || data.compliance?.eprCertificateNumber, ShieldCheck, complianceDocument('eprCertificate', docLinks.epr)]
  ];
  const initials = clientName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'CL';
  const [activeClientTab, setActiveClientTab] = useState(initialTab || 'basic');
  const [openDetailGroups, setOpenDetailGroups] = useState({});
  const clientQuotations = useMemo(() => getClientQuotations(quotations, client), [quotations, client]);
  const quotationContext = useMemo(() => ({
    ...getClientQuotationContext(client),
    sourceType: 'client',
    clientId: client?._id || client?.id || '',
    clientUniqueId: getClientUniqueId(client),
    leadId: client?._id || client?.id || '',
    leadCode: getClientUniqueId(client)
  }), [client]);
  const firstAnnualReturnYear = getFirstAnnualReturnYear(client, data);
  const initialAnnualYearLabel = normalizeFinancialYearLabel(initialAnnualYear);
  const annualYears = useMemo(() => {
    return buildAnnualHubYears(firstAnnualReturnYear, data, initialAnnualYearLabel);
  }, [data, firstAnnualReturnYear, initialAnnualYearLabel]);
  const annualYearLabelsKey = annualYears.map((year) => year.label).join('|');
  const clientViewKey = String(client?._id || client?.id || getClientUniqueId(client) || clientName);
  const [selectedAnnualYear, setSelectedAnnualYear] = useState(() => (
    initialAnnualYearLabel && annualYears.some((year) => year.label === initialAnnualYearLabel) ? initialAnnualYearLabel : ''
  ));
  const addressRows = [
    ['Registered Address 1', data.registeredAddress?.address1, MapPin],
    ['Registered Address 2', data.registeredAddress?.address2, MapPin],
    ['Registered Address 3', data.registeredAddress?.address3, MapPin],
    ['Registered State', data.registeredAddress?.state, MapPin],
    ['Registered City', data.registeredAddress?.city, MapPin],
    ['Registered PIN', data.registeredAddress?.pincode, MapPin],
    ['Communication Address 1', data.communicationAddress?.address1, MapPin],
    ['Communication City', data.communicationAddress?.city, MapPin],
    ['Communication State', data.communicationAddress?.state, MapPin],
    ['Communication PIN', data.communicationAddress?.pincode, MapPin]
  ];
  const docRows = [
    ['GST Certificate Date', data.compliance?.gstDate, FileText, complianceDocument('gst', docLinks.gst)],
    ['CIN Document Date', data.compliance?.cinDate, FileText, complianceDocument('cin', docLinks.cin)],
    ['PAN Document Date', data.compliance?.panDate, FileText, complianceDocument('pan', docLinks.pan)],
    ['Factory License Date', data.compliance?.factoryLicenseDate, FileText, complianceDocument('factoryLicense', docLinks.factory)],
    ['EPR Certificate No', data.compliance?.eprCertificate, ShieldCheck, complianceDocument('eprCertificate', docLinks.epr)],
    ...(data.cpcb?.homePageFile ? [['CPCB Home Page', 'Uploaded document', Images, data.cpcb.homePageFile]] : []),
    ...(clientDocumentActionUrls(data.cpcbScreenshots).length ? [['CPCB Screenshots / Documents', `${clientDocumentActionUrls(data.cpcbScreenshots).length} uploaded`, Images, data.cpcbScreenshots]] : []),
    ...(clientDocumentActionUrls(data.processDiagrams).length ? [['Process Diagrams', `${clientDocumentActionUrls(data.processDiagrams).length} uploaded`, Images, data.processDiagrams]] : []),
    ...((data.cte?.plantWiseDetails || []).flatMap((plant, index) => [
      ...(plant?.cteDocument ? [[`Plant ${index + 1} CTE Document`, 'Uploaded document', FileText, plant.cteDocument]] : []),
      ...(plant?.ctoDocument ? [[`Plant ${index + 1} CTO / CCA Document`, 'Uploaded document', FileText, plant.ctoDocument]] : [])
    ])),
    ...(docLinks.application ? [['Application Page', 'Uploaded document', FileText, docLinks.application]] : [])
  ];
  const sharedComplianceRows = [
    ['GST Number', data.compliance?.gst || data.compliance?.gstNumber, FileText, complianceDocument('gst', docLinks.gst)],
    ['GST Certificate Date', data.compliance?.gstDate ? formatDisplayDate(data.compliance.gstDate) : '', CalendarDays, complianceDocument('gst', docLinks.gst)],
    ['PAN', data.compliance?.pan || data.compliance?.panNumber, FileText, complianceDocument('pan', docLinks.pan)],
    ['PAN Document Date', data.compliance?.panDate ? formatDisplayDate(data.compliance.panDate) : '', CalendarDays, complianceDocument('pan', docLinks.pan)],
    ['CIN', data.compliance?.cin || data.compliance?.cinNumber, FileText, complianceDocument('cin', docLinks.cin)],
    ['CIN Document Date', data.compliance?.cinDate ? formatDisplayDate(data.compliance.cinDate) : '', CalendarDays, complianceDocument('cin', docLinks.cin)],
    ['MSME', getMsmeSummary(data), FileCheck2, msmeDocumentFiles.length ? msmeDocumentFiles : docLinks.msme]
  ];
  const detailTabs = [
    { id: 'basic', label: 'Basic Info', icon: Building2 },
    { id: 'documents', label: `Documents (${clientDocuments.length})`, icon: FileCheck2, title: 'Uploaded Documents' },
    { id: 'company', label: 'Company History', icon: Building2, title: 'Company History', message: 'No company history entries yet.' },
    { id: 'quotation', label: 'Quotation History', icon: FileText, title: 'Quotation History', message: 'No quotations mapped yet.' },
    { id: 'annual', label: 'Annual Return History', icon: RefreshCw, title: 'Annual Return History', message: 'No annual return timeline yet.' },
    { id: 'ticket', label: 'Ticket', icon: FolderCheck, title: 'Ticket', message: 'No tickets raised yet.' }
  ];
  const activeTabMeta = detailTabs.find((tab) => tab.id === activeClientTab) || detailTabs[0];
  const isAnnualProcessingView = activeClientTab === 'annual' && annualYears.some((year) => year.label === selectedAnnualYear);
  const isAnnualStandaloneView = activeClientTab === 'annual' && initialTab === 'annual';
  const isLifecycleView = activeClientTab === 'ticket';
  const calendarClientKey = String(client._id || client.id || getClientUniqueId(client) || clientName);
  const [interactionTab, setInteractionTab] = useState('follow-up');
  const [calendarItems, setCalendarItems] = useState(() => readCalendarTodoItems());
  const [interactionModalType, setInteractionModalType] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const clientCalendarItems = useMemo(() => calendarItems.filter((item) => String(item.clientKey || '') === calendarClientKey), [calendarClientKey, calendarItems]);
  const clientFollowUps = clientCalendarItems.filter((item) => item.type === 'follow-up');
  const clientTodos = clientCalendarItems.filter((item) => item.type !== 'follow-up');
  const assignOptions = useMemo(() => [...new Map([
    ...staff,
    ...(currentUser ? [currentUser] : [])
  ].map((user) => [String(user?._id || user?.id || user?.email || user?.name || Math.random()), user])).values()].filter(Boolean).map((user) => ({
    value: user.name || user.email || user._id || user.id,
    label: `${user.name || user.email || 'User'}${user.email ? ` (${user.email})` : ''}`
  })), [currentUser, staff]);

  useEffect(() => {
    if (initialTab) setActiveClientTab(initialTab);
    if (initialAnnualYearLabel && annualYears.some((year) => year.label === initialAnnualYearLabel)) {
      setSelectedAnnualYear(initialAnnualYearLabel);
    } else if (initialAnnualYear) {
      setSelectedAnnualYear('');
    }
  }, [clientViewKey, initialTab, initialAnnualYear, initialAnnualYearLabel]);

  useEffect(() => {
    setSelectedAnnualYear((current) => {
      if (current && annualYears.some((year) => year.label === current)) return current;
      if (initialAnnualYearLabel && annualYears.some((year) => year.label === initialAnnualYearLabel)) return initialAnnualYearLabel;
      return '';
    });
  }, [annualYearLabelsKey, initialAnnualYearLabel]);

  useEffect(() => {
    debugAnnualFlow('client-view-annual-state', {
      clientId: client?._id || client?.id,
      clientName,
      initialTab,
      activeClientTab,
      initialAnnualYear,
      initialAnnualYearLabel,
      selectedAnnualYear,
      isAnnualProcessingView,
      annualYears: annualYears.map((year) => year.label),
      savedAnnualYears: getSavedAnnualYearLabels(data)
    });
  }, [activeClientTab, annualYearLabelsKey, client?._id, client?.id, clientName, initialAnnualYear, initialAnnualYearLabel, initialTab, isAnnualProcessingView, selectedAnnualYear]);

  useEffect(() => {
    let mounted = true;
    api.get(API_ENDPOINTS.calendarItems.list)
      .then((response) => {
        if (!mounted) return;
        const serverItems = Array.isArray(response.data?.items) ? response.data.items : [];
        setCalendarItems(serverItems);
        writeCalendarTodoItems(serverItems);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  function toggleDetailGroup(id) {
    setOpenDetailGroups((current) => ({ ...current, [id]: !current[id] }));
  }

  function openClientSection(id) {
    if (id === 'annual') {
      const clientKey = client?._id || client?.id || data.importMeta?.uniqueId || getClientUniqueId(client);
      navigate(`/sales/client-annual-returns/${encodeURIComponent(clientKey)}`);
      return;
    }
    setActiveClientTab(id);
  }

  function saveClientInteractionItem(payload) {
    const assignedUser = [...staff, ...(currentUser ? [currentUser] : [])].find((user) => {
      const keys = [user?.name, user?.email, user?._id, user?.id, user?.crmUserId, user?.userId]
        .filter(Boolean)
        .map((value) => String(value).trim().toLowerCase());
      return keys.includes(String(payload.assignedTo || '').trim().toLowerCase());
    });
    const newItem = {
      ...payload,
      id: `${payload.type}-${Date.now()}`,
      clientKey: calendarClientKey,
      clientNumber: getClientUniqueId(client),
      clientName,
      leadNumber: data.importMeta?.leadNumber || client.selectedLead?.leadCode || '',
      assignedToName: assignedUser?.name || payload.assignedTo,
      assignedToEmail: assignedUser?.email || '',
      assignedToId: assignedUser?._id || assignedUser?.id || assignedUser?.crmUserId || assignedUser?.userId || '',
      createdAt: new Date().toISOString(),
      createdBy: currentUser?.name || currentUser?.email || ''
    };
    const nextItems = [
      newItem,
      ...calendarItems
    ];
    setCalendarItems(nextItems);
    writeCalendarTodoItems(nextItems);
    api.post(API_ENDPOINTS.calendarItems.create, newItem).catch(() => {});
    setInteractionModalType('');
  }

  return (
    <div className="bg-[#f3f8f6]">
      <section className="min-h-[calc(100vh-64px)] px-4 py-4 sm:px-6 lg:px-8">
        {!isAnnualStandaloneView && <div className="-mx-4 -mt-4 border-b border-slate-200/80 bg-white/90 px-4 py-3 shadow-sm backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <button type="button" onClick={onClose} className="btn-lift grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-orange-600 shadow-sm" title="Back">
              <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-[#30737B]">Client Details</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href="https://eprplastic.cpcb.gov.in/#/plastic/home" target="_blank" rel="noreferrer" className="btn-lift inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-black text-violet-700"><ShieldCheck className="h-4 w-4" />CPCB Login</a>
              {onEditSla && <button type="button" onClick={onEditSla} className="btn-lift inline-flex min-h-9 items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3.5 text-sm font-black text-teal-700 hover:bg-teal-100"><Edit3 className="h-4 w-4" />SLA EDIT</button>}
              <button type="button" onClick={() => navigate('/sales/quotations?mode=add', { state: { quotationContext } })} className="btn-lift inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-black text-violet-700"><Plus className="h-4 w-4" />Quotation</button>
              <button type="button" onClick={() => setHistoryOpen(true)} className="btn-lift inline-flex min-h-9 items-center gap-2 rounded-lg bg-teal-700 px-3.5 text-sm font-black text-white"><FileText className="h-4 w-4" />History</button>
            </div>
          </div>
        </div>}

        <div className={isAnnualStandaloneView ? 'mt-0 w-full max-w-none' : 'mt-4 w-full max-w-none'}>
          {!isAnnualStandaloneView && <section className="client-detail-card overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/6">
            <div className="bg-[linear-gradient(135deg,#ffffff_0%,#f0fdfa_58%,#fff7ed_100%)] p-4 sm:p-5">
              <div className="grid gap-4 xl:grid-cols-[1fr_auto] xl:items-center">
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl border border-white bg-[#30737B] text-xl font-black text-white shadow-lg shadow-teal-900/20">{initials}</div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill value={visibility} />
                      <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-black uppercase text-violet-700">{data.basic?.eprCategory || 'EPR Not Set'}</span>
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black uppercase text-emerald-700">{data.basic?.piboCategory || 'PIBO Not Set'}</span>
                    </div>
                    <h1 className="mt-2 text-2xl font-black leading-tight text-slate-950 sm:text-3xl">{clientName}</h1>
                    <p className="mt-1 max-w-4xl text-sm font-bold text-slate-500">{data.registeredAddress?.state || 'State not set'}{cityPin ? `, ${cityPin}` : ''}</p>
                    {serviceClients.length > 1 && (
                      <label className="mt-3 block max-w-xl">
                        <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.14em] text-[#30737B]">View Assigned Service</span>
                        <select
                          value={selectedServiceKey}
                          onChange={(event) => {
                            const selected = serviceClients.find((item) => getClientServiceViewKey(item) === event.target.value);
                            if (selected) onServiceChange?.(selected);
                          }}
                          className="h-11 w-full rounded-lg border border-teal-200 bg-white px-3 text-sm font-black text-slate-800 outline-none shadow-sm focus:border-teal-500 focus:ring-4 focus:ring-teal-100"
                          aria-label="View assigned service"
                        >
                          {serviceClients.map((item, index) => {
                            const key = getClientServiceViewKey(item);
                            return <option key={key} value={key}>{getClientServiceOptionLabel(item, index)}</option>;
                          })}
                        </select>
                      </label>
                    )}
                  </div>
                </div>
                <div className="rounded-xl border border-white/80 bg-white/80 p-3 shadow-sm shadow-teal-900/5 backdrop-blur xl:min-w-[640px]">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <InlineClientMeta label="Unique ID" value={getClientUniqueId(client)} icon={FileText} />
                    <InlineClientMeta label="Visibility" value={visibility} icon={Eye} status />
                    <InlineClientMeta label="Assigned To" value={assignedName} icon={UserRound} />
                    <InlineClientMeta label="CPCB" value={data.cpcb?.status || '-'} icon={ShieldCheck} />
                    <InlineClientMeta label="OTP Mobile" value={data.otp?.mobile || '-'} icon={KeyRound} />
                    <InlineClientMeta label="OTP Name" value={data.otp?.personName || '-'} icon={UserRound} />
                  </div>
                </div>
              </div>
            </div>

          </section>}

          {!isAnnualStandaloneView && (
            <ClientInteractionsCard
              activeTab={interactionTab}
              onTabChange={setInteractionTab}
              followUps={clientFollowUps}
              todos={clientTodos}
              onAddFollowUp={() => setInteractionModalType('follow-up')}
              onAddTodo={() => setInteractionModalType('todo')}
            />
          )}

          <div className={isAnnualStandaloneView ? 'space-y-0' : 'mt-5 space-y-5'}>
            {!isAnnualStandaloneView && <section className="client-detail-card overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-900/5">
              <div className="client-detail-tab-strip grid sm:grid-cols-6">
                {detailTabs.map((tab) => {
                  const Icon = tab.icon;
                  const active = activeClientTab === tab.id;
                  return (
                    <button key={tab.id} type="button" onClick={() => openClientSection(tab.id)} className={`client-detail-tab-button relative flex min-h-14 items-center justify-center gap-2 border-b border-slate-200 px-3 text-sm font-black transition sm:border-b-0 sm:border-r last:border-r-0 ${active ? 'client-detail-tab-button-active bg-emerald-50 text-[#30737B]' : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}>
                      <Icon className="h-4 w-4" />
                      <span className="truncate">{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>}

            <main className="space-y-5">
              <section className={isAnnualStandaloneView || isLifecycleView ? '' : 'client-detail-card rounded-xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-900/5'}>
                {!isAnnualStandaloneView && !isLifecycleView && <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-[#30737B]">{activeTabMeta.label}</p>
                    <h3 className="mt-1 text-2xl font-black text-slate-950">{activeTabMeta.title || activeTabMeta.label}</h3>
                  </div>
                  <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-black uppercase text-slate-600">Updated {data.importMeta?.creationDate || 'Recently'}</span>
                </div>}

                <div key={activeClientTab} className="client-detail-tab-panel">
                  {activeClientTab === 'basic' && (
                    <div className="mt-5 grid gap-4">
                      <DetailAccordion title="Company-wide Shared Details (Common across all services)" open={Boolean(openDetailGroups.companyWide ?? true)} onToggle={() => toggleDetailGroup('companyWide')}>
                        <DetailSheet columns={2}>
                          {companyWideProfileRows.map(([label, value, Icon, actionUrl]) => <DetailValue key={`cw-${label}`} label={label} value={value} icon={Icon} actionUrl={actionUrl} link={label === 'Website'} />)}
                        </DetailSheet>
                      </DetailAccordion>

                      <DetailAccordion title="Currently Selected Service — Basic Info" open={Boolean(openDetailGroups.basic)} onToggle={() => toggleDetailGroup('basic')}>
                        <DetailSheet columns={2}>
                          {profileRows.map(([label, value, Icon, actionUrl]) => <DetailValue key={label} label={label} value={value} icon={Icon} actionUrl={actionUrl} />)}
                        </DetailSheet>
                      </DetailAccordion>
                      <DetailAccordion title="Shared Compliance Documents (GST, PAN, CIN, MSME)" open={Boolean(openDetailGroups.companyDocs)} onToggle={() => toggleDetailGroup('companyDocs')}>
                        <DetailSheet columns={2}>
                          {sharedComplianceRows.map(([label, value, Icon, actionUrl]) => <DetailValue key={`sh-${label}`} label={label} value={value} icon={Icon} actionUrl={actionUrl} />)}
                        </DetailSheet>
                      </DetailAccordion>
                      <DetailAccordion title="Currently Selected Service — Registered and communication addresses" open={Boolean(openDetailGroups.addresses)} onToggle={() => toggleDetailGroup('addresses')}>
                        <DetailSheet columns={2}>
                          {addressRows.map(([label, value, Icon, actionUrl]) => <DetailValue key={label} label={label} value={value} icon={Icon} actionUrl={actionUrl} />)}
                        </DetailSheet>
                      </DetailAccordion>
                      <DetailAccordion title="Currently Selected Service — Service-specific Document depository (Factory License, EPR Cert)" open={Boolean(openDetailGroups.docs)} onToggle={() => toggleDetailGroup('docs')}>
                        <DetailSheet columns={2}>
                          {[...complianceRows, ...docRows].map(([label, value, Icon, actionUrl]) => <DetailValue key={label} label={label} value={value} icon={Icon} actionUrl={actionUrl} />)}
                        </DetailSheet>
                      </DetailAccordion>
                      <DetailAccordion title="Currently Selected Service — Contact matrix" open={Boolean(openDetailGroups.contacts)} onToggle={() => toggleDetailGroup('contacts')}>
                        <DetailSheet columns={2}>
                          {contactRows.map(([label, value, Icon, actionUrl]) => <DetailValue key={label} label={label} value={value} icon={Icon} actionUrl={actionUrl} link={label === 'Website'} />)}
                        </DetailSheet>
                      </DetailAccordion>
                    </div>
                  )}

                  {activeClientTab === 'company' && (
                    <DetailAccordion title="Company Overview" open={Boolean(openDetailGroups.company)} onToggle={() => toggleDetailGroup('company')}>
                      <DetailSheet columns={2}>
                        {companyHistoryRows.map(([label, value, Icon, actionUrl]) => <DetailValue key={label} label={label} value={value} icon={Icon} actionUrl={actionUrl} />)}
                      </DetailSheet>
                    </DetailAccordion>
                  )}

                  {activeClientTab === 'documents' && <ClientDocumentLibrary documents={clientDocuments} />}

                  {activeClientTab === 'annual' && (
                    <AnnualReturnHistory
                      client={client}
                      quotations={clientQuotations.length ? clientQuotations : quotations}
                      proformaInvoices={proformaInvoices}
                      staff={staff}
                      years={annualYears}
                      selectedYear={selectedAnnualYear}
                      currentUser={currentUser}
                      onSelectYear={setSelectedAnnualYear}
                      onClientUpdated={onClientUpdated}
                    />
                  )}

                  {activeClientTab === 'quotation' && (
                    <QuotationHistory
                      client={client}
                      quotations={clientQuotations}
                      quotationContext={quotationContext}
                    />
                  )}

                  {activeClientTab === 'ticket' && (
                    <ClientLifecycleTracker client={client} data={data} onClientUpdated={onClientUpdated} />
                  )}

                  {activeClientTab !== 'basic' && activeClientTab !== 'documents' && activeClientTab !== 'company' && activeClientTab !== 'annual' && activeClientTab !== 'quotation' && activeClientTab !== 'ticket' && (
                    <EmptyTab title={activeTabMeta.title} message={activeTabMeta.message} />
                  )}
                </div>
              </section>

            </main>
          </div>
        </div>
        {interactionModalType && (
          <ClientInteractionModal
            type={interactionModalType}
            clientName={clientName}
            clientNumber={getClientUniqueId(client)}
            leadNumber={data.importMeta?.leadNumber || client.selectedLead?.leadCode || ''}
            assignOptions={assignOptions}
            onClose={() => setInteractionModalType('')}
            onSave={saveClientInteractionItem}
          />
        )}
        {historyOpen && (
          <ClientCompleteHistoryModal
            clientName={clientName}
            quotations={clientQuotations}
            followUps={clientFollowUps}
            todos={clientTodos}
            onClose={() => setHistoryOpen(false)}
          />
        )}
      </section>
    </div>
  );
}

function historyValue(value) {
  if (value === undefined || value === null || value === '') return '-';
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function ClientCompleteHistoryModal({ clientName, quotations = [], followUps = [], todos = [], onClose }) {
  const quotationEvents = quotations.flatMap((quotation) => {
    const revisions = Array.isArray(quotation.revisionHistory) ? quotation.revisionHistory : [];
    return [
      { id: `created-${quotation._id || quotation.id}`, kind: 'Quotation Created', at: quotation.createdAt || quotation.quotationDate, actor: quotation.createdBy?.name || quotation.createdBy?.email || 'CRM User', title: quotation.quotationNumber || 'Quotation', details: [`${(quotation.items || []).length} item(s)`, `Grand Total: ${formatInrValue(quotation.grandTotal || quotation.subtotal || 0)}`] },
      ...revisions.map((revision, index) => ({ id: `revision-${quotation._id || quotation.id}-${index}`, kind: 'Quotation Updated', at: revision.at, actor: revision.userName || revision.userEmail || 'CRM User', title: `${quotation.quotationNumber || 'Quotation'} updated`, details: (revision.changes || []).map((change) => `${change.label || change.field}: ${historyValue(change.before)} → ${historyValue(change.after)}`) }))
    ];
  });
  const interactionEvents = [...followUps, ...todos].flatMap((item) => {
    const base = [{ id: `interaction-${item._id || item.id}`, kind: item.type === 'follow-up' ? 'Follow-Up Created' : 'To-Do Created', at: item.createdAt, actor: item.createdBy || 'CRM User', title: item.title, details: [item.description, `Scheduled: ${item.scheduledDate || '-'} ${item.scheduledTime || ''}`, `Assigned: ${item.assignedToName || item.assignedTo || '-'}`, `Priority: ${item.priority || 'Medium'}`, `Status: ${item.status || 'open'}`].filter(Boolean) }];
    const updates = [...(item.history || []), ...(item.assignmentHistory || []), ...(item.completionHistory || [])];
    return [...base, ...updates.map((entry, index) => ({ id: `interaction-update-${item._id || item.id}-${index}`, kind: item.type === 'follow-up' ? 'Follow-Up Updated' : 'To-Do Updated', at: entry.at || entry.updatedAt || item.updatedAt, actor: entry.by || entry.userName || item.assignedToName || 'CRM User', title: item.title, details: [entry.remarks || entry.description || entry.action || 'Interaction updated'] }))];
  });
  const events = [...quotationEvents, ...interactionEvents].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  const updateCount = quotationEvents.filter((event) => event.kind === 'Quotation Updated').length;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-gradient-to-r from-teal-50 to-orange-50 p-5">
          <div><p className="text-xs font-black uppercase tracking-[.16em] text-teal-700">Complete Activity History</p><h2 className="mt-1 text-2xl font-black text-slate-950">{clientName}</h2><p className="mt-1 text-sm font-bold text-slate-500">{quotations.length} quotation(s) • {updateCount} update(s) • {followUps.length} follow-up(s) • {todos.length} to-do(s)</p></div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 bg-white"><X className="h-5 w-5" /></button>
        </header>
        <div className="max-h-[72vh] space-y-3 overflow-y-auto p-5">
          {events.length ? events.map((event) => (
            <article key={event.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-black uppercase text-orange-700">{event.kind}</span><h3 className="mt-2 font-black text-slate-900">{event.title}</h3></div><div className="text-right text-xs font-bold text-slate-500"><p>{event.at ? new Date(event.at).toLocaleString('en-IN') : '-'}</p><p className="mt-1 text-teal-700">By {event.actor}</p></div></div>
              {event.details?.length ? <ul className="mt-3 space-y-1 rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-600">{event.details.map((detail, index) => <li key={index}>• {detail}</li>)}</ul> : null}
            </article>
          )) : <div className="py-14 text-center font-black text-slate-400">No history available for this client.</div>}
        </div>
      </section>
    </div>
  );
}

function ClientInteractionsCard({ activeTab, onTabChange, followUps = [], todos = [], onAddFollowUp, onAddTodo }) {
  const rows = activeTab === 'follow-up' ? followUps : todos;
  return (
    <section className="client-interactions-card">
      <div className="client-interactions-head">
        <div>
          <p>Client Interactions</p>
          <div className="client-interaction-tabs">
            <button type="button" onClick={() => onTabChange('follow-up')} className={activeTab === 'follow-up' ? 'active' : ''}>Follow-Up</button>
            <button type="button" onClick={() => onTabChange('todo')} className={activeTab === 'todo' ? 'active' : ''}>To-Do</button>
          </div>
        </div>
        <div className="client-interaction-actions">
          <button type="button" onClick={onAddFollowUp}><Clock3 className="h-4 w-4" /> Add Follow-Up</button>
          <button type="button" onClick={onAddTodo}><ClipboardList className="h-4 w-4" /> Add To-Do</button>
        </div>
      </div>
      <div className="client-interaction-content">
        {rows.length ? rows.slice(0, 4).map((item) => (
          <article key={item.id} className="client-interaction-row">
            <span><CalendarDays className="h-4 w-4" /></span>
            <div>
              <strong>{item.title}</strong>
              <small>{formatDisplayDate(item.scheduledDate)}{item.scheduledTime ? ` at ${item.scheduledTime}` : ''} • {item.priority || 'Medium'}</small>
            </div>
            <em>{item.status === 'completed' ? 'Done' : item.type === 'follow-up' ? 'Follow-Up' : 'To-Do'}</em>
          </article>
        )) : (
          <div className="client-interaction-empty">
            <ClipboardList className="h-10 w-10" />
            <strong>{activeTab === 'follow-up' ? 'No follow-ups linked to this client' : 'No to-do items linked to this client'}</strong>
            <span>{activeTab === 'follow-up' ? 'Add a dated follow-up so it appears on the calendar.' : 'Create a todo and assign it to the team.'}</span>
          </div>
        )}
      </div>
    </section>
  );
}

function ClientInteractionModal({ type, clientName, clientNumber = '', leadNumber = '', assignOptions = [], onClose, onSave }) {
  const today = new Date().toISOString().slice(0, 10);
  const [draft, setDraft] = useState({
    title: type === 'follow-up' ? `Follow up with ${clientName}` : '',
    description: '',
    clientNumber,
    clientName,
    leadNumber,
    scheduledDate: today,
    scheduledTime: '',
    priority: 'Medium',
    category: type === 'follow-up' ? 'Follow-Up' : 'General',
    assignedTo: '',
    status: 'open',
    type
  });
  const isFollowUp = type === 'follow-up';

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function submit() {
    if (!draft.title.trim()) return;
    onSave({ ...draft, title: draft.title.trim() });
  }

  return (
    <div className="client-interaction-modal-backdrop">
      <div className="client-interaction-modal">
        <div className="client-interaction-modal-head">
          <div>
            <span>{clientName}</span>
            <h3><Plus className="h-5 w-5" /> {isFollowUp ? 'Add Next Follow-Up' : 'Add Client To-Do'}</h3>
          </div>
          <button type="button" onClick={onClose}><X className="h-5 w-5" /></button>
        </div>
        <div className="client-interaction-form">
          <label>
            <span>{isFollowUp ? 'Follow-Up Title' : 'Todo Title'}</span>
            <input value={draft.title} onChange={(event) => update('title', event.target.value)} placeholder={isFollowUp ? 'Follow up with client' : 'Enter todo title'} />
          </label>
          <label>
            <span>{isFollowUp ? 'Follow-Up Date' : 'Scheduled Date'}</span>
            <PremiumDatePicker value={draft.scheduledDate} onChange={(event) => update('scheduledDate', event.target.value)} />
          </label>
          <label>
            <span>{isFollowUp ? 'Follow-Up Time' : 'Scheduled Time'}</span>
            <input type="time" value={draft.scheduledTime} onChange={(event) => update('scheduledTime', event.target.value)} />
          </label>
          <label>
            <span>Client Number</span>
            <input value={draft.clientNumber || ''} readOnly />
          </label>
          <label>
            <span>Lead Number</span>
            <input value={draft.leadNumber || ''} readOnly />
          </label>
          <label>
            <span>Priority</span>
            <select value={draft.priority} onChange={(event) => update('priority', event.target.value)}>
              {['Low', 'Medium', 'High', 'Urgent'].map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span>Category</span>
            <select value={draft.category} onChange={(event) => update('category', event.target.value)}>
              {['General', 'Sales', 'Support', 'Development', 'Manager', 'Follow-Up'].map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span>Assign To User</span>
            <select value={draft.assignedTo} onChange={(event) => update('assignedTo', event.target.value)}>
              <option value="">Select user (optional)</option>
              {assignOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="wide">
            <span>Remarks / Description</span>
            <textarea value={draft.description} onChange={(event) => update('description', event.target.value)} placeholder={isFollowUp ? 'Enter follow-up remarks' : 'Enter todo description'} />
          </label>
        </div>
        <div className="client-interaction-modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" onClick={submit}>{isFollowUp ? 'Save Follow-Up' : 'Add To-Do'}</button>
        </div>
      </div>
    </div>
  );
}

function QuickStat({ label, value, icon: Icon }) {
  return (
    <div className="rounded-lg border border-white/80 bg-white/90 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</p>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-[#30737B]"><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-3 truncate text-sm font-black text-slate-950">{value || '-'}</p>
    </div>
  );
}

function StatusPill({ value }) {
  const current = value || '-';
  const statusClass = current === 'LIVE'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : current === 'SUSPENDED'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-rose-200 bg-rose-50 text-rose-700';

  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase ${statusClass}`}>{current}</span>
  );
}

function InlineClientMeta({ label, value, icon: Icon, status = false }) {
  return (
    <div className="min-w-0 border-l-2 border-[#30737B]/20 pl-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-[#30737B]" />
        <p className="truncate text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</p>
      </div>
      {status ? (
        <div className="mt-1"><StatusPill value={value} /></div>
      ) : (
        <p className="mt-1 truncate text-sm font-black text-slate-950">{value || '-'}</p>
      )}
    </div>
  );
}

function ClientDocumentLibrary({ documents = [] }) {
  const groups = documents.reduce((result, document) => {
    const category = document.category || 'Other Documents';
    if (!result[category]) result[category] = [];
    result[category].push(document);
    return result;
  }, {});

  if (!documents.length) {
    return (
      <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-14 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white text-[#30737B] shadow-sm"><FileCheck2 className="h-6 w-6" /></span>
        <h4 className="mt-4 text-lg font-black text-slate-800">No uploaded documents found</h4>
        <p className="mt-1 text-sm font-semibold text-slate-500">Documents uploaded in Client Master will automatically appear here.</p>
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-orange-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-xs font-black uppercase tracking-[0.18em] text-[#30737B]">Document Repository</p><h4 className="mt-1 text-lg font-black text-slate-900">Every uploaded client file in one place</h4></div>
        <span className="w-fit rounded-xl bg-[#30737B] px-4 py-2 text-sm font-black text-white">{documents.length} file{documents.length === 1 ? '' : 's'}</span>
      </div>
      {Object.entries(groups).map(([category, items]) => (
        <section key={category} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <header className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
            <h5 className="flex items-center gap-2 text-sm font-black text-slate-800"><FolderCheck className="h-4 w-4 text-[#30737B]" />{category}</h5>
            <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-slate-500 ring-1 ring-slate-200">{items.length}</span>
          </header>
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((document, index) => (
              <article key={`${document.url.slice(0, 120)}-${index}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-emerald-300 hover:shadow-md">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-[#30737B]"><FileText className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-black text-slate-900" title={document.name}>{document.name}</p><p className="mt-1 truncate text-[10px] font-bold uppercase tracking-wide text-slate-400">Uploaded document</p></div>
                <a href={openableClientDocumentUrl(document.url)} target="_blank" rel="noreferrer" className="btn-lift inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[#30737B] px-3 text-xs font-black text-white" title={`View ${document.name}`}><Eye className="h-3.5 w-3.5" />View</a>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function DetailSheet({ children, columns = 1 }) {
  return (
    <div className={`detail-sheet-grid detail-sheet-grid-${columns}`}>
      {children}
    </div>
  );
}

function DetailValue({ label, value, icon: Icon, link = false, actionUrl = '' }) {
  const isDocumentList = Array.isArray(value);
  const display = value || '-';
  const actionUrls = clientDocumentActionUrls(actionUrl);
  return (
    <div className="detail-value-card group min-w-0 border-slate-100 px-4 py-3 transition hover:bg-emerald-50/50 sm:px-5">
      <div className="grid gap-3 xl:grid-cols-[minmax(150px,190px)_minmax(0,1fr)_auto] xl:items-center">
        <div className="flex min-w-0 items-center gap-3">
          {Icon && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-50 text-[#30737B] ring-1 ring-emerald-100 transition group-hover:bg-white"><Icon className="h-4 w-4" /></span>}
          <p className="min-w-0 truncate text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p>
        </div>
        <div className="min-w-0 pl-11 xl:pl-0">
          {isDocumentList ? null : link && value ? (
            <a className="inline-flex max-w-full break-words text-sm font-black text-orange-600 underline" href={String(value).startsWith('http') ? value : `https://${value}`} target="_blank" rel="noreferrer">Visit website</a>
          ) : (
            <p className="break-words text-sm font-black leading-6 text-slate-900">{display}</p>
          )}
        </div>
        {actionUrls.length > 0 && !isDocumentList ? (
          <div className="ml-11 flex flex-wrap gap-2 xl:ml-0 xl:justify-end">
            {actionUrls.map((url, index) => (
              <a
                key={`${url}-${index}`}
                href={openableClientDocumentUrl(url)}
                target="_blank"
                rel="noreferrer"
                className="btn-lift inline-flex h-9 w-fit shrink-0 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-black text-[#30737B] hover:bg-[#30737B] hover:text-white"
                title={getDocumentLinkName(url, index)}
                aria-label={`View ${label}${actionUrls.length > 1 ? ` document ${index + 1}` : ''}`}
              >
                <Eye className="h-3.5 w-3.5" />
                {actionUrls.length > 1 ? `View ${index + 1}` : 'View'}
              </a>
            ))}
          </div>
        ) : <span className="hidden xl:block" />}
      </div>
      {isDocumentList ? (
        value.length > 0 ? (
          <div className="mt-3 grid gap-2 pl-11 sm:grid-cols-2 xl:grid-cols-3">
            {value.map((url, index) => (
              <a
                key={`${url}-${index}`}
                href={normalizeDocumentUrl(url)}
                target="_blank"
                rel="noreferrer"
                className="btn-lift group/link flex min-h-11 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-black text-slate-700 hover:border-[#30737B]/40 hover:bg-white hover:text-[#30737B]"
                title={url}
              >
                <span className="min-w-0 truncate">{getDocumentLinkName(url, index)}</span>
                <span className="shrink-0 rounded-md bg-white px-2 py-1 text-xs font-black text-orange-600 shadow-sm group-hover/link:text-[#30737B]">View</span>
              </a>
            ))}
          </div>
        ) : (
          <p className="mt-2 pl-11 text-sm font-black text-slate-400">No documents uploaded.</p>
        )
      ) : null}
    </div>
  );
}

function QuotationHistory({ client, quotations, quotationContext }) {
  const navigate = useNavigate();
  const data = readClientData(client);
  const clientName = data.basic?.clientLegalName || data.basic?.tradeName || quotationContext?.clientName || 'Selected Client';
  const totalAmount = quotations.reduce((sum, quotation) => sum + (quotation.items || []).reduce((itemSum, item) => itemSum + (Number(item.basicAmount) || 0), 0), 0);
  const latestQuote = quotations[0];

  function openList() {
    navigate('/sales/quotations', { state: { quotationContext } });
  }

  function openPreview(quotation) {
    navigate('/sales/quotations', { state: { quotationContext, previewQuotationId: quotation._id || quotation.id } });
  }

  function reviseQuotation(quotation) {
    navigate('/sales/quotations', { state: { quotationContext, editQuotationId: quotation._id || quotation.id } });
  }

  return (
    <div className="mt-5 space-y-5">
      <section className="overflow-hidden rounded-xl border border-emerald-100 bg-[linear-gradient(135deg,#f0fdfa_0%,#ffffff_48%,#fff7ed_100%)] p-4 shadow-sm shadow-teal-900/5">
        <div className="grid gap-3 md:grid-cols-4">
          <QuotationStat label="Company" value={clientName} icon={Building2} />
          <QuotationStat label="Total Quotations" value={quotations.length} icon={FileText} />
          <QuotationStat label="Quote Value" value={formatInrValue(totalAmount)} icon={Database} />
          <QuotationStat label="Latest Quote" value={latestQuote?.quotationNumber || '-'} icon={CalendarDays} />
        </div>
      </section>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#30737B]">Company Quotation Ledger</p>
          <h4 className="mt-1 text-xl font-black text-slate-950">{quotations.length ? `${quotations.length} quotation${quotations.length === 1 ? '' : 's'} mapped` : 'No quotations mapped yet'}</h4>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => navigate('/sales/quotations?mode=add', { state: { quotationContext } })} className="btn-lift inline-flex min-h-10 items-center gap-2 rounded-lg bg-orange-500 px-4 text-sm font-black text-white shadow-lg shadow-orange-500/20">
            <Plus className="h-4 w-4" /> New Quotation
          </button>
          <button type="button" onClick={openList} className="btn-lift inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-slate-700">
            <Eye className="h-4 w-4" /> Open Quotation Desk
          </button>
        </div>
      </div>

      {quotations.length ? (
        <div className="space-y-4">
          {quotations.map((quotation, index) => (
            <QuotationHistoryCard
              key={quotation._id || quotation.id || index}
              quotation={quotation}
              index={index}
              onOpen={() => openList()}
              onPreview={() => openPreview(quotation)}
              onRevise={() => reviseQuotation(quotation)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 px-5 py-12 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-xl bg-white text-[#30737B] shadow-sm"><FileText className="h-6 w-6" /></div>
          <p className="mt-4 text-lg font-black text-slate-800">Quotation History</p>
          <p className="mt-2 text-sm font-bold text-slate-500">No quotations mapped for this company yet.</p>
          <button type="button" onClick={() => navigate('/sales/quotations?mode=add', { state: { quotationContext } })} className="btn-lift mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg bg-orange-500 px-5 text-sm font-black text-white shadow-lg shadow-orange-500/20">
            <Plus className="h-4 w-4" /> Create Quotation
          </button>
        </div>
      )}
    </div>
  );
}

function QuotationStat({ label, value, icon: Icon }) {
  return (
    <div className="rounded-lg border border-white/80 bg-white/90 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-[#30737B]"><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-3 truncate text-base font-black text-slate-950">{value || '-'}</p>
    </div>
  );
}

function QuotationHistoryCard({ quotation, index, onOpen, onPreview, onRevise }) {
  const items = quotation.items || [];
  const details = quotation.leadDetails || {};
  const created = formatDisplayDate(quotation.createdAt || quotation.quotationDate);
  const total = items.reduce((sum, item) => sum + (Number(item.basicAmount) || 0), 0);
  const status = quotation.status === 'draft' ? 'Open' : quotation.status || 'Open';

  return (
    <article className="client-detail-card overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-900/5 transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-xl hover:shadow-slate-900/10" style={{ animationDelay: `${index * 70}ms` }}>
      <div className="flex flex-col gap-4 border-b border-slate-100 bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_65%,#fff7ed_100%)] p-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black uppercase text-emerald-700">{status}</span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black uppercase text-emerald-700">{items.length} item{items.length === 1 ? '' : 's'}</span>
            <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-black uppercase text-orange-700">{created}</span>
          </div>
          <h4 className="mt-3 text-2xl font-black text-slate-950">{quotation.quotationNumber || 'Quotation'}</h4>
          <p className="mt-1 text-sm font-bold uppercase text-slate-500">{details.companyName || '-'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onOpen} className="btn-lift inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 text-sm font-black text-emerald-700"><Eye className="h-4 w-4" />Open</button>
          <button type="button" onClick={onPreview} className="btn-lift inline-flex min-h-10 items-center gap-2 rounded-lg px-4 text-sm font-black text-orange-600 hover:bg-orange-50"><FileText className="h-4 w-4" />View Details</button>
          <button type="button" onClick={onRevise} className="btn-lift inline-flex min-h-10 items-center gap-2 rounded-lg border border-orange-300 bg-white px-4 text-sm font-black text-orange-600"><Edit3 className="h-4 w-4" />Revise</button>
        </div>
      </div>

      <div className="grid gap-3 border-b border-slate-100 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <InlineClientMeta label="Contact Person" value={details.contactPerson || '-'} icon={UserRound} />
        <InlineClientMeta label="Prepared By" value={quotation.createdBy?.name || quotation.createdBy?.email || details.referredBy || '-'} icon={UserRound} />
        <InlineClientMeta label="Valid Until" value={formatDisplayDate(quotation.validUntil)} icon={CalendarDays} />
        <InlineClientMeta label="Basic Total" value={formatInrValue(total)} icon={Database} />
      </div>

      <div className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h5 className="font-black text-slate-900">Quotation Items</h5>
          <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">INR</span>
        </div>
        <div className="overflow-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-black uppercase text-slate-600">
              <tr>
                {['#', 'Service Category', 'Services for the Year', 'Service Category', 'PIBO Category', 'Unit', 'Basic Amount'].map((header) => (
                  <th key={header} className="border-r border-slate-200 px-4 py-3 last:border-r-0">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.length ? items.map((item, itemIndex) => (
                <tr key={itemIndex} className="font-black uppercase text-slate-700 transition hover:bg-emerald-50/40">
                  <td className="px-4 py-4 text-emerald-700">{itemIndex + 1}</td>
                  <td className="px-4 py-4">{item.serviceCategory || '-'}</td>
                  <td className="px-4 py-4">{item.servicesForYear || '-'}</td>
                  <td className="px-4 py-4">{item.eprCategory || '-'}</td>
                  <td className="px-4 py-4">{item.piboCategory || '-'}</td>
                  <td className="px-4 py-4">{item.unit || '-'}</td>
                  <td className="px-4 py-4 text-right text-orange-600">{formatInrValue(item.basicAmount)}</td>
                </tr>
              )) : (
                <tr><td colSpan={7} className="px-4 py-8 text-center font-black text-slate-400">No quotation items added.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </article>
  );
}


