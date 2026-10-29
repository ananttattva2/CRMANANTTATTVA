const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  kind: { type: String, enum: ['excel', 'po'], required: true },
  applicantType: String,
  notificationStatus: { type: String, enum: ['pending', 'sent', 'failed', 'partial', 'not_required'], default: 'not_required' },
  name: String, url: String, storageKey: String, size: Number, uploadedBy: String
}, { timestamps: true });
module.exports = mongoose.model('ClientPortalUpload', schema);
