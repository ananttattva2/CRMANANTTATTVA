const { mergeManagerStaffAllocations } = require('./managerStaffAllocations');
const { normalizeYear } = require('./overallDashboard');

const CATEGORY_ORDER = ['Plastic Waste', 'E-Waste', 'Tyre Waste', 'Used Oil', 'Battery Waste'];
const text = value => String(value?._id || value?.id || value || '').trim();
const key = value => text(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
const array = value => Array.isArray(value) ? value : [];
const list = value => (Array.isArray(value) ? value : [value]).flatMap(item => String(item || '').split(/[,;\n]/)).map(item => item.trim()).filter(Boolean);
const isAnnual = value => list(value).some(item => /annual(?:return(?:fill?ing)?|fill?ing)/.test(key(item)));

function clientMasterUniqueId(value) {
  const saved = text(value);
  const match = saved.match(/^ATPL(?:-LEAD)?-(\d+)$/i);
  return match ? `ATPL-${match[1].padStart(4, '0')}` : saved || '-';
}

function statusFrom(scope = {}) {
  return text(scope?.cpcb?.status || scope?.cpcb?.approvalStatus || scope?.cpcb?.applicationStatus
    || scope?.status || scope?.approvalStatus || scope?.applicationStatus);
}

function assignedServiceCpcbStatus(client, serviceId) {
  const data = client?.data || {};
  const scoped = statusFrom(data.serviceDetailsByAssignedServiceId?.[serviceId])
    || statusFrom(data.cpcbDataByAssignedServiceId?.[serviceId]);
  const root = statusFrom(data.cpcb)
    || text(data.basic?.cpcbStatus || data.importMeta?.cpcbStatus);
  const scopedKey = key(scoped);
  return (!scopedKey || ['notstarted', 'notrecorded', 'pending'].includes(scopedKey))
    && root && !['notstarted', 'notrecorded', 'pending'].includes(key(root))
    ? root : scoped || root;
}

function isApprovedApplication(client, serviceId) {
  return /approved|registered|processed|annualreturnapplicable/.test(key(assignedServiceCpcbStatus(client, serviceId)));
}

function isOperationsStaff(user = {}) {
  if (user.isActive === false || user.isActive === 0 || ['false', '0', 'inactive'].includes(key(user.isActive))) return false;
  const roles = [user.role, ...array(user.roles)].map(key);
  return roles.some(role => /^(operation|operations|operationsexecutive|manager)$/.test(role));
}

function hasPoEvidence(row = {}) {
  return [row.poNumber, row.poNo, row.poDate, row.poReceivedDate, row.poFileName, row.fileName, row.poFileUrl]
    .some(value => Boolean(text(value)));
}

function applicationAnnualYears(assignment, poRows) {
  const received = key(assignment?.poStatus) === 'received' || poRows.some(hasPoEvidence);
  if (!received) return [];
  const eligibleRows = poRows.filter(row => !list(row?.services).length || isAnnual(row.services));
  const saved = yearsFrom(...eligibleRows.map(row => row?.annualReturnYear));
  return saved.sort((left, right) => Number(left.slice(0, 4)) - Number(right.slice(0, 4))).slice(0, 1);
}

function normalizedCompanyKey(lead, company) {
  return key(lead?.companyIdentity || company) || key(lead?._id || lead?.id || company);
}

function annualServiceName(...values) {
  const saved = values.flatMap(list).find(item => isAnnual(item));
  if (!saved) return '';
  return /fill?ing/.test(key(saved)) ? 'Annual Return Filling' : 'Annual Return';
}

function categoryName(value) {
  const normalized = key(value);
  if (normalized.includes('plastic')) return 'Plastic Waste';
  if (normalized.includes('ewaste') || normalized.includes('electronic')) return 'E-Waste';
  if (normalized.includes('tyre') || normalized.includes('tire')) return 'Tyre Waste';
  if (normalized.includes('usedoil') || normalized.includes('wasteoil')) return 'Used Oil';
  if (normalized.includes('battery')) return 'Battery Waste';
  return '';
}

function yearsFrom(...values) {
  return [...new Set(values.flatMap(list).map(normalizeYear).filter(Boolean))];
}

function isoDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
}

