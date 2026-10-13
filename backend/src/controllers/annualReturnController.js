const AnnualReturn = require('../models/AnnualReturn');
const Client = require('../models/Client');
const { getVisibleUserScope, ownerFilter } = require('../utils/visibilityScope');
const {
  getAdminCreatedLeadReferences,
  dashboardClientExclusionFilter
} = require('../services/dashboardTestLeadExclusion');

function combineFilters(...filters) {
  const active = filters.filter((filter) => filter && Object.keys(filter).length);
  return active.length > 1 ? { $and: active } : active[0] || {};
}

function readClientData(client) {
  return client?.data && typeof client.data === 'object' ? client.data : {};
}

function getClientKey(client) {
  const data = readClientData(client);
  return String(client?._id || data.importMeta?.uniqueId || '').trim();
}

function getClientName(client) {
  const data = readClientData(client);
  return String(data.basic?.clientLegalName || data.basic?.tradeName || 'Untitled client').trim();
}

function mapClientFiling(client, annualYear, filing = {}) {
  const data = readClientData(client);
  const basic = data.basic || {};
  return {
    _id: `client-${getClientKey(client)}-${annualYear}`,
    client: client._id,
    clientKey: getClientKey(client),
    annualYear,
    clientName: getClientName(client),
    piboCategory: basic.piboCategory || '',
    eprCategory: basic.eprCategory || '',
    currentSpoc: filing.annual?.currentSpoc || '',
    previousSpoc: filing.annual?.previousSpoc || '',
    status: filing.status || 'draft',
    activeTab: filing.activeTab || '',
    activeSection: filing.activeSection || '',
    draft: filing.draft || {},
    basicInfo: filing.basicInfo || {},
    financials: filing.financials || {},
    data: filing.data || {},
    brandOwner: filing.brandOwner || {},
    importer: filing.importer || {},
    annual: filing.annual || {},
    approvalWorkflow: filing.approvalWorkflow || {},
    clientData: data,
    adminControls: client.adminControls || {},
    savedAt: filing.savedAt || data.annualReturn?.lastSavedAt || client.updatedAt,
    updatedAt: filing.savedAt || data.annualReturn?.lastSavedAt || client.updatedAt
  };
}

function mapAnnualReturnDocumentFiling(document = {}, annualYear = '', filing = {}) {
  const client = document.client && typeof document.client === 'object' ? document.client : null;
  const clientData = document.clientData && typeof document.clientData === 'object'
    ? document.clientData
    : readClientData(client);
  return {
    _id: `${document._id}-${annualYear}`,
    annualReturnId: document._id,
    client: document.client,
    clientKey: document.clientKey,
    annualYear,
    clientName: document.clientName || clientData.basic?.clientLegalName || clientData.basic?.tradeName || 'Untitled client',
    piboCategory: document.piboCategory || clientData.basic?.piboCategory || '',
    eprCategory: document.eprCategory || clientData.basic?.eprCategory || '',
    currentSpoc: filing.annual?.currentSpoc || document.currentSpoc || '',
    previousSpoc: filing.annual?.previousSpoc || document.previousSpoc || '',
    status: filing.status || 'draft',
    activeTab: filing.activeTab || '',
    activeSection: filing.activeSection || '',
    draft: filing.draft || {},
    basicInfo: filing.basicInfo || {},
    financials: filing.financials || {},
    data: filing.data || {},
    brandOwner: filing.brandOwner || {},
    importer: filing.importer || {},
    annual: filing.annual || {},
    approvalWorkflow: filing.approvalWorkflow || {},
    clientData,
    adminControls: document.adminControls || client?.adminControls || {},
    savedAt: filing.savedAt || document.savedAt || document.updatedAt,
    updatedAt: filing.savedAt || document.updatedAt || document.savedAt,
    updatedBy: document.updatedBy
  };
}

function expandAnnualReturnDocument(document = {}) {
  const rows = [];
  const filings = document.filings && typeof document.filings === 'object' && !Array.isArray(document.filings)
    ? document.filings
    : {};

  Object.entries(filings).forEach(([annualYear, filing]) => {
    if (!annualYear || !filing || typeof filing !== 'object' || Array.isArray(filing)) return;
    rows.push(mapAnnualReturnDocumentFiling(document, annualYear, filing));
  });

  if (!rows.length && document.annualYear) {
    rows.push(mapAnnualReturnDocumentFiling(document, document.annualYear, {
      annualYear: document.annualYear,
      status: document.status,
      activeTab: document.activeTab,
      activeSection: document.activeSection,
      draft: document.draft,
      basicInfo: document.basicInfo,
      financials: document.financials,
      data: document.data,
      brandOwner: document.brandOwner,
      importer: document.importer,
      annual: document.annual,
      approvalWorkflow: document.approvalWorkflow,
      savedAt: document.savedAt
    }));
  }

  return rows;
}

function readWorkflowStage(workflow = {}) {
  const currentStage = String(workflow.currentStage || '').toLowerCase();
  const status = String(workflow.status || '').toLowerCase();
  if (currentStage === 'complete' || status === 'compliance_approved') return 4;
  if (currentStage === 'compliance' || status === 'compliance_pending') return 3;
  if (currentStage === 'manager' || status === 'manager_pending' || status === 'compliance_rejected') return 2;
  return 1;
}

