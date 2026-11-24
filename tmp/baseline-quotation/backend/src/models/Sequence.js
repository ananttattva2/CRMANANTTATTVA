const mongoose = require('mongoose');

const SequenceSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, trim: true },
  value: { type: Number, required: true, default: 0, min: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Sequence', SequenceSchema);
