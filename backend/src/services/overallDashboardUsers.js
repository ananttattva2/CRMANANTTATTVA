const { buildOverall, normalizeYear } = require('./overallDashboard');
const { createOverallServiceVisibility } = require('./overallDashboardVisibility');
const { userHasAnyRole } = require('../utils/userRoles');

function eligibleOperationsUsers(users, teams = []) {
  const eligible = users.filter((user) => !userHasAnyRole(user, ['superadmin', 'sales'])
    && String(user.name || '').trim().toLowerCase().replace(/\s+/g, ' ') !== 'himanshu parashar');
  const operators = eligible.filter((user) => userHasAnyRole(user, ['operation', 'operations']));
  const operatorIds = new Set(operators.map((user) => String(user._id)));
  const operatorTeams = new Set(operators.map((user) => String(user.teamId || '')).filter(Boolean));
  const managerIds = new Set(operators.map((user) => String(user.managerId || '')).filter(Boolean));
  teams.forEach((team) => {
    if (operatorTeams.has(String(team._id)) || (team.members || []).some((id) => operatorIds.has(String(id)))) {
      if (team.manager) managerIds.add(String(team.manager));
    }
  });
  return eligible.filter((user) => operatorIds.has(String(user._id)) || (userHasAnyRole(user, ['manager']) && managerIds.has(String(user._id))));
}

const identity = (value) => {
  if (!value) return [];
  if (typeof value === 'object') return [value._id, value.id, value.userId, value.crmUserId, value.email, value.name]
    .map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean);
  return [String(value).trim().toLowerCase()].filter(Boolean);
};

function allocatedOwnerKeyGroups(client = {}) {
  const data = client.data && typeof client.data === 'object' ? client.data : {};
  const lead = client.selectedLead && typeof client.selectedLead === 'object'
    ? client.selectedLead
    : (data.selectedLeadSnapshot && typeof data.selectedLeadSnapshot === 'object' ? data.selectedLeadSnapshot : {});
  const serviceId = String(client.assignedServiceId || data.assignedServiceId || data.selectedLeadSnapshot?.assignedServiceId || '');
  const allAssignments = Array.isArray(lead.assignments) ? lead.assignments : [];
  let assignments = allAssignments.filter((assignment) => !serviceId || String(assignment?.assignedServiceId || assignment?.serviceAssignmentId || '') === serviceId);
  if (serviceId && !assignments.length) {
    const serviceIndex = (lead.serviceSelections || []).findIndex(service => String(service?.assignedServiceId || service?.serviceAssignmentId || '') === serviceId);
    const legacy = allAssignments.filter(assignment => !assignment?.assignedServiceId && !assignment?.serviceAssignmentId);
    const permanentOwners = new Set(legacy.map(assignment => String(assignment.assignedStaff || assignment.assignedStaffText || '').trim().toLowerCase()).filter(Boolean));
    if (serviceIndex >= 0 && allAssignments[serviceIndex] && !allAssignments[serviceIndex].assignedServiceId && !allAssignments[serviceIndex].serviceAssignmentId) assignments = [allAssignments[serviceIndex]];
    else if (permanentOwners.size === 1) assignments = legacy;
  }
  const admin = client.adminControls || data.adminControls || {};
  const importMeta = data.importMeta || {};
  const allocations = client.serviceAllocations || data.serviceAllocations || {};
  const allocationValues = Object.values(allocations).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return identity(entry);
    return [entry.userId, entry.userIdString, entry.user, entry.assignedTo, entry.assigneeId,
      entry.assignedUserId, entry._id, entry.id, entry.value, entry.userName, entry.email].flatMap(identity);
  });
  const permanent = [...new Set([
    lead.assignedStaff, lead.assignedStaffText, lead.assignedStaffEmail,
    client.assignedStaff, client.assignedStaffText, client.assignedStaffEmail,
    ...assignments.flatMap((assignment) => [assignment?.assignedStaff, assignment?.assignedStaffText, assignment?.assignedStaffEmail])
  ].flatMap(identity))];
  const fallback = [...new Set([
    admin.assignedTo, admin.assignedUser, admin.user, admin.userId, admin.managerId,
    importMeta.assignedTo, importMeta.user, importMeta.userName,
    client.assignedTo, client.assignedUser, client.userName, client.user,
    ...[lead, ...assignments].flatMap((owner) => [owner?.assignedTo, owner?.assignedToText, owner?.assignedToEmail]),
    ...allocationValues
  ].flatMap(identity))];
  return [permanent, fallback];
}

