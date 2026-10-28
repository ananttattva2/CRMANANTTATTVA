const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { contactEmailFilter, relationshipFilter, safeFile, buildPortalData } = require('../src/services/clientPortal');
const { ClientLoginChallenge: Challenge, ClientLoginRate: Rate } = require('../src/models/ClientLoginChallenge');
const Lead = require('../src/models/Lead');
const ctrl = require('../src/controllers/clientPortalController');
const { requireAuth } = require('../src/middleware/auth');
function response() { return { code: 200, status(code) { this.code = code; return this; }, set() {}, json(body) { this.body = body; return this; } }; }
test('client contact email matching is exact, case insensitive and regex escaped', () => {
  const regex = contactEmailFilter('a.b+portal@example.com').$or[0]['contacts.emails'];
  assert.ok(regex.test(' A.B+PORTAL@example.com '));
  assert.ok(!regex.test('axbportal@example.com'));
  assert.ok(!regex.test('other-a.b+portal@example.com'));
  assert.ok(!regex.test('a.b+portal@example.com.evil'));
  const legacy = contactEmailFilter('client@example.com').$or[2];
  assert.ok(legacy.$and[0].$or.some(clause => clause.contacts?.$size === 0));
  assert.ok(legacy.$and[1].emails.test('client@example.com'));
});
test('document relations use verified record IDs and never company names or caller filters', () => {
  const filter = relationshipFilter([{ _id: 'lead1', leadCode: 'L1' }], [{ _id: 'client1' }]);
  assert.deepEqual(filter.$or[0], { leadRef: { $in: ['lead1'] } });
  for (const clause of filter.$or.slice(1)) assert.equal(clause.leadRef, null);
  assert.ok(!JSON.stringify(filter).includes('company'));
});
test('client DTO includes contacts, uploaded POs, SPOCs, quotations and PI but excludes internal fields', () => {
  const result = buildPortalData('client@example.com', [{ _id: 'l1', company: 'Company One', leadCode: 'L1', contacts: [{ contactPerson: 'Client', emails: 'client@example.com', notes: 'INTERNAL' }], notes: 'INTERNAL', createdBy: 'u1', assignments: [{ assignedStaff: 'u1', poYearRows: [{ poNumber: 'PO1', fy: '2026-27', poAmount: 35000, poFileUrl: 'https://files.example/po.pdf' }, { poNumber: 'PO2' }] }] }], [], [{ quotationNumber: 'Q1', leadDetails: { companyName: 'Company One' }, revisionHistory: ['INTERNAL'] }], [{ leadRef: 'l1', proformaNumber: 'PI1', poYearRows: [{ poNumber: 'PO1', fy: '2026-27', compliancePoFile: { url: 'https://files.example/po.pdf' } }] }], [{ _id: 'u1', name: 'Account Manager', email: 'manager@example.com', password: 'INTERNAL' }]);
  assert.equal(result.summary.uploadedPurchaseOrders, 1);
  assert.equal(result.summary.purchaseOrders, 2);
  assert.equal(result.summary.quotations, 1);
  assert.equal(result.summary.invoices, 1);
  assert.equal(result.clients[0].spoc.name, 'Account Manager');
  assert.equal(result.purchaseOrders[0].amount, 35000);
  assert.ok(!JSON.stringify(result).includes('INTERNAL'));
  assert.equal(safeFile('javascript:alert(1)'), '');
});
test('client and staff tokens cannot cross authentication boundaries', async () => {
  const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = 'test-only-client-secret';
  try {
    const token = jwt.sign({ type: 'client', email: 'client@example.com' }, process.env.JWT_SECRET, { audience: 'client-portal', issuer: 'crm-client-portal', expiresIn: '2h' });
    const clientRes = response(); let passed = false;
    ctrl.requireClient({ headers: { authorization: `Bearer ${token}` } }, clientRes, () => { passed = true; });
    assert.ok(passed);
    const staffRes = response();
    await requireAuth({ headers: { authorization: `Bearer ${token}` } }, staffRes, () => assert.fail('client entered staff API'));
    assert.equal(staffRes.code, 401);
    const staffToken = jwt.sign({ sub: 'staff' }, process.env.JWT_SECRET);
    const res = response(); ctrl.requireClient({ headers: { authorization: `Bearer ${staffToken}` } }, res, () => assert.fail('staff entered client API'));
    assert.equal(res.code, 401);
  } finally { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; }
});
test('OTP is consumed atomically, bounded by expiry and attempts, cannot be replayed', async () => {
  const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = 'test-only-client-secret';
  const saved = { rate: Rate.findOneAndUpdate, attempt: Challenge.findOneAndUpdate, consume: Challenge.findOneAndDelete, exists: Lead.exists };
  let consumed = false;
  try {
    Rate.findOneAndUpdate = async () => ({ count: 1 });
    Lead.exists = async () => ({ _id: 'l1' });
    Challenge.findOneAndUpdate = async filter => { assert.equal(filter.attempts.$lt, 5); assert.ok(filter.expiresAt.$gt instanceof Date); return consumed ? null : { _id: 'otp1' }; };
    Challenge.findOneAndDelete = async filter => { assert.equal(filter.hash, ctrl._test.hashOtp('client@example.com', '123456')); assert.equal(filter.attempts.$lte, 5); consumed = true; return { _id: 'otp1' }; };
    const req = { body: { email: 'CLIENT@example.com', code: '123456' }, ip: '127.0.0.1' };
    const first = response(); await ctrl.verifyOtp(req, first);
    assert.equal(first.code, 200); assert.ok(first.body.token);
    const replay = response(); await ctrl.verifyOtp(req, replay); assert.equal(replay.code, 401);
    Challenge.findOneAndUpdate = async () => null;
    const expired = response(); await ctrl.verifyOtp(req, expired); assert.equal(expired.code, 401);
  } finally {
    Rate.findOneAndUpdate = saved.rate; Challenge.findOneAndUpdate = saved.attempt; Challenge.findOneAndDelete = saved.consume; Lead.exists = saved.exists;
    if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous;
  }
});

