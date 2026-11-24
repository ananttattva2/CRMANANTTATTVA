const PO_WORKFLOW_FIELDS = [
  'poStatus', 'poApprovalStatus', 'quotationSent', 'earlierQuotationProofUrl',
  'earlierQuotationProofName', 'closureRequestedBy', 'closureRequestedByText',
  'closureFinalizedByManager', 'closedBy', 'closedByText', 'closedByEmail',
  'closedAt', 'closedOnBehalfOfUser', 'closedOnBehalfOfName',
  'closedOnBehalfOfEmail', 'closureApprovalProofUrl', 'closureApprovalProofName',
  'provisionalCloseExpiresAt', 'provisionalCloseDeadlineBusinessDays',
  'originalPoConfirmed', 'permanentClosedAt', 'permanentClosedBy',
  'permanentClosedByText'
];

// A PO reassignment represents moving the commercial ownership of that
// service row as well. Preserve an existing destination assignment, but fill
// any missing manager/staff metadata from the source row so the Assign Lead
// table and downstream trackers stay aligned with the moved PO.
const SERVICE_ASSIGNMENT_FIELDS = [
  'assignedTo', 'assignedToText', 'assignedToEmail',
  'assignedStaff', 'assignedStaffText', 'assignedStaffEmail', 'assignedBy'
];

const EMPTY_FIELD_VALUE = {
  closureFinalizedByManager: false,
  provisionalCloseDeadlineBusinessDays: 0,
  originalPoConfirmed: false
};

function clean(value) {
  return String(value || '').trim();
}

function serviceForAssignment(serviceSelections = [], assignment = {}, index = -1) {
  const serviceId = clean(assignment?.assignedServiceId);
  return serviceSelections.find((service) => serviceId && clean(service?.assignedServiceId) === serviceId)
    || serviceSelections[index]
    || {};
}

function reassignPurchaseOrderAssignments({ assignments = [], serviceSelections = [], poNumber, targetAssignmentIndex }) {
  const normalizedPoNumber = clean(poNumber);
  const targetIndex = Number(targetAssignmentIndex);
  if (!normalizedPoNumber) throw new Error('PO Number is required.');
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= assignments.length) {
    throw new Error('Select a valid destination service.');
  }

  const nextAssignments = assignments.map((assignment) => ({
    ...(assignment || {}),
    poYearRows: Array.isArray(assignment?.poYearRows)
      ? assignment.poYearRows.map((row) => ({ ...(row || {}) }))
      : []
  }));
  const matches = [];
  nextAssignments.forEach((assignment, assignmentIndex) => {
    assignment.poYearRows.forEach((row, poIndex) => {
      if (clean(row?.poNumber) === normalizedPoNumber) matches.push({ assignmentIndex, poIndex });
    });
  });
  if (!matches.length) throw new Error(`PO ${normalizedPoNumber} was not found on this lead.`);
  if (matches.some(({ assignmentIndex }) => assignmentIndex === targetIndex)) {
    throw new Error(`PO ${normalizedPoNumber} is already assigned to the selected service.`);
  }
  const sourceIndexes = [...new Set(matches.map(({ assignmentIndex }) => assignmentIndex))];
  if (sourceIndexes.length !== 1) throw new Error(`PO ${normalizedPoNumber} is attached to more than one service. Resolve the duplicate before moving it.`);

  const sourceIndex = sourceIndexes[0];
  const source = nextAssignments[sourceIndex];
  const target = nextAssignments[targetIndex];
  if (target.poYearRows.some((row) => clean(row?.poNumber) === normalizedPoNumber)) {
    throw new Error(`PO ${normalizedPoNumber} already exists on the destination service.`);
  }

  const movedRows = source.poYearRows.filter((row) => clean(row?.poNumber) === normalizedPoNumber);
  source.poYearRows = source.poYearRows.filter((row) => clean(row?.poNumber) !== normalizedPoNumber);
  target.poYearRows = [...target.poYearRows, ...movedRows];

  for (const field of PO_WORKFLOW_FIELDS) {
    if (target[field] === undefined || target[field] === null || target[field] === '' || target[field] === false) {
      target[field] = source[field];
    }
  }
  for (const field of SERVICE_ASSIGNMENT_FIELDS) {
    if (target[field] === undefined || target[field] === null || target[field] === '') {
      target[field] = source[field];
    }
  }
  target.poStatus = 'received';

  if (!source.poYearRows.length) {
    for (const field of PO_WORKFLOW_FIELDS) source[field] = EMPTY_FIELD_VALUE[field] ?? '';
    source.poStatus = '';
    source.poApprovalStatus = '';
  }

  const targetService = serviceForAssignment(serviceSelections, target, targetIndex);
  const sourceService = serviceForAssignment(serviceSelections, source, sourceIndex);
  return { nextAssignments, sourceIndex, targetIndex, movedRows, sourceService, targetService };
}

function poProofManifest(rows = []) {
  return rows.map((row, rowIndex) => ({
    rowIndex,
    poNumber: clean(row?.poNumber),
    poFileUrl: clean(row?.poFileUrl),
    poFileName: clean(row?.poFileName),
    poFileMimeType: clean(row?.poFileMimeType),
    poFileSize: row?.poFileSize ?? null
  }));
}

module.exports = { reassignPurchaseOrderAssignments, poProofManifest, serviceForAssignment };