function workflowState(filing = {}) {
  const workflow = filing.approvalWorkflow || {};
  const status = key(workflow.status || filing.status);
  const stage = key(workflow.currentStage);
  if (stage === 'complete' || ['complianceapproved', 'approved', 'completed', 'filed'].includes(status)) return { status: 'Completed', progress: 100 };
  if (stage === 'compliance' || status === 'compliancepending') return { status: 'In Progress', progress: 75 };
  if (stage === 'manager' || ['managerpending', 'compliancerejected'].includes(status)) return { status: 'In Progress', progress: 50 };
  const hasActivity = Boolean(filing.savedAt || filing.updatedAt || Object.keys(filing.draft || {}).length || Object.keys(workflow.sections || {}).length);
  return hasActivity && status !== 'draft' ? { status: 'In Progress', progress: 25 } : { status: 'Pending', progress: hasActivity ? 25 : 0 };
}

function ownerIndex(users = []) {
  const index = new Map();
  array(users).forEach(user => [user?._id, user?.id, user?.crmUserId, user?.email, user?.name].filter(Boolean).forEach(value => index.set(key(value), user)));
  return index;
}

function findOwner(index, ...values) {
  return values.map(value => index.get(key(value))).find(Boolean) || null;
}

function filingIndex(documents = [], clients = []) {
  const index = new Map();
  const add = (clientId, year, filing) => {
    const normalizedYear = normalizeYear(year);
    if (!clientId || !normalizedYear || !filing) return;
    const compound = `${text(clientId)}:${normalizedYear}`;
    const previous = index.get(compound);
    const time = value => new Date(value?.savedAt || value?.updatedAt || 0).getTime() || 0;
    if (!previous || time(filing) >= time(previous)) index.set(compound, filing);
  };
  array(documents).forEach(document => {
    Object.entries(document.filings || {}).forEach(([year, filing]) => add(document.client || document.clientKey, year, filing));
    if (document.annualYear) add(document.client || document.clientKey, document.annualYear, document);
  });
  array(clients).forEach(client => Object.entries(client?.data?.annualReturn?.filings || {}).forEach(([year, filing]) => add(client._id, year, filing)));
  return index;
}