function allocatedFinancialYears(client = {}) {
  const data = client.data && typeof client.data === 'object' ? client.data : {};
  const lead = client.selectedLead && typeof client.selectedLead === 'object'
    ? client.selectedLead
    : (data.selectedLeadSnapshot && typeof data.selectedLeadSnapshot === 'object' ? data.selectedLeadSnapshot : {});
  const serviceId = String(client.assignedServiceId || data.assignedServiceId || data.selectedLeadSnapshot?.assignedServiceId || '');
  const services = Array.isArray(lead.serviceSelections) ? lead.serviceSelections : [];
  const assignments = Array.isArray(lead.assignments) ? lead.assignments : [];
  const serviceIndex = serviceId ? services.findIndex((row) => String(row?.assignedServiceId || row?.serviceAssignmentId || '') === serviceId) : -1;
  const service = serviceIndex >= 0 ? services[serviceIndex] : services[0] || {};
  const assignment = assignments.find((row) => serviceId && String(row?.assignedServiceId || row?.serviceAssignmentId || '') === serviceId)
    || (serviceIndex >= 0 ? assignments[serviceIndex] : assignments[0]) || {};
  const poYears = (assignment.poYearRows || []).map((row) => normalizeYear(row?.poFinancialYear || row?.fy)).filter(Boolean);
  if (poYears.length) return [...new Set(poYears)];
  return [...new Set([
    service.firstAnnualReturnYearApplicable, service.financialYear, service.servicesForYear,
    lead.firstAnnualReturnYearApplicable,
    data.selectedLeadSnapshot?.financialYear, data.selectedLeadSnapshot?.firstAnnualReturnYearApplicable,
    data.basic?.firstAnnualReturnYear, data.basic?.servicesForYear, data.firstAnnualReturnYearApplicable,
    client.firstAnnualReturnYear, client.financialYear
  ].map(normalizeYear).filter(Boolean))];
}

const hasPoValue = (value) => {
  if (Array.isArray(value)) return value.some(hasPoValue);
  if (value && typeof value === 'object') return Object.values(value).some(hasPoValue);
  return Boolean(String(value || '').trim());
};

function allocatedPoStatus(client = {}) {
  const data = client.data && typeof client.data === 'object' ? client.data : {};
  const lead = client.selectedLead && typeof client.selectedLead === 'object'
    ? client.selectedLead
    : (data.selectedLeadSnapshot && typeof data.selectedLeadSnapshot === 'object' ? data.selectedLeadSnapshot : {});
  const serviceId = String(client.assignedServiceId || data.assignedServiceId || data.selectedLeadSnapshot?.assignedServiceId || '');
  const services = Array.isArray(lead.serviceSelections) ? lead.serviceSelections : [];
  const assignments = Array.isArray(lead.assignments) ? lead.assignments : [];
  const serviceIndex = serviceId ? services.findIndex((row) => String(row?.assignedServiceId || row?.serviceAssignmentId || '') === serviceId) : -1;
  const assignment = assignments.find((row) => serviceId && String(row?.assignedServiceId || row?.serviceAssignmentId || '') === serviceId)
    || (serviceIndex >= 0 ? assignments[serviceIndex] : assignments[0]) || {};
  const rows = [...(assignment.poYearRows || []), ...(assignment.originalPoDetails ? [assignment.originalPoDetails] : [])];
  const receivedRows = rows.filter((row) => hasPoValue(row?.poNumber || row?.poNo || row?.poDate || row?.poReceivedDate || row?.poFileName || row?.fileName));
  const financials = data.financials || {};
  const validation = data.validation || {};
  const clientMasterPo = hasPoValue([
    financials.compliancePoNo, financials.poNo, financials.poNumber,
    financials.compliancePoDate, financials.poDate,
    financials.compliancePoFileName, financials.poFileName,
    validation.poNumber, validation.poNo, validation.poDate, validation.poFileName
  ]);
  const received = receivedRows.length > 0 || clientMasterPo;
  const rowYears = receivedRows.map((row) => normalizeYear(row?.poFinancialYear || row?.fy)).filter(Boolean);
  const clientYears = [financials.poFinancialYear, validation.poFinancialYear].map(normalizeYear).filter(Boolean);
  const years = [...new Set([...rowYears, ...clientYears])];
  return { received, years: years.length ? years : received ? allocatedFinancialYears(client) : [] };
}

