const mongoose = require('mongoose');

const InternalTicketEmailDeliverySchema = new mongoose.Schema({
  ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'InternalTicket', required: true, index: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['sending', 'sent', 'failed'], default: 'sending', required: true },
  sentAt: Date,
  error: { type: String, default: '' }
}, { timestamps: true });

// This database constraint is the final line of defence against concurrent
// requests attempting to send the same first-message notification twice.
InternalTicketEmailDeliverySchema.index(
  { ticket: 1, sender: 1, recipient: 1 },
  { unique: true, name: 'one_first_message_email_per_direction' }
);

module.exports = mongoose.model('InternalTicketEmailDelivery', InternalTicketEmailDeliverySchema);
