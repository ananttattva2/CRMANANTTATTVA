const { mergeManagerStaffAllocations, dashboardStatusClient } = require('../services/managerStaffAllocations');
const Client = require('../models/Client');
const Lead = require('../models/Lead');
const PurchaseData = require('../models/PurchaseData');
const Quotation = require('../models/Quotation');
const SalesData = require('../models/SalesData');
const User = require('../models/User');
const { loadPurchaseOrders } = require('./purchaseOrderController');
const { getVisibleUserScope, ownerFilter } = require('../utils/visibilityScope');
const { loadOverallRecords } = require('../services/overallDashboardData');
const { loadDashboardAssignments, createDashboardCache } = require('../services/dashboardReadModel');
const cachedOverallRecords = createDashboardCache();
const cachedAssignmentReviews = createDashboardCache();
const cachedMonthlyPurchaseOrders = createDashboardCache();
const { overallLeadFilter } = require('../services/overallDashboardVisibility');
const { userHasAnyRole } = require('../utils/userRoles');
const {
  getAdminCreatedLeadReferences,
  getAssignmentDashboardLeadReferences,
  dashboardLeadExclusionFilter,
  dashboardClientExclusionFilter
} = require('../services/dashboardTestLeadExclusion');

function combineFilters(...filters) {
  const active = filters.filter((filter) => filter && Object.keys(filter).length);
  return active.length > 1 ? { $and: active } : active[0] || {};
}

const text = (value) => String(value?._id || value?.id || value || '').trim();

