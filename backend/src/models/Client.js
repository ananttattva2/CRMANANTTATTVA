const mongoose = require('mongoose');

const ClientSchema = new mongoose.Schema({
  selectedLead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
  assignedServiceId: { type: String, trim: true, index: true },
  companyIdentity: { type: String, trim: true, index: true },
  adminControls: {
    approvalStatus: { type: String, default: 'PENDING' },
    visibilityStatus: { type: String, default: 'LIVE' },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  sla: { type: mongoose.Schema.Types.Mixed, default: {} },
  // Per-service CRM staff assignments. This must be part of the strict schema;
  // otherwise Mongoose silently strips it from findByIdAndUpdate() writes.
  serviceAllocations: { type: mongoose.Schema.Types.Mixed, default: {} },
  workflowStatus: { type: String, enum: ['draft', 'submitted'], default: 'draft' },
  submittedAt: { type: Date },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  sync: {
    source: { type: String, trim: true, default: 'crm' },
    status: { type: String, enum: ['synced', 'pending', 'failed'], default: 'synced', index: true },
    lastSyncedAt: { type: Date },
    lastError: { type: String, trim: true }
  }
}, { timestamps: true });

ClientSchema.index({ companyIdentity: 1, workflowStatus: 1 });
ClientSchema.index({ selectedLead: 1, assignedServiceId: 1, createdBy: 1 });

module.exports = mongoose.model('Client', ClientSchema);