test('nested client master fields and service allocations are visible without portal credentials', () => {
  const data = buildPortalData('client@example.com', [{ _id: 'l1', company: 'Example' }], [{ _id: 'c1', selectedLead: 'l1', data: { basic: { clientLegalName: 'Example', website: 'https://example.com' }, compliance: { gst: 'GST-TEST' }, cpcb: { status: 'Approved', registrationNumber: 'REG1', loginPassword: 'HIDDEN_PASSWORD', ceprUserId: 'HIDDEN_USER' }, authorised: { name: 'Company Contact', email: 'client@example.com', password: 'HIDDEN_PASSWORD' } }, serviceAllocations: { 'EPR - Plastic Waste': { userName: 'Service Manager', userEmail: 'service@example.com' } } }], [], []);
  assert.equal(data.clients[0].clientMaster[0].basic.clientLegalName, 'Example');
  assert.equal(data.clients[0].clientMaster[0].compliance.gst, 'GST-TEST');
  assert.equal(data.clients[0].assignments[0].spoc.name, 'Service Manager');
  assert.ok(!JSON.stringify(data).includes('HIDDEN_'));
});

test('registered email receives a hashed OTP, resend is throttled and failed mail removes challenge', async () => {
  const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = 'test-only-client-secret';
  const mailer = require('../src/utils/mailer');
  const saved = { rate: Rate.findOneAndUpdate, challenge: Challenge.findOneAndUpdate, remove: Challenge.deleteOne, exists: Lead.exists, send: mailer.sendMail };
  let stored, mailed, removed = false;
  try {
    Rate.findOneAndUpdate = async () => ({ count: 1 });
    Lead.exists = async () => ({ _id: 'l1' });
    Challenge.findOneAndUpdate = async (filter, update) => { stored = update.$set; assert.ok(filter.$or[0].lastSentAt.$lte instanceof Date); return { _id: 'otp1' }; };
    mailer.sendMail = async (email, subject, html) => { assert.equal(email, 'client@example.com'); mailed = html.match(/>([0-9]{6})</)[1]; };
    Challenge.deleteOne = async () => { removed = true; };
    const req = { body: { email: 'CLIENT@example.com' }, ip: '127.0.0.1' };
    const result = response(); await ctrl.requestOtp(req, result);
    assert.equal(result.code, 200);
    assert.equal(stored.hash, ctrl._test.hashOtp('client@example.com', mailed));
    assert.ok(!JSON.stringify(result.body).includes(mailed));
    assert.ok(stored.expiresAt > new Date());
    Challenge.findOneAndUpdate = async () => { const error = new Error('duplicate'); error.code = 11000; throw error; };
    const throttle = response(); await ctrl.requestOtp(req, throttle); assert.equal(throttle.code, 429);
    Challenge.findOneAndUpdate = async () => ({ _id: 'otp1' });
    mailer.sendMail = async () => { throw new Error('mail unavailable'); };
    const failed = response(); await ctrl.requestOtp(req, failed); assert.equal(failed.code, 503); assert.ok(removed);
    Lead.exists = async () => null;
    const unknown = response(); await ctrl.requestOtp(req, unknown); assert.equal(unknown.code, 200); assert.equal(unknown.body.message, result.body.message);
  } finally {
    Rate.findOneAndUpdate = saved.rate; Challenge.findOneAndUpdate = saved.challenge; Challenge.deleteOne = saved.remove; Lead.exists = saved.exists; mailer.sendMail = saved.send;
    if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous;
  }
});

