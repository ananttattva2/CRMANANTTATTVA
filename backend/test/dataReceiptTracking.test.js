const { test } = require('node:test');
const assert = require('node:assert/strict');
const { receiptTracking } = require('../src/services/dataReceiptTracking');
const { defaultChecklist } = require('../src/services/purchaseDataService');
const at = new Date('2026-11-14T08:00:00Z');
const user = { _id: 'staff-1', name: 'Staff' };
for (const particular of ['Received from client', 'Ready to upload']) {
  test(`${particular}: checkbox selection precedes proof upload and server owns dates/history`, () => {
    const row = { particular, yesNo: 'Yes', partialDataReceived: true, partialReceivedAt: '2000-01-01', receiptHistory: [{ forged: true }] };
    const pending = receiptTracking(row, {}, [], user, at);
    assert.equal(pending.partialDataReceived, true);
    assert.equal(pending.partialReceivedAt, at.toISOString());
    assert.equal(pending.receiptHistory[0].files.length, 0);
    assert.equal(receiptTracking(row, {}, [{ receiptStage: 'complete' }], user, at).partialDataReceived, true);
    const files = [{ name: 'partial.pdf', receiptStage: 'partial', url: 'https://example.com/partial.pdf' }];
    const first = receiptTracking(row, {}, files, user, at);
    assert.equal(first.partialReceivedAt, at.toISOString());
    assert.equal(first.completeReceivedAt, '');
    assert.equal(first.date, '2026-11-14');
    assert.equal(first.receiptHistory.length, 1);
    assert.equal(first.receiptHistory[0].userId, 'staff-1');
    const same = receiptTracking(row, first, files, user, new Date('2026-11-15'));
    assert.equal(same.partialReceivedAt, first.partialReceivedAt);
    assert.equal(same.receiptHistory.length, 1);
    const completeRow = { ...row, completeDataReceived: true };
    assert.equal(receiptTracking(completeRow, first, files, user, at).completeDataReceived, true);
    const both = receiptTracking(completeRow, first, [...files, { receiptStage: 'complete', name: 'complete.pdf' }], user, new Date('2026-11-15'));
    assert.equal(both.partialReceivedAt, first.partialReceivedAt);
    assert.equal(both.completeReceivedAt, new Date('2026-11-15').toISOString());
    const unchecked = receiptTracking({ ...row, partialDataReceived: false }, first, files, user, at);
    assert.equal(unchecked.partialReceivedAt, first.partialReceivedAt);
    assert.equal(unchecked.receiptHistory.length, 2);
    assert.equal(unchecked.receiptHistory[1].checked, false);
    const normalized = defaultChecklist([{ ...row, ...both, files }]).find(item => item.particular === particular);
    assert.deepEqual(normalized.receiptHistory, both.receiptHistory);
    assert.equal(normalized.completeReceivedAt, both.completeReceivedAt);
    assert.equal(receiptTracking(row, first, [], user, at).partialDataReceived, true);
  });
}
test('legacy checked records retain unknown dates without fabricated activity', () => {
  const row = { particular: 'Received from client', yesNo: 'Yes', completeDataReceived: true };
  const result = receiptTracking(row, row, [], user, at);
  assert.equal(result.completeReceivedAt, '');
  assert.deepEqual(result.receiptHistory, []);
});
