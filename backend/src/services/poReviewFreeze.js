const Approval = require('../models/PendingApproval');
const { ACTIVE_STAGES, sourceSignature, fail } = require('./poApprovalWorkflow');
async function assertLeadPoEditable(leadId, before, next) {
  if (!Array.isArray(next.assignments) && !Array.isArray(next.serviceSelections)) return;
  const reviews = await Approval.find({ type: 'purchase_order', 'payload.leadId': String(leadId), 'poReview.stage': { $in: ACTIVE_STAGES } })
    .select('payload.assignmentIndex payload.assignedServiceId poReview.stage').lean();
  for (const review of reviews) {
    const index = Number(review.payload?.assignmentIndex);
    const original = before.assignments?.[index];
    const candidate = next.assignments ? next.assignments[index] : original;
    if (!candidate || String(candidate.assignedServiceId || '') !== String(original?.assignedServiceId || '') || sourceSignature(original, before.serviceSelections?.[index]) !== sourceSignature(candidate, next.serviceSelections ? next.serviceSelections[index] : before.serviceSelections?.[index])) {
      fail(409, review.poReview.stage === 'MANAGEMENT_PENDING' ? 'This PO is frozen while waiting for Super Admin Management Go Ahead.' : 'This PO is under Finance review. Use the Finance approval workflow to request a revision.');
    }
  }
}
module.exports = { assertLeadPoEditable };
