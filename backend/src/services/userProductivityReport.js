const User = require('../models/User');
const UserSession = require('../models/UserSession');
const AuditLog = require('../models/AuditLog');
const Lead = require('../models/Lead');
const TemporaryLead = require('../models/TemporaryLead');
const SupportTicket = require('../models/SupportTicket');
const Client = require('../models/Client');
const Team = require('../models/Team');

const ONLINE_WINDOW_MS = 15 * 60 * 1000;
const REPORT_CACHE_TTL_MS = 60 * 1000;
const { readCache } = require('./readCache');
const cachedProductivityReport = readCache.createCache({ name: 'productivity', ttl: REPORT_CACHE_TTL_MS, maxEntries: 50 });
// Constructing an ICU formatter for every audit event dominates large reports.
const indiaDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
});

function entityId(value) {
  const id = value && typeof value === 'object' ? value._id || value.id || value : value;
  return id === undefined || id === null || id === '' ? null : String(id);
}

async function reportQuery(label, query, fallback = []) {
  try {
    return await query;
  } catch (error) {
    console.error('[productivity-report] query failed', { label, message: error.message, code: error.code });
    return fallback;
  }
}

function reportDateRange(from, to) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const startLabel = /^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) ? String(from) : today;
  const endLabel = /^\d{4}-\d{2}-\d{2}$/.test(String(to || '')) ? String(to) : startLabel;
  const start = new Date(`${startLabel}T00:00:00.000+05:30`);
  const end = new Date(`${endLabel}T23:59:59.999+05:30`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    const error = new Error('Please select a valid report date range');
    error.statusCode = 400;
    throw error;
  }
  return { from: startLabel, to: endLabel, start, end };
}

function productivityScore(row) {
  const focus = row.openSeconds ? Math.min(50, Math.round((row.activeSeconds / row.openSeconds) * 50)) : 0;
  const activity = Math.min(25, Math.round(Math.log10(row.activityCount + 1) * 10));
  const output = Math.min(25, row.closedLeads * 3);
  return Math.min(100, focus + activity + output);
}

function riskForUser(row, now = new Date()) {
  if (!row.active) return { key: 'inactive', level: 'High Risk', reason: 'Inactive account', rank: 4 };
  if (!row.lastLogin) return { key: 'never', level: 'Never Logged In', reason: 'No successful CRM login recorded', rank: 5 };
  const staleDays = Math.floor((now.getTime() - new Date(row.lastLogin).getTime()) / 86400000);
  if (staleDays >= 7) return { key: 'stale', level: 'Medium Risk', reason: `${staleDays} days since last login`, rank: 3 };
  if (row.openSeconds > 1800 && row.awayRatio >= 0.7) return { key: 'away', level: 'High Risk', reason: 'High away ratio', rank: 2 };
  return { key: 'healthy', level: 'Low Risk', reason: 'No activity risk detected', rank: 1 };
}