function countBy(rows, key) {
  const totals = new Map();
  rows.forEach((row) => {
    const value = String(row[key] || 'Not specified').trim() || 'Not specified';
    totals.set(value, (totals.get(value) || 0) + 1);
  });
  return [...totals.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

async function visibleUsers(scope, requester) {
  const filter = scope === null ? { isActive: { $ne: false } } : { _id: { $in: scope.ids }, isActive: { $ne: false } };
  const users = await User.find(filter).select('_id crmUserId name email role roles managerId teamId').sort({ name: 1 }).maxTimeMS(10000).lean();
  if (!users.length && requester?._id) return [{ _id: requester._id, name: requester.name, email: requester.email, role: requester.role }];
  return users;
}

exports.purchaseOrders = async (req, res) => {
  try {
  const monthly = req.query?.view === 'monthly';
  const scope = await getVisibleUserScope(req.user);
  const accessFilter = ownerFilter(scope, 'createdBy', 'assignedTo', [
    'createdByCrmUserId', 'createdByEmail', 'createdByName', 'assignedToText',
    'assignedStaffText', 'assignedStaffEmail', 'assignments.assignedToText',
    'assignments.assignedToEmail', 'serviceSelections.createdByCrmUserId',
    'serviceSelections.createdByEmail', 'serviceSelections.createdByName',
    ...(monthly ? ['generatedForName', 'generatedForEmail', 'createdOnBehalfOfName', 'createdOnBehalfOfEmail'] : [])
  ], ['assignedStaff', 'assignments.assignedTo', 'assignments.assignedStaff', ...(monthly ? ['generatedForUser', 'createdOnBehalfOfUser'] : [])]);
  const testLeadReferences = await getAdminCreatedLeadReferences();
  const leadFilter = combineFilters(accessFilter, dashboardLeadExclusionFilter(testLeadReferences));
  const [loadedRecords, users] = await Promise.all([
    monthly
      ? cachedMonthlyPurchaseOrders(JSON.stringify(leadFilter), () => loadPurchaseOrders({ Lead, Client, Quotation, User }, leadFilter, { monthly: true }))
      : loadPurchaseOrders({ Lead, Client, Quotation }, leadFilter),
    monthly ? Promise.resolve([]) : visibleUsers(scope, req.user)
  ]);
  const allowedIds = new Set((scope?.ids || []).map(text));
  const allowedIdentities = new Set((scope?.identities || []).map((value) => String(value).trim().toLowerCase()));
  const records = scope === null ? loadedRecords : loadedRecords.filter((record) => (
    allowedIds.has(text(record.ownerId)) || allowedIdentities.has(String(record.ownerName || '').trim().toLowerCase())
    || (monthly && (allowedIds.has(text(record.leadOwnerId)) || allowedIdentities.has(String(record.leadOwnerName || '').trim().toLowerCase())))
  ));
  if (req.query?.view === 'monthly') {
    return res.json({
      ok: true,
      scope: scope === null ? 'all' : 'role-scoped',
      records: records.map(({ id, leadId, clientId, clientName, leadOwnerId, leadOwnerName, poNumber, poDate, poAmount, approvalStatus, applicantType, subApplicantType }) => ({
        id, leadId, clientId, clientName, ownerId: leadOwnerId || null, ownerName: leadOwnerName || 'Unassigned', poNumber, poDate, poAmount, approvalStatus, applicantType, subApplicantType
      }))
    });
  }
  const userMap = new Map(users.map((user) => [text(user), user]));
  const grouped = new Map(users.map((user) => [text(user), { userId: text(user), userName: user.name || user.email, role: user.role || '', clientIds: new Set(), total: 0, open: 0, closed: 0, amount: 0 }]));
  records.forEach((record) => {
    const ownerId = text(record.ownerId);
    if (!grouped.has(ownerId)) grouped.set(ownerId || 'unassigned', { userId: ownerId, userName: record.ownerName || 'Unassigned', role: userMap.get(ownerId)?.role || '', clientIds: new Set(), total: 0, open: 0, closed: 0, amount: 0 });
    const row = grouped.get(ownerId || 'unassigned');
    row.clientIds.add(record.clientId || record.leadId);
    row.total += 1;
    row.amount += Number(record.poAmount) || 0;
    if (record.approvalStatus === 'APPROVED') row.closed += 1;
    else row.open += 1;
  });
  const userRows = [...grouped.values()].map(({ clientIds, ...row }) => ({ ...row, clients: clientIds.size })).filter((row) => row.total || row.clients);
  return res.json({
    ok: true,
    scope: scope === null ? 'all' : 'role-scoped',
    summary: {
      total: records.length,
      open: records.filter((row) => row.approvalStatus !== 'APPROVED').length,
      closed: records.filter((row) => row.approvalStatus === 'APPROVED').length,
      clients: new Set(records.map((row) => row.clientId || row.leadId)).size,
      amount: records.reduce((sum, row) => sum + (Number(row.poAmount) || 0), 0)
    },
    applicantTypes: countBy(records, 'applicantType'),
    subApplicantTypes: countBy(records, 'subApplicantType'),
    users: userRows.sort((a, b) => b.total - a.total || a.userName.localeCompare(b.userName)),
    records: records.sort((a, b) => new Date(b.poReceivedDate || 0) - new Date(a.poReceivedDate || 0))
  });
  } catch (error) {
    console.error('[purchase-order-dashboard] read failed', { name: error.name, code: error.code });
    return res.status(503).json({ ok: false, error: 'Purchase order data is temporarily unavailable. Please refresh and retry.' });
  }
};

exports.purchaseSales = async (req, res) => {
  const scope = await getVisibleUserScope(req.user);
  const accessFilter = ownerFilter(scope, 'createdBy', 'adminControls.assignedTo', [
    'data.importMeta.assignedTo', 'data.importMeta.user', 'data.importMeta.userName',
    'data.importMeta.createdBy', 'data.importMeta.createdByEmail'
  ]);
  const testLeadReferences = await getAdminCreatedLeadReferences();
  const clientFilter = combineFilters(accessFilter, dashboardClientExclusionFilter(testLeadReferences));
  const [clients, users] = await Promise.all([
    Client.find(clientFilter).select('_id createdBy adminControls.assignedTo data.basic.clientLegalName data.basic.tradeName data.importMeta.companyName').lean(),
    visibleUsers(scope, req.user)
  ]);
  const clientIds = clients.map((client) => client._id);
  const [purchases, sales] = await Promise.all([
    PurchaseData.find({ clientId: { $in: clientIds } }).select('clientId financialYear calculatedStatus managerVerificationStatus complianceVerificationStatus submittedBy createdBy updatedAt').lean(),
    SalesData.find({ clientId: { $in: clientIds } }).select('clientId financialYear calculatedStatus managerVerificationStatus complianceVerificationStatus submittedBy createdBy updatedAt').lean()
  ]);
  const purchaseByClient = new Map();
  const salesByClient = new Map();
  purchases.forEach((row) => purchaseByClient.set(text(row.clientId), [...(purchaseByClient.get(text(row.clientId)) || []), row]));
  sales.forEach((row) => salesByClient.set(text(row.clientId), [...(salesByClient.get(text(row.clientId)) || []), row]));
  const details = clients.map((client) => {
    const clientId = text(client);
    const purchaseRows = purchaseByClient.get(clientId) || [];
    const salesRows = salesByClient.get(clientId) || [];
    const ownerId = text(client.adminControls?.assignedTo || client.createdBy);
    return {
      clientId,
      clientName: client.data?.basic?.clientLegalName || client.data?.basic?.tradeName || client.data?.importMeta?.companyName || 'Untitled client',
      ownerId,
      purchaseCount: purchaseRows.length,
      salesCount: salesRows.length,
      purchaseStatus: purchaseRows[0]?.calculatedStatus || 'Not started',
      salesStatus: salesRows[0]?.calculatedStatus || 'Not started',
      financialYears: [...new Set([...purchaseRows, ...salesRows].map((row) => row.financialYear).filter(Boolean))]
    };
  });
  const userMap = new Map(users.map((user) => [text(user), user]));
  const grouped = new Map(users.map((user) => [text(user), { userId: text(user), userName: user.name || user.email, role: user.role || '', clients: 0, purchased: 0, sales: 0, complete: 0 }]));
  details.forEach((detail) => {
    if (!grouped.has(detail.ownerId)) grouped.set(detail.ownerId || 'unassigned', { userId: detail.ownerId, userName: userMap.get(detail.ownerId)?.name || 'Unassigned', role: userMap.get(detail.ownerId)?.role || '', clients: 0, purchased: 0, sales: 0, complete: 0 });
    const row = grouped.get(detail.ownerId || 'unassigned');
    row.clients += 1;
    row.purchased += detail.purchaseCount;
    row.sales += detail.salesCount;
    if (detail.purchaseCount && detail.salesCount) row.complete += 1;
  });
  return res.json({
    ok: true,
    scope: scope === null ? 'all' : 'role-scoped',
    summary: { clients: clients.length, purchased: purchases.length, sales: sales.length, complete: details.filter((row) => row.purchaseCount && row.salesCount).length },
    users: [...grouped.values()].filter((row) => row.clients || row.purchased || row.sales).sort((a, b) => b.clients - a.clients || a.userName.localeCompare(b.userName)),
    clients: details
  });
};

exports.overall = async (req, res) => {
  const startedAt = Date.now();
  try {
    const scope = await getVisibleUserScope(req.user);
    const testLeadReferences = await getAssignmentDashboardLeadReferences();
    const filter = combineFilters(
      overallLeadFilter(scope),
      dashboardLeadExclusionFilter(testLeadReferences)
    );
    const canViewUsers = userHasAnyRole(req.user, ['admin', 'superadmin', 'manager']);
    const allocatedClientFilter = canViewUsers ? await require('./clientController').clientAccessFilter(req.user) : {};
    const [records, requests, users, teams, snapshot] = await Promise.all([
      cachedOverallRecords(JSON.stringify({ filter, scope }), () => loadOverallRecords(Lead, filter, scope)),
      require('../models/ClientDeactivation').find({ status: 'INACTIVE' }).select('companyKey status').maxTimeMS(10000).lean(),
      canViewUsers ? visibleUsers(scope, req.user) : [],
      canViewUsers ? require('../models/Team').find(scope === null ? {} : { manager: { $in: scope.ids } }).select('_id manager members').maxTimeMS(10000).lean() : [],
      canViewUsers ? loadDashboardAssignments({ Client, Lead }, combineFilters(
        { 'data.importMeta.approvalOverride': { $ne: true } }, allocatedClientFilter,
        dashboardClientExclusionFilter(testLeadReferences)
      ), dashboardLeadExclusionFilter(testLeadReferences)) : { clients: [], leads: [] }
    ]);
    const allocatedClients = snapshot.clients;
    const staffLeads = snapshot.leads;
    res.set('Cache-Control', 'private, no-store');
    res.set('Server-Timing', `overall;dur=${Date.now() - startedAt}`);
    const visibility = scope === null ? 'all' : userHasAnyRole(req.user, ['manager']) ? 'team' : 'self';
    return res.json({ ...require('../services/overallDashboard').buildOverall(records, requests, req.query.financialYear), userSections: canViewUsers ? require('../services/overallDashboardUsers').buildUserSections(records, requests, users, teams, mergeManagerStaffAllocations(allocatedClients, staffLeads)) : [], canViewUsers, visibility });
  } catch (error) {
    console.error('[overall-dashboard] load failed', { durationMs: Date.now() - startedAt, name: error.name, code: error.code });
    return res.status(error.code === 50 ? 503 : 500).json({ error: 'Unable to load Overall Dashboard. Please refresh and retry.' });
  }
};

exports.uploadTracker = async (req, res) => {
  const startedAt = Date.now();
  try {
    const serviceType = String(req.query.serviceType || '').trim();
    if (serviceType && !['annual', 'registration'].includes(serviceType)) return res.status(400).json({ error: 'Invalid serviceType' });
    const financialYear = String(req.query.financialYear || '').trim();
    if (req.query.assignmentsOnly !== 'true' && !/^20\d{2}-\d{2}$/.test(financialYear)) return res.status(400).json({ error: 'Valid financialYear (YYYY-YY) is required.' });
    const scope = await getVisibleUserScope(req.user);
    const excluded = await getAssignmentDashboardLeadReferences();
    const referencesAt = Date.now();
    const [snapshot, users] = await Promise.all([
      loadDashboardAssignments({ Client, Lead }, dashboardClientExclusionFilter(excluded), dashboardLeadExclusionFilter(excluded)),
      visibleUsers(scope, req.user)
    ]);
    const clients = snapshot.clients, staffLeads = snapshot.leads;
    const snapshotAt = Date.now();
    const { STAGES, buildUploadTracker } = require('../services/clientUploadTracker');
    const assignedClients = mergeManagerStaffAllocations(clients.map(dashboardStatusClient), staffLeads);
    const allocated = buildUploadTracker(assignedClients, users, [], []);
    const visibleIds = new Set(allocated.flatMap(user => user.clients.flatMap(client => client.clientIds || [client.clientId])));
    const visibleClients = assignedClients.filter(client => visibleIds.has(String(client._id)));
    if (req.query.assignmentsOnly === 'true') {
      // Portfolio counts need application status, not the full compliance
      // review/SLA histories used by the operations dashboard.
      if (req.query.portfolioOnly === 'true') {
        res.set('Cache-Control', 'private, no-store');
        res.set('Server-Timing', `references;dur=${referencesAt - startedAt}, snapshot;dur=${snapshotAt - referencesAt}, assignments;dur=${Date.now() - startedAt}`);
        return res.json({ ok: true, users, assignments: visibleClients });
      }
      const realIds = visibleClients.filter(client => !client.assignmentOnly).map(client => client._id);
      const [reviews, approvals] = await cachedAssignmentReviews(JSON.stringify(realIds.map(String).sort()), () => Promise.all([
        require('../models/ClientComplianceReview').find({ client: { $in: realIds } }).select('client status sections finalRemarks updatedAt').populate('sections.reviewedBy', 'name email').maxTimeMS(15000).lean(),
        require('../models/PendingApproval').find({ type: 'client', source: 'crm', sourceClientId: { $in: realIds.map(String) } }).select('sourceClientId approvalStatus actionAt createdAt reminderFlag redFlagAt greenFlagDeadline correctionStatus correctionStartedAt correctionDueAt correctionBreachedAt correctionDeadlinePolicy').maxTimeMS(15000).lean()
      ]));
      const reviewByClient = new Map(reviews.map(review => [String(review.client), review]));
      const approvalByClient = new Map(approvals.map(approval => [String(approval.sourceClientId), approval]));
      res.set('Cache-Control', 'private, no-store');
      res.set('Server-Timing', `references;dur=${referencesAt - startedAt}, snapshot;dur=${snapshotAt - referencesAt}, reviews;dur=${Date.now() - snapshotAt}, assignments;dur=${Date.now() - startedAt}`);
      return res.json({ ok: true, users, assignments: visibleClients.map(client => ({ ...client, complianceReview: reviewByClient.get(String(client._id)) || null, operationsSla: approvalByClient.get(String(client._id)) || null })) });
    }
    const trackerClients = visibleClients;
    const filter = { clientId: { $in: trackerClients.filter(client => !client.assignmentOnly).map(client => client._id) }, financialYear };
    const projection = 'clientId checklist baseUpload.importStatus portalUpload.importStatus managerVerificationStatus complianceVerificationStatus';
    const [purchases, sales] = await Promise.all([PurchaseData.find(filter).select(projection).maxTimeMS(15000).lean(), SalesData.find(filter).select(projection).maxTimeMS(15000).lean()]);
    res.set('Cache-Control', 'private, no-store');
    res.json({ ok: true, financialYear, serviceType, scope: scope === null ? 'all' : 'role-scoped', stages: STAGES, users: buildUploadTracker(trackerClients, users, purchases, sales, { groupBy: serviceType ? 'application' : 'company', serviceType, financialYear }) });
  } catch (error) {
    console.error('Upload tracker failed', { message: error.message });
    res.status(500).json({ error: 'Unable to load client upload tracker.' });
  }
};