function buildRecords({ clients = [], users = [], filings = new Map(), teams = [] }) {
  const operationsUsers = array(users).filter(isOperationsStaff);
  const usersByIdentity = ownerIndex(operationsUsers);
  const usersById = new Map(operationsUsers.map(user => [text(user), user]));
  const teamsById = new Map(array(teams).map(team => [text(team), team?.name || 'Team']));
  const records = new Map();
  for (const client of mergeManagerStaffAllocations(array(clients), [])) {
    try {
    const lead = client.selectedLead || client.data?.selectedLeadSnapshot || {};
    const services = array(lead.serviceSelections).filter(service => service && typeof service === 'object');
    const selectedId = text(client.assignedServiceId || client.data?.assignedServiceId || client.data?.selectedLeadSnapshot?.assignedServiceId);
    let serviceIndex = services.findIndex(service => text(service.assignedServiceId || service.serviceAssignmentId) === selectedId);
    if (serviceIndex < 0 && services.length === 1) serviceIndex = 0;
    const service = services[serviceIndex] || {};
    const assignments = array(lead.assignments).filter(assignment => assignment && typeof assignment === 'object');
    const preliminaryAssignment = assignments.find(row => text(row.assignedServiceId || row.serviceAssignmentId) === text(service.assignedServiceId || service.serviceAssignmentId || selectedId)) || assignments[serviceIndex] || {};
    const selectedOffering = service.servicesOffered ?? service.applicableService;
    const assignmentOffering = preliminaryAssignment.servicesOffered ?? preliminaryAssignment.applicableService;
    const legacyOffering = [lead.servicesOffered, lead.applicableService, client.data?.basic?.servicesOffered, client.data?.basic?.applicableService,
      client.data?.selectedLeadSnapshot?.servicesOffered, client.data?.selectedLeadSnapshot?.applicableService].find(value => list(value).length) || [];
    const offered = Object.keys(service).length ? (list(selectedOffering).length ? selectedOffering : assignmentOffering ?? []) : legacyOffering;
    const serviceName = annualServiceName(offered);
    if (!serviceName) continue;
    const category = categoryName(service.eprCategory || lead.eprCategory || client.data?.basic?.eprCategory);
    if (!category) continue;
    const assignment = preliminaryAssignment;
    const serviceId = text(service.assignedServiceId || service.serviceAssignmentId || assignment.assignedServiceId || assignment.serviceAssignmentId || selectedId || `service-${serviceIndex}`);
    const poRows = [...array(assignment.poYearRows), ...(assignment.originalPoDetails && typeof assignment.originalPoDetails === 'object' ? [assignment.originalPoDetails] : [])]
      .filter(row => row && typeof row === 'object');
    const workflowReady = Boolean(assignment.assignedTo || assignment.assignedToText || assignment.assignedToEmail)
      && Boolean(assignment.assignedStaff || assignment.assignedStaffText || assignment.assignedStaffEmail);
    const closed = Boolean(assignment.closedAt || assignment.closedBy || assignment.closedByText || assignment.permanentClosedAt
      || (services.length === 1 && (lead.closedAt || lead.closedBy || lead.closedByText)) || key(lead.status) === 'closed');
    const clientStatus = key(client.workflowStatus || client.data?.importMeta?.clientStatus);
    const years = applicationAnnualYears(assignment, poRows);
    if (clientStatus === 'draft' || !closed || !workflowReady || !isApprovedApplication(client, serviceId) || !years.length) continue;
    const owner = findOwner(usersByIdentity, assignment.assignedStaff, assignment.assignedStaffEmail, assignment.assignedStaffText, lead.assignedStaff, lead.assignedStaffEmail, lead.assignedStaffText);
    if (!owner) continue;
    const manager = owner ? usersById.get(text(owner.managerId)) : null;
    const team = owner?.teamId ? teamsById.get(text(owner.teamId)) : '';
    const applicantType = text(service.piboParent || service.piboCategoryParent || service.applicantType || lead.piboParent || lead.applicantType || 'Not specified');
    const subType = text(service.subApplicantType || service.piboCategory || (key(applicantType) === key(service.applicantType) ? '' : service.applicantType) || lead.subApplicantType || lead.piboCategory || 'Not specified');
    const clientId = client.assignmentOnly ? text(client.statusSourceClientId) : text(client._id);
    const company = text(lead.company || lead.companyName || client.data?.basic?.clientLegalName || client.data?.basic?.tradeName || 'Untitled client');
    const leadId = text(lead.leadCode || lead.sourceLeadId || client.data?.importMeta?.leadNumber || '-');
    const uniqueId = clientMasterUniqueId(client.data?.importMeta?.uniqueId || client.uniqueId || client.data?.importMeta?.leadNumber);
    const dueDate = isoDate(service.dueDate || service.serviceEndDate || poRows.map(row => row.poEndDate).filter(Boolean).sort().at(0));
    const unit = text(service.plantUnit || lead.plantUnit || client.data?.basic?.plantUnit || 'Not specified');
    const recordKey = [owner ? text(owner) : key(assignment.assignedStaffText || assignment.assignedStaffEmail), normalizedCompanyKey(lead, company), key(subType), key(unit), 'annualreturn'].join(':');
    const yearStates = Object.fromEntries(years.map(year => {
      const filing = clientId && typeof filings?.get === 'function' ? filings.get(`${clientId}:${year}`) : null;
      return [year, workflowState(filing)];
    }));
    const nextRecord = {
      id: recordKey, clientId, company, uniqueId, leadId, category, applicantType, subType, serviceName, years,
      assignedUserId: owner ? text(owner) : '', assignedUser: owner?.name || owner?.email || assignment.assignedStaffText || 'Unassigned',
      teamId: owner?.teamId ? text(owner.teamId) : '', team: team || manager?.name || manager?.email || 'No team assigned',
      managerId: manager ? text(manager) : '', dueDate, yearStates,
      openPath: clientId ? `/sales/client-data-processing/${encodeURIComponent(clientId)}/{year}` : `/sales/client-master?search=${encodeURIComponent(leadId)}`
    };
    const existing = records.get(recordKey);
    if (!existing) records.set(recordKey, nextRecord);
    else {
      existing.years = [...new Set([...existing.years, ...nextRecord.years])].sort();
      existing.yearStates = { ...existing.yearStates, ...nextRecord.yearStates };
      if (existing.serviceName !== 'Annual Return Filling' && nextRecord.serviceName === 'Annual Return Filling') existing.serviceName = nextRecord.serviceName;
    }
    } catch (error) {
      console.warn('[annual-return-operations-dashboard] skipped malformed assignment record', {
        clientId: text(client?._id), name: error.name, message: error.message
      });
    }
  }
  return [...records.values()];
}

