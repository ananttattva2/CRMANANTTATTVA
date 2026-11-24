const mongoose = require('mongoose');

const UserSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sessionId: { type: String, required: true, unique: true, index: true },
  loginAt: { type: Date, required: true, default: Date.now, index: true },
  lastActivityAt: { type: Date, required: true, default: Date.now },
  logoutAt: { type: Date },
  ipAddress: { type: String, trim: true },
  userAgent: { type: String, trim: true },
  loginMode: { type: String, trim: true },
  activityCount: { type: Number, default: 0 },
  activeSeconds: { type: Number, default: 0 },
  lastHeartbeatAt: { type: Date },
  presenceState: { type: String, enum: ['active', 'away'], default: 'active' },
  awaySince: { type: Date },
  presenceTimeline: { type: Array, default: [] }
}, { timestamps: true });

module.exports = mongoose.model('UserSession', UserSessionSchema);
