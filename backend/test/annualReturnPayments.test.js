const { test } = require('node:test');
const assert = require('node:assert/strict');
const { annualPaymentQueue } = require('../src/services/annualReturnPayments');
const now = new Date('2026-11-26T10:00:00+05:30');

test('each covered annual return year unlocks only after the preceding complete payment', () => {
  const yearRows = [100, 200, 300].map((poAmount, index) => ({
    poFinancialYear: '2026-27', annualReturnYear: ['2025-26', '2026-27', '2027-28'][index], poNumber: 'PO-123', poAmount
  }));
  const approval = {
    _id: 'annual',
    payload: { leadId: 'lead', service: { servicesOffered: 'Annual Return Filing' }, poYearRows: yearRows },
    poReview: { annualPayments: { '2025-26': { status: 'ADVANCE_RECEIVED' } } }
  };
  const queue = () => annualPaymentQueue([approval], now).get('annual');
  assert.deepEqual(queue().map(row => [row.year, row.amount, row.further, row.unlocked]), [
    ['2025-26', 100, false, true], ['2026-27', 200, true, false], ['2027-28', 300, true, false]
  ]);
  approval.poReview.annualPayments['2025-26'].status = 'COMPLETE_RECEIVED';
  assert.deepEqual(queue().map(row => row.unlocked), [true, true, false]);
  assert.equal(queue()[1].payment, null);
  approval.poReview.annualPayments['2026-27'] = { status: 'COMPLETE_RECEIVED' };
  assert.deepEqual(queue().map(row => row.unlocked), [true, true, true]);
  assert.equal(queue()[0].laterPayment, true);
});

test('separate approvals on the same PO share a sequence and unrelated POs start independently', () => {
  const approval = (id, fy, poNumber, paymentStatus) => ({
    _id: id,
    payload: { leadId: 'lead', service: { servicesOffered: 'Annual Return Filing' },
      poYearRows: [{ poFinancialYear: fy, poNumber, poAmount: 100 }] },
    poReview: { paymentStatus }
  });
  const first = approval('first', '2026-27', 'PO-1', { status: 'COMPLETE_RECEIVED' });
  const second = approval('second', '2027-28', 'PO-1');
  const third = approval('third', '2028-29', 'PO-1');
  const separate = approval('separate', '2028-29', 'PO-2');
  const queue = annualPaymentQueue([first, second, third, separate], now);
  assert.equal(queue.get('first')[0].payment.status, 'COMPLETE_RECEIVED');
  assert.equal(queue.get('second')[0].further, true);
  assert.equal(queue.get('second')[0].unlocked, true);
  assert.equal(queue.get('third')[0].unlocked, false);
  assert.equal(queue.get('third')[0].waitingForYear, '2026-27');
  const nextCycle = annualPaymentQueue([separate], new Date('2028-04-01T00:00:00+05:30'));
  assert.equal(nextCycle.get('separate')[0].further, false);
  assert.equal(queue.get('separate')[0].further, true);
  assert.equal(queue.get('separate')[0].unlocked, true);
});
