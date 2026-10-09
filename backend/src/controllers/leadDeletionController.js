const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const { userHasAnyRole } = require('../utils/userRoles');
const { ADMIN_ROLES } = require('../constants/roles');

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
