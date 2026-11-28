// Dashboard reads need status and ownership, never embedded proof documents.
const { createOverallCache } = require('./overallDashboardData');
const { Types } = require('mongoose');
const compactFields = (prefix, fields) => Object.fromEntries(fields.split(' ').map(field => [field, `${prefix}.${field}`]));
const poFields = 'fy poFinancialYear annualReturnYear poNumber poNo poDate poReceivedDate poEndDate poAmount paymentTerm';
function compactPo(prefix) {
  const url = { $ifNull: [`${prefix}.poFileUrl`, ''] };
  return {
    ...compactFields(prefix, poFields),
    // Analytics needs evidence presence; detail endpoints retain the real file URL.
    poFileUrl: { $cond: [{ $ne: [url, ''] }, 'proof-present', ''] },
    services: { $map: { input: { $ifNull: [`${prefix}.services`, []] }, as: 'service', in: { $cond: [{ $eq: [{ $type: '$$service' }, 'string'] }, '$$service', { name: { $ifNull: ['$$service.name', { $ifNull: ['$$service.label', { $ifNull: ['$$service.servicesOffered', '$$service.applicableService'] }] }] } }] } } },
    poFileName: { $cond: [
      { $ne: [{ $ifNull: [`${prefix}.poFileName`, ''] }, ''] }, `${prefix}.poFileName`,
      { $cond: [{ $ne: [url, ''] }, 'Purchase Order', ''] }
    ] }
  };
}
function assignmentProjection(prefix) {
  return {
    ...compactFields(prefix, 'assignedServiceId serviceAssignmentId assignedTo assignedToText assignedToEmail assignedStaff assignedStaffText assignedStaffEmail closedAt closedBy closedByText closedByEmail permanentClosedAt servicesOffered poStatus poApprovalStatus accountsRecordId'),
    poYearRows: { $map: { input: { $ifNull: [`${prefix}.poYearRows`, []] }, as: 'po', in: compactPo('$$po') } },
    originalPoDetails: compactPo(`${prefix}.originalPoDetails`)
  };
}
const leadProjection = {
  ...Object.fromEntries('_id company companyName clientName companyIdentity leadCode leadNumber sourceLeadId externalLeadId status closedAt closedBy closedByText closedByEmail assignedStaff assignedStaffText assignedStaffEmail assignedTo assignedToText assignedToEmail firstAnnualReturnYearApplicable servicesOffered applicableService applicantType subApplicantType piboCategory industryType eprCategory plantUnit accountsRecordId'.split(' ').map(field => [field, 1])),
  assignments: { $map: { input: { $ifNull: ['$assignments', []] }, as: 'assignment', in: assignmentProjection('$$assignment') } },
  serviceSelections: { $map: { input: { $ifNull: ['$serviceSelections', []] }, as: 'service', in: compactFields('$$service', 'assignedServiceId serviceAssignmentId subApplicantType piboCategory applicantType piboParent firstAnnualReturnYearApplicable financialYear servicesForYear annualReturnYears servicesOffered applicableService industryType eprCategory serviceCategory plantUnit serviceStartDate serviceEndDate dueDate accountsRecordId') } }
};
const statusFields = prefix => compactFields(prefix, 'status approvalStatus applicationStatus');
function scopedStatus(path) {
  return { $arrayToObject: { $map: { input: { $objectToArray: { $ifNull: [path, {}] } }, as: 'scope', in: {
    k: '$$scope.k', v: { ...statusFields('$$scope.v'), cpcb: Object.fromEntries('status approvalStatus applicationStatus'.split(' ').map(field => [field, { $ifNull: [`$$scope.v.cpcb.${field}`, `$$scope.v.${field}`] }])), registeredAddress: { state: '$$scope.v.registeredAddress.state' } }
  } } } };
}
const clientProjection = Object.fromEntries([
  '_id', 'createdBy', 'workflowStatus', 'assignedServiceId', 'assignedStaff', 'assignedStaffText', 'assignedStaffEmail',
  'assignedTo', 'assignedUser', 'userName', 'user', 'adminControls', 'serviceAllocations', 'selectedLead',
  'createdAt', 'updatedAt', 'submittedAt', 'sla.status', 'firstAnnualReturnYear', 'financialYear',
  ...'clientLegalName tradeName piboCategory subApplicantType applicantType servicesOffered applicableService cpcbStatus plantUnit companyIndustry industryType eprCategory serviceCategory state firstAnnualReturnYear servicesForYear'.split(' ').map(field => `data.basic.${field}`),
  ...'companyName assignedTo user userName leadNumber clientCode uniqueId clientStatus visibilityStatus cpcbStatus state approvalOverride'.split(' ').map(field => `data.importMeta.${field}`),
  'data.cpcb.status', 'data.cpcb.approvalStatus', 'data.cpcb.applicationStatus', 'data.assignedServiceId',
  'data.selectedLead',
  ...'id sourceLeadId externalLeadId leadCode assignedServiceId serviceAssignmentId company plantUnit servicesOffered applicableService piboCategory subApplicantType applicantType industryType eprCategory serviceCategory assignedStaff assignedStaffText assignedStaffEmail closedAt closedBy closedByText closedByEmail permanentClosedAt accountsRecordId'.split(' ').map(field => `data.selectedLeadSnapshot.${field}`),
  'data.address.state', 'data.addresses.state', 'data.registeredAddress.state', 'data.serviceAllocations', 'data.firstAnnualReturnYearApplicable',
  ...'compliancePoNo poNo poNumber compliancePoDate poDate compliancePoFileName poFileName poFinancialYear'.split(' ').map(field => `data.financials.${field}`),
  ...'poNumber poNo poDate poFileName poFinancialYear'.split(' ').map(field => `data.validation.${field}`),
  ...['otp', 'authorised', 'coordinating'].flatMap(section => ['email', 'mobile', 'mobileNo'].map(field => `data.${section}.${field}`))
].map(field => [field, 1]));
clientProjection['data.cpcbDataByAssignedServiceId'] = scopedStatus('$data.cpcbDataByAssignedServiceId');
clientProjection['data.serviceDetailsByAssignedServiceId'] = scopedStatus('$data.serviceDetailsByAssignedServiceId');
clientProjection['data.selectedLeadSnapshot.assignments'] = {
  $map: { input: { $ifNull: ['$data.selectedLeadSnapshot.assignments', []] }, as: 'assignment', in: assignmentProjection('$$assignment') }
};
clientProjection['data.selectedLeadSnapshot.serviceSelections'] = {
  $map: { input: { $ifNull: ['$data.selectedLeadSnapshot.serviceSelections', []] }, as: 'service', in: leadProjection.serviceSelections.$map.in }
};

