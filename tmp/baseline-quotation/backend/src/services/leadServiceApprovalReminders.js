const PendingApproval = require('../models/PendingApproval');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { ADMIN_ROLES } = require('../constants/roles');
const { sendMail } = require('../utils/mailer');

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
let schedulerStarted = false;

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

async function runLeadServiceApprovalReminders(now = new Date()) {
  const records = await PendingApproval.find({
    type: 'lead_service',
    approvalStatus: 'PENDING',
    'payload.preliminaryStatus': 'PENDING',
    nextReminderAt: { $lte: now }
  }).limit(100);
  let reminded = 0;
  let autoApproved = 0;

  for (const record of records) {
    const payload = { ...(record.payload || {}) };
    const reminderCount = Number(record.reminderCount || 0);
    const creator = payload.originalCreatorId
      ? await User.findById(payload.originalCreatorId).select('_id name email').lean()
      : null;
    const creatorEmail = creator?.email || payload.originalCreatorEmail;

    if (reminderCount < 2) {
      const reminderNumber = reminderCount + 1;
      const redFlag = reminderNumber === 2;
      const subject = `${redFlag ? 'RED FLAG: ' : ''}Service Approval Reminder ${reminderNumber}/2 - ${record.clientName}`;
      const html = `<div style="font-family:Arial,sans-serif;color:#334155">
        <h2 style="color:${redFlag ? '#dc2626' : '#0f766e'}">${redFlag ? 'Red Flag: Final Reminder' : 'Additional Service Approval Reminder'}</h2>
        <p>The additional service request for <strong>${escapeHtml(record.clientName)}</strong> is still awaiting your preliminary decision.</p>
        <p><strong>Reminder:</strong> ${reminderNumber} of 2</p>
        <p>Please approve or reject it from CRM Pending Approval within 24 hours.</p>
        ${redFlag ? '<p style="padding:12px;background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b"><strong>Red Flag:</strong> If no action is taken after this reminder, the system will automatically record a preliminary approval. Final authority will remain with Admin/Superadmin.</p>' : ''}
        <p><strong>Thanks &amp; Regards,</strong><br><strong>Team Ananttattva</strong></p>
      </div>`;
      if (creatorEmail) await sendMail(creatorEmail, subject, html, { branded: false }).catch(() => null);
      await Notification.create({
        title: redFlag ? 'RED FLAG: Service approval final reminder' : 'Service approval reminder',
        description: `Reminder ${reminderNumber}/2 for ${record.clientName}.`,
        tag: redFlag ? 'Red Flag' : 'Service Approval',
        kind: 'lead_service_approval_reminder',
        audience: creator?._id ? [creator._id] : [],
        metadata: { approvalId: String(record._id), reminderNumber, redFlag }
      });
      record.reminderCount = reminderNumber;
      record.lastReminderAt = now;
      record.nextReminderAt = new Date(now.getTime() + TWENTY_FOUR_HOURS_MS);
      await record.save();
      reminded += 1;
      continue;
    }

    payload.preliminaryStatus = 'APPROVED';
    payload.preliminaryActionBy = 'CRM System';
    payload.preliminaryActionAt = now;
    payload.preliminaryReason = 'The original lead creator did not respond after two 24-hour reminders. The system recorded a preliminary approval automatically.';
    payload.autoApproved = true;
    record.payload = payload;
    record.remarks = 'Preliminary approval automatically recorded by CRM after two unanswered reminders. Awaiting final Admin/Superadmin review.';
    record.nextReminderAt = null;
    record.markModified('payload');
    await record.save();

    const admins = await User.find({ role: { $in: ADMIN_ROLES }, isActive: { $ne: false } }).select('_id email').lean();
    const emails = [creatorEmail, payload.contributorEmail, ...admins.map((admin) => admin.email)]
      .map((email) => String(email || '').trim()).filter((email, index, rows) => email && rows.indexOf(email) === index);
    const html = `<div style="font-family:Arial,sans-serif;color:#334155">
      <h2 style="color:#0f766e">System Preliminary Approval Recorded</h2>
      <p>The original lead creator did not approve or reject the additional service request for <strong>${escapeHtml(record.clientName)}</strong> after two reminder emails.</p>
      <p>The CRM system has therefore recorded a <strong>preliminary approval</strong>.</p>
      <p style="padding:12px;background:#fff7ed;border-left:4px solid #f97316"><strong>Important:</strong> This is not the final approval. Final approval authority rests only with the Admin/Superadmin.</p>
      <p><strong>Thanks &amp; Regards,</strong><br><strong>Team Ananttattva</strong></p>
    </div>`;
    await Promise.allSettled(emails.map((email) => sendMail(email, `System Preliminary Approval - ${record.clientName}`, html, { branded: false })));
    await Notification.create({
      title: 'Service request auto-approved preliminarily',
      description: `${record.clientName} was preliminarily approved by the CRM system after two unanswered reminders.`,
      tag: 'Service Approval',
      kind: 'lead_service_auto_approval',
      audience: [creator?._id, ...admins.map((admin) => admin._id)].filter(Boolean),
      visibleToRoles: ADMIN_ROLES,
      metadata: { approvalId: String(record._id), autoApproved: true }
    });
    autoApproved += 1;
  }
  return { reminded, autoApproved };
}

function startLeadServiceApprovalReminderScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const run = () => runLeadServiceApprovalReminders().catch((error) => console.error('Lead service approval reminder failed', error));
  setTimeout(run, 10000);
  setInterval(run, 60 * 1000);
}

module.exports = {
  TWENTY_FOUR_HOURS_MS,
  runLeadServiceApprovalReminders,
  startLeadServiceApprovalReminderScheduler
};
