const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  kind: { type: String, enum: ['excel', 'po'], required: true },
  applicantType: String,
  serviceKey: { type: String, index: true },
  serviceContext: { assignedServiceId: String, servicesOffered: String, annualReturnYear: String, registrationYear: String, poYear: String, poNumber: String },
  dataType: { type: String, enum: ['purchase', 'sales'] },
  notificationStatus: { type: String, enum: ['pending', 'sent', 'failed', 'partial', 'not_required'], default: 'not_required' },
  name: String, url: String, storageKey: String, size: Number, uploadedBy: String
}, { timestamps: true });
module.exports = mongoose.model('ClientPortalUpload', schema);
