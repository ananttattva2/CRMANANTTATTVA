const crypto = require('node:crypto');
const Lead = require('../models/Lead');
const PendingApproval = require('../models/PendingApproval');
const User = require('../models/User');
const { ADMIN_ROLES } = require('../constants/roles');
const { sendMail } = require('../utils/mailer');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const REJECTION_REMINDER_MS = 48 * HOUR_MS;
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const RETRY_MS = HOUR_MS;
const SCAN_INTERVAL_MS = Math.max(60 * 1000, Number(process.env.PO_WORKFLOW_REMINDER_SCAN_MS) || 60 * 1000);
const STAGE_FIELDS = {
  rejected48h: 'rejected48h',
  manager24h: 'manager24h',
  manager48h: 'manager48h'
};
let schedulerStarted = false;
let scanRunning = false;

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[character]));
}

function validDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function dateTime(value) {
  const date = validDate(value);
  if (!date) return '-';
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

function elapsedTime(from, to = new Date()) {
  const start = validDate(from);
  const end = validDate(to);
  if (!start || !end || end < start) return '-';
  const totalMinutes = Math.floor((end.getTime() - start.getTime()) / 60000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  return [days ? `${days}d` : '', `${hours}h`, `${minutes}m`].filter(Boolean).join(' ');
}

function latestDate(...values) {
  return values.map(validDate).filter(Boolean).sort((left, right) => right - left)[0] || null;
}

function managerReminderDueStage({ approvalAt, managerAssignedAt, hasStaff, reminderState = {}, now = new Date() }) {
  if (hasStaff) return '';
  const startedAt = latestDate(approvalAt, managerAssignedAt);
  if (!startedAt) return '';
  const elapsed = now.getTime() - startedAt.getTime();
  if (elapsed < DAY_MS) return '';
  if (!reminderState.manager24h?.sentAt) return 'manager24h';
  if (elapsed >= 2 * DAY_MS && !reminderState.manager48h?.sentAt) return 'manager48h';
  return '';
}

function rejectionReminderDue({ rejectedAt, reminderState = {}, now = new Date() }) {
  const start = validDate(rejectedAt);
  return Boolean(start && !reminderState.rejected48h?.sentAt
    && now.getTime() - start.getTime() >= REJECTION_REMINDER_MS);
}

function appUrl(path) {
  const base = String(process.env.APP_URL || process.env.FRONTEND_URL || process.env.CLIENT_ORIGIN || 'https://crmananttattva.vercel.app').replace(/\/$/, '');
  return `${base}${path}`;
}

function poReminderEmail({ stage, approval, lead = {}, assignment = {}, managerName = '', now = new Date() }) {
  const rejected = stage === 'rejected48h';
  const escalation = stage === 'manager48h';
  const color = rejected ? '#b91c1c' : escalation ? '#c2410c' : '#047857';
  const title = rejected
    ? 'Action required: rejected Purchase Order is still unchanged'
    : escalation
      ? 'Escalation: staff assignment is overdue'
      : 'Reminder: assign staff for the approved Purchase Order';
  const eventAt = rejected
    ? approval.actionAt
    : latestDate(approval.actionAt, assignment.managerAssignedAt);
  const closedAt = assignment.closedAt || assignment.managerAssignedAt || approval.actionAt;
  const rows = Array.isArray(assignment.poYearRows) && assignment.poYearRows.length
    ? assignment.poYearRows
    : (Array.isArray(approval.payload?.poYearRows) ? approval.payload.poYearRows : []);
  const poNumbers = rows.map((row) => row?.poNumber).filter(Boolean);
  const poSummary = poNumbers.length ? poNumbers.join(', ') : 'Purchase Order on file';
  const company = lead.company || approval.clientName || 'Client';
  const leadCode = lead.leadCode || approval.uniqueId || '-';
  const service = approval.payload?.service?.servicesOffered
    || approval.payload?.service?.applicableService
    || approval.payload?.service?.eprCategory
    || approval.eprCategory
    || '-';
  const recipient = managerName || approval.payload?.poSubmittedByName || 'CRM User';
  const eventLabel = rejected ? 'PO rejected on' : 'Manager assigned on';
  const elapsed = elapsedTime(eventAt, now);
  const banner = rejected
    ? `No corrective PO action has been recorded for <strong>${escapeHtml(elapsed)}</strong> since rejection. Please update and resubmit the PO.`
    : escalation
      ? `No staff member has been assigned <strong>${escapeHtml(elapsed)}</strong> after the PO was approved and assigned to the manager. Admin and Super Admin have been copied for visibility.`
      : `The approved PO has been assigned to you for <strong>24 hours</strong>, but no staff member has been assigned yet. Please complete the assignment.`;
  const actionUrl = appUrl('/sales/lead-generation');

  return {
    subject: `${escalation ? 'Escalation: ' : rejected ? 'Action required: ' : 'Reminder: '}PO ${leadCode} - ${company}`,
    html: `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#eef3f8;font-family:Arial,Helvetica,sans-serif;color:#162033">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(title)} for ${escapeHtml(company)}.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef3f8;padding:28px 12px;border-collapse:collapse">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:700px;background:#fff;border:1px solid #dce5ef;border-radius:20px;overflow:hidden;border-collapse:separate">
        <tr><td style="background:${color};padding:25px 30px;color:#fff">
          <div style="font-size:11px;font-weight:900;letter-spacing:2px;text-transform:uppercase;opacity:.85">AnantTattva CRM · Purchase Order Workflow</div>
          <h1 style="margin:9px 0 0;font-size:24px;line-height:1.3">${escapeHtml(title)}</h1>
        </td></tr>
        <tr><td style="padding:26px 30px">
          <p style="margin:0 0 18px;font-size:15px;line-height:1.7">Hello <strong>${escapeHtml(recipient)}</strong>,</p>
          <div style="border:1px solid ${rejected ? '#fecaca' : escalation ? '#fed7aa' : '#a7f3d0'};border-radius:14px;background:${rejected ? '#fff7f7' : escalation ? '#fffaf5' : '#f0fdf8'};padding:17px 18px;font-size:14px;line-height:1.7;color:#334155">${banner}</div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:20px;border:1px solid #e2e8f0;border-radius:12px;border-collapse:separate;overflow:hidden">
            <tr><td style="width:38%;padding:12px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:11px;font-weight:900">COMPANY / LEAD</td><td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:800">${escapeHtml(company)} · ${escapeHtml(leadCode)}</td></tr>
            <tr><td style="padding:12px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:11px;font-weight:900">SERVICE</td><td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:700">${escapeHtml(service)}</td></tr>
            <tr><td style="padding:12px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:11px;font-weight:900">PO NUMBER(S)</td><td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:800">${escapeHtml(poSummary)}</td></tr>
            <tr><td style="padding:12px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:11px;font-weight:900">PO CLOSED ON</td><td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:700">${escapeHtml(dateTime(closedAt))}</td></tr>
            <tr><td style="padding:12px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:11px;font-weight:900">${eventLabel.toUpperCase()}</td><td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:700">${escapeHtml(dateTime(eventAt))}</td></tr>
            <tr><td style="padding:12px 14px;background:#f8fafc;color:#64748b;font-size:11px;font-weight:900">TIME ELAPSED</td><td style="padding:12px 14px;font-size:14px;font-weight:900;color:${color}">${escapeHtml(elapsed)}</td></tr>
          </table>
          <div style="margin-top:23px;text-align:center"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;border-radius:10px;background:${color};padding:13px 22px;color:#fff;text-decoration:none;font-size:14px;font-weight:900">Open Lead Assignment</a></div>
          <p style="margin:22px 0 0;color:#64748b;font-size:12px;line-height:1.6">This automated reminder is based on the PO workflow timestamps recorded in CRM. Please take action in the CRM; replying to this email will not update the assignment.</p>
        </td></tr>
        <tr><td style="border-top:1px solid #e2e8f0;background:#f8fafc;padding:15px 22px;text-align:center;color:#94a3b8;font-size:11px">AnantTattva CRM · Purchase Order SLA notification</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
  };
}

function emailAddresses(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))];
}

async function activeAdmins() {
  return User.find({
    isActive: { $ne: false },
    $or: [{ role: { $in: ADMIN_ROLES } }, { roles: { $in: ADMIN_ROLES } }]
  }).select('_id name email role roles').lean();
}

async function userEmail(userId) {
  const id = String(userId?._id || userId || '').trim();
  if (!id) return '';
  const user = await User.findById(id).select('_id name email').lean();
  return user?.email || '';
}

async function claimStage(approval, stage, now) {
  const root = `payload.poWorkflowReminders.${STAGE_FIELDS[stage]}`;
  const sentAtPath = `${root}.sentAt`;
  const claimAtPath = `${root}.claimAt`;
  const retryAtPath = `${root}.retryAt`;
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  const query = {
    _id: approval._id,
    type: 'purchase_order',
    approvalStatus: approval.approvalStatus,
    [sentAtPath]: { $exists: false },
    $and: [
      { $or: [{ [claimAtPath]: { $exists: false } }, { [claimAtPath]: { $lte: staleBefore } }] },
      { $or: [{ [retryAtPath]: { $exists: false } }, { [retryAtPath]: { $lte: now } }] }
    ]
  };
  if (approval.actionAt) query.actionAt = approval.actionAt;
  const claimToken = crypto.randomUUID();
  return PendingApproval.findOneAndUpdate(query, {
    $set: { [`${root}.claimAt`]: now, [`${root}.claimToken`]: claimToken },
    $unset: { [`${root}.retryAt`]: 1 }
  }, { new: true });
}

async function sendReminderStage({ approval, stage, recipients, lead, assignment, managerName, now, result }) {
  const claimed = await claimStage(approval, stage, now);
  if (!claimed) return;
  const root = `payload.poWorkflowReminders.${STAGE_FIELDS[stage]}`;
  const sentEmails = new Set(claimed.payload?.poWorkflowReminders?.[STAGE_FIELDS[stage]]?.sentEmails || []);
  const normalizedRecipients = emailAddresses(recipients);
  if (!normalizedRecipients.length) {
    await PendingApproval.updateOne({ _id: claimed._id }, {
      $set: {
        [`${root}.retryAt`]: new Date(now.getTime() + RETRY_MS),
        [`${root}.lastError`]: 'No valid reminder recipient email is available'
      },
      $unset: { [`${root}.claimAt`]: 1, [`${root}.claimToken`]: 1 }
    });
    result.errors += 1;
    return;
  }
  const pendingEmails = normalizedRecipients.filter((email) => !sentEmails.has(email));
  if (!pendingEmails.length) {
    await PendingApproval.updateOne({ _id: claimed._id }, {
      $set: { [`${root}.sentAt`]: now },
      $unset: { [`${root}.claimAt`]: 1, [`${root}.claimToken`]: 1, [`${root}.retryAt`]: 1 }
    });
    return;
  }

  const content = poReminderEmail({ stage, approval: claimed, lead, assignment, managerName, now });
  let failed = 0;
  for (const email of pendingEmails) {
    try {
      await sendMail(email, content.subject, content.html, { branded: false });
      await PendingApproval.updateOne({ _id: claimed._id }, { $addToSet: { [`${root}.sentEmails`]: email } });
    } catch (error) {
      failed += 1;
      console.error('PO workflow reminder email failed', {
        approvalId: String(claimed._id),
        stage,
        recipient: email,
        error: error?.message || 'Email delivery failed'
      });
    }
  }

  if (failed) {
    await PendingApproval.updateOne({ _id: claimed._id }, {
      $set: { [`${root}.retryAt`]: new Date(now.getTime() + RETRY_MS), [`${root}.lastError`]: `${failed} recipient(s) failed` },
      $unset: { [`${root}.claimAt`]: 1, [`${root}.claimToken`]: 1 }
    });
    result.errors += failed;
    return;
  }

  await PendingApproval.updateOne({ _id: claimed._id }, {
    $set: { [`${root}.sentAt`]: now, [`${root}.lastError`]: '' },
    $unset: { [`${root}.claimAt`]: 1, [`${root}.claimToken`]: 1, [`${root}.retryAt`]: 1 }
  });
  result[stage] += 1;
}

async function runPurchaseOrderWorkflowReminders(now = new Date()) {
  if (scanRunning) return { skipped: 'already_running' };
  scanRunning = true;
  const result = { rejected48h: 0, manager24h: 0, manager48h: 0, errors: 0 };
  try {
    const rejected = await PendingApproval.find({
      type: 'purchase_order',
      approvalStatus: 'REJECTED',
      actionAt: { $lte: new Date(now.getTime() - REJECTION_REMINDER_MS) }
    }).limit(200).lean();
    const approvalsToCheck = await PendingApproval.find({
      type: 'purchase_order',
      approvalStatus: 'APPROVED',
      actionAt: { $lte: new Date(now.getTime() - DAY_MS) }
    }).limit(200).lean();
    const admins = await activeAdmins();
    const adminEmails = admins.map((user) => user.email);

    for (const approval of rejected) {
      if (!rejectionReminderDue({
        rejectedAt: approval.actionAt,
        reminderState: approval.payload?.poWorkflowReminders,
        now
      })) continue;
      const rejectedLead = await Lead.findById(approval.payload?.leadId).lean();
      const assignment = rejectedLead?.assignments?.[Number(approval.payload?.assignmentIndex)] || {};
      if (!rejectedLead || String(assignment.poApprovalStatus || '').toUpperCase() !== 'REJECTED') continue;
      const submitterEmail = emailAddresses([approval.payload?.poSubmittedByEmail])[0]
        || await userEmail(approval.payload?.poSubmittedById)
        || await userEmail(approval.payload?.closureRequestedBy || assignment.closureRequestedBy);
      await sendReminderStage({
        approval,
        stage: 'rejected48h',
        recipients: [submitterEmail, ...adminEmails],
        lead: rejectedLead,
        assignment,
        now,
        result
      });
    }

    for (const approval of approvalsToCheck) {
      const lead = await Lead.findById(approval.payload?.leadId).lean();
      const assignment = lead?.assignments?.[Number(approval.payload?.assignmentIndex)] || {};
      if (!lead || String(assignment.poApprovalStatus || '').toUpperCase() !== 'APPROVED') continue;
      const managerId = assignment.assignedTo?._id || assignment.assignedTo;
      if (!managerId || assignment.assignedStaff || assignment.assignedStaffText || assignment.assignedStaffEmail) continue;
      const stage = managerReminderDueStage({
        approvalAt: approval.actionAt,
        managerAssignedAt: assignment.managerAssignedAt || assignment.closedAt,
        hasStaff: false,
        reminderState: approval.payload?.poWorkflowReminders,
        now
      });
      if (!stage) continue;
      const managerEmail = emailAddresses([assignment.assignedToEmail])[0] || await userEmail(managerId);
      const managerUser = managerEmail
        ? await User.findOne({ email: String(managerEmail).trim().toLowerCase() }).select('_id name email').lean()
        : null;
      await sendReminderStage({
        approval,
        stage,
        recipients: stage === 'manager48h' ? [managerEmail, ...adminEmails] : [managerEmail],
        lead,
        assignment,
        managerName: assignment.assignedToText || managerUser?.name || '',
        now,
        result
      });
    }

    return result;
  } finally {
    scanRunning = false;
  }
}

function startPurchaseOrderWorkflowReminderScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const run = () => runPurchaseOrderWorkflowReminders()
    .catch((error) => console.error('PO workflow reminder scan failed', error));
  setTimeout(run, 10000);
  const timer = setInterval(run, SCAN_INTERVAL_MS);
  timer.unref?.();
}

module.exports = {
  DAY_MS,
  REJECTION_REMINDER_MS,
  managerReminderDueStage,
  rejectionReminderDue,
  poReminderEmail,
  runPurchaseOrderWorkflowReminders,
  startPurchaseOrderWorkflowReminderScheduler
};
