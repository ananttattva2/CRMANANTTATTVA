const { clientAssignmentFilter } = require('./onboardingAssignmentIdentity');
const mongoose = require('mongoose');
const Client = require('../models/Client');
const ClientOnboardingReminder = require('../models/ClientOnboardingReminder');
const PendingApproval = require('../models/PendingApproval');
const StaffOnboardingAssignment = require('../models/StaffOnboardingAssignment');

const ACTIVE_REVIEW_STATES = new Set(['REJECTED', 'PARTIALLY_APPROVED', 'CHANGES_REQUIRED']);

function id(value) {
  return String(value?._id || value?.id || value || '').trim();
}

function clientIdentity(client = {}) {
  return {
    clientKey: id(client),
    leadKey: id(client.selectedLead || client.data?.selectedLead || client.data?.selectedLeadSnapshot?.id),
    ownerId: id(client.createdBy || client.submittedBy)
  };
}

async function pauseReminder(reminder, now) {
  if (!reminder || reminder.reviewStatus === 'PENDING_COMPLIANCE') return;
  reminder.reviewStatus = 'PENDING_COMPLIANCE';
  reminder.reviewPausedAt = now;
  await reminder.save();
}

async function resumeReminder(reminder, now) {
  if (!reminder) return;
  const pausedAt = reminder.reviewPausedAt ? new Date(reminder.reviewPausedAt) : null;
  if (pausedAt && !Number.isNaN(pausedAt.getTime())) {
    const pausedMs = Math.max(0, now.getTime() - pausedAt.getTime());
    reminder.firstBasicInfoAt = new Date(new Date(reminder.firstBasicInfoAt).getTime() + pausedMs);
  }
  reminder.reviewStatus = 'ACTIVE';
  reminder.reviewPausedAt = undefined;
  reminder.completed = false;
  await reminder.save();
}

async function pauseAssignment(record, now) {
  if (!record || record.status === 'PENDING_COMPLIANCE' || record.status === 'COMPLETED') return;
  record.pausedFromStatus = record.status;
  record.pausedAt = now;
  record.pausedRemainingMs = record.status === 'ACTIVE'
    ? Math.max(0, new Date(record.nextActionAt).getTime() - now.getTime())
    : 0;
  record.status = 'PENDING_COMPLIANCE';
  await record.save();
}

async function resumeAssignment(record, now) {
  if (!record || record.status !== 'PENDING_COMPLIANCE') return;
  const previousStatus = record.pausedFromStatus || 'ACTIVE';
  record.status = previousStatus === 'RED_FLAG' ? 'RED_FLAG' : 'ACTIVE';
  if (record.status === 'ACTIVE') {
    record.nextActionAt = new Date(now.getTime() + Math.max(0, Number(record.pausedRemainingMs) || 0));
  }
  record.pausedAt = undefined;
  record.pausedRemainingMs = undefined;
  record.pausedFromStatus = undefined;
  await record.save();
}

async function syncClientReviewReminderState({ client, status, now = new Date() }) {
  const normalized = String(status || '').trim().toUpperCase();
  const identity = clientIdentity(client);
  if (!identity.clientKey) return { reminders: 0, assignments: 0 };

  const reminder = await ClientOnboardingReminder.findOne({ clientKey: identity.clientKey });
  const assignmentFilter = await clientAssignmentFilter(client, identity);
  const assignments = assignmentFilter ? await StaffOnboardingAssignment.find(assignmentFilter) : [];

  if (normalized === 'PENDING') {
    await PendingApproval.updateMany(
      { type: 'client', sourceClientId: identity.clientKey, approvalStatus: 'PENDING' },
      { $set: { nextReminderAt: null, reminderFlag: 'GREEN', greenFlagAt: now }, $unset: { redFlagAt: 1, greenFlagDeadline: 1, reminderError: 1 } }
    );
    await pauseReminder(reminder, now);
    await Promise.all(assignments.map((record) => pauseAssignment(record, now)));
  } else if (normalized === 'APPROVED') {
    if (reminder) {
      reminder.reviewStatus = 'APPROVED';
      reminder.reviewPausedAt = undefined;
      reminder.completed = true;
      await reminder.save();
    }
    await Promise.all(assignments.map(async (record) => {
      record.status = 'COMPLETED';
      record.completedAt = now;
      record.redFlaggedAt = undefined;
      record.emailError = undefined;
      record.pausedAt = undefined;
      record.pausedRemainingMs = undefined;
      record.pausedFromStatus = undefined;
      await record.save();
    }));
  } else if (ACTIVE_REVIEW_STATES.has(normalized)) {
    await resumeReminder(reminder, now);
    await Promise.all(assignments.map((record) => resumeAssignment(record, now)));
  }

  return { reminders: reminder ? 1 : 0, assignments: assignments.length };
}

async function pauseExistingPendingClientApprovalTimers(now = new Date()) {
  const pending = await PendingApproval.find({ type: 'client', approvalStatus: 'PENDING' }).select('sourceClientId').lean();
  const clientIds = [...new Set(pending.map((row) => id(row.sourceClientId)).filter((value) => mongoose.isValidObjectId(value)))];
  const result = await PendingApproval.updateMany(
    { type: 'client', approvalStatus: 'PENDING' },
    { $set: { nextReminderAt: null, reminderFlag: 'GREEN', greenFlagAt: now }, $unset: { redFlagAt: 1, greenFlagDeadline: 1, reminderError: 1 } }
  );
  if (!clientIds.length) return Number(result.modifiedCount || 0);
  await ClientOnboardingReminder.updateMany(
    { clientKey: { $in: clientIds }, reviewStatus: { $nin: ['PENDING_COMPLIANCE', 'APPROVED'] } },
    { $set: { reviewStatus: 'PENDING_COMPLIANCE', reviewPausedAt: now } }
  );
  const clients = await Client.find({ _id: { $in: clientIds } }).select('_id selectedLead assignedServiceId data.selectedLeadSnapshot.assignedServiceId createdBy submittedBy').lean();
  const assignmentFilters = (await Promise.all(clients.map(client => clientAssignmentFilter(client, clientIdentity(client))))).filter(Boolean);
  if (assignmentFilters.length) {
    const assignments = await StaffOnboardingAssignment.find({
      status: { $in: ['ACTIVE', 'RED_FLAG'] }, $or: assignmentFilters
    });
    await Promise.all(assignments.map((record) => pauseAssignment(record, now)));
  }

  return Number(result.modifiedCount || 0);
}

module.exports = { clientIdentity, pauseExistingPendingClientApprovalTimers, syncClientReviewReminderState };
