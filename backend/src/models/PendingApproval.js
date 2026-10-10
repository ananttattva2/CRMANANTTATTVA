const mongoose = require('mongoose');

const PendingApprovalSchema = new mongoose.Schema({
  type: { type: String, enum: ['client', 'quotation', 'purchase_order', 'lead_duplicate', 'lead_royalty', 'lead_service', 'lead_temporary'], default: 'client', index: true },
  source: { type: String, trim: true, default: 'crm', index: true },
  sourceClientId: { type: String, trim: true, index: true },
  uniqueId: { type: String, trim: true, index: true },
  clientName: { type: String, trim: true },
  deletedAt: { type: Date, default: null, index: true },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvalStatus: { type: String, enum: ['PENDING', 'PARTIALLY_APPROVED', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED'], default: 'PENDING', index: true },
  piboCategory: { type: String, trim: true },
  eprCategory: { type: String, trim: true },
  createdByName: { type: String, trim: true },
  requestDate: { type: String, trim: true },
  requestTime: { type: String, trim: true },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  lastReminderAt: { type: Date },
  nextReminderAt: { type: Date, index: true },
  reminderCount: { type: Number, default: 0 },
  reminderFlag: { type: String, enum: ['', 'GREEN', 'RED', 'PERMANENT_RED'], default: '', index: true },
  redFlagAt: { type: Date },
  greenFlagDeadline: { type: Date },
  greenFlagAt: { type: Date },
  correctionStatus: { type: String, enum: ['NONE', 'OPEN', 'RESOLVED', 'BREACHED'], default: 'NONE', index: true },
  correctionDecision: { type: String, enum: ['', 'PARTIALLY_APPROVED', 'REJECTED'], default: '' },
  correctionStartedAt: { type: Date },
  correctionDeadlinePolicy: { type: String, trim: true, default: '' },
  correctionReminderAt: { type: Date, index: true },
  correctionReminderSentAt: { type: Date },
  correctionDueAt: { type: Date, index: true },
  correctionBreachedAt: { type: Date },
  redRecoveryStartedAt: { type: Date },
  redRecoveryEmailSentAt: { type: Date },
  redRecoveryEmailNextAttemptAt: { type: Date, index: true },
  correctionResolvedAt: { type: Date },
  correctionRecipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  correctionRecipientEmail: { type: String, lowercase: true, trim: true },
  correctionRecipientName: { type: String, trim: true },
  correctionEmailError: { type: String, trim: true },
  reminderError: { type: String, trim: true },
  notifiedAdminEmails: [{ type: String, lowercase: true, trim: true }],
  actionBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  actionAt: { type: Date },
  decisionProofUrl: { type: String, trim: true },
  decisionProofName: { type: String, trim: true },
  managementApprover: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  managementApproverName: { type: String, trim: true },
  managementApprovalSource: { type: String, enum: ['', 'TEAMS', 'EMAIL', 'VERBAL_CALL', 'WHATSAPP', 'OTHER'], default: '' },
  managementApprovalNote: { type: String, trim: true, maxlength: 500 },
  managementApprovalRecordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  remarks: { type: String, trim: true, maxlength: 2500 }
}, { timestamps: true });

PendingApprovalSchema.index(
  { type: 1, source: 1, sourceClientId: 1 },
  { unique: true, partialFilterExpression: { sourceClientId: { $exists: true, $gt: '' } } }
);

PendingApprovalSchema.index(
  { type: 1, source: 1, uniqueId: 1 },
  { partialFilterExpression: { uniqueId: { $type: 'string' } } }
);

// The Pending Approval screen reads by type + status and orders newest first.
// Keeping this as one compound index avoids scanning large historical payloads.
PendingApprovalSchema.index({ type: 1, approvalStatus: 1, createdAt: -1 });

PendingApprovalSchema.plugin(require('../utils/approvalDeletionVisibility'));
module.exports = mongoose.model('PendingApproval', PendingApprovalSchema);
