const mongoose = require('mongoose');
const challenge = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true
  },
  hash: String,
  expiresAt: Date,
  lastSentAt: Date,
  attempts: {
    type: Number,
    default: 0
  }
});
challenge.index({
  expiresAt: 1
}, {
  expireAfterSeconds: 86400
});
const rate = new mongoose.Schema({
  key: {
    type: String,
    unique: true
  },
  count: Number,
  expiresAt: Date
});
rate.index({
  expiresAt: 1
}, {
  expireAfterSeconds: 0
});
module.exports = {
  ClientLoginChallenge: mongoose.model('ClientLoginChallenge', challenge),
  ClientLoginRate: mongoose.model('ClientLoginRate', rate)
};
