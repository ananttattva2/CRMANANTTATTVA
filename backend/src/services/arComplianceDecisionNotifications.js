const User = require('../models/User');
const Notification = require('../models/Notification');
const { sendMail } = require('../utils/mailer');
const { userHasAnyRole } = require('../utils/userRoles');

const label = (user) => user?.name || user?.email || 'CRM User';
const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));
const appUrl = () => String(process.env.FRONTEND_URL || process.env.APP_URL || 'https://crmananttattva.com').replace(/\/$/, '');

async function activeComplianceUsers() {
  const users = await User.find({ isActive: true }).select('name email role roles isActive').lean();
  return users.filter((user) => userHasAnyRole(user, ['compliance']));
}

async function submittingUsers({ client, purchase, sales }) {
  const ids = [
    purchase?.submittedBy,
    sales?.submittedBy,
    client?.submittedBy,
    client?.adminControls?.assignedTo,
    client?.selectedLead?.assignedStaff,
    client?.selectedLead?.assignedTo,
    client?.selectedLead?.createdBy,
    client?.createdBy
  ].map((value) => String(value?._id || value || '')).filter(Boolean);
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return [];
  return User.find({ _id: { $in: uniqueIds }, isActive: true }).select('name email role roles isActive').lean();
}

function emailHtml({ recipient, clientName, financialYear, stage, decision, remarks, actorName, clientId }) {
  const managerApproved = stage === 'manager' && decision === 'APPROVED';
  const title = managerApproved ? 'Annual Return ready for Compliance Review' : `Annual Return ${decision.replaceAll('_', ' ')}`;
  const intro = managerApproved
    ? `${actorName} approved the Manager Review. The record is now ready for your Compliance Review.`
    : `${actorName} completed the ${stage === 'manager' ? 'Manager' : 'Compliance'} Review with the decision shown below.`;
  const color = decision === 'REJECTED' ? '#dc2626' : decision === 'PARTIALLY_APPROVED' ? '#d97706' : '#087e6a';
  return `<div style="background:#f1f5f9;padding:28px 12px;font-family:Arial,Helvetica,sans-serif;color:#334155"><div style="max-width:660px;margin:auto;overflow:hidden;border:1px solid #dfe8ec;border-radius:18px;background:#fff"><div style="background:${color};padding:24px 28px;color:#fff"><div style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase">AnantTattva CRM · AR Compliance</div><h1 style="margin:8px 0 0;font-size:23px">${escapeHtml(title)}</h1></div><div style="padding:26px 28px"><p>Hello <strong>${escapeHtml(label(recipient))}</strong>,</p><p style="line-height:1.7">${escapeHtml(intro)}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc"><tr><td style="padding:12px;color:#64748b">Client</td><td style="padding:12px;text-align:right;font-weight:700">${escapeHtml(clientName)}</td></tr><tr><td style="border-top:1px solid #e2e8f0;padding:12px;color:#64748b">Financial Year</td><td style="border-top:1px solid #e2e8f0;padding:12px;text-align:right;font-weight:700">${escapeHtml(financialYear)}</td></tr><tr><td style="border-top:1px solid #e2e8f0;padding:12px;color:#64748b">Decision</td><td style="border-top:1px solid #e2e8f0;padding:12px;text-align:right;font-weight:800;color:${color}">${escapeHtml(decision.replaceAll('_', ' '))}</td></tr></table><div style="margin:20px 0;padding:15px;border-left:4px solid ${color};background:#f8fafc"><div style="margin-bottom:6px;color:#64748b;font-size:11px;font-weight:800;text-transform:uppercase">Review remarks</div><div style="white-space:pre-wrap;line-height:1.65">${escapeHtml(remarks)}</div></div><a href="${appUrl()}/compliance/ar/${encodeURIComponent(clientId)}?financialYear=${encodeURIComponent(financialYear)}" style="display:inline-block;border-radius:9px;background:#087e6a;padding:12px 18px;color:#fff;text-decoration:none;font-weight:700">Open AR Review</a><p style="margin-top:22px;color:#94a3b8;font-size:11px">This is an automated CRM workflow notification.</p></div></div></div>`;
}

