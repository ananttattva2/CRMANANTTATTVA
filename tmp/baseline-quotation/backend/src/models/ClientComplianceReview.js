const mongoose = require('mongoose');

const SectionSchema = new mongoose.Schema({
  key: { type: String, required: true },
  label: { type: String, required: true },
  status: { type: String, enum: ['NOT_REVIEWED', 'VERIFIED', 'CHANGES_REQUIRED', 'NOT_APPLICABLE'], default: 'NOT_REVIEWED' },
  remarks: { type: String, trim: true, maxlength: 1000, default: '' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date }
}, { _id: false });

const ClientComplianceReviewSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, unique: true, index: true },
  status: { type: String, enum: ['PENDING', 'IN_REVIEW', 'CHANGES_REQUIRED', 'PARTIALLY_APPROVED', 'APPROVED', 'REJECTED'], default: 'PENDING', index: true },
  sections: { type: [SectionSchema], default: [] },
  finalRemarks: { type: String, trim: true, maxlength: 1000, default: '' },
  assignedReviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  history: [{ action: String, sectionKey: String, remarks: String, actionBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, actionAt: { type: Date, default: Date.now } }]
}, { timestamps: true });

module.exports = mongoose.model('ClientComplianceReview', ClientComplianceReviewSchema);
