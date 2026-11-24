const mongoose = require('mongoose');

const QuotationPiboCategorySchema = new mongoose.Schema({
  parent: { type: String, required: true, enum: ['PIBO', 'SIMP', 'PWP'], trim: true, uppercase: true },
  name: { type: String, required: true, trim: true, maxlength: 60 },
  normalizedName: { type: String, required: true, trim: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

QuotationPiboCategorySchema.index(
  { normalizedName: 1 },
  { unique: true, partialFilterExpression: { normalizedName: { $type: 'string' } } }
);

module.exports = mongoose.model('QuotationPiboCategory', QuotationPiboCategorySchema);
