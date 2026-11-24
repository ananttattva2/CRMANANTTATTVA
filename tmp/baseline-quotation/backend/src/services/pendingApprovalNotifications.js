const PendingApproval = require('../models/PendingApproval');
const User = require('../models/User');
const { ADMIN_ROLES } = require('../constants/roles');
const { sendMail } = require('../utils/mailer');

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const ONE_MINUTE = 60 * 1000;
const REMINDER_INTERVAL_MS = Number(process.env.PENDING_APPROVAL_REMINDER_INTERVAL_MS) || TWENTY_FOUR_HOURS;
const SCAN_INTERVAL_MS = Number(process.env.PENDING_APPROVAL_REMINDER_SCAN_MS) || ONE_MINUTE;
const DIGEST_RECORD_LIMIT = Number(process.env.PENDING_APPROVAL_DIGEST_LIMIT) || 20;
const MAX_REMINDERS_PER_APPROVAL = Math.max(2, Number(process.env.PENDING_APPROVAL_MAX_REMINDERS) || 2);
const EMAIL_START_AT = readEmailStartAt();

function readEmailStartAt() {
  const value = String(process.env.PENDING_APPROVAL_EMAIL_START_AT || '').trim();
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    console.warn(`Ignoring invalid PENDING_APPROVAL_EMAIL_START_AT: ${value}`);
    return null;
  }

  return date;
}

function pendingApprovalEmailEnabled() {
  return process.env.PENDING_APPROVAL_EMAILS_ENABLED === 'true';
}

function readAppBaseUrl() {
  const candidates = [
    process.env.APP_URL,
    process.env.FRONTEND_URL,
    process.env.CLIENT_ORIGIN,
    'http://localhost:4173'
  ];

  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (!value || value === '*') continue;
    try {
      return new URL(value).origin;
    } catch {
      continue;
    }
  }

  return 'http://localhost:4173';
}

const APP_BASE_URL = readAppBaseUrl();

let schedulerStarted = false;
let scanRunning = false;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function pendingApprovalUrl(record) {
  const url = new URL('/pending-approval', APP_BASE_URL);
  if (record?._id) url.searchParams.set('approvalRecordId', String(record._id));
  url.searchParams.set('tab', record?.type === 'quotation' ? 'quotations' : 'clients');
  return url.toString();
}

function emailField(label, value) {
  return `
    <tr>
      <td style="padding:12px 14px;border-bottom:1px solid #e5e7eb;color:#64748b;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;width:38%;">${label}</td>
      <td style="padding:12px 14px;border-bottom:1px solid #e5e7eb;color:#0f172a;font-size:14px;font-weight:800;">${value}</td>
    </tr>
  `;
}

