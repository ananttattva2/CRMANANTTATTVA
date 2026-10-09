const { buildDataWorkflowEmail } = require('./dataWorkflowEmail');
const User = require('../models/User');
const Team = require('../models/Team');
const Notification = require('../models/Notification');
const { sendMail } = require('../utils/mailer');

const label = (user) => user?.name || user?.email || 'CRM User';
const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

async function managerFor(user) {
  const userId = user?._id || user?.id;
  if (!userId) return null;
  const fresh = await User.findById(userId).select('managerId').lean();
  if (fresh?.managerId) return User.findById(fresh.managerId).select('name email role isActive').lean();
  const team = await Team.findOne({ members: userId }).populate('manager', 'name email role isActive').lean();
  return team?.manager || null;
}

async function complianceUsers() {
  const users = await User.find({ isActive: true }).select('name email role').lean();
  return users.filter((user) => String(user.role || '').toLowerCase().includes('compliance'));
}

async function notifySalesWorkflow({ stage, client, sales, actor, message = '', preventDuplicate = false }) {
  const clientId = String(client?._id || '');
  const clientName = client?.data?.basic?.clientLegalName || client?.data?.basic?.tradeName || 'Client';
  let recipients = [];
  if (['manager_pending', 'excel_uploaded'].includes(stage)) recipients = [await managerFor(actor)].filter(Boolean);
  else if (stage === 'compliance_pending') recipients = await complianceUsers();
  else if (sales.submittedBy) recipients = [await User.findById(sales.submittedBy).select('name email role isActive').lean()].filter(Boolean);
  recipients = recipients.filter((user) => user?.isActive !== false);
  if (!recipients.length) return { ok: false, reason: 'recipient_missing' };

  const kind = `sales_data_${stage}`;
  const metadata = { clientId, clientName, financialYear: sales.financialYear, dataVersion: sales.dataVersion || 0, stage, actor: label(actor) };
  if (preventDuplicate && await Notification.exists({ kind, 'metadata.clientId': clientId, 'metadata.financialYear': sales.financialYear, 'metadata.dataVersion': sales.dataVersion || 0 })) return { ok: true, skipped: true };
  const titles = {
    excel_uploaded: 'Sales Excel files uploaded',
    manager_pending: 'Sales Data ready for Manager review', compliance_pending: 'Sales Data ready for Compliance review',
    manager_rejected: 'Sales Data returned for rework', compliance_approved: 'Sales Data fully approved',
    compliance_rejected: 'Sales Data returned by Compliance'
  };
  const title = titles[stage] || 'Sales Data workflow updated';
  const description = `${clientName} (${sales.financialYear}): ${message || title}.`;
  const notification = await Notification.create({ title, description, tag: 'Sales Data', kind, createdBy: actor?._id, createdByName: label(actor), audience: recipients.map((user) => user._id), visibleToRoles: ['admin', 'superadmin'], metadata });
  const emailRecipients = recipients.filter((user) => user.email);
  const emailResults = await Promise.allSettled(emailRecipients.map((recipient) => sendMail(recipient.email, `${title} - ${clientName}`, buildDataWorkflowEmail({ title, moduleName: 'Sales', clientName, financialYear: sales.financialYear, actorName: label(actor), recipientName: recipient.name, record: sales, stage, message }), { branded: false })));
  return { ok: true, notification, recipientCount: recipients.length, emailSent: emailResults.filter((result) => result.status === 'fulfilled').length, emailFailed: emailResults.filter((result) => result.status === 'rejected').length };
}

module.exports = { notifySalesWorkflow };
