const mongoose = require('mongoose');
const Approval = require('../models/PendingApproval');
const Lead = require('../models/Lead');
const Quotation = require('../models/Quotation');
const { userHasAnyRole } = require('../utils/userRoles');
const { transition, sourceSignature, termsSnapshot, fail } = require('../services/poApprovalWorkflow');
const REVIEW_ROLES = ['accounts', 'finance', 'admin', 'superadmin'];
const canView = user => userHasAnyRole(user, REVIEW_ROLES);
function report(res, error) {
  console.error('PO review failed', { name: error.name, code: error.code, status: error.status });
  return res.status(error.status || 503).json({ error: error.status ? error.message : 'Unable to save this PO review. Refresh and try again.' });
}
async function inTransaction(id, work) {
  if (!mongoose.isValidObjectId(id)) fail(400, 'Invalid PO approval ID.');
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const approval = await Approval.findOne({ _id: id, type: 'purchase_order' }).session(session);
      if (!approval) fail(404, 'PO approval not found.');
      const lead = await Lead.findById(approval.payload?.leadId).session(session);
      const serviceId = String(approval.payload?.assignedServiceId || '');
      const matching = serviceId && lead ? (lead.assignments || []).map((row, index) => String(row.assignedServiceId || '') === serviceId ? index : -1).filter(index => index >= 0) : [];
      if (serviceId && matching.length !== 1) fail(409, 'The source PO service changed. Refresh and resubmit the PO for Admin review.');
      const rawIndex = approval.payload?.assignmentIndex;
      const index = serviceId ? matching[0] : rawIndex !== null && rawIndex !== undefined && rawIndex !== '' ? Number(rawIndex) : NaN;
      if (!lead || !Number.isInteger(index) || !lead.assignments?.[index]) fail(409, 'The source PO assignment is unavailable.');
      if (approval.payload.assignmentIndex !== index) {
        approval.payload = { ...approval.payload, assignmentIndex: index };
        approval.markModified('payload');
      }
      result = await work({ approval, lead, index, session });
      approval.markModified('poReview');
      await approval.save({ session });
      lead.markModified('assignments');
      await lead.save({ session });
    });
    await require('../services/crmCache').invalidateCrmCache();
    return result;
  } finally { await session.endSession(); }
}
function requireUnchanged(approval, assignment, service) {
  if (approval.poReview?.sourceSignature !== sourceSignature(assignment, service)) fail(409, 'The PO details changed after Admin review. Reopen the latest PO details before approving.');
}
function clearRejectedPoClosure(lead, index) {
  const assignment = lead?.assignments?.[index];
  if (!assignment) return;
  for (const key of ['closedBy', 'closedByText', 'closedByEmail', 'closedAt', 'closureFinalizedByManager']) {
    assignment[key] = undefined;
  }
  const hasOtherClosure = (lead.assignments || []).some((row, rowIndex) => {
    if (rowIndex === index) return false;
    const status = String(row.poApprovalStatus || '').trim().toUpperCase();
    if (['REJECTED', 'REVISION_REQUIRED'].includes(status)) {
      return Boolean(row.permanentClosedAt || row.poStatus === 'permanently_closed');
    }
    return Boolean(row.closedBy || row.closedAt || row.closureRequestedBy
      || row.poStatus === 'provisional' || row.poStatus === 'permanently_closed');
  });
  if (!hasOtherClosure) {
    for (const key of ['closedBy', 'closedByText', 'closedByEmail', 'closedAt', 'closedOnBehalfOfUser', 'closedOnBehalfOfName', 'closedOnBehalfOfEmail']) {
      lead[key] = undefined;
    }
  }
}
exports.initialApproval = async (req, res) => {
  try {
    let notification;
    const result = await inTransaction(req.params.id, async ({ approval, lead, index, session }) => {
      if (!req.body.reviewedAt || new Date(req.body.reviewedAt).getTime() !== new Date(approval.updatedAt).getTime()) fail(409, 'The submitted PO changed after you opened it. Reopen the latest PO details before approving.');
      if (approval.approvalStatus === 'APPROVED') fail(409, 'This PO is already finally approved.');
      const status = String(req.body.status || 'APPROVED').toUpperCase();
      if (!['APPROVED', 'REJECTED', 'REVISION_REQUIRED'].includes(status)) fail(400, 'Select Approve, Reject, or Revise.');
      if (status !== 'APPROVED') {
        if (!userHasAnyRole(req.user, ['admin', 'superadmin'])) fail(403, 'Admin initial review is required.');
        if (approval.poReview) fail(409, 'Use Finance Approval for this PO.');
        const remarks = String(req.body.remarks || '').trim();
        if (!remarks || remarks.length > 2500) fail(400, 'Enter remarks between 1 and 2,500 characters.');
        approval.approvalStatus = status; approval.remarks = remarks; approval.actionBy = req.user._id; approval.actionAt = new Date();
        lead.assignments[index].poApprovalStatus = status;
        clearRejectedPoClosure(lead, index);
        notification = { approval, lead, index, status, remarks, screenshotUrl: '' };
        return { ok: true, message: 'Admin initial decision saved.' };
      }
      const review = transition(approval.poReview, 'ADMIN_APPROVE', req.user, req.body.remarks);
      if (lead.assignments[index].poStatus !== 'received') fail(409, 'The submitted PO is no longer marked as received. Resubmit its current details for review.');
      const rows = lead.assignments[index].poYearRows || [];
      if (!rows.length || rows.some(row => !String(row.poNumber || row.poNo || '').trim() || !(Number(row.poAmount) > 0))) fail(409, 'Record a valid PO number and positive amount before initial approval.');
      const ids = rows.map(row => row.quotationId).filter(id => mongoose.isValidObjectId(id));
      const numbers = rows.map(row => row.quotationNumber).filter(Boolean);
      const quotations = ids.length || numbers.length ? await Quotation.find({ $or: [
        ...(ids.length ? [{ _id: { $in: ids } }] : []), ...(numbers.length ? [{ $and: [{ quotationNumber: { $in: numbers } }, { $or: [
          { leadRef: lead._id }, { leadId: { $in: [String(lead._id), lead.leadCode, lead.sourceLeadId].filter(Boolean) } },
          ...(lead.leadCode ? [{ leadCode: lead.leadCode }, { businessLeadCode: lead.leadCode }] : [])
        ] }] }] : [])
      ] }).select('_id quotationNumber paymentTerm terms').session(session).lean() : [];
      const { resolveApprovalPoProof } = require('../services/poProofResolver');
      const submittedRows = rows.map((row, rowIndex) => ({ ...row, ...resolveApprovalPoProof({ approval, normalizedRow: row, rowIndex }) }));
      const poSummary = submittedRows.map(row => ({ poNumber: row.poNumber || row.poNo || '', poAmount: Number(row.poAmount) || 0, currency: row.currency || 'INR', poDate: row.poDate || '', fy: row.fy || row.poFinancialYear || '', quotationNumber: row.quotationNumber || '', quotationBasicAmount: Number(row.quotationBasicAmount) || 0, poFileName: row.poFileName || '' }));
      approval.payload = { ...(approval.payload || {}), poYearRows: submittedRows, service: lead.serviceSelections?.[index] || approval.payload?.service || {} };
      approval.markModified('payload');
      approval.poReview = { ...review, poSummary, sourceSignature: sourceSignature(lead.assignments[index], lead.serviceSelections?.[index]), terms: termsSnapshot(rows, quotations) };
      approval.approvalStatus = 'PARTIALLY_APPROVED';
      approval.actionBy = req.user._id; approval.actionAt = new Date();
      approval.remarks = String(req.body.remarks).trim();
      lead.assignments[index].poApprovalStatus = 'FINANCE_PENDING';
      return { ok: true, message: 'Initial approval saved. The PO is now awaiting Finance review.', review: approval.poReview };
    });
    if (notification) void require('./leadController').notifyPurchaseOrderDecision(notification).catch(error => console.error('PO initial decision notification failed', { name: error.name }));
    return res.json(result);
  } catch (error) { return report(res, error); }
};
exports.act = async (req, res) => {
  if (req.params.action === 'payment-status') return exports.paymentStatus(req, res);
  const event = req.params.action === 'approve' ? 'FINANCE_APPROVE'
    : req.params.action === 'refer' ? 'FINANCE_REFER'
    : req.params.action === 'request-approval' ? 'LEAD_OWNER_REQUEST'
    : req.params.action === 'lead-closure-approve' ? 'LEAD_CLOSURE_APPROVE'
    : req.params.action === 'final' ? 'FINANCE_FINAL' : '';
  if (!event) return res.status(404).json({ error: 'Unknown review action.' });
  try {
    let notification;
    const result = await inTransaction(req.params.id, async ({ approval, lead, index }) => {
      requireUnchanged(approval, lead.assignments[index], lead.serviceSelections?.[index]);
      const paymentData = req.body.paymentData;
      const review = transition(approval.poReview, event, req.user, req.body.remarks, req.body.version, new Date(), paymentData);
      // Lead owner request: verify the user is the assignment's assigned staff.
      if (event === 'LEAD_OWNER_REQUEST') {
        const assignment = lead.assignments[index];
        const ownerId = String(assignment.assignedStaff || lead.assignedStaff || '');
        if (!ownerId || ownerId !== String(req.user._id)) fail(403, 'Only the assigned lead owner can request management approval.');
      }
      if (event === 'FINANCE_APPROVE' || event === 'FINANCE_FINAL') {
        const status = event === 'FINANCE_APPROVE' ? 'APPROVED' : String(req.body.status || '').toUpperCase();
        if (!['APPROVED', 'REJECTED', 'REVISION_REQUIRED'].includes(status)) fail(400, 'Choose Approve, Reject, or Revise.');
        review.finalStatus = status;
        approval.approvalStatus = status;
        approval.remarks = String(req.body.remarks).trim();
        approval.actionBy = req.user._id; approval.actionAt = new Date();
        lead.assignments[index].poApprovalStatus = status;
        const assignment = lead.assignments[index];
        const closer = assignment.closureRequestedBy || approval.payload?.closureRequestedBy;
        if (status === 'APPROVED' && closer && assignment.assignedTo) {
          assignment.closedBy = closer;
          assignment.closedByText = assignment.closureRequestedByText || approval.payload?.closureRequestedByText || '';
          assignment.closedAt = new Date(); assignment.closureFinalizedByManager = true;
        } else if (status !== 'APPROVED') {
          clearRejectedPoClosure(lead, index);
        }
        approval.payload = { ...(approval.payload || {}), decidedBy: req.user.name || req.user.email || '', poWorkflowReminders: {} };
        approval.markModified('payload');
        notification = { approval, lead, index, status, remarks: approval.remarks, screenshotUrl: '' };
      }
      if (event === 'LEAD_CLOSURE_APPROVE') {
        approval.payload = { ...(approval.payload || {}), decidedBy: req.user.name || req.user.email || '' };
        approval.markModified('payload');
        notification = { approval, lead, index, status: 'APPROVED', remarks: review.leadClosureApproval?.remarks || '', screenshotUrl: '', leadClosure: true };
      }
      approval.poReview = review;
      return { ok: true, review, message: event === 'FINANCE_APPROVE' ? 'Finance approval saved. Staff assignment is now unlocked.' : event === 'FINANCE_REFER' ? 'Remark submitted. This PO is now with the lead owner to request management approval.' : event === 'LEAD_OWNER_REQUEST' ? 'Request submitted. This PO is now awaiting Lead Closure Approval from Super Admin.' : event === 'LEAD_CLOSURE_APPROVE' ? 'Lead Closure Approval saved. Finance can now record the final decision.' : 'Finance final decision saved.' };
    });
    if (notification) void require('./leadController').notifyPurchaseOrderDecision(notification).catch(error => console.error('Finance PO notification failed', { name: error.name }));
    return res.json(result);
  } catch (error) { return report(res, error); }
};
exports.paymentStatus = async (req, res) => {
  if (!userHasAnyRole(req.user, ['accounts', 'finance'])) return res.status(403).json({ error: 'Only Finance can record payment status.' });
  try {
    const status = String(req.body.status || '').toUpperCase();
    if (!['ADVANCE_RECEIVED', 'COMPLETE_RECEIVED'].includes(status)) fail(400, 'Select a valid payment status.');
    const confirmAmount = req.body.confirmAmount === true;
    let amount = Number(req.body.amount);
    let notification;
    const result = await inTransaction(req.params.id, async ({ approval, lead, index }) => {
      if (!approval.poReview) fail(409, 'This PO is not under Finance review.');
      const pos = approval.payload?.poYearRows || lead.assignments[index]?.poYearRows || [];
      const poAmount = pos.reduce((sum, row) => sum + Number(row.poAmount || 0), 0);
      if (confirmAmount) amount = poAmount;
      if (!(amount > 0)) fail(400, 'Enter a valid received amount.');
      const entry = { status, amount, confirmed: confirmAmount, remarks: String(req.body.remarks || '').trim(), by: String(req.user._id), name: req.user.name || req.user.email || '', at: new Date().toISOString() };
      approval.poReview = { ...approval.poReview, paymentStatus: entry, history: [...(approval.poReview.history || []), { event: `PAYMENT_${status}`, remarks: `${status}: ${amount}${confirmAmount ? ' (confirmed as PO amount)' : ''}`, by: entry.by, name: entry.name, at: entry.at }] };
      approval.markModified('poReview');
      notification = { approval, lead, index, status: 'PAYMENT', remarks: entry.remarks, screenshotUrl: '', paymentStatus: entry, poAmount };
      return { ok: true, review: approval.poReview, message: `Payment status recorded: ${status.replace('_', ' ').toLowerCase()} (${amount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}).` };
    });
    if (notification) void require('./leadController').notifyPurchaseOrderDecision({ ...notification, paymentReceived: true }).catch(error => console.error('Payment status notification failed', { name: error.name }));
    return res.json(result);
  } catch (error) { return report(res, error); }
};
exports.list = async (req, res) => {
  const staffView = !canView(req.user);
  try {
    const baseFilter = { type: 'purchase_order', 'poReview.stage': { $in: ['FINANCE_READY', 'LEAD_OWNER_PENDING', 'LEAD_CLOSURE_PENDING', 'FINANCE_RELEASED', 'FINALIZED'] } };
    const approvals = await Approval.find(baseFilter)
      .select('clientName uniqueId approvalStatus createdByName createdAt actionAt poReview payload.leadId payload.leadCode payload.poSubmittedByName payload.poSubmittedAt payload.service payload.poYearRows.poNumber payload.poYearRows.poAmount payload.poYearRows.quotationBasicAmount payload.poYearRows.quotationNumber payload.poYearRows.quotationItems.unit payload.poYearRows.quotationItems.basicAmount payload.poYearRows.fy')
      .sort({ updatedAt: -1 }).maxTimeMS(15000).lean();
    if (staffView) {
      const visible = approvals.filter(row => {
        const stage = row.poReview?.stage;
        if (stage !== 'LEAD_OWNER_PENDING') return false;
        const leadCode = String(row.payload?.leadCode || row.uniqueId || '').toLowerCase();
        const leadId = String(row.payload?.leadId || '');
        // Lead owner check is done client-side via the list returned; we include
        // only LEAD_OWNER_PENDING items here. Ownership is enforced on action.
        return Boolean(leadCode || leadId);
      });
      return res.json({ ok: true, approvals: visible });
    }
    return res.json({ ok: true, approvals });
  } catch (error) { return report(res, error); }
};
exports.detail = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) fail(400, 'Invalid PO approval ID.');
    const approval = await Approval.findOne({ _id: req.params.id, type: 'purchase_order', poReview: { $ne: null } }).lean();
    if (!approval) fail(404, 'PO review not found.');
    if (!canView(req.user)) {
      if (approval.poReview?.stage !== 'LEAD_OWNER_PENDING') return res.status(403).json({ error: 'Finance review access is required.' });
    }
    return res.json({ ok: true, approval });
  } catch (error) { return report(res, error); }
};
exports._test = { clearRejectedPoClosure };