const caches = new Set();
function createDashboardCache(options = {}) {
  if (options.name) {
    return (key, load) => require('./crmCache').getCrmCache().remember(`${options.name}:${key}`, load);
  }
  let read = createOverallCache({ ttl: 0, ...options });
  const invalidate = () => { read = createOverallCache({ ttl: 0, ...options }); };
  caches.add(invalidate);
  return (key, load) => read(key, load);
}
function invalidateDashboardReads() { for (const invalidate of caches) invalidate(); }
// Version the shared snapshot whenever its identity/join semantics change so a
// deployment cannot serve the previous Redis payload for otherwise-correct data.
// v4 discards snapshots captured before permanent service-staff ownership was
// made authoritative (for example ATUL LTD retaining Nitin import metadata
// after its live service was assigned to Tushar).
const cachedAssignments = createDashboardCache({ name: 'dashboard-assignments-v9', maxEntries: 2 });
const staffFields = ['assignedStaff', 'assignedStaffText', 'assignedStaffEmail'];
const legacyClosedOwnerFields = ['closedBy', 'closedByText', 'closedByEmail'];
const present = field => ({ [field]: { $exists: true, $nin: [null, ''] } });
const permanentStaffFilter = {
  $or: [
    ...staffFields.map(present),
    { assignments: { $elemMatch: { $or: staffFields.map(present) } } },
    // Legacy closed services sometimes saved only the Operations closer. The
    // user-role check still happens after loading, so sales/admin closers do
    // not become Operations owners.
    ...legacyClosedOwnerFields.map(present),
    { assignments: { $elemMatch: { $or: legacyClosedOwnerFields.map(present) } } }
  ]
};
function hasPermanentOwner(record, includeLegacy = true) {
  if (!record || typeof record !== 'object') return false;
  const fields = includeLegacy ? [...staffFields, ...legacyClosedOwnerFields] : staffFields;
  const presentOwner = row => fields.some(field => row?.[field] != null && row[field] !== '');
  return presentOwner(record) || (includeLegacy && (Array.isArray(record.assignments) && record.assignments.some(presentOwner)));
}
const identity = value => {
  if (value == null) return '';
  if (typeof value.toHexString === 'function') return value.toHexString();
  if (typeof value === 'object') value = value._id || value.id || value.leadId || '';
  return String(value).trim();
};
const leadCodeNumber = value => /^atpl-(?:lead-)?0*(\d+)$/i.exec(value)?.[1];
const referenceKey = value => {
  const number = leadCodeNumber(value);
  return number ? `atpl-lead-${number.padStart(4, '0')}` : value.toLowerCase();
};
const accountIdsOnLead = lead => [...new Set([
  ...(Array.isArray(lead?.serviceSelections) ? lead.serviceSelections : []).map(service => service?.accountsRecordId), lead?.accountsRecordId
].map(identity).filter(Boolean))];
const compactCompany = value => identity(value).toLowerCase().replace(/[^a-z0-9]/g, '');

