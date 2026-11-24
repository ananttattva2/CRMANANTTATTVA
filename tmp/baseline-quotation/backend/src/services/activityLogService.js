const AuditLog = require('../models/AuditLog');

const SENSITIVE = /password|otp|token|secret|authorization|cookie/i;
const TECHNICAL = new Set(['_id', '__v', 'createdAt', 'updatedAt']);

function safeValue(value) {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') return JSON.parse(JSON.stringify(value));
  return value;
}

function comparable(value) {
  return JSON.stringify(safeValue(value));
}

function getChangedFields(oldData = {}, newData = {}, allowedFields) {
  const keys = allowedFields || Object.keys(newData || {});
  return keys.filter((field) => !TECHNICAL.has(field) && !SENSITIVE.test(field))
    .filter((field) => comparable(oldData?.[field]) !== comparable(newData?.[field]))
    .map((field) => ({ field, oldValue: safeValue(oldData?.[field]), newValue: safeValue(newData?.[field]) }));
}

function parseUserAgent(userAgent = '') {
  const ua = String(userAgent).slice(0, 500);
  const browser = /Edg\//.test(ua) ? 'Microsoft Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const device = /mobile|android|iphone|ipad/i.test(ua) ? 'Mobile / Tablet' : 'Desktop';
  return { userAgent: ua, browser, device };
}

function sanitizeMetadata(value) {
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SENSITIVE.test(key)).map(([key, item]) => [key, typeof item === 'object' ? sanitizeMetadata(item) : item]));
}

async function logActivity(payload) {
  try {
    const req = payload.req;
    const user = payload.user || req?.user;
    if (!user?._id) return null;
    const agent = parseUserAgent(req?.get?.('user-agent') || payload.userAgent);
    return await AuditLog.create({
      userId: user._id, sessionId: req?.authSessionId || payload.sessionId,
      userName: user.name || user.email, userEmail: user.email, role: user.role, department: user.team,
      action: payload.action, module: payload.module, method: payload.method || req?.method,
      path: payload.path || req?.originalUrl?.split('?')[0], statusCode: payload.statusCode,
      description: payload.description, entityType: payload.entityType, entityId: payload.entityId,
      entityName: payload.entityName, recordId: payload.recordId, changes: payload.changes || [],
      metadata: sanitizeMetadata(payload.metadata), ipAddress: payload.ipAddress,
      ...agent, occurredAt: payload.occurredAt || new Date()
    });
  } catch (error) {
    console.error('Activity log write failed', { action: payload.action, module: payload.module, message: error.message });
    return null;
  }
}

module.exports = { logActivity, getChangedFields, parseUserAgent, sanitizeMetadata };
