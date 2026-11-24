const mongoose = require('mongoose');

const AttachmentSchema = new mongoose.Schema({
  name: { type: String, trim: true, default: '' }, url: { type: String, required: true, trim: true },
  publicId: { type: String, trim: true, default: '' }, type: { type: String, trim: true, default: '' }, size: { type: Number, default: 0 }
}, { _id: false });

const MessageSchema = new mongoose.Schema({
  message: { type: String, trim: true, default: '' }, author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  authorName: { type: String, trim: true, default: '' }, authorRole: { type: String, trim: true, default: '' },
  attachments: { type: [AttachmentSchema], default: [] }
}, { timestamps: true });

const CallSessionSchema = new mongoose.Schema({
  initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  initiatedByName: { type: String, trim: true, default: '' },
  mode: { type: String, enum: ['audio', 'video'], default: 'audio' },
  status: { type: String, enum: ['ringing', 'active', 'rejected', 'ended'], default: 'ringing' },
  offer: { type: String, default: '' }, answer: { type: String, default: '' },
  startedAt: Date, answeredAt: Date, endedAt: Date
}, { _id: false });

const InternalTicketSchema = new mongoose.Schema({
  ticketNumber: { type: String, unique: true, index: true }, subject: { type: String, required: true, trim: true, maxlength: 180 },
  priority: { type: String, enum: ['Low', 'Medium', 'High', 'Urgent'], default: 'Medium', index: true },
  status: { type: String, enum: ['Open', 'In Progress', 'Resolved', 'Closed'], default: 'Open', index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],
  messages: { type: [MessageSchema], default: [] }, lastMessageAt: { type: Date, default: Date.now, index: true },
  callSession: { type: CallSessionSchema, default: null }
}, { timestamps: true });

InternalTicketSchema.index({ participants: 1, lastMessageAt: -1 });
module.exports = mongoose.model('InternalTicket', InternalTicketSchema);
