const mongoose = require('mongoose');

const TeamSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  description: { type: String, trim: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  operationHead: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  crmTeamId: { type: String, unique: true, sparse: true, trim: true },
  source: { type: String, trim: true, default: 'crm' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('Team', TeamSchema);
