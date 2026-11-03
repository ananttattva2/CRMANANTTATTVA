const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const User = require('../src/models/User');
const StaffLicense = require('../src/models/StaffLicense');
const service = require('../src/services/staffLicenses');
const middleware = require('../src/middleware/staffLicense');
const { requireAuth } = require('../src/middleware/auth');
const express = require('express');
const authRoutes = require('../src/routes/auth');
const originalSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
const user = { _id: '507f1f77bcf86cd799439011', name: 'Riya', email: 'riya@example.test', role: 'operation', isActive: true };
const code = service.generateCode(user);
const license = { _id: 'license-id', userId: user._id, codeHash: service.hashCode(code), roleTag: 'USR', email: user.email };
const query = value => ({ select: async () => value, then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) });
function res() { return { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, set() {} }; }
afterEach(() => require('node:test').mock.restoreAll());
require('node:test').after(() => { if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret; });

test('keys use cryptographic random groups, personal prefix and highest role suffix', () => {
  for (const [roles, suffix] of [[['operation'], 'USR'], [['operation', 'admin'], 'ADM'], [['admin', 'super admin'], 'SADM']]) {
    const generated = service.generateCode({ ...user, role: roles[0], roles });
    assert.match(generated, new RegExp(`^RIYA(?:-[A-Z2-9]{4}){3}-${suffix}$`));
  }
  assert.equal(new Set(Array.from({ length: 1000 }, () => service.generateCode(user))).size, 1000);
});
test('stored keys are encrypted, authenticated and normalized for lookup', () => {
  const encrypted = service.encryptCode(code);
  assert.ok(!encrypted.includes(code));
  assert.equal(service.decryptCode(encrypted), code);
  assert.equal(service.hashCode(code.toLowerCase()), license.codeHash);
  const parts = encrypted.split('.'); parts[1] = Buffer.alloc(16).toString('base64');
  assert.throws(() => service.decryptCode(parts.join('.')));
});
test('license validation rejects fabricated, inactive and stale-role keys', async t => {
  t.mock.method(StaffLicense, 'findOne', () => query(license));
  const lookup = t.mock.method(User, 'findById', () => query(user));
  assert.equal(await service.validateCode('WRONG'), null);
  assert.equal((await service.validateCode(code)).user.email, user.email);
  lookup.mock.mockImplementation(() => query({ ...user, isActive: false }));
  assert.equal(await service.validateCode(code), null);
  lookup.mock.mockImplementation(() => query({ ...user, role: 'admin' }));
  assert.equal(await service.validateCode(code), null);
  lookup.mock.mockImplementation(() => query({ ...user, email: 'changed@example.test' }));
  assert.equal(await service.validateCode(code), null);
});
test('gate enforces matching account, current license, expiry and token purpose', async t => {
  t.mock.method(StaffLicense, 'findOne', () => query(license));
  t.mock.method(User, 'findById', () => query(user));
  const token = service.signGate(license);
  assert.equal(await service.verifyGate(token, user.email), 'user');
  await assert.rejects(service.verifyGate(token, 'another@example.test'));
  await assert.rejects(service.verifyGate(jwt.sign({ sub: user._id }, process.env.JWT_SECRET), user.email));
  const expired = jwt.sign({ sub: user._id, purpose: 'staff-license' }, process.env.JWT_SECRET, { audience: 'crm-license', expiresIn: -1 });
  await assert.rejects(service.verifyGate(expired, user.email));
  t.mock.method(StaffLicense, 'findOne', () => query(null));
  await assert.rejects(service.verifyGate(token, user.email));
});
test('USR cannot select Admin Login; ADM and SADM select admin on server', async t => {
  for (const tag of ['USR', 'ADM', 'SADM']) {
    const current = { ...license, roleTag: tag };
    t.mock.method(StaffLicense, 'findOne', () => query(current));
    t.mock.method(User, 'findById', () => query({ ...user, role: tag === 'USR' ? 'operation' : tag === 'ADM' ? 'admin' : 'superadmin' }));
    const token = service.signGate(current);
    const req = { body: { email: user.email, licenseToken: token } };
    let passed = false;
    await middleware.requireLicense(req, res(), () => { passed = true; });
    assert.equal(passed, true);
    assert.equal(req.body.loginMode, tag === 'USR' ? 'user' : 'admin');
    const response = res();
    await middleware.requireLicense({ body: { ...req.body, loginMode: tag === 'USR' ? 'admin' : 'user' } }, response, () => assert.fail('Must reject cross-role login'));
    assert.equal(response.code, 403);
  }
});
test('license gate JWT cannot be used as a signed-in staff bearer token', async () => {
  const response = res();
  await requireAuth({ headers: { authorization: `Bearer ${service.signGate(license)}` } }, response, () => assert.fail('License is not authentication'));
  assert.equal(response.code, 401);
});
test('all three login endpoints reject missing license before touching authentication', async t => {
  const app = express(); app.use(express.json()); app.use('/api/auth', authRoutes);
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => server.close());
  for (const endpoint of ['request-otp', 'resend-otp', 'verify-otp']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email }) });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'LICENSE_REQUIRED');
  }
});
test('unchanged accounts keep the same key without repeated writes or emails', async t => {
  t.mock.method(StaffLicense, 'findOne', () => query(license));
  t.mock.method(StaffLicense, 'findOneAndUpdate', () => assert.fail('Must not regenerate unchanged key'));
  assert.equal((await service.ensureLicense(user))._id, license._id);
  assert.equal(await service.deliverLicense(user, { ...license, deliveredAt: new Date() }), false);
});
test('role or email changes rotate the key and reset delivery markers atomically', async t => {
  t.mock.method(StaffLicense, 'findOne', () => query(license));
  let update;
  t.mock.method(StaffLicense, 'findOneAndUpdate', (filter, changes) => {
    assert.equal(filter.codeHash, license.codeHash); update = changes; return Promise.resolve({ ...license, ...changes.$set });
  });
  const changed = await service.ensureLicense({ ...user, role: 'admin' });
  assert.equal(changed.roleTag, 'ADM');
  assert.notEqual(changed.codeHash, license.codeHash);
  assert.equal(update.$unset.deliveredAt, 1);
  assert.match(service.decryptCode(update.$set.encryptedCode), /-ADM$/);
});

