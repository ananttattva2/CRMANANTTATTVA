const mongoose = require('mongoose');

const LeadServiceCatalogSchema = new mongoose.Schema({
  category: { type: String, required: true, trim: true },
  normalizedCategory: { type: String, required: true, unique: true, index: true },
  servicesOffered: [{ type: String, trim: true }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('LeadServiceCatalog', LeadServiceCatalogSchema);
