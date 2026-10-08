const { userHasAnyRole } = require('../utils/userRoles');
const { allocatedOwnerKeyGroups } = require('./overallDashboardUsers');
const { assignedCompanyKey } = require('./assignedCompanyIdentity');
const STAGES = ['Data Explained', 'Data Format Sent', 'Received from client', 'Ready to upload', 'Client Approval on data', 'Upload Complete', 'Manager Review', 'Compliance Review'];
const id = value => String(value?._id || value || '');
function matchesTrackedService(client, type) {
  const data = client.data || {}, lead = client.selectedLead || {};
  const selected = String(client.assignedServiceId || data.selectedLeadSnapshot?.assignedServiceId || '');
  const selections = lead.serviceSelections || [];
  const service = selections.find(item => String(item.assignedServiceId || item.serviceAssignmentId || '') === selected) || (selections.length === 1 ? selections[0] : {});
  const offered = service.servicesOffered ?? data.basic?.servicesOffered ?? data.selectedLeadSnapshot?.servicesOffered ?? [];
  return (Array.isArray(offered) ? offered : [offered]).some(value => {
    const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return type === 'annual' ? /annual(?:return(?:fill?ing)?|fill?ing)/.test(normalized) : type === 'registration' ? ['registration', 'newregistration'].includes(normalized) : true;
  });
}
function stageState(record, stage) {
  if (stage === 'Manager Review' || stage === 'Compliance Review') {
    const status = stage === 'Manager Review' ? record?.managerVerificationStatus : record?.complianceVerificationStatus;
    return String(status || '').trim().toLowerCase() === 'approved' ? 'complete' : 'pending';
  }
  const row = record?.checklist?.find(item => item.particular === stage);
  if (stage === 'Upload Complete') return record?.baseUpload?.importStatus === 'Imported' && record?.portalUpload?.importStatus === 'Imported' ? 'complete' : record?.baseUpload?.importStatus === 'Imported' || record?.portalUpload?.importStatus === 'Imported' || row?.yesNo === 'Yes' ? 'progress' : 'pending';
  if (row?.yesNo === 'Yes') return row.partialDataReceived && !row.completeDataReceived ? 'progress' : 'complete';
  return row?.date || row?.files?.length || row?.remarks ? 'progress' : 'pending';
}
function applicationDescriptor(client) {
  const data = client.data || {}, basic = data.basic || {}, lead = client.selectedLead || {};
  const selections = lead.serviceSelections || [];
  const service = selections.find(row => String(row.assignedServiceId || row.serviceAssignmentId || '') === String(client.assignedServiceId || '')) || (selections.length === 1 ? selections[0] : {});
  const category = [basic.piboCategory, basic.subApplicantType, service.subApplicantType, service.piboCategory, basic.applicantType, service.applicantType].find(value => typeof value === 'string' && value.trim()) || 'Not recorded';
  const key = category.toLowerCase().replace(/[^a-z0-9]/g, '');
  const canonical = key.includes('rawmaterial') && key.includes('import') || key.includes('simp') && key.includes('import') ? 'Importer of Raw Material'
    : (key.includes('simp') || key.includes('smallmicro')) && key.includes('produc') ? 'Producer (Small & Micro)'
    : key.includes('recycler') ? 'Recycler' : key.includes('brandowner') ? 'Brand Owner' : key.includes('importer') ? 'Importer'
    : key.includes('producer') ? 'Producer' : key === 'pwp' || key.includes('plasticwasteprocessor') ? 'PWP' : category.trim();
  const offered = service.servicesOffered ?? basic.servicesOffered ?? data.selectedLeadSnapshot?.servicesOffered ?? [];
  const primary = (Array.isArray(offered) ? offered : [offered]).flatMap(value => String(value || '').split(/[,;\n]/)).map(value => value.trim()).find(Boolean) || '';
  const normalized = primary.toLowerCase().replace(/[^a-z0-9]/g, '');
  const serviceType = /annual(?:return(?:fill?ing)?|fill?ing)/.test(normalized) ? 'annual' : ['registration','newregistration'].includes(normalized) ? 'registration' : '';
  return { category: canonical, serviceType, offered: primary };
}
function buildUploadTracker(clients, users, purchases, sales, options = {}) {
  const identities = new Map();
  users = users.filter(user => user.isActive !== false && userHasAnyRole(user, ['operation', 'operations', 'manager']) && !userHasAnyRole(user, ['admin', 'superadmin', 'sales']));
  users.forEach(user => [user._id, user.crmUserId, user.name, user.email].filter(Boolean).forEach(value => identities.set(id(value).trim().toLowerCase(), user)));
  const index = records => new Map(records.map(record => [id(record.clientId), record]));
  const purchaseIndex = index(purchases), salesIndex = index(sales), groups = new Map();
  const emptyGroup = user => ({ userId: id(user._id), userName: user.name || user.email || 'Team member', clients: [], slaReceived: 0, slaNotReceived: 0, purchase: STAGES.map(() => ({ complete: 0, progress: 0, pending: 0 })), sales: STAGES.map(() => ({ complete: 0, progress: 0, pending: 0 })) });
  users.filter(user => userHasAnyRole(user, ['manager'])).forEach(user => groups.set(id(user._id), emptyGroup(user)));
  const seen = new Set();
  for (const client of clients) {
    if (options.serviceType && !matchesTrackedService(client, options.serviceType)) continue;
    const clientId = id(client._id);
    if (!clientId || seen.has(clientId)) continue;
    seen.add(clientId);
    const [permanent] = allocatedOwnerKeyGroups(client);
    const user = permanent.map(key => identities.get(key)).find(Boolean);
    if (!user) continue;
    const ownerId = id(user._id);
    if (!groups.has(ownerId)) groups.set(ownerId, emptyGroup(user));
    const group = groups.get(ownerId);
    const detail = { clientId: id(client._id), clientName: client.selectedLead?.company || client.selectedLead?.companyName || client.data?.basic?.clientLegalName || client.data?.basic?.tradeName || client.data?.importMeta?.companyName || 'Untitled client', slaReceived: client.sla?.status === 'Yes', purchase: STAGES.map(stage => stageState(purchaseIndex.get(id(client._id)), stage)), sales: STAGES.map(stage => stageState(salesIndex.get(id(client._id)), stage)) };
    detail.companyKey = assignedCompanyKey(client);
    detail.clientIds = [clientId];
    if (options.groupBy === 'application') {
      const descriptor = applicationDescriptor(client);
      Object.assign(detail, descriptor);
      detail.companyKey += ':' + descriptor.category.toLowerCase().replace(/[^a-z0-9]/g, '');
    }
    const existing = group.clients.find(row => row.companyKey === detail.companyKey);
    if (existing) {
      existing.clientIds.push(clientId);
      // SLA is a company-level receipt, even when only one service's Client Master stores it.
      existing.slaReceived = existing.slaReceived || detail.slaReceived;
      for (const module of ['purchase', 'sales']) existing[module] = existing[module].map((state, position) => state === 'complete' && detail[module][position] === 'complete' ? 'complete' : position >= 6 || state === 'pending' && detail[module][position] === 'pending' ? 'pending' : 'progress');
    } else group.clients.push(detail);
  }
  for (const group of groups.values()) for (const detail of group.clients) {
    group[detail.slaReceived ? 'slaReceived' : 'slaNotReceived']++;
    for (const module of ['purchase', 'sales']) detail[module].forEach((state, position) => group[module][position][state]++);
  }
  return [...groups.values()].sort((a, b) => a.userName.localeCompare(b.userName));
}
module.exports = { STAGES, stageState, buildUploadTracker, matchesTrackedService, applicationDescriptor };
