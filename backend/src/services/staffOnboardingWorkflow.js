const Lead = require('../models/Lead');
const PendingApproval = require('../models/PendingApproval');
const { serviceId } = require('./onboardingAssignmentIdentity');
const mongoose = require('mongoose');
const Client = require('../models/Client');
const ClientOnboardingReminder = require('../models/ClientOnboardingReminder');
const Notification = require('../models/Notification');
const StaffOnboardingAssignment = require('../models/StaffOnboardingAssignment');
const User = require('../models/User');
const { sendMail } = require('../utils/mailer');

const DAY_MS = 24 * 60 * 60 * 1000;
const ONBOARDING_LIMIT_MS = 7 * DAY_MS;
const REMINDER_GAP_MS = 48 * 60 * 60 * 1000;

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function stableId(value) {
  if (value && typeof value === 'object') return String(value._id || value.id || value.crmUserId || value.userId || '');
  return String(value || '');
}

async function resolveStaff(row = {}) {
  const ids = [row.assignedStaff, row.assignedStaff?._id, row.assignedStaff?.id].map(stableId).filter(Boolean);
  const email = String(row.assignedStaffEmail || row.assignedStaff?.email || '').trim().toLowerCase();
  const conditions = [];
  ids.forEach((id) => {
    conditions.push({ crmUserId: id });
    if (mongoose.isValidObjectId(id)) conditions.push({ _id: id });
  });
  if (email) conditions.push({ email });
  return conditions.length ? User.findOne({ $or: conditions, isActive: { $ne: false } }).select('_id name email').lean() : null;
}

