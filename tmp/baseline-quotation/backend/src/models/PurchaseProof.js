const mongoose = require('mongoose');

const PurchaseProofSchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
  financialYear: { type: String, required: true, index: true },
  section: { type: String, default: 'purchase' },
  progressParticular: { type: String, required: true, index: true },
  name: String,
  originalName: String,
  fileType: { type: String, enum: ['eml', 'msg'], required: true },
  mimeType: String,
  size: Number,
  storageKey: String,
  storageUrl: String,
  checksum: { type: String, required: true, index: true },
  emailData: { type: mongoose.Schema.Types.Mixed, default: {} },
  attachments: { type: [mongoose.Schema.Types.Mixed], default: [] },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  uploadedByName: String,
  decodeErrorCode: String
}, { timestamps: true });

PurchaseProofSchema.index({ clientId: 1, financialYear: 1, progressParticular: 1, checksum: 1 }, { unique: true });
PurchaseProofSchema.index({ clientId: 1, financialYear: 1, progressParticular: 1, 'emailData.messageId': 1 });

module.exports = mongoose.model('PurchaseProof', PurchaseProofSchema);
