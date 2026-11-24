const mongoose = require('mongoose');

const ReminderDeliverySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, trim: true },
  status: { type: String, enum: ['sending', 'sent'], default: 'sending', index: true },
  leaseUntil: { type: Date, required: true },
  sentAt: { type: Date, default: null },
  attempts: { type: Number, default: 1 }
}, { timestamps: true });

module.exports = mongoose.model('ReminderDelivery', ReminderDeliverySchema);
