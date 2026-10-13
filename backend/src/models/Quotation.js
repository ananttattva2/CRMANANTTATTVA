const mongoose = require('mongoose');

const QuoteLeadDetailsSchema = new mongoose.Schema({
  referredBy: { type: String, trim: true },
  salutation: { type: String, trim: true },
  contactPerson: { type: String, trim: true },
  designation: { type: String, trim: true },
  mobileNo1: { type: String, trim: true },
  mobileNo2: { type: String, trim: true },
  companyName: { type: String, trim: true },
  addressLine1: { type: String, trim: true },
  addressLine2: { type: String, trim: true },
  addressLine3: { type: String, trim: true },
  state: { type: String, trim: true },
  city: { type: String, trim: true },
  pinCode: { type: String, trim: true },
  gstNumber: { type: String, trim: true, uppercase: true, maxlength: 15 }
}, { _id: false });

const QuoteItemSchema = new mongoose.Schema({
  id: { type: String, trim: true },
  assignedServiceId: { type: String, trim: true },
  sourceServiceIndex: { type: Number, min: 0 },
  serviceAddedBy: { type: String, trim: true },
  industryType: { type: String, trim: true },
  financialYear: { type: String, trim: true },
  validityPeriod: { type: Number, min: 1, max: 50 },
  servicePeriod: { type: Number, min: 0, max: 3650 },
  periodUnit: { type: String, trim: true, enum: ['days', 'months', 'annual'], default: 'annual' },
  transitionPeriod: { type: String, trim: true, enum: ['Yes', 'No'], default: 'No' },
  annualReturnYears: { type: [String], default: [] },
  annualReturnEprCreditYears: {
    type: [{ type: String, enum: ['2022-23', '2023-24', '2024-25', '2025-26', '2026-27', '2027-28', '2028-29', '2029-30'] }],
    default: []
  },
  servicesOffered: { type: String, trim: true },
  applicableService: { type: String, trim: true },
  serviceCategory: { type: String, trim: true },
  serviceStartDate: { type: String, trim: true },
  serviceEndDate: { type: String, trim: true },
  servicesForYear: { type: String, trim: true },
  eprCategory: { type: String, trim: true },
  businessCategory: { type: String, trim: true, maxlength: 100 },
  piboParent: { type: String, enum: ['PIBO', 'SIMP', 'PWP'], trim: true },
  piboCategoryParent: { type: String, enum: ['PIBO', 'SIMP', 'PWP'], trim: true },
  piboCategory: { type: String, trim: true },
  applicantType: { type: String, trim: true },
  subApplicantType: { type: String, trim: true },
  unit: { type: String, trim: true },
  unitName: { type: String, trim: true, maxlength: 120 },
  unitLabel: { type: String, trim: true },
  basicAmount: { type: Number, default: 0 }
}, { _id: false });

const CombinedPricingGroupSchema = new mongoose.Schema({
  id: { type: String, required: true, trim: true },
  name: { type: String, trim: true, maxlength: 120 },
  itemKeys: { type: [String], default: [] },
  basicAmount: { type: Number, default: 0 }
}, { _id: false });

const QuotationSchema = new mongoose.Schema({
  quotationNumber: { type: String, trim: true, index: true },
  leadId: { type: String, trim: true, index: true },
  leadRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', index: true },
  clientRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', index: true },
  leadCode: { type: String, trim: true, index: true },
  businessLeadCode: { type: String, trim: true, index: true },
  companyName: { type: String, trim: true },
  leadDetails: { type: QuoteLeadDetailsSchema, default: {} },
  quotationDate: { type: Date },
  validUntil: { type: String, trim: true },
  pricingMode: { type: String, enum: ['combined', 'individual'], default: 'individual' },
  serviceState: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
  combinedBasicAmount: { type: Number, default: 0 },
  combinedPricingGroups: { type: [CombinedPricingGroupSchema], default: [] },
  items: { type: [QuoteItemSchema], default: [] },
  terms: { type: [String], default: [] },
  paymentTerm: { type: String, trim: true },
  scopeOfWork: { type: [String], default: [] },
  subtotal: { type: Number, default: 0 },
  grandTotal: { type: Number, default: 0 },
  status: { type: String, enum: ['draft', 'submitted', 'sent', 'admin_approved', 'approved', 'rejected'], default: 'draft', index: true },
  source: { type: String, trim: true, default: 'crm', index: true },
  lastSyncedAt: { type: Date },
  syncMatchStatus: { type: String, enum: ['matched', 'unmatched'], default: 'matched', index: true },
  unmatchedReason: { type: String, trim: true },
  createdByName: { type: String, trim: true },
  fromName: { type: String, trim: true, maxlength: 120 },
  preparedByName: { type: String, trim: true, maxlength: 120 },
  leadGeneratedBy: { type: String, trim: true },
  assignedUserName: { type: String, trim: true },
  revisionHistory: { type: Array, default: [] },
  managementApproval: { type: mongoose.Schema.Types.Mixed, default: {} },
  approvalDecision: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

QuotationSchema.index(
  { leadId: 1, quotationNumber: 1 },
  { unique: true, partialFilterExpression: { leadId: { $type: 'string' }, quotationNumber: { $type: 'string' } } }
);
QuotationSchema.index({ 'managementApproval.status': 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Quotation', QuotationSchema);
