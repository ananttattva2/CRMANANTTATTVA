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
