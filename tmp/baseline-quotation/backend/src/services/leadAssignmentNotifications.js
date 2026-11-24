const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { sendMail } = require('../utils/mailer');

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function latestFinancialYearRow(lead = {}, assignmentIndex = null) {
  const services = Array.isArray(lead.serviceSelections) ? lead.serviceSelections : [];
  const service = Number.isInteger(assignmentIndex) ? (services[assignmentIndex] || {}) : ([...services].reverse().find((row) => row?.firstAnnualReturnYearApplicable) || {});
  const assignments = Array.isArray(lead.assignments) ? lead.assignments : [];
  const assignment = Number.isInteger(assignmentIndex) ? (assignments[assignmentIndex] || lead) : (assignments[assignments.length - 1] || lead);
  return {
    fy: service.firstAnnualReturnYearApplicable || lead.firstAnnualReturnYearApplicable || '-',
    industryType: service.industryType || '-',
    eprCategory: service.eprCategory || '-',
    applicantType: service.applicantType || '-',
    piboCategory: service.subApplicantType || service.piboCategory || 'Not applicable',
    servicesOffered: service.servicesOffered || '-',
    generatedBy: service.leadGeneratedBy || lead.importedCreatedBy || lead.createdByName || '-',
    closedBy: service.closedByName || assignment.closedByText || lead.closedByText || '-',
    manager: service.assignedManagerName || assignment.assignedToText || lead.assignedToText || '-',
    staff: service.managerAssignedStaffName || assignment.assignedStaffText || lead.assignedStaffText || '-'
  };
}

async function resolveManager(value) {
  const id = String(value || '').trim();
  if (!id) return null;
  const query = [{ crmUserId: id }];
  if (mongoose.isValidObjectId(id)) query.unshift({ _id: id });
  return User.findOne({ $or: query, role: 'manager', isActive: { $ne: false } }).select('_id name email role').lean();
}

