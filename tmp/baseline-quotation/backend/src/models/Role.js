const mongoose = require('mongoose');

const RoleSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  label: { type: String, trim: true },
  permissions: { type: [String], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('Role', RoleSchema);
