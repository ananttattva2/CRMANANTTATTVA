const mongoose = require('mongoose');

const PurchaseImportRowSchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
  financialYear: { type: String, required: true, trim: true, index: true },
  uploadId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  source: { type: String, enum: ['base', 'portal'], required: true, index: true },
  rowNumber: Number,
  entityName: String,
  entityKey: { type: String, index: true },
  registrationType: String,
  entityType: String,
  recycled: String,
  gstin: String,
  invoiceNumber: String,
  invoiceDate: String,
  portalReferenceNumber: String,
  plasticCategory: { type: String, index: true },
  materialType: String,
  materialKey: { type: String, index: true },
  quantity: Number,
  gstPaid: Number,
  state: String,
  uploadStatus: String,
  uploadDate: String,
  remarks: String,
  validationStatus: String,
  validationMessages: [String],
  original: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

PurchaseImportRowSchema.index({ clientId: 1, financialYear: 1, source: 1 });
PurchaseImportRowSchema.index({ clientId: 1, financialYear: 1, entityKey: 1 });
PurchaseImportRowSchema.index({ clientId: 1, financialYear: 1, plasticCategory: 1, materialKey: 1 });

module.exports = mongoose.model('PurchaseImportRow', PurchaseImportRowSchema);
