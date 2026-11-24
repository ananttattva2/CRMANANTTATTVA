const mongoose = require('mongoose');
const Lead = require('../models/Lead');

const text = (value) => String(value ?? '').trim();
const idText = (value) => text(value?._id ?? value?.id ?? value);

function normalizeFinancialYear(value) {
  const match = text(value).match(/\b(20\d{2})\b/);
  if (!match) return '';
  const start = Number(match[1]);
  return `${start}-${String(start + 1).slice(-2)}`;
}

function financialYearStart(value) {
  const normalized = normalizeFinancialYear(value);
  return normalized ? Number(normalized.slice(0, 4)) : null;
}

function normalizeServiceName(value) {
  const raw = text(value && typeof value === 'object'
    ? value.name || value.label || value.servicesOffered || value.applicableService
    : value).toLowerCase().replace(/[^a-z0-9]+/g, '');
  return raw.includes('annualreturn') ? 'annualreturn' : raw;
}

function isAnnualReturnService(value) {
  return normalizeServiceName(value) === 'annualreturn';
}

function normalizeApplicantType(value) {
  return text(value && typeof value === 'object'
    ? value.subApplicantType || value.piboCategory || value.applicantType || value.label || value.name
    : value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function serviceValues(source = {}) {
  return [
    ...(Array.isArray(source.services) ? source.services : []),
    source.service, source.serviceName, source.servicesOffered, source.applicableService
  ].filter(Boolean);
}

function validPo(row = {}) {
  return Boolean(text(row.poNumber) || text(row.poFileUrl || row.fileUrl || row.file?.secureUrl || row.file?.url));
}

function normalizePo(row = {}, lead = {}, service = 'Annual Return') {
  return {
    number: text(row.poNumber) || null,
    fileUrl: text(row.poFileUrl || row.fileUrl || row.file?.secureUrl || row.file?.url) || null,
    fileName: text(row.poFileName || row.fileName || row.file?.originalName || row.file?.name) || null,
    service: text(service) || 'Annual Return',
    source: 'lead',
    leadId: idText(lead),
    leadCode: text(lead.leadCode) || null
  };
}

function dedupePoCandidates(candidates = []) {
  const unique = new Map();
  candidates.forEach((candidate) => {
    const po = candidate.po;
    const key = [candidate.financialYear, text(po.number).toLowerCase().replace(/\s+/g, ''), text(po.fileUrl).toLowerCase()].join('|');
    const existing = unique.get(key);
    if (!existing || (!existing.explicitService && candidate.explicitService)) unique.set(key, candidate);
  });
  return [...unique.values()];
}

function buildLegacyAnnualReturnCandidates(clientMaster = {}, lead = {}) {
  const filings = clientMaster.data?.annualReturn?.filings;
  if (!filings || typeof filings !== 'object' || Array.isArray(filings)) return [];
  const candidates = [];
  Object.entries(filings).forEach(([filingYear, filing]) => {
    const confirmation = filing?.draft?.purchaseOrderConfirmation;
    if (!confirmation?.confirmed || confirmation.mode === 'no') return;
    (Array.isArray(confirmation.rows) ? confirmation.rows : []).forEach((row) => {
      const financialYear = normalizeFinancialYear(row.fyYear || row.fy || row.financialYear || filingYear);
      if (!financialYear || !validPo(row)) return;
      candidates.push({
        financialYear,
        explicitService: isAnnualReturnService(row.service),
        po: {
          number: text(row.poNumber) || null,
          fileUrl: text(row.poFileUrl || row.fileUrl || row.file?.secureUrl || row.file?.url) || null,
          fileName: text(row.poFileName || row.fileName || row.file?.originalName || row.file?.name) || null,
          service: text(row.service) || 'Annual Return',
          source: 'annual_return_legacy',
          leadId: idText(lead) || null,
          leadCode: text(lead.leadCode) || null
        }
      });
    });
  });
  return dedupePoCandidates(candidates);
}

function readLeadReference(clientMaster = {}) {
  const data = clientMaster.data && typeof clientMaster.data === 'object' ? clientMaster.data : {};
  const candidates = [
    data.selectedLead,
    clientMaster.selectedLead,
    data.sourceLeadId,
    data.leadId,
    data.selectedLeadSnapshot?.id,
    data.selectedLeadSnapshot?.sourceLeadId
  ].map(idText).filter(Boolean);
  const objectId = candidates.find((value) => mongoose.Types.ObjectId.isValid(value));
  return {
    objectId: objectId || '',
    leadCode: text(data.selectedLeadSnapshot?.leadCode || data.importMeta?.leadNumber)
  };
}

function readClientServiceScope(clientMaster = {}) {
  const data = clientMaster.data && typeof clientMaster.data === 'object' ? clientMaster.data : {};
  return {
    assignedServiceId: idText(clientMaster.assignedServiceId || data.assignedServiceId || data.selectedLeadSnapshot?.assignedServiceId),
    applicantType: normalizeApplicantType(data.basic?.piboCategory || data.selectedLeadSnapshot?.subApplicantType
      || data.selectedLeadSnapshot?.piboCategory || data.selectedLeadSnapshot?.applicantType)
  };
}

async function findSourceLead(clientMaster, LeadModel = Lead) {
  const reference = readLeadReference(clientMaster);
  let query = null;
  if (reference.objectId) query = LeadModel.findById(reference.objectId);
  else if (reference.leadCode) query = LeadModel.findOne({ leadCode: reference.leadCode });
  if (!query) return null;
  if (typeof query.select === 'function') query = query.select('leadCode assignments serviceSelections firstAnnualReturnYearApplicable');
  return typeof query.lean === 'function' ? query.lean() : query;
}

function buildAnnualReturnContext(lead = {}, serviceScope = {}) {
  const serviceSelections = Array.isArray(lead.serviceSelections) ? lead.serviceSelections : [];
  const serviceByAssignmentId = new Map(serviceSelections
    .map((service) => [idText(service.assignedServiceId || service.serviceAssignmentId || service.id), service])
    .filter(([id]) => id));
  const annualAssignments = [];
  const candidates = [];
  const assignments = Array.isArray(lead.assignments) ? lead.assignments : [];
  const scopedServiceId = idText(serviceScope.assignedServiceId);
  const scopedApplicantType = normalizeApplicantType(serviceScope.applicantType);
  const rowsWithService = assignments.map((assignment, index) => {
    const assignmentId = idText(assignment.assignedServiceId || assignment.serviceAssignmentId || assignment.id);
    const linkedService = serviceByAssignmentId.get(assignmentId) || serviceSelections[index] || {};
    const applicantType = normalizeApplicantType(linkedService) || normalizeApplicantType(assignment);
    return { assignment, assignmentId, linkedService, applicantType };
  });
  const hasExactServiceMatch = Boolean(scopedServiceId && rowsWithService.some((row) => row.assignmentId === scopedServiceId));
  const hasApplicantMatch = Boolean(!hasExactServiceMatch && scopedApplicantType && rowsWithService.some((row) => row.applicantType === scopedApplicantType));

  rowsWithService.forEach(({ assignment, assignmentId, linkedService, applicantType }) => {
    if (hasExactServiceMatch && assignmentId !== scopedServiceId) return;
    if (hasApplicantMatch && applicantType !== scopedApplicantType) return;
    const assignmentServices = [...serviceValues(linkedService), ...serviceValues(assignment)];
    const assignmentIsAnnual = assignmentServices.some(isAnnualReturnService);
    const rows = Array.isArray(assignment.poYearRows) ? assignment.poYearRows : [];
    const hasAnnualRow = rows.some((row) => serviceValues(row).some(isAnnualReturnService));
    if (!assignmentIsAnnual && !hasAnnualRow) return;

    annualAssignments.push({ assignment, linkedService });
    rows.forEach((row) => {
      const rowServices = serviceValues(row);
      const explicitService = rowServices.some(isAnnualReturnService);
      if (rowServices.length && !explicitService) return;
      if (!explicitService && !assignmentIsAnnual) return;
      const financialYear = normalizeFinancialYear(row.fy || row.fyYear || row.financialYear || row.annualReturnYear);
      if (!financialYear || !validPo(row)) return;
      const service = rowServices.find(isAnnualReturnService)
        || assignmentServices.find(isAnnualReturnService)
        || 'Annual Return';
      candidates.push({ financialYear, explicitService, po: normalizePo(row, lead, service) });
    });
  });

  const explicitStarts = annualAssignments.flatMap(({ assignment, linkedService }) => [
    linkedService.firstAnnualReturnYearApplicable,
    assignment.firstAnnualReturnYearApplicable
  ]).map(financialYearStart).filter(Number.isFinite);
  const candidateStarts = candidates.map((candidate) => financialYearStart(candidate.financialYear)).filter(Number.isFinite);
  const fallbackLeadStart = financialYearStart(lead.firstAnnualReturnYearApplicable);
  const requirementStart = explicitStarts.length
    ? Math.min(...explicitStarts)
    : candidateStarts.length
      ? Math.min(...candidateStarts)
      : (annualAssignments.length && Number.isFinite(fallbackLeadStart) ? fallbackLeadStart : null);

  return { candidates: dedupePoCandidates(candidates), requirementStart };
}

function resolveYearStatus(financialYear, context, lead) {
  const fy = normalizeFinancialYear(financialYear);
  const requestedStart = financialYearStart(fy);
  const matches = context.candidates.filter((candidate) => candidate.financialYear === fy);
  const poRequired = Number.isFinite(context.requirementStart) && Number.isFinite(requestedStart)
    ? requestedStart >= context.requirementStart
    : matches.length > 0;

  if (matches.length > 1) {
    return { fy, poRequired: true, poStatus: 'conflict', po: null, message: 'Multiple PO records found. Please review PO details.' };
  }
  if (matches.length === 1) {
    return { fy, poRequired: true, poStatus: 'received', po: matches[0].po };
  }
  if (poRequired) return { fy, poRequired: true, poStatus: 'pending', po: null };
  return { fy, poRequired: false, poStatus: 'not_required', po: null };
}

async function resolveAnnualReturnPO({ clientMaster, financialYears = [], LeadModel = Lead } = {}) {
  const years = [...new Set((Array.isArray(financialYears) ? financialYears : [financialYears]).map(normalizeFinancialYear).filter(Boolean))];
  const lead = await findSourceLead(clientMaster, LeadModel);
  if (!lead) {
    return {
      sourceLead: null,
      years: years.map((fy) => ({ fy, poRequired: false, poStatus: 'unlinked', po: null }))
    };
  }
  const serviceScope = readClientServiceScope(clientMaster);
  const context = buildAnnualReturnContext(lead, serviceScope);
  const legacyCandidates = buildLegacyAnnualReturnCandidates(clientMaster, lead);
  return {
    sourceLead: { id: idText(lead), leadCode: text(lead.leadCode) || null },
    years: years.map((fy) => {
      const leadStatus = resolveYearStatus(fy, context, lead);
      if (['received', 'conflict'].includes(leadStatus.poStatus)) return leadStatus;
      const legacyMatches = legacyCandidates.filter((candidate) => candidate.financialYear === fy);
      if (legacyMatches.length > 1) return { fy, poRequired: true, poStatus: 'conflict', po: null, message: 'Multiple PO records found. Please review PO details.' };
      if (legacyMatches.length === 1) return { fy, poRequired: true, poStatus: 'received', po: legacyMatches[0].po };
      return leadStatus;
    })
  };
}

module.exports = {
  normalizeFinancialYear,
  normalizeServiceName,
  normalizeApplicantType,
  isAnnualReturnService,
  readLeadReference,
  readClientServiceScope,
  buildAnnualReturnContext,
  buildLegacyAnnualReturnCandidates,
  dedupePoCandidates,
  resolveAnnualReturnPO
};
