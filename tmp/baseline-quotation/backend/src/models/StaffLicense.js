const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, required: true },
  codeHash: { type: String, unique: true, required: true, select: false },
  encryptedCode: { type: String, required: true, select: false },
  roleTag: { type: String, enum: ['USR', 'ADM', 'SADM'], required: true },
  email: { type: String, required: true },
  issuedAt: Date,
  expiresAt: { type: Date, index: true },
  renewalCount: { type: Number, default: 0 },
  renewedAt: Date,
  deliveredAt: Date,
  retryAt: Date,
  leaseUntil: Date,
  attempts: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('StaffLicense', schema);
