const mongoose = require('mongoose');
module.exports = mongoose.model('ClientDeactivation', new mongoose.Schema({
  companyKey: { type: String, required: true, unique: true },
  clientName: String,
  clientIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Client' }],
  status: { type: String, enum: ['MANAGER_PENDING', 'ADMIN_PENDING', 'INACTIVE', 'REJECTED'], required: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  history: [{ action: String, reason: String, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, at: Date }]
}, { timestamps: true }));