function countReviewedWorkflowParts(workflow = {}) {
  const sections = workflow?.sections && typeof workflow.sections === 'object' && !Array.isArray(workflow.sections)
    ? workflow.sections
    : {};
  const reviewedParts = new Set();

  Object.entries(sections).forEach(([title, meta]) => {
    const part = String(title || '').trim().match(/^Part\s+([A-Z])/i)?.[1]?.toUpperCase();
    if (!part) return;
    const managerStatus = String(meta?.managerStatus || meta?.status || '').trim().toLowerCase();
    const complianceStatus = String(meta?.complianceStatus || '').trim().toLowerCase();
    if (['approved', 'rejected'].includes(managerStatus) || ['approved', 'rejected'].includes(complianceStatus)) {
      reviewedParts.add(part);
    }
  });

  return reviewedParts.size;
}

function workflowUpdatedAt(row = {}) {
  const workflow = row.approvalWorkflow || {};
  const sectionTimes = Object.values(workflow.sections || {})
    .map((meta) => Date.parse(meta?.updatedAt || meta?.managerReviewedAt || meta?.complianceReviewedAt || ''))
    .filter(Number.isFinite);
  const historyTimes = Array.isArray(workflow.history)
    ? workflow.history.map((item) => Date.parse(item?.at || '')).filter(Number.isFinite)
    : [];
  return Math.max(
    Date.parse(workflow.updatedAt || '') || 0,
    Date.parse(row.updatedAt || row.savedAt || '') || 0,
    ...sectionTimes,
    ...historyTimes,
    0
  );
}

function shouldUseClientFiling(existing = {}, candidate = {}) {
  const existingWorkflow = existing.approvalWorkflow || {};
  const candidateWorkflow = candidate.approvalWorkflow || {};
  const existingStage = readWorkflowStage(existingWorkflow);
  const candidateStage = readWorkflowStage(candidateWorkflow);
  if (candidateStage !== existingStage) return candidateStage > existingStage;

  const existingReviewed = countReviewedWorkflowParts(existingWorkflow);
  const candidateReviewed = countReviewedWorkflowParts(candidateWorkflow);
  if (candidateReviewed !== existingReviewed) return candidateReviewed > existingReviewed;

  return workflowUpdatedAt(candidate) > workflowUpdatedAt(existing);
}

exports.listAnnualReturns = async (req, res) => {
  const dashboard = req.query.dashboard === 'true';
  const dashboardClientFields = 'data.basic data.importMeta data.selectedLeadSnapshot data.financials adminControls';
  const scope = await getVisibleUserScope(req.user);
  const accessFilter = ownerFilter(scope, 'createdBy', 'adminControls.assignedTo', [
    'data.importMeta.assignedTo', 'data.importMeta.user', 'data.importMeta.userName',
    'data.importMeta.createdBy', 'data.importMeta.createdByEmail'
  ]);
  const testLeadReferences = req.query.dashboard === 'true'
    ? await getAdminCreatedLeadReferences()
    : null;
  const clientFilter = combineFilters(
    accessFilter,
    testLeadReferences ? dashboardClientExclusionFilter(testLeadReferences) : {}
  );
  const visibleClients = await Client.find(clientFilter).select('_id').lean();
  const visibleClientIds = visibleClients.map((client) => client._id);
  const annualReturns = await AnnualReturn.find(
    scope === null && req.query.dashboard !== 'true' ? {} : { client: { $in: visibleClientIds } }
  )
    .select(dashboard ? '-clientData.companyOverview -clientData.compliance -clientData.cpcbScreenshots -clientData.processDiagrams -clientData.cte -clientData.msmeRows -clientData.authorisedPersons -clientData.annualReturn' : '')
    .populate('client', dashboard ? dashboardClientFields : 'data adminControls')
    .populate('updatedBy', 'name email role')
    .sort({ updatedAt: -1 })
    .lean();
  const index = new Map();
  annualReturns.forEach((document) => {
    expandAnnualReturnDocument(document).forEach((row) => {
      index.set(`${row.clientKey}:${row.annualYear}`, row);
    });
  });

  const clients = await Client.find({ $and: [{ 'data.annualReturn.filings': { $exists: true } }, clientFilter] })
    .select(dashboard ? `${dashboardClientFields} data.annualReturn.filings data.annualReturn.lastSavedAt updatedAt` : 'data adminControls updatedAt')
    .lean();
  clients.forEach((client) => {
    const filings = client.data?.annualReturn?.filings || {};
    Object.entries(filings).forEach(([annualYear, filing]) => {
      const row = mapClientFiling(client, annualYear, filing);
      const key = `${row.clientKey}:${row.annualYear}`;
      if (!index.has(key) || shouldUseClientFiling(index.get(key), row)) index.set(key, row);
    });
  });

  if (dashboard) for (const row of index.values()) {
    if (row.clientData?.annualReturn) { const { annualReturn, ...clientData } = row.clientData; row.clientData = clientData; }
  }
  const mergedRows = [...index.values()].sort((a, b) => new Date(b.updatedAt || b.savedAt || 0) - new Date(a.updatedAt || a.savedAt || 0));
  res.json({ ok: true, annualReturns: mergedRows });
};
