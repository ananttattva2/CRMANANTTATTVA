const UserSession = require('../models/UserSession');
const { logActivity, getChangedFields } = require('../services/activityLogService');
const mongoose = require('mongoose');

const SKIP_PATHS = new Set(['/api/auth/me', '/api/auth/logout', '/api/auth/admin/logs', '/api/auth/admin/logs/summary']);
const MODULE_LABELS = {
  auth: 'Authentication', leads: 'Lead Generation', clients: 'Client Master',
  quotations: 'Quotation', 'proforma-invoices': 'Proforma Invoice',
  'annual-returns': 'Annual Returns', notifications: 'Notifications', teams: 'Teams',
  'calendar-items': 'Calendar', 'support-tickets': 'Support Tickets', assets: 'Assets'
};

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
}

function actionName(method, segment, path, body = {}) {
  if (segment === 'support-tickets') return method === 'POST' ? 'SUPPORT_TICKET_RAISED' : ['Resolved', 'Closed'].includes(body.status) ? 'SUPPORT_TICKET_RESOLVED' : 'SUPPORT_TICKET_UPDATED';
  if (segment === 'leads') return method === 'POST' ? 'LEAD_CREATED' : method === 'DELETE' ? 'LEAD_DELETED' : body.status ? 'LEAD_STATUS_CHANGED' : 'LEAD_UPDATED';
  if (segment === 'clients') return method === 'POST' ? 'CLIENT_CREATED' : 'CLIENT_UPDATED';
  if (segment === 'quotations') return method === 'POST' ? 'QUOTATION_CREATED' : path.includes('approval') ? `QUOTATION_${String(body.status || 'UPDATED').toUpperCase()}` : 'QUOTATION_UPDATED';
  if (segment === 'calendar-items') return method === 'POST' ? (body.type === 'follow_up' ? 'FOLLOW_UP_ADDED' : 'TASK_CREATED') : body.completed ? 'TASK_COMPLETED' : 'CALENDAR_ITEM_UPDATED';
  return `${segment.replace(/-/g, '_').toUpperCase()}_${{ POST: 'CREATED', PUT: 'UPDATED', PATCH: 'UPDATED', DELETE: 'DELETED' }[method] || method}`;
}

function responseEntity(payload = {}) {
  return payload.lead || payload.client || payload.quotation || payload.ticket || payload.calendarItem || payload.item || null;
}

function entityIdentity(entity = {}, body = {}) {
  const source = entity || body || {};
  return {
    entityId: String(source._id || source.id || ''),
    entityName: source.company || source.companyName || source.clientName || source.legalName || source.subject || source.quotationNumber || source.leadCode || '',
    recordId: source.leadCode || source.quotationNumber || source.ticketNumber || source.ticketCode || String(source._id || '')
  };
}

async function activityAudit(req, res, next) {
  if (!req.user) return next();
  // Background cache checks are not user activity and must not inflate MIS.
  if (req.originalUrl.split('?')[0] === '/api/cache/revision') return next();
  const sessionId = String(req.authSessionId || '');
  UserSession.updateOne(
    { sessionId, userId: req.user._id },
    { $set: { lastActivityAt: new Date() }, $inc: { activityCount: 1 } }
  ).catch(() => {});

  let previousRecord = null;
  const method = String(req.method || '').toUpperCase();
  const pathParts = req.originalUrl.split('?')[0].split('/').filter(Boolean);
  const segment = pathParts[1] || 'crm';
  const recordId = pathParts[2];
  const models = { leads: '../models/Lead', clients: '../models/Client', quotations: '../models/Quotation', 'support-tickets': '../models/SupportTicket', 'calendar-items': '../models/CalendarItem' };
  if (['PUT', 'PATCH', 'DELETE'].includes(method) && models[segment] && mongoose.isValidObjectId(recordId)) {
    try { previousRecord = await require(models[segment]).findById(recordId).lean(); } catch { previousRecord = null; }
  }
  let responseBody;
  const originalJson = res.json.bind(res);
  res.json = (body) => { responseBody = body; return originalJson(body); };
  res.on('finish', () => {
    if (res.statusCode >= 400 || SKIP_PATHS.has(req.originalUrl.split('?')[0]) || req.originalUrl.startsWith('/api/activity-logs')) return;
    const method = String(req.method || '').toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;
    const segment = req.originalUrl.split('?')[0].split('/').filter(Boolean)[1] || 'crm';
    const moduleName = MODULE_LABELS[segment] || segment.replace(/-/g, ' ');
    const entity = responseEntity(responseBody) || previousRecord || {};
    const identity = entityIdentity(entity, req.body);
    const changes = method === 'POST' ? [] : getChangedFields(previousRecord || {}, req.body || {});
    const action = actionName(method, segment, req.originalUrl, req.body);
    const humanAction = action.toLowerCase().replace(/_/g, ' ');
    const entityLabel = identity.entityName || identity.recordId;
    logActivity({ req, user: req.user, action, module: moduleName, method, statusCode: res.statusCode,
      description: `${req.user.name || req.user.email} ${humanAction}${entityLabel ? ` – ${entityLabel}` : ''}.`,
      entityType: moduleName, ...identity, changes, metadata: req.body, ipAddress: clientIp(req) });
  });
  next();
}

module.exports = { activityAudit, clientIp };