function decorate(records, year, now = new Date()) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const soon = new Date(today); soon.setDate(soon.getDate() + 7);
  return array(records).flatMap(record => {
    const recordYears = array(record?.years);
    const selectedYear = normalizeYear(year) || recordYears[recordYears.length - 1];
    if (!recordYears.includes(selectedYear)) return [];
    const state = record.yearStates[selectedYear] || { status: 'Pending', progress: 0 };
    const due = record.dueDate ? new Date(`${record.dueDate}T00:00:00`) : null;
    const incomplete = state.status !== 'Completed';
    const overdue = Boolean(incomplete && due && due < today);
    const dueSoon = Boolean(incomplete && due && due >= today && due <= soon);
    return [{ ...record, annualReturnYear: selectedYear, ...state, overdue, dueSoon, openPath: record.openPath.replace('{year}', encodeURIComponent(selectedYear)) }];
  });
}

function applyFilters(records, query = {}, omit = []) {
  const ignored = new Set(omit);
  const search = text(query.search).toLowerCase();
  const status = text(query.status).toLowerCase();
  return array(records).filter(record => {
    if (!ignored.has('user') && query.user && record.assignedUserId !== query.user) return false;
    if (!ignored.has('team') && query.team && ![record.teamId, record.managerId, record.team].includes(query.team)) return false;
    if (!ignored.has('category') && query.category && record.category !== query.category) return false;
    if (!ignored.has('applicantType') && query.applicantType && record.applicantType !== query.applicantType) return false;
    if (!ignored.has('subType') && query.subType && record.subType !== query.subType) return false;
    if (!ignored.has('status') && status && !(status === 'overdue' ? record.overdue : status === 'due soon' ? record.dueSoon : record.status.toLowerCase() === status)) return false;
    if (!ignored.has('due') && query.dueFrom && (!record.dueDate || record.dueDate < query.dueFrom)) return false;
    if (!ignored.has('due') && query.dueTo && (!record.dueDate || record.dueDate > query.dueTo)) return false;
    if (search && ![record.company, record.uniqueId, record.leadId, record.assignedUser].join(' ').toLowerCase().includes(search)) return false;
    return true;
  });
}

function aggregate(records, field) {
  const groups = new Map();
  array(records).forEach(record => {
    const label = record[field] || 'Not specified';
    const row = groups.get(label) || { label, count: 0, completed: 0, inProgress: 0, pending: 0, overdue: 0, serviceNames: {} };
    row.count += 1;
    if (record.status === 'Completed') row.completed += 1;
    else if (record.status === 'In Progress') row.inProgress += 1;
    else row.pending += 1;
    if (record.overdue) row.overdue += 1;
    const serviceName = record.serviceName || 'Annual Return';
    row.serviceNames[serviceName] = (row.serviceNames[serviceName] || 0) + 1;
    groups.set(label, row);
  });
  return [...groups.values()].map(row => ({
    ...row,
    serviceBreakdown: ['Annual Return', 'Annual Return Filling'].map(label => ({ label, count: row.serviceNames[label] || 0 })),
    completion: row.count ? Math.round((row.completed / row.count) * 1000) / 10 : 0
  }));
}

function summary(records) {
  records = array(records);
  const total = records.length;
  const completed = records.filter(row => row?.status === 'Completed').length;
  const inProgress = records.filter(row => row?.status === 'In Progress').length;
  const pending = records.filter(row => row?.status === 'Pending').length;
  const overdue = records.filter(row => row?.overdue).length;
  const dueSoon = records.filter(row => row?.dueSoon).length;
  return { total, completed, inProgress, pending, overdue, dueSoon, completion: total ? Math.round((completed / total) * 1000) / 10 : 0 };
}

