const mongoose = require('mongoose');
// Contributions are insert-only. Adding to a group never edits its history.
const schema = new mongoose.Schema({
  leadKind: { type: String, enum: ['hot', 'cold'], required: true, immutable: true },
  leadId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  groupId: { type: String, required: true, immutable: true },
  requestId: { type: String, required: true, immutable: true },
  amountPaise: { type: Number, required: true, min: 1, immutable: true },
  serviceKeys: { type: [String], required: true, immutable: true },
  services: { type: [String], immutable: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  createdByName: { type: String, immutable: true }
}, { timestamps: true });
schema.index({ leadKind: 1, leadId: 1, serviceKeys: 1 }, { unique: true });
schema.index({ requestId: 1 }, { unique: true });
module.exports = mongoose.model('LeadRevenue', schema);
