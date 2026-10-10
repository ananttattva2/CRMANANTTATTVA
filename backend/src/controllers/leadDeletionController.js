const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const { userHasAnyRole } = require('../utils/userRoles');
const { ADMIN_ROLES } = require('../constants/roles');

exports.removePoApproval = async (req, res, next) => {
  try {
    const PendingApproval = require('../models/PendingApproval');
    if (!userHasAnyRole(req.user, ADMIN_ROLES)) return res.status(403).json({ error: 'Only admins can remove PO approvals.' });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid approval ID.' });
    const approval = await PendingApproval.findOneAndUpdate(
      { _id: req.params.id, type: 'purchase_order', deletedAt: null },
      { $set: { deletedAt: new Date(), deletedBy: req.user._id, nextReminderAt: null } },
      { new: true }
    ).select('_id clientName');
    if (!approval) return res.status(404).json({ error: 'PO approval not found or already removed.' });
    return res.json({ ok: true, message: `PO approval for ${approval.clientName || 'this client'} removed from this list.`, approvalId: String(approval._id) });
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
