const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../src/models/User');
const Notification = require('../src/models/Notification');
const mailer = require('../src/utils/mailer');

const q = (value) => ({
  select() { return this; },
  async lean() { return structuredClone(value); }
});

test('AR Manager approval alerts Compliance and rejection alerts the submitting user', async (t) => {
  const compliance = { _id: '64b000000000000000000010', name: 'Compliance User', email: 'compliance@example.test', role: 'operation', roles: ['operation', 'compliance'], isActive: true };
  const submitter = { _id: '64b000000000000000000011', name: 'Data User', email: 'user@example.test', role: 'operation', roles: ['operation'], isActive: true };
  const notifications = [];
  const emails = [];
  t.mock.method(User, 'find', (filter) => q(filter?._id ? [submitter] : [compliance, submitter]));
  t.mock.method(Notification, 'create', async (payload) => {
    notifications.push(payload);
    return { _id: `notification-${notifications.length}`, ...payload };
  });
  t.mock.method(mailer, 'sendMail', async (...args) => {
    emails.push(args);
    return { accepted: [args[0]] };
  });
  delete require.cache[require.resolve('../src/services/arComplianceDecisionNotifications')];
  const { notifyArComplianceDecision } = require('../src/services/arComplianceDecisionNotifications');
  const client = { _id: '64b000000000000000000012', data: { basic: { clientLegalName: 'Test Industries' } } };
  const actor = { _id: '64b000000000000000000013', name: 'Manager' };

  const approved = await notifyArComplianceDecision({ client, purchase: { submittedBy: submitter._id }, financialYear: '2025-26', stage: 'manager', decision: 'APPROVED', remarks: 'Verified', actor });
  assert.equal(approved.recipientCount, 1);
  assert.equal(approved.emailSent, 1);
  assert.equal(notifications[0].kind, 'ar_compliance_manager_approved');
  assert.deepEqual(notifications[0].audience, [compliance._id]);
  assert.equal(emails[0][0], compliance.email);

  const rejected = await notifyArComplianceDecision({ client, purchase: { submittedBy: submitter._id }, financialYear: '2025-26', stage: 'manager', decision: 'REJECTED', remarks: 'Correct the portal values', actor });
  assert.equal(rejected.recipientCount, 1);
  assert.equal(rejected.emailSent, 1);
  assert.equal(notifications[1].kind, 'ar_compliance_manager_rejected');
  assert.deepEqual(notifications[1].audience, [submitter._id]);
  assert.equal(emails[1][0], submitter.email);
  assert.match(emails[1][2], /Correct the portal values/);
});
