const mongoose = require('mongoose');

const TicketAttachmentSchema = new mongoose.Schema({
  name: { type: String, trim: true, default: '' },
  url: { type: String, required: true, trim: true },
  publicId: { type: String, trim: true, default: '' },
  type: { type: String, trim: true, default: '' },
  size: { type: Number, default: 0 }
}, { _id: false });

const TicketMessageSchema = new mongoose.Schema({
  message: { type: String, required: true, trim: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  authorName: { type: String, trim: true, default: '' },
  authorRole: { type: String, trim: true, default: '' },
  attachments: { type: [TicketAttachmentSchema], default: [] }
}, { timestamps: true, _id: true });

const SupportTicketSchema = new mongoose.Schema({
  ticketNumber: { type: String, unique: true, index: true },
  category: { type: String, enum: ['Lead', 'Quotation', 'Client Master', 'Proforma Invoice'], required: true, index: true },
  subject: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, required: true, trim: true, maxlength: 5000 },
  referenceNumber: { type: String, trim: true, default: '' },
  priority: { type: String, enum: ['Low', 'Medium', 'High', 'Urgent'], default: 'Medium', index: true },
  status: { type: String, enum: ['Open', 'In Progress', 'Resolved', 'Closed'], default: 'Open', index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  createdByName: { type: String, trim: true, default: '' },
  createdByEmail: { type: String, trim: true, default: '' },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  resolvedAt: { type: Date },
  attachments: { type: [TicketAttachmentSchema], default: [] },
  messages: { type: [TicketMessageSchema], default: [] }
}, { timestamps: true });

SupportTicketSchema.index({ createdBy: 1, createdAt: -1 });

module.exports = mongoose.model('SupportTicket', SupportTicketSchema);
