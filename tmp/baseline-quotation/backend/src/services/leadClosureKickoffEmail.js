const User = require('../models/User');
const { sendMail } = require('../utils/mailer');

function splitEmails(value) {
  return String(value || '')
    .split(/[,\s;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

async function resolveUserEmails(values = []) {
  const identities = [...new Set(values.flatMap((value) => value && typeof value === 'object'
    ? [value._id, value.id, value.crmUserId, value.userId, value.email]
    : [value]).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!identities.length) return [];
  const conditions = [];
  identities.forEach((identity) => {
    conditions.push({ crmUserId: identity }, { email: identity.toLowerCase() }, { name: identity });
    if (/^[a-f\d]{24}$/i.test(identity)) conditions.push({ _id: identity });
  });
  const users = await User.find({ $or: conditions, isActive: { $ne: false } }).select('email').lean();
  return users.flatMap((user) => splitEmails(user.email));
}

function isClosed(lead = {}) {
  if (lead.closedBy || lead.closedByText || lead.closedAt) return true;
  return (Array.isArray(lead.assignments) ? lead.assignments : []).some((row) => row?.closedBy || row?.closedByText);
}

function hasCompletedAssignment(lead = {}) {
  const assignments = Array.isArray(lead.assignments) ? lead.assignments : [];
  return assignments.some((row) => (
    (row?.closedBy || row?.closedByText)
    && (row?.assignedTo || row?.assignedToText || row?.assignedToEmail)
    && (row?.assignedStaff || row?.assignedStaffText || row?.assignedStaffEmail)
  ));
}

function kickoffRecipients(lead = {}) {
  return [...new Set([
    ...(Array.isArray(lead.contacts) ? lead.contacts.flatMap((contact) => splitEmails(contact?.emails)) : []),
    ...splitEmails(lead.emails)
  ])];
}

function isKickoffReady(lead = {}) {
  const assignments = Array.isArray(lead.assignments) ? lead.assignments : [];
  const hasConsentedCompletedAssignment = assignments.some((row) => (
    row?.kickoffEmailConsent === 'yes'
    && (row?.closedBy || row?.closedByText)
    && (row?.assignedTo || row?.assignedToText || row?.assignedToEmail)
    && (row?.assignedStaff || row?.assignedStaffText || row?.assignedStaffEmail)
  ));
  return isClosed(lead) && hasConsentedCompletedAssignment && kickoffRecipients(lead).length > 0;
}

async function sendLeadClosureKickoffEmail({ beforeLead = {}, lead = {} }) {
  // Closing and staff assignment commonly happen in separate saves. Send when the
  // workflow first becomes complete, rather than only on the initial close save.
  if (isKickoffReady(beforeLead) || !isKickoffReady(lead)) {
    return { skipped: true, reason: 'kickoff-not-newly-ready' };
  }

  const to = kickoffRecipients(lead);

  const assignments = Array.isArray(lead.assignments) ? lead.assignments : [];
  const directCc = [
    ...splitEmails(lead.createdByEmail),
    ...assignments.flatMap((row) => [...splitEmails(row?.assignedToEmail), ...splitEmails(row?.assignedStaffEmail)])
  ];
  const lookupCc = await resolveUserEmails([
    lead.createdBy,
    lead.createdByCrmUserId,
    lead.importedCreatedBy,
    ...assignments.flatMap((row) => [row?.assignedTo, row?.assignedToCrmUserId, row?.assignedStaff])
  ]);
  const cc = [...new Set([...directCc, ...lookupCc])].filter((email) => !to.includes(email));
  const company = escapeHtml(lead.company || 'your organization');
  const serviceRows = Array.isArray(lead.serviceSelections) && lead.serviceSelections.length
    ? lead.serviceSelections
    : [lead];
  const serviceTables = serviceRows.map((row, index) => `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;margin:0 0 14px;border-collapse:separate;border-spacing:0;border:1px solid #dbe5e7;border-radius:12px;overflow:hidden">
      <tr><td colspan="2" style="padding:11px 14px;background:#ecfdf5;color:#0f766e;font-size:13px;font-weight:700">Service ${index + 1}</td></tr>
      <tr><td style="width:38%;padding:10px 14px;border-top:1px solid #e2e8f0;background:#f8fafc;font-weight:700">Service Category</td><td style="padding:10px 14px;border-top:1px solid #e2e8f0">${escapeHtml(row?.eprCategory || '-')}</td></tr>
      <tr><td style="padding:10px 14px;border-top:1px solid #e2e8f0;background:#f8fafc;font-weight:700">${/plastic\s+waste/i.test(String(row?.eprCategory || '')) ? 'Sub Applicant Type' : 'Applicant Type'}</td><td style="padding:10px 14px;border-top:1px solid #e2e8f0">${escapeHtml(/plastic\s+waste/i.test(String(row?.eprCategory || '')) ? (row?.subApplicantType || row?.piboCategory || '-') : (row?.applicantType || '-'))}</td></tr>
      <tr><td style="padding:10px 14px;border-top:1px solid #e2e8f0;background:#f8fafc;font-weight:700">Services Offered</td><td style="padding:10px 14px;border-top:1px solid #e2e8f0">${escapeHtml(row?.servicesOffered || '-')}</td></tr>
      <tr><td style="padding:10px 14px;border-top:1px solid #e2e8f0;background:#f8fafc;font-weight:700">Applicable Services</td><td style="padding:10px 14px;border-top:1px solid #e2e8f0">${escapeHtml(row?.applicableService || '-')}</td></tr>
      <tr><td style="padding:10px 14px;border-top:1px solid #e2e8f0;background:#f8fafc;font-weight:700">Financial Year</td><td style="padding:10px 14px;border-top:1px solid #e2e8f0">${escapeHtml(row?.firstAnnualReturnYearApplicable || '-')}</td></tr>
    </table>`).join('');
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#334155;line-height:1.7">
      <h2 style="margin:0 0 18px;color:#0f766e">Virtual Kick-Off Meeting</h2>
      <p>Dear Team,</p>
      <p>As we are about to begin the onboarding process for <strong>${company}</strong>, we would like to schedule a virtual kick-off meeting to discuss the next steps and ensure a smooth onboarding.</p>
      <p>Kindly suggest a convenient date and time for the virtual kick-off meeting based on your availability.</p>
      <div style="margin:22px 0">
        <h3 style="margin:0 0 12px;color:#0f766e">Onboarding Services</h3>
        ${serviceTables}
      </div>
      <p>We look forward to your confirmation.</p>
      <p style="margin-top:24px">Thanks &amp; Regards,<br><strong>Team AnantTattva</strong></p>
    </div>`;

  await sendMail(to, `Virtual Kick-Off Meeting - ${lead.company || 'Client Onboarding'}`, html, { cc });
  return { sent: true, to, cc };
}

module.exports = {
  hasCompletedAssignment,
  isKickoffReady,
  kickoffRecipients,
  sendLeadClosureKickoffEmail
};