function buildAllocatedClientStats(clients = [], users = [], teams = []) {
  const eligible = eligibleOperationsUsers(users, teams);
  const userKeys = eligible.map((user) => ({
    id: String(user._id),
    keys: new Set([user._id, user.id, user.userId, user.crmUserId, user.email, user.name].flatMap(identity))
  }));
  const stats = Object.fromEntries(userKeys.map((user) => [user.id, { total: 0, poReceived: 0, poPending: 0, byYear: {}, poReceivedByYear: {} }]));
  const seen = new Set();
  clients.forEach((client, index) => {
    const clientKey = String(client?._id || client?.id || `row-${index}`);
    if (seen.has(clientKey)) return;
    seen.add(clientKey);
    const owner = allocatedOwnerKeyGroups(client)
      .map((ownerKeys) => userKeys.find((user) => ownerKeys.some((key) => user.keys.has(key))))
      .find(Boolean);
    if (!owner) return;
    stats[owner.id].total += 1;
    const financialYears = allocatedFinancialYears(client);
    financialYears.forEach((year) => {
      stats[owner.id].byYear[year] = (stats[owner.id].byYear[year] || 0) + 1;
    });
    const po = allocatedPoStatus(client);
    if (po.received) stats[owner.id].poReceived += 1;
    po.years.forEach((year) => {
      stats[owner.id].poReceivedByYear[year] = (stats[owner.id].poReceivedByYear[year] || 0) + 1;
    });
  });
  Object.values(stats).forEach((row) => { row.poPending = Math.max(0, row.total - row.poReceived); });
  return stats;
}

function buildAllocatedClientCounts(clients = [], users = [], teams = []) {
  return Object.fromEntries(Object.entries(buildAllocatedClientStats(clients, users, teams)).map(([id, stats]) => [id, stats.total]));
}

// Users are already restricted to the requester's authorized scope by the controller.
// Apply the same service ownership rules as the main dashboard, never lead-wide totals.
function buildUserSections(records, deactivations, users, teams = [], allocatedClients = []) {
  const allocatedStats = buildAllocatedClientStats(allocatedClients, users, teams);
  return eligibleOperationsUsers(users, teams).map((user) => {
    const id = String(user._id);
    const scope = { ids: [id], identities: [id, user.crmUserId, user.name, user.email].filter(Boolean) };
    const matches = createOverallServiceVisibility(scope);
    const owned = records.filter((record) => (record.owners || []).some((owner) => matches({}, {
      createdBy: owner.id, createdByCrmUserId: owner.crmId, createdByName: owner.name, createdByEmail: owner.email
    }, {})));
    const ownedClientCount = new Set(owned.map((record) => String(record.companyIdentity || record.clientName || record.leadId || '').trim().toLowerCase()).filter(Boolean)).size;
    return {
      userId: id,
      userName: user.name || user.email || 'Unnamed user',
      role: user.role,
      allocatedClients: Math.max(allocatedStats[id]?.total || 0, ownedClientCount),
      allocatedClientsByYear: allocatedStats[id]?.byYear || {},
      poReceivedClients: allocatedStats[id]?.poReceived || 0,
      poPendingClients: allocatedStats[id]?.poPending || 0,
      poReceivedClientsByYear: allocatedStats[id]?.poReceivedByYear || {},
      yearSections: buildOverall(owned, deactivations).yearSections
    };
  });
}
module.exports = { allocatedOwnerKeyGroups, buildUserSections, eligibleOperationsUsers, buildAllocatedClientCounts, buildAllocatedClientStats };
