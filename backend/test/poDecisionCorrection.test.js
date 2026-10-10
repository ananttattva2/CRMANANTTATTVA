const test = require('node:test');
const assert = require('node:assert/strict');

test('a rejected or revision-required PO can be corrected to approval but cannot be rejected again', async () => {
  const { canApprovePo, canReviewPoDecision } = await import('../../frontend/src/utils/poDecision.mjs');
  for (const status of ['PENDING', 'REJECTED', 'REVISION_REQUIRED']) {
    assert.equal(canApprovePo(status), true);
    assert.equal(canReviewPoDecision(status, 'APPROVED'), true);
  }
  assert.equal(canApprovePo('APPROVED'), false);
  assert.equal(canReviewPoDecision('APPROVED', 'APPROVED'), false);
  assert.equal(canReviewPoDecision('REJECTED', 'REJECTED'), false);
  assert.equal(canReviewPoDecision('PENDING', 'REJECTED'), true);
});
