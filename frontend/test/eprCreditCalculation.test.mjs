import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eprCreditBasicAmountPerMt,
  eprCreditRatePerKg,
  eprCreditTotalAmount,
  quotationEprCreditCalculationRows
} from '../src/utils/eprCreditCalculation.mjs';

test('EPR Credit basic amounts are INR per kg and convert to INR per MT', () => {
  assert.equal(eprCreditRatePerKg({ basicAmount: 4.7 }), 4.7);
  assert.equal(eprCreditBasicAmountPerMt(4.7), 4700);
  assert.equal(eprCreditBasicAmountPerMt(2.4), 2400);
  assert.equal(eprCreditBasicAmountPerMt(0.94), 940);
});

test('EPR Credit totals multiply the INR per MT amount by the target in MT', () => {
  assert.equal(eprCreditTotalAmount(4700, 10), 47000);
  assert.equal(eprCreditTotalAmount(2400, 10), 24000);
  assert.equal(eprCreditTotalAmount(940, 10), 9400);
  assert.equal(eprCreditTotalAmount(2400, 0.25), 600);
  assert.equal(eprCreditTotalAmount(2000, ''), null);
});

test('calculation rows are populated from quotation EPR Credit items only', () => {
  const rows = quotationEprCreditCalculationRows({
    items: [
      { businessCategory: 'EPR Credit', servicesOffered: 'Annual Return', unit: '1', unitLabel: 'KG', basicAmount: 4.7, eprCreditTargetMt: 10 },
      { businessCategory: 'EPR Consultancy', servicesOffered: 'Filing', basicAmount: 500 }
    ]
  });

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    itemIndex: 0,
    servicesOffered: 'Annual Return',
    unit: '1 KG',
    ratePerKg: 4.7,
    basicAmount: 4700,
    targetMt: 10,
    totalAmount: 47000
  });
});

test('legacy saved kg targets are shown as MT', () => {
  const [row] = quotationEprCreditCalculationRows({
    items: [{
      businessCategory: 'EPR Credit',
      basicAmount: 4.7,
      eprCreditTargetKg: 10000
    }]
  });
  assert.equal(row.targetMt, 10);
  assert.equal(row.totalAmount, 47000);
});
