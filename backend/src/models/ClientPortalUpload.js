const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  kind: { type: String, enum: ['excel', 'po'], required: true },
  name: String, url: String, storageKey: String, size: Number, uploadedBy: String
}, { timestamps: true });
module.exports = mongoose.model('ClientPortalUpload', schema);
