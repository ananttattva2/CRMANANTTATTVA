const Lead = require('../models/Lead');
function specialClosureRows(leads = [], approvals = []) {
  const result = [];
  for (const lead of leads) (lead.assignments || []).forEach((assignment, index) => {
    if (assignment.poStatus !== 'provisional' || !(assignment.closedBy || assignment.closedAt || assignment.closureApprovalProofUrl)) return;
    const serviceId = String(assignment.assignedServiceId || assignment.serviceAssignmentId || '');
    const service = (lead.serviceSelections || []).find(row => serviceId && String(row.assignedServiceId || row.serviceAssignmentId || '') === serviceId) || lead.serviceSelections?.[index] || {};
    const existing = approvals.find(row => String(row.payload?.leadId) === String(lead._id) && (serviceId ? String(row.payload?.assignedServiceId || '') === serviceId : Number(row.payload?.assignmentIndex) === index));
    if (existing) { existing.approvalSource = 'Special Approval'; return; }
    result.push({ _id: `special:${lead._id}:${serviceId || index}`, specialClosure: true, approvalSource: 'Special Approval', clientName: lead.company, uniqueId: lead.leadCode, createdByName: assignment.closedByText || lead.createdByName, createdAt: assignment.closedAt || lead.closedAt,
      payload: { leadId: String(lead._id), assignedServiceId: serviceId, assignmentIndex: index, leadCode: lead.leadCode, service, poYearRows: assignment.poYearRows || [], poSubmittedByName: assignment.closedByText, specialApprovalProofUrl: assignment.closureApprovalProofUrl, specialApprovalProofName: assignment.closureApprovalProofName, poDeadline: assignment.provisionalCloseExpiresAt },
      poReview: { stage: 'PO_AWAITED', frozen: false, version: 0, terms: [], history: [] } });
  });
  return result;
}
async function loadSpecialClosures(approvals) {
  const leads = await Lead.find({ assignments: { $elemMatch: { poStatus: 'provisional' } } }).select('company leadCode createdByName closedAt serviceSelections assignments').maxTimeMS(15000).lean();
  return specialClosureRows(leads, approvals);
}
module.exports = { specialClosureRows, loadSpecialClosures };
