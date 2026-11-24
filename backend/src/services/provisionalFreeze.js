const FREEZE_MESSAGE = 'This client/service was closed under Special Approval. You were given 7 working days to upload the Purchase Order, but no PO was submitted within the deadline. This service is now frozen. Upload the missing PO and contact your Admin/Finance team to complete the PO review and closure.';
function provisionalState(row = {}, now = new Date()) {
  if (row.poStatus !== 'provisional') return { frozen: false, message: '', deadline: '' };
  const deadline = new Date(row.provisionalCloseExpiresAt);
  const received = new Date(row.clientPoReceivedAt);
  const receivedInTime = Boolean(row.clientPoReceivedAt) && !Number.isNaN(received.getTime()) && !Number.isNaN(deadline.getTime()) && received <= deadline;
  const frozen = Boolean(row.provisionalCloseExpiresAt) && !receivedInTime && !Number.isNaN(deadline.getTime()) && deadline <= now;
  return { frozen, message: frozen ? FREEZE_MESSAGE : '', deadline: Number.isNaN(deadline.getTime()) ? '' : deadline.toISOString(), receivedInTime, financeApproval: row.provisionalFinanceApproval || null };
}
function clientAssignment(client = {}, lead = {}, serviceId = '') {
  const id = String(serviceId || client.assignedServiceId || client.data?.assignedServiceId || client.data?.selectedLeadSnapshot?.assignedServiceId || '');
  const assignments = lead.assignments || [];
  if (id) return assignments.find(row => String(row.assignedServiceId || row.serviceAssignmentId || '') === id) || {};
  return assignments.length === 1 ? assignments[0] : {};
}
async function clientFreezeState(client, serviceId = '') {
  let lead = client.selectedLead;
  if (!lead?.assignments) {
    const id = lead?._id || lead || client.data?.selectedLead;
    if (!id || !require('mongoose').isValidObjectId(id)) return { frozen: false };
    lead = await require('../models/Lead').findById(id).select('assignments').lean();
  }
  return provisionalState(clientAssignment(client, lead || {}, serviceId));
}
async function guard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !require('mongoose').isValidObjectId(req.params.id)) return next();
  try {
    const client = await require('../models/Client').findById(req.params.id).select('selectedLead assignedServiceId data.assignedServiceId data.selectedLeadSnapshot.assignedServiceId data.selectedLead').lean();
    if (!client) return next();
    const state = await clientFreezeState(client, req.body?.assignedServiceId || req.query?.assignedServiceId);
    if (state.frozen) return res.status(423).json({ error: state.message, code: 'SPECIAL_APPROVAL_PO_OVERDUE', deadline: state.deadline });
    return next();
  } catch { return res.status(503).json({ error: 'Unable to verify the client PO deadline. Please retry.' }); }
}
module.exports = { FREEZE_MESSAGE, provisionalState, clientAssignment, clientFreezeState, guard };
