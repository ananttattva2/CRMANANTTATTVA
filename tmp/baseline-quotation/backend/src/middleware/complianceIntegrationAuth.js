const crypto = require('crypto');

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireComplianceIntegration(req, res, next) {
  const configuredSecret = String(process.env.CRM_COMPLIANCE_SHARED_SECRET || '').trim();
  if (!configuredSecret) {
    return res.status(503).json({ message: 'CRM compliance integration is not configured' });
  }

  const suppliedSecret = String(req.get('x-crm-shared-secret') || '').trim();
  if (!suppliedSecret || !secureEqual(suppliedSecret, configuredSecret)) {
    return res.status(401).json({ message: 'Invalid CRM integration credentials' });
  }
  return next();
}

module.exports = { requireComplianceIntegration, secureEqual };
