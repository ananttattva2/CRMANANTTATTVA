const fields = (source, names) => Object.fromEntries(names.split(' ').map(name => [name, `${source}.${name}`]));
function proofPresence(source) {
  return { $cond: [{ $ne: [{ $ifNull: [source, ''] }, ''] }, 'proof-present', ''] };
}
function directoryProjection(projection) {
  const result = Object.fromEntries(projection.split(/\s+/).filter(Boolean).map(field => [field, 1]));
  result.assignments = { $map: {
    input: { $cond: [{ $isArray: '$assignments' }, '$assignments', []] }, as: 'assignment',
    in: {
      ...fields('$$assignment', 'assignedServiceId serviceAssignmentId assignmentId assignedToCrmUserId assignedStaffCrmUserId assignedTo assignedToText assignedToEmail assignedStaff assignedStaffText assignedStaffEmail assignedBy closedAt closedBy closedByText closedByEmail closedOnBehalfOfName poApprovalStatus poStatus servicesOffered permanentClosedAt provisionalClosedAt isProvisional'),
      poYearRows: { $map: {
        input: { $cond: [{ $isArray: '$$assignment.poYearRows' }, '$$assignment.poYearRows', []] }, as: 'po',
        in: { ...fields('$$po', 'poNumber poNo poDate poAmount fy poFinancialYear financialYear poFileName'),
          poFileUrl: proofPresence('$$po.poFileUrl'), poProofUrl: proofPresence('$$po.poProofUrl') }
      } }
    }
  } };
  result.serviceSelections = { $map: {
    input: { $cond: [{ $isArray: '$serviceSelections' }, '$serviceSelections', []] }, as: 'service',
    in: fields('$$service', 'assignedServiceId serviceAssignmentId industryType businessCategory eprCategory applicantType piboParent piboCategoryParent subApplicantType piboCategory servicesOffered applicableService plantUnit firstAnnualReturnYearApplicable assignedManagerName assignedManagerEmail assignedStaffName assignedStaffEmail createdByName createdByEmail closedBy closedByText closedAt')
  } };
  return result;
}
module.exports = { directoryProjection };
