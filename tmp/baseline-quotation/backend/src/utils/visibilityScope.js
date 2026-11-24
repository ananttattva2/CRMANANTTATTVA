const User = require('../models/User');
const Team = require('../models/Team');
const { getUserRoles } = require('./userRoles');

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildIdentityConditions(paths, identities) {
  if (!paths.length || !identities.length) return [];

  return paths.flatMap((path) => identities.map((identity) => ({
    [path]: { $regex: `^${escapeRegex(identity)}$`, $options: 'i' }
  })));
}

async function getVisibleUserScope(user) {
  if (!user?._id) return { ids: [], identities: [] };
  const roles = getUserRoles(user);
  const roleFamilies = roles.map((role) => role.replace(/-/g, ''));
  if (roleFamilies.some((role) => ['admin', 'superadmin'].includes(role))) return null;

  const visibleUsers = [user];
  const hasManagerScope = roleFamilies.some((role) => ['manager', 'teammanager', 'operationhead', 'operationshead', 'management'].includes(role));
  if (hasManagerScope) {
    const managedTeams = await Team.find({
      $or: [
        { manager: user._id },
        { operationHead: user._id }
      ]
    }).select('_id members').lean();
    const teamIds = managedTeams.map((team) => team._id).filter(Boolean);
    const memberIds = managedTeams.flatMap((team) => team.members || []).filter(Boolean);
    const assignmentConditions = [{ managerId: user._id }, { operationHeadId: user._id }];
    if (teamIds.length) assignmentConditions.push({ teamId: { $in: teamIds } });
    if (memberIds.length) assignmentConditions.push({ _id: { $in: memberIds } });
    const reports = await User.find({
      isActive: { $ne: false },
      $or: assignmentConditions
    }).select('_id crmUserId name email').lean();
    visibleUsers.push(...reports);
  }

  const ids = [...new Map(visibleUsers
    .filter((entry) => entry?._id)
    .map((entry) => [String(entry._id), entry._id])).values()];
  const identities = [...new Set(visibleUsers.flatMap((entry) => [
    String(entry?._id || ''), entry?.crmUserId, entry?.name, entry?.email
  ]).map((value) => String(value || '').trim()).filter(Boolean))];
  return { ids, identities };
}

async function getVisibleUserIds(user) {
  const scope = await getVisibleUserScope(user);
  if (scope === null) return null;
  return scope.ids;
}

function ownerFilter(scope, createdByPath = 'createdBy', assignedToPath = 'assignedTo', identityPaths = [], idPaths = []) {
  if (scope === null) return {};

  const ids = Array.isArray(scope) ? scope : (scope?.ids || []);
  const identities = Array.isArray(scope) ? [] : (scope?.identities || []);
  const conditions = [
    ...(ids.length ? [
      ...(createdByPath ? [{ [createdByPath]: { $in: ids } }] : []),
      ...(assignedToPath ? [{ [assignedToPath]: { $in: ids } }] : []),
      ...idPaths.map((path) => ({ [path]: { $in: ids } }))
    ] : []),
    ...buildIdentityConditions(identityPaths, identities)
  ];

  if (!conditions.length) return { _id: { $exists: false } };

  return { $or: conditions };
}

module.exports = {
  getVisibleUserScope,
  getVisibleUserIds,
  ownerFilter
};
