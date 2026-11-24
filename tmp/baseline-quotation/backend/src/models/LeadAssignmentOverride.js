const mongoose = require('mongoose');

const LeadAssignmentOverrideSchema = new mongoose.Schema({
  leadKey: { type: String, required: true, trim: true, unique: true, index: true },
  assignments: { type: Array, default: [] },
  serviceSelections: { type: Array, default: undefined },
  activityLog: { type: Array, default: [] },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedByName: { type: String, trim: true },
  updatedByEmail: { type: String, trim: true, lowercase: true }
}, { timestamps: true });

module.exports = mongoose.model('LeadAssignmentOverride', LeadAssignmentOverrideSchema);
