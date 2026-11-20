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

function isClosedAssignment(assignment = {}, lead = {}) {
  return Boolean(assignment.closedAt || assignment.closedBy || assignment.closedByText || assignment.permanentClosedAt
    || (lead.serviceSelections?.length === 1 && (lead.closedAt || lead.closedBy))
    || (Math.max(lead.serviceSelections?.length || 0, lead.assignments?.length || 0) <= 1 && text(lead.status).toLowerCase() === 'closed'));
}

function normalizePo(row = {}, lead = {}, service = 'Annual Return', assignment = {}) {
  return {
    isClosed: isClosedAssignment(assignment, lead),
    poYear: normalizeFinancialYear(row.poFinancialYear || row.fy || row.fyYear || row.financialYear),
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
    if (!existing || (!existing.explicitService && candidate.explicitService)) {
      unique.set(key, existing?.po?.isClosed ? { ...candidate, po: { ...candidate.po, isClosed: true } } : candidate);
    } else if (candidate.po.isClosed) {
      existing.po = { ...existing.po, isClosed: true };
    }
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
          isClosed: (lead.assignments || []).some((assignment) => idText(assignment.assignedServiceId) === readClientServiceScope(clientMaster).assignedServiceId && isClosedAssignment(assignment, lead)),
          poYear: normalizeFinancialYear(row.poFinancialYear || row.fy || row.fyYear || row.financialYear),
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
  if (typeof query.select === 'function') query = query.select('leadCode assignments serviceSelections firstAnnualReturnYearApplicable status closedAt closedBy closedByText subApplicantType piboCategory servicesOffered poYearRows originalPoDetails poNumber poFileUrl poFileName');
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
  // Some older Client Masters retained a sibling service id after the applicant
  // was changed. Trust the id only when it also agrees with the selected
  // applicant; otherwise fall back to the Importer/Producer identity.
  const hasExactServiceMatch = Boolean(scopedServiceId && rowsWithService.some((row) => row.assignmentId === scopedServiceId
    && (!scopedApplicantType || row.applicantType === scopedApplicantType)));
  const hasApplicantMatch = Boolean(!hasExactServiceMatch && scopedApplicantType && rowsWithService.some((row) => row.applicantType === scopedApplicantType));

  rowsWithService.forEach(({ assignment, assignmentId, linkedService, applicantType }) => {
    const assignmentServices = [...serviceValues(linkedService), ...serviceValues(assignment)];
    const assignmentIsAnnual = assignmentServices.some(isAnnualReturnService);
    // Annual Return for the same applicant can be spread across several
    // year-scoped assignments. An exact assignedServiceId match must not hide
    // another same-applicant Annual Return assignment that carries the PO.
    const sameApplicantAnnual = assignmentIsAnnual && (!scopedApplicantType || applicantType === scopedApplicantType);
    if (hasExactServiceMatch && assignmentId !== scopedServiceId && !sameApplicantAnnual) return;
    if (hasApplicantMatch && applicantType !== scopedApplicantType) return;
    const rows = Array.isArray(assignment.poYearRows) ? assignment.poYearRows : [];
    const hasAnnualRow = rows.some((row) => serviceValues(row).some(isAnnualReturnService));
    if (!assignmentIsAnnual && !hasAnnualRow) return;

    annualAssignments.push({ assignment, linkedService });
    rows.forEach((row) => {
      const rowServices = serviceValues(row);
      const explicitService = rowServices.some(isAnnualReturnService);
      if (rowServices.length && !explicitService) return;
      if (!explicitService && !assignmentIsAnnual) return;
      // Annual Return Year is the hub key. PO Financial Year may legitimately
      // be the following year and must not hide the applicable return.
      const financialYear = normalizeFinancialYear(row.annualReturnYear || row.fy || row.fyYear || row.financialYear);
      if (!financialYear || !validPo(row)) return;
      const service = rowServices.find(isAnnualReturnService)
        || assignmentServices.find(isAnnualReturnService)
        || 'Annual Return';
      candidates.push({ financialYear, explicitService, po: normalizePo(row, lead, service, assignment) });
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

// Service History reads every closed offered service for the selected applicant,
// independently of the completed-year restrictions used by Annual Return processing.
async function resolveServiceHistory({ clientMaster, LeadModel = Lead } = {}) {
  const lead = await findSourceLead(clientMaster, LeadModel);
  if (!lead) return [];
  const scope = readClientServiceScope(clientMaster);
  const services = Array.isArray(lead.serviceSelections) && lead.serviceSelections.length ? lead.serviceSelections : [lead];
  const assignments = Array.isArray(lead.assignments) && lead.assignments.length ? lead.assignments : [lead];
  const rows = [];
  const label = value => text(typeof value === 'object' ? value.name || value.label || value.servicesOffered || value.applicableService : value);
  const names = source => [...new Set(serviceValues(source).flat().filter(Boolean).map(label).filter(Boolean))];
  assignments.forEach((assignment, index) => {
    const assignedServiceId = idText(assignment.assignedServiceId || assignment.serviceAssignmentId || assignment.id);
    const service = services.find(item => assignedServiceId && idText(item.assignedServiceId || item.serviceAssignmentId || item.id) === assignedServiceId) || services[index] || {};
    const applicant = normalizeApplicantType(service) || normalizeApplicantType(assignment);
    if (scope.applicantType && applicant ? applicant !== scope.applicantType : assignedServiceId !== scope.assignedServiceId) return;
    if (!isClosedAssignment(assignment, lead) && !isClosedAssignment(service, lead)) return;
    const offered = names(service).length ? names(service) : names(assignment);
    const poRows = Array.isArray(assignment.poYearRows) && assignment.poYearRows.length
      ? assignment.poYearRows : [assignment.originalPoDetails || assignment];
    poRows.forEach(poRow => {
      if (!validPo(poRow)) return;
      const rowServices = names(poRow);
      const applicable = rowServices.length ? rowServices.filter(name => !offered.length || offered.some(value => normalizeServiceName(value) === normalizeServiceName(name))) : offered;
      applicable.forEach(serviceName => {
        const po = normalizePo(poRow, lead, serviceName, assignment);
        rows.push({ assignedServiceId, applicantType: label(service.subApplicantType || service.piboCategory || assignment.subApplicantType || assignment.piboCategory || clientMaster.data?.basic?.piboCategory),
          service: serviceName, annual: isAnnualReturnService(serviceName),
          annualYear: normalizeFinancialYear(poRow.annualReturnYear || poRow.fy || poRow.fyYear || poRow.financialYear),
          poYear: po.poYear, number: po.number, fileUrl: po.fileUrl, fileName: po.fileName });
      });
    });
  });
  const unique = new Map();
  rows.forEach(row => unique.set([row.assignedServiceId, normalizeServiceName(row.service), row.annualYear, row.poYear, row.number, row.fileUrl].join('|'), row));
  return [...unique.values()].sort((a, b) => (b.poYear || '').localeCompare(a.poYear || '') || a.service.localeCompare(b.service));
}

module.exports = {
  resolveServiceHistory,
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
