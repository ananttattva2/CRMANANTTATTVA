const test = require('node:test');
const assert = require('node:assert/strict');

const PendingApproval = require('../src/models/PendingApproval');
const { activeCorrectionFilter, runClientComplianceCorrectionReminders } = require('../src/services/clientComplianceCorrectionReminders');

test('correction reminder jobs require an explicit partial approval or rejection', () => {
  const filter = activeCorrectionFilter();

  assert.deepEqual(filter, {
    approvalStatus: { $in: ['PARTIALLY_APPROVED', 'REJECTED'] },
    correctionDecision: { $in: ['PARTIALLY_APPROVED', 'REJECTED'] }
  });
  assert.equal(filter.approvalStatus.$in.includes('PENDING'), false);
  assert.equal(filter.approvalStatus.$in.includes('APPROVED'), false);
});

test('the reminder scan cancels stale pending timers before looking for due mail', async () => {
  const originalUpdateMany = PendingApproval.updateMany;
  const originalFind = PendingApproval.find;
  const updates = [];
  const searches = [];

  PendingApproval.updateMany = async (filter, update) => {
    updates.push({ filter, update });
    return { modifiedCount: 1 };
  };
  PendingApproval.find = (filter) => {
    searches.push(filter);
    return { limit: async () => [] };
  };

  try {
    const result = await runClientComplianceCorrectionReminders(new Date('2026-10-21T10:00:00.000Z'));
    assert.equal(result.reminders, 0);
    assert.equal(updates[0].filter.approvalStatus, 'PENDING');
    assert.deepEqual(updates[0].filter.correctionStatus, { $in: ['OPEN', 'BREACHED'] });
    assert.equal(updates[0].update.$set.correctionStatus, 'NONE');
    assert.equal(updates[0].update.$set.correctionDecision, '');
    searches.forEach((filter) => {
      assert.deepEqual(filter.approvalStatus, { $in: ['PARTIALLY_APPROVED', 'REJECTED'] });
      assert.deepEqual(filter.correctionDecision, { $in: ['PARTIALLY_APPROVED', 'REJECTED'] });
    });
  } finally {
    PendingApproval.updateMany = originalUpdateMany;
    PendingApproval.find = originalFind;
  }
});
