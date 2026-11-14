const mongoose = require('mongoose');
function activitySummaryPipeline(filter) {
  const scoped = { ...filter };
  if (filter.userId?.$in) scoped.userId = { $in: filter.userId.$in.filter(id => mongoose.isValidObjectId(id)).map(id => new mongoose.Types.ObjectId(String(id))) };
  return [
    { $match: scoped }, { $sort: { occurredAt: -1 } }, { $limit: 10000 },
    { $project: { userId: 1, action: 1, module: 1, description: 1, occurredAt: 1, statusCode: 1 } },
    { $facet: {
      daily: [{ $group: { _id: { userId: '$userId', day: { $dateToString: { date: '$occurredAt', format: '%Y-%m-%d', timezone: 'Asia/Kolkata' } }, module: '$module' }, count: { $sum: 1 }, occurredAt: { $max: '$occurredAt' } } }],
      recent: [{ $group: { _id: '$userId', rows: { $firstN: { input: '$$ROOT', n: 12 } } } }]
    } }
  ];
}
async function readReportActivities(Model, filter) {
  const [result = {}] = await Model.aggregate(activitySummaryPipeline(filter)).option({ maxTimeMS: 15000 });
  return [
    ...(result.daily || []).map(row => ({ userId: row._id.userId, module: row._id.module, occurredAt: row.occurredAt, count: row.count, _summary: true })),
    ...(result.recent || []).flatMap(group => group.rows.map(row => ({ ...row, _recentOnly: true })))
  ];
}
module.exports = { activitySummaryPipeline, readReportActivities };

function sessionSummaryPipeline(filter) {
  const scoped = { ...filter };
  if (filter.userId?.$in) scoped.userId = { $in: filter.userId.$in.filter(id => mongoose.isValidObjectId(id)).map(id => new mongoose.Types.ObjectId(String(id))) };
  const endAt = { $ifNull: ['$logoutAt', { $ifNull: ['$lastActivityAt', '$loginAt'] }] };
  const openSeconds = { $max: [0, { $floor: { $add: [{ $divide: [{ $subtract: [endAt, '$loginAt'] }, 1000] }, 0.5] } }] };
  return [{ $match: scoped }, { $sort: { loginAt: -1 } }, { $limit: 5000 }, { $facet: {
    daily: [{ $group: { _id: { userId: '$userId', day: { $dateToString: { date: '$loginAt', format: '%Y-%m-%d', timezone: 'Asia/Kolkata' } } }, loginAt: { $min: '$loginAt' }, lastActivityAt: { $max: '$lastActivityAt' }, logoutAt: { $max: endAt }, awaySeconds: { $sum: { $max: [0, { $subtract: [openSeconds, { $ifNull: ['$activeSeconds', 0] }] }] } }, activeSeconds: { $sum: { $max: [0, { $ifNull: ['$activeSeconds', 0] }] } }, openSeconds: { $sum: openSeconds }, activityCount: { $sum: { $max: [0, { $ifNull: ['$activityCount', 0] }] } } } }, { $project: { _id: 0, values: ['$_id.userId', '$loginAt', '$lastActivityAt', '$logoutAt', '$activeSeconds', '$openSeconds', '$awaySeconds', '$activityCount'] } }],
    latest: [{ $group: { _id: '$userId', rows: { $firstN: { n: 1, input: { userId: '$userId', loginAt: '$loginAt', lastActivityAt: '$lastActivityAt', logoutAt: '$logoutAt', activeSeconds: '$activeSeconds', activityCount: '$activityCount', presenceState: '$presenceState', ipAddress: '$ipAddress', userAgent: '$userAgent' } } } } }]
  } }];
}
async function readReportSessions(Model, filter) {
  const [result = {}] = await Model.aggregate(sessionSummaryPipeline(filter)).option({ maxTimeMS: 15000 });
  return [...(result.daily || []).map(row => {
    if (row.values) { const [userId, loginAt, lastActivityAt, logoutAt, activeSeconds, openSeconds, awaySeconds, activityCount] = row.values; return { userId, loginAt, lastActivityAt, logoutAt, activeSeconds, openSeconds, awaySeconds, activityCount, _summary: true }; }
    return { ...row, userId: row._id.userId, _summary: true };
  }), ...(result.latest || []).flatMap(group => group.rows.map(row => ({ ...row, _latestOnly: true })))];
}
module.exports.sessionSummaryPipeline = sessionSummaryPipeline;
module.exports.readReportSessions = readReportSessions;
