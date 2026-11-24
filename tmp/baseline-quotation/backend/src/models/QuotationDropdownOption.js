const mongoose = require('mongoose');

const ALLOWED_FIELDS = ['industryType', 'serviceCategory', 'servicesForYear', 'eprCategory', 'businessCategory'];

const QuotationDropdownOptionSchema = new mongoose.Schema({
  field: { type: String, required: true, enum: ALLOWED_FIELDS, trim: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  normalizedName: { type: String, required: true, trim: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

QuotationDropdownOptionSchema.index({ field: 1, normalizedName: 1 }, { unique: true });
QuotationDropdownOptionSchema.statics.ALLOWED_FIELDS = ALLOWED_FIELDS;

module.exports = mongoose.model('QuotationDropdownOption', QuotationDropdownOptionSchema);