test('public HTTP routes reject unauthenticated access and malformed OTPs', async () => {
  const express = require('express');
  const app = express(); app.use(express.json()); app.use('/api/client-portal', require('../src/routes/clientPortal'));
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/client-portal`;
    const overview = await fetch(`${base}/overview?email=other@example.com`);
    assert.equal(overview.status, 401);
    assert.equal(overview.headers.get('cache-control'), 'no-store');
    const malformed = await fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: { $ne: null } }) });
    assert.equal(malformed.status, 400);
    const invalidCode = await fetch(`${base}/verify-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'client@example.com', code: 'bad' }) });
    assert.equal(invalidCode.status, 404);
    const otpRequest = await fetch(`${base}/request-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'client@example.com' }) });
    assert.equal(otpRequest.status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('temporary email login opens only registered contact sessions and never sends an OTP', async () => {
  const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = 'test-only-client-secret';
  const mailer = require('../src/utils/mailer');
  const saved = { rate: Rate.findOneAndUpdate, exists: Lead.exists, send: mailer.sendMail };
  try {
    Rate.findOneAndUpdate = async () => ({ count: 1 });
    mailer.sendMail = async () => assert.fail('Email-only login must not send OTP mail');
    Lead.exists = async filter => { assert.ok(filter.$or[0]['contacts.emails'].test('client@example.com')); return { _id: 'l1' }; };
    const res = response(); await ctrl.emailLogin({ body: { email: ' CLIENT@example.com ' }, ip: '127.0.0.1' }, res);
    assert.equal(res.code, 200);
    const payload = jwt.verify(res.body.token, process.env.JWT_SECRET, { audience: 'client-portal', issuer: 'crm-client-portal' });
    assert.equal(payload.email, 'client@example.com'); assert.equal(payload.type, 'client');
    Lead.exists = async () => null;
    const unknown = response(); await ctrl.emailLogin({ body: { email: 'unknown@example.com' }, ip: '127.0.0.1' }, unknown); assert.equal(unknown.code, 401);
    const malformed = response(); await ctrl.emailLogin({ body: { email: { $ne: null } } }, malformed); assert.equal(malformed.code, 400);
    Rate.findOneAndUpdate = async () => ({ count: 101 });
    const blocked = response(); await ctrl.emailLogin({ body: { email: 'client@example.com' }, ip: '127.0.0.1' }, blocked); assert.equal(blocked.code, 429);
  } finally {
    Rate.findOneAndUpdate = saved.rate; Lead.exists = saved.exists; mailer.sendMail = saved.send;
    if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous;
  }
});
