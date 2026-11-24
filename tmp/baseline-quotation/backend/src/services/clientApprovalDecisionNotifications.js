const User = require('../models/User');
const { sendMail } = require('../utils/mailer');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function allocationUserIds(client = {}) {
  const allocations = client.serviceAllocations && typeof client.serviceAllocations === 'object'
    ? Object.values(client.serviceAllocations)
    : [];
  return allocations.map((entry) => String(
    (entry && typeof entry === 'object'
      ? entry.userId || entry.userIdString || entry.user || entry.assignedTo || entry.assigneeId || entry.assignedUserId || entry._id || entry.id
      : entry) || ''
  ).trim()).filter(Boolean);
}

async function resolveClientManager(client = {}, payload = {}) {
  const assigned = client.adminControls?.assignedTo;
  const assignedId = String(assigned?._id || assigned?.id || assigned || '').trim();
  const candidateIds = [...new Set([assignedId, ...allocationUserIds(client)].filter(Boolean))];
  for (const id of candidateIds) {
    const manager = await User.findById(id).select('name email role isActive').lean();
    if (manager?.isActive !== false && manager?.email) return manager;
  }
  const creatorId = String(client.createdBy?._id || client.createdBy || payload.createdByUserId || payload.createdById || '').trim();
  return creatorId ? User.findById(creatorId).select('name email role isActive').lean() : null;
}

function buildClientApprovalDecisionEmail({ clientName = 'Client Master', status, remarks = '', reviewerName = 'Admin', recipientName = 'User', sections = [], approvalMode = '', applicantTypes = [], subApplicantTypes = [], applicationTypes = [] } = {}) {
  const approved = String(status || '').toUpperCase() === 'APPROVED';
  const partial = String(approvalMode || '').toUpperCase() === 'PARTIAL';
  const correction = String(approvalMode || '').toUpperCase() === 'CORRECTION';
  const decision = approved ? 'approved' : partial ? 'partially approved and returned for completion' : correction ? 'returned for correction' : 'rejected';
  const color = approved ? '#047857' : partial || correction ? '#ea580c' : '#dc2626';
  const background = approved ? '#ecfdf5' : partial || correction ? '#fff7ed' : '#fef2f2';
  const safeRemarks = String(remarks || '').trim();
  const approvedSections = sections.filter((section) => ['VERIFIED', 'NOT_APPLICABLE'].includes(String(section.status || '').toUpperCase()));
  const pendingSections = sections.filter((section) => !['VERIFIED', 'NOT_APPLICABLE'].includes(String(section.status || '').toUpperCase()));
  const sectionList = (items, tone) => items.length ? `<ul style="margin:8px 0 0;padding-left:20px">${items.map((section) => `<li style="margin:6px 0;color:${tone}"><strong>${escapeHtml(section.label)}</strong>${section.remarks ? ` — ${escapeHtml(section.remarks)}` : ''}</li>`).join('')}</ul>` : '<p style="margin:8px 0 0;color:#64748b">None</p>';
  const metadataRow = (label, values) => `<p style="margin:6px 0"><strong>${label}:</strong> ${escapeHtml(values.join(', ') || '-')}</p>`;
  return {
    subject: `Client Master ${approved ? 'Final Approval' : partial ? 'Partial Approval' : correction ? 'Changes Requested' : 'Rejected'} - ${clientName}`,
    html: `<div style="background:#f1f5f9;padding:28px 12px;font-family:Arial,Helvetica,sans-serif;color:#334155">
      <div style="max-width:680px;margin:auto;overflow:hidden;border:1px solid #e2e8f0;border-radius:18px;background:#ffffff">
        <div style="background:${color};padding:24px 28px;color:#ffffff"><div style="font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;opacity:.85">AnantTattva CRM</div><h1 style="margin:8px 0 0;font-size:24px">Client Master ${approved ? 'Final Approval' : partial ? 'Partial Approval' : correction ? 'Changes Requested' : 'Rejected'}</h1></div>
        <div style="padding:26px 28px"><p style="margin:0 0 18px;font-size:15px;line-height:1.7">Hello <strong>${escapeHtml(recipientName)}</strong>,</p>
          <p style="font-size:15px;line-height:1.7">Your Client Master request for <strong>${escapeHtml(clientName)}</strong> has been <strong style="color:${color}">${decision}</strong>.</p>
          <div style="margin:16px 0;padding:14px;border:1px solid #cbd5e1;border-radius:12px;background:#f8fafc">${metadataRow('Applicant Type', applicantTypes)}${metadataRow('Sub Applicant Type', subApplicantTypes)}${metadataRow('Application Type', applicationTypes)}</div>
          <div style="margin:20px 0;padding:16px;border:1px solid ${color}33;border-radius:12px;background:${background}"><p style="margin:0 0 8px"><strong>Decision:</strong> ${approved ? 'Final Approved' : partial ? 'Partially Approved' : correction ? 'Changes Requested' : 'Rejected'}</p><p style="margin:0"><strong>Reviewed by:</strong> ${escapeHtml(reviewerName)}</p>${safeRemarks ? `<p style="margin:8px 0 0"><strong>Remarks:</strong> ${escapeHtml(safeRemarks)}</p>` : ''}</div>
          <div style="display:grid;gap:14px"><div style="padding:16px;border:1px solid #a7f3d0;border-radius:12px;background:#f0fdf4"><strong style="color:#047857">Completed / Approved Tabs (${approvedSections.length})</strong>${sectionList(approvedSections, '#166534')}</div><div style="padding:16px;border:1px solid #fed7aa;border-radius:12px;background:#fff7ed"><strong style="color:#c2410c">Pending / Action Required Tabs (${pendingSections.length})</strong>${sectionList(pendingSections, '#9a3412')}</div></div>
          ${approved ? '' : '<div style="margin:18px 0;padding:15px;border:1px solid #fecaca;border-radius:12px;background:#fef2f2;color:#991b1b;font-size:14px;line-height:1.7"><strong>Action required within 48 working hours.</strong> One reminder will be sent after 24 working hours. If approval is not obtained within 48 working hours, the Client Master will receive a red flag. A final 48-working-hour recovery window will then remain available to correct the data and obtain compliance approval so the flag can return to green. After 96 working hours, the red flag becomes permanent. First and third Saturdays are office holidays and do not count; each such Saturday extends the deadline by 24 hours.</div>'}
          <p style="font-size:14px;line-height:1.7">Please sign in to CRM and open Pending Approval or Client Master to review the updated status.</p>
          <p style="margin:24px 0 0;font-size:14px;line-height:1.7">Thanks and regards,<br><strong>Team AnantTattva</strong></p>
        </div>
      </div>
    </div>`
  };
}