function assignmentEmailHtml({ company, managerName, dueAt }) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f1f5f9" style="width:100%;border-collapse:collapse;background-color:#f1f5f9">
    <tr><td align="center" style="padding:32px 12px">
      <table role="presentation" width="620" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:620px;border-collapse:separate;background-color:#ffffff;border:1px solid #dbe5e1;border-radius:16px">
        <tr><td bgcolor="#0f766e" style="padding:28px 32px;background-color:#0f766e;border-radius:15px 15px 0 0">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:1.5px;color:#ccfbf1;text-transform:uppercase">CRM · Client Onboarding</div>
          <div style="margin-top:8px;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:34px;font-weight:700;color:#ffffff">A new client is assigned to you</div>
        </td></tr>
        <tr><td style="padding:30px 32px;font-family:Arial,Helvetica,sans-serif;color:#334155">
          <p style="margin:0 0 20px;font-size:16px;line-height:26px;color:#334155"><strong style="color:#0f172a">${escapeHtml(company)}</strong> has been assigned to you by <strong style="color:#0f172a">${escapeHtml(managerName)}</strong>.</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:24px;color:#475569">Please process the client onboarding in CRM and complete all required client details.</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ecfdf5" style="width:100%;border-collapse:separate;background-color:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px">
            <tr><td style="padding:18px 20px">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#047857">Completion deadline</div>
              <div style="margin-top:6px;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;color:#064e3b">${escapeHtml(new Date(dueAt).toLocaleString('en-IN'))}</div>
              <div style="margin-top:5px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#047857">7 days from assignment</div>
            </td></tr>
          </table>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#fff7ed" style="width:100%;margin-top:18px;border-collapse:separate;background-color:#fff7ed;border-left:4px solid #f97316;border-radius:10px">
            <tr><td style="padding:16px 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#9a3412"><strong>Important:</strong> If onboarding remains incomplete after 7 days, you will receive 2 reminders with a 48-hour gap. If it is still incomplete after both reminders, the assignment will be marked as a red flag.</td></tr>
          </table>
        </td></tr>
        <tr><td bgcolor="#f8fafc" style="padding:17px 32px;background-color:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 15px 15px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#64748b">This is an automated CRM workflow notification. Please complete the task within the stated timeline.</td></tr>
      </table>
    </td></tr>
  </table>`;
}

async function registerStaffOnboardingAssignments({ lead, manager, now = new Date() }) {
  const leadKey = String(lead?._id || lead?.id || lead?.sourceLeadId || lead?.externalLeadId || '').trim();
  if (!leadKey) return { registered: 0 };
  const assignments = Array.isArray(lead.assignments) ? lead.assignments : [];
  let registered = 0;

  for (let rowIndex = 0; rowIndex < assignments.length; rowIndex += 1) {
    const row = assignments[rowIndex];
    if (!row?.assignedStaff) continue;
    const staff = await resolveStaff(row);
    if (!staff) continue;
    const existing = await StaffOnboardingAssignment.findOne({ leadKey, rowIndex }).lean();
    const reassigned = !existing || String(existing.staffId) !== String(staff._id);
    const assignedAt = reassigned ? now : existing.assignedAt;
    const dueAt = reassigned ? new Date(now.getTime() + ONBOARDING_LIMIT_MS) : existing.dueAt;
    const record = await StaffOnboardingAssignment.findOneAndUpdate(
      { leadKey, rowIndex },
      {
        $set: {
          leadCode: lead.leadCode || lead.leadNumber || '',
          company: lead.company || lead.companyName || 'Client',
          staffId: staff._id,
          staffName: staff.name || staff.email,
          staffEmail: staff.email || '',
          managerId: manager?._id || manager?.id,
          managerName: manager?.name || manager?.email || 'Manager',
          managerEmail: manager?.email || '',
          assignedAt,
          dueAt,
          nextActionAt: reassigned ? dueAt : existing.nextActionAt,
          ...(reassigned ? { reminderCount: 0, status: 'ACTIVE' } : {})
        },
        ...(reassigned ? { $unset: { lastReminderAt: 1, completedAt: 1, redFlaggedAt: 1, assignmentEmailSentAt: 1, emailError: 1 } } : {})
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    if (!reassigned) continue;
    registered += 1;
    try {
      await sendMail(
        staff.email,
        `${record.company} is assigned to you for client onboarding`,
        assignmentEmailHtml({ company: record.company, managerName: record.managerName, dueAt: record.dueAt })
      );
      record.assignmentEmailSentAt = new Date();
      record.emailError = undefined;
    } catch (error) {
      record.emailError = error.message;
    }
    await record.save();
    await Notification.create({
      title: 'Client onboarding assigned',
      description: `${record.company} is assigned to you by ${record.managerName}. Complete onboarding within 7 days.`,
      tag: 'Client Onboarding',
      kind: 'staff_client_onboarding_assigned',
      createdBy: manager?._id,
      createdByName: record.managerName,
      audience: [staff._id],
      metadata: { leadKey, rowIndex, company: record.company, dueAt: record.dueAt }
    });
  }
  return { registered };
}

async function assignmentReviewState(record) {
  if (!mongoose.isValidObjectId(record.leadKey)) return null;
  const lead = await Lead.findById(record.leadKey).select('assignments.assignedServiceId assignments.serviceAssignmentId serviceSelections.assignedServiceId serviceSelections.serviceAssignmentId').lean();
  const selected = serviceId(lead?.assignments?.[record.rowIndex]) || serviceId(lead?.serviceSelections?.[record.rowIndex]);
  const clients = await Client.find({ selectedLead: record.leadKey }).select('_id assignedServiceId data.selectedLeadSnapshot.assignedServiceId adminControls.approvalStatus').lean();
  const relevant = clients.filter(client => selected ? serviceId(client) === selected : lead?.assignments?.length === 1 && clients.length === 1);
  if (!relevant.length) return null;
  if (relevant.every(client => client.adminControls?.approvalStatus === 'APPROVED')) return 'APPROVED';
  const pending = await PendingApproval.exists({ type: 'client', sourceClientId: { $in: relevant.map(client => String(client._id)) }, approvalStatus: 'PENDING' });
  return pending ? 'PENDING' : null;
}

async function onboardingCompleted(record) {
  return ClientOnboardingReminder.exists({
    sourceLeadId: record.leadKey,
    ownerId: record.staffId,
    completed: true
  });
}

async function readCpcbPortalRegistration(record) {
  if (!mongoose.isValidObjectId(record.leadKey)) return undefined;
  const client = await Client.findOne({
    selectedLead: record.leadKey,
    createdBy: record.staffId,
    'data.cpcbOnboarding.cpcbPortalRegistered': { $type: 'bool' }
  }).select('data.cpcbOnboarding.cpcbPortalRegistered').sort({ updatedAt: -1 }).lean();
  return client?.data?.cpcbOnboarding?.cpcbPortalRegistered;
}

async function syncStaffOnboardingCpcbStatus({ leadKey, staffId, registered, now = new Date() }) {
  if (!leadKey || !staffId || typeof registered !== 'boolean') return { modifiedCount: 0 };
  if (!registered) {
    return StaffOnboardingAssignment.updateMany(
      { leadKey: String(leadKey), staffId, status: { $in: ['ACTIVE', 'RED_FLAG'] } },
      {
        $set: { status: 'CPCB_NOT_REGISTERED' },
        $unset: { lastReminderAt: 1, redFlaggedAt: 1, emailError: 1 }
      }
    );
  }
  const dueAt = new Date(now.getTime() + ONBOARDING_LIMIT_MS);
  return StaffOnboardingAssignment.updateMany(
    { leadKey: String(leadKey), staffId, status: 'CPCB_NOT_REGISTERED' },
    {
      $set: { status: 'ACTIVE', reminderCount: 0, dueAt, nextActionAt: dueAt },
      $unset: { lastReminderAt: 1, redFlaggedAt: 1, completedAt: 1, emailError: 1 }
    }
  );
}

async function sendWorkflowEmail(record, stage) {
  const current = await StaffOnboardingAssignment.findById(record._id).select('status').lean();
  if (current?.status !== 'ACTIVE' || await assignmentReviewState(record)) return false;
  const redFlag = stage === 'RED_FLAG';
  const subject = redFlag
    ? `RED FLAG: ${record.company} client onboarding is incomplete`
    : `Reminder ${record.reminderCount + 1}/2: Complete ${record.company} client onboarding`;
  const message = redFlag
    ? `Client onboarding is still incomplete after the 7-day deadline and two reminders. This assignment is now marked as a red flag.`
    : `The 7-day client onboarding deadline has passed. Please complete all client details in CRM. This is reminder ${record.reminderCount + 1} of 2.`;
  const recipients = redFlag
    ? [...new Set([record.staffEmail, record.managerEmail].filter(Boolean))]
    : [record.staffEmail].filter(Boolean);
  if (recipients.length) {
    await sendMail(recipients, subject, `<div style="font-family:Arial,sans-serif;color:#334155"><h2 style="color:${redFlag ? '#dc2626' : '#0f766e'}">${redFlag ? 'Client Onboarding Red Flag' : 'Client Onboarding Reminder'}</h2><p><strong>Company:</strong> ${escapeHtml(record.company)}</p><p>${escapeHtml(message)}</p></div>`);
  }
  await Notification.create({
    title: redFlag ? 'Client onboarding red flag' : `Client onboarding reminder ${record.reminderCount + 1}/2`,
    description: `${record.company}: ${message}`,
    tag: redFlag ? 'Red Flag' : 'Client Onboarding',
    kind: redFlag ? 'staff_client_onboarding_red_flag' : 'staff_client_onboarding_reminder',
    createdByName: 'CRM Reminder',
    audience: [record.staffId, ...(redFlag && record.managerId ? [record.managerId] : [])],
    metadata: { leadKey: record.leadKey, rowIndex: record.rowIndex, company: record.company }
  });
  return true;
}

async function runStaffOnboardingWorkflow(now = new Date()) {
  const due = await StaffOnboardingAssignment.find({ status: { $in: ['ACTIVE', 'RED_FLAG', 'PENDING_COMPLIANCE'] }, nextActionAt: { $lte: now } });
  let completed = 0; let reminded = 0; let redFlagged = 0;
  for (const record of due) {
    const reviewState = await assignmentReviewState(record);
    if (reviewState === 'APPROVED') {
      await StaffOnboardingAssignment.updateOne({ _id: record._id }, { $set: { status: 'COMPLETED', completedAt: now }, $unset: { redFlaggedAt: 1, pausedAt: 1, pausedRemainingMs: 1, pausedFromStatus: 1, emailError: 1 } });
      completed += 1;
      continue;
    }
    if (reviewState === 'PENDING') {
      if (record.status !== 'PENDING_COMPLIANCE') {
        await StaffOnboardingAssignment.updateOne({ _id: record._id, status: record.status }, { $set: { status: 'PENDING_COMPLIANCE', pausedAt: now, pausedFromStatus: record.status, pausedRemainingMs: Math.max(0, new Date(record.nextActionAt).getTime() - now.getTime()) } });
      }
      continue;
    }
    if (record.status !== 'ACTIVE') continue;
    if (await readCpcbPortalRegistration(record) === false) {
      record.status = 'CPCB_NOT_REGISTERED';
      record.lastReminderAt = undefined;
      record.redFlaggedAt = undefined;
      await record.save();
      continue;
    }
    if (await onboardingCompleted(record)) {
      record.status = 'COMPLETED';
      record.completedAt = now;
      await record.save();
      completed += 1;
      continue;
    }
    if (record.reminderCount < 2) {
      const sent = await sendWorkflowEmail(record, 'REMINDER').catch((error) => { record.emailError = error.message; });
      if (sent === false) continue;
      record.reminderCount += 1;
      record.lastReminderAt = now;
      record.nextActionAt = new Date(now.getTime() + REMINDER_GAP_MS);
      await record.save();
      reminded += 1;
      continue;
    }
    const sent = await sendWorkflowEmail(record, 'RED_FLAG').catch((error) => { record.emailError = error.message; });
    if (sent === false) continue;
    record.status = 'RED_FLAG';
    record.redFlaggedAt = now;
    await record.save();
    redFlagged += 1;
  }
  return { processed: due.length, completed, reminded, redFlagged };
}

let started = false;
function startStaffOnboardingWorkflowScheduler() {
  if (started || process.env.STAFF_ONBOARDING_REMINDERS_ENABLED === 'false') return;
  started = true;
  const run = () => runStaffOnboardingWorkflow().catch((error) => console.error('Staff onboarding workflow failed', error));
  setTimeout(run, 7000);
  setInterval(run, 60 * 60 * 1000);
}

module.exports = {
  assignmentReviewState,
  ONBOARDING_LIMIT_MS,
  REMINDER_GAP_MS,
  assignmentEmailHtml,
  readCpcbPortalRegistration,
  registerStaffOnboardingAssignments,
  runStaffOnboardingWorkflow,
  syncStaffOnboardingCpcbStatus,
  startStaffOnboardingWorkflowScheduler
};
