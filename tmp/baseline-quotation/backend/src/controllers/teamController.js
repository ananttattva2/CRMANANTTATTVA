const Team = require('../models/Team');
const User = require('../models/User');

function cleanIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

function mapTeam(team) {
  return {
    id: team._id,
    _id: team._id,
    crmTeamId: team.crmTeamId || String(team._id),
    source: team.source,
    name: team.name,
    description: team.description,
    members: team.members || [],
    manager: team.manager || null,
    operationHead: team.operationHead || null,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt
  };
}

async function ensureCrmTeamId(team) {
  if (!team || team.crmTeamId) return team;
  team.crmTeamId = String(team._id || team.id);
  await team.save();
  return team;
}

async function applyTeamToUsers(team) {
  const memberIds = cleanIds(team.members || []);
  const managerId = String(team.manager || '').trim();
  const operationHeadId = String(team.operationHead || '').trim();

  const memberUpdate = operationHeadId
    ? { $set: { teamId: team._id, team: team.name, managerId, operationHeadId } }
    : { $set: { teamId: team._id, team: team.name, managerId }, $unset: { operationHeadId: '' } };

  await User.updateMany({ _id: { $in: memberIds } }, memberUpdate);
  if (managerId) {
    await User.findByIdAndUpdate(
      managerId,
      operationHeadId
        ? { $set: { teamId: team._id, team: team.name, operationHeadId } }
        : { $set: { teamId: team._id, team: team.name }, $unset: { operationHeadId: '' } }
    );
  }
  if (operationHeadId) await User.findByIdAndUpdate(operationHeadId, { $set: { teamId: team._id, team: team.name } });
}

exports.listTeams = async (req, res) => {
  const teams = await Team.find()
    .populate('members', 'name email role avatarUrl isActive')
    .populate('manager', 'name email role avatarUrl isActive')
    .populate('operationHead', 'name email role avatarUrl isActive')
    .sort({ name: 1 })
    .lean();

  res.json({ ok: true, teams: teams.map(mapTeam) });
};

exports.createTeam = async (req, res) => {
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim();
  const memberIds = cleanIds(req.body.members);
  const managerId = String(req.body.manager || req.body.managerId || '').trim();
  const operationHeadId = String(req.body.operationHead || req.body.operationHeadId || '').trim();

  if (!name) return res.status(400).json({ error: 'Team name is required' });
  if (!managerId) return res.status(400).json({ error: 'Manager is required' });

  const existing = await Team.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
  if (existing) return res.status(400).json({ error: 'Team name already exists' });

  const allUserIds = [...new Set([...memberIds, managerId, operationHeadId].filter(Boolean))];
  if (memberIds.includes(managerId)) return res.status(400).json({ error: 'Manager cannot also be selected as a team member' });
  if (operationHeadId && memberIds.includes(operationHeadId)) return res.status(400).json({ error: 'Operation Head cannot also be selected as a team member' });

  const users = await User.find({ _id: { $in: allUserIds }, isActive: true }).select('_id role name').lean();
  if (users.length !== allUserIds.length) return res.status(400).json({ error: 'Select only active CRM users for this team' });
  const manager = users.find((user) => String(user._id) === managerId);
  if (manager?.role !== 'manager') return res.status(400).json({ error: 'Selected team manager must have the Manager role' });
  const invalidMember = users.find((user) => memberIds.includes(String(user._id)) && ['manager', 'admin', 'superadmin'].includes(user.role));
  if (invalidMember) return res.status(400).json({ error: `${invalidMember.name || 'Selected user'} cannot be added as a team member because of their role` });

  const teamData = {
    name,
    description,
    members: memberIds,
    manager: managerId,
    createdBy: req.user?._id
  };
  if (operationHeadId) teamData.operationHead = operationHeadId;
  const team = await Team.create(teamData);
  await ensureCrmTeamId(team);
  if (memberIds.length) {
    await Team.updateMany(
      { _id: { $ne: team._id }, members: { $in: memberIds } },
      { $pull: { members: { $in: memberIds } } }
    );
  }

  const memberUpdate = operationHeadId
    ? { $set: { teamId: team._id, team: name, managerId, operationHeadId } }
    : { $set: { teamId: team._id, team: name, managerId }, $unset: { operationHeadId: '' } };
  await User.updateMany(
    { _id: { $in: memberIds } },
    memberUpdate
  );
  await User.findByIdAndUpdate(
    managerId,
    operationHeadId
      ? { $set: { teamId: team._id, team: name, operationHeadId } }
      : { $set: { teamId: team._id, team: name }, $unset: { operationHeadId: '' } }
  );
  if (operationHeadId) await User.findByIdAndUpdate(operationHeadId, { $set: { teamId: team._id, team: name } });

  const populated = await Team.findById(team._id)
    .populate('members', 'name email role avatarUrl isActive')
    .populate('manager', 'name email role avatarUrl isActive')
    .populate('operationHead', 'name email role avatarUrl isActive')
    .lean();

  res.status(201).json({ ok: true, team: mapTeam(populated) });
};
