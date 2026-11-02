const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('TATA MOTORS ATPL-LEAD-0409 creator correction is exact, guarded and idempotent', () => {
  const service = fs.readFileSync(path.resolve(__dirname, '../src/services/knownDataCorrections.js'), 'utf8');
  const index = fs.readFileSync(path.resolve(__dirname, '../src/index.js'), 'utf8');
  assert.match(service, /\^TATA MOTORS LIMITED\$\/i/);
  assert.match(service, /0\*409/);
  assert.match(service, /\^GAURAV CHANDRA\$\/i/);
  assert.match(service, /already_correct/);
  assert.match(index, /await applyKnownDataCorrections\(\)/);
});

test('explicit lead-owner corrections are guarded by exact company and active-user mappings', () => {
  const service = fs.readFileSync(path.resolve(__dirname, '../src/services/knownDataCorrections.js'), 'utf8');
  for (const company of ['BOSCH HOME COMFORT', 'ACTIONWARE INDIA PVT', 'SINTEX INDUSTRIES LTD', 'TDS LITHIUM-ION BATTERY GUJARAT PRIVATE LIMITED']) assert.match(service, new RegExp(company));
  for (const owner of ['GAURAV CHANDRA', 'RITUL BHUVA', 'MIHIRDEVSINH ZALA']) assert.match(service, new RegExp(owner));
  assert.match(service, /generatedForUser: owner\._id/);
  assert.match(service, /createdOnBehalfOfUser: owner\._id/);
  assert.match(service, /isActive: \{ \$ne: false \}/);
});