function indiaDateKey(value) {
  if (!value) return '';
  const parts = indiaDayFormatter.formatToParts(new Date(value));
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function buildDailyTimeline(sessions, activities) {
  const groups = new Map();
  sessions.forEach((session) => {
    const date = indiaDateKey(session.loginAt || session.lastActivityAt);
    if (!date) return;
    const endAt = session.logoutAt || session.lastActivityAt || session.loginAt;
    const current = groups.get(date) || { date, firstLogin: session.loginAt, lastSeen: endAt, activeSeconds: 0, awaySeconds: 0, actions: 0, modules: new Set() };
    if (new Date(session.loginAt) < new Date(current.firstLogin)) current.firstLogin = session.loginAt;
    if (new Date(endAt) > new Date(current.lastSeen)) current.lastSeen = endAt;
    const openSeconds = Math.max(0, Math.round((new Date(endAt) - new Date(session.loginAt)) / 1000));
    current.activeSeconds += Math.max(0, Number(session.activeSeconds) || 0);
    current.awaySeconds += Math.max(0, openSeconds - (Number(session.activeSeconds) || 0));
    groups.set(date, current);
  });
  activities.forEach((activity) => {
    const date = indiaDateKey(activity.occurredAt);
    if (!groups.has(date)) groups.set(date, { date, firstLogin: null, lastSeen: activity.occurredAt, activeSeconds: 0, awaySeconds: 0, actions: 0, modules: new Set() });
    const current = groups.get(date);
    current.actions += 1;
    if (activity.module) current.modules.add(activity.module);
    if (!current.lastSeen || new Date(activity.occurredAt) > new Date(current.lastSeen)) current.lastSeen = activity.occurredAt;
  });
  return [...groups.values()].map((row) => ({ ...row, modules: [...row.modules].sort() })).sort((a, b) => b.date.localeCompare(a.date));
}

function buildUserProductivityReport({ users, sessions, activities, leads, temporaryLeads = [], clients = [], ticketStats, period, now = new Date() }) {
  const byUser = (items, field) => items.reduce((map, item) => {
    const key = String(item[field] || '');
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
    return map;
  }, new Map());
  const sessionsByUser = byUser(sessions, 'userId');
  const activitiesByUser = byUser(activities, 'userId');
  const normalizeIdentity = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const userByIdentity = new Map();
  users.forEach((user) => {
    [user._id, user.id, user.crmUserId, user.email, user.name].forEach((identity) => {
      const key = normalizeIdentity(entityId(identity));
      if (key && !userByIdentity.has(key)) userByIdentity.set(key, String(user._id));
    });
  });
  const leadsByUser = leads.reduce((map, lead) => {
    // Sales MIS follows the stable owner selected through Yourself / Other User.
    const generatedOwner = [lead.generatedForUser, lead.generatedForName, lead.generatedForEmail].filter(Boolean);
    const ownerCandidates = generatedOwner.length ? generatedOwner : [lead.createdBy, lead.createdByCrmUserId, lead.createdByEmail, lead.createdByName, lead.importedCreatedBy];
    const ownerId = ownerCandidates.map((identity) => userByIdentity.get(normalizeIdentity(entityId(identity)))).find(Boolean);
    if (!ownerId) return map;
    if (!map.has(ownerId)) map.set(ownerId, []);
    map.get(ownerId).push(lead);
    return map;
  }, new Map());
  const temporaryCountsByUser = temporaryLeads.reduce((map, lead) => {
    const ownerId = [lead.createdBy, lead.createdByEmail, lead.createdByName]
      .map((identity) => userByIdentity.get(normalizeIdentity(entityId(identity)))).find(Boolean);
    if (ownerId) map.set(ownerId, (map.get(ownerId) || 0) + 1);
    return map;
  }, new Map());
  const clientLeadById = new Map(leads.map((lead) => [entityId(lead._id), lead]));
  const reportClients = deduplicateClientWorkRows(clients.map((client) => {
    const data = client.data || {};
    const snapshot = data.selectedLeadSnapshot || {};
    const lead = clientLeadById.get(entityId(client.selectedLead)) || {};
    return {
      ...client,
      id: client._id,
      leadId: entityId(client.selectedLead),
      company: data.basic?.clientLegalName || data.basic?.tradeName || lead.company || client.companyIdentity || '',
      status: String(client.workflowStatus || 'draft').toLowerCase(),
      ...getClientApplicantIdentity({ client, lead }),
      assignedServiceId: client.assignedServiceId || data.assignedServiceId || snapshot.assignedServiceId || '',
      serviceCategory: data.basic?.eprCategory || snapshot.eprCategory || snapshot.serviceCategory || '',
      servicesOffered: data.basic?.servicesOffered || snapshot.servicesOffered || snapshot.applicableService || '',
      plantUnit: data.basic?.plantUnit || snapshot.plantUnit || '',
      businessCategory: snapshot.businessCategory || ''
    };
  }));
  const clientsByUser = byUser(reportClients, 'createdBy');
  const ticketByUser = new Map(ticketStats.map((item) => [String(item._id || ''), {
    total: Number(item.total) || 0, open: Number(item.open) || 0, resolved: Number(item.resolved) || 0
  }]));

  const rows = users.map((user) => {
    const id = String(user._id);
    const ownSessions = sessionsByUser.get(id) || [];
    const ownActivities = activitiesByUser.get(id) || [];
    const ownLeads = leadsByUser.get(id) || [];
    const ownClients = clientsByUser.get(id) || [];
    const clientAnalysis = ownClients.map((client) => analyzeClientMasterData(client.data || {}));
    const clientFieldsFilled = clientAnalysis.reduce((sum, item) => sum + item.filledCount, 0);
    const clientFieldsTotal = clientAnalysis.reduce((sum, item) => sum + item.totalCount, 0);
    const sortedSessions = [...ownSessions].sort((a, b) => new Date(b.loginAt || 0) - new Date(a.loginAt || 0));
    const latestSession = sortedSessions[0] || null;
    const activeSeconds = ownSessions.reduce((sum, item) => sum + Math.max(0, Number(item.activeSeconds) || 0), 0);
    const openSeconds = ownSessions.reduce((sum, item) => {
      const endAt = item.logoutAt || item.lastActivityAt || item.loginAt;
      return sum + Math.max(0, Math.round((new Date(endAt) - new Date(item.loginAt)) / 1000));
    }, 0);
    const activityCount = ownActivities.length || ownSessions.reduce((sum, item) => sum + Math.max(0, Number(item.activityCount) || 0), 0);
    const awaySeconds = Math.max(0, openSeconds - activeSeconds);
    const online = Boolean(latestSession && !latestSession.logoutAt && now.getTime() - new Date(latestSession.lastActivityAt).getTime() < ONLINE_WINDOW_MS);
    const lastActivity = [...ownActivities.map((item) => item.occurredAt), ...ownSessions.map((item) => item.lastActivityAt), user.lastLogin]
      .filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;
    const closedLeads = ownLeads.filter((lead) => lead.closedBy || lead.closedAt || /closed/i.test(String(lead.status || ''))).length;
    const row = {
      id: user._id, name: user.name || user.email || 'Unnamed user', email: user.email || '', role: user.role || '', team: user.team || '',
      teamId: user.teamId || null, managerId: user.managerId || null,
      active: user.isActive !== false, lastLogin: user.lastLogin || null, lastActivity,
      totalLeads: ownLeads.length, closedLeads, openLeads: Math.max(0, ownLeads.length - closedLeads),
      temporaryLeads: temporaryCountsByUser.get(id) || 0,
      clientMasters: ownClients.length, clientFieldsFilled,
      clientFieldsMissing: Math.max(0, clientFieldsTotal - clientFieldsFilled),
      draftClients: ownClients.filter((client) => String(client.workflowStatus || 'draft').toLowerCase() === 'draft').length,
      submittedClients: ownClients.filter((client) => String(client.workflowStatus || '').toLowerCase() === 'submitted').length,
      pendingClients: ownClients.filter((client) => String(client.adminControls?.approvalStatus || 'PENDING').toUpperCase() === 'PENDING').length,
      partiallyApprovedClients: ownClients.filter((client) => String(client.adminControls?.approvalStatus || '').toUpperCase() === 'PARTIALLY_APPROVED').length,
      approvedClients: ownClients.filter((client) => String(client.adminControls?.approvalStatus || '').toUpperCase() === 'APPROVED').length,
      rejectedClients: ownClients.filter((client) => String(client.adminControls?.approvalStatus || '').toUpperCase() === 'REJECTED').length,
      clientCompletionPercentage: clientFieldsTotal ? Math.round((clientFieldsFilled / clientFieldsTotal) * 100) : 0,
      activeSeconds, openSeconds, awaySeconds, activityCount, sessions: ownSessions.length,
      awayRatio: openSeconds ? awaySeconds / openSeconds : 0, online,
      presence: !user.lastLogin ? 'Never Logged In' : online ? (latestSession.presenceState === 'away' ? 'Away' : 'Active') : 'Offline',
      latestAccess: latestSession ? { ipAddress: latestSession.ipAddress || '', device: latestSession.userAgent || '' } : null,
      tickets: ticketByUser.get(id) || { total: 0, open: 0, resolved: 0 },
      recentActions: [...ownActivities].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt)).slice(0, 12).map((item) => ({
        id: item._id, action: item.action, module: item.module, description: item.description, occurredAt: item.occurredAt, statusCode: item.statusCode
      })),
      timeline: buildDailyTimeline(ownSessions, ownActivities)
    };
    row.score = productivityScore(row);
    row.risk = riskForUser(row, now);
    return row;
  });
  const summary = rows.reduce((result, row) => ({
    totalUsers: result.totalUsers + 1,
    activeUsers: result.activeUsers + (row.active ? 1 : 0),
    onlineNow: result.onlineNow + (row.online ? 1 : 0),
    activeSeconds: result.activeSeconds + row.activeSeconds,
    awaySeconds: result.awaySeconds + row.awaySeconds,
    actions: result.actions + row.activityCount,
    totalLeads: result.totalLeads + row.totalLeads,
    closedLeads: result.closedLeads + row.closedLeads,
    supportTickets: result.supportTickets + row.tickets.total,
    openTickets: result.openTickets + row.tickets.open,
    resolvedTickets: result.resolvedTickets + row.tickets.resolved,
    totalSessions: result.totalSessions + row.sessions
  }), { totalUsers: 0, activeUsers: 0, onlineNow: 0, activeSeconds: 0, awaySeconds: 0, actions: 0, totalLeads: 0, closedLeads: 0, supportTickets: 0, openTickets: 0, resolvedTickets: 0, totalSessions: 0 });
  return { period: { from: period.from, to: period.to }, summary, users: rows.sort((a, b) => b.risk.rank - a.risk.rank || b.score - a.score) };
}

