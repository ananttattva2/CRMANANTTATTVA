const mongoose = require('mongoose');

const PurchaseDataSchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
  financialYear: { type: String, required: true, trim: true, index: true },
  checklist: { type: [mongoose.Schema.Types.Mixed], default: [] },
  screenshots: { type: [mongoose.Schema.Types.Mixed], default: [] },
  userRemarks: { type: String, trim: true, default: '' },
  baseUpload: { type: mongoose.Schema.Types.Mixed, default: null },
  portalUpload: { type: mongoose.Schema.Types.Mixed, default: null },
  reconciliation: { type: mongoose.Schema.Types.Mixed, default: {} },
  calculatedStatus: { type: String, trim: true, default: 'Pending', index: true },
  dataVersion: { type: Number, default: 0 },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  submittedByName: { type: String, trim: true, default: '' },
  submittedAt: { type: Date },
  managerVerificationStatus: { type: String, enum: ['Not Submitted', 'Pending', 'Approved', 'Rejected'], default: 'Not Submitted' },
  managerVerifiedAt: { type: Date },
  managerVerifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  managerVerifiedByName: { type: String, trim: true, default: '' },
  complianceVerificationStatus: { type: String, enum: ['Not Ready', 'Pending', 'Approved', 'Rejected'], default: 'Not Ready' },
  complianceVerifiedAt: { type: Date },
  complianceVerifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  complianceVerifiedByName: { type: String, trim: true, default: '' },
  reviewHistory: { type: [mongoose.Schema.Types.Mixed], default: [] },
  lastSubmissionVersion: { type: Number, default: 0 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

PurchaseDataSchema.index({ clientId: 1, financialYear: 1 }, { unique: true });

module.exports = mongoose.model('PurchaseData', PurchaseDataSchema);
