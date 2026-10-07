const test = require('node:test');
const assert = require('node:assert/strict');
const Lead = require('../src/models/Lead');
const Client = require('../src/models/Client');
const Reminder = require('../src/models/ClientOnboardingReminder');
const Assignment = require('../src/models/StaffOnboardingAssignment');
const { matchingAssignmentIndexes } = require('../src/services/onboardingAssignmentIdentity');
const { syncClientReviewReminderState } = require('../src/services/clientReviewReminderLifecycle');
const { runStaffOnboardingWorkflow } = require('../src/services/staffOnboardingWorkflow');
const query = value => ({ select() { return this; }, async lean() { return value; } });

test('service identity selects only the matching applicant assignment', () => {
  const lead = { assignments: [{ assignedServiceId: 'importer' }, { assignedServiceId: 'producer' }] };
  assert.deepEqual(matchingAssignmentIndexes({ assignedServiceId: 'producer' }, lead), [1]);
  assert.deepEqual(matchingAssignmentIndexes({}, lead), []);
});

test('final approval completes permanent staff assignment when the client creator is another user', async t => {
  const originals = [Lead.findById, Reminder.findOne, Assignment.find];
  t.after(() => { [Lead.findById, Reminder.findOne, Assignment.find] = originals; });
  const record = { status: 'RED_FLAG', redFlaggedAt: new Date(), async save() {} };
  Lead.findById = () => query({ assignments: [{ assignedServiceId: 'brand-owner' }] });
  Reminder.findOne = async () => null;
  Assignment.find = async filter => { assert.deepEqual(filter, { leadKey: 'lead-1', rowIndex: { $in: [0] } }); return [record]; };
  await syncClientReviewReminderState({ client: { _id: 'client-1', selectedLead: 'lead-1', assignedServiceId: 'brand-owner', createdBy: 'importer-user' }, status: 'APPROVED' });
  assert.equal(record.status, 'COMPLETED');
  assert.equal(record.redFlaggedAt, undefined);
});

test('scheduler reconciles approved stale red flags and skips all reminder email paths', async t => {
  const originals = [Lead.findById, Client.find, Assignment.find, Assignment.updateOne];
  t.after(() => { [Lead.findById, Client.find, Assignment.find, Assignment.updateOne] = originals; });
  const leadKey = '66f000000000000000000002';
  Lead.findById = () => query({ assignments: [{ assignedServiceId: 'brand-owner' }] });
  Client.find = () => query([{ _id: 'client', assignedServiceId: 'brand-owner', adminControls: { approvalStatus: 'APPROVED' } }]);
  Assignment.find = async () => [{ _id: 'assignment', leadKey, rowIndex: 0, status: 'RED_FLAG' }];
  const updates = [];
  Assignment.updateOne = async (...args) => { updates.push(args); return { modifiedCount: 1 }; };
  const result = await runStaffOnboardingWorkflow();
  assert.equal(result.completed, 1);
  assert.equal(result.reminded, 0);
  assert.equal(result.redFlagged, 0);
  assert.equal(updates[0][1].$set.status, 'COMPLETED');
});
