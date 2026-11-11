const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DAY_MS,
  REJECTION_REMINDER_MS,
  managerReminderDueStage,
  managerAssignmentStartAt,
  rejectionReminderDue,
  poReminderEmail
} = require('../src/services/purchaseOrderWorkflowReminders');
const { managerAssignmentTimestamp } = require('../src/utils/poWorkflow');

const start = new Date('2026-10-01T09:00:00.000Z');
const after = (milliseconds) => new Date(start.getTime() + milliseconds);

test('rejected PO reminder becomes due once 48 hours have elapsed', () => {
  assert.equal(rejectionReminderDue({ rejectedAt: start, now: after(REJECTION_REMINDER_MS - 1) }), false);
  assert.equal(rejectionReminderDue({ rejectedAt: start, now: after(REJECTION_REMINDER_MS) }), true);
  assert.equal(rejectionReminderDue({
    rejectedAt: start,
    reminderState: { rejected48h: { sentAt: after(REJECTION_REMINDER_MS) } },
    now: after(REJECTION_REMINDER_MS + DAY_MS)
  }), false);
});

test('manager receives a reminder at 24 hours and an escalation at 48 hours', () => {
  const assignment = { approvalAt: start, managerAssignedAt: start };
  assert.equal(managerReminderDueStage({ ...assignment, now: after(DAY_MS - 1) }), '');
  assert.equal(managerReminderDueStage({ ...assignment, now: after(DAY_MS) }), 'manager24h');
  assert.equal(managerReminderDueStage({
    ...assignment,
    reminderState: { manager24h: { sentAt: after(DAY_MS) } },
    now: after(2 * DAY_MS - 1)
  }), '');
  assert.equal(managerReminderDueStage({
    ...assignment,
    reminderState: { manager24h: { sentAt: after(DAY_MS) } },
    now: after(2 * DAY_MS)
  }), 'manager48h');
  assert.equal(managerReminderDueStage({ ...assignment, hasStaff: true, now: after(2 * DAY_MS) }), '');
});

test('manager assignment timer starts from whichever happened later: PO approval or manager assignment', () => {
  assert.equal(managerReminderDueStage({
    approvalAt: start,
    managerAssignedAt: after(DAY_MS),
    now: after(2 * DAY_MS - 1)
  }), '');
  assert.equal(managerReminderDueStage({
    approvalAt: start,
    managerAssignedAt: after(DAY_MS),
    now: after(2 * DAY_MS)
  }), 'manager24h');
});

test('legacy reminders use the manager assignment date instead of an older PO closure date', () => {
  const approvalAt = new Date(start.getTime() - 15 * DAY_MS);
  const assignment = { closedAt: approvalAt };
  const lead = { updatedAt: start };
  const assignedStart = managerAssignmentStartAt(approvalAt, assignment, lead);

  assert.equal(assignedStart.getTime(), start.getTime());
  assert.equal(managerReminderDueStage({
    approvalAt,
    managerAssignedAt: assignedStart,
    now: after(DAY_MS)
  }), 'manager24h');

  const email = poReminderEmail({
    stage: 'manager48h',
    approval: { actionAt: approvalAt, payload: {} },
    assignment,
    lead,
    now: after(2 * DAY_MS)
  });
  assert.match(email.html, /2d 0h 0m/);
  assert.doesNotMatch(email.html, /15d/);
});

test('manager assignment timestamps are server-generated and survive unchanged assignments', () => {
  const now = new Date('2026-10-10T12:30:00.000Z');
  assert.equal(managerAssignmentTimestamp({}, { assignedTo: 'manager-1', managerAssignedAt: 'forged' }, now), now.toISOString());
  assert.equal(managerAssignmentTimestamp({
    assignedTo: { _id: 'manager-1' },
    managerAssignedAt: '2026-10-09T12:30:00.000Z'
  }, { assignedTo: 'manager-1' }, now), '2026-10-09T12:30:00.000Z');
  assert.equal(managerAssignmentTimestamp({ assignedTo: 'manager-1' }, { assignedTo: '' }, now), '');
});

test('PO reminder email clearly shows SLA details and escapes record data', () => {
  const email = poReminderEmail({
    stage: 'manager48h',
    approval: {
      actionAt: start,
      clientName: '<Company>',
      uniqueId: 'LEAD-10',
      eprCategory: 'Plastic',
      payload: { poYearRows: [{ poNumber: 'PO-42' }] }
    },
    lead: { company: '<Company>', leadCode: 'LEAD-10' },
    assignment: {
      assignedToText: 'Manager',
      managerAssignedAt: start,
      closedAt: start,
      poYearRows: [{ poNumber: 'PO-42' }]
    },
    managerName: 'Manager',
    now: after(2 * DAY_MS)
  });

  assert.match(email.subject, /Escalation/);
  assert.match(email.html, /PO CLOSED ON/);
  assert.match(email.html, /TIME ELAPSED/);
  assert.match(email.html, /PO-42/);
  assert.match(email.html, /&lt;Company&gt;/);
  assert.match(email.html, /Open Lead Assignment/);
});
