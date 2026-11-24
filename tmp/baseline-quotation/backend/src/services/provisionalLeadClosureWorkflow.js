const Lead = require('../models/Lead');
const LeadActivity = require('../models/LeadActivity');
const User = require('../models/User');
const { sendMail } = require('../utils/mailer');
const { BUSINESS_DAYS, normalizeProvisionalClosure } = require('../utils/provisionalClosureDeadline');

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function uniqueEmails(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))];
}

function serviceName(lead, assignment, index) {
  const service = lead.serviceSelections?.[index] || {};
  return service.servicesOffered || assignment.servicesOffered || service.serviceCategory || service.eprCategory || lead.servicesOffered || 'Selected service';
}

async function superAdminEmails() {
  const users = await User.find({ role: 'superadmin', isActive: { $ne: false } }).select('email').lean();
  return users.map((user) => user.email);
}

async function sendProvisionalClosureEmail({ lead, assignment, index, actorEmail }) {
  const recipients = uniqueEmails([actorEmail, assignment.closedByEmail, ...(await superAdminEmails())]);
  if (!recipients.length) return;
  const company = lead.company || lead.leadCode || 'Lead';
  const service = serviceName(lead, assignment, index);
  const deadline = assignment.provisionalCloseExpiresAt ? new Date(assignment.provisionalCloseExpiresAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '-';
  const html = `<div style="max-width:680px;font-family:Arial,sans-serif;color:#334155;line-height:1.6">
    <h2 style="color:#b45309">Lead closed under special approval</h2>
    <p>The lead service below has been closed provisionally using Super Admin approval because the Purchase Order has not yet been received.</p>
    <table style="width:100%;border-collapse:collapse;margin:18px 0">
      <tr><td style="padding:9px;border:1px solid #e2e8f0;font-weight:700">Company</td><td style="padding:9px;border:1px solid #e2e8f0">${escapeHtml(company)}</td></tr>
      <tr><td style="padding:9px;border:1px solid #e2e8f0;font-weight:700">Service</td><td style="padding:9px;border:1px solid #e2e8f0">${escapeHtml(service)}</td></tr>
      <tr><td style="padding:9px;border:1px solid #e2e8f0;font-weight:700">PO deadline</td><td style="padding:9px;border:1px solid #e2e8f0">${escapeHtml(deadline)} IST</td></tr>
    </table>
    <p>Please upload the Purchase Order from the review action before the 7-business-day deadline. If it is not uploaded, only this provisional service will reopen automatically. Services whose POs have already been received will remain closed.</p>
  </div>`;
  await Promise.allSettled(recipients.map((email) => sendMail(email, `Special Approval Closure - ${company}`, html, { branded: false })));
}

async function notifyNewProvisionalClosures({ beforeLead = {}, afterLead = {}, actor = {} }) {
  const beforeAssignments = beforeLead.assignments || [];
  const afterAssignments = afterLead.assignments || [];
  const jobs = afterAssignments.map((assignment, index) => {
    const wasProvisional = beforeAssignments[index]?.poStatus === 'provisional';
    return assignment?.poStatus === 'provisional' && !wasProvisional
      ? sendProvisionalClosureEmail({ lead: afterLead, assignment, index, actorEmail: actor.email })
      : null;
  }).filter(Boolean);
  await Promise.allSettled(jobs);
}

async function processExpiredProvisionalClosures() {
  const now = new Date();
  const leads = await Lead.find({ assignments: { $elemMatch: {
    poStatus: 'provisional',
    $or: [
      { provisionalCloseExpiresAt: { $lte: now.toISOString() } },
      { provisionalCloseDeadlineBusinessDays: { $ne: BUSINESS_DAYS } }
    ]
  } } });
  let reopenedServices = 0;

  for (const lead of leads) {
    const expired = [];
    let deadlineUpdated = false;
    lead.assignments = (lead.assignments || []).map((assignment, index) => {
      if (assignment?.poStatus !== 'provisional') return assignment;
      const normalized = normalizeProvisionalClosure(assignment, assignment, now);
      if (assignment.provisionalCloseExpiresAt !== normalized.provisionalCloseExpiresAt
        || assignment.provisionalCloseDeadlineBusinessDays !== normalized.provisionalCloseDeadlineBusinessDays) deadlineUpdated = true;
      assignment = normalized;
      if (new Date(assignment.provisionalCloseExpiresAt) > now) return assignment;
      expired.push({ assignment: { ...assignment }, index, service: serviceName(lead, assignment, index) });
      return { ...assignment, closedBy: '', closedByText: '', closedByEmail: '', assignedTo: '', assignedToText: '', assignedToEmail: '', assignedStaff: '', assignedStaffText: '', assignedStaffEmail: '', poStatus: '', provisionalCloseExpiresAt: '', provisionalCloseDeadlineBusinessDays: 0 };
    });
    if (!expired.length) {
      if (deadlineUpdated) await lead.save();
      continue;
    }

    const primary = lead.assignments[0] || {};
    lead.closedBy = primary.closedBy || undefined;
    lead.closedByText = primary.closedByText || '';
    lead.closedByEmail = primary.closedByEmail || '';
    lead.assignedTo = primary.assignedTo || undefined;
    lead.assignedToText = primary.assignedToText || '';
    await lead.save();
    reopenedServices += expired.length;

    await LeadActivity.create({
      lead: lead._id,
      type: 'lead_reopened_po_expired',
      title: 'Lead service reopened',
      description: `${expired.length} provisional service closure(s) reopened after 7 business days because no Purchase Order was uploaded. Services with received POs remain closed.`
    });

    const recipients = uniqueEmails([...expired.map(({ assignment }) => assignment.closedByEmail), ...(await superAdminEmails())]);
    const company = lead.company || lead.leadCode || 'Lead';
    const serviceList = expired.map(({ service }) => `<li>${escapeHtml(service)}</li>`).join('');
    const html = `<div style="max-width:680px;font-family:Arial,sans-serif;color:#334155;line-height:1.6">
      <h2 style="color:#b91c1c">Lead reopened because the PO was not uploaded</h2>
      <p>The following service closure for <strong>${escapeHtml(company)}</strong> was provisional under special approval. The 7-business-day deadline has expired and the Purchase Order is still missing.</p>
      <ul>${serviceList}</ul>
      <p>Therefore, only the affected service has been reopened for user onboarding follow-up. Other services with uploaded POs remain closed.</p>
    </div>`;
    await Promise.allSettled(recipients.map((email) => sendMail(email, `Lead Reopened - PO Not Uploaded - ${company}`, html, { branded: false })));
  }
  return { leads: leads.length, reopenedServices };
}

function startProvisionalLeadClosureScheduler() {
  const run = () => processExpiredProvisionalClosures().catch((error) => console.error('Provisional lead closure workflow failed', error));
  setTimeout(run, 5000);
  setInterval(run, 60 * 1000);
}

module.exports = { notifyNewProvisionalClosures, processExpiredProvisionalClosures, startProvisionalLeadClosureScheduler };
