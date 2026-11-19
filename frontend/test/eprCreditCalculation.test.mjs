import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eprCreditRatePerKg,
  eprCreditTotalAmount,
  quotationEprCreditCalculationRows
} from '../src/utils/eprCreditCalculation.mjs';

test('EPR Credit rates convert from INR per gram to INR per kg without rounding inputs', () => {
  assert.equal(eprCreditRatePerKg({ basicAmount: 2 }), 2000);
  assert.equal(eprCreditRatePerKg({ basicAmount: 2.4 }), 2400);
  assert.equal(eprCreditRatePerKg({ basicAmount: 0.94 }), 940);
});

test('EPR Credit totals multiply the converted rate by the target in kg', () => {
  assert.equal(eprCreditTotalAmount(2000, 10), 20000);
  assert.equal(eprCreditTotalAmount(2400, 10), 24000);
  assert.equal(eprCreditTotalAmount(940, 10), 9400);
  assert.equal(eprCreditTotalAmount(2400, 0.25), 600);
  assert.equal(eprCreditTotalAmount(2000, ''), null);
});

test('calculation rows are populated from quotation EPR Credit items only', () => {
  const rows = quotationEprCreditCalculationRows({
    items: [
      { businessCategory: 'EPR Credit', servicesOffered: 'Annual Return', unit: '1', unitLabel: 'KG', basicAmount: 2, eprCreditTargetKg: 10 },
      { businessCategory: 'EPR Consultancy', servicesOffered: 'Filing', basicAmount: 500 }
    ]
  });

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    itemIndex: 0,
    servicesOffered: 'Annual Return',
    unit: '1 KG',
    quotedRatePerGram: 2,
    basicAmount: 2000,
    targetKg: 10,
    totalAmount: 20000
  });
});
