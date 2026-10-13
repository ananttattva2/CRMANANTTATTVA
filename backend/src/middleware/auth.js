const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { activityAudit } = require('./activityAudit');
const { userHasAnyRole } = require('../utils/userRoles');
const authenticatedRequest = Symbol('crm authenticated request');

async function requireAuth(req, res, next) {
  if (req.user && req[authenticatedRequest] === req.user) return next();
  const startedAt = Date.now();
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'Authorization token required' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    const user = await User.findById(payload.sub).select('-otp -otpExpires -password').maxTimeMS(10000);

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User is not active' });
    }

    req.user = user;
    req[authenticatedRequest] = user;
    req.crmAuthMs = Date.now() - startedAt;
    req.authSessionId = payload.sid || '';
    activityAudit(req, res, next);
  } catch (err) {
    if (['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError', 'CastError'].includes(err.name)) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    console.error('[authentication] database lookup failed', { name: err.name, code: err.code });
    res.set('Retry-After', '2');
    return res.status(503).json({ error: 'Authentication service is temporarily unavailable. Please retry.' });
  }
}

function requireRoles(roles) {
  return (req, res, next) => {
    if (!req.user || !userHasAnyRole(req.user, roles)) {
      return res.status(403).json({ error: 'You do not have permission for this action' });
    }

    next();
  };
}

module.exports = { requireAuth, requireRoles };
