const Notification = require('../models/Notification');
const User = require('../models/User');
const { sendMail } = require('../utils/mailer');
const { userHasAnyRole } = require('../utils/userRoles');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function activeComplianceUsers() {
  const users = await User.find({ isActive: { $ne: false } }).select('_id name email role roles').lean();
  return users.filter((user) => userHasAnyRole(user, ['compliance']));
}

async function notifyComplianceClientSubmission({ client = {}, submitter = {}, resubmission = false, previousStatus = '' } = {}) {
  const recipients = await activeComplianceUsers();
  if (!recipients.length) return { sent: false, reason: 'no_active_compliance_recipients', recipients: 0 };

  const data = client.data || {};
  const clientName = data.basic?.clientLegalName || data.basic?.tradeName || data.companyOverview?.companyName || 'Client Master';
  const applicant = data.basic?.piboCategory || data.selectedLeadSnapshot?.subApplicantType || data.selectedLeadSnapshot?.applicantType || '-';
  const service = data.basic?.servicesOffered || data.selectedLeadSnapshot?.servicesOffered || '-';
  const submitterName = submitter?.name || submitter?.email || 'CRM User';
  const title = resubmission ? 'Corrected Client Master resubmitted' : 'Client Master submitted for compliance approval';
  const description = resubmission
    ? `${submitterName} corrected and resubmitted ${clientName} after ${String(previousStatus || 'review').toLowerCase().replace(/_/g, ' ')}.`
    : `${submitterName} submitted ${clientName} for compliance review.`;
  const metadata = {
    clientId: String(client._id || ''), clientName, applicant, service,
    submissionType: resubmission ? 'RESUBMISSION' : 'INITIAL', previousStatus: String(previousStatus || ''),
    submittedById: String(submitter?._id || submitter?.id || ''), submittedByName: submitterName
  };

  const notification = await Notification.create({
    title, description, tag: 'Client Master Approval', kind: resubmission ? 'client_master_resubmitted' : 'client_master_submitted',
    createdBy: submitter?._id, createdByName: submitterName,
    audience: recipients.map((recipient) => recipient._id), visibleToRoles: ['compliance'], metadata
  });

  const subject = `${title} - ${clientName}`;
  const html = `<div style="font-family:Arial,sans-serif;color:#334155;line-height:1.6"><h2 style="color:#0f766e">${escapeHtml(title)}</h2><p>Hello Compliance Team,</p><p>${escapeHtml(description)}</p><p><strong>Applicant / Sub-applicant:</strong> ${escapeHtml(applicant)}<br><strong>Service:</strong> ${escapeHtml(service)}</p><p>Please sign in to CRM and open Pending Approval to review the Client Master.</p><p>Regards,<br>Team AnantTattva</p></div>`;
  const emailResults = await Promise.allSettled(recipients.filter((recipient) => recipient.email).map((recipient) => (
    sendMail(recipient.email, subject, html, { branded: false })
  )));
  const emailSent = emailResults.filter((result) => result.status === 'fulfilled').length;
  const emailFailed = emailResults.length - emailSent;
  return { sent: true, notificationId: notification._id, recipients: recipients.length, emailSent, emailFailed };
}

module.exports = { activeComplianceUsers, notifyComplianceClientSubmission };
