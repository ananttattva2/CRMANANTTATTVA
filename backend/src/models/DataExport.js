const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  userName: String,
  userEmail: String,
  section: { type: String, required: true },
  filename: String,
  reason: { type: String, required: true, maxlength: 2000 },
  status: { type: String, enum: ['pending', 'authorized', 'notification_failed'], default: 'pending' },
  notifiedEmails: [String],
  recipientEmails: [String],
  emailStatus: { type: String, enum: ['pending', 'sent', 'partial', 'failed'], default: 'pending', index: true },
  emailAttempts: { type: Number, default: 0 },
  emailErrors: [String],
  lastEmailAttemptAt: Date,
  notificationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Notification' }
}, { timestamps: true });
module.exports = mongoose.model('DataExport', schema);
