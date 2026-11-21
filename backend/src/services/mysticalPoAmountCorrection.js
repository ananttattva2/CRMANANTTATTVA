const { sourceSignature } = require('./poApprovalWorkflow');
const OLD = 125000, AMOUNT = 40000;
const identity = value => String(value?._id || value || '').trim();

function correctionPlan(lead, approvals) {
  if (!lead || lead.leadCode !== 'ATPL-LEAD-0615' || !/^MYSTICAL PROPACK PRIVATE LIMITED$/i.test(String(lead.company || '').trim())) {
    throw new Error('Mystical source lead identity could not be verified.');
  }
  const candidates = [];
  for (const approval of approvals) {
    if (approval.deletedAt) continue;
    const rows = approval.payload?.poYearRows || [];
    rows.forEach((row, rowIndex) => {
      const basic = Number(row.quotationBasicAmount) || (row.quotationItems || []).reduce((sum, item) => sum + (Number(item.unit) || 1) * (Number(item.basicAmount) || 0), 0);
      if ([OLD, AMOUNT].includes(Number(row.poAmount)) && (!basic || basic === AMOUNT)) candidates.push({ approval, row, rowIndex });
    });
  }
  if (candidates.length !== 1) throw new Error('The requested 125000/40000 PO is not uniquely identifiable.');
  const { approval, row, rowIndex } = candidates[0];
  const serviceId = identity(approval.payload?.assignedServiceId);
  if (!serviceId || !identity(row.poNumber)) throw new Error('Exact service and PO number are required for this correction.');
  const assignments = lead.assignments || [];
  const assignmentMatches = assignments.map((value, index) => identity(value.assignedServiceId || value.serviceAssignmentId) === serviceId ? index : -1).filter(index => index >= 0);
  if (assignmentMatches.length !== 1) throw new Error('Exact source PO service could not be verified.');
  const assignmentIndex = assignmentMatches[0], assignment = assignments[assignmentIndex];
  const poMatches = (assignment.poYearRows || []).map((value, index) => identity(value.poNumber || value.poNo) === identity(row.poNumber) ? index : -1).filter(index => index >= 0);
  if (poMatches.length !== 1) throw new Error('Exact source PO row could not be verified.');
  const sourceRowIndex = poMatches[0], sourceRow = assignment.poYearRows[sourceRowIndex];
  if (![OLD, AMOUNT].includes(Number(sourceRow.poAmount))) throw new Error('Source PO amount has changed; manual review required.');
  const sets = {};
  for (const key of ['poYearRows', 'poRows', 'purchaseOrders']) {
    (approval.payload?.[key] || []).forEach((value, index) => {
      if (identity(value.poNumber || value.poNo) === identity(row.poNumber) && Number(value.poAmount) === OLD) sets[`payload.${key}.${index}.poAmount`] = AMOUNT;
    });
  }
  const summary = approval.poReview?.poSummary || [];
  summary.forEach((value, index) => {
    if (identity(value.poNumber) === identity(row.poNumber) && Number(value.poAmount) === OLD) sets[`poReview.poSummary.${index}.poAmount`] = AMOUNT;
  });
  const correctedAssignment = { ...assignment, poYearRows: assignment.poYearRows.map((value, index) => index === sourceRowIndex ? { ...value, poAmount: AMOUNT } : value) };
  if (assignment.originalPoDetails && identity(assignment.originalPoDetails.poNumber || assignment.originalPoDetails.poNo) === identity(row.poNumber) && Number(assignment.originalPoDetails.poAmount) === OLD) correctedAssignment.originalPoDetails = { ...assignment.originalPoDetails, poAmount: AMOUNT };
  const sourceSets = {};
  if (Number(sourceRow.poAmount) !== AMOUNT) sourceSets[`assignments.${assignmentIndex}.poYearRows.${sourceRowIndex}.poAmount`] = AMOUNT;
  if (correctedAssignment.originalPoDetails !== assignment.originalPoDetails) sourceSets[`assignments.${assignmentIndex}.originalPoDetails.poAmount`] = AMOUNT;
  const changed = Object.keys(sets).length > 0 || Object.keys(sourceSets).length > 0;
  if (changed && approval.poReview) {
    const service = (lead.serviceSelections || []).find(value => identity(value.assignedServiceId || value.serviceAssignmentId) === serviceId) || approval.payload?.service || {};
    sets['poReview.sourceSignature'] = sourceSignature(correctedAssignment, service);
    sets['poReview.version'] = (Number(approval.poReview.version) || 0) + 1;
  }
  return { approval, assignmentIndex, sourceRowIndex, rowIndex, poNumber: row.poNumber, sourceSets, sets, changed };
}

