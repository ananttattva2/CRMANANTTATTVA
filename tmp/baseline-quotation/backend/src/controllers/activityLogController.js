const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');

const safeText = (value, max = 120) => String(value || '').trim().slice(0, max);
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const properUserName = (value) => {
  const name = safeText(value);
  return name && !/^crm user$/i.test(name) ? name : '';
};

function dateRange(query) {
  const range = {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.from || '')) range.$gte = new Date(`${query.from}T00:00:00.000+05:30`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.to || '')) range.$lte = new Date(`${query.to}T23:59:59.999+05:30`);
  return range;
}

function buildQuery(req) {
  const query = {};
  if (req.query.userId && mongoose.isValidObjectId(req.query.userId)) query.userId = req.query.userId;
  ['module', 'action', 'role', 'department'].forEach((key) => { if (req.query[key] && req.query[key] !== 'all') query[key] = safeText(req.query[key]); });
  if (req.query.entityId) query.$or = [{ entityId: safeText(req.query.entityId) }, { recordId: safeText(req.query.entityId) }];
  const range = dateRange(req.query);
  if (Object.keys(range).length) query.occurredAt = range;
  const search = safeText(req.query.search, 80);
  if (search) {
    const pattern = new RegExp(escapeRegExp(search), 'i');
    query.$or = [{ userName: pattern }, { userEmail: pattern }, { entityName: pattern }, { recordId: pattern }, { description: pattern }, { action: pattern }];
  }
  return query;
}

exports.list = async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = [10, 25, 50, 100].includes(Number(req.query.limit)) ? Number(req.query.limit) : 10;
  const query = buildQuery(req);
  const [logs, total, requestedUser] = await Promise.all([
    AuditLog.find(query).sort({ occurredAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate('userId', 'name email role team').lean(),
    AuditLog.countDocuments(query),
    req.query.userId && mongoose.isValidObjectId(req.query.userId)
      ? User.findById(req.query.userId).select('name email role team').lean()
      : null
  ]);
  const missingSnapshotIds = [...new Set(logs.filter((log) => !log.userName && log.userId).map((log) => String(log.userId?._id || log.userId)))];
  const snapshotRows = missingSnapshotIds.length ? await AuditLog.find({
    userId: { $in: missingSnapshotIds }, userName: { $exists: true, $nin: ['', null] }
  }).select('userId userName userEmail role department').sort({ occurredAt: -1 }).lean() : [];
  const snapshotsByUser = new Map();
  snapshotRows.forEach((row) => {
    const key = String(row.userId || '');
    if (key && !snapshotsByUser.has(key)) snapshotsByUser.set(key, row);
  });
  const hydratedLogs = logs.map((log) => {
    const linkedUser = log.userId && typeof log.userId === 'object' ? log.userId : null;
    const historicalUser = snapshotsByUser.get(String(linkedUser?._id || log.userId || ''));
    return {
      ...log,
      userId: linkedUser?._id || log.userId,
      userName: properUserName(log.userName) || properUserName(linkedUser?.name) || properUserName(historicalUser?.userName) || properUserName(requestedUser?.name) || linkedUser?.email || historicalUser?.userEmail || requestedUser?.email || '',
      userEmail: log.userEmail || linkedUser?.email || historicalUser?.userEmail || requestedUser?.email || '',
      role: log.role || linkedUser?.role || historicalUser?.role || requestedUser?.role || '',
      department: log.department || linkedUser?.team || historicalUser?.department || requestedUser?.team || ''
    };
  });
  res.json({ ok: true, logs: hydratedLogs, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
};

exports.detail = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid activity id' });
  const log = await AuditLog.findById(req.params.id).lean();
  if (!log) return res.status(404).json({ error: 'Activity not found' });
  res.json({ ok: true, log });
};

exports.stats = async (req, res) => {
  const query = buildQuery(req);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const todayRange = { $gte: new Date(`${today}T00:00:00.000+05:30`), $lte: new Date(`${today}T23:59:59.999+05:30`) };
  const [total, todayRows, byModule, byAction, trend] = await Promise.all([
    AuditLog.countDocuments(query), AuditLog.find({ ...query, occurredAt: todayRange }).select('userId action').lean(),
    AuditLog.aggregate([{ $match: query }, { $group: { _id: '$module', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    AuditLog.aggregate([{ $match: query }, { $group: { _id: '$action', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    AuditLog.aggregate([{ $match: query }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt', timezone: 'Asia/Kolkata' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }, { $limit: 31 }])
  ]);
  const actionCount = (name) => todayRows.filter((row) => row.action === name).length;
  res.json({ ok: true, stats: { total, today: todayRows.length, activeUsersToday: new Set(todayRows.map((row) => String(row.userId))).size,
    usersCreated: actionCount('USER_CREATED') + actionCount('AUTH_CREATED'), leadsCreated: actionCount('LEAD_CREATED'), followUpsAdded: actionCount('FOLLOW_UP_ADDED'), clientsUpdated: actionCount('CLIENT_UPDATED'),
    quotationsCreated: actionCount('QUOTATION_CREATED'), supportTicketsRaised: actionCount('SUPPORT_TICKET_RAISED') }, byModule, byAction, trend });
};

exports.filters = async (_req, res) => {
  const [users, modules, actions] = await Promise.all([
    User.find({ isActive: { $ne: false } }).select('name email role team').sort({ name: 1 }).lean(),
    AuditLog.distinct('module'), AuditLog.distinct('action')
  ]);
  res.json({ ok: true, users, modules: modules.sort(), actions: actions.sort() });
};