async function notifyLeadAssignment({ lead, managerId, assignedBy, assignmentIndex = null }) {
  const manager = await resolveManager(managerId);
  if (!manager) return { ok: false, reason: 'manager_not_found' };

  const leadId = String(lead?._id || lead?.id || lead?.sourceLeadId || lead?.leadCode || '').trim();
  const leadCode = String(lead?.leadCode || lead?.leadNumber || '').trim();
  const company = String(lead?.company || lead?.companyName || 'a company').trim();
  const creatorName = String(assignedBy?.name || assignedBy?.email || 'A CRM user').trim();
  const fyRow = latestFinancialYearRow(lead, assignmentIndex);
  fyRow.generatedBy = creatorName;
  const existing = await Notification.findOne({
    kind: 'lead_assigned_to_manager',
    audience: manager._id,
    'metadata.leadId': leadId,
    'metadata.managerId': String(manager._id),
    'metadata.financialYear': fyRow.fy,
    'metadata.assignmentIndex': Number.isInteger(assignmentIndex) ? assignmentIndex : -1
  }).lean();
  if (existing) return { ok: true, skipped: true };

  const description = `${creatorName} added ${fyRow.fy} for ${company}. This lead has been assigned to ${manager.name || manager.email}. Please take action and assign it to staff.`;
  const notification = await Notification.create({
    title: 'Existing lead updated for a new financial year',
    description,
    tag: 'Lead FY Update',
    kind: 'lead_assigned_to_manager',
    createdBy: assignedBy?._id,
    createdByName: creatorName,
    audience: [manager._id],
    metadata: { leadId, leadCode, company, managerId: String(manager._id), assignedBy: creatorName, financialYear: fyRow.fy, assignmentIndex: Number.isInteger(assignmentIndex) ? assignmentIndex : -1, rows: [fyRow] }
  });
  notification.crmNotificationId = String(notification._id);
  await notification.save();

  if (manager.email) {
    const appUrl = String(process.env.FRONTEND_URL || process.env.APP_URL || '').replace(/\/$/, '');
    const leadUrl = appUrl ? `${appUrl}/sales/lead-generation?tab=notified` : '';
    const html = `<div style="font-family:Arial,sans-serif;color:#334155">
          <h2 style="color:#0f766e">Existing lead updated for a new financial year</h2>
          <p>${escapeHtml(creatorName)} added ${escapeHtml(fyRow.fy)} for ${escapeHtml(company)}.</p>
          <p><strong>Company:</strong> ${escapeHtml(company)}</p>
          <p style="padding:14px 16px;border-left:4px solid #047857;background:#f0fdfa">
            This lead has been assigned to <strong>${escapeHtml(manager.name || manager.email)}</strong>.
            Please take action and assign it to staff.
          </p>
          <p style="padding:14px 16px;border:1px solid #fed7aa;border-radius:10px;background:#fff7ed;color:#9a3412">
            Your complete pending list is available in the <strong>Notified Leads</strong> tab on the Leads page. Once you assign a staff member, that item is automatically removed from the pending list.
          </p>
          <div style="overflow:auto">
            <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;margin:20px 0">
              <thead><tr style="background:#ecfdf5;color:#065f46">
                <th style="padding:11px;text-align:left">Financial Year (FY)</th>
                <th style="padding:11px;text-align:left">Lead Generated By</th>
                <th style="padding:11px;text-align:left">Lead Closed By</th>
                <th style="padding:11px;text-align:left">Assigned to Manager</th>
                <th style="padding:11px;text-align:left">Manager Assigned to Staff</th>
              </tr></thead>
              <tbody><tr>
                <td style="padding:11px;border-bottom:1px solid #e2e8f0">${escapeHtml(fyRow.fy)}</td>
                <td style="padding:11px;border-bottom:1px solid #e2e8f0">${escapeHtml(fyRow.generatedBy)}</td>
                <td style="padding:11px;border-bottom:1px solid #e2e8f0">${escapeHtml(fyRow.closedBy)}</td>
                <td style="padding:11px;border-bottom:1px solid #e2e8f0">${escapeHtml(fyRow.manager)}</td>
                <td style="padding:11px;border-bottom:1px solid #e2e8f0">${escapeHtml(fyRow.staff)}</td>
              </tr></tbody>
            </table>
          </div>
          <div style="overflow:auto;margin-top:20px">
            <h3 style="margin:0 0 10px;color:#0f172a">Service &amp; Applicant Configuration</h3>
            <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0">
              <thead><tr style="background:#eff6ff;color:#334155">
                <th style="padding:11px;text-align:left">Industry Type</th>
                <th style="padding:11px;text-align:left">Service Category</th>
                <th style="padding:11px;text-align:left">Applicant Type</th>
                ${fyRow.piboCategory && fyRow.piboCategory !== 'Not applicable' ? '<th style="padding:11px;text-align:left">Sub Applicant Type</th>' : ''}
                <th style="padding:11px;text-align:left">Services Offered</th>
                <th style="padding:11px;text-align:left">FY Year</th>
              </tr></thead>
              <tbody><tr>
                <td style="padding:11px;border-bottom:1px solid #e2e8f0">${escapeHtml(fyRow.industryType)}</td>
                <td style="padding:11px;border-bottom:1px solid #e2e8f0">${escapeHtml(fyRow.eprCategory)}</td>
                <td style="padding:11px;border-bottom:1px solid #e2e8f0">${escapeHtml(fyRow.applicantType)}</td>
                ${fyRow.piboCategory && fyRow.piboCategory !== 'Not applicable' ? `<td style="padding:11px;border-bottom:1px solid #e2e8f0">${escapeHtml(fyRow.piboCategory)}</td>` : ''}
                <td style="padding:11px;border-bottom:1px solid #e2e8f0">${escapeHtml(fyRow.servicesOffered)}</td>
                <td style="padding:11px;border-bottom:1px solid #e2e8f0">${escapeHtml(fyRow.fy)}</td>
              </tr></tbody>
            </table>
          </div>
          ${leadUrl ? `<p><a href="${escapeHtml(leadUrl)}" style="display:inline-block;background:#ea580c;color:#fff;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700">Open Notified Leads</a></p>` : ''}
          <p style="margin-top:20px;color:#64748b">Please review this update in the CRM Notification Center.</p>
    </div>`;
    try {
      await sendMail(manager.email, `Lead FY Update - ${company}`, html, { branded: false });
      notification.metadata = { ...notification.metadata, emailSent: true };
    } catch (error) {
      notification.metadata = { ...notification.metadata, emailSent: false, emailError: error.message };
    }
    notification.markModified('metadata');
    await notification.save();
  }
  return { ok: true, notificationId: notification._id };
}

module.exports = { notifyLeadAssignment };
