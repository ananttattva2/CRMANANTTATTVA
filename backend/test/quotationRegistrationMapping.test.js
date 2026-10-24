const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('registration mapping uses the selected registration year in preference to service dates', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
  const source = page.slice(page.indexOf('function quotationAnnualReturnRegistrationYear('), page.indexOf('\nfunction isEprConsultancyItem('));
  const mapping = vm.runInNewContext(`(${source})`, {
    isEprCreditItem: () => false,
    quotationAnnualReturnOrCreditYears: () => ['2024-25'],
    quotationServicePeriodYears: () => ['2027-28'],
    isPwpQuotationApplicant: () => false,
    isEprConsultancyItem: () => false,
    isAnnualReturnRegistrationApplicant: () => false
  });
  assert.equal(mapping({ registrationYear: '2025-26' }), '2025-26');
  assert.equal(mapping({ registrationYear: ' 2026-27 ' }), '2026-27');
  assert.equal(mapping({}), '-');
});
