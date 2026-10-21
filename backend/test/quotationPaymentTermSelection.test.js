const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../src/controllers/quotationController');

test('quotation stores only the selected payment term', () => {
  const selected = '50% upon submission of the registration application and the remaining 50% upon completion of the work.';
  const result = _test.cleanBody({
    items: [],
    terms: [
      '50% advance and 50% after completion of work',
      selected
    ],
    paymentTerm: selected
  });

  assert.equal(result.paymentTerm, selected);
  assert.deepEqual(result.terms, [selected]);
});
