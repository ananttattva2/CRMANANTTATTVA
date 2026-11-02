const mongoose = require('mongoose');

const sharedDocumentSchema = new mongoose.Schema({
  documentType: { type: String, enum: ['company', 'policy'], required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  serviceCategory: { type: String, required: true, trim: true, maxlength: 120, index: true },
  originalName: { type: String, required: true, trim: true, maxlength: 220 },
  mimeType: { type: String, required: true, trim: true, maxlength: 120 },
  size: { type: Number, required: true, min: 1 },
  storageKey: { type: String, required: true, unique: true, trim: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  uploadedByName: { type: String, required: true, trim: true, maxlength: 140 }
}, { timestamps: true });

sharedDocumentSchema.index({ documentType: 1, serviceCategory: 1, createdAt: -1 });
sharedDocumentSchema.index({ documentType: 1, title: 1 });

module.exports = mongoose.models.SharedDocument || mongoose.model('SharedDocument', sharedDocumentSchema);
