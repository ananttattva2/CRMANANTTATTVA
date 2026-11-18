import test from 'node:test';
import assert from 'node:assert/strict';
import { expandEprCreditServiceRow, isEprCreditBusinessCategory } from '../src/utils/eprCreditServiceRows.mjs';

test('EPR Credit service values expand into separate rows once a financial year is set', () => {
  let id = 0;
  const rows = expandEprCreditServiceRow({
    assignedServiceId: 'service-1',
    businessCategory: 'EPR Credit',
    servicesOffered: 'Category 1 – EOL, Category 1 – Recycling',
    firstAnnualReturnYearApplicable: '2025-26',
    plantUnit: 'Unit 1'
  }, () => `generated-${++id}`);

  assert.deepEqual(rows.map((row) => row.servicesOffered), ['Category 1 – EOL', 'Category 1 – Recycling']);
  assert.deepEqual(rows.map((row) => row.assignedServiceId), ['service-1', 'generated-1']);
  assert.ok(rows.every((row) => row.firstAnnualReturnYearApplicable === '2025-26' && row.plantUnit === 'Unit 1'));
});

test('additional expanded rows receive unique service IDs', () => {
  let id = 1;
  const rows = expandEprCreditServiceRow({
    businessCategory: 'EPR Credit',
    servicesOffered: 'Registration, Annual Return Filing',
    firstAnnualReturnYearApplicable: '2025-26'
  }, () => `service-${id++}`);

  assert.deepEqual(rows.map((row) => row.assignedServiceId), ['service-1', 'service-2']);
});

test('service rows do not expand for other business categories or without a financial year', () => {
  const base = { servicesOffered: 'Registration, Annual Return Filing', firstAnnualReturnYearApplicable: '2025-26' };
  assert.equal(expandEprCreditServiceRow({ ...base, businessCategory: 'EPR Consultancy' }, () => 'new').length, 1);
  assert.equal(expandEprCreditServiceRow({ ...base, businessCategory: 'EPR Credit', firstAnnualReturnYearApplicable: '' }, () => 'new').length, 1);
});

test('business category matching ignores case and whitespace', () => {
  assert.equal(isEprCreditBusinessCategory('  ePr cReDiT '), true);
  assert.equal(isEprCreditBusinessCategory('EPR Consultancy'), false);
});
