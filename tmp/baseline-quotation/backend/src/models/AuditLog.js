const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sessionId: { type: String, index: true },
  action: { type: String, required: true, trim: true, index: true },
  module: { type: String, required: true, trim: true, index: true },
  method: { type: String, trim: true },
  path: { type: String, trim: true },
  statusCode: { type: Number },
  description: { type: String, trim: true },
  ipAddress: { type: String, trim: true },
  userName: { type: String, trim: true },
  userEmail: { type: String, trim: true },
  role: { type: String, trim: true, index: true },
  department: { type: String, trim: true, index: true },
  entityType: { type: String, trim: true, index: true },
  entityId: { type: String, trim: true, index: true },
  entityName: { type: String, trim: true, index: true },
  recordId: { type: String, trim: true },
  changes: [{ field: String, oldValue: mongoose.Schema.Types.Mixed, newValue: mongoose.Schema.Types.Mixed }],
  metadata: { type: mongoose.Schema.Types.Mixed, default: undefined },
  userAgent: { type: String, trim: true },
  device: { type: String, trim: true },
  browser: { type: String, trim: true },
  occurredAt: { type: Date, required: true, default: Date.now, index: true }
}, { timestamps: true });

AuditLogSchema.index({ userId: 1, occurredAt: -1 });
AuditLogSchema.index({ occurredAt: -1, module: 1, action: 1 });
AuditLogSchema.index({ entityName: 'text', description: 'text', userName: 'text', recordId: 'text' });
module.exports = mongoose.model('AuditLog', AuditLogSchema);
