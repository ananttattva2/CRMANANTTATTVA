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
  users.forEach(user => [user._id, user.crmUserId, user.name, user.email].filter(Boolean).forEach(value => identities.set(id(value).trim().toLowerCase(), user)));
  const index = records => new Map(records.map(record => [id(record.clientId), record]));
  const purchaseIndex = index(purchases), salesIndex = index(sales), groups = new Map();
  for (const client of clients) {
    const candidates = [client.adminControls?.assignedTo, client.data?.importMeta?.assignedTo, client.data?.importMeta?.user, client.data?.importMeta?.userName, client.createdBy];
    const user = candidates.map(value => identities.get(id(value).trim().toLowerCase())).find(Boolean);
    const ownerId = id(user?._id) || id(client.adminControls?.assignedTo || client.createdBy) || 'unassigned';
    if (!groups.has(ownerId)) groups.set(ownerId, { userId: ownerId, userName: user?.name || user?.email || 'Unassigned', clients: [], slaReceived: 0, slaNotReceived: 0, purchase: STAGES.map(() => ({ complete: 0, progress: 0, pending: 0 })), sales: STAGES.map(() => ({ complete: 0, progress: 0, pending: 0 })) });
    const group = groups.get(ownerId);
    const detail = { clientId: id(client._id), clientName: client.data?.basic?.clientLegalName || client.data?.basic?.tradeName || client.data?.importMeta?.companyName || 'Untitled client', slaReceived: client.sla?.status === 'Yes', purchase: STAGES.map(stage => stageState(purchaseIndex.get(id(client._id)), stage)), sales: STAGES.map(stage => stageState(salesIndex.get(id(client._id)), stage)) };
    group.clients.push(detail); group[detail.slaReceived ? 'slaReceived' : 'slaNotReceived']++;
    for (const module of ['purchase', 'sales']) detail[module].forEach((state, position) => group[module][position][state]++);
  }
  return [...groups.values()].sort((a, b) => a.userName.localeCompare(b.userName));
}
module.exports = { STAGES, stageState, buildUploadTracker };
