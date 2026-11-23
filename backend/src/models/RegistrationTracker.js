const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  assignedServiceId: { type: String, required: true }, poNumber: { type: String, required: true }, registrationYear: { type: String, default: '' },
  dataReceived: { type: String, enum: ['yes', 'no'], default: 'no' },
  complianceCheck: { type: String, enum: ['yes', 'no'], default: 'no' },
  registrationCompleted: { type: String, enum: ['yes', 'no'], default: 'no' },
  proof: { type: mongoose.Schema.Types.Mixed, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
schema.index({ client: 1, assignedServiceId: 1, poNumber: 1, registrationYear: 1 }, { unique: true });
module.exports = mongoose.model('RegistrationTracker', schema);
