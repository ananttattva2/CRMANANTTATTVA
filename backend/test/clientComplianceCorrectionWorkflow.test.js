const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const PendingApproval = require('../src/models/PendingApproval');
const { correctionEmail } = require('../src/services/clientComplianceCorrectionReminders');
const { buildClientApprovalDecisionEmail } = require('../src/services/clientApprovalDecisionNotifications');
const { CLIENT_CORRECTION_DEADLINE_POLICY, addClientCorrectionHours, isFirstOrThirdSaturdayInIst } = require('../src/utils/clientCorrectionDeadline');

test('pending approval persists the 24-hour, 48-hour and permanent-red correction state', () => {
  const reminderFlag = PendingApproval.schema.path('reminderFlag');
  assert.ok(reminderFlag.enumValues.includes('PERMANENT_RED'));
  assert.ok(PendingApproval.schema.path('correctionReminderAt'));
  assert.ok(PendingApproval.schema.path('correctionDueAt'));
  assert.ok(PendingApproval.schema.path('correctionBreachedAt'));
  assert.ok(PendingApproval.schema.path('redRecoveryStartedAt'));
  assert.ok(PendingApproval.schema.path('redRecoveryEmailSentAt'));
  assert.ok(PendingApproval.schema.path('redRecoveryEmailNextAttemptAt'));
  assert.ok(PendingApproval.schema.path('correctionRecipientEmail'));
  assert.ok(PendingApproval.schema.path('correctionDeadlinePolicy'));
});

test('Client Master correction time excludes first and third Saturdays in IST', () => {
  assert.equal(CLIENT_CORRECTION_DEADLINE_POLICY, 'skip_first_third_saturday_96h_v2');
  assert.equal(isFirstOrThirdSaturdayInIst('2026-10-03T06:30:00.000Z'), true);
  assert.equal(isFirstOrThirdSaturdayInIst('2026-10-10T06:30:00.000Z'), false);
  assert.equal(isFirstOrThirdSaturdayInIst('2026-10-17T06:30:00.000Z'), true);
  // Friday noon IST + 48 counted hours would be Sunday noon; excluding the
  // first Saturday moves it to Monday noon and adds exactly 24 calendar hours.
  assert.equal(addClientCorrectionHours('2026-10-02T06:30:00.000Z', 48).toISOString(), '2026-10-05T06:30:00.000Z');
  // The second Saturday remains a normal counted day.
  assert.equal(addClientCorrectionHours('2026-10-09T06:30:00.000Z', 48).toISOString(), '2026-10-11T06:30:00.000Z');
  assert.equal(addClientCorrectionHours('2026-10-16T06:30:00.000Z', 48).toISOString(), '2026-10-19T06:30:00.000Z');
  // Permanent red is now applied after 96 counted hours. Crossing a first
  // Saturday adds another calendar day without consuming those 96 hours.
  assert.equal(addClientCorrectionHours('2026-10-02T06:30:00.000Z', 96).toISOString(), '2026-10-07T06:30:00.000Z');
});

test('partial and rejected decision emails explain the 48-hour SLA and 48-hour recovery window', () => {
  for (const approvalMode of ['PARTIAL', 'REJECTED']) {
    const email = buildClientApprovalDecisionEmail({
      clientName: 'Example Client',
      status: 'REJECTED',
      approvalMode,
      recipientName: 'Client Manager'
    });
    assert.match(email.html, /within 48 working hours/i);
    assert.match(email.html, /reminder.*24 working hours/i);
    assert.match(email.html, /final 48-working-hour recovery window/i);
    assert.match(email.html, /after 96 working hours/i);
    assert.match(email.html, /First and third Saturdays.*do not count/i);
  }
});

test('scheduled correction emails distinguish reminder, recoverable red and permanent red', () => {
  const record = {
    clientName: 'Example Client',
    correctionRecipientName: 'Client Manager',
    correctionDecision: 'PARTIALLY_APPROVED',
    correctionDueAt: new Date('2026-09-06T10:00:00.000Z'),
    greenFlagDeadline: new Date('2026-09-07T10:00:00.000Z')
  };
  const reminder = correctionEmail(record, 'REMINDER');
  const recoverable = correctionEmail(record, 'RED_RECOVERY');
  const permanent = correctionEmail(record, 'PERMANENT');
  assert.match(reminder.subject, /24-Hour Correction Reminder/);
  assert.match(reminder.html, /24 hours remain/i);
  assert.match(recoverable.subject, /Final 48-Hour Recovery/i);
  assert.match(recoverable.html, /return the flag to green/i);
  assert.match(recoverable.html, /07-09-2026/);
  assert.match(permanent.subject, /Permanent Red Flag Applied/);
  assert.match(permanent.html, /recovery window has expired/i);
});

test('compliance correction workflow uses Saturday-aware deadlines and permits timely red-to-green approval', () => {
  const controller = fs.readFileSync(path.resolve(__dirname, '../src/controllers/clientComplianceReviewController.js'), 'utf8');
  const clientController = fs.readFileSync(path.resolve(__dirname, '../src/controllers/clientController.js'), 'utf8');
  const scheduler = fs.readFileSync(path.resolve(__dirname, '../src/services/clientComplianceCorrectionReminders.js'), 'utf8');
  assert.match(controller, /greenFlagDeadline: addClientCorrectionHours\(decidedAt, 96\)/);
  assert.match(controller, /correctionDueAt: addClientCorrectionHours\(decidedAt, 48\)/);
  assert.match(controller, /correctionDeadlinePolicy: CLIENT_CORRECTION_DEADLINE_POLICY/);
  assert.match(controller, /reminderFlag: permanentRed \? 'PERMANENT_RED' : 'GREEN'/);
  assert.match(controller, /reminderFlag: permanentRed \? 'PERMANENT_RED' : 'RED'/);
  assert.match(scheduler, /reminderFlag: 'RED'/);
  assert.match(scheduler, /legacyRecoveryGrants/);
  assert.match(scheduler, /redRecoveryStartedAt: null/);
  assert.match(scheduler, /reminderFlag: \{ \$in: \['RED', 'PERMANENT_RED'\] \}/);
  assert.match(scheduler, /redRecoveryEmailSentAt: null/);
  assert.match(scheduler, /redRecoveryEmailNextAttemptAt: nextAttemptAt/);
  assert.match(scheduler, /greenFlagDeadline: \{ \$lte: now \}/);
  assert.match(scheduler, /reminderFlag: 'PERMANENT_RED'/);
  assert.match(scheduler, /correctionDeadlinePolicy: \{ \$ne: CLIENT_CORRECTION_DEADLINE_POLICY \}/);
  assert.match(scheduler, /correctionWasSupersededByClientActivity/);
  assert.match(scheduler, /updatedAt <= startedAt/);
  assert.match(clientController, /status: 'CORRECTED'/);
});

test('server startup runs the legacy red recovery scan so deployed records receive email', () => {
  const server = fs.readFileSync(path.resolve(__dirname, '../src/index.js'), 'utf8');
  assert.match(server, /await runClientComplianceCorrectionReminders\(\)/);
  assert.match(server, /client-compliance-correction-reminders/);
});