async function notifyArComplianceDecision({ client, purchase, sales, financialYear, stage, decision, remarks, actor, eventKey = '', preventDuplicate = false }) {
  const managerApproved = stage === 'manager' && decision === 'APPROVED';
  let recipients = managerApproved
    ? await activeComplianceUsers()
    : await submittingUsers({ client, purchase, sales });
  recipients = [...new Map(recipients.filter((user) => user?.isActive !== false).map((user) => [String(user._id), user])).values()];
  if (!recipients.length) return { ok: false, reason: managerApproved ? 'active_compliance_recipient_missing' : 'submitting_user_missing' };

  const clientId = String(client?._id || '');
  const clientName = client?.data?.basic?.clientLegalName || client?.data?.basic?.tradeName || client?.selectedLead?.company || 'Client';
  const actorName = label(actor);
  const title = managerApproved
    ? 'Annual Return ready for Compliance Review'
    : `Annual Return ${stage === 'manager' ? 'Manager' : 'Compliance'} Review: ${decision.replaceAll('_', ' ')}`;
  const description = managerApproved
    ? `${actorName} approved ${clientName} (${financialYear}). Compliance review is now required.`
    : `${actorName} marked ${clientName} (${financialYear}) as ${decision.replaceAll('_', ' ')}. Remarks: ${remarks}`;
  const kind = `ar_compliance_${stage}_${decision.toLowerCase()}`;
  const normalizedEventKey = String(eventKey || '').trim();
  const duplicateFilter = {
    kind,
    'metadata.clientId': clientId,
    'metadata.financialYear': financialYear,
    'metadata.eventKey': normalizedEventKey
  };
  let notification = preventDuplicate ? await Notification.findOne(duplicateFilter).lean() : null;
  if (Number(notification?.metadata?.emailSent || 0) > 0) return { ok: true, skipped: true, reason: 'already_notified' };
  if (!notification) try {
    notification = await Notification.create({
      title,
      description,
      tag: 'AR Compliance',
      kind,
      createdBy: actor?._id,
      createdByName: actorName,
      audience: recipients.map((user) => user._id),
      visibleToRoles: ['admin', 'superadmin'],
      crmNotificationId: preventDuplicate ? `ar-compliance:${clientId}:${financialYear}:${stage}:${decision}:${normalizedEventKey}` : undefined,
      metadata: { clientId, clientName, financialYear, stage, decision, remarks, actorName, eventKey: normalizedEventKey }
    });
  } catch (error) {
    if (preventDuplicate && error?.code === 11000) return { ok: true, skipped: true, reason: 'already_notified' };
    throw error;
  }
  const emailRecipients = recipients.filter((user) => user.email);
  const results = await Promise.allSettled(emailRecipients.map((recipient) => sendMail(
    recipient.email,
    `${title} - ${clientName}`,
    emailHtml({ recipient, clientName, financialYear, stage, decision, remarks, actorName, clientId }),
    { branded: false }
  )));
  results.forEach((result, index) => {
    if (result.status === 'rejected') console.error('AR compliance decision email failed', { email: emailRecipients[index]?.email, clientId, financialYear, error: result.reason?.message || 'Email delivery failed' });
  });
  const emailSent = results.filter((result) => result.status === 'fulfilled').length;
  const emailFailed = results.filter((result) => result.status === 'rejected').length;
  await Notification.updateOne({ _id: notification._id }, {
    $set: {
      'metadata.recipientCount': recipients.length,
      'metadata.emailSent': emailSent,
      'metadata.emailFailed': emailFailed,
      'metadata.lastDeliveryAt': new Date()
    }
  }).catch((error) => console.error('Unable to record AR notification delivery result', { notificationId: String(notification._id), error: error.message }));
  return {
    ok: true,
    notificationId: notification._id,
    recipientCount: recipients.length,
    emailSent,
    emailFailed
  };
}

module.exports = { notifyArComplianceDecision };
