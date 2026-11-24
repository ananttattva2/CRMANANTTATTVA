const mongoose = require('mongoose');

const ALLOWED_FIELDS = ['communicationMode', 'status', 'industryType', 'applicantType', 'financialYear', 'state', 'city', 'salutation', 'designation', 'source', 'businessCategory', 'eprCategory'];

const LeadDropdownOptionSchema = new mongoose.Schema({
  field: { type: String, required: true, enum: ALLOWED_FIELDS, trim: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  normalizedName: { type: String, required: true, trim: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

LeadDropdownOptionSchema.index({ field: 1, normalizedName: 1 }, { unique: true });
LeadDropdownOptionSchema.statics.ALLOWED_FIELDS = ALLOWED_FIELDS;

module.exports = mongoose.model('LeadDropdownOption', LeadDropdownOptionSchema);