async function correctMysticalPoAmount({ Lead, Approval, connection, backup }) {
  const session = await connection.startSession();
  let summary;
  try {
    await session.withTransaction(async () => {
      const lead = await Lead.findOne({ leadCode: 'ATPL-LEAD-0615', company: /^MYSTICAL PROPACK PRIVATE LIMITED$/i }).session(session).lean();
      if (!lead) throw new Error('Requested Mystical lead was not found.');
      const approvals = await Approval.find({ type: 'purchase_order', deletedAt: null, $or: [{ 'payload.leadId': String(lead._id) }, { uniqueId: lead.leadCode }, { 'payload.leadCode': lead.leadCode }] }).session(session).lean();
      const plan = correctionPlan(lead, approvals);
      if (plan.changed) {
        await backup({ lead, approvals });
        if (Object.keys(plan.sourceSets).length) {
          const changed = await Lead.updateOne({ _id: lead._id, updatedAt: lead.updatedAt }, { $set: plan.sourceSets }, { session });
          if (changed.modifiedCount !== 1) throw new Error('Source lead changed concurrently.');
        }
        if (Object.keys(plan.sets).length) {
          const update = { $set: plan.sets };
          if (plan.approval.poReview) update.$push = { 'poReview.history': { event: 'PO_AMOUNT_CORRECTED', name: 'CRM data correction', remarks: 'User-requested Mystical PO amount correction: INR 125000 to INR 40000. Other POs unchanged.', at: new Date().toISOString() } };
          const changed = await Approval.updateOne({ _id: plan.approval._id, updatedAt: plan.approval.updatedAt }, update, { session });
          if (changed.modifiedCount !== 1) throw new Error('Approval changed concurrently.');
        }
      }
      summary = { status: plan.changed ? 'corrected' : 'already-correct', leadCode: lead.leadCode, approvalId: String(plan.approval._id), poNumber: plan.poNumber, sourceAmountBefore: Number(lead.assignments[plan.assignmentIndex].poYearRows[plan.sourceRowIndex].poAmount), approvalAmountBefore: Number(plan.approval.payload.poYearRows[plan.rowIndex].poAmount), poAmount: AMOUNT };
    });
    // Clear persisted list snapshots; deployment restart also clears in-memory snapshots.
    await connection.collection('crm_compact_read_snapshots').deleteMany({ _id: { $in: [`PendingApproval:${summary.approvalId}`] } });
    const verified = await Approval.findById(summary.approvalId).lean();
    const savedRow = verified?.payload?.poYearRows?.find(value => identity(value.poNumber) === identity(summary.poNumber));
    if (Number(savedRow?.poAmount) !== AMOUNT) throw new Error('Saved approval amount verification failed.');
    const savedLead = await Lead.findOne({ leadCode: summary.leadCode }).lean();
    const savedAssignment = savedLead?.assignments?.find(value => identity(value.assignedServiceId || value.serviceAssignmentId) === identity(verified.payload.assignedServiceId));
    const sourceRow = savedAssignment?.poYearRows?.find(value => identity(value.poNumber || value.poNo) === identity(summary.poNumber));
    if (Number(sourceRow?.poAmount) !== AMOUNT) throw new Error('Saved source PO amount verification failed.');
    summary.verifiedSourceAmount = Number(sourceRow.poAmount);
    summary.verifiedApprovalAmount = Number(savedRow.poAmount);
    return summary;
  } finally { await session.endSession(); }
}
module.exports = { correctionPlan, correctMysticalPoAmount };
