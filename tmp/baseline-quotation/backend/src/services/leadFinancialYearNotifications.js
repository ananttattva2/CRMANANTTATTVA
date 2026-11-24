const Notification = require('../models/Notification');
const User = require('../models/User');
const { sendMail } = require('../utils/mailer');

const ADMIN_ROLES = ['admin', 'superadmin'];

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function rowsFor(lead, fallback = {}) {
  const services = Array.isArray(lead?.serviceSelections) ? lead.serviceSelections : [];
  const assignment = Array.isArray(lead?.assignments) && lead.assignments.length ? lead.assignments[0] : lead || {};
  return services.filter((row) => row?.firstAnnualReturnYearApplicable).map((row) => ({
    fy: row.firstAnnualReturnYearApplicable,
    industryType: row.industryType || '-',
    eprCategory: row.eprCategory || '-',
    applicantType: row.applicantType || '-',
    piboCategory: row.subApplicantType || row.piboCategory || 'Not applicable',
    servicesOffered: row.servicesOffered || '-',
    generatedBy: row.leadGeneratedBy || fallback.generatedBy || lead.importedCreatedBy || lead.createdByName || '-',
    manager: row.assignedManagerName || assignment.assignedToText || lead.assignedToText || '-',
    closedBy: row.closedByName || assignment.closedByText || lead.closedByText || '-',
    staff: row.managerAssignedStaffName || assignment.assignedStaffText || lead.assignedStaffText || '-'
  }));
}

async function notifyNewFinancialYear({ beforeLead, savedLead, submittedPayload, actor }) {
  const beforeYears = new Set(rowsFor(beforeLead).map((row) => row.fy));
  const submittedRows = rowsFor(submittedPayload, { generatedBy: actor?.name || actor?.email || 'CRM User' });
  const newRows = submittedRows.filter((row) => !beforeYears.has(row.fy));
  if (!newRows.length) return { ok: false, reason: 'no_new_financial_year' };
  const latestRow = newRows[newRows.length - 1];

  const leadId = String(savedLead?._id || savedLead?.id || savedLead?.sourceLeadId || '').trim();
  const yearsKey = latestRow.fy;
  const existing = await Notification.findOne({ kind: 'lead_new_financial_year', 'metadata.leadId': leadId, 'metadata.yearsKey': yearsKey }).lean();
  if (existing) return { ok: true, skipped: true };

  const recipients = await User.find({ role: { $in: ADMIN_ROLES }, isActive: { $ne: false } }).select('_id name email role').lean();
  if (!recipients.length) return { ok: false, reason: 'no_admin_recipients' };
  const company = String(savedLead?.company || submittedPayload?.company || 'Company');
  const description = `${actor?.name || actor?.email || 'A sales user'} added ${latestRow.fy} for ${company}.`;
  const notification = await Notification.create({
    title: 'New financial year added to an existing lead',
    description,
    tag: 'Lead FY Update',
    kind: 'lead_new_financial_year',
    createdBy: actor?._id,
    createdByName: actor?.name || actor?.email || '',
    audience: recipients.map((recipient) => recipient._id),
    visibleToRoles: ADMIN_ROLES,
    metadata: { leadId, company, yearsKey, rows: [latestRow] }
  });
  notification.crmNotificationId = String(notification._id);
  await notification.save();

  const tableRows = [latestRow].map((row) => `<tr>
    <td style="padding:11px;border-bottom:1px solid #e2e8f0">${escapeHtml(row.fy)}</td>
    <td style="padding:11px;border-bottom:1px solid #e2e8f0">${escapeHtml(row.generatedBy)}</td>
    <td style="padding:11px;border-bottom:1px solid #e2e8f0">${escapeHtml(row.closedBy)}</td>
    <td style="padding:11px;border-bottom:1px solid #e2e8f0">${escapeHtml(row.manager)}</td>
    <td style="padding:11px;border-bottom:1px solid #e2e8f0">${escapeHtml(row.staff)}</td>
  </tr>`).join('');
  const serviceTable = `<div style="overflow:auto;margin-top:20px">
    <h3 style="margin:0 0 10px;color:#0f172a">Service &amp; Applicant Configuration</h3>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0">
      <thead><tr style="background:#eff6ff;color:#334155">
        <th style="padding:11px;text-align:left">Industry Type</th>
        <th style="padding:11px;text-align:left">Service Category</th>
        <th style="padding:11px;text-align:left">Applicant Type</th>
        ${latestRow.piboCategory && latestRow.piboCategory !== 'Not applicable' ? '<th style="padding:11px;text-align:left">Sub Applicant Type</th>' : ''}
        <th style="padding:11px;text-align:left">Services Offered</th>
        <th style="padding:11px;text-align:left">FY Year</th>
      </tr></thead>
      <tbody><tr>
        <td style="padding:11px;border-bottom:1px solid #e2e8f0">${escapeHtml(latestRow.industryType)}</td>
        <td style="padding:11px;border-bottom:1px solid #e2e8f0">${escapeHtml(latestRow.eprCategory)}</td>
        <td style="padding:11px;border-bottom:1px solid #e2e8f0">${escapeHtml(latestRow.applicantType)}</td>
        ${latestRow.piboCategory && latestRow.piboCategory !== 'Not applicable' ? `<td style="padding:11px;border-bottom:1px solid #e2e8f0">${escapeHtml(latestRow.piboCategory)}</td>` : ''}
        <td style="padding:11px;border-bottom:1px solid #e2e8f0">${escapeHtml(latestRow.servicesOffered)}</td>
        <td style="padding:11px;border-bottom:1px solid #e2e8f0">${escapeHtml(latestRow.fy)}</td>
      </tr></tbody>
    </table>
  </div>`;
  const html = `<div style="font-family:Arial,sans-serif;color:#334155">
    <h2 style="color:#0f766e">Existing lead updated for a new financial year</h2>
    <p>${escapeHtml(description)}</p>
    <p><strong>Company:</strong> ${escapeHtml(company)}</p>
    <p style="padding:14px 16px;border-left:4px solid #0f766e;background:#f0fdfa">
      This lead has been assigned to <strong>${escapeHtml(latestRow.manager)}</strong>.
      Please take action and assign it to staff.
    </p>
    <div style="overflow:auto"><table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0">
      <thead><tr style="background:#ecfdf5;color:#065f46">
        <th style="padding:11px;text-align:left">Financial Year (FY)</th>
        <th style="padding:11px;text-align:left">Lead Generated By</th>
        <th style="padding:11px;text-align:left">Lead Closed By</th>
        <th style="padding:11px;text-align:left">Assigned to Manager</th>
        <th style="padding:11px;text-align:left">Manager Assigned to Staff</th>
      </tr></thead><tbody>${tableRows}</tbody>
    </table></div>
    ${serviceTable}
    <p style="margin-top:20px;color:#64748b">Please review this update in the CRM Notification Center.</p>
  </div>`;
  const results = await Promise.allSettled(recipients.filter((recipient) => recipient.email).map((recipient) => sendMail(recipient.email, `Lead FY Update - ${company}`, html, { branded: false })));
  notification.metadata = { ...notification.metadata, emailSent: results.filter((result) => result.status === 'fulfilled').length, emailFailed: results.filter((result) => result.status === 'rejected').length };
  notification.markModified('metadata');
  await notification.save();
  return { ok: true, notificationId: notification._id };
}

module.exports = { notifyNewFinancialYear };
