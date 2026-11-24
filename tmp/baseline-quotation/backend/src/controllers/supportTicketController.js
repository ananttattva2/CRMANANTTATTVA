const SupportTicket = require('../models/SupportTicket');
const { getVisibleUserScope } = require('../utils/visibilityScope');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { notifyTicketRaised, notifyTicketResolved } = require('../services/supportTicketEmails');

const ADMIN_ROLES = ['admin', 'superadmin'];
const CATEGORIES = ['Lead', 'Quotation', 'Client Master', 'Proforma Invoice'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];

function cleanAttachments(value) {
  return (Array.isArray(value) ? value : []).slice(0, 5).map((item) => ({
    name: String(item?.name || '').trim().slice(0, 180),
    url: String(item?.secureUrl || item?.url || '').trim(),
    publicId: String(item?.publicId || '').trim().slice(0, 250),
    type: String(item?.type || '').trim().slice(0, 100),
    size: Math.max(0, Number(item?.size) || 0)
  })).filter((item) => /^https:\/\//i.test(item.url) && (!item.type || item.type.startsWith('image/')));
}

function isAdmin(user) {
  return ADMIN_ROLES.includes(String(user?.role || '').toLowerCase());
}

async function nextTicketNumber() {
  const prefix = `TKT-${new Date().getFullYear()}-`;
  const latest = await SupportTicket.findOne({ ticketNumber: new RegExp(`^${prefix}`) }).sort({ ticketNumber: -1 }).select('ticketNumber').lean();
  const next = (Number(String(latest?.ticketNumber || '').split('-').pop()) || 0) + 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}

exports.listTickets = async (req, res) => {
  const scope = await getVisibleUserScope(req.user);
  const query = scope === null ? {} : { createdBy: { $in: scope.ids } };
  if (req.query.status && STATUSES.includes(req.query.status)) query.status = req.query.status;
  if (req.query.category && CATEGORIES.includes(req.query.category)) query.category = req.query.category;
  const tickets = await SupportTicket.find(query).sort({ updatedAt: -1 }).lean();
  res.json({ ok: true, tickets });
};

exports.createTicket = async (req, res) => {
  const category = String(req.body.category || '').trim();
  const subject = String(req.body.subject || '').trim();
  const description = String(req.body.description || '').trim();
  const priority = PRIORITIES.includes(req.body.priority) ? req.body.priority : 'Medium';
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Please select a valid ticket category' });
  if (!subject) return res.status(400).json({ error: 'Subject is required' });
  if (!description) return res.status(400).json({ error: 'Issue description is required' });
  const attachments = cleanAttachments(req.body.attachments);
  if (!attachments.length) return res.status(400).json({ error: 'At least one issue screenshot is required before submitting the ticket' });

  const ticket = await SupportTicket.create({
    ticketNumber: await nextTicketNumber(), category, subject, description, priority,
    referenceNumber: String(req.body.referenceNumber || '').trim(),
    attachments,
    createdBy: req.user._id, createdByName: req.user.name || '', createdByEmail: req.user.email || '',
    messages: [{ message: description, author: req.user._id, authorName: req.user.name || req.user.email, authorRole: req.user.role }]
  });
  await notifyTicketRaised(ticket.toObject()).catch((error) => console.error(`Support ticket ${ticket.ticketNumber} notification failed`, error.message));
  res.status(201).json({ ok: true, ticket });
};

exports.updateTicket = async (req, res) => {
  const ticket = await SupportTicket.findById(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  const ownsTicket = String(ticket.createdBy) === String(req.user._id);
  if (!ownsTicket && !isAdmin(req.user)) return res.status(403).json({ error: 'You cannot update this ticket' });

  const previousStatus = ticket.status;
  const message = String(req.body.message || '').trim();
  const completingTicket = ['Resolved', 'Closed'].includes(req.body.status);
  const messageAttachments = completingTicket && isAdmin(req.user) ? cleanAttachments(req.body.attachments) : [];
  if (message) ticket.messages.push({ message, author: req.user._id, authorName: req.user.name || req.user.email, authorRole: req.user.role, attachments: messageAttachments });
  if (req.body.status && isAdmin(req.user)) {
    if (!STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Invalid ticket status' });
    if (['Resolved', 'Closed'].includes(req.body.status) && !message) return res.status(400).json({ error: `A ${req.body.status.toLowerCase()} note is required` });
    ticket.status = req.body.status;
    ticket.resolvedAt = ['Resolved', 'Closed'].includes(req.body.status) ? new Date() : undefined;
    ticket.assignedTo = ticket.assignedTo || req.user._id;
  }
  if (!message && !req.body.status) return res.status(400).json({ error: 'Add a reply or status update' });
  await ticket.save();
  const savedTicket = await SupportTicket.findById(ticket._id).lean();
  if (message) {
    const audience = isAdmin(req.user)
      ? [ticket.createdBy]
      : (await User.find({ role: { $in: ADMIN_ROLES }, isActive: { $ne: false } }).select('_id').lean()).map((user) => user._id);
    if (audience.length) {
      const notification = await Notification.create({
        title: `${ticket.ticketNumber}: New support ticket reply`,
        description: `${req.user.name || req.user.email}: ${message}`,
        tag: 'Support Ticket', kind: 'support_ticket_reply', status: 'Active',
        createdBy: req.user._id, createdByName: req.user.name || req.user.email,
        audience, metadata: { ticketId: ticket._id, ticketNumber: ticket.ticketNumber }
      });
      notification.crmNotificationId = String(notification._id);
      await notification.save();
    }
  }
  const completedStatusChanged = previousStatus !== ticket.status && ['Resolved', 'Closed'].includes(ticket.status);
  if (completedStatusChanged) {
    await notifyTicketResolved(savedTicket, req.user, message, messageAttachments).catch((error) => console.error(`Support ticket ${ticket.ticketNumber} resolution email failed`, error.message));
  }
  res.json({ ok: true, ticket: savedTicket });
};

module.exports.__test = { isAdmin, cleanAttachments };