function previousYear(year) {
  const normalized = normalizeYear(year);
  if (!normalized) return '';
  const start = Number(normalized.slice(0, 4)) - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

// Annual Returns filed during a financial year report the immediately
// preceding financial year. FY 2026-27 reports AR 2025-26; after 1 April
// 2027 the active AR year becomes 2026-27 automatically.
function activeAnnualReturnYear(now = new Date()) {
  const date = new Date(now);
  const currentFinancialYearStart = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  const reportingStart = currentFinancialYearStart - 1;
  return `${reportingStart}-${String(reportingStart + 1).slice(-2)}`;
}

function yearStart(year) {
  const normalized = normalizeYear(year);
  return normalized ? Number(normalized.slice(0, 4)) : Number.NEGATIVE_INFINITY;
}

function buildDashboard(records, query = {}) {
  records = array(records);
  const activeYear = activeAnnualReturnYear();
  const activeStart = yearStart(activeYear);
  const observedYears = records.flatMap(record => array(record.years)).map(normalizeYear).filter(year => year && yearStart(year) <= activeStart);
  const requestedYear = normalizeYear(query.year);
  const selectedYear = requestedYear && yearStart(requestedYear) <= activeStart ? requestedYear : activeYear;
  const years = [...new Set([activeYear, ...observedYears, ...(requestedYear && yearStart(requestedYear) <= activeStart ? [requestedYear] : [])])]
    .sort((a, b) => yearStart(b) - yearStart(a));
  const decorated = decorate(records, selectedYear);
  const matching = applyFilters(decorated, query);
  const categoryBase = applyFilters(decorated, query, ['category', 'applicantType', 'subType']);
  const applicantBase = applyFilters(decorated, query, ['applicantType', 'subType']);
  const subTypeBase = applyFilters(decorated, query, ['subType']);
  const workloadBase = applyFilters(decorated, query, ['user']);
  const categoryRows = aggregate(categoryBase, 'category');
  const categories = CATEGORY_ORDER.map(label => categoryRows.find(row => row.label === label) || { label, count: 0, completed: 0, inProgress: 0, pending: 0, overdue: 0, completion: 0, serviceBreakdown: [{ label: 'Annual Return', count: 0 }, { label: 'Annual Return Filling', count: 0 }] });
  const applicantTypes = aggregate(applicantBase, 'applicantType').sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const subTypes = aggregate(subTypeBase, 'subType').sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const workloads = aggregate(workloadBase, 'assignedUser').map(row => ({ ...row, userId: workloadBase.find(item => item.assignedUser === row.label)?.assignedUserId || '' })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const currentSummary = summary(matching);
  const priorYear = previousYear(selectedYear);
  const previous = priorYear ? summary(applyFilters(decorate(records, priorYear), { ...query, year: priorYear })) : null;
  const comparisons = previous && previous.total ? Object.fromEntries(['total', 'completed', 'inProgress', 'pending', 'overdue', 'dueSoon'].map(metric => [metric, { previous: previous[metric], change: previous[metric] ? Math.round(((currentSummary[metric] - previous[metric]) / previous[metric]) * 1000) / 10 : null }])) : {};
  const sortBy = ['company', 'uniqueId', 'leadId', 'category', 'applicantType', 'subType', 'annualReturnYear', 'assignedUser', 'dueDate', 'status', 'progress'].includes(query.sortBy) ? query.sortBy : 'company';
  const direction = query.sortDir === 'desc' ? -1 : 1;
  const sorted = [...matching].sort((a, b) => String(a[sortBy] ?? '').localeCompare(String(b[sortBy] ?? ''), undefined, { numeric: true }) * direction);
  const limit = Math.min(100, Math.max(5, Number(query.limit) || 10));
  const page = Math.max(1, Number(query.page) || 1);
  const pages = Math.max(1, Math.ceil(sorted.length / limit));
  const pageRows = query.export === 'true' ? sorted : sorted.slice((Math.min(page, pages) - 1) * limit, Math.min(page, pages) * limit);
  const options = {
    years,
    users: [...new Map(records.filter(row => row.assignedUserId).map(row => [row.assignedUserId, { value: row.assignedUserId, label: row.assignedUser }])).values()].sort((a, b) => a.label.localeCompare(b.label)),
    teams: [...new Set(records.map(row => row.team).filter(Boolean))].sort().map(label => ({ value: label, label })),
    categories: CATEGORY_ORDER,
    applicantTypes: [...new Set(applicantBase.map(row => row.applicantType))].sort(),
    subTypes: [...new Set(subTypeBase.map(row => row.subType))].sort()
  };
  return { ok: true, selectedYear, summary: currentSummary, comparisons, categories, applicantTypes, subTypes, workloads, options, records: pageRows, pagination: { page: Math.min(page, pages), limit, total: sorted.length, pages } };
}

module.exports = { CATEGORY_ORDER, categoryName, isAnnual, annualServiceName, workflowState, activeAnnualReturnYear, buildRecords, buildDashboard, filingIndex };
