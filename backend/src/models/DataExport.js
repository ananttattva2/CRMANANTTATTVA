const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  userName: String,
  userEmail: String,
  section: { type: String, required: true },
  filename: String,
  reason: { type: String, required: true, maxlength: 2000 },
  status: { type: String, enum: ['pending', 'authorized', 'notification_failed'], default: 'pending' },
  notifiedEmails: [String]
}, { timestamps: true });
module.exports = mongoose.model('DataExport', schema);