async function getUserProductivityReport({ from, to, requester }) {
  const period = reportDateRange(from, to);
  const requesterRole = String(requester?.role || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  const isAdmin = ['admin', 'superadmin'].includes(requesterRole);
  const requesterId = requester?._id || requester?.id;
  const cacheKey = `${String(requesterId || 'anonymous')}:${requesterRole}:${period.from}:${period.to}`;
  return cachedProductivityReport(cacheKey, async () => {
    const operationTeams = await reportQuery('teams', isAdmin
      ? Team.find().select('name manager operationHead members').sort({ name: 1 }).lean()
      : Team.find({ $or: [{ manager: requesterId }, { operationHead: requesterId }] }).select('name manager operationHead members').sort({ name: 1 }).lean());
    const scopedUserIds = isAdmin ? null : operationTeams.flatMap((team) => [entityId(team.manager), ...(team.members || []).map(entityId)]).filter(Boolean);
    const userFilter = isAdmin ? {} : { _id: { $in: scopedUserIds } };
    const activityUserFilter = isAdmin ? {} : { userId: { $in: scopedUserIds } };
    const ownerFilter = isAdmin ? {} : { createdBy: { $in: scopedUserIds } };
    const createdAt = { $gte: period.start, $lte: period.end };
    const [users, sessions, activities, leads, temporaryLeads, clients, ticketStats] = await Promise.all([
      reportQuery('users', User.find(userFilter).select('name email crmUserId role team teamId managerId operationHeadId isActive lastLogin').lean()),
      reportQuery('sessions', UserSession.find({ ...activityUserFilter, loginAt: createdAt })
        .select('userId loginAt lastActivityAt logoutAt activeSeconds activityCount presenceState ipAddress userAgent').sort({ loginAt: -1 }).limit(5000).maxTimeMS(15000).lean()),
      reportQuery('activities', AuditLog.find({ ...activityUserFilter, occurredAt: createdAt })
        .select('userId action module description occurredAt statusCode').sort({ occurredAt: -1 }).limit(10000).maxTimeMS(15000).lean()),
      reportQuery('leads', Lead.find({ ...ownerFilter, createdAt }).select('createdBy createdByCrmUserId createdByEmail createdByName importedCreatedBy generatedForUser generatedForName generatedForEmail status closedBy closedByText closedAt createdAt').maxTimeMS(20000).lean()),
      reportQuery('temporary-leads', TemporaryLead.find({ ...ownerFilter, createdAt }).select('createdBy createdByName createdByEmail').maxTimeMS(15000).lean()),
      reportQuery('clients', Client.find({ ...ownerFilter, createdAt }).select('createdBy data workflowStatus adminControls.approvalStatus createdAt updatedAt selectedLead assignedServiceId').maxTimeMS(20000).lean()),
      reportQuery('tickets', SupportTicket.aggregate([
        { $match: { ...ownerFilter, createdAt } },
        { $group: {
          _id: '$createdBy', total: { $sum: 1 },
          open: { $sum: { $cond: [{ $in: ['$status', ['Open', 'In Progress']] }, 1, 0] } },
          resolved: { $sum: { $cond: [{ $in: ['$status', ['Resolved', 'Closed']] }, 1, 0] } }
        } }
      ]).option({ maxTimeMS: 15000 }))
    ]);
    return {
      ...buildUserProductivityReport({ users, sessions, activities, leads, temporaryLeads, clients, ticketStats, period }),
      misAccess: {
        isAdmin,
        scope: isAdmin ? 'all' : (operationTeams.some((team) => String(entityId(team.operationHead) || '') === String(requesterId)) ? 'operation-head' : 'manager'),
        showSales: isAdmin,
        showQuotations: isAdmin,
        operationTeams: operationTeams.map((team) => ({ id: entityId(team._id), name: String(team.name || 'Operations Team'), managerId: entityId(team.manager), operationHeadId: entityId(team.operationHead), memberIds: (team.members || []).map(entityId).filter(Boolean) }))
      }
    };
  });
}

function canViewUserWorkReport({ requester, targetUserId, operationTeams = [] }) {
  const requesterId = entityId(requester?._id || requester?.id);
  const targetId = entityId(targetUserId);
  const role = String(requester?.role || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (['admin', 'superadmin'].includes(role)) return true;
  if (!requesterId || !targetId || !['manager', 'operationhead', 'operationshead'].includes(role)) return false;
  if (requesterId === targetId) return true;
  return operationTeams.some((team) => {
    const supervisesTeam = role === 'manager'
      ? entityId(team.manager) === requesterId
      : entityId(team.operationHead) === requesterId;
    return supervisesTeam && (team.members || []).map(entityId).includes(targetId);
  });
}

async function assertUserWorkReportAccess({ requester, targetUserId }) {
  const role = String(requester?.role || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (['admin', 'superadmin'].includes(role) || entityId(requester?._id || requester?.id) === entityId(targetUserId)) {
    if (canViewUserWorkReport({ requester, targetUserId })) return;
  }
  const requesterId = requester?._id || requester?.id;
  const operationTeams = ['manager', 'operationhead', 'operationshead'].includes(role)
    ? await Team.find(role === 'manager' ? { manager: requesterId } : { operationHead: requesterId })
      .select('manager operationHead members').lean()
    : [];
  if (canViewUserWorkReport({ requester, targetUserId, operationTeams })) return;
  const error = new Error('You can only view work reports for yourself or users in your Operations MIS team.');
  error.statusCode = 403;
  throw error;
}

function clientSectionAnalysis(data = {}) {
  const ignored = /password|otp|token|secret/i;
  const meaningful = (value) => value !== undefined && value !== null && (typeof value !== 'string' || value.trim() !== '');
  const sections = Object.entries(data || {}).filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value)).map(([name, value]) => {
    const fields = Object.entries(value).filter(([key]) => !ignored.test(key));
    const filled = fields.filter(([, item]) => meaningful(item)).length;
    return { name: name.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase()), filled, missing: Math.max(0, fields.length - filled), total: fields.length, percentage: fields.length ? Math.round((filled / fields.length) * 100) : 0 };
  });
  return sections.sort((a, b) => b.total - a.total).slice(0, 12);
}