async function hydratePortfolioLeadAccounts(Lead, clients, leadFilter, { includeServiceProfiles = false } = {}) {
  // Use only already-visible Client Masters. Look up the actual business code
  // when the saved Mongo reference points at an older copy with no accounts.
  const codesByClient = new Map();
  for (const client of clients) {
    if ((!includeServiceProfiles && client.assignmentOnly) || accountIdsOnLead(client.selectedLead).length) continue;
    const meta = client.data?.importMeta || {};
    const snapshot = client.data?.selectedLeadSnapshot || {};
    const code = [meta.leadNumber, snapshot.leadCode, meta.clientCode, meta.uniqueId, client.selectedLead?.leadCode]
      .map(identity).find(leadCodeNumber);
    if (code) codesByClient.set(client, code);
  }
  if (!codesByClient.size) return clients;
  const codes = [...new Set([...codesByClient.values()].flatMap(code => {
    const number = leadCodeNumber(code).padStart(4, '0');
    return [code, `ATPL-LEAD-${number}`, `ATPL-${number}`];
  }))];
  const leads = await Lead.aggregate([
    { $match: { $and: [leadFilter, { leadCode: { $in: codes } }] } },
    { $project: {
      leadCode: 1, company: 1, companyName: 1, clientName: 1, accountsRecordId: 1, 'serviceSelections.accountsRecordId': 1,
      ...(includeServiceProfiles ? { eprCategory: 1, ...Object.fromEntries('assignedServiceId serviceAssignmentId subApplicantType piboCategory applicantType eprCategory serviceCategory plantUnit'.split(' ').map(field => [`serviceSelections.${field}`, 1])) } : {})
    } }
  ]).option({ maxTimeMS: 12000 });
  const byCode = new Map();
  for (const lead of leads) {
    const key = referenceKey(lead.leadCode);
    byCode.set(key, [...(byCode.get(key) || []), lead]);
  }
  return clients.map(client => {
    const code = codesByClient.get(client);
    if (!code) return client;
    const names = [client.data?.basic?.clientLegalName, client.data?.selectedLeadSnapshot?.company,
      client.data?.importMeta?.companyName, client.selectedLead?.company].map(compactCompany).filter(Boolean);
    const matches = (byCode.get(referenceKey(code)) || []).filter(lead =>
      names.includes(compactCompany(lead.company || lead.companyName || lead.clientName)));
    const lead = matches.length === 1 ? matches[0] : null;
    const ids = accountIdsOnLead(lead);
    if (!ids.length) return client;
    return {
      ...client,
      portfolioLeadAccountIds: ids,
      ...(includeServiceProfiles ? {
        portfolioLeadAccountServices: (Array.isArray(lead.serviceSelections) ? lead.serviceSelections : []).filter(service => service?.accountsRecordId)
          .map(service => ({ ...service, eprCategory: service.eprCategory || service.serviceCategory || lead.eprCategory }))
      } : {})
    };
  });
}
const leadReferences = lead => [lead._id, lead.leadCode, lead.leadNumber, lead.sourceLeadId, lead.externalLeadId].map(identity).filter(Boolean);
const clientLeadReferences = client => {
  const data = client?.data || {};
  const snapshot = data.selectedLeadSnapshot || {};
  return [
    client?.selectedLead, data.selectedLead, snapshot.id, snapshot.leadCode, snapshot.sourceLeadId,
    snapshot.externalLeadId, data.importMeta?.leadNumber, data.importMeta?.uniqueId
  ].map(identity).filter(Boolean);
};
async function loadDashboardAssignments({ Client, Lead }, clientFilter, leadFilter) {
  // The same compact snapshot serves all users; role filtering still happens
  // after loading it and no response is shared between authorization scopes.
  return cachedAssignments(JSON.stringify({ clientFilter, leadFilter }), async () => {
    const [clients, leads] = await Promise.all([
      require('./dashboardSnapshotCache').readDashboardCollection(Client, clientFilter, clientProjection),
      require('./dashboardSnapshotCache').readDashboardCollection(Lead, { $and: [leadFilter, permanentStaffFilter] }, leadProjection)
    ]);
    const byId = new Map(leads.map(lead => [String(lead._id), lead]));
    // A legacy Client Master may have its own permanent owner even when its
    // linked lead does not. Keep that lead's service/status context intact.
    const missingIds = [...new Map(clients.filter(client => client.selectedLead && !byId.has(String(client.selectedLead))).map(client => [String(client.selectedLead), client.selectedLead])).values()];
    if (missingIds.length) {
      const linked = await Lead.aggregate([{ $match: { _id: { $in: missingIds } } }, { $project: leadProjection }]).option({ maxTimeMS: 12000 });
      for (const lead of linked) {
        byId.set(String(lead._id), lead);
        leads.push(lead);
      }
    }
    // Migrated Client Master drafts do not always retain the Mongo lead id.
    // Index every stable identity so statuses saved against a lead code or
    // source id survive the compact dashboard read and reach service matching.
    const byReference = new Map();
    const indexLead = lead => {
      for (const reference of leadReferences(lead).map(referenceKey)) {
        const existing = byReference.get(reference);
        if (existing !== null) byReference.set(reference, !existing || existing === lead ? lead : null);
      }
    };
    leads.forEach(indexLead);
    const linkedLead = client => byId.get(identity(client.selectedLead))
      || clientLeadReferences(client).map(reference => byId.get(reference) || byReference.get(referenceKey(reference))).find(Boolean);
    // Some imports save only a lead code. A lead owned through its Client
    // Master may be absent from the permanent-owner lead query above.
    const missingReferences = [...new Set(clients.filter(client => !linkedLead(client)
      && (hasPermanentOwner(client, false) || hasPermanentOwner(client.data?.selectedLeadSnapshot)))
      .flatMap(clientLeadReferences))];
    if (missingReferences.length) {
      const codes = [...new Set(missingReferences.flatMap(reference => {
        const number = leadCodeNumber(reference);
        return number ? [reference, `ATPL-LEAD-${number.padStart(4, '0')}`, `ATPL-${number.padStart(4, '0')}`] : [reference];
      }))];
      const ids = missingReferences.filter(reference => /^[a-f\d]{24}$/i.test(reference)).map(reference => new Types.ObjectId(reference));
      const matches = ['leadCode', 'leadNumber', 'sourceLeadId', 'externalLeadId'].map(field => ({ [field]: { $in: codes } }));
      if (ids.length) matches.push({ _id: { $in: ids } });
      const linked = await Lead.aggregate([{ $match: { $and: [leadFilter, { $or: matches }] } }, { $project: leadProjection }]).option({ maxTimeMS: 12000 });
      for (const lead of linked) {
        if (byId.has(String(lead._id))) continue;
        byId.set(String(lead._id), lead);
        leads.push(lead);
        indexLead(lead);
      }
    }
    const retained = clients.filter(client => {
      const snapshot = client.data?.selectedLeadSnapshot || {};
      return hasPermanentOwner(client, false) || hasPermanentOwner(snapshot)
        || hasPermanentOwner(linkedLead(client));
    });
    return { clients: retained.map(client => ({ ...client, selectedLead: linkedLead(client) || client.selectedLead })), leads };
  });
}
module.exports = { leadProjection, clientProjection, compactPo, loadDashboardAssignments, hydratePortfolioLeadAccounts, createDashboardCache, invalidateDashboardReads, hasPermanentOwner };
