const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  assignedServiceId: { type: String, required: true }, poNumber: { type: String, required: true }, registrationYear: { type: String, default: '' },
  dataReceived: { type: String, enum: ['yes', 'no'], default: 'no' },
  dataExplained: { type: String, enum: ['yes', 'no'], default: 'no' },
  explainedProof: { type: mongoose.Schema.Types.Mixed, default: null },
  receivedProof: { type: mongoose.Schema.Types.Mixed, default: null },
  manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  submittedAt: Date,
  managerStatus: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
  complianceStatus: { type: String, enum: ['NOT_READY', 'PENDING', 'APPROVED', 'REJECTED'], default: 'NOT_READY' },
  history: { type: [mongoose.Schema.Types.Mixed], default: [] },
  notifications: { type: mongoose.Schema.Types.Mixed, default: {} },
  complianceCheck: { type: String, enum: ['yes', 'no'], default: 'no' },
  registrationCompleted: { type: String, enum: ['yes', 'no'], default: 'no' },
  proof: { type: mongoose.Schema.Types.Mixed, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
schema.index({ client: 1, assignedServiceId: 1, poNumber: 1, registrationYear: 1 }, { unique: true });
schema.index({ manager: 1, updatedAt: -1 });
schema.index({ submittedAt: 1, updatedAt: -1 });
module.exports = mongoose.model('RegistrationTracker', schema);
