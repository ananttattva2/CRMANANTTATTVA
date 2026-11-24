const mongoose = require('mongoose');

const AnnualReturnSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', index: true },
  clientKey: { type: String, trim: true, index: true },
  annualYear: { type: String, trim: true, required: true, index: true },
  clientName: { type: String, trim: true, index: true },
  piboCategory: { type: String, trim: true },
  eprCategory: { type: String, trim: true },
  currentSpoc: { type: String, trim: true },
  previousSpoc: { type: String, trim: true },
  status: { type: String, trim: true, default: 'draft', index: true },
  activeTab: { type: String, trim: true },
  activeSection: { type: String, trim: true },
  filings: { type: mongoose.Schema.Types.Mixed, default: {} },
  draft: { type: mongoose.Schema.Types.Mixed, default: {} },
  basicInfo: { type: mongoose.Schema.Types.Mixed, default: {} },
  financials: { type: mongoose.Schema.Types.Mixed, default: {} },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  brandOwner: { type: mongoose.Schema.Types.Mixed, default: {} },
  importer: { type: mongoose.Schema.Types.Mixed, default: {} },
  annual: { type: mongoose.Schema.Types.Mixed, default: {} },
  approvalWorkflow: { type: mongoose.Schema.Types.Mixed, default: {} },
  clientData: { type: mongoose.Schema.Types.Mixed, default: {} },
  adminControls: { type: mongoose.Schema.Types.Mixed, default: {} },
  savedAt: { type: Date, default: Date.now },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

AnnualReturnSchema.index({ clientKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('AnnualReturn', AnnualReturnSchema);
