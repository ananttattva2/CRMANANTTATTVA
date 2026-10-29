const mongoose = require('mongoose');

const TemporaryLeadSchema = new mongoose.Schema({
  tempLeadCode: { type: String, required: true, unique: true, trim: true, index: true },
  clientName: { type: String, required: true, trim: true, maxlength: 240 },
  companyIdentity: { type: String, required: true, trim: true, index: true },
  // Optional at schema level for legacy rows; all new API submissions require these fields.
  personName: { type: String, trim: true, maxlength: 160 },
  email: { type: String, trim: true, lowercase: true, maxlength: 254 },
  emailIdentity: { type: String, trim: true, lowercase: true, index: true },
  phone: { type: String, trim: true, maxlength: 15 },
  phoneIdentity: { type: String, trim: true, index: true },
  sector: { type: String, trim: true, maxlength: 160 },
  status: { type: String, enum: ['DRAFT', 'CONVERTED'], default: 'DRAFT', index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  createdByName: { type: String, trim: true },
  createdByEmail: { type: String, trim: true, lowercase: true },
  convertedLead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
  convertedLeadCode: { type: String, trim: true },
  convertedAt: { type: Date },
  nextFollowUpDate: { type: String, trim: true },
  nextFollowUpTime: { type: String, trim: true },
  followUpRemarks: { type: String, trim: true },
  followUpPriority: { type: String, trim: true, default: 'Medium' },
  followUpFlag: { type: String, trim: true, default: 'GREEN' },
  followUpHistory: { type: Array, default: [] },
  reassignmentHistory: { type: Array, default: [] }
}, { timestamps: true });

TemporaryLeadSchema.index({ createdBy: 1, createdAt: -1 });
TemporaryLeadSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('TemporaryLead', TemporaryLeadSchema);