function companyNameFor({ lead, client }) {
  return client?.data?.basic?.clientLegalName || client?.data?.basic?.tradeName || lead?.company || 'Unnamed Company';
}

function getClientApplicantIdentity({ client = {}, lead = {} } = {}) {
  const data = client.data || {};
  const snapshot = data.selectedLeadSnapshot || {};
  const services = Array.isArray(lead.serviceSelections) ? lead.serviceSelections : [];
  const assignedServiceId = String(client.assignedServiceId || data.assignedServiceId || snapshot.assignedServiceId || '').trim();
  const basicSubApplicant = String(data.basic?.piboCategory || '').trim().toLowerCase();
  const service = services.find((item) => assignedServiceId && String(item.assignedServiceId || item.serviceAssignmentId || item.id || '').trim() === assignedServiceId)
    || services.find((item) => basicSubApplicant && String(item.subApplicantType || item.piboCategory || '').trim().toLowerCase() === basicSubApplicant)
    || (services.length === 1 ? services[0] : {});
  const firstText = (...values) => String(values.find((value) => String(value || '').trim()) || '').trim();
  return {
    applicantType: firstText(snapshot.applicantType, snapshot.piboParent, service.applicantType, service.piboParent, data.basic?.applicantType, client.applicantType, lead.applicantType),
    subApplicantType: firstText(snapshot.subApplicantType, snapshot.piboCategory, data.basic?.piboCategory, service.subApplicantType, service.piboCategory, client.subApplicantType, client.piboCategory, lead.subApplicantType, lead.piboCategory)
  };
}