function clientDecisionMetadata(client = {}) {
  const data = client.data || {};
  const snapshot = data.selectedLeadSnapshot || {};
  const lead = client.selectedLead && typeof client.selectedLead === 'object' ? client.selectedLead : {};
  const services = Array.isArray(lead.serviceSelections) ? lead.serviceSelections : [];
  const assignedServiceId = String(client.assignedServiceId || data.assignedServiceId || snapshot.assignedServiceId || '').trim();
  const currentSubApplicant = String(data.basic?.piboCategory || snapshot.subApplicantType || snapshot.piboCategory || '').trim().toLowerCase();
  const serviceMatchesId = (service) => [service?.assignedServiceId, service?.serviceAssignmentId, service?.id]
    .some((value) => assignedServiceId && String(value || '').trim() === assignedServiceId);
  const serviceMatchesType = (service) => [service?.subApplicantType, service?.piboCategory]
    .some((value) => currentSubApplicant && String(value || '').trim().toLowerCase() === currentSubApplicant);
  const relevantService = services.find(serviceMatchesId) || services.find(serviceMatchesType) || {};
  const first = (...values) => values.flatMap((value) => Array.isArray(value) ? value : [value]).map((value) => String(value || '').trim()).find(Boolean) || '';
  const single = (value) => value ? [value] : [];
  return {
    applicantTypes: single(first(snapshot.applicantType, snapshot.piboParent, snapshot.piboCategoryParent, relevantService.applicantType, relevantService.piboParent, relevantService.piboCategoryParent, lead.applicantType, lead.piboParent, lead.piboCategoryParent)),
    subApplicantTypes: single(first(data.basic?.piboCategory, snapshot.subApplicantType, snapshot.piboCategory, relevantService.subApplicantType, relevantService.piboCategory, lead.subApplicantType, lead.piboCategory)),
    applicationTypes: single(first(data.cpcb?.applicationType, data.annualReturn?.applicationRenewal, data.basic?.applicationType, snapshot.applicationType, relevantService.applicationType))
  };
}

async function notifyClientApprovalDecision({ record = {}, client = {}, status, remarks = '', reviewer = {}, sections = [], approvalMode = '' } = {}) {
  const payload = record.payload || {};
  const manager = await resolveClientManager(client, payload);
  const email = String(manager?.email || payload.createdByEmail || payload.userEmail || '').trim().toLowerCase();
  if (!email) return { sent: false, reason: 'client_manager_email_missing' };
  const clientName = record.clientName || payload.clientName || payload.companyName || client.data?.basic?.clientLegalName || client.data?.basic?.tradeName || 'Client Master';
  const metadata = clientDecisionMetadata(client);
  const content = buildClientApprovalDecisionEmail({
    clientName,
    status,
    remarks,
    reviewerName: reviewer.name || reviewer.email || 'Admin',
    recipientName: manager?.name || record.createdByName || payload.createdBy || payload.userName || 'Manager',
    sections,
    approvalMode,
    ...metadata
  });
  await sendMail(email, content.subject, content.html, { branded: false });
  return { sent: true, email, recipientId: manager?._id, recipientName: manager?.name || '', recipientRole: manager?.role || '' };
}

module.exports = { buildClientApprovalDecisionEmail, clientDecisionMetadata, notifyClientApprovalDecision, resolveClientManager };