test('delivery sends the encrypted personal key only to its owner and records acceptance', async t => {
  const claimed = { ...license, encryptedCode: service.encryptCode(code), attempts: 1 };
  t.mock.method(StaffLicense, 'findOneAndUpdate', (filter) => {
    assert.equal(filter.deliveredAt, null);
    assert.equal(filter.email, user.email);
    assert.equal(filter.$and.length, 2);
    return query(claimed);
  });
  let sent, update;
  t.mock.method(require('../src/utils/mailer'), 'sendMail', async (...args) => { sent = args; });
  t.mock.method(StaffLicense, 'updateOne', async (filter, changes) => { assert.equal(filter.codeHash, license.codeHash); update = changes; });
  assert.equal(await service.deliverLicense(user, license), true);
  assert.equal(sent[0], user.email);
  assert.ok(sent[2].includes(code));
  assert.ok(sent[2].includes('/license'));
  assert.ok(update.$set.deliveredAt instanceof Date);
});
test('inactive accounts receive their personal key while validation still blocks access', async t => {
  t.mock.method(StaffLicense, 'findOneAndUpdate', () => query({ ...license, encryptedCode: service.encryptCode(code), attempts: 1 }));
  let html;
  t.mock.method(require('../src/utils/mailer'), 'sendMail', async (_to, _subject, body) => { html = body; });
  t.mock.method(StaffLicense, 'updateOne', async () => ({}));
  assert.equal(await service.deliverLicense({ ...user, isActive: false }, license), true);
  assert.ok(html.includes('Your account is currently inactive'));
});

test('failed emails stay pending with backoff; another worker cannot duplicate a leased delivery', async t => {
  t.mock.method(StaffLicense, 'findOneAndUpdate', () => query({ ...license, encryptedCode: service.encryptCode(code), attempts: 2 }));
  t.mock.method(require('../src/utils/mailer'), 'sendMail', async () => { throw Object.assign(new Error('Unavailable'), { code: 'TEST_MAIL_FAILURE' }); });
  let update;
  t.mock.method(StaffLicense, 'updateOne', async (_filter, changes) => { update = changes; });
  assert.equal(await service.deliverLicense(user, license), false);
  assert.ok(update.$set.retryAt > new Date());
  assert.equal(update.$set.deliveredAt, undefined);
  t.mock.method(StaffLicense, 'findOneAndUpdate', () => query(null));
  assert.equal(await service.deliverLicense(user, license), false);
});

test('license → password → OTP issues a real staff session for all three role types', async t => {
  const app = express(); app.use(express.json()); app.use('/api/auth', authRoutes);
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => server.close());
  const password = 'Local-fixture-password-29';
  const hashed = await require('bcryptjs').hash(password, 4);
  let account, current, key;
  t.mock.method(User, 'findById', () => query(account));
  t.mock.method(User, 'findOne', async () => account);
  t.mock.method(StaffLicense, 'findOne', filter => query((!filter.codeHash || filter.codeHash === current.codeHash) ? current : null));
  t.mock.method(require('../src/models/UserSession'), 'create', async () => ({}));
  t.mock.method(require('../src/models/AuditLog'), 'create', async () => ({}));
  const post = async (endpoint, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  for (const role of ['operation', 'admin', 'superadmin']) {
    account = { ...user, role, roles: [role], password: hashed, crmUserId: 'AT-TEST', save: async () => {} };
    key = service.generateCode(account);
    current = { ...license, roleTag: service.roleTag(account), codeHash: service.hashCode(key) };
    const gate = await post('license/validate', { license: key });
    assert.equal(gate.status, 200);
    assert.equal(gate.data.loginMode, role === 'operation' ? 'user' : 'admin');
    assert.equal(gate.data.codeHash, undefined);
    const credentials = { email: account.email, password, licenseToken: gate.data.licenseToken, loginMode: gate.data.loginMode };
    assert.equal((await post('request-otp', { ...credentials, password: 'wrong' })).status, 401);
    const request = await post('request-otp', credentials);
    assert.equal(request.status, 200);
    assert.ok(account.otp);
    const verified = await post('verify-otp', { ...credentials, otp: account.otp });
    assert.equal(verified.status, 200);
    const claims = jwt.verify(verified.data.token, process.env.JWT_SECRET);
    assert.equal(claims.sub, user._id);
    assert.equal(claims.purpose, undefined);
    assert.equal(verified.data.user.role, role);
    assert.equal(account.otp, undefined);
  }
});
