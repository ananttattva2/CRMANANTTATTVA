const mongoose = require('mongoose');

const CalendarItemSchema = new mongoose.Schema({
  externalId: { type: String, unique: true, sparse: true, trim: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: '' },
  clientKey: { type: String, trim: true, default: '', index: true },
  clientNumber: { type: String, trim: true, default: '' },
  clientName: { type: String, trim: true, default: '' },
  leadNumber: { type: String, trim: true, default: '' },
  leadCompanyName: { type: String, trim: true, default: '' },
  updateReason: { type: String, trim: true, default: '' },
  priority: { type: String, trim: true, default: 'Medium', index: true },
  category: { type: String, trim: true, default: 'General', index: true },
  scheduledDate: { type: String, trim: true, default: '', index: true },
  scheduledTime: { type: String, trim: true, default: '' },
  assignedTo: { type: String, trim: true, default: '' },
  assignedToName: { type: String, trim: true, default: '' },
  assignedToEmail: { type: String, trim: true, default: '' },
  assignedToId: { type: String, trim: true, default: '', index: true },
  status: { type: String, trim: true, default: 'open', index: true },
  type: { type: String, trim: true, default: 'todo', index: true },
  history: { type: Array, default: [] },
  assignmentHistory: { type: Array, default: [] },
  completionHistory: { type: Array, default: [] },
  completionRemarks: { type: String, trim: true, default: '' },
  completedAt: { type: String, trim: true, default: '' },
  createdBy: { type: String, trim: true, default: '' },
  createdByUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  source: { type: String, trim: true, default: 'crm' }
}, { timestamps: true, strict: false });

CalendarItemSchema.index({ scheduledDate: 1, status: 1, type: 1 });

module.exports = mongoose.model('CalendarItem', CalendarItemSchema);
