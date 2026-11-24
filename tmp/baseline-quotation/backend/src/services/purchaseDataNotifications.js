const { buildDataWorkflowEmail } = require('./dataWorkflowEmail');
const User = require('../models/User');
const Team = require('../models/Team');
const Notification = require('../models/Notification');
const { sendMail } = require('../utils/mailer');

function label(user) { return user?.name || user?.email || 'CRM User'; }
function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

async function managerFor(user) {
  const userId = user?._id || user?.id;
  if (!userId) return null;
  const fresh = await User.findById(userId).select('managerId').lean();
  if (fresh?.managerId) return User.findById(fresh.managerId).select('name email role isActive').lean();
  const team = await Team.findOne({ members: userId }).populate('manager', 'name email role isActive').lean();
  return team?.manager || null;
}

async function activeComplianceUsers() {
  const users = await User.find({ isActive: true }).select('name email role').lean();
  return users.filter((user) => String(user.role || '').toLowerCase().includes('compliance'));
}

async function notifyPurchaseWorkflow({ stage, client, purchase, actor, message = '', preventDuplicate = false }) {
  const clientId = String(client?._id || '');
  const clientName = client?.data?.basic?.clientLegalName || client?.data?.basic?.tradeName || 'Client';
  const financialYear = purchase.financialYear;
  let recipients = [];
  if (['manager_pending', 'excel_uploaded'].includes(stage)) recipients = [await managerFor(actor)].filter(Boolean);
  else if (stage === 'compliance_pending') recipients = await activeComplianceUsers();
  else if (purchase.submittedBy) recipients = [await User.findById(purchase.submittedBy).select('name email role isActive').lean()].filter(Boolean);
  recipients = recipients.filter((user) => user?.isActive !== false);
  if (!recipients.length) return { ok: false, reason: 'recipient_missing' };

  const kind = `purchase_data_${stage}`;
  const version = purchase.dataVersion || 0;
  const existing = await Notification.findOne({ kind, 'metadata.clientId': clientId, 'metadata.financialYear': financialYear, 'metadata.dataVersion': version }).lean();
  if (preventDuplicate && existing) return { ok: true, skipped: true };
  const titleMap = {
    excel_uploaded: 'Purchase Excel files uploaded',
    manager_pending: 'Purchase Data ready for Manager review',
    compliance_pending: 'Purchase Data ready for Compliance review',
    manager_approved: 'Purchase Data approved by Manager',
    manager_rejected: 'Purchase Data returned for rework',
    compliance_approved: 'Purchase Data fully approved',
    compliance_rejected: 'Purchase Data returned by Compliance'
  };
  const title = titleMap[stage] || 'Purchase Data workflow updated';
  const description = `${clientName} (${financialYear}): ${message || title}.`;
  const notification = await Notification.create({
    title, description, tag: 'Purchase Data', kind, createdBy: actor?._id, createdByName: label(actor),
    audience: recipients.map((user) => user._id), visibleToRoles: ['admin', 'superadmin'],
    metadata: { clientId, clientName, financialYear, dataVersion: version, stage, actor: label(actor) }
  });
  const emailRecipients = recipients.filter((user) => user.email);
  const emailResults = await Promise.allSettled(emailRecipients.map((recipient) => sendMail(
    recipient.email,
    `${title} - ${clientName}`,
    buildDataWorkflowEmail({ title, moduleName: 'Purchase', clientName, financialYear: purchase.financialYear, actorName: label(actor), recipientName: recipient.name, record: purchase, stage, message }), { branded: false }
  )));
  emailResults.forEach((result, index) => {
    if (result.status === 'rejected') console.error('Purchase Data email failed', { email: emailRecipients[index]?.email, error: result.reason?.message || 'Email delivery failed' });
  });
  return { ok: true, notification, recipientCount: recipients.length, emailSent: emailResults.filter((result) => result.status === 'fulfilled').length, emailFailed: emailResults.filter((result) => result.status === 'rejected').length };
}

module.exports = { notifyPurchaseWorkflow };