function splitEmails(value) {
  return String(value || '')
    .split(/[,\s;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

function buildPendingClientEmail(record) {
  const clientName = escapeHtml(record.clientName || 'Untitled client');
  const uniqueId = escapeHtml(record.uniqueId || record.sourceClientId || '-');
  const createdBy = escapeHtml(record.createdByName || '-');
  const piboCategory = escapeHtml(record.piboCategory || '-');
  const eprCategory = escapeHtml(record.eprCategory || '-');
  const requestedAt = escapeHtml([record.requestDate, record.requestTime].filter(Boolean).join(' ') || '-');
  const reminderCount = Number(record.reminderCount || 0) + 1;
  const approvalLink = escapeHtml(pendingApprovalUrl(record));

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Pending Client Approval</title>
      </head>
      <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
        <span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">
          ${clientName} is waiting for compliance approval in CRM.
        </span>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f1f5f9;">
          <tr>
            <td align="center" style="padding:28px 14px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;border-collapse:collapse;background:#ffffff;border:1px solid #dbe3ef;border-radius:18px;overflow:hidden;box-shadow:0 18px 45px rgba(15,23,42,.10);">
                <tr>
                  <td style="background:#064e3b;padding:28px 30px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                      <tr>
                        <td>
                          <div style="color:#a7f3d0;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.12em;">Anant Tattva CRM</div>
                          <div style="margin-top:8px;color:#ffffff;font-size:28px;line-height:1.18;font-weight:900;">Pending Client Approval</div>
                          <div style="margin-top:10px;color:#d1fae5;font-size:14px;line-height:1.6;">A client is waiting for review. Please approve or reject it from Pending Approval.</div>
                        </td>
                        <td align="right" style="vertical-align:top;width:120px;">
                          <span style="display:inline-block;background:#ecfdf5;color:#065f46;border-radius:999px;padding:8px 12px;font-size:12px;font-weight:900;">Reminder #${reminderCount}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px 30px 8px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f8fafc;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
                      <tr>
                        <td style="padding:18px 18px 6px;">
                          <div style="color:#64748b;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;">Client Name</div>
                          <div style="margin-top:6px;color:#0f172a;font-size:22px;line-height:1.25;font-weight:900;">${clientName}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 30px 4px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
                      ${emailField('Unique ID', uniqueId)}
                      ${emailField('Created By', createdBy)}
                      ${emailField('Applicant Type', piboCategory)}
                      ${emailField('Service Category', eprCategory)}
                      ${emailField('Requested', requestedAt)}
                    </table>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:26px 30px 12px;">
                    <a href="${approvalLink}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;border-radius:12px;padding:15px 26px;font-size:15px;font-weight:900;box-shadow:0 10px 22px rgba(16,185,129,.28);">
                      Open Pending Approval
                    </a>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 30px 28px;">
                    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:14px 16px;color:#92400e;font-size:13px;line-height:1.6;font-weight:700;">
                      ${reminderCount >= 2
                        ? 'This is the second 24-hour reminder. The approval is now red-flagged and should be resolved within 48 hours.'
                        : 'If no action is taken within 24 hours, a second reminder will be sent and the approval will be red-flagged.'}
                    </div>
                    <div style="margin-top:14px;color:#64748b;font-size:12px;line-height:1.5;text-align:center;">
                      Button not working? Open this link:<br>
                      <a href="${approvalLink}" style="color:#047857;text-decoration:underline;word-break:break-all;">${approvalLink}</a>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

function buildDigestRows(records) {
  return records.map((record, index) => {
    const payload = record.payload || {};
    const label = record.type === 'quotation' ? 'Quotation' : 'Client';
    const clientName = escapeHtml(record.clientName || payload.companyName || `Untitled ${label.toLowerCase()}`);
    const uniqueId = escapeHtml(record.uniqueId || record.sourceClientId || '-');
    const createdBy = escapeHtml(record.createdByName || '-');
    const requestedAt = escapeHtml([record.requestDate, record.requestTime].filter(Boolean).join(' ') || '-');

    return `
      <tr>
        <td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;color:#64748b;font-size:12px;font-weight:900;text-align:center;">${index + 1}</td>
        <td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;color:#334155;font-size:12px;font-weight:800;">${label}</td>
        <td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;color:#0f172a;font-size:13px;font-weight:900;">${clientName}</td>
        <td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;color:#334155;font-size:12px;font-weight:700;">${uniqueId}</td>
        <td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;color:#334155;font-size:12px;font-weight:700;">${createdBy}</td>
        <td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;color:#334155;font-size:12px;font-weight:700;">${requestedAt}</td>
      </tr>
    `;
  }).join('');
}

function getDigestMeta(records, totalPendingCount, counts = {}) {
  const quotationCount = Number.isFinite(counts.quotations)
    ? counts.quotations
    : records.filter((record) => record.type === 'quotation').length;
  const clientCount = Number.isFinite(counts.clients)
    ? counts.clients
    : records.filter((record) => record.type !== 'quotation').length;
  const onlyQuotations = quotationCount > 0 && clientCount === 0;
  const onlyClients = clientCount > 0 && quotationCount === 0;

  if (onlyQuotations) {
    return {
      title: totalPendingCount === 1 ? 'Pending Quotation Approval' : 'Pending Quotation Approvals',
      subject: `${totalPendingCount} pending quotation approval${totalPendingCount === 1 ? '' : 's'} in CRM`,
      preheader: `${totalPendingCount} quotation${totalPendingCount === 1 ? '' : 's'} pending approval in CRM.`,
      description: 'Quotations are waiting for admin review. Please approve or reject them from Pending Approval.',
      repeatNote: 'This digest repeats every 10 minutes until pending quotations are approved or rejected.',
      hiddenNote: 'more pending quotation approvals are available in CRM',
      defaultTabRecord: { type: 'quotation' }
    };
  }

  if (onlyClients) {
    return {
      title: totalPendingCount === 1 ? 'Pending Client Approval' : 'Pending Client Approvals',
      subject: `${totalPendingCount} pending client approval${totalPendingCount === 1 ? '' : 's'} in CRM`,
      preheader: `${totalPendingCount} client${totalPendingCount === 1 ? '' : 's'} pending approval in CRM.`,
      description: 'Clients are waiting for compliance review. Please approve or reject them from Pending Approval.',
      repeatNote: 'A second reminder is sent after another 24 hours; unresolved clients are then red-flagged with a 48-hour action window.',
      hiddenNote: 'more pending client approvals are available in CRM',
      defaultTabRecord: { type: 'client' }
    };
  }

  return {
    title: 'Pending Approval Digest',
    subject: `${totalPendingCount} pending approval${totalPendingCount === 1 ? '' : 's'} in CRM`,
    preheader: `${totalPendingCount} approvals are pending in CRM.`,
    description: 'Clients are waiting for compliance review and quotations are waiting for admin review.',
    repeatNote: 'Pending items are reminded on the configured approval schedule until approved or rejected.',
    hiddenNote: 'more pending approvals are available in CRM',
    defaultTabRecord: null
  };
}

function buildPendingClientDigestEmail(records, totalPendingCount, counts = {}) {
  const meta = getDigestMeta(records, totalPendingCount, counts);
  const approvalLink = escapeHtml(pendingApprovalUrl(meta.defaultTabRecord));
  const dueCount = records.length;
  const hiddenCount = Math.max(0, totalPendingCount - dueCount);

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>${escapeHtml(meta.title)}</title>
      </head>
      <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
        <span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">
          ${escapeHtml(meta.preheader)}
        </span>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f1f5f9;">
          <tr>
            <td align="center" style="padding:28px 14px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:760px;border-collapse:collapse;background:#ffffff;border:1px solid #dbe3ef;border-radius:18px;overflow:hidden;box-shadow:0 18px 45px rgba(15,23,42,.10);">
                <tr>
                  <td style="background:#064e3b;padding:28px 30px;">
                    <div style="color:#a7f3d0;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.12em;">Anant Tattva CRM</div>
                    <div style="margin-top:8px;color:#ffffff;font-size:28px;line-height:1.18;font-weight:900;">${escapeHtml(meta.title)}</div>
                    <div style="margin-top:10px;color:#d1fae5;font-size:14px;line-height:1.6;">${escapeHtml(meta.description)}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:26px 30px 10px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                      <tr>
                        <td style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:14px;padding:18px;width:50%;">
                          <div style="color:#047857;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;">Total Pending</div>
                          <div style="margin-top:8px;color:#064e3b;font-size:34px;font-weight:900;">${totalPendingCount}</div>
                        </td>
                        <td style="width:14px;"></td>
                        <td style="background:#fffbeb;border:1px solid #fde68a;border-radius:14px;padding:18px;width:50%;">
                          <div style="color:#92400e;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;">Included In This Email</div>
                          <div style="margin-top:8px;color:#78350f;font-size:34px;font-weight:900;">${dueCount}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:16px 30px 22px;">
                    <a href="${approvalLink}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;border-radius:12px;padding:15px 26px;font-size:15px;font-weight:900;box-shadow:0 10px 22px rgba(16,185,129,.28);">
                      Open Pending Approval
                    </a>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 30px 26px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
                      <tr>
                        <th style="padding:11px 10px;background:#f8fafc;border-bottom:1px solid #e5e7eb;color:#64748b;font-size:11px;font-weight:900;text-transform:uppercase;text-align:center;">#</th>
                        <th style="padding:11px 10px;background:#f8fafc;border-bottom:1px solid #e5e7eb;color:#64748b;font-size:11px;font-weight:900;text-transform:uppercase;text-align:left;">Type</th>
                        <th style="padding:11px 10px;background:#f8fafc;border-bottom:1px solid #e5e7eb;color:#64748b;font-size:11px;font-weight:900;text-transform:uppercase;text-align:left;">Name</th>
                        <th style="padding:11px 10px;background:#f8fafc;border-bottom:1px solid #e5e7eb;color:#64748b;font-size:11px;font-weight:900;text-transform:uppercase;text-align:left;">Unique ID</th>
                        <th style="padding:11px 10px;background:#f8fafc;border-bottom:1px solid #e5e7eb;color:#64748b;font-size:11px;font-weight:900;text-transform:uppercase;text-align:left;">Created By</th>
                        <th style="padding:11px 10px;background:#f8fafc;border-bottom:1px solid #e5e7eb;color:#64748b;font-size:11px;font-weight:900;text-transform:uppercase;text-align:left;">Requested</th>
                      </tr>
                      ${buildDigestRows(records)}
                    </table>
                    ${hiddenCount > 0 ? `<div style="margin-top:12px;color:#64748b;font-size:13px;font-weight:800;text-align:center;">${hiddenCount} ${escapeHtml(meta.hiddenNote)}.</div>` : ''}
                    <div style="margin-top:14px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:14px 16px;color:#92400e;font-size:13px;line-height:1.6;font-weight:700;">
                      ${escapeHtml(meta.repeatNote)}
                    </div>
                    <div style="margin-top:14px;color:#64748b;font-size:12px;line-height:1.5;text-align:center;">
                      Button not working? Open this link:<br>
                      <a href="${approvalLink}" style="color:#047857;text-decoration:underline;word-break:break-all;">${approvalLink}</a>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

async function getReviewerEmails(records = []) {
  const types = new Set(records.map((record) => record?.type).filter(Boolean));
  const roles = types.size === 1 && types.has('client') ? ['compliance'] : [...ADMIN_ROLES, 'compliance'];
  const reviewers = await User.find({
    role: { $in: roles },
    isActive: true,
    email: { $exists: true, $ne: '' }
  }).select('email').lean();

  return [
    ...new Set([
      ...reviewers.map((reviewer) => String(reviewer.email || '').trim().toLowerCase()).filter(Boolean),
      ...(types.has('quotation') ? splitEmails(process.env.PENDING_APPROVAL_EMAILS) : [])
    ])
  ];
}

async function queuePendingClientReminder(recordOrId, when = new Date(Date.now() + TWENTY_FOUR_HOURS)) {
  const id = recordOrId?._id || recordOrId;
  if (!id) return null;

  if (!pendingApprovalEmailEnabled()) return null;

  return PendingApproval.findByIdAndUpdate(
    id,
    {
      $set: {
        nextReminderAt: when,
        reminderError: ''
      }
    },
    { new: true }
  );
}

async function sendPendingClientReminder(record) {
  const adminEmails = await getReviewerEmails([record]);
  const now = new Date();
  const nextReminderAt = new Date(now.getTime() + REMINDER_INTERVAL_MS);

  if (!adminEmails.length) {
    record.nextReminderAt = nextReminderAt;
    record.reminderError = 'No active admin email recipients found';
    await record.save();
    return;
  }

  try {
    await sendMail(
      adminEmails.join(','),
      `Pending client approval: ${record.clientName || 'Untitled client'}`,
      buildPendingClientEmail(record)
    );
    console.log(`Pending approval reminder sent to ${adminEmails.length} admin recipient(s) for ${record.clientName || record._id}`);

    record.lastReminderAt = now;
    record.nextReminderAt = nextReminderAt;
    record.reminderCount = Number(record.reminderCount || 0) + 1;
    record.reminderError = '';
    record.notifiedAdminEmails = adminEmails;
    await record.save();
  } catch (err) {
    console.error('Pending approval reminder mail error', err);
    record.nextReminderAt = nextReminderAt;
    record.reminderError = err.message || 'Unable to send pending approval reminder';
    await record.save();
  }
}

async function sendPendingClientReminderDigest(records, totalPendingCount, counts = {}) {
  const adminEmails = await getReviewerEmails(records);
  const now = new Date();
  const nextReminderAt = new Date(now.getTime() + REMINDER_INTERVAL_MS);
  if (!records.length) return;

  const pendingFilter = { approvalStatus: 'PENDING' };
  const eligibleFilter = {
    ...pendingFilter,
    _id: { $in: records.map((record) => record._id) },
    reminderCount: { $lt: MAX_REMINDERS_PER_APPROVAL },
    ...(EMAIL_START_AT ? { createdAt: { $gte: EMAIL_START_AT } } : {})
  };

  if (!adminEmails.length) {
    await PendingApproval.updateMany(
      eligibleFilter,
      {
        $set: {
          nextReminderAt,
          reminderError: 'No active admin email recipients found'
        }
      }
    );
    return;
  }

  try {
    const subject = getDigestMeta(records, totalPendingCount, counts).subject;
    const html = buildPendingClientDigestEmail(records, totalPendingCount, counts);
    const results = [];

    for (const email of adminEmails) {
      const info = await sendMail(email, subject, html);
      results.push({
        email,
        accepted: info.accepted || [],
        rejected: info.rejected || [],
        response: info.response || ''
      });
    }

    const acceptedEmails = results.flatMap((result) => result.accepted);
    const rejectedEmails = results.flatMap((result) => result.rejected);
    console.log(`Pending approval digest SMTP result: accepted=${acceptedEmails.join(', ') || '-'} rejected=${rejectedEmails.join(', ') || '-'} totalPending=${totalPendingCount} included=${records.length}`);

    await PendingApproval.updateMany(
      eligibleFilter,
      {
        $set: {
          lastReminderAt: now,
          nextReminderAt,
          reminderError: '',
          notifiedAdminEmails: acceptedEmails.length ? acceptedEmails : adminEmails
        },
        $inc: { reminderCount: 1 }
      }
    );
    const secondReminderIds = records.filter((record) => record.type === 'client' && Number(record.reminderCount || 0) >= 1).map((record) => record._id);
    if (secondReminderIds.length) {
      await PendingApproval.updateMany({ _id: { $in: secondReminderIds }, approvalStatus: 'PENDING' }, {
        $set: { reminderFlag: 'RED', redFlagAt: now, greenFlagDeadline: new Date(now.getTime() + 48 * 60 * 60 * 1000) }
      });
    }
  } catch (err) {
    console.error('Pending approval digest mail error', err);
    await PendingApproval.updateMany(
      eligibleFilter,
      {
        $set: {
          nextReminderAt,
          reminderError: err.message || 'Unable to send pending approval digest'
        }
      }
    );
  }
}

async function sendDuePendingClientReminders() {
  if (!pendingApprovalEmailEnabled()) return;
  if (scanRunning) return;
  scanRunning = true;

  try {
    const now = new Date();
    const pendingFilter = {
      approvalStatus: 'PENDING',
      reminderCount: { $lt: MAX_REMINDERS_PER_APPROVAL },
      ...(EMAIL_START_AT ? { createdAt: { $gte: EMAIL_START_AT } } : {})
    };
    const [totalPendingCount, pendingClientCount, pendingQuotationCount] = await Promise.all([
      PendingApproval.countDocuments(pendingFilter),
      PendingApproval.countDocuments({ ...pendingFilter, type: 'client' }),
      PendingApproval.countDocuments({ ...pendingFilter, type: 'quotation' })
    ]);
    if (!totalPendingCount) return;

    const dueCount = await PendingApproval.countDocuments({
      ...pendingFilter,
      $or: [
        { nextReminderAt: { $exists: false } },
        { nextReminderAt: null },
        { nextReminderAt: { $lte: now } }
      ]
    });
    if (!dueCount) return;

    const records = await PendingApproval.find({
      ...pendingFilter,
      $or: [
        { nextReminderAt: { $exists: false } },
        { nextReminderAt: null },
        { nextReminderAt: { $lte: now } }
      ]
    }).sort({ nextReminderAt: 1, createdAt: 1 }).limit(DIGEST_RECORD_LIMIT);

    await sendPendingClientReminderDigest(records, totalPendingCount, {
      clients: pendingClientCount,
      quotations: pendingQuotationCount
    });
  } finally {
    scanRunning = false;
  }
}

function startPendingApprovalReminderScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  sendDuePendingClientReminders().catch((err) => {
    console.error('Pending approval reminder scan failed', err);
  });

  setInterval(() => {
    sendDuePendingClientReminders().catch((err) => {
      console.error('Pending approval reminder scan failed', err);
    });
  }, SCAN_INTERVAL_MS);
}

module.exports = {
  queuePendingClientReminder,
  sendDuePendingClientReminders,
  startPendingApprovalReminderScheduler
};
