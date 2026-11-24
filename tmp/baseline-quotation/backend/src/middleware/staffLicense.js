const { validateCode, signGate, verifyGate, gateExpiresAt, licenseDates } = require('../services/staffLicenses');

const attempts = new Map();
function licenseRateLimit(req, res, next) {
  // Use the socket address unless Express has explicitly configured trusted proxies.
  const key = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  for (const [address, entry] of attempts) if (entry.until <= now) attempts.delete(address);
  const entry = attempts.get(key) || { count: 0, until: now + 60000 };
  if (entry.count >= 20 || (!attempts.has(key) && attempts.size >= 10000)) {
    res.set('Retry-After', '60');
    return res.status(429).json({ error: 'Too many attempts. Please try again in a minute.' });
  }
  entry.count++;
  attempts.set(key, entry);
  next();
}
async function validateLicense(req, res, next) {
  try {
    const result = await validateCode(req.body.license);
    if (!result) return res.status(401).json({ error: 'Invalid or inactive license. Check the license sent to your registered email.' });
    const { license, user } = result;
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, licenseToken: signGate(license), email: user.email, loginMode: license.roleTag === 'USR' ? 'user' : 'admin', roleTag: license.roleTag, expiresAt: gateExpiresAt(license), licenseExpiresAt: licenseDates(license).expiresAt.toISOString() });
  } catch (error) { next(error); }
}
async function requireLicense(req, res, next) {
  if (!req.body.licenseToken) return res.status(403).json({ error: 'Please verify your license before signing in.', code: 'LICENSE_REQUIRED' });
  try {
    const { loginMode: mode, license } = await verifyGate(req.body.licenseToken, req.body.email, { includeLicense: true });
    req.staffLicenseExpiresAt = licenseDates(license).expiresAt;
    if (req.body.loginMode && req.body.loginMode !== mode) throw new Error('License does not allow this login type');
    req.body.loginMode = mode;
    next();
  } catch (error) {
    if (['MongoServerSelectionError', 'MongoNetworkError', 'MongooseServerSelectionError'].includes(error.name)) return next(error);
    return res.status(403).json({ error: 'License session expired or does not match this account. Verify your license again.', code: 'LICENSE_REQUIRED' });
  }
}
module.exports = { licenseRateLimit, validateLicense, requireLicense };
