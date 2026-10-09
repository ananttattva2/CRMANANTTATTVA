// Dashboard reads need status and ownership, never embedded proof documents.
const { createOverallCache } = require('./overallDashboardData');
const compactFields = (prefix, fields) => Object.fromEntries(fields.split(' ').map(field => [field, `${prefix}.${field}`]));
const poFields = 'fy poFinancialYear annualReturnYear poNumber poNo poDate poReceivedDate poEndDate poAmount paymentTerm services';
function compactPo(prefix) {
  const url = { $ifNull: [`${prefix}.poFileUrl`, ''] };
  return {
    ...compactFields(prefix, poFields),
    // Retain ordinary links; base64 proofs can be several megabytes each.
    poFileUrl: { $cond: [{ $lte: [{ $strLenBytes: url }, 4096] }, url, ''] },
    poFileName: { $cond: [
      { $ne: [{ $ifNull: [`${prefix}.poFileName`, ''] }, ''] }, `${prefix}.poFileName`,
      { $cond: [{ $ne: [url, ''] }, 'Purchase Order', ''] }
    ] }
  };
}
function assignmentProjection(prefix) {
  return {
    ...compactFields(prefix, 'assignedServiceId serviceAssignmentId assignedTo assignedToText assignedToEmail assignedStaff assignedStaffText assignedStaffEmail closedAt closedBy closedByText permanentClosedAt servicesOffered poStatus'),
    poYearRows: { $map: { input: { $ifNull: [`${prefix}.poYearRows`, []] }, as: 'po', in: compactPo('$$po') } },
    originalPoDetails: compactPo(`${prefix}.originalPoDetails`)
  };
}
const leadProjection = {
  ...Object.fromEntries('_id company companyName clientName companyIdentity leadCode sourceLeadId status closedAt closedBy assignedStaff assignedStaffText assignedStaffEmail assignedTo assignedToText assignedToEmail firstAnnualReturnYearApplicable'.split(' ').map(field => [field, 1])),
  assignments: { $map: { input: { $ifNull: ['$assignments', []] }, as: 'assignment', in: assignmentProjection('$$assignment') } },
  serviceSelections: { $map: { input: { $ifNull: ['$serviceSelections', []] }, as: 'service', in: compactFields('$$service', 'assignedServiceId serviceAssignmentId subApplicantType piboCategory applicantType piboParent firstAnnualReturnYearApplicable financialYear servicesForYear servicesOffered applicableService industryType eprCategory plantUnit') } }
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
  'createdAt', 'submittedAt', 'sla.status', 'firstAnnualReturnYear', 'financialYear',
  ...'clientLegalName tradeName piboCategory subApplicantType applicantType servicesOffered applicableService cpcbStatus plantUnit companyIndustry industryType eprCategory state firstAnnualReturnYear servicesForYear'.split(' ').map(field => `data.basic.${field}`),
  ...'companyName assignedTo user userName leadNumber clientCode uniqueId clientStatus visibilityStatus cpcbStatus state approvalOverride'.split(' ').map(field => `data.importMeta.${field}`),
  'data.cpcb.status', 'data.cpcb.approvalStatus', 'data.cpcb.applicationStatus', 'data.assignedServiceId',
  ...'id sourceLeadId leadCode assignedServiceId company plantUnit servicesOffered applicableService piboCategory subApplicantType applicantType industryType eprCategory assignedStaff assignedStaffText assignedStaffEmail'.split(' ').map(field => `data.selectedLeadSnapshot.${field}`),
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
  let read = createOverallCache({ ttl: 15000, ...options });
  const invalidate = () => { read = createOverallCache({ ttl: 15000, ...options }); };
  caches.add(invalidate);
  return (key, load) => read(key, load);
}
function invalidateDashboardReads() { for (const invalidate of caches) invalidate(); }
const cachedAssignments = createDashboardCache({ maxEntries: 2 });
const staffFields = ['assignedStaff', 'assignedStaffText', 'assignedStaffEmail'];
const present = field => ({ [field]: { $exists: true, $nin: [null, ''] } });
const permanentStaffFilter = {
  $or: [...staffFields.map(present), { assignments: { $elemMatch: { $or: staffFields.map(present) } } }]
};
async function loadDashboardAssignments({ Client, Lead }, clientFilter, leadFilter) {
  // The same compact snapshot serves all users; role filtering still happens
  // after loading it and no response is shared between authorization scopes.
  return cachedAssignments(JSON.stringify({ clientFilter, leadFilter }), async () => {
    const [clients, leads] = await Promise.all([
      Client.aggregate([
        { $match: clientFilter },
        // Only permanently allocated clients contribute to these dashboards.
        // Resolve that eligibility in MongoDB before transferring client forms.
        { $lookup: {
          from: Lead.collection?.name || 'leads', localField: 'selectedLead', foreignField: '_id',
          pipeline: [{ $match: permanentStaffFilter }, { $project: { _id: 1 } }], as: 'dashboardAssignedLead'
        } },
        { $match: { $or: [...staffFields.map(present), { 'dashboardAssignedLead.0': { $exists: true } },
          ...staffFields.map(field => present(`data.selectedLeadSnapshot.${field}`)),
          { 'data.selectedLeadSnapshot.assignments': { $elemMatch: { $or: staffFields.map(present) } } }] } },
        { $project: clientProjection }
      ]).option({ maxTimeMS: 12000 }),
      Lead.aggregate([{ $match: { $and: [leadFilter, permanentStaffFilter] } }, { $project: leadProjection }]).option({ maxTimeMS: 12000 })
    ]);
    const byId = new Map(leads.map(lead => [String(lead._id), lead]));
    // A legacy Client Master may have its own permanent owner even when its
    // linked lead does not. Keep that lead's service/status context intact.
    const missingIds = [...new Map(clients.filter(client => client.selectedLead && !byId.has(String(client.selectedLead))).map(client => [String(client.selectedLead), client.selectedLead])).values()];
    if (missingIds.length) {
      const linked = await Lead.aggregate([{ $match: { _id: { $in: missingIds } } }, { $project: leadProjection }]).option({ maxTimeMS: 12000 });
      for (const lead of linked) byId.set(String(lead._id), lead);
    }
    return { clients: clients.map(client => ({ ...client, selectedLead: byId.get(String(client.selectedLead)) || client.selectedLead })), leads };
  });
}
module.exports = { leadProjection, clientProjection, compactPo, loadDashboardAssignments, createDashboardCache, invalidateDashboardReads };
