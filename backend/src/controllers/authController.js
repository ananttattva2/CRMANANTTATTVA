const User = require('../models/User');
const Role = require('../models/Role');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getMailDebugConfig, sendMail } = require('../utils/mailer');
const { ROLES } = require('../constants/roles');
const crypto = require('crypto');
const AuditLog = require('../models/AuditLog');
const UserSession = require('../models/UserSession');
const Lead = require('../models/Lead');
const SupportTicket = require('../models/SupportTicket');
const { clientIp } = require('../middleware/activityAudit');
const { getUserProductivityReport, getUserWorkReport } = require('../services/userProductivityReport');
const { getUserRoles } = require('../utils/userRoles');
const { getVisibleUserScope } = require('../utils/visibilityScope');
 
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
 
const OTP_EXPIRY_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const PASSWORD_RESET_EXPIRY_MS = 10 * 60 * 1000;
const APP_NAME = 'CRM';
const ADMIN_LOGIN_ROLES = ['admin', 'superadmin'];
const SUPPORT_TICKET_100_MILESTONE = 'support_tickets_100_v1';

function roleLabel(name) {
  const fixed = { superadmin: 'Super Admin', compliance: 'Compliance Manager', 'cte-cto': 'CTE & CTO' };
  return fixed[name] || String(name || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function roleKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
}

async function isAvailableRole(name) {
  return ROLES.includes(name) || Boolean(await Role.exists({ name }));
}

async function readRequestedRoles(body = {}) {
  const requested = Array.isArray(body.roles) ? body.roles : [body.role];
  const roles = [...new Set(requested.map(roleKey).filter(Boolean))];
  if (!roles.length || roles.length > 3) {
    const error = new Error('Please select between 1 and 3 roles');
    error.statusCode = 400;
    throw error;
  }
  const availability = await Promise.all(roles.map(isAvailableRole));
  if (availability.some((available) => !available)) {
    const error = new Error('Please select valid roles');
    error.statusCode = 400;
    throw error;
  }
  return roles;
}

function normalizeLoginMode(value) {
  return String(value || '').trim().toLowerCase() === 'admin' ? 'admin' : 'user';
}

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function validateLoginModeForUser(user, loginMode) {
  const isAdminUser = getUserRoles(user).some((role) => ADMIN_LOGIN_ROLES.includes(normalizeRole(role)));

  if (loginMode === 'admin' && !isAdminUser) {
    const error = new Error('Admin Login is only available for Admin and Super Admin.');
    error.statusCode = 403;
    throw error;
  }

  if (loginMode === 'user' && isAdminUser) {
    const error = new Error('This account must use Admin Login.');
    error.statusCode = 403;
    throw error;
  }
}
 
function shouldSkipMailInDevelopment() {
  if (process.env.NODE_ENV === 'production') return false;
  if (process.env.OTP_EMAILS_ENABLED === 'true') return false;
  const mailConfig = getMailDebugConfig();
  if (mailConfig.provider === 'microsoft-graph' && mailConfig.graphConfigured) return false;
  const mailPass = process.env.SMTP_PASS || process.env.MAIL_PASS || process.env.EMAIL_PASS || process.env.GMAIL_PASS || '';
  const hasUsableSmtp = Boolean(process.env.SMTP_HOST && mailPass && !isPlaceholderMailSecret(mailPass));
  return !hasUsableSmtp;
}
 
function isPlaceholderMailSecret(value) {
  return /change_me|your-|placeholder/i.test(String(value || ''));
}
 
async function sendLoginOtp(user, otp, context = {}) {
  if (shouldSkipMailInDevelopment()) {
    console.log(`Development OTP for ${user.email}: ${otp}`);
    return { ok: true, message: 'OTP generated for development.', devOtp: otp };
  }
 
  const html = `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${APP_NAME} Login OTP</title>
      </head>
      <body style="margin:0;background:#f1f3f7;font-family:Arial,Helvetica,sans-serif;color:#172033;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f3f7;margin:0;padding:28px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:548px;background:#ffffff;border-collapse:separate;border-spacing:0;">
                <tr><td align="center" style="padding:40px 34px 14px;font-size:11px;font-weight:700;letter-spacing:.04em;color:#087579;">CRM · SECURE VERIFICATION</td></tr>
                <tr><td align="center" style="padding:8px 34px 0;"><h1 style="margin:0;font-size:30px;line-height:1.25;color:#202938;">Your verification code</h1></td></tr>
                <tr><td align="center" style="padding:20px 34px 0;font-size:16px;line-height:1.45;color:#374151;">Hi <strong style="color:#0f5d46;text-decoration:underline;">${escapeHtml(user.email)}</strong>,<br />Enter the code below to confirm it&rsquo;s you and continue signing in to CRM.</td></tr>
                <tr><td style="padding:28px 34px 0;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px dashed #42b99a;background:#eaf8f3;border-collapse:separate;"><tr><td align="center" style="padding:38px 18px;font-size:42px;line-height:1;font-weight:800;letter-spacing:10px;color:#0f5d46;">${otp}</td></tr></table></td></tr>
                <tr><td align="center" style="padding:24px 40px 38px;font-size:14px;line-height:1.55;color:#374151;">This code expires in <strong>10 minutes</strong>. For your security, never share it with anyone.<br />If you didn&rsquo;t request it, you can safely ignore this email &mdash; your account stays secure.</td></tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:548px;"><tr><td align="center" style="padding:16px 12px 0;font-size:11px;color:#94a3b8;">Automated security message from CRM.</td></tr></table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
 
  try {
    const mailResult = await sendMail(user.email, context.resend ? `${APP_NAME} New Login OTP` : `${APP_NAME} Login OTP`, html);
    console.info('OTP mail sent', {
      email: user.email,
      action: context.resend ? 'resend' : 'request',
      mail: mailResult.summary,
      config: getMailDebugConfig()
    });
    return { ok: true, message: 'OTP sent to your registered email.' };
  } catch (err) {
    console.error('OTP mail error', {
      email: user.email,
      action: context.resend ? 'resend' : 'request',
      code: err.code,
      command: err.command,
      responseCode: err.responseCode,
      response: err.response,
      message: err.message,
      config: getMailDebugConfig()
    });
    if (process.env.NODE_ENV !== 'production') {
      console.log(`Development OTP for ${user.email}: ${otp}`);
      return { ok: true, message: 'OTP generated. Email delivery failed in development.', devOtp: otp };
    }
 
    const mailConfig = getMailDebugConfig();
    const configHint = mailConfig.provider === 'microsoft-graph' && !mailConfig.graphConfigured
      ? ' Microsoft Graph is not configured correctly.'
      : mailConfig.provider === 'smtp' && (!mailConfig.host || !mailConfig.hasPassword)
        ? ' SMTP is not configured correctly.'
      : '';
    const error = new Error(`OTP email could not be sent.${configHint}`);
    error.statusCode = 502;
    throw error;
  }
}
 
async function sendPasswordResetOtp(user, otp) {
  if (shouldSkipMailInDevelopment()) {
    console.log(`Development password reset OTP for ${user.email}: ${otp}`);
    return { devOtp: otp };
  }
 
  const html = `
    <div style="margin:0;background:#f4f7fb;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
      <div style="max-width:560px;margin:auto;overflow:hidden;border-radius:18px;background:#fff;box-shadow:0 18px 50px rgba(15,23,42,.12)">
        <div style="background:#0f766e;padding:26px 28px;color:#fff"><b style="font-size:26px">${APP_NAME}</b><div style="margin-top:6px">Password reset</div></div>
        <div style="padding:32px 28px"><h1 style="margin:0;font-size:24px">Reset your password</h1>
          <p style="color:#475569;line-height:1.7">Use this one-time code to reset your password. It expires in 10 minutes.</p>
          <div style="margin:26px 0;padding:20px;border-radius:16px;background:#ecfeff;border:1px solid #99f6e4;text-align:center;font-size:38px;font-weight:800;letter-spacing:.18em">${otp}</div>
          <p style="color:#64748b;line-height:1.7">If you did not request this change, ignore this email. Your password will remain unchanged.</p>
        </div>
      </div>
    </div>`;
  await sendMail(user.email, `${APP_NAME} Password Reset Code`, html);
  return {};
}
 
exports.forgotPassword = async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'Email required' });
 
  const user = await User.findOne({ email });
  const genericMessage = 'If an active account exists for this email, a reset code has been sent.';
  if (!user || !user.isActive) return res.json({ ok: true, message: genericMessage });
 
  if (user.passwordResetRequestedAt) {
    const remaining = OTP_RESEND_COOLDOWN_MS - (Date.now() - new Date(user.passwordResetRequestedAt).getTime());
    if (remaining > 0) return res.status(429).json({ error: `Please wait ${Math.ceil(remaining / 1000)} seconds before requesting another code.` });
  }
 
  const otp = generateOtp();
  user.passwordResetOtp = await bcrypt.hash(otp, 10);
  user.passwordResetExpires = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS);
  user.passwordResetRequestedAt = new Date();
  user.passwordResetAttempts = 0;
  await user.save();
 
  try {
    const result = await sendPasswordResetOtp(user, otp);
    return res.json({ ok: true, message: genericMessage, ...(result.devOtp ? { devOtp: result.devOtp } : {}) });
  } catch (err) {
    user.passwordResetOtp = undefined;
    user.passwordResetExpires = undefined;
    await user.save();
    console.error('Password reset mail error', { email, message: err.message });
    return res.status(502).json({ error: 'Password reset email could not be sent.' });
  }
};
 
exports.resetPassword = async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const otp = String(req.body.otp || '').trim();
  const newPassword = String(req.body.newPassword || '');
  const confirmPassword = String(req.body.confirmPassword || '');
  if (!email || !otp || !newPassword || !confirmPassword) return res.status(400).json({ error: 'All fields are required' });
  if (!/^\d{6}$/.test(otp)) return res.status(400).json({ error: 'Enter a valid 6-digit reset code' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (newPassword !== confirmPassword) return res.status(400).json({ error: 'Password confirmation does not match' });
 
  const user = await User.findOne({ email }).select('+passwordResetAttempts');
  if (!user || !user.isActive || !user.passwordResetOtp || !user.passwordResetExpires) {
    return res.status(400).json({ error: 'Reset code is invalid or expired' });
  }
  if (user.passwordResetExpires.getTime() < Date.now()) {
    user.passwordResetOtp = undefined;
    user.passwordResetExpires = undefined;
    await user.save();
    return res.status(400).json({ error: 'Reset code is invalid or expired' });
  }
  if ((user.passwordResetAttempts || 0) >= 5) {
    return res.status(429).json({ error: 'Too many invalid attempts. Request a new reset code.' });
  }
  const validOtp = await bcrypt.compare(otp, user.passwordResetOtp);
  if (!validOtp) {
    user.passwordResetAttempts = (user.passwordResetAttempts || 0) + 1;
    await user.save();
    return res.status(400).json({ error: 'Reset code is invalid or expired' });
  }
 
  user.password = await bcrypt.hash(newPassword, 10);
  user.passwordResetOtp = undefined;
  user.passwordResetExpires = undefined;
  user.passwordResetRequestedAt = undefined;
  user.passwordResetAttempts = 0;
  user.otp = undefined;
  user.otpExpires = undefined;
  await user.save();
  return res.json({ ok: true, message: 'Password reset successfully. You can now sign in.' });
};
 
function readAvatarUrl(value) {
  if (value === undefined || value === null || value === '') return '';
 
  const avatarUrl = String(value);
  const isImageDataUrl = /^data:image\/(png|jpe?g|webp);base64,/i.test(avatarUrl);
  if (!isImageDataUrl) {
    const error = new Error('Profile image must be PNG, JPG, JPEG, or WEBP');
    error.statusCode = 400;
    throw error;
  }
 
  const sizeInBytes = Math.ceil((avatarUrl.length * 3) / 4);
  if (sizeInBytes > 2 * 1024 * 1024) {
    const error = new Error('Profile image must be under 2MB');
    error.statusCode = 400;
    throw error;
  }
 
  return avatarUrl;
}
 
async function ensureCrmUserId(user) {
  if (!user || user.crmUserId) return user;
  user.crmUserId = String(user._id || user.id);
  await user.save();
  return user;
}
 
exports.requestOtp = async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const password = String(req.body.password || '');
  const loginMode = normalizeLoginMode(req.body.loginMode);
  if (!email) return res.status(400).json({ error: 'Email required' });
  if (!password) return res.status(400).json({ error: 'Password required' });
  let user = await User.findOne({ email });
  if (!user) {
    // user accounts are created by admin only
    return res.status(404).json({ error: 'User not found. Contact admin.' });
  }
 
  if (!user.isActive) return res.status(403).json({ error: 'Your account is inactive. Contact admin.' });
  try {
    validateLoginModeForUser(user, loginMode);
  } catch (error) {
    return res.status(error.statusCode || 403).json({ error: error.message });
  }
 
  if (user.password) {
    const matches = await bcrypt.compare(password, user.password);
    if (!matches) return res.status(401).json({ error: 'Invalid email or password' });
  } else {
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    user.password = await bcrypt.hash(password, 10);
  }
 
  const otp = generateOtp();
  user.otp = otp;
  user.otpExpires = Date.now() + OTP_EXPIRY_MS;
  await user.save();
 
  try {
    const result = await sendLoginOtp(user, otp);
    return res.json(result);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || 'OTP email could not be sent' });
  }
};
 
exports.resendOtp = async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const loginMode = normalizeLoginMode(req.body.loginMode);
  if (!email) return res.status(400).json({ error: 'Email required' });
 
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ error: 'User not found. Contact admin.' });
  if (!user.isActive) return res.status(403).json({ error: 'Your account is inactive. Contact admin.' });
  if (!user.password) return res.status(400).json({ error: 'Password is not set. Contact admin.' });
  try {
    validateLoginModeForUser(user, loginMode);
  } catch (error) {
    return res.status(error.statusCode || 403).json({ error: error.message });
  }
 
  if (user.otp && user.otpExpires && user.otpExpires > Date.now()) {
    const generatedAt = new Date(user.otpExpires).getTime() - OTP_EXPIRY_MS;
    const remainingCooldown = OTP_RESEND_COOLDOWN_MS - (Date.now() - generatedAt);
    if (remainingCooldown > 0) {
      return res.status(429).json({
        error: `Please wait ${Math.ceil(remainingCooldown / 1000)} seconds before resending OTP.`
      });
    }
  }
 
  const otp = generateOtp();
  user.otp = otp;
  user.otpExpires = Date.now() + OTP_EXPIRY_MS;
  await user.save();
 
  try {
    const result = await sendLoginOtp(user, otp, { resend: true });
    return res.json(result);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || 'OTP email could not be sent' });
  }
};
 
exports.verifyOtp = async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const otp = String(req.body.otp || '').trim();
  const loginMode = normalizeLoginMode(req.body.loginMode);
  if (!email || !otp) {
    console.warn('OTP verify failed', { email, reason: 'missing_email_or_otp', otpLength: otp.length });
    return res.status(400).json({ error: 'Email and OTP are required' });
  }
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.isActive) return res.status(403).json({ error: 'Your account is inactive. Contact admin.' });
  if (!user.password) return res.status(400).json({ error: 'Password is not set. Contact admin.' });
  try {
    validateLoginModeForUser(user, loginMode);
  } catch (error) {
    return res.status(error.statusCode || 403).json({ error: error.message });
  }
 
  if (!user.otp) {
    console.warn('OTP verify failed', { email, reason: 'no_active_otp', otpLength: otp.length });
    return res.status(400).json({ error: 'No active OTP found. Please resend OTP.' });
  }
 
  if (String(user.otp) !== otp) {
    console.warn('OTP verify failed', {
      email,
      reason: 'invalid_otp',
      otpLength: otp.length,
      hasStoredOtp: Boolean(user.otp),
      expiresAt: user.otpExpires
    });
    return res.status(400).json({ error: 'Invalid OTP. Please enter the latest 6-digit code from your email.' });
  }
 
  if (!user.otpExpires || user.otpExpires < Date.now()) {
    console.warn('OTP verify failed', { email, reason: 'expired_otp', expiresAt: user.otpExpires });
    return res.status(400).json({ error: 'OTP expired. Please resend OTP.' });
  }
 
  // clear otp
  user.otp = undefined;
  user.otpExpires = undefined;
  user.lastLogin = new Date();
  await user.save();
 
  const sessionId = crypto.randomUUID();
  await UserSession.create({
    userId: user._id, sessionId, loginAt: user.lastLogin, lastActivityAt: user.lastLogin,
    ipAddress: clientIp(req), userAgent: String(req.get('user-agent') || '').slice(0, 500), loginMode
  });
  await AuditLog.create({
    userId: user._id, sessionId, action: 'LOGIN', module: 'Authentication', method: 'POST',
    path: '/api/auth/verify-otp', statusCode: 200, description: 'Logged in to CRM', ipAddress: clientIp(req),
    userName: user.name || user.email, userEmail: user.email, role: user.role, department: user.team
  });
  const token = jwt.sign({ sub: user._id, role: user.role, email: user.email, sid: sessionId }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
  console.info('OTP verified', { email, userId: String(user._id), role: user.role });
  res.json({ ok: true, token, user: publicUser(user) });
};
 
exports.createUserByAdmin = async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').toLowerCase().trim();
  const password = String(req.body.password || '');
  let roles;
  const team = String(req.body.team || 'No team assigned').trim();
  const teamId = String(req.body.teamId || '').trim() || undefined;
  const managerId = String(req.body.managerId || '').trim() || undefined;
  const operationHeadId = String(req.body.operationHeadId || '').trim() || undefined;
  const isActive = req.body.isActive === undefined ? true : Boolean(req.body.isActive);
  let avatarUrl = '';
 
  try {
    avatarUrl = readAvatarUrl(req.body.avatarUrl);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }
 
  try { roles = await readRequestedRoles(req.body); } catch (err) { return res.status(err.statusCode || 400).json({ error: err.message }); }
  const role = roles[0];
  if (!email) return res.status(400).json({ error: 'Email and role required' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  let existing = await User.findOne({ email });
  if (existing) return res.status(400).json({ error: 'User already exists' });
  const contactNumber = String(req.body.contactNumber || '').trim();
  if (contactNumber && !/^[+0-9 ()-]{7,24}$/.test(contactNumber)) return res.status(400).json({ error: 'Enter a valid contact number (7 to 24 characters).' });
  const user = new User({ name, email, contactNumber, password: await bcrypt.hash(password, 10), role, roles, team, teamId, managerId, operationHeadId, isActive, avatarUrl, createdBy: req.user?._id });
  await user.save();
  await ensureCrmUserId(user);
  res.status(201).json({ ok: true, user: publicUser(user) });
};
 
exports.updateUserByAdmin = async (req, res) => {
  const userId = req.params.id;
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').toLowerCase().trim();
  let roles;
  const team = String(req.body.team || 'No team assigned').trim();
  const teamId = String(req.body.teamId || '').trim() || undefined;
  const managerId = String(req.body.managerId || '').trim() || undefined;
  const operationHeadId = String(req.body.operationHeadId || '').trim() || undefined;
  const isActive = req.body.isActive === undefined ? true : Boolean(req.body.isActive);
  let avatarUrl;
 
  try {
    if (req.body.avatarUrl !== undefined) avatarUrl = readAvatarUrl(req.body.avatarUrl);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }
 
  try { roles = await readRequestedRoles(req.body); } catch (err) { return res.status(err.statusCode || 400).json({ error: err.message }); }
  const role = roles[0];
  if (!email) return res.status(400).json({ error: 'Email and role required' });
 
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
 
  const duplicate = await User.findOne({ email, _id: { $ne: userId } });
  if (duplicate) return res.status(400).json({ error: 'Email already exists' });
 
  if (req.body.contactNumber !== undefined) {
    const contactNumber = String(req.body.contactNumber || '').trim();
    if (contactNumber && !/^[+0-9 ()-]{7,24}$/.test(contactNumber)) return res.status(400).json({ error: 'Enter a valid contact number (7 to 24 characters).' });
    user.contactNumber = contactNumber;
  }
  user.name = name;
  user.email = email;
  user.role = role;
  user.roles = roles;
  user.team = team;
  user.teamId = teamId;
  user.managerId = managerId;
  user.operationHeadId = operationHeadId;
  user.isActive = isActive;
  if (req.body.avatarUrl !== undefined) user.avatarUrl = avatarUrl;
  await user.save();
  await ensureCrmUserId(user);
  res.json({ ok: true, user: publicUser(user) });
};

exports.listRoles = async (_req, res) => {
  const savedRoles = await Role.find({}).sort({ createdAt: 1, name: 1 }).lean();
  const byName = new Map(ROLES.map((name) => [name, { name, label: roleLabel(name), system: true }]));
  savedRoles.forEach((role) => byName.set(role.name, {
    name: role.name,
    label: role.label || roleLabel(role.name),
    system: ROLES.includes(role.name)
  }));
  res.json({ ok: true, roles: [...byName.values()] });
};

exports.createRole = async (req, res) => {
  const label = String(req.body.label || req.body.name || '').trim().replace(/\s+/g, ' ');
  const requestedName = roleKey(label);
  if (label.length < 2 || label.length > 50 || !requestedName) {
    return res.status(400).json({ error: 'Role name must be between 2 and 50 characters' });
  }

  const matchesSystemLabel = ROLES.some((systemRole) => roleLabel(systemRole).toLowerCase() === label.toLowerCase());
  const duplicateConditions = [{ label: { $regex: `^${escapeRegExp(label)}$`, $options: 'i' } }];
  if (!ROLES.includes(requestedName)) duplicateConditions.push({ name: requestedName });
  const duplicateCustomRole = await Role.exists({ $or: duplicateConditions });
  if (matchesSystemLabel || duplicateCustomRole) {
    return res.status(409).json({ error: 'This role already exists' });
  }

  // A legacy system key can have a more specific display label. For example,
  // `compliance` displays as "Compliance Manager". Keep a new "Compliance"
  // role distinct without changing the protected system role.
  const name = ROLES.includes(requestedName) ? `custom-${requestedName}` : requestedName;
  if (await Role.exists({ name })) return res.status(409).json({ error: 'This role already exists' });
  const role = await Role.create({ name, label, permissions: [] });
  res.status(201).json({ ok: true, role: { name: role.name, label: role.label, system: false } });
};
 
exports.me = async (req, res) => {
  res.json({ ok: true, user: publicUser(req.user) });
};

exports.claimMilestone = async (req, res) => {
  try {
    const milestoneKey = String(req.params.key || '').trim();
    if (milestoneKey !== SUPPORT_TICKET_100_MILESTONE) {
      return res.status(404).json({ error: 'Milestone not found' });
    }

    const ticketCount = await SupportTicket.countDocuments({});
    if (ticketCount < 100) {
      return res.json({ ok: true, eligible: false, claimed: false, milestoneKey, ticketCount });
    }

    const seenAt = new Date();
    const result = await User.updateOne(
      { _id: req.user._id, 'milestoneAcknowledgements.key': { $ne: milestoneKey } },
      { $push: { milestoneAcknowledgements: { key: milestoneKey, seenAt } } }
    );

    return res.json({
      ok: true,
      eligible: true,
      claimed: result.modifiedCount === 1,
      milestoneKey,
      ticketCount,
      seenAt: result.modifiedCount === 1 ? seenAt : null
    });
  } catch (error) {
    console.error('Milestone claim failed:', error);
    return res.status(500).json({ error: 'Unable to check milestone status' });
  }
};
 
exports.updateMe = async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').toLowerCase().trim();
  let avatarUrl;
 
  try {
    avatarUrl = readAvatarUrl(req.body.avatarUrl);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }
 
  if (!email) return res.status(400).json({ error: 'Email required' });
 
  const duplicate = await User.findOne({ email, _id: { $ne: req.user._id } });
  if (duplicate) return res.status(400).json({ error: 'Email already exists' });
 
  req.user.name = name;
  req.user.email = email;
  if (req.body.avatarUrl !== undefined) req.user.avatarUrl = avatarUrl;
  await req.user.save();
 
  res.json({ ok: true, user: publicUser(req.user) });
};
 
exports.updatePassword = async (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  const confirmPassword = String(req.body.confirmPassword || '');
 
  if (!newPassword || !confirmPassword) {
    return res.status(400).json({ error: 'New password and confirmation are required' });
  }
 
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
 
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'Password confirmation does not match' });
  }
 
  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json({ error: 'User not found' });
 
  if (user.password) {
    if (!currentPassword) return res.status(400).json({ error: 'Current password is required' });
 
    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) return res.status(400).json({ error: 'Current password is incorrect' });
  }
 
  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();
 
  res.json({ ok: true, message: 'Password updated successfully' });
};
 
exports.listUsers = async (req, res) => {
  const users = await User.find().select('-otp -otpExpires -password').sort({ createdAt: -1 });
  res.json({ ok: true, users });
};

exports.logout = async (req, res) => {
  const now = new Date();
  const inactivityLogout = String(req.body?.reason || '').trim().toLowerCase() === 'inactivity';
  if (req.authSessionId) {
    await UserSession.updateOne({ sessionId: req.authSessionId, userId: req.user._id, logoutAt: null }, { $set: { logoutAt: now, lastActivityAt: now } });
  }
  await AuditLog.create({
    userId: req.user._id, sessionId: req.authSessionId, action: 'LOGOUT', module: 'Authentication',
    method: 'POST', path: '/api/auth/logout', statusCode: 200,
    description: inactivityLogout ? 'Automatically logged out after 2 hours of inactivity' : 'Logged out of CRM', ipAddress: clientIp(req),
    userName: req.user.name || req.user.email, userEmail: req.user.email, role: req.user.role, department: req.user.team
  });
  res.json({ ok: true });
};

exports.activityHeartbeat = async (req, res) => {
  try {
    // JWTs issued before session tracking was introduced do not contain `sid`.
    // Heartbeat is optional telemetry and must never affect business workflows.
    if (!req.authSessionId) return res.json({ ok: true, tracking: false, reason: 'legacy-session' });
    const now = new Date();
    const requestedState = String(req.body?.state || 'active').toLowerCase() === 'away' ? 'away' : 'active';
    const elapsed = { $min: [30, { $max: [0, { $floor: { $add: [0.5, { $divide: [
      { $subtract: [now, { $ifNull: ['$lastHeartbeatAt', { $ifNull: ['$lastActivityAt', now] }] }] }, 1000
    ] }] } }] }] };
    // Compute and append on MongoDB's current document. Concurrent tabs and
    // activity auditing cannot overwrite a stale array/version from a read.
    const session = await UserSession.findOneAndUpdate(
      { sessionId: req.authSessionId, userId: req.user._id, logoutAt: null },
      [{ $set: {
        activeSeconds: requestedState === 'active' ? { $add: [{ $max: [0, { $ifNull: ['$activeSeconds', 0] }] }, elapsed] } : '$activeSeconds',
        presenceTimeline: { $cond: [{ $ne: ['$presenceState', requestedState] }, { $slice: [{ $concatArrays: [
          { $cond: [{ $isArray: '$presenceTimeline' }, '$presenceTimeline', []] },
          [{ state: requestedState, at: now, description: requestedState === 'away' ? 'Away from CRM (another tab or website)' : 'Returned to CRM and became active' }]
        ] }, -100] }, '$presenceTimeline'] },
        presenceState: requestedState,
        awaySince: requestedState === 'away' ? { $ifNull: ['$awaySince', now] } : null,
        lastHeartbeatAt: { $max: [{ $ifNull: ['$lastHeartbeatAt', now] }, now] },
        ...(requestedState === 'active' ? { lastActivityAt: { $max: [{ $ifNull: ['$lastActivityAt', now] }, now] } } : {})
      } }],
      { new: true, projection: { activeSeconds: 1, presenceState: 1 } }
    ).lean();
    if (!session) return res.json({ ok: true, tracking: false, reason: 'session-not-found' });
    return res.json({ ok: true, activeSeconds: session.activeSeconds, presenceState: session.presenceState });
  } catch (error) {
    console.error('[activity-heartbeat] telemetry unavailable', { message: error.message, code: error.code || '' });
    return res.json({ ok: true, tracking: false, reason: 'telemetry-unavailable' });
  }
};

exports.superAdminOverview = async (_req, res) => {
  const [users, leads] = await Promise.all([
    User.find().select('name email role team isActive lastLogin').lean(),
    Lead.find().select('createdBy createdByName company leadCode status workflowStatus closedBy closedAt submittedAt').lean()
  ]);
  const userRows = users.map((user) => {
    const owned = leads.filter((lead) => String(lead.createdBy || '') === String(user._id));
    const closed = owned.filter((lead) => lead.closedBy || /closed/i.test(String(lead.status || ''))).length;
    return { id: user._id, name: user.name || user.email, email: user.email, role: user.role, team: user.team, active: user.isActive !== false, totalLeads: owned.length, openLeads: owned.length - closed, closedLeads: closed, lastLogin: user.lastLogin || null };
  });
  const closedLeads = leads.filter((lead) => lead.closedBy || /closed/i.test(String(lead.status || ''))).length;
  res.json({ ok: true, summary: { users: users.length, activeUsers: users.filter((user) => user.isActive !== false).length, leads: leads.length, openLeads: leads.length - closedLeads, closedLeads }, users: userRows.sort((a, b) => b.totalLeads - a.totalLeads) });
};

exports.userProductivityReport = async (req, res) => {
  try {
    const report = await getUserProductivityReport({ from: req.query.from, to: req.query.to, requester: req.user });
    res.json({ ok: true, ...report });
  } catch (error) {
    console.error('[productivity-report] request failed', { message: error.message, code: error.code, stack: error.stack });
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Unable to generate the user activity report' });
  }
};

exports.userWorkReport = async (req, res) => {
  try {
    const report = await getUserWorkReport({ userId: req.params.id, from: req.query.from, to: req.query.to, requester: req.user });
    res.json({ ok: true, ...report });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Unable to generate the user work report' });
  }
};

exports.listAuditLogs = async (req, res) => {
  const { userId, role, status, from, to, module: moduleFilter } = req.query;
  const userQuery = {};
  if (role && role !== 'all') userQuery.role = role;
  if (status === 'active') userQuery.isActive = true;
  if (status === 'inactive') userQuery.isActive = false;
  if (userId) userQuery._id = userId;
  const users = await User.find(userQuery).select('name email role team isActive lastLogin').lean();
  const userIds = users.map((user) => user._id);
  const dateQuery = {};
  if (from) dateQuery.$gte = new Date(`${from}T00:00:00.000+05:30`);
  if (to) dateQuery.$lte = new Date(`${to}T23:59:59.999+05:30`);
  const common = { userId: { $in: userIds }, ...(Object.keys(dateQuery).length ? { loginAt: dateQuery } : {}) };
  const [sessions, activities, completedLeads] = await Promise.all([
    UserSession.find(common).sort({ loginAt: -1 }).limit(5000).lean(),
    AuditLog.find({ userId: { $in: userIds }, ...(moduleFilter && moduleFilter !== 'all' ? { module: moduleFilter } : {}), ...(Object.keys(dateQuery).length ? { occurredAt: dateQuery } : {}) }).sort({ occurredAt: -1 }).limit(10000).lean(),
    Lead.find({ createdBy: { $in: userIds }, workflowStatus: 'submitted', ...(Object.keys(dateQuery).length ? { submittedAt: dateQuery } : {}) })
      .select('company leadCode createdBy formStartedAt assignReachedAt submittedAt fillDurationSeconds createdAt').sort({ submittedAt: -1 }).limit(10000).lean()
  ]);
  const usersById = new Map(users.map((user) => [String(user._id), user]));
  const activitiesBySession = new Map();
  activities.forEach((item) => {
    const key = item.sessionId || `user:${item.userId}`;
    if (!activitiesBySession.has(key)) activitiesBySession.set(key, []);
    activitiesBySession.get(key).push(item);
  });
  const leadsByUser = new Map();
  completedLeads.forEach((lead) => {
    const key = String(lead.createdBy || '');
    if (!leadsByUser.has(key)) leadsByUser.set(key, []);
    leadsByUser.get(key).push(lead);
  });
  const now = Date.now();
  const rows = sessions.map((session) => {
    const user = usersById.get(String(session.userId)) || {};
    const sessionActivities = activitiesBySession.get(session.sessionId) || [];
    const endAt = session.logoutAt || session.lastActivityAt || session.loginAt;
    return {
      id: session._id, sessionId: session.sessionId, userId: session.userId,
      name: user.name || 'Unnamed user', email: user.email || '', role: user.role || '', team: user.team || '',
      userStatus: user.isActive === false ? 'Inactive' : 'Active', loginAt: session.loginAt,
      lastActivityAt: session.lastActivityAt, logoutAt: session.logoutAt || null,
      sessionStatus: session.logoutAt ? 'Logged out' : (now - new Date(session.lastActivityAt).getTime() < 15 * 60 * 1000 ? 'Online' : 'Inactive session'),
      durationSeconds: Math.max(0, Math.round((new Date(endAt).getTime() - new Date(session.loginAt).getTime()) / 1000)),
      activeSeconds: Math.max(0, Number(session.activeSeconds) || 0),
      offlineSince: session.logoutAt || (now - new Date(session.lastActivityAt).getTime() >= 15 * 60 * 1000 ? session.lastActivityAt : null),
      activityCount: sessionActivities.length || session.activityCount || 0, ipAddress: session.ipAddress || '',
      device: session.userAgent || '', presenceState: session.presenceState || 'active', awaySince: session.awaySince || null, presenceTimeline: session.presenceTimeline || [], activities: sessionActivities.map((item) => ({ id: item._id, action: item.action, module: item.module, description: item.description, occurredAt: item.occurredAt, statusCode: item.statusCode })),
      completedLeads: (leadsByUser.get(String(session.userId)) || []).filter((lead) => {
        const completed = new Date(lead.submittedAt || lead.updatedAt || 0).getTime();
        return completed >= new Date(session.loginAt).getTime() && completed <= new Date(endAt).getTime() + 60000;
      }).map((lead) => ({ id: lead._id, company: lead.company, leadCode: lead.leadCode, formStartedAt: lead.formStartedAt, assignReachedAt: lead.assignReachedAt, submittedAt: lead.submittedAt, fillDurationSeconds: lead.fillDurationSeconds }))
    };
  });
  res.json({ ok: true, rows, modules: [...new Set(activities.map((item) => item.module))].sort(), totalSessions: rows.length, totalActivities: activities.length });
};
 
exports.listActiveUsers = async (req, res) => {
  const scope = await getVisibleUserScope(req.user);
  const users = await User.find({ isActive: true, ...(scope === null ? {} : { _id: { $in: scope.ids } }) })
    .select('crmUserId source name email contactNumber avatarUrl role roles team teamId managerId operationHeadId isActive lastLogin createdAt updatedAt')
    .sort({ name: 1, email: 1 });
  res.json({ ok: true, users });
};
 
function publicUser(user) {
  return {
    id: user._id,
    crmUserId: user.crmUserId || String(user._id),
    source: user.source,
    name: user.name,
    email: user.email,
    contactNumber: user.contactNumber || '',
    avatarUrl: user.avatarUrl,
    role: user.role,
    roles: getUserRoles(user),
    team: user.team,
    teamId: user.teamId,
    managerId: user.managerId,
    operationHeadId: user.operationHeadId,
    isActive: user.isActive,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}
 
