// MIS completion counts need presence, not megabytes of embedded file data.
// Keep scalar types, object keys and array lengths; only long strings become a
// non-empty marker. Detailed work reports continue to read original documents.
// Keep the complete aggregate command below Atlas' 50-level BSON limit.
// Deeper values remain unchanged, preserving their original completion meaning.
function presenceValue(input, depth = 3, maxStringBytes = 4096) {
  const string = { $cond: [{ $gt: [{ $strLenBytes: '$$value' }, maxStringBytes] },
    { $cond: [{ $eq: [{ $trim: { input: '$$value' } }, ''] }, '', '[attached]'] }, '$$value'] };
  const branches = [{ case: { $eq: [{ $type: '$$value' }, 'string'] }, then: string }];
  if (depth === 0) branches.push({ case: { $eq: [{ $type: '$$value' }, 'object'] }, then: { $cond: [{ $gt: [{ $size: { $setDifference: ['url secureUrl dataUrl path publicId name fileName'.split(' ').map(key => `$$value.${key}`), [null, '', false, 0]] } }, 0] }, { url: '[attached]' }, '$$value'] } });
  if (depth > 0) branches.push(
    { case: { $isArray: '$$value' }, then: { $map: { input: '$$value', as: 'entry', in: presenceValue('$$entry', depth - 1, maxStringBytes) } } },
    { case: { $eq: [{ $type: '$$value' }, 'object'] }, then: { $arrayToObject: { $map: {
      input: { $objectToArray: '$$value' }, as: 'entry', in: { k: '$$entry.k', v: presenceValue('$$entry.v', depth - 1, maxStringBytes) }
    } } } }
  );
  return { $let: { vars: { value: input }, in: { $switch: { branches, default: '$$value' } } } };
}
// MIS consumes field presence, never the values of documents or credentials.
function fieldPresence(path) {
  return { $switch: { branches: [
    { case: { $isArray: path }, then: { $gt: [{ $size: path }, 0] } },
    { case: { $eq: [{ $type: path }, 'object'] }, then: { $gt: [{ $size: { $setDifference: ['url secureUrl dataUrl path publicId name fileName'.split(' ').map(key => `${path}.${key}`), [null, '', false, 0]] } }, 0] } },
    { case: { $eq: [{ $type: path }, 'string'] }, then: { $ne: [{ $trim: { input: path } }, ''] } },
    { case: { $in: [{ $type: path }, ['bool', 'int', 'long', 'double']] }, then: true }
  ], default: false } };
}
function presenceFields(path, fields) {
  return Object.fromEntries(fields.split(' ').map(field => [field, { $cond: [fieldPresence(`${path}.${field}`), true, ''] }]));
}
function presenceObject(path, fields) {
  return { $arrayToObject: { $map: {
    input: { $filter: { input: { $objectToArray: { $cond: [{ $eq: [{ $type: path }, 'object'] }, path, {}] } }, as: 'field', cond: { $in: ['$$field.k', fields.split(' ')] } } },
    as: 'field', in: { k: '$$field.k', v: { $cond: [fieldPresence('$$field.v'), true, ''] } }
  } } };
}
function presenceRows(path, fields) {
  return { $map: { input: { $cond: [{ $isArray: path }, path, []] }, as: 'row', in: presenceObject('$$row', fields) } };
}
const personFields = 'name designation department reporting mobile email pan panDocument aadhaarNumber aadhaarDocument';
const documentFields = ['gst', 'cin', 'pan', 'factoryLicense', 'eprCertificate', 'iec', 'dicDcssi'].flatMap(key => ['Number', 'Date', 'File'].map(suffix => key + suffix)).join(' ');
const completionData = {
  basic: Object.fromEntries('clientLegalName tradeName companyType piboCategory subApplicantType applicantType eprCategory onboardingYear firstAnnualReturnYear servicesOffered applicableService plantUnit industryType'.split(' ').map(field => [field, `$data.basic.${field}`])),
  companyOverview: presenceObject('$data.companyOverview', 'companyName companySummary productName productImage category'),
  registeredAddress: presenceObject('$data.registeredAddress', 'address1 address2 address3 state city pincode'),
  communicationAddress: presenceObject('$data.communicationAddress', 'address1 address2 address3 state city pincode'),
  compliance: { $mergeObjects: [presenceObject('$data.compliance', documentFields), { msmeApplicable: '$data.compliance.msmeApplicable', brandOwnerProductionFacility: '$data.compliance.brandOwnerProductionFacility', factoryLicenseApplicability: '$data.compliance.factoryLicenseApplicability' }] },
  cpcbOnboarding: { cpcbPortalRegistered: '$data.cpcbOnboarding.cpcbPortalRegistered' },
  msmeRows: presenceRows('$data.msmeRows', 'classificationYear status majorActivity udyamNumber turnover file'),
  cte: { cteApplicable: '$data.cte.cteApplicable', ...presenceFields('$data.cte', 'numberOfPlantsLocations'), plantWiseDetails: { $map: { input: { $cond: [{ $isArray: '$data.cte.plantWiseDetails' }, '$data.cte.plantWiseDetails', []] }, as: 'plant', in: { $mergeObjects: [presenceObject('$$plant', 'plantName cteConsentNo cteCategory cteIssuedDate cteValidDate plantLocation cteDocument ctoOrderNo ctoIssueDate ctoValidDate ctoDocument'), {
    cteProductionRows: presenceRows('$$plant.cteProductionRows', 'productName capacity'), ctoProductRows: presenceRows('$$plant.ctoProductRows', 'productName quantity')
  }] } } } },
  cpcb: { $mergeObjects: [presenceObject('$data.cpcb', 'status remark homePageFile registrationNumber applicationDate approvalDate applicationNumber ceprUserId ceprPassword loginId loginPassword unitId'), { linkedToCommonPortal: '$data.cpcb.linkedToCommonPortal', processDiagramRequired: '$data.cpcb.processDiagramRequired' }] },
  cpcbScreenshots: presenceRows('$data.cpcbScreenshots', 'name file'), processDiagrams: presenceRows('$data.processDiagrams', 'name file'),
  otp: presenceObject('$data.otp', 'mobile personName designation'), authorised: presenceObject('$data.authorised', personFields), authorisedPersons: presenceRows('$data.authorisedPersons', personFields), coordinating: presenceObject('$data.coordinating', 'name designation department reporting mobile email')
};
completionData.assignedServiceId = '$data.assignedServiceId';
completionData.selectedLeadSnapshot = Object.fromEntries('assignedServiceId applicantType piboParent subApplicantType piboCategory eprCategory serviceCategory servicesOffered applicableService plantUnit businessCategory'.split(' ').map(field => [field, `$data.selectedLeadSnapshot.${field}`]));
const misClientProjection = { createdBy: 1, workflowStatus: 1, 'adminControls.approvalStatus': 1,
  createdAt: 1, updatedAt: 1, selectedLead: 1, assignedServiceId: 1, data: completionData };
async function readMisClients(Client, filter) {
  try {
    return await require('./dashboardSnapshotCache').readDashboardCollection(Client, filter, misClientProjection);
  } catch (error) {
    if (error.code !== 8000) throw error;
    console.warn('[MIS] Atlas rejected compact projection; reading original scoped records.');
    return Client.find(filter).select('createdBy data workflowStatus adminControls.approvalStatus createdAt updatedAt selectedLead assignedServiceId').maxTimeMS(20000).lean();
  }
}
module.exports = { presenceValue, misClientProjection, readMisClients };
