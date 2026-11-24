const mongoose = require('mongoose');

const StaffOnboardingAssignmentSchema = new mongoose.Schema({
  leadKey: { type: String, required: true, trim: true, index: true },
  rowIndex: { type: Number, required: true, min: 0 },
  leadCode: { type: String, trim: true },
  company: { type: String, required: true, trim: true },
  staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  staffName: { type: String, trim: true },
  staffEmail: { type: String, trim: true, lowercase: true },
  managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  managerName: { type: String, trim: true },
  managerEmail: { type: String, trim: true, lowercase: true },
  assignedAt: { type: Date, required: true, default: Date.now },
  dueAt: { type: Date, required: true, index: true },
  nextActionAt: { type: Date, required: true, index: true },
  reminderCount: { type: Number, default: 0 },
  lastReminderAt: { type: Date },
  status: { type: String, enum: ['ACTIVE', 'PENDING_COMPLIANCE', 'COMPLETED', 'RED_FLAG', 'CPCB_NOT_REGISTERED'], default: 'ACTIVE', index: true },
  pausedAt: { type: Date },
  pausedRemainingMs: { type: Number, min: 0 },
  pausedFromStatus: { type: String, enum: ['ACTIVE', 'RED_FLAG', 'CPCB_NOT_REGISTERED'] },
  completedAt: { type: Date },
  redFlaggedAt: { type: Date },
  assignmentEmailSentAt: { type: Date },
  emailError: { type: String, trim: true }
}, { timestamps: true });

StaffOnboardingAssignmentSchema.index({ leadKey: 1, rowIndex: 1 }, { unique: true });
StaffOnboardingAssignmentSchema.index({ status: 1, nextActionAt: 1 });

module.exports = mongoose.model('StaffOnboardingAssignment', StaffOnboardingAssignmentSchema);
