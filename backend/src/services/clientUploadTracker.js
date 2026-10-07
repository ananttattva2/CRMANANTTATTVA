const { userHasAnyRole } = require('../utils/userRoles');
const { allocatedOwnerKeyGroups } = require('./overallDashboardUsers');
const STAGES = ['Data Explained', 'Data Format Sent', 'Received from client', 'Ready to upload', 'Client Approval on data', 'Upload Complete'];
const id = value => String(value?._id || value || '');
function stageState(record, stage) {
  const row = record?.checklist?.find(item => item.particular === stage);
  if (stage === 'Upload Complete') return record?.baseUpload?.importStatus === 'Imported' && record?.portalUpload?.importStatus === 'Imported' ? 'complete' : record?.baseUpload?.importStatus === 'Imported' || record?.portalUpload?.importStatus === 'Imported' || row?.yesNo === 'Yes' ? 'progress' : 'pending';
  if (row?.yesNo === 'Yes') return row.partialDataReceived && !row.completeDataReceived ? 'progress' : 'complete';
  return row?.date || row?.files?.length || row?.remarks ? 'progress' : 'pending';
}
function buildUploadTracker(clients, users, purchases, sales) {
  const identities = new Map();
  users = users.filter(user => user.isActive !== false && userHasAnyRole(user, ['operation', 'operations', 'manager']) && !userHasAnyRole(user, ['admin', 'superadmin', 'sales']));
  users.forEach(user => [user._id, user.crmUserId, user.name, user.email].filter(Boolean).forEach(value => identities.set(id(value).trim().toLowerCase(), user)));
  const index = records => new Map(records.map(record => [id(record.clientId), record]));
  const purchaseIndex = index(purchases), salesIndex = index(sales), groups = new Map();
  const emptyGroup = user => ({ userId: id(user._id), userName: user.name || user.email || 'Team member', clients: [], slaReceived: 0, slaNotReceived: 0, purchase: STAGES.map(() => ({ complete: 0, progress: 0, pending: 0 })), sales: STAGES.map(() => ({ complete: 0, progress: 0, pending: 0 })) });
  users.filter(user => userHasAnyRole(user, ['manager'])).forEach(user => groups.set(id(user._id), emptyGroup(user)));
  const seen = new Set();
  for (const client of clients) {
    const clientId = id(client._id);
    if (!clientId || seen.has(clientId)) continue;
    seen.add(clientId);
    const [permanent] = allocatedOwnerKeyGroups(client);
    const user = permanent.map(key => identities.get(key)).find(Boolean);
    if (!user) continue;
    const ownerId = id(user._id);
    if (!groups.has(ownerId)) groups.set(ownerId, emptyGroup(user));
    const group = groups.get(ownerId);
    const detail = { clientId: id(client._id), clientName: client.data?.basic?.clientLegalName || client.data?.basic?.tradeName || client.data?.importMeta?.companyName || 'Untitled client', slaReceived: client.sla?.status === 'Yes', purchase: STAGES.map(stage => stageState(purchaseIndex.get(id(client._id)), stage)), sales: STAGES.map(stage => stageState(salesIndex.get(id(client._id)), stage)) };
    group.clients.push(detail); group[detail.slaReceived ? 'slaReceived' : 'slaNotReceived']++;
    for (const module of ['purchase', 'sales']) detail[module].forEach((state, position) => group[module][position][state]++);
  }
  return [...groups.values()].sort((a, b) => a.userName.localeCompare(b.userName));
}
module.exports = { STAGES, stageState, buildUploadTracker };
