const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: '' },
  tag: { type: String, trim: true, default: 'Workflow' },
  status: { type: String, trim: true, default: 'Active', index: true },
  kind: { type: String, trim: true, default: 'announcement', index: true },
  createdByName: { type: String, trim: true, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  audience: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],
  visibleToRoles: [{ type: String, trim: true, index: true }],
  attachmentName: { type: String, trim: true, default: '' },
  attachmentUrl: { type: String, trim: true, default: '' },
  pinned: { type: Boolean, default: false },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  hiddenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],
  crmNotificationId: { type: String, unique: true, sparse: true, trim: true },
  source: { type: String, trim: true, default: 'crm' }
}, { timestamps: true });

NotificationSchema.index({ kind: 1, 'metadata.clientId': 1, 'metadata.annualYear': 1, 'metadata.managerId': 1 });
NotificationSchema.index({ kind: 1, status: 1, createdAt: 1, _id: 1 });

module.exports = mongoose.model('Notification', NotificationSchema);
