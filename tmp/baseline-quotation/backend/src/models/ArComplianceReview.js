const mongoose = require('mongoose');
const fieldSchema = new mongoose.Schema({
  key: String, fingerprint: String,
  status: { type: String, enum: ['VERIFIED', 'CHANGES_REQUIRED'] },
  remarks: String, reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, reviewedAt: Date
}, { _id: false });
const schema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  financialYear: { type: String, required: true },
  fields: { type: [fieldSchema], default: [] },
  managerFields: { type: [fieldSchema], default: [] },
  managerStatus: { type: String, enum: ['PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED'], default: 'PENDING' },
  managerSourceFingerprint: String, managerSourceRevision: String, sourceRevision: String,
  managerFinalRemarks: String, managerDecidedByName: String,
  managerDecidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, managerDecidedAt: Date,
  status: { type: String, enum: ['PENDING', 'IN_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED'], default: 'PENDING' },
  sourceFingerprint: String, finalRemarks: String,
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, decidedAt: Date,
  history: { type: [mongoose.Schema.Types.Mixed], default: [] }
}, { timestamps: true });
schema.index({ client: 1, financialYear: 1 }, { unique: true });
module.exports = mongoose.model('ArComplianceReview', schema);
