const Notification = require('../models/Notification');
const PendingApproval = require('../models/PendingApproval');
const User = require('../models/User');
const { sendMail } = require('../utils/mailer');

const ADMIN_ROLES = ['admin', 'superadmin'];

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

async function claimLeadRoyalty({ lead, claimant, financialYear, servicesOffered = [], eprCategories = [] }) {
  const leadId = String(lead?._id || lead?.id || lead?.sourceLeadId || '').trim();
  const company = String(lead?.company || 'Company').trim();
  const claimantId = String(claimant?._id || claimant?.id || '').trim();
  const claimantName = String(claimant?.name || claimant?.email || 'CRM User').trim();
  const originalCreator = String(lead?.importedCreatedBy || lead?.createdByName || lead?.createdByEmail || 'Original creator').trim();
  const originalCreatorId = String(lead?.createdByCrmUserId || lead?.createdBy?._id || '').trim();
  const originalCreatorEmail = String(lead?.createdByEmail || lead?.createdBy?.email || '').trim();
  const claimKey = `${leadId}:${claimantId}:${financialYear || 'latest'}`;
  const now = new Date();
  const dataFlag = servicesOffered.length && eprCategories.length ? 'GREEN' : 'RED';
  const previousApproval = await PendingApproval.findOne({ type: 'lead_royalty', source: 'crm', sourceClientId: claimKey }).lean();
  const previousDeadline = previousApproval?.payload?.correctionDeadline ? new Date(previousApproval.payload.correctionDeadline) : null;
  const correctionDeadline = previousDeadline && !Number.isNaN(previousDeadline.getTime())
    ? previousDeadline
    : new Date(now.getTime() + (2 * 24 * 60 * 60 * 1000));
  if (previousApproval?.payload?.dataFlag === 'RED' && dataFlag === 'GREEN' && correctionDeadline < now) {
    return { ok: false, expired: true, correctionDeadline: correctionDeadline.toISOString() };
  }
  const approval = await PendingApproval.findOneAndUpdate(
    { type: 'lead_royalty', source: 'crm', sourceClientId: claimKey },
    { $set: {
      uniqueId: `ROYALTY-${leadId}-${financialYear || 'LATEST'}`,
      clientName: company,
      approvalStatus: 'PENDING',
      createdByName: claimantName,
      requestDate: now.toISOString().slice(0, 10),
      requestTime: now.toTimeString().slice(0, 8),
      payload: { claimKey, leadId, company, financialYear, servicesOffered, eprCategories, dataFlag, correctionDeadline: dataFlag === 'RED' ? correctionDeadline.toISOString() : null, claimantId, requestedById: claimantId, claimantName, claimantEmail: claimant?.email || '', originalCreator, originalCreatorId, originalCreatorEmail },
      remarks: 'Royalty ratio pending Admin/Super Admin review',
      actionBy: null,
      actionAt: null
    }, $setOnInsert: { type: 'lead_royalty', source: 'crm', sourceClientId: claimKey } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  const existing = await Notification.findOne({ kind: 'lead_royalty_claim', 'metadata.claimKey': claimKey }).lean();
  if (existing) return { ok: true, skipped: true, upgraded: previousApproval?.payload?.dataFlag === 'RED' && dataFlag === 'GREEN', notificationId: existing._id, approvalId: approval._id };

  const recipients = await User.find({ role: { $in: ADMIN_ROLES }, isActive: { $ne: false } }).select('_id name email').lean();
  const correctionMessage = dataFlag === 'RED' ? ` Required service data is incomplete and may be corrected by ${correctionDeadline.toISOString().slice(0, 10)}.` : ' Required service data is complete.';
  const description = `${claimantName} claimed royalty for ${company}${financialYear ? ` (${financialYear})` : ''}. Original lead creator: ${originalCreator}.${correctionMessage} Please review and take action.`;
  const notification = await Notification.create({
    title: 'Lead royalty claim requires review',
    description,
    tag: 'Royalty Claim',
    kind: 'lead_royalty_claim',
    createdBy: claimant?._id,
    createdByName: claimantName,
    audience: recipients.map((recipient) => recipient._id),
    visibleToRoles: ADMIN_ROLES,
    metadata: { claimKey, leadId, company, financialYear, claimantId, claimantName, originalCreator, status: 'PENDING' }
  });
  notification.crmNotificationId = String(notification._id);
  await notification.save();

  const html = `<div style="font-family:Arial,sans-serif;color:#334155">
    <h2 style="color:#0f766e">Lead royalty claim requires review</h2>
    <p>${escapeHtml(description)}</p>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0">
      <tr><td style="padding:11px;background:#ecfdf5;font-weight:700">Company</td><td style="padding:11px">${escapeHtml(company)}</td></tr>
      <tr><td style="padding:11px;background:#ecfdf5;font-weight:700">Financial Year</td><td style="padding:11px">${escapeHtml(financialYear || '-')}</td></tr>
      <tr><td style="padding:11px;background:#ecfdf5;font-weight:700">Services Offered</td><td style="padding:11px">${escapeHtml(servicesOffered.join(', ') || '-')}</td></tr>
      <tr><td style="padding:11px;background:#ecfdf5;font-weight:700">Service Category</td><td style="padding:11px">${escapeHtml(eprCategories.join(', ') || '-')}</td></tr>
      <tr><td style="padding:11px;background:#ecfdf5;font-weight:700">Data Flag</td><td style="padding:11px;color:${dataFlag === 'GREEN' ? '#047857' : '#dc2626'};font-weight:700">${dataFlag}</td></tr>
      ${dataFlag === 'RED' ? `<tr><td style="padding:11px;background:#ecfdf5;font-weight:700">Correction Deadline</td><td style="padding:11px">${escapeHtml(correctionDeadline.toISOString().slice(0, 10))} (2-day correction window)</td></tr>` : ''}
      <tr><td style="padding:11px;background:#ecfdf5;font-weight:700">Claimed By</td><td style="padding:11px">${escapeHtml(claimantName)}</td></tr>
      <tr><td style="padding:11px;background:#ecfdf5;font-weight:700">Original Lead Creator</td><td style="padding:11px">${escapeHtml(originalCreator)}</td></tr>
      <tr><td style="padding:11px;background:#ecfdf5;font-weight:700">Status</td><td style="padding:11px">Pending Admin Review</td></tr>
    </table>
    <p style="margin-top:20px;color:#64748b">Please review this claim in the CRM Notification Center.</p>
  </div>`;
  const results = await Promise.allSettled(recipients.filter((recipient) => recipient.email).map((recipient) => sendMail(recipient.email, `Royalty Claim - ${company}`, html, { branded: false })));
  notification.metadata = { ...notification.metadata, emailSent: results.filter((result) => result.status === 'fulfilled').length, emailFailed: results.filter((result) => result.status === 'rejected').length };
  notification.markModified('metadata');
  await notification.save();
  return { ok: true, notificationId: notification._id, approvalId: approval._id };
}

module.exports = { claimLeadRoyalty };