function normalizeClientWorkIdentity(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function clientWorkRowsShareService(left = {}, right = {}) {
  const leftLead = normalizeClientWorkIdentity(left.leadId);
  const rightLead = normalizeClientWorkIdentity(right.leadId);
  const leftCompany = normalizeClientWorkIdentity(left.company);
  const rightCompany = normalizeClientWorkIdentity(right.company);
  const sameCompany = leftLead && rightLead
    ? leftLead === rightLead
    : Boolean(leftCompany && rightCompany && leftCompany === rightCompany);
  if (!sameCompany) return false;

  const serviceFields = ['applicantType', 'subApplicantType', 'serviceCategory', 'servicesOffered', 'plantUnit', 'businessCategory'];
  const hasSemanticServiceIdentity = serviceFields.some((field) => normalizeClientWorkIdentity(left[field]) || normalizeClientWorkIdentity(right[field]));
  if (!hasSemanticServiceIdentity) {
    const leftAssignment = normalizeClientWorkIdentity(left.assignedServiceId);
    const rightAssignment = normalizeClientWorkIdentity(right.assignedServiceId);
    return Boolean(leftAssignment && rightAssignment && leftAssignment === rightAssignment);
  }

  return serviceFields.every((field) => {
    const leftValue = normalizeClientWorkIdentity(left[field]);
    const rightValue = normalizeClientWorkIdentity(right[field]);
    return !leftValue || !rightValue || leftValue === rightValue;
  });
}

function deduplicateClientWorkRows(rows = []) {
  return rows.reduce((result, row) => {
    const matchingIndex = result.findIndex((candidate) => clientWorkRowsShareService(candidate, row));
    if (matchingIndex === -1) return [...result, row];

    const current = result[matchingIndex];
    const currentSubmitted = String(current.status || '').toLowerCase() === 'submitted';
    const incomingSubmitted = String(row.status || '').toLowerCase() === 'submitted';
    const incomingIsNewer = new Date(row.updatedAt || row.createdAt || 0) > new Date(current.updatedAt || current.createdAt || 0);
    if ((incomingSubmitted && !currentSubmitted) || (incomingSubmitted === currentSubmitted && incomingIsNewer)) {
      const next = [...result];
      next[matchingIndex] = row;
      return next;
    }
    return result;
  }, []);
}

function analyzeClientMasterData(data = {}) {
  const entries = [];
  const filled = (value) => Array.isArray(value) ? value.length > 0 : value && typeof value === 'object' ? Boolean(value.url || value.secureUrl || value.dataUrl || value.path || value.publicId || value.name || value.fileName) : value !== undefined && value !== null && String(value).trim() !== '';
  const add = (section, label, value) => entries.push({ section, label, filled: filled(value) });
  const addFields = (section, source, fields) => fields.forEach(([key, label]) => add(section, label, source?.[key]));
  const cpcbRestricted = data.cpcbOnboarding?.cpcbPortalRegistered === false;
  addFields('Company Overview', data.companyOverview, [['companyName','Company Name'],['companySummary','Company Summary'],['productName','Product Name'],['productImage','Product Image'],['category','Product Category']]);
  addFields('Client Basic Info', data.basic, [['clientLegalName','Client Legal Name'],['tradeName','Trade Name'],['companyType','Company Type'],['piboCategory','PIBO Category'],['eprCategory','Service Category'],['onboardingYear','Onboarding Year'],['firstAnnualReturnYear','First Annual Return Year']]);
  [['Registered Address', data.registeredAddress], ['Communication Address', data.communicationAddress]].forEach(([section, source]) => addFields(section, source, [['address1','Address 1'],['address2','Address 2'],['address3','Address 3'],['state','State'],['city','City'],['pincode','PIN Code']]));
  const category = String(data.basic?.piboCategory || data.selectedLeadSnapshot?.subApplicantType || data.selectedLeadSnapshot?.piboCategory || '').trim().toLowerCase();
  const applicantType = String(data.selectedLeadSnapshot?.applicantType || data.selectedLeadSnapshot?.piboParent || '').trim().toLowerCase();
  const isImporter = category === 'importer';
  const isBrandOwner = category.includes('brand owner');
  const isPwp = applicantType === 'pwp' || category === 'pwp';
  const serviceCategory = String(data.basic?.eprCategory || data.selectedLeadSnapshot?.eprCategory || data.selectedLeadSnapshot?.serviceCategory || data.selectedLeadSnapshot?.servicesOffered || '').trim().toLowerCase();
  const isTyreWasteRecycler = category.includes('recycler') && serviceCategory.includes('tyre');
  const companyType = String(data.basic?.companyType || '').trim().toLowerCase();
  const isCorporate = ['private limited', 'public limited'].includes(companyType);
  const isNonCorporate = ['llp', 'partnership', 'proprietorship'].includes(companyType);
  const brandOwnerHasFactory = data.compliance?.brandOwnerProductionFacility === 'Yes'
    || (!data.compliance?.brandOwnerProductionFacility && data.compliance?.factoryLicenseApplicability === 'Applicable');
  const brandOwnerProductionFacility = data.compliance?.brandOwnerProductionFacility
    || (data.compliance?.factoryLicenseApplicability === 'Applicable' ? 'Yes' : data.compliance?.factoryLicenseApplicability === 'Not Applicable' ? 'No' : '');
  const documentKeys = cpcbRestricted ? [] : ['gst','cin','pan','factoryLicense','eprCertificate','iec','dicDcssi'].filter((key) => {
    if (isTyreWasteRecycler && ['factoryLicense', 'dicDcssi'].includes(key)) return false;
    if (isTyreWasteRecycler && ['partnership', 'proprietorship'].includes(companyType) && key === 'cin') return false;
    if (!isTyreWasteRecycler && isPwp && ['cin', 'factoryLicense', 'iec', 'dicDcssi'].includes(key)) return false;
    if (category.includes('producer') && (['iec', 'dicDcssi'].includes(key) || (isNonCorporate && key === 'cin'))) return false;
    if (isBrandOwner && (
      key === 'dicDcssi'
      || ((isCorporate || isNonCorporate) && key === 'iec')
      || (isNonCorporate && key === 'cin')
      || (key === 'factoryLicense' && !brandOwnerHasFactory)
    )) return false;
    if (isImporter && (key === 'factoryLicense' || (isNonCorporate ? key === 'cin' : key === 'dicDcssi'))) return false;
    if (!category.includes('producer') && !isBrandOwner && !isImporter && isCorporate && ['iec', 'dicDcssi'].includes(key)) return false;
    return true;
  });
  documentKeys.forEach((key) => { const name = key.replace(/([A-Z])/g, ' $1').toUpperCase(); add('Documents', `${name} Number`, data.compliance?.[`${key}Number`]); add('Documents', `${name} Date`, data.compliance?.[`${key}Date`]); add('Documents', `${name} File`, data.compliance?.[`${key}File`]); });
  if (!cpcbRestricted) add('Documents', 'MSME Applicability', data.compliance?.msmeApplicable);
  if (!cpcbRestricted && data.compliance?.msmeApplicable === 'Yes') (data.msmeRows?.length ? data.msmeRows : [{}]).forEach((row, index) => addFields('MSME Details', row, [['classificationYear',`MSME ${index + 1} Classification Year`],['status',`MSME ${index + 1} Status`],['majorActivity',`MSME ${index + 1} Major Activity`],['udyamNumber',`MSME ${index + 1} Udyam Number`],['turnover',`MSME ${index + 1} Turnover`],['file',`MSME ${index + 1} Certificate`]]));
  const cteTabApplicable = !isImporter && !(isBrandOwner && brandOwnerProductionFacility === 'No');
  if (!cpcbRestricted && cteTabApplicable) {
    const cteApplicable = data.cte?.cteApplicable !== 'No';
    const hasCtePlants = Array.isArray(data.cte?.plantWiseDetails) && data.cte.plantWiseDetails.length > 0;
    add('CTE & CTO / CCA', 'Number of Plant Locations', data.cte?.numberOfPlantsLocations);
    (hasCtePlants ? data.cte.plantWiseDetails : [{}]).forEach((plant, index) => {
      addFields('CTE & CTO / CCA', plant, [
        ['plantName',`Plant ${index + 1} Name`],
        ...(cteApplicable ? [['cteConsentNo',`Plant ${index + 1} CTE Consent No`],['cteCategory',`Plant ${index + 1} CTE Category`],['cteIssuedDate',`Plant ${index + 1} CTE Issue Date`],['cteValidDate',`Plant ${index + 1} CTE Validity`],['plantLocation',`Plant ${index + 1} Location`],['cteDocument',`Plant ${index + 1} CTE Document`]] : []),
        ['ctoOrderNo',`Plant ${index + 1} CTO/CCA Order No`],['ctoIssueDate',`Plant ${index + 1} CTO/CCA Issue Date`],['ctoValidDate',`Plant ${index + 1} CTO/CCA Validity`],['ctoDocument',`Plant ${index + 1} CTO/CCA Document`]
      ]);
      if (hasCtePlants && cteApplicable) (plant.cteProductionRows?.length ? plant.cteProductionRows : [{}]).forEach((row, rowIndex) => addFields('CTE & CTO / CCA', row, [['productName',`Plant ${index + 1} CTE Product ${rowIndex + 1}`],['capacity',`Plant ${index + 1} CTE Capacity ${rowIndex + 1}`]]));
      if (hasCtePlants) (plant.ctoProductRows?.length ? plant.ctoProductRows : [{}]).forEach((row, rowIndex) => addFields('CTE & CTO / CCA', row, [['productName',`Plant ${index + 1} CTO/CCA Product ${rowIndex + 1}`],['quantity',`Plant ${index + 1} CTO/CCA Quantity ${rowIndex + 1}`]]));
    });
  }
  if (!cpcbRestricted) add('CPCB Credentials', 'Linked to Common Portal', data.cpcb?.linkedToCommonPortal);
  if (!cpcbRestricted && data.cpcb?.linkedToCommonPortal === 'Yes') addFields('CPCB Credentials', data.cpcb, [['status','CPCB Status'],['remark','CPCB Remark'],['homePageFile','CPCB Home Page'],['registrationNumber','CPCB Registration Number'],['applicationDate','Application Date'],['approvalDate','Approval Date'],['applicationNumber','Application Number'],['ceprUserId','CEPR User ID'],['ceprPassword','CEPR Password'],['loginId','CPCB Login ID'],['loginPassword','CPCB Login Password'],['unitId','Unit ID']].filter(([key]) => !isPwp || !['registrationNumber', 'applicationNumber'].includes(key)));
  if (!cpcbRestricted) (data.cpcbScreenshots?.length ? data.cpcbScreenshots : [{}]).forEach((row, index) => { add('CPCB Screenshots', `Screenshot ${index + 1} Name`, row.name); add('CPCB Screenshots', `Screenshot ${index + 1} File`, row.file); });
  const processDiagramChoiceRequired = !isTyreWasteRecycler && (isImporter || isBrandOwner);
  const processDiagramRequired = isTyreWasteRecycler ? false : processDiagramChoiceRequired ? data.cpcb?.processDiagramRequired === 'Yes' : true;
  if (!cpcbRestricted && processDiagramChoiceRequired) add('CPCB Screenshots', 'Process Flow Diagram Required', data.cpcb?.processDiagramRequired);
  if (!cpcbRestricted && processDiagramRequired) (data.processDiagrams?.length ? data.processDiagrams : [{}]).forEach((row, index) => { add('CPCB Screenshots', `Process Diagram ${index + 1} Name`, row.name); add('CPCB Screenshots', `Process Diagram ${index + 1} File`, row.file); });
  addFields('Authorized Person Details', data.otp, [['mobile','OTP Mobile'],['personName','OTP Person'],['designation','OTP Person Designation']]);
  const personFields = [['name','Name'],['designation','Designation'],['department','Department'],['reporting','Reporting Person'],['mobile','Mobile'],['email','Email'],['pan','PAN'],['panDocument','PAN Document'], ...(isTyreWasteRecycler ? [['aadhaarNumber','Aadhaar Card Number'],['aadhaarDocument','Aadhaar Card Document']] : [])];
  if (!cpcbRestricted) {
    addFields('Authorized Person Details', data.authorised, personFields.map(([key,label]) => [key,`Authorized Person ${label}`]));
    (data.authorisedPersons || []).forEach((person, index) => addFields('Authorized Person Details', person, personFields.map(([key,label]) => [key,`Authorized Person ${index + 2} ${label}`])));
  }
  addFields('Authorized Person Details', data.coordinating, personFields.slice(0, 6).map(([key,label]) => [key,`Coordinating Person ${label}`]));
  const grouped = new Map(); entries.forEach((entry) => { const row = grouped.get(entry.section) || { name: entry.section, filled: 0, total: 0 }; row.total += 1; row.filled += entry.filled ? 1 : 0; grouped.set(entry.section, row); });
  const sections = [...grouped.values()].map((row) => ({ ...row, missing: row.total - row.filled, percentage: row.total ? Math.round((row.filled / row.total) * 100) : 0 }));
  const filledFields = entries.filter((entry) => entry.filled).map((entry) => entry.label); const missingFields = entries.filter((entry) => !entry.filled).map((entry) => entry.label);
  return { filledCount: filledFields.length, totalCount: entries.length, filledFields, missingFields, completed: missingFields.length === 0, sections };
}

async function getUserWorkReport({ userId, from, to, requester }) {
  await assertUserWorkReportAccess({ requester, targetUserId: userId });
  const period = reportDateRange(from, to);
  const user = await User.findById(userId).select('name email role team isActive').lean();
  if (!user) { const error = new Error('User not found'); error.statusCode = 404; throw error; }
  const createdAt = { $gte: period.start, $lte: period.end };
  const teamUsers = /manager/i.test(String(user.role || '')) ? await User.find({ managerId: userId, isActive: { $ne: false } }).select('name email role team').sort({ name: 1 }).lean() : [];
  const teamIds = teamUsers.map((member) => member._id);
  const [leads, clients] = await Promise.all([
    Lead.find({ createdBy: userId, createdAt }).select('leadCode company companyIdentity status workflowStatus serviceSelections servicesOffered eprCategory applicantType subApplicantType piboCategory assignments nextFollowUpDate nextFollowUpTime followUpRemarks followUpPriority followUpFlag followUpHistory closedBy closedByText closedAt createdByName createdAt updatedAt').sort({ createdAt: -1 }).lean(),
    Client.find({ createdBy: userId, createdAt }).select('selectedLead assignedServiceId companyIdentity applicantType subApplicantType piboCategory data workflowStatus adminControls createdAt updatedAt').sort({ updatedAt: -1 }).lean()
  ]);
  const [teamLeads, teamClients] = teamIds.length ? await Promise.all([
    Lead.find({ createdBy: { $in: teamIds }, createdAt }).select('createdBy closedBy closedByText closedAt status').lean(),
    Client.find({ createdBy: { $in: teamIds }, createdAt }).select('createdBy workflowStatus data').lean()
  ]) : [[], []];
  const teamMembers = teamUsers.map((member) => {
    const memberLeads = teamLeads.filter((lead) => String(lead.createdBy) === String(member._id));
    const memberClients = teamClients.filter((client) => String(client.createdBy) === String(member._id));
    const closedLeads = memberLeads.filter((lead) => lead.closedBy || lead.closedByText || lead.closedAt || /closed/i.test(String(lead.status || ''))).length;
    const completion = memberClients.map((client) => { const result = analyzeClientMasterData(client.data || {}); return result.totalCount ? Math.round(result.filledCount / result.totalCount * 100) : 0; });
    return { id: member._id, name: member.name || member.email, email: member.email, role: member.role, team: member.team, totalLeads: memberLeads.length, openLeads: memberLeads.length - closedLeads, closedLeads, clientMasters: memberClients.length, submittedClients: memberClients.filter((client) => client.workflowStatus === 'submitted').length, averageCompletion: completion.length ? Math.round(completion.reduce((sum, value) => sum + value, 0) / completion.length) : 0 };
  });
  const leadById = new Map(leads.map((lead) => [String(lead._id), lead]));
  const latestClients = [...new Map([...clients].sort((left, right) => new Date(left.updatedAt || left.createdAt || 0) - new Date(right.updatedAt || right.createdAt || 0)).map((client) => [`${String(client.selectedLead || client._id)}:${String(client.assignedServiceId || client.data?.assignedServiceId || '')}`, client])).values()];
  const clientRows = deduplicateClientWorkRows(latestClients.map((client) => {
    const lead = leadById.get(String(client.selectedLead || ''));
    const applicantIdentity = getClientApplicantIdentity({ client, lead });
    const data = client.data || {};
    const snapshot = data.selectedLeadSnapshot || {};
    const required = analyzeClientMasterData(client.data || {});
    const sections = required.sections;
    const filled = required.filledCount;
    const total = required.totalCount;
    return { id: client._id, leadId: client.selectedLead, leadCode: lead?.leadCode || '', company: companyNameFor({ lead, client }), status: client.workflowStatus, ...applicantIdentity,
      assignedServiceId: client.assignedServiceId || data.assignedServiceId || snapshot.assignedServiceId || '',
      serviceCategory: data.basic?.eprCategory || snapshot.eprCategory || snapshot.serviceCategory || '',
      servicesOffered: data.basic?.servicesOffered || snapshot.servicesOffered || snapshot.applicableService || '',
      plantUnit: data.basic?.plantUnit || snapshot.plantUnit || '', businessCategory: snapshot.businessCategory || '',
      approvalStatus: client.adminControls?.approvalStatus || '', createdAt: client.createdAt, updatedAt: client.updatedAt,
      analysis: { filled, missing: Math.max(0, total - filled), total, percentage: total ? Math.round((filled / total) * 100) : 0, filledFields: required.filledFields, missingFields: required.missingFields, sections } };
  }));
  const clientLeadIds = new Set(clientRows.map((row) => String(row.leadId || '')).filter(Boolean));
  const today = new Date().toISOString().slice(0, 10);
  const leadRows = leads.map((lead) => {
    const services = (lead.serviceSelections?.length ? lead.serviceSelections : [lead]).map((service, index) => ({
      id: `${lead._id}-${index}`, name: service.servicesOffered || service.service || lead.servicesOffered || 'General service',
      category: service.serviceCategory || service.eprCategory || lead.eprCategory || '', applicantType: service.applicantType || lead.applicantType || '',
      status: service.closedBy || service.closedByText || service.closedAt || service.followUpClosedAt ? 'Closed' : 'Open'
    }));
    const timeline = [];
    const addFollowUp = (item, serviceName, fallbackDate) => {
      if (!item || (!item.scheduledDate && !item.nextFollowUpDate && !item.remarks && !item.followUpRemarks)) return;
      const scheduledDate = item.scheduledDate || item.nextFollowUpDate || '';
      const closed = Boolean(item.closedAt || item.followUpClosedAt || item.closedBy || item.closedByText || /closed|completed/i.test(String(item.status || item.action || '')));
      timeline.push({ scheduledDate, scheduledTime: item.scheduledTime || item.nextFollowUpTime || '', remarks: item.remarks || item.followUpRemarks || 'Follow-up scheduled', reason: item.reason || item.followUpCloseReason || '', priority: item.priority || item.followUpPriority || 'Medium', service: serviceName, owner: item.updatedBy || item.createdByName || lead.createdByName || user.name, closed, createdAt: item.createdAt || item.updatedAt || fallbackDate || null });
    };
    (lead.followUpHistory || []).forEach((item) => addFollowUp(item, 'General', lead.updatedAt));
    addFollowUp(lead, 'General', lead.updatedAt);
    (lead.serviceSelections || []).forEach((service) => { const serviceName = service.servicesOffered || service.service || service.eprCategory || 'General service'; (service.followUpHistory || []).forEach((item) => addFollowUp(item, serviceName, service.followUpUpdatedAt || lead.updatedAt)); addFollowUp(service, serviceName, service.followUpUpdatedAt || lead.updatedAt); });
    timeline.sort((a, b) => `${b.scheduledDate || ''} ${b.scheduledTime || ''}`.localeCompare(`${a.scheduledDate || ''} ${a.scheduledTime || ''}`));
    const closed = Boolean(lead.closedBy || lead.closedByText || lead.closedAt || /closed/i.test(String(lead.status || '')) || (services.length && services.every((service) => service.status === 'Closed')));
    const missedFollowUps = timeline.filter((item) => !item.closed && item.scheduledDate && item.scheduledDate < today);
    const redFlags = [];
    if (/RED/i.test(String(lead.followUpFlag || ''))) redFlags.push(lead.followUpFlag === 'PERMANENT_RED' ? 'Permanent follow-up red flag' : 'Follow-up overdue red flag');
    if (missedFollowUps.length) redFlags.push(`${missedFollowUps.length} missed follow-up${missedFollowUps.length === 1 ? '' : 's'}`);
    return { id: lead._id, leadCode: lead.leadCode, company: lead.company || 'Unnamed Company', status: closed ? 'Closed' : 'Open', rawStatus: lead.status || lead.workflowStatus,
      services, followUps: timeline, missedFollowUps, redFlags, lastActivityAt: timeline[0]?.createdAt || lead.updatedAt || lead.createdAt,
      createdAt: lead.createdAt, updatedAt: lead.updatedAt, hasClientMaster: clientLeadIds.has(String(lead._id)) };
  });
  const averageCompletion = clientRows.length ? Math.round(clientRows.reduce((sum, row) => sum + row.analysis.percentage, 0) / clientRows.length) : 0;
  return { period: { from: period.from, to: period.to }, user, summary: { leads: leadRows.length, openLeads: leadRows.filter((lead) => lead.status === 'Open').length, closedLeads: leadRows.filter((lead) => lead.status === 'Closed').length, submittedLeads: leads.filter((lead) => lead.workflowStatus === 'submitted').length,
    clientMasters: clientRows.length, submittedClients: clientRows.filter((client) => client.status === 'submitted').length, averageCompletion,
    completeClients: clientRows.filter((row) => row.analysis.percentage === 100).length, incompleteClients: clientRows.filter((row) => row.analysis.percentage < 100).length }, leads: leadRows, clients: clientRows, teamMembers };
}

module.exports = { getUserProductivityReport, getUserWorkReport, analyzeClientMasterData, clientSectionAnalysis, buildUserProductivityReport, productivityScore, riskForUser, reportDateRange, getClientApplicantIdentity, deduplicateClientWorkRows, canViewUserWorkReport };
