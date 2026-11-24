const { cleanPoCommercialDetails } = require('./poCommercialDetails');
const BUSINESS_DAYS = 7;
const PERMANENT_PO_STATUS = 'permanently_closed';
const IST_OFFSET_MS = 330 * 60 * 1000;
const LEGACY_WINDOW_MS = 10 * 60 * 1000;

function addBusinessDaysInIst(start, days = BUSINESS_DAYS) {
  const date = new Date(new Date(start).getTime() + IST_OFFSET_MS);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid provisional closure date');
  for (let added = 0; added < days;) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) added += 1;
  }
  return new Date(date.getTime() - IST_OFFSET_MS);
}

function normalizeProvisionalClosure(row, previous = {}, now = new Date()) {
  if (row?.poStatus !== 'provisional') return row;
  let expiresAt;
  const previousExpiry = new Date(previous.provisionalCloseExpiresAt);
  if (previous.poStatus === 'provisional' && !Number.isNaN(previousExpiry.getTime())) {
    expiresAt = previous.provisionalCloseDeadlineBusinessDays === BUSINESS_DAYS
      ? previousExpiry
      : addBusinessDaysInIst(new Date(previousExpiry.getTime() - LEGACY_WINDOW_MS));
  } else {
    // Only the server starts the clock. Ignore dates supplied by clients.
    expiresAt = addBusinessDaysInIst(now);
  }
  return { ...row, provisionalCloseExpiresAt: expiresAt.toISOString(), provisionalCloseDeadlineBusinessDays: BUSINESS_DAYS };
}

function permanentlyCloseProvisionalAssignments(assignments = [], actor = {}, originalPoRows = [], now = new Date()) {
  const closedAt = new Date(now).toISOString();
  const poByAssignment = new Map(originalPoRows.map((row) => [Number(row.assignmentIndex), row]));
  let changedCount = 0;
  const rows = assignments.map((row, index) => {
    if (row?.poStatus !== 'provisional') return row;
    const po = poByAssignment.get(index) || {};
    changedCount += 1;
    return {
      ...row,
      poStatus: PERMANENT_PO_STATUS,
      originalPoConfirmed: true,
      permanentClosedAt: closedAt,
      permanentClosedBy: String(actor?._id || actor?.id || '').trim(),
      permanentClosedByText: String(actor?.name || actor?.email || '').trim(),
      originalPoDetails: {
        fy: String(po.fy || '').trim(),
        poNumber: String(po.poNumber || '').trim(),
        poDate: String(po.poDate || '').trim(),
        ...cleanPoCommercialDetails(po),
        poAmount: Math.max(0, Number(po.poAmount) || 0),
        currency: 'INR',
        service: String(po.service || '').trim(),
        assignedServiceId: String(po.assignedServiceId || row.assignedServiceId || '').trim(),
        poFileUrl: String(po.poFileUrl || '').trim(),
        poFileName: String(po.poFileName || '').trim(),
        poFileType: String(po.poFileType || '').trim(),
        poFileSize: Math.max(0, Number(po.poFileSize) || 0),
        poPublicId: String(po.poPublicId || '').trim(),
        poUploadedAt: String(po.poUploadedAt || closedAt).trim(),
        recordedAt: closedAt
      },
      originalPoFileUrl: String(po.poFileUrl || '').trim(),
      originalPoFileName: String(po.poFileName || '').trim(),
      originalPoFileType: String(po.poFileType || '').trim(),
      originalPoFileSize: Math.max(0, Number(po.poFileSize) || 0),
      originalPoPublicId: String(po.poPublicId || '').trim(),
      originalPoUploadedAt: String(po.poUploadedAt || closedAt).trim(),
      provisionalCloseExpiresAt: '',
      provisionalCloseDeadlineBusinessDays: 0
    };
  });
  return { assignments: rows, changedCount };
}

module.exports = { BUSINESS_DAYS, PERMANENT_PO_STATUS, addBusinessDaysInIst, normalizeProvisionalClosure, permanentlyCloseProvisionalAssignments };
