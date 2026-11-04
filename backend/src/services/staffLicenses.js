const { buildCompanySignature, getIntroductionLogoAttachment } = require('./leadIntroductionEmail');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const StaffLicense = require('../models/StaffLicense');
const { getUserRoles } = require('../utils/userRoles');
const mailer = require('../utils/mailer');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = /^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}-(USR|ADM|SADM)$/;
const LICENSE_VALIDITY_MS = 180 * 24 * 60 * 60 * 1000;
const LABELS = { USR: 'User', ADM: 'Admin', SADM: 'Super Admin' };
function secret() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'secret') throw new Error('A secure JWT_SECRET is required for staff licenses');
  return process.env.JWT_SECRET;
}
function roleTag(user) {
  const roles = getUserRoles(user).map(role => role.replace(/-/g, ''));
  return roles.includes('superadmin') ? 'SADM' : roles.includes('admin') ? 'ADM' : 'USR';
}
function normalizeCode(value) { return String(value || '').trim().toUpperCase().replace(/\s+/g, ''); }
function hashCode(value) { return crypto.createHash('sha256').update(normalizeCode(value)).digest('hex'); }
function generateCode(user) {
  const prefix = String(user.name || user.email || 'TEAM').split('@')[0].replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 4).padEnd(4, 'X');
  const groups = Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join(''));
  return [prefix, ...groups, roleTag(user)].join('-');
}
function encryptionKey() { return crypto.createHash('sha256').update(`crm-staff-license-v1:${secret()}`).digest(); }
function encryptCode(code) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(buffer => buffer.toString('base64')).join('.');
}
function decryptCode(value) {
  const [iv, tag, encrypted] = value.split('.').map(part => Buffer.from(part, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }

function licenseDates(license) {
  const issuedAt = new Date(license.issuedAt || license.createdAt);
  const expiresAt = license.expiresAt ? new Date(license.expiresAt) : new Date(issuedAt.getTime() + LICENSE_VALIDITY_MS);
  return { issuedAt, expiresAt };
}
function isLicenseExpired(license) {
  const { issuedAt, expiresAt } = licenseDates(license);
  return !Number.isFinite(issuedAt.getTime()) || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now();
}
function gateExpiresAt(license) { return licenseDates(license).expiresAt.getTime(); }

async function ensureLicense(user) {
  let existing = await StaffLicense.findOne({ userId: user._id }).select('+codeHash');
  const tag = roleTag(user);
  const expired = existing && isLicenseExpired(existing);
  if (existing && !expired && existing.roleTag === tag && existing.email === user.email) {
    if (existing.issuedAt && existing.expiresAt) return existing;
    // Start legacy licenses from their original creation date; keep keys and email status.
    return await StaffLicense.findOneAndUpdate({ _id: existing._id, codeHash: existing.codeHash }, {
      $set: licenseDates(existing)
    }, { new: true }) || StaffLicense.findOne({ userId: user._id });
  }
  const code = generateCode(user);
  const issuedAt = new Date(Date.now());
  const values = { roleTag: tag, email: user.email, codeHash: hashCode(code), encryptedCode: encryptCode(code), attempts: 0,
    issuedAt, expiresAt: new Date(issuedAt.getTime() + LICENSE_VALIDITY_MS),
    renewalCount: Number(existing?.renewalCount || 0) + (expired ? 1 : 0),
    ...(expired ? { renewedAt: issuedAt } : {}) };
  if (existing) {
    // Compare-and-swap prevents concurrent scans from rotating the same key twice.
    return await StaffLicense.findOneAndUpdate({ _id: existing._id, codeHash: existing.codeHash }, {
      $set: values, $unset: { deliveredAt: 1, retryAt: 1, leaseUntil: 1 }
    }, { new: true }) || StaffLicense.findOne({ userId: user._id });
  }
  try {
    return await StaffLicense.findOneAndUpdate({ userId: user._id }, { $setOnInsert: values }, { upsert: true, new: true, setDefaultsOnInsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    return StaffLicense.findOne({ userId: user._id });
  }
}

async function deliverLicense(user, license) {
  if (license.deliveredAt || isLicenseExpired(license)) return false;
  // Never silently skip real delivery in development, and never log keys.
  const now = new Date();
  const claimed = await StaffLicense.findOneAndUpdate({
    _id: license._id, email: user.email, roleTag: roleTag(user), deliveredAt: null, expiresAt: { $gt: now },
    $and: [{ $or: [{ retryAt: null }, { retryAt: { $lte: now } }] }, { $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] }]
  }, { $set: { leaseUntil: new Date(Date.now() + 10 * 60 * 1000) }, $inc: { attempts: 1 } }, { new: true }).select('+encryptedCode +codeHash');
  if (!claimed) return false;
  try {
    const code = decryptCode(claimed.encryptedCode);
    const url = String(process.env.PUBLIC_URL || 'https://crmananttattva.com').replace(/\/$/, '') + '/license';
    const expiryLabel = licenseDates(claimed).expiresAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'long', timeStyle: 'short' });
    const renewal = Number(claimed.renewalCount || 0) > 0;
    await mailer.sendMail(user.email, renewal ? 'Your renewed Anant Tattva CRM license' : 'Your Anant Tattva CRM access license', `<div style="background:#f0f7f5;padding:32px 16px;font-family:Arial,sans-serif;color:#12332e"><div style="max-width:560px;margin:auto;background:white;border-radius:24px;padding:32px"><p style="color:#087f72;letter-spacing:2px;font-size:12px">ANANT TATTVA · CRM ACCESS</p><h1>${user.isActive ? 'Your workspace is ready' : 'Your personal CRM license'}</h1><p>Hello ${escapeHtml(user.name || 'team member')},</p><p>This is your personal <b>${LABELS[claimed.roleTag]}</b> license. Enter it before signing in with your registered email, password and OTP.</p><div style="padding:24px 10px;background:#e8f7f1;border:1px solid #a4d9c8;border-radius:14px;text-align:center;font-family:monospace;font-size:20px;font-weight:bold;word-break:break-all">${code}</div><p><b>Valid for 180 days.</b> Expires ${escapeHtml(expiryLabel)} IST. A replacement will be generated and emailed automatically after expiry. Your previous license stops working when it expires.</p>${renewal ? '<p><b>Your license has been renewed.</b> Use the new key above. Your old key is no longer valid.</p>' : ''}${!user.isActive ? '<p><b>Your account is currently inactive.</b> Keep this key for your records. Sign in remains disabled until your administrator reactivates your account.</p>' : ''}<p style="margin-top:28px"><a style="background:#087f72;color:white;padding:14px 24px;border-radius:10px;text-decoration:none;display:inline-block" href="${escapeHtml(url)}">Open secure sign in</a></p><p style="font-size:13px;color:#526660">Keep this license private. It only works with your account. If your access role or registered email changes, a replacement will be emailed to you.</p>${buildCompanySignature()}</div></div>`, { branded: false, attachments: [getIntroductionLogoAttachment()] });
    await StaffLicense.updateOne({ _id: claimed._id, codeHash: claimed.codeHash }, { $set: { deliveredAt: new Date() }, $unset: { leaseUntil: 1, retryAt: 1 } });
    return true;
  } catch (error) {
    await StaffLicense.updateOne({ _id: claimed._id, codeHash: claimed.codeHash }, { $set: { retryAt: new Date(Date.now() + Math.min(60, 2 ** Math.min(claimed.attempts, 6)) * 60000) }, $unset: { leaseUntil: 1 } });
    console.error('Staff license email delivery failed', { userId: String(user._id), code: error.code || 'DELIVERY_FAILED' });
    return false;
  }
}

let running;
function syncStaffLicenses() {
  if (running) return running;
  running = (async () => {
    secret();
    await StaffLicense.createIndexes();
    const summary = { accounts: 0, delivered: 0, pending: 0, failed: 0 };
    for await (const user of User.find({}).select('name email role roles isActive').cursor()) {
      try {
        const license = await ensureLicense(user);
        summary.accounts++;
        if (await deliverLicense(user, license)) summary.delivered++;
        else if (!license.deliveredAt) summary.pending++;
      } catch (error) {
        summary.failed++;
        console.error('Staff license reconciliation failed', { userId: String(user._id), code: error.code || 'SYNC_FAILED' });
      }
    }
    return summary;
  })().finally(() => { running = undefined; });
  return running;
}
function startStaffLicenseScheduler() {
  const run = () => syncStaffLicenses().then(summary => console.info('Staff license reconciliation', summary)).catch(error => console.error('Staff license scheduler failed', { message: error.message }));
  void run();
  const timer = setInterval(run, 60 * 1000);
  timer.unref();
  return timer;
}

async function validateCode(code) {
  const normalized = normalizeCode(code);
  if (!CODE_PATTERN.test(normalized)) return null;
  const license = await StaffLicense.findOne({ codeHash: hashCode(normalized) }).select('+codeHash');
  if (!license || isLicenseExpired(license)) return null;
  const user = await User.findById(license.userId).select('email role roles isActive');
  if (!user?.isActive || license.roleTag !== roleTag(user) || license.email !== user.email) return null;
  return { license, user };
}
function signGate(license) {
  if (isLicenseExpired(license)) throw new Error('License expired');
  return jwt.sign({ sub: String(license.userId), fingerprint: license.codeHash, roleTag: license.roleTag, purpose: 'staff-license' }, secret(), { algorithm: 'HS256', audience: 'crm-license', expiresIn: Math.max(1, Math.floor((gateExpiresAt(license) - Date.now()) / 1000)) });
}
async function verifyGate(token, email, { includeLicense = false } = {}) {
  const payload = jwt.verify(token, secret(), { algorithms: ['HS256'], audience: 'crm-license' });
  if (payload.purpose !== 'staff-license') throw new Error('Invalid license session');
  const license = await StaffLicense.findOne({ userId: payload.sub, codeHash: payload.fingerprint, roleTag: payload.roleTag });
  if (!license || isLicenseExpired(license) || license.email !== String(email || '').trim().toLowerCase()) throw new Error('License does not match this account');
  const user = await User.findById(payload.sub).select('email role roles isActive');
  if (!user?.isActive || user.email !== license.email || roleTag(user) !== license.roleTag) throw new Error('License is no longer active');
  const loginMode = license.roleTag === 'USR' ? 'user' : 'admin';
  return includeLicense ? { loginMode, license } : loginMode;
}

module.exports = { LICENSE_VALIDITY_MS, licenseDates, isLicenseExpired, gateExpiresAt, generateCode, normalizeCode, hashCode, roleTag, encryptCode, decryptCode, ensureLicense, deliverLicense, syncStaffLicenses, startStaffLicenseScheduler, validateCode, signGate, verifyGate };
