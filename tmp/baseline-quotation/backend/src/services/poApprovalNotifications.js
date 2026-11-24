const User = require('../models/User');
const Notification = require('../models/Notification');
const { sendMail } = require('../utils/mailer');

const REVIEWER_ROLES = ['manager', 'admin', 'superadmin'];

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function fileUrl(file = {}) {
  return String(file.secureUrl || file.url || file.fileUrl || '').trim();
}

async function notifyPoSpecialApproval({ client, annualYear, submitter, workflow }) {
  const approvalId = String(workflow?.savedAt || '').trim();
  const clientId = String(client?._id || '');
  if (!approvalId || !clientId || workflow?.mode !== 'no') return { ok: false, reason: 'not_applicable' };

  const existing = await Notification.findOne({
    kind: 'po_special_approval',
    'metadata.clientId': clientId,
    'metadata.approvalId': approvalId
  }).lean();
  if (existing) return { ok: true, skipped: true, notificationId: existing._id };

  const recipients = await User.find({ role: { $in: REVIEWER_ROLES }, isActive: { $ne: false } })
    .select('_id name email role')
    .lean();
  const files = Array.isArray(workflow.approvalFiles) ? workflow.approvalFiles : [];
  const primaryFile = files.find((file) => fileUrl(file));
  const clientName = client?.data?.basic?.clientLegalName || client?.data?.basic?.tradeName || 'Client';
  const submittedBy = submitter?.name || submitter?.email || 'CRM User';
  const description = `${submittedBy} submitted special PO approval for ${clientName} (${annualYear}).`;
  const metadata = {
    clientId,
    clientName,
    annualYear,
    approvalId,
    approvalNote: String(workflow.approvalNote || '').trim(),
    approvalFiles: files,
    submittedBy,
    submittedById: String(submitter?._id || ''),
    recipientCount: recipients.length
  };

  const notification = await Notification.create({
    title: 'PO special approval received',
    description,
    tag: 'PO Approval',
    kind: 'po_special_approval',
    createdBy: submitter?._id,
    createdByName: submittedBy,
    audience: recipients.map((recipient) => recipient._id),
    visibleToRoles: REVIEWER_ROLES,
    attachmentName: String(primaryFile?.name || 'Approval proof').trim(),
    attachmentUrl: fileUrl(primaryFile),
    metadata
  });
  notification.crmNotificationId = String(notification._id);
  await notification.save();

  const proofLinks = files.map((file) => {
    const url = fileUrl(file);
    return url ? `<li style="margin:8px 0"><a href="${escapeHtml(url)}">${escapeHtml(file.name || 'Approval proof')}</a></li>` : '';
  }).filter(Boolean).join('');
  const html = `<div style="font-family:Arial,sans-serif;color:#334155">
    <h2 style="color:#0f766e">PO special approval received</h2>
    <p>${escapeHtml(description)}</p>
    <p><strong>Approval note:</strong> ${escapeHtml(workflow.approvalNote || 'No note provided')}</p>
    ${proofLinks ? `<p><strong>Uploaded proof:</strong></p><ul>${proofLinks}</ul>` : ''}
    <p>Please open CRM Notification Center to review the full submission.</p>
  </div>`;
  const mailResults = await Promise.allSettled(recipients.filter((recipient) => recipient.email).map((recipient) => (
    sendMail(recipient.email, `PO Approval - ${clientName}`, html)
  )));

  metadata.emailSent = mailResults.filter((result) => result.status === 'fulfilled').length;
  metadata.emailFailed = mailResults.filter((result) => result.status === 'rejected').length;
  notification.metadata = metadata;
  notification.markModified('metadata');
  await notification.save();
  return { ok: true, notificationId: notification._id, recipientCount: recipients.length, ...metadata };
}

module.exports = { notifyPoSpecialApproval };
