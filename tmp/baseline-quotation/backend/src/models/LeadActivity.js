const mongoose = require('mongoose');

const LeadActivitySchema = new mongoose.Schema({
  lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  type: { type: String, required: true, trim: true, index: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: '' },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  actorName: { type: String, trim: true, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

module.exports = mongoose.model('LeadActivity', LeadActivitySchema);
