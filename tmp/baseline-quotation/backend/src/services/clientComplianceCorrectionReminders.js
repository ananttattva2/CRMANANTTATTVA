const PendingApproval = require('../models/PendingApproval');
const Client = require('../models/Client');
const { sendMail } = require('../utils/mailer');
const { resolveClientManager } = require('./clientApprovalDecisionNotifications');
const { CLIENT_CORRECTION_DEADLINE_POLICY, addClientCorrectionHours } = require('../utils/clientCorrectionDeadline');

const HOUR_MS = 60 * 60 * 1000;
const SCAN_MS = Math.max(60 * 1000, Number(process.env.COMPLIANCE_CORRECTION_SCAN_MS) || HOUR_MS);
const ACTIVE_CORRECTION_DECISIONS = ['PARTIALLY_APPROVED', 'REJECTED'];
let started = false;
let running = false;

function activeCorrectionFilter() {
  return {
    approvalStatus: { $in: ACTIVE_CORRECTION_DECISIONS },
    correctionDecision: { $in: ACTIVE_CORRECTION_DECISIONS }
  };
}

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function appUrl() {
  return String(process.env.APP_URL || process.env.FRONTEND_URL || process.env.CLIENT_ORIGIN || 'https://crmananttattva.vercel.app').replace(/\/$/, '');
}

function displayDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const day = date.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
  const time = date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time}`;
}

function correctionEmail(record, stage) {
  const redRecovery = stage === 'RED_RECOVERY';
  const permanent = stage === 'PERMANENT';
  const clientName = escapeHtml(record.clientName || 'Client Master');
  const recipient = escapeHtml(record.correctionRecipientName || 'Manager');
  const decision = record.correctionDecision === 'REJECTED' ? 'Rejected' : 'Partially Approved';
  const dueAt = record.correctionDueAt ? displayDateTime(record.correctionDueAt) : '-';
  const recoveryDeadline = record.greenFlagDeadline ? displayDateTime(record.greenFlagDeadline) : '-';
  const color = permanent ? '#7f1d1d' : redRecovery ? '#b91c1c' : '#d97706';
  const title = permanent ? 'Permanent Red Flag Applied' : redRecovery ? 'Red Flag - Final 48-Hour Recovery' : '24-Hour Correction Reminder';
  const message = permanent
    ? '<div style="padding:15px;border:1px solid #fecaca;border-radius:12px;background:#fef2f2;color:#991b1b"><strong>The final 48-hour recovery window has expired.</strong> The Client Master now has a permanent red flag in CRM.</div>'
    : redRecovery
      ? `<div style="padding:15px;border:1px solid #fecaca;border-radius:12px;background:#fef2f2;color:#991b1b"><strong>The initial 48-hour correction deadline has expired and a red flag has been applied.</strong> You have a final 48 hours, until <strong>${escapeHtml(recoveryDeadline)}</strong>, to correct the data and obtain compliance approval. Approval within this recovery window will return the flag to green.</div>`
      : `<div style="padding:15px;border:1px solid #fde68a;border-radius:12px;background:#fffbeb;color:#92400e"><strong>24 hours remain in the initial correction period.</strong> Complete the requested data and obtain compliance approval before <strong>${escapeHtml(dueAt)}</strong> to avoid a red flag. If missed, a final 48-hour red-to-green recovery window will begin.</div>`;
  return {
    subject: `${title} - ${record.clientName || 'Client Master'}`,
    html: `<div style="background:#f1f5f9;padding:28px 12px;font-family:Arial,Helvetica,sans-serif;color:#334155"><div style="max-width:680px;margin:auto;overflow:hidden;border:1px solid #e2e8f0;border-radius:18px;background:#fff"><div style="background:${color};padding:25px 28px;color:#fff"><div style="font-size:12px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase">AnantTattva CRM</div><h1 style="margin:8px 0 0;font-size:24px">${title}</h1></div><div style="padding:26px 28px"><p>Hello <strong>${recipient}</strong>,</p><p>The compliance decision for <strong>${clientName}</strong> is <strong>${decision}</strong>.</p>${message}<p style="margin-top:22px"><a href="${escapeHtml(appUrl())}/client-master" style="display:inline-block;border-radius:10px;background:#075848;padding:13px 20px;color:#fff;text-decoration:none;font-weight:800">Open Client Master</a></p><p style="margin-top:22px;color:#64748b;font-size:12px">Automated compliance correction notification. No reply required.</p></div></div></div>`
  };
}

async function ensureRecipient(record) {
  if (record.correctionRecipientEmail) return record;
  const client = await Client.findById(record.sourceClientId).lean();
  if (!client) return record;
  const manager = await resolveClientManager(client, record.payload || {});
  if (!manager?.email) return record;
  record.correctionRecipientId = manager._id;
  record.correctionRecipientEmail = String(manager.email).trim().toLowerCase();
  record.correctionRecipientName = manager.name || '';
  await record.save();
  return record;
}

async function sendCorrectionEmail(record, stage) {
  await ensureRecipient(record);
  if (!record.correctionRecipientEmail) throw new Error('Client Master manager email is missing');
  const content = correctionEmail(record, stage);
  await sendMail(record.correctionRecipientEmail, content.subject, content.html, { branded: false });
}

async function runClientComplianceCorrectionReminders(now = new Date()) {
  if (running) return { skipped: 'already_running' };
  running = true;
  const result = { reminders: 0, breached: 0, legacyRecoveryGrants: 0, redFlags: 0, permanentRedFlags: 0, errors: 0 };
  try {
    // Cancel stale correction timers left on records whose current compliance
    // decision is Pending or Approved. These records must never send an SLA
    // email merely because an older correctionStatus remained OPEN.
    await PendingApproval.updateMany(
      {
        type: 'client',
        approvalStatus: 'PENDING',
        correctionStatus: { $in: ['OPEN', 'BREACHED'] },
      },
      {
        $set: { correctionStatus: 'NONE', correctionDecision: '', correctionResolvedAt: now, reminderFlag: 'GREEN' },
        $unset: {
          correctionStartedAt: 1, correctionDeadlinePolicy: 1, correctionReminderAt: 1,
          correctionReminderSentAt: 1, correctionDueAt: 1, correctionBreachedAt: 1,
          redRecoveryStartedAt: 1, redRecoveryEmailSentAt: 1,
          redRecoveryEmailNextAttemptAt: 1, greenFlagDeadline: 1, redFlagAt: 1,
          correctionEmailError: 1
        }
      }
    );

    const legacyDeadlines = await PendingApproval.find({
      type: 'client', ...activeCorrectionFilter(),
      correctionStatus: { $in: ['OPEN', 'BREACHED'] },
      correctionDeadlinePolicy: { $ne: CLIENT_CORRECTION_DEADLINE_POLICY },
      correctionStartedAt: { $ne: null }
    }).limit(100);
    for (const record of legacyDeadlines) {
      const startedAt = new Date(record.correctionStartedAt);
      if (Number.isNaN(startedAt.getTime())) continue;
      const correctionDueAt = addClientCorrectionHours(startedAt, 48);
      const greenFlagDeadline = addClientCorrectionHours(startedAt, 96);
      record.correctionDeadlinePolicy = CLIENT_CORRECTION_DEADLINE_POLICY;
      record.correctionReminderAt = addClientCorrectionHours(startedAt, 24);
      record.correctionDueAt = correctionDueAt;
      record.greenFlagDeadline = greenFlagDeadline;
      if (now < correctionDueAt) {
        record.correctionStatus = 'OPEN';
        record.reminderFlag = 'GREEN';
        record.correctionBreachedAt = undefined;
        record.redFlagAt = undefined;
        record.redRecoveryStartedAt = undefined;
        record.redRecoveryEmailSentAt = undefined;
        record.redRecoveryEmailNextAttemptAt = undefined;
      } else if (now < greenFlagDeadline) {
        record.correctionStatus = 'BREACHED';
        record.reminderFlag = 'RED';
        record.correctionBreachedAt = record.correctionBreachedAt || now;
        record.redFlagAt = record.redFlagAt || now;
        record.redRecoveryStartedAt = record.redRecoveryStartedAt || now;
        record.redRecoveryEmailNextAttemptAt = record.redRecoveryEmailSentAt ? null : now;
      } else {
        record.correctionStatus = 'BREACHED';
        record.reminderFlag = 'PERMANENT_RED';
        record.correctionBreachedAt = record.correctionBreachedAt || correctionDueAt;
        record.redFlagAt = record.redFlagAt || correctionDueAt;
      }
      await record.save();
    }

    const legacyRedFlags = await PendingApproval.find({
      type: 'client', reminderFlag: { $in: ['RED', 'PERMANENT_RED'] }, ...activeCorrectionFilter(),
      redRecoveryStartedAt: null,
      $or: [{ greenFlagDeadline: { $lte: now } }, { greenFlagDeadline: null }]
    }).limit(100);
    for (const record of legacyRedFlags) {
      const recoveryDeadline = addClientCorrectionHours(now, 48);
      const claimed = await PendingApproval.findOneAndUpdate(
        { _id: record._id, reminderFlag: { $in: ['RED', 'PERMANENT_RED'] }, redRecoveryStartedAt: null },
        { $set: {
          correctionStatus: 'BREACHED',
          correctionDeadlinePolicy: CLIENT_CORRECTION_DEADLINE_POLICY,
          reminderFlag: 'RED',
          redRecoveryStartedAt: now,
          greenFlagDeadline: recoveryDeadline,
          redRecoveryEmailSentAt: null,
          redRecoveryEmailNextAttemptAt: now
        } },
        { new: true }
      );
      if (!claimed) continue;
      result.legacyRecoveryGrants += 1;
    }

    const dueReminders = await PendingApproval.find({
      type: 'client', correctionStatus: 'OPEN', correctionReminderSentAt: null,
      ...activeCorrectionFilter(),
      correctionReminderAt: { $lte: now }, correctionDueAt: { $gt: now }
    }).limit(100);
    for (const record of dueReminders) {
      const claimed = await PendingApproval.findOneAndUpdate(
        { _id: record._id, correctionStatus: 'OPEN', correctionReminderSentAt: null, ...activeCorrectionFilter(), correctionReminderAt: { $lte: now }, correctionDueAt: { $gt: now } },
        { $set: { correctionReminderSentAt: now } },
        { new: true }
      );
      if (!claimed) continue;
      try {
        await sendCorrectionEmail(claimed, 'REMINDER');
        claimed.correctionEmailError = '';
        await claimed.save();
        result.reminders += 1;
      } catch (error) {
        claimed.correctionReminderSentAt = null;
        claimed.correctionEmailError = error.message || 'Unable to send 24-hour correction reminder';
        claimed.correctionReminderAt = new Date(now.getTime() + HOUR_MS);
        await claimed.save();
        result.errors += 1;
      }
    }

    const breaches = await PendingApproval.find({
      type: 'client', correctionStatus: 'OPEN', ...activeCorrectionFilter(), correctionDueAt: { $lte: now }, greenFlagDeadline: { $gt: now }
    }).limit(100);
    for (const record of breaches) {
      const claimed = await PendingApproval.findOneAndUpdate(
        { _id: record._id, correctionStatus: 'OPEN', ...activeCorrectionFilter(), correctionDueAt: { $lte: now }, greenFlagDeadline: { $gt: now } },
        { $set: {
          correctionStatus: 'BREACHED',
          correctionBreachedAt: now,
          redRecoveryStartedAt: now,
          redRecoveryEmailSentAt: null,
          redRecoveryEmailNextAttemptAt: now,
          reminderFlag: 'RED',
          redFlagAt: now
        } },
        { new: true }
      );
      if (!claimed) continue;
      result.redFlags += 1;
    }

    // Delivery is tracked separately from granting the recovery window. If the
    // mail provider is temporarily unavailable, retry every hour while the
    // client can still recover instead of silently losing the notification.
    const recoveryNotices = await PendingApproval.find({
      type: 'client', reminderFlag: 'RED', redRecoveryStartedAt: { $ne: null },
      ...activeCorrectionFilter(),
      redRecoveryEmailSentAt: null, greenFlagDeadline: { $gt: now },
      $or: [{ redRecoveryEmailNextAttemptAt: { $lte: now } }, { redRecoveryEmailNextAttemptAt: null }]
    }).limit(100);
    for (const record of recoveryNotices) {
      const nextAttemptAt = new Date(now.getTime() + HOUR_MS);
      const claimed = await PendingApproval.findOneAndUpdate(
        {
          _id: record._id, reminderFlag: 'RED', redRecoveryEmailSentAt: null,
          ...activeCorrectionFilter(),
          greenFlagDeadline: { $gt: now },
          $or: [{ redRecoveryEmailNextAttemptAt: { $lte: now } }, { redRecoveryEmailNextAttemptAt: null }]
        },
        { $set: { redRecoveryEmailNextAttemptAt: nextAttemptAt } },
        { new: true }
      );
      if (!claimed) continue;
      try {
        await sendCorrectionEmail(claimed, 'RED_RECOVERY');
        claimed.correctionEmailError = '';
        claimed.redRecoveryEmailSentAt = now;
        claimed.redRecoveryEmailNextAttemptAt = null;
      } catch (error) {
        claimed.correctionEmailError = error.message || 'Unable to send red-flag recovery email';
        result.errors += 1;
      }
      await claimed.save();
    }

    const permanentBreaches = await PendingApproval.find({
      type: 'client', correctionStatus: { $in: ['OPEN', 'BREACHED'] },
      ...activeCorrectionFilter(),
      reminderFlag: { $ne: 'PERMANENT_RED' }, correctionDueAt: { $lte: now }, greenFlagDeadline: { $lte: now }
    }).limit(100);
    for (const record of permanentBreaches) {
      const claimed = await PendingApproval.findOneAndUpdate(
        { _id: record._id, correctionStatus: { $in: ['OPEN', 'BREACHED'] }, ...activeCorrectionFilter(), reminderFlag: { $ne: 'PERMANENT_RED' }, greenFlagDeadline: { $lte: now } },
        { $set: { correctionStatus: 'BREACHED', correctionBreachedAt: record.correctionBreachedAt || now, reminderFlag: 'PERMANENT_RED', redFlagAt: record.redFlagAt || now } },
        { new: true }
      );
      if (!claimed) continue;
      try {
        await sendCorrectionEmail(claimed, 'PERMANENT');
        claimed.correctionEmailError = '';
      } catch (error) {
        claimed.correctionEmailError = error.message || 'Unable to send permanent red-flag email';
        result.errors += 1;
      }
      await claimed.save();
      result.permanentRedFlags += 1;
      result.breached += 1;
    }
    return result;
  } finally {
    running = false;
  }
}

function startClientComplianceCorrectionReminderScheduler() {
  if (started) return;
  started = true;
  const run = () => runClientComplianceCorrectionReminders().catch((error) => console.error('Compliance correction reminder scan failed', error));
  setTimeout(run, 15000);
  setInterval(run, SCAN_MS);
}

module.exports = { activeCorrectionFilter, correctionEmail, runClientComplianceCorrectionReminders, startClientComplianceCorrectionReminderScheduler };
