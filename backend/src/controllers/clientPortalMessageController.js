const { portalContacts } = require('../services/clientPortalContacts');
const Message = require('../models/ClientPortalMessage');
const mailer = require('../utils/mailer');
const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
exports.contacts = async (req, res) => {
  try {
    const result = await portalContacts(req.clientEmail, req.query.lead);
    if (!result) return res.status(403).json({ error: 'Company is not linked to your account.' });
    return res.json(result.contacts);
  } catch { return res.status(503).json({ error: 'Support contacts could not be loaded.' }); }
};
exports.list = async (req, res) => {
  try {
    const result = await portalContacts(req.clientEmail, req.query.lead);
    if (!result) return res.status(403).json({ error: 'Company is not linked to your account.' });
    return res.json(await Message.find({ lead: result.lead._id, sender: req.clientEmail }).sort({ createdAt: -1 }).limit(100).select('body recipient recipientName recipientRole emailStatus createdAt').lean());
  } catch { return res.status(503).json({ error: 'Messages could not be loaded.' }); }
};
exports.send = async (req, res) => {
  try {
    const body = typeof req.body.message === 'string' ? req.body.message.trim() : '';
    if (!body || body.length > 5000) return res.status(422).json({ error: 'Enter a message between 1 and 5,000 characters.' });
    const result = await portalContacts(req.clientEmail, req.body.lead);
    if (!result) return res.status(403).json({ error: 'Company is not linked to your account.' });
    const recipient = result.contacts.find(row => row.id === req.body.recipient);
    if (!recipient) return res.status(422).json({ error: 'Select a contact from your account team.' });
    const recent = await Message.countDocuments({ sender: req.clientEmail, createdAt: { $gte: new Date(Date.now() - 3600000) } });
    if (recent >= 30) return res.status(429).json({ error: 'Message limit reached. Please try again later.' });
    const row = await Message.create({ lead: result.lead._id, sender: req.clientEmail, recipient: recipient.email, recipientName: recipient.name, recipientRole: recipient.role, body });
    try {
      await mailer.sendMail(recipient.email, `Client support request — ${result.lead.company || 'Client'}`, `<h2>Client support request</h2><p>Dear ${escape(recipient.name)},</p><p>A client has sent you a message through the Client Portal.</p><p><strong>Company:</strong> ${escape(result.lead.company)}<br><strong>Lead reference:</strong> ${escape(result.lead.leadCode)}<br><strong>Client contact:</strong> ${escape(req.clientEmail)}</p><div style="white-space:pre-wrap;padding:16px;background:#fff7ed">${escape(body)}</div><p>Please follow up with the client at <a href="mailto:${escape(req.clientEmail)}">${escape(req.clientEmail)}</a>.</p>`);
      row.emailStatus = 'sent';
    } catch { row.emailStatus = 'failed'; }
    await Message.updateOne({ _id: row._id }, { $set: { emailStatus: row.emailStatus } }).catch(() => {});
    return res.status(201).json({ _id: row._id, body: row.body, recipient: row.recipient, recipientName: row.recipientName, recipientRole: row.recipientRole, createdAt: row.createdAt, emailStatus: row.emailStatus });
  } catch { return res.status(503).json({ error: 'Message could not be saved. Please try again.' }); }
};
