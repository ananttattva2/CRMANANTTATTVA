const test = require('node:test');
const assert = require('node:assert/strict');

test('registration mapping uses the selected registration year in preference to service dates', async () => {
  const { quotationAnnualReturnRegistrationYear: mapping } = await import('../../frontend/src/utils/quotationDocument.mjs');
  assert.equal(mapping({ registrationYear: '2025-26' }), '2025-26');
  assert.equal(mapping({ registrationYear: ' 2026-27 ' }), '2026-27');
  assert.equal(mapping({}), '-');
});
