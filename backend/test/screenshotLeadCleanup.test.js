const test = require('node:test');
const assert = require('node:assert/strict');
const { TARGETS, validateTarget } = require('../src/scripts/deleteScreenshotTestLeads');
test('screenshot cleanup is restricted to the exact six leads and four temporary drafts', () => {
  assert.equal(TARGETS.length, 10);
  assert.equal(new Set(TARGETS.map(target => target.code)).size, 10);
  assert.equal(TARGETS.filter(target => target.type === 'lead').length, 6);
  assert.equal(TARGETS.filter(target => target.type === 'temporary').length, 4);
  assert.ok(TARGETS.some(target => target.code === 'ATPL-TEMP-0001'));
});
test('cleanup refuses missing, ambiguous or mismatched screenshot targets', () => {
  const target = TARGETS[0];
  assert.throws(() => validateTarget(target, []), /expected one exact record/);
  assert.throws(() => validateTarget(target, [{}, {}]), /expected one exact record/);
  assert.throws(() => validateTarget(target, [{ company: 'Another company' }]), /company mismatch/);
  assert.equal(validateTarget(target, [{ company: target.company }]).company, target.company);
});
test('cleanup refuses a temporary lead that has been converted', () => {
  const target = TARGETS.find(target => target.type === 'temporary');
  assert.throws(() => validateTarget(target, [{ clientName: target.company, status: 'CONVERTED' }]), /no longer a draft/);
  assert.equal(validateTarget(target, [{ clientName: target.company, status: 'DRAFT' }]).status, 'DRAFT');
});
