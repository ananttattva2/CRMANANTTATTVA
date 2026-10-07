const Lead = require('../models/Lead');
const User = require('../models/User');

const CACHE_TTL_MS = 60 * 1000;
let cached = null;

const clean = (value) => String(value || '').trim();

function buildReferences(leads = []) {
  const ids = leads.map((lead) => lead?._id).filter(Boolean);
  const identityValues = [...new Set(leads.flatMap((lead) => [
    clean(lead?._id), clean(lead?.leadCode), clean(lead?.sourceLeadId)
  ]).filter(Boolean))];
  return { ids, identityValues };
}

async function loadAdminCreatedLeadReferences({ LeadModel = Lead, UserModel = User } = {}) {
  const adminUsers = await UserModel.find({ role: /^admin$/i }).select('_id').lean();
  const adminIds = adminUsers.map((user) => user._id).filter(Boolean);
  if (!adminIds.length) return { adminIds: [], ids: [], identityValues: [] };
  const leads = await LeadModel.find({ createdBy: { $in: adminIds } })
    .select('_id leadCode sourceLeadId').lean();
  return { adminIds, ...buildReferences(leads) };
}

async function getAdminCreatedLeadReferences(options = {}) {
  const useCache = !options.LeadModel && !options.UserModel;
  if (useCache && cached?.expiresAt > Date.now()) return cached.value;
  const value = await loadAdminCreatedLeadReferences(options);
  if (useCache) cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

// Creator-based test exclusions must not hide real work allocated to permanent staff.
async function getAssignmentDashboardLeadReferences(options = {}) {
  const LeadModel = options.LeadModel || Lead;
  const references = await getAdminCreatedLeadReferences(options);
  if (!references.ids.length) return { assignmentScoped: true, ids: [], identityValues: [] };
  const hasStaff = field => ({ [field]: { $exists: true, $nin: field === 'assignedStaff' ? [null] : [null, ''] } });
  const unassigned = await LeadModel.find({ _id: { $in: references.ids }, $nor: [
    ...['assignedStaff', 'assignedStaffText', 'assignedStaffEmail'].map(hasStaff),
    { assignments: { $elemMatch: { $or: ['assignedStaff', 'assignedStaffText', 'assignedStaffEmail'].map(hasStaff) } } }
  ] }).select('_id leadCode sourceLeadId').lean();
  return { assignmentScoped: true, ...buildReferences(unassigned) };
}

function dashboardLeadExclusionFilter(references = {}) {
  if (references.assignmentScoped) return references.ids?.length ? { _id: { $nin: references.ids } } : {};
  return references.adminIds?.length ? { createdBy: { $nin: references.adminIds } } : {};
}

function dashboardClientExclusionFilter(references = {}) {
  const ids = references.ids || [];
  const identityValues = references.identityValues || [];
  if (!ids.length && !identityValues.length) return {};
  return { $nor: [
    ...(ids.length ? [{ selectedLead: { $in: ids } }] : []),
    ...(identityValues.length ? [
      { 'data.selectedLead': { $in: identityValues } },
      { 'data.selectedLeadSnapshot.id': { $in: identityValues } },
      { 'data.selectedLeadSnapshot.sourceLeadId': { $in: identityValues } },
      { 'data.selectedLeadSnapshot.leadCode': { $in: identityValues } },
      { 'data.importMeta.leadNumber': { $in: identityValues } }
    ] : [])
  ] };
}

function dashboardQuotationExclusionFilter(references = {}) {
  const ids = references.ids || [];
  const identityValues = references.identityValues || [];
  if (!ids.length && !identityValues.length) return {};
  return { $nor: [
    ...(ids.length ? [{ leadRef: { $in: ids } }] : []),
    ...(identityValues.length ? [
      { leadId: { $in: identityValues } },
      { leadCode: { $in: identityValues } },
      { businessLeadCode: { $in: identityValues } }
    ] : [])
  ] };
}

function resetDashboardTestLeadCache() {
  cached = null;
}

module.exports = {
  buildReferences,
  loadAdminCreatedLeadReferences,
  getAdminCreatedLeadReferences,
  getAssignmentDashboardLeadReferences,
  dashboardLeadExclusionFilter,
  dashboardClientExclusionFilter,
  dashboardQuotationExclusionFilter,
  resetDashboardTestLeadCache
};
