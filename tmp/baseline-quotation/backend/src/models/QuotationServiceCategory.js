const mongoose = require('mongoose');

const QuotationServiceCategorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('QuotationServiceCategory', QuotationServiceCategorySchema);
