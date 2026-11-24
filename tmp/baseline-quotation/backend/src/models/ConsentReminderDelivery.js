const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  status: { type: String, enum: ['pending', 'sending', 'sent'], default: 'pending' },
  claim: String, leaseUntil: Date, sentAt: Date, lastError: String,
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  recipient: String, kind: String, validUntil: String
}, { timestamps: true });
module.exports = mongoose.model('ConsentReminderDelivery', schema);
