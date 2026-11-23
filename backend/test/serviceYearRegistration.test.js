const test = require('node:test');
const assert = require('node:assert/strict');
const { currentAnnualYear, annualYearAccess, isRegistration } = require('../../shared/serviceYearAccess.cjs');
const { validate } = require('../src/controllers/registrationTrackerController').__test;
test('Annual Return year unlocks only in the following financial year using IST', () => {
  assert.equal(currentAnnualYear(new Date('2026-11-23')), '2025-26');
  assert.equal(annualYearAccess('2025-26', new Date('2026-11-23')).allowed, true);
  assert.equal(annualYearAccess('2024-25', new Date('2026-11-23')).allowed, false);
  assert.match(annualYearAccess('2026-27', new Date('2026-11-23')).message, /2027-28/);
  assert.equal(currentAnnualYear(new Date('2027-03-31T18:29:59Z')), '2025-26');
  assert.equal(currentAnnualYear(new Date('2027-03-31T18:30:00Z')), '2026-27');
});
test('registration tracker accepts exactly Yes/No stages and requires completion proof', () => {
  assert.equal(isRegistration('New Registration'), true); assert.equal(isRegistration('Registration'), true); assert.equal(isRegistration('Annual Return Filling'), false);
  const input = { dataReceived: 'yes', complianceCheck: 'yes', registrationCompleted: 'yes' };
  assert.throws(() => validate(input), /proof/);
  assert.throws(() => validate({ ...input, dataReceived: 'maybe' }), /Yes or No/);
  const result = validate({ ...input, proof: { name: 'certificate.pdf', secureUrl: 'https://example.test/certificate.pdf' } });
  assert.equal(result.registrationCompleted, 'yes'); assert.equal(result.proof.name, 'certificate.pdf');
  assert.throws(() => validate({ ...input, proof: { url: 'javascript:alert(1)' } }), /proof/);
});
