const User = require('../models/User');
const Team = require('../models/Team');
const Notification = require('../models/Notification');
const { sendMail } = require('../utils/mailer');

const adminRoles = ['admin', 'superadmin'];

function userLabel(user) {
  return user?.name || user?.email || 'CRM User';
}

function buildManagerReviewEmail({ manager, submitter, clientName, annualYear, sentCount }) {
  const managerName = userLabel(manager);
  const submitterName = userLabel(submitter);

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Annual Return Review</title>
      </head>
      <body style="margin:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fb;margin:0;padding:32px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;overflow:hidden;border-radius:18px;background:#ffffff;box-shadow:0 18px 50px rgba(15,23,42,0.12);">
                <tr>
                  <td style="background:#0f766e;padding:26px 28px;color:#ffffff;">
                    <div style="font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;opacity:0.86;">CRM Approval Workflow</div>
                    <div style="margin-top:8px;font-size:26px;font-weight:800;line-height:1.2;">Annual Return sent for Manager Review</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:30px 28px;">
                    <p style="margin:0 0 14px;font-size:16px;line-height:1.7;color:#334155;">Hi ${managerName},</p>
                    <p style="margin:0;font-size:15px;line-height:1.7;color:#475569;">${submitterName} has completed the annual data process and submitted it to you for review.</p>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0;border:1px solid #dbeafe;border-radius:14px;background:#f8fafc;">
                      <tr><td style="padding:14px 16px;color:#64748b;font-size:13px;font-weight:700;">Client</td><td style="padding:14px 16px;color:#0f172a;font-size:14px;font-weight:800;text-align:right;">${clientName || 'Client'}</td></tr>
                      <tr><td style="border-top:1px solid #e2e8f0;padding:14px 16px;color:#64748b;font-size:13px;font-weight:700;">Annual Year</td><td style="border-top:1px solid #e2e8f0;padding:14px 16px;color:#0f172a;font-size:14px;font-weight:800;text-align:right;">${annualYear}</td></tr>
                      <tr><td style="border-top:1px solid #e2e8f0;padding:14px 16px;color:#64748b;font-size:13px;font-weight:700;">Submission Alert Count</td><td style="border-top:1px solid #e2e8f0;padding:14px 16px;color:#0f766e;font-size:14px;font-weight:800;text-align:right;">${sentCount}</td></tr>
                    </table>
                    <p style="margin:0;font-size:14px;line-height:1.7;color:#64748b;">Please open CRM and review the pending annual return parts from the Manager Review panel.</p>
                  </td>
                </tr>
                <tr>
                  <td style="border-top:1px solid #e2e8f0;padding:18px 28px;background:#f8fafc;color:#64748b;font-size:12px;line-height:1.6;">
                    Admins can see this alert count in the Notification Center.
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

async function resolveManagerForSubmitter(submitter) {
  if (!submitter?._id && !submitter?.id) return null;
  if (submitter?.managerId) {
    const manager = await User.findById(submitter.managerId).select('name email role isActive').lean();
    if (manager) return manager;
  }

  const freshSubmitter = await User.findById(submitter._id || submitter.id).select('managerId').lean();
  if (freshSubmitter?.managerId) {
    const manager = await User.findById(freshSubmitter.managerId).select('name email role isActive').lean();
    if (manager) return manager;
  }

  const team = await Team.findOne({ members: submitter._id || submitter.id })
    .populate('manager', 'name email role isActive')
    .lean();
  return team?.manager || null;
}

async function notifyManagerAnnualSubmitted({ client, annualYear, submitter, preventDuplicate = false }) {
  const manager = await resolveManagerForSubmitter(submitter);
  if (!manager || !manager.isActive || !manager.email) {
    console.warn('Annual review manager notification skipped', {
      submitter: submitter?.email || submitter?._id,
      reason: 'manager_missing_or_inactive'
    });
    return { ok: false, reason: 'manager_missing_or_inactive' };
  }

  const clientName = client?.data?.basic?.clientLegalName || client?.data?.basic?.tradeName || 'Client';
  const clientId = String(client?._id || '');
  const managerId = String(manager._id || manager.id);
  const existingCount = await Notification.countDocuments({
    kind: 'annual_manager_submission',
    'metadata.clientId': clientId,
    'metadata.annualYear': annualYear,
    'metadata.managerId': managerId
  });
  if (preventDuplicate && existingCount > 0) {
    return { ok: true, skipped: true, reason: 'already_notified', sentCount: existingCount };
  }
  const sentCount = existingCount + 1;

  let emailSent = false;
  let emailError = '';
  try {
    await sendMail(
      manager.email,
      `CRM Annual Return Review - ${clientName}`,
      buildManagerReviewEmail({ manager, submitter, clientName, annualYear, sentCount })
    );
    emailSent = true;
  } catch (err) {
    emailError = err.message || 'Email failed';
    console.error('Annual review manager email failed', { manager: manager.email, clientId, annualYear, error: emailError });
  }

  const metadata = {
    clientId,
    clientName,
    annualYear,
    managerId,
    managerName: userLabel(manager),
    managerEmail: manager.email,
    submitterId: String(submitter?._id || ''),
    submitterName: userLabel(submitter),
    submitterEmail: submitter?.email || '',
    sentCount,
    emailSent,
    emailError
  };

  const managerNotification = await Notification.create({
    title: 'Annual return ready for review',
    description: `${metadata.submitterName} submitted ${clientName} (${annualYear}) to you for Manager Review.`,
    tag: 'Manager Review',
    kind: 'annual_manager_submission',
    createdBy: submitter?._id,
    createdByName: metadata.submitterName,
    audience: [manager._id],
    visibleToRoles: adminRoles,
    metadata
  });

  await Notification.create({
    title: `Manager alert sent to ${metadata.managerName}`,
    description: `${metadata.submitterName} submitted ${clientName} (${annualYear}). Notification count: ${sentCount}. Email: ${emailSent ? 'sent' : 'failed'}.`,
    tag: 'Admin Audit',
    kind: 'annual_manager_submission_audit',
    createdBy: submitter?._id,
    createdByName: metadata.submitterName,
    visibleToRoles: adminRoles,
    metadata
  });

  return { ok: true, managerNotification, emailSent, sentCount };
}

module.exports = { notifyManagerAnnualSubmitted };
