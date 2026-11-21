const Client = require('../models/Client');
const Lead = require('../models/Lead');
const User = require('../models/User');
const { loadDashboardAssignments } = require('./dashboardReadModel');
const { mergeManagerStaffAllocations, dashboardStatusClient } = require('./managerStaffAllocations');
const { buildUploadTracker } = require('./clientUploadTracker');
const { getAssignmentDashboardLeadReferences, dashboardClientExclusionFilter, dashboardLeadExclusionFilter } = require('./dashboardTestLeadExclusion');
const { getVisibleUserScope } = require('../utils/visibilityScope');

function legalRows(clients, users) {
  return buildUploadTracker(clients, users, [], []).flatMap(user => user.clients.map(client => ({
    id: `${user.userId}:${client.companyKey}`, clientId: client.clientId,
    clientName: client.clientName, userId: user.userId, userName: user.userName,
    slaStatus: client.slaReceived ? 'Yes' : 'No'
  }))).sort((a, b) => a.clientName.localeCompare(b.clientName) || a.userName.localeCompare(b.userName));
}
function visibleLegalRows(rows, scope) {
  if (scope === null) return rows;
  const allowed = new Set((scope?.ids || []).map(String));
  return rows.filter(row => allowed.has(row.userId));
}
async function loadLegalSla(requester = null) {
  const scope = requester ? await getVisibleUserScope(requester) : null;
  const excluded = await getAssignmentDashboardLeadReferences();
  const [snapshot, users] = await Promise.all([
    loadDashboardAssignments({ Client, Lead }, dashboardClientExclusionFilter(excluded), dashboardLeadExclusionFilter(excluded)),
    User.find({ isActive: { $ne: false } }).select('_id name email role roles crmUserId isActive').maxTimeMS(15000).lean()
  ]);
  // SLA changes must be reflected immediately, independently of cached dashboard snapshots.
  const saved = await Client.find({ _id: { $in: snapshot.clients.map(client => client._id) } }).select('_id sla.status').maxTimeMS(15000).lean();
  const sla = new Map(saved.map(client => [String(client._id), client.sla || {}]));
  const clients = mergeManagerStaffAllocations(snapshot.clients.map(client => dashboardStatusClient({ ...client, sla: sla.get(String(client._id)) || {} })), snapshot.leads);
  // Aggregate with the full owner directory before applying scope so duplicate names cannot change ownership.
  const rows = visibleLegalRows(legalRows(clients, users), scope);
  return { rows, users, visibility: scope === null ? 'all' : 'assigned' };
}
module.exports = { loadLegalSla, legalRows, visibleLegalRows };
