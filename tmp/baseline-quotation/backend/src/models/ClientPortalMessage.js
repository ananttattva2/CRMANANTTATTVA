const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  sender: { type: String, required: true },
  recipient: { type: String, required: true },
  recipientName: String,
  recipientRole: String,
  body: { type: String, maxlength: 5000, required: true },
  emailStatus: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' }
}, { timestamps: true });
schema.index({ lead: 1, sender: 1, createdAt: -1 });
module.exports = mongoose.model('ClientPortalMessage', schema);
