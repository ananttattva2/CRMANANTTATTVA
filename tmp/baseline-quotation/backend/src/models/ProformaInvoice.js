const mongoose = require('mongoose');

const ProformaItemSchema = new mongoose.Schema({
  serviceCategory: { type: String, trim: true },
  servicesForYear: { type: String, trim: true },
  financialYear: { type: String, trim: true },
  validityPeriod: { type: Number, min: 1, max: 50 },
  servicePeriod: { type: Number, min: 1, max: 3650 },
  periodUnit: { type: String, trim: true, enum: ['days', 'months', 'annual'], default: 'annual' },
  transitionPeriod: { type: String, trim: true, enum: ['Yes', 'No'], default: 'No' },
  annualReturnYears: { type: [String], default: [] },
  servicesOffered: { type: String, trim: true },
  applicableService: { type: String, trim: true },
  serviceStartDate: { type: String, trim: true },
  serviceEndDate: { type: String, trim: true },
  eprCategory: { type: String, trim: true },
  businessCategory: { type: String, trim: true, maxlength: 100 },
  piboParent: { type: String, trim: true },
  piboCategory: { type: String, trim: true },
  unit: { type: String, trim: true },
  basicAmount: { type: Number, default: 0 }
}, { _id: false });

const PurchaseOrderYearSchema = new mongoose.Schema({
  fy: { type: String, trim: true },
  poNumber: { type: String, trim: true },
  annualReturnYear: { type: String, trim: true },
  quotationNo: { type: String, trim: true },
  compliancePoDate: { type: String, trim: true },
  compliancePoFile: { type: mongoose.Schema.Types.Mixed, default: null },
  serviceCategory: { type: [String], default: [] },
  value: { type: Number, default: 0 }
}, { _id: false });

const ProformaInvoiceSchema = new mongoose.Schema({
  proformaNumber: { type: String, required: true, unique: true, index: true, trim: true },
  quotationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation', index: true },
  leadRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', index: true },
  clientRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', index: true },
  quotationNumber: { type: String, trim: true, index: true },
  poNumber: { type: String, trim: true, index: true },
  leadId: { type: String, trim: true },
  leadCode: { type: String, trim: true },
  companyName: { type: String, required: true, trim: true, index: true },
  leadDetails: { type: mongoose.Schema.Types.Mixed, default: {} },
  invoiceDate: { type: Date, default: Date.now },
  invoiceDetails: { type: Map, of: String, default: {} },
  validUntil: { type: String, trim: true },
  pricingMode: { type: String, enum: ['combined', 'individual'], default: 'individual' },
  combinedBasicAmount: { type: Number, default: 0 },
  items: { type: [ProformaItemSchema], default: [] },
  poYearCount: { type: Number, min: 0, max: 50, default: 0 },
  poYearRows: { type: [PurchaseOrderYearSchema], default: [] },
  terms: { type: [String], default: [] },
  scopeOfWork: { type: [String], default: [] },
  subtotal: { type: Number, default: 0 },
  gstRate: { type: Number, default: 18 },
  gstAmount: { type: Number, default: 0 },
  grandTotal: { type: Number, default: 0 },
  status: { type: String, enum: ['draft', 'issued', 'cancelled'], default: 'issued', index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('ProformaInvoice', ProformaInvoiceSchema);
