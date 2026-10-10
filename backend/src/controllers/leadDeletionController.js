const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const { userHasAnyRole } = require('../utils/userRoles');
const { ADMIN_ROLES } = require('../constants/roles');

exports.deleteApprovalLead = async (req, res, next) => {
  try {
    const PendingApproval = require('../models/PendingApproval');
    if (!userHasAnyRole(req.user, ADMIN_ROLES)) return res.status(403).json({ error: 'Only admins can delete leads.' });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid approval ID.' });
    const approval = await PendingApproval.findOne({ _id: req.params.id, type: 'purchase_order' }).lean();
    if (!approval) return res.status(404).json({ error: 'Purchase Order approval not found.' });
    const leadId = String(approval.payload?.leadId || String(approval.sourceClientId || '').split(':po:')[0] || '');
    if (!mongoose.isValidObjectId(leadId)) return res.status(409).json({ error: 'This approval has no valid linked lead. Deletion was not performed.' });
    const deletedAt = new Date();
    const lead = await Lead.findOneAndUpdate({ _id: leadId, deletedAt: null }, { $set: { deletedAt, deletedBy: req.user._id } }, { new: true }).select('_id company leadCode');
    // Repeating the request can finish approval cleanup after a partial failure.
    await PendingApproval.updateMany({ type: 'purchase_order', $or: [{ _id: approval._id }, { 'payload.leadId': leadId }, { 'payload.leadId': new mongoose.Types.ObjectId(leadId) }, { sourceClientId: new RegExp(`^${leadId}:po:`) }] }, { $set: { deletedAt, deletedBy: req.user._id, nextReminderAt: null } });
    return res.json({ ok: true, message: `${lead?.company || approval.clientName || 'Client'} lead deleted successfully.`, leadId });
  } catch (error) { next(error); }
};

exports.deleteLead = async (req, res, next) => {
  try {
    if (!userHasAnyRole(req.user, ADMIN_ROLES)) return res.status(403).json({ error: 'Only admins can delete leads.' });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid lead ID.' });
    const lead = await Lead.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      { $set: { deletedAt: new Date(), deletedBy: req.user._id } },
      { new: true }
    ).select('_id company leadCode');
    if (!lead) return res.status(404).json({ error: 'Lead not found or already deleted.' });
    return res.json({ ok: true, message: 'Lead deleted successfully.', leadId: String(lead._id) });
  } catch (error) { next(error); }
};
