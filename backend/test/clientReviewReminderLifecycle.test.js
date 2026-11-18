const test = require('node:test');
const assert = require('node:assert/strict');
const Client = require('../src/models/Client');
const ClientOnboardingReminder = require('../src/models/ClientOnboardingReminder');
const PendingApproval = require('../src/models/PendingApproval');
const StaffOnboardingAssignment = require('../src/models/StaffOnboardingAssignment');
const { pauseExistingPendingClientApprovalTimers, syncClientReviewReminderState } = require('../src/services/clientReviewReminderLifecycle');

test('client review pauses timers, resumes remaining time, then completes on approval', async (t) => {
  const originals = {
    findOne: ClientOnboardingReminder.findOne,
    updateMany: PendingApproval.updateMany,
    find: StaffOnboardingAssignment.find
  };
  t.after(() => {
    ClientOnboardingReminder.findOne = originals.findOne;
    PendingApproval.updateMany = originals.updateMany;
    StaffOnboardingAssignment.find = originals.find;
  });

  const reminder = {
    firstBasicInfoAt: new Date('2026-09-01T00:00:00Z'), completed: false,
    async save() { this.saved = (this.saved || 0) + 1; }
  };
  const assignment = {
    status: 'ACTIVE', nextActionAt: new Date('2026-09-10T12:00:00Z'), reminderCount: 2,
    async save() { this.saved = (this.saved || 0) + 1; }
  };
  const pendingUpdates = [];
  ClientOnboardingReminder.findOne = async () => reminder;
  StaffOnboardingAssignment.find = async () => [assignment];
  PendingApproval.updateMany = async (...args) => { pendingUpdates.push(args); return { modifiedCount: 1 }; };

  const client = { _id: 'client-1', selectedLead: 'lead-1', createdBy: 'user-1' };
  await syncClientReviewReminderState({ client, status: 'PENDING', now: new Date('2026-09-10T10:00:00Z') });
  assert.equal(reminder.reviewStatus, 'PENDING_COMPLIANCE');
  assert.equal(assignment.status, 'PENDING_COMPLIANCE');
  assert.equal(assignment.pausedRemainingMs, 2 * 60 * 60 * 1000);
  assert.equal(assignment.reminderCount, 2, 'reminder progress must be preserved');
  assert.equal(pendingUpdates.length, 1);
  assert.equal(pendingUpdates[0][1].$set.nextReminderAt, null);

  await syncClientReviewReminderState({ client, status: 'PARTIALLY_APPROVED', now: new Date('2026-09-12T10:00:00Z') });
  assert.equal(reminder.reviewStatus, 'ACTIVE');
  assert.equal(reminder.firstBasicInfoAt.toISOString(), '2026-09-03T00:00:00.000Z');
  assert.equal(assignment.status, 'ACTIVE');
  assert.equal(assignment.nextActionAt.toISOString(), '2026-09-12T12:00:00.000Z');
  assert.equal(assignment.reminderCount, 2);

  await syncClientReviewReminderState({ client, status: 'CORRECTED', now: new Date('2026-09-12T11:00:00Z') });
  assert.equal(reminder.reviewStatus, 'PENDING_COMPLIANCE');
  assert.equal(assignment.status, 'PENDING_COMPLIANCE');
  assert.deepEqual(pendingUpdates[1][0].$or, [
    { approvalStatus: { $in: ['PARTIALLY_APPROVED', 'REJECTED', 'REVISION_REQUIRED'] } },
    { correctionStatus: { $in: ['OPEN', 'BREACHED'] } }
  ]);
  assert.equal(pendingUpdates[1][1].$set.reminderFlag, 'GREEN');
  assert.equal(pendingUpdates[1][1].$set.correctionStatus, 'NONE');

  await syncClientReviewReminderState({ client, status: 'APPROVED', now: new Date('2026-09-13T10:00:00Z') });
  assert.equal(reminder.reviewStatus, 'APPROVED');
  assert.equal(reminder.completed, true);
  assert.equal(assignment.status, 'COMPLETED');
  assert.equal(assignment.completedAt.toISOString(), '2026-09-13T10:00:00.000Z');
});

test('startup reconciliation pauses legacy pending-client reminders idempotently', async (t) => {
  const clientId = '66f000000000000000000001';
  const leadId = '66f000000000000000000002';
  const userId = '66f000000000000000000003';
  const assignment = { status: 'RED_FLAG', nextActionAt: new Date(), async save() { this.saved = true; } };
  const originals = {
    pendingFind: PendingApproval.find, pendingUpdateMany: PendingApproval.updateMany,
    reminderUpdateMany: ClientOnboardingReminder.updateMany, clientFind: Client.find,
    assignmentFind: StaffOnboardingAssignment.find
  };
  t.after(() => {
    PendingApproval.find = originals.pendingFind; PendingApproval.updateMany = originals.pendingUpdateMany;
    ClientOnboardingReminder.updateMany = originals.reminderUpdateMany; Client.find = originals.clientFind;
    StaffOnboardingAssignment.find = originals.assignmentFind;
  });
  const query = (value) => ({ select() { return this; }, async lean() { return value; } });
  PendingApproval.find = () => query([{ sourceClientId: clientId }]);
  PendingApproval.updateMany = async () => ({ modifiedCount: 1 });
  ClientOnboardingReminder.updateMany = async () => ({ modifiedCount: 1 });
  Client.find = () => query([{ _id: clientId, selectedLead: leadId, createdBy: userId }]);
  StaffOnboardingAssignment.find = async () => [assignment];

  const changed = await pauseExistingPendingClientApprovalTimers(new Date('2026-09-30T10:00:00Z'));
  assert.equal(changed, 1);
  assert.equal(assignment.status, 'PENDING_COMPLIANCE');
  assert.equal(assignment.pausedFromStatus, 'RED_FLAG');
  assert.equal(assignment.saved, true);
});

test('correction activity clears an existing onboarding red flag instead of preserving it', async (t) => {
  const originals = {
    findOne: ClientOnboardingReminder.findOne,
    updateMany: PendingApproval.updateMany,
    find: StaffOnboardingAssignment.find
  };
  t.after(() => {
    ClientOnboardingReminder.findOne = originals.findOne;
    PendingApproval.updateMany = originals.updateMany;
    StaffOnboardingAssignment.find = originals.find;
  });
  const assignment = {
    status: 'RED_FLAG', redFlaggedAt: new Date('2026-09-01T00:00:00Z'), emailError: 'old error',
    async save() { this.saved = true; }
  };
  ClientOnboardingReminder.findOne = async () => null;
  PendingApproval.updateMany = async () => ({ modifiedCount: 1 });
  StaffOnboardingAssignment.find = async () => [assignment];

  await syncClientReviewReminderState({
    client: { _id: 'client-1', selectedLead: 'lead-1', createdBy: 'user-1' },
    status: 'CORRECTED',
    now: new Date('2026-09-10T10:00:00Z')
  });
  assert.equal(assignment.status, 'PENDING_COMPLIANCE');
  assert.equal(assignment.pausedFromStatus, 'ACTIVE');
  assert.equal(assignment.pausedRemainingMs, 7 * 24 * 60 * 60 * 1000);
  assert.equal(assignment.redFlaggedAt, undefined);
  assert.equal(assignment.emailError, undefined);
  assert.equal(assignment.saved, true);
});
