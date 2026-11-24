const mongoose = require('mongoose');

const HealthReportAssignmentSchema = new mongoose.Schema({
  lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, unique: true, index: true },
  companyName: { type: String, trim: true, required: true },
  leadCode: { type: String, trim: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  assignedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  status: { type: String, enum: ['MANAGER_REVIEW', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'], default: 'MANAGER_REVIEW', index: true },
  assignedAt: Date,
  completedAt: Date
}, { timestamps: true });

module.exports = mongoose.model('HealthReportAssignment', HealthReportAssignmentSchema);
