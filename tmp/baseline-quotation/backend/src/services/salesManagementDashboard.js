const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const User = require('../models/User');
const Team = require('../models/Team');
const { userHasAnyRole } = require('../utils/userRoles');
const { ADMIN_ROLES } = require('../constants/roles');

const ACTIVE_THRESHOLD = 25;
const WARNING_THRESHOLD = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const LEGACY_BULK_CUTOFF = new Date(process.env.SALES_MIS_LEGACY_BULK_CUTOFF || '2026-08-06T23:59:59.999Z');
const LEGACY_BACKLOG_START = new Date(process.env.SALES_MIS_LEGACY_BACKLOG_START || '2026-08-01T00:00:00.000Z');

function text(value) {
  return String(value ?? '').trim();
}

function objectId(value) {
  return mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(value) : null;
}

function toInputDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function parseDateRange(dateFrom, dateTo) {
  const today = new Date();
  const defaultFrom = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1));
  const fromText = text(dateFrom) || toInputDate(defaultFrom);
  const toText = text(dateTo) || toInputDate(today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromText) || !/^\d{4}-\d{2}-\d{2}$/.test(toText)) {
    throw Object.assign(new Error('dateFrom and dateTo must use YYYY-MM-DD.'), { statusCode: 400 });
  }
  const start = new Date(`${fromText}T00:00:00.000Z`);
  const end = new Date(`${toText}T23:59:59.999Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw Object.assign(new Error('dateFrom must be on or before dateTo.'), { statusCode: 400 });
  }
  if ((end - start) / DAY_MS > 1098) {
    throw Object.assign(new Error('The dashboard date range cannot exceed three years.'), { statusCode: 400 });
  }
  return { from: fromText, to: toText, start, end };
}

function dateMatch(start, end) {
  return { createdAt: { $gte: start, $lte: end } };
}

function approvedAssignmentExpression() {
  return {
    $filter: {
      input: { $ifNull: ['$assignments', []] },
      as: 'assignment',
      cond: { $eq: [{ $toUpper: { $ifNull: ['$$assignment.poApprovalStatus', ''] } }, 'APPROVED'] }
    }
  };
}

function poRevenueExpression() {
  return {
    $reduce: {
      input: '$approvedAssignments',
      initialValue: 0,
      in: {
        $add: [
          '$$value',
          {
            $reduce: {
              input: { $ifNull: ['$$this.poYearRows', []] },
              initialValue: 0,
              in: { $add: ['$$value', { $convert: { input: '$$this.poAmount', to: 'double', onError: 0, onNull: 0 } }] }
            }
          }
        ]
      }
    }
  };
}

function approvedPoRowsExpression() {
  return {
    $reduce: {
      input: '$approvedAssignments',
      initialValue: [],
      in: { $concatArrays: ['$$value', { $ifNull: ['$$this.poYearRows', []] }] }
    }
  };
}

function positiveAmount(field) {
  return { $gt: [{ $convert: { input: field, to: 'double', onError: 0, onNull: 0 } }, 0] };
}

function rowAmountTotal(rowsField, amountField) {
  return {
    $reduce: {
      input: rowsField,
      initialValue: 0,
      in: { $add: ['$$value', { $convert: { input: amountField, to: 'double', onError: 0, onNull: 0 } }] }
    }
  };
}

/**
 * MongoDB aggregation used by the management dashboard. Leads remain the
 * cohort root; quotations and users are joined so all funnel metrics use one
 * stable owner and cannot double-count quotation value as PO revenue.
 */
function buildSalesManagementAggregation({ start, end, department, managerId, ownerIds = [], interval = 'monthly', now = new Date() }) {
  const initialMatch = {
    ...dateMatch(start, end),
    recordStatus: { $ne: 'DELETED' }
  };
  if (ownerIds.length) {
    initialMatch.$or = [
      { generatedForUser: { $in: ownerIds } },
      { generatedForUser: null, createdBy: { $in: ownerIds } },
      { generatedForUser: { $exists: false }, createdBy: { $in: ownerIds } }
    ];
  }

  // Inactive CRM users must not appear in the live MIS or any export sourced
  // from it. `$ne: false` preserves legacy users that predate the flag.
  const postOwnerMatch = { 'owner.isActive': { $ne: false } };
  if (text(department)) {
    const departmentId = objectId(department);
    postOwnerMatch.$or = departmentId
      ? [{ 'owner.teamId': departmentId }, { 'owner.team': { $regex: `^${text(department).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }]
      : [{ 'owner.team': { $regex: `^${text(department).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }];
  }

  const requestedManagerId = objectId(managerId);
  // `managerId` is kept for API compatibility, but represents the selected
  // dashboard row (the permanent lead owner), not that owner's line manager.
  if (requestedManagerId) postOwnerMatch.dashboardOwnerId = requestedManagerId;
  const stalledBefore = new Date(now.getTime() - (30 * DAY_MS));

  const periodExpression = interval === 'weekly'
    ? { $dateToString: { format: '%Y-%m-%d', date: { $dateTrunc: { date: '$createdAt', unit: 'week', startOfWeek: 'Monday', timezone: 'Asia/Kolkata' } }, timezone: 'Asia/Kolkata' } }
    : { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'Asia/Kolkata' } };
  const pipeline = [
    { $match: initialMatch },
    // Admin-created leads are test records and must not contribute to any
    // dashboard or export. Super Admin and every other creator role remain.
    { $lookup: { from: 'users', localField: 'createdBy', foreignField: '_id', as: 'leadCreator' } },
    { $unwind: { path: '$leadCreator', preserveNullAndEmptyArrays: true } },
    { $match: { $expr: { $ne: [
      { $toLower: { $ifNull: ['$leadCreator.role', ''] } },
      'admin'
    ] } } },
    { $set: { dashboardOwnerId: { $ifNull: ['$generatedForUser', '$createdBy'] } } },
    { $lookup: { from: 'users', localField: 'dashboardOwnerId', foreignField: '_id', as: 'owner' } },
    { $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } },
    { $set: { reportingManagerId: { $ifNull: ['$owner.managerId', '$owner._id'] } } },
    { $lookup: { from: 'users', localField: 'reportingManagerId', foreignField: '_id', as: 'reportingManager' } },
    { $unwind: { path: '$reportingManager', preserveNullAndEmptyArrays: true } },
    ...(Object.keys(postOwnerMatch).length ? [{ $match: postOwnerMatch }] : []),
    {
      $set: {
        oldLead: { $cond: [{ $and: [{ $eq: ['$bulkImported', true] }, { $lte: ['$createdAt', LEGACY_BULK_CUTOFF] }] }, 1, 0] },
        newLead: { $cond: [{ $and: [{ $eq: ['$bulkImported', true] }, { $lte: ['$createdAt', LEGACY_BULK_CUTOFF] }] }, 0, 1] }
      }
    },
    {
      $lookup: {
        from: 'quotations',
        let: { leadObjectId: '$_id', leadCode: '$leadCode', sourceLeadId: '$sourceLeadId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  { $eq: ['$leadRef', '$$leadObjectId'] },
                  { $eq: ['$leadId', { $toString: '$$leadObjectId' }] },
                  { $and: [{ $ne: ['$$leadCode', null] }, { $eq: ['$leadCode', '$$leadCode'] }] },
                  { $and: [{ $ne: ['$$leadCode', null] }, { $eq: ['$businessLeadCode', '$$leadCode'] }] },
                  { $and: [{ $ne: ['$$sourceLeadId', null] }, { $eq: ['$leadId', '$$sourceLeadId'] }] }
                ]
              }
            }
          },
          { $sort: { createdAt: -1 } },
          { $project: { quotationNumber: 1, status: 1, serviceState: 1, grandTotal: 1, quotationDate: 1, createdAt: 1 } }
        ],
        as: 'quotations'
      }
    },
    { $set: { approvedAssignments: approvedAssignmentExpression() } },
    { $set: { approvedPoRows: approvedPoRowsExpression() } },
    {
      $set: {
        oldBusinessPoRows: {
          $filter: {
            input: '$approvedPoRows', as: 'po',
            cond: { $and: [positiveAmount('$$po.poAmount'), { $not: [positiveAmount('$$po.quotationBasicAmount')] }] }
          }
        },
        newBusinessPoRows: {
          $filter: {
            input: '$approvedPoRows', as: 'po',
            cond: { $and: [positiveAmount('$$po.poAmount'), positiveAmount('$$po.quotationBasicAmount')] }
          }
        }
      }
    },
    {
      $set: {
        convertedServiceCount: { $size: '$approvedAssignments' },
        confirmedRevenue: poRevenueExpression(),
        oldBusinessPoValue: rowAmountTotal('$oldBusinessPoRows', '$$this.poAmount'),
        newBusinessPoValue: rowAmountTotal('$newBusinessPoRows', '$$this.poAmount'),
        newBusinessQuotationValue: rowAmountTotal('$newBusinessPoRows', '$$this.quotationBasicAmount'),
        oldBusinessLead: { $cond: [{ $gt: [{ $size: '$oldBusinessPoRows' }, 0] }, 1, 0] },
        newBusinessLead: { $cond: [{ $gt: [{ $size: '$newBusinessPoRows' }, 0] }, 1, 0] },
        approvedQuotations: {
          $filter: { input: '$quotations', as: 'quote', cond: { $eq: [{ $toLower: { $ifNull: ['$$quote.status', ''] } }, 'approved'] } }
        },
        rejectedQuotations: {
          $filter: {
            input: '$quotations', as: 'quote',
            cond: { $or: [
              { $eq: [{ $toLower: { $ifNull: ['$$quote.status', ''] } }, 'rejected'] },
              { $eq: [{ $toLower: { $ifNull: ['$$quote.serviceState', ''] } }, 'closed'] }
            ] }
          }
        },
        activeQuotations: {
          $filter: {
            input: '$quotations', as: 'quote',
            cond: { $in: [{ $toLower: { $ifNull: ['$$quote.status', ''] } }, ['draft', 'submitted', 'sent']] }
          }
        }
      }
    },
    {
      $set: {
        approvedQuotationValue: {
          $reduce: {
            input: '$approvedQuotations', initialValue: 0,
            in: { $add: ['$$value', { $convert: { input: '$$this.grandTotal', to: 'double', onError: 0, onNull: 0 } }] }
          }
        },
        openQuotationCount: {
          $cond: [
            { $gt: ['$convertedServiceCount', 0] }, 0,
            { $add: [{ $size: '$activeQuotations' }, { $size: '$approvedQuotations' }] }
          ]
        },
        pipelineStage: {
          $switch: {
            branches: [
              { case: { $gt: ['$convertedServiceCount', 0] }, then: 'converted' },
              { case: { $gt: [{ $size: '$approvedQuotations' }, 0] }, then: 'quotationApproved' },
              { case: { $gt: [{ $size: '$activeQuotations' }, 0] }, then: 'quotationOpen' },
              { case: { $gt: [{ $size: '$rejectedQuotations' }, 0] }, then: 'quotationClosed' }
            ],
            default: 'open'
          }
        },
        stalledQuotation: {
          $and: [
            { $eq: ['$convertedServiceCount', 0] },
            { $anyElementTrue: { $map: {
              input: '$quotations', as: 'quote',
              in: { $and: [
                { $in: [{ $toLower: { $ifNull: ['$$quote.status', ''] } }, ['draft', 'submitted', 'sent', 'approved']] },
                { $lt: [{ $ifNull: ['$$quote.quotationDate', '$$quote.createdAt'] }, stalledBefore] }
              ] }
            } } }
          ]
        },
        overdueFollowUp: {
          $or: [
            {
              $let: {
                vars: { followUpDate: { $convert: { input: '$nextFollowUpDate', to: 'date', onError: null, onNull: null } } },
                in: { $and: [{ $ne: ['$$followUpDate', null] }, { $lt: ['$$followUpDate', now] }] }
              }
            },
            {
              $anyElementTrue: {
                $map: {
                  input: { $ifNull: ['$serviceSelections', []] },
                  as: 'service',
                  in: {
                    $let: {
                      vars: { followUpDate: { $convert: { input: '$$service.nextFollowUpDate', to: 'date', onError: null, onNull: null } } },
                      in: {
                        $and: [
                          { $ne: ['$$followUpDate', null] }, { $lt: ['$$followUpDate', now] },
                          { $eq: [{ $ifNull: ['$$service.followUpClosedAt', null] }, null] },
                          { $eq: [{ $ifNull: ['$$service.closedAt', null] }, null] }
                        ]
                      }
                    }
                  }
                }
              }
            }
          ]
        }
      }
    },
    {
      $facet: {
        summary: [{
          $group: {
            _id: null,
            totalLeads: { $sum: 1 },
            oldLeads: { $sum: '$oldLead' },
            newLeads: { $sum: '$newLead' },
            convertedLeads: { $sum: { $cond: [{ $gt: ['$convertedServiceCount', 0] }, 1, 0] } },
            closedDeals: { $sum: '$convertedServiceCount' },
            confirmedRevenue: { $sum: '$confirmedRevenue' },
            oldBusinessLeads: { $sum: '$oldBusinessLead' },
            oldBusinessPoValue: { $sum: '$oldBusinessPoValue' },
            newBusinessLeads: { $sum: '$newBusinessLead' },
            newBusinessQuotationValue: { $sum: '$newBusinessQuotationValue' },
            newBusinessPoValue: { $sum: '$newBusinessPoValue' },
            approvedQuotationValue: { $sum: '$approvedQuotationValue' },
            approvedQuotations: { $sum: { $size: '$approvedQuotations' } },
            stalledQuotations: { $sum: { $cond: ['$stalledQuotation', 1, 0] } },
            overdueFollowUps: { $sum: { $cond: ['$overdueFollowUp', 1, 0] } }
          }
        }],
        managerPerformance: [
          {
            $group: {
              _id: '$dashboardOwnerId',
              leadOwnerName: { $first: { $ifNull: ['$owner.name', '$owner.email'] } },
              role: { $first: '$owner.role' },
              department: { $first: { $ifNull: ['$owner.team', 'No team assigned'] } },
              teamId: { $first: '$owner.teamId' },
              reportingManagerId: { $first: '$reportingManagerId' },
              reportingManagerName: { $first: { $ifNull: ['$reportingManager.name', '$reportingManager.email'] } },
              totalLeads: { $sum: 1 },
              oldLeads: { $sum: '$oldLead' },
              newLeads: { $sum: '$newLead' },
              openQuotations: { $sum: '$openQuotationCount' },
              approvedQuotations: { $sum: { $size: '$approvedQuotations' } },
              convertedToSale: { $sum: { $cond: [{ $gt: ['$convertedServiceCount', 0] }, 1, 0] } },
              closedDeals: { $sum: '$convertedServiceCount' },
              approvedQuotationValue: { $sum: '$approvedQuotationValue' },
              confirmedRevenue: { $sum: '$confirmedRevenue' },
              oldBusinessLeads: { $sum: '$oldBusinessLead' },
              oldBusinessPoValue: { $sum: '$oldBusinessPoValue' },
              newBusinessLeads: { $sum: '$newBusinessLead' },
              newBusinessQuotationValue: { $sum: '$newBusinessQuotationValue' },
              newBusinessPoValue: { $sum: '$newBusinessPoValue' },
              stalledQuotations: { $sum: { $cond: ['$stalledQuotation', 1, 0] } },
              overdueFollowUps: { $sum: { $cond: ['$overdueFollowUp', 1, 0] } }
            }
          },
          { $set: { conversionRate: { $cond: [{ $gt: ['$totalLeads', 0] }, { $multiply: [{ $divide: ['$convertedToSale', '$totalLeads'] }, 100] }, 0] } } },
          { $sort: { conversionRate: -1, totalLeads: -1 } }
        ],
        managerMonthlyTrend: [
          {
            $group: {
              _id: {
                managerId: '$dashboardOwnerId',
                month: periodExpression
              },
              totalLeads: { $sum: 1 },
              convertedLeads: { $sum: { $cond: [{ $gt: ['$convertedServiceCount', 0] }, 1, 0] } },
              revenue: { $sum: '$confirmedRevenue' }
            }
          },
          { $set: { conversionRate: { $cond: [{ $gt: ['$totalLeads', 0] }, { $multiply: [{ $divide: ['$convertedLeads', '$totalLeads'] }, 100] }, 0] } } },
          { $sort: { '_id.month': 1 } }
        ],
        monthlyTrend: [
          {
            $group: {
              _id: periodExpression,
              totalLeads: { $sum: 1 },
              open: { $sum: { $cond: [{ $eq: ['$pipelineStage', 'open'] }, 1, 0] } },
              quotationOpen: { $sum: { $cond: [{ $eq: ['$pipelineStage', 'quotationOpen'] }, 1, 0] } },
              quotationApproved: { $sum: { $cond: [{ $eq: ['$pipelineStage', 'quotationApproved'] }, 1, 0] } },
              converted: { $sum: { $cond: [{ $eq: ['$pipelineStage', 'converted'] }, 1, 0] } },
              quotationClosed: { $sum: { $cond: [{ $eq: ['$pipelineStage', 'quotationClosed'] }, 1, 0] } }
            }
          },
          { $set: { conversionRate: { $cond: [{ $gt: ['$totalLeads', 0] }, { $multiply: [{ $divide: ['$converted', '$totalLeads'] }, 100] }, 0] } } },
          { $sort: { _id: 1 } }
        ],
        departmentBreakdown: [
          {
            $group: {
              _id: { $ifNull: ['$owner.team', 'No team assigned'] },
              teamId: { $first: '$owner.teamId' },
              leadCount: { $sum: 1 },
              convertedLeads: { $sum: { $cond: [{ $gt: ['$convertedServiceCount', 0] }, 1, 0] } },
              closedDeals: { $sum: '$convertedServiceCount' },
              actual: { $sum: '$confirmedRevenue' },
              approvedQuotationValue: { $sum: '$approvedQuotationValue' }
            }
          },
          { $set: {
            conversionRate: { $cond: [{ $gt: ['$leadCount', 0] }, { $multiply: [{ $divide: ['$convertedLeads', '$leadCount'] }, 100] }, 0] },
            avgDealValue: { $cond: [{ $gt: ['$closedDeals', 0] }, { $divide: ['$actual', '$closedDeals'] }, 0] }
          } },
          { $sort: { leadCount: -1 } }
        ],
        leadDetails: [
          { $sort: { createdAt: -1 } },
          { $project: {
            _id: 0, leadId: { $toString: '$_id' }, leadCode: 1, company: 1, createdAt: 1,
            ownerName: { $ifNull: ['$owner.name', '$owner.email'] }, department: { $ifNull: ['$owner.team', 'No team assigned'] },
            pipelineStage: 1, convertedServiceCount: 1, confirmedRevenue: 1, approvedQuotationValue: 1,
            oldBusinessLead: 1, oldBusinessPoValue: 1, newBusinessLead: 1,
            newBusinessQuotationValue: 1, newBusinessPoValue: 1,
            quotationCount: { $size: '$quotations' }, approvedQuotationCount: { $size: '$approvedQuotations' }
          } }
        ]
      }
    }
  ];
  return pipeline;
}

function buildMonthlyCarryForwardAggregation({ end, department, ownerIds = [] }) {
  const initialMatch = { createdAt: { $lte: end }, recordStatus: { $ne: 'DELETED' } };
  if (ownerIds.length) {
    initialMatch.$or = [
      { generatedForUser: { $in: ownerIds } },
      { generatedForUser: null, createdBy: { $in: ownerIds } },
      { generatedForUser: { $exists: false }, createdBy: { $in: ownerIds } }
    ];
  }
  const ownerMatch = { 'owner.isActive': { $ne: false } };
  if (text(department)) {
    const escaped = text(department).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const departmentId = objectId(department);
    ownerMatch.$or = departmentId
      ? [{ 'owner.teamId': departmentId }, { 'owner.team': { $regex: `^${escaped}$`, $options: 'i' } }]
      : [{ 'owner.team': { $regex: `^${escaped}$`, $options: 'i' } }];
  }
  return [
    { $match: initialMatch },
    { $set: { dashboardOwnerId: { $ifNull: ['$generatedForUser', '$createdBy'] } } },
    { $lookup: { from: 'users', localField: 'dashboardOwnerId', foreignField: '_id', as: 'owner' } },
    { $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } },
    { $match: ownerMatch },
    { $set: { approvedAssignments: approvedAssignmentExpression() } },
    {
      $lookup: {
        from: 'pendingapprovals',
        let: { leadId: { $toString: '$_id' } },
        pipeline: [
          { $match: { type: 'purchase_order', approvalStatus: 'APPROVED', actionAt: { $ne: null } } },
          { $match: { $expr: { $eq: [{ $toString: '$payload.leadId' }, '$$leadId'] } } },
          { $project: { _id: 0, actionAt: 1 } }
        ],
        as: 'approvedPoDecisions'
      }
    },
    {
      $set: {
        closeCandidates: {
          $concatArrays: [
            { $map: { input: '$approvedPoDecisions', as: 'decision', in: '$$decision.actionAt' } },
            {
              $filter: {
                input: { $map: { input: '$approvedAssignments', as: 'assignment', in: { $convert: { input: '$$assignment.closedAt', to: 'date', onError: null, onNull: null } } } },
                as: 'date', cond: { $ne: ['$$date', null] }
              }
            }
          ]
        }
      }
    },
    {
      $project: {
        _id: 0, createdAt: 1,
        legacyBacklog: { $and: [{ $eq: ['$bulkImported', true] }, { $lte: ['$createdAt', LEGACY_BULK_CUTOFF] }] },
        closureDate: {
          $cond: [
            { $gt: [{ $size: '$closeCandidates' }, 0] }, { $min: '$closeCandidates' },
            { $cond: [{ $gt: [{ $size: '$approvedAssignments' }, 0] }, '$updatedAt', null] }
          ]
        }
      }
    }
  ];
}

function monthKeys(start, end) {
  const keys = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last && keys.length < 37) {
    keys.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

function weekKeys(start, end) {
  const keys = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const day = cursor.getUTCDay();
  cursor.setUTCDate(cursor.getUTCDate() - (day === 0 ? 6 : day - 1));
  while (cursor <= end && keys.length < 160) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return keys;
}

function periodKeys(start, end, interval = 'monthly') {
  return interval === 'weekly' ? weekKeys(start, end) : monthKeys(start, end);
}

function percentChange(current, previous) {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function formatMonthlyCarryForward(rows, period, interval = 'monthly') {
  return periodKeys(period.start, period.end, interval).map((month) => {
    const bucketStart = new Date(`${month}${interval === 'monthly' ? '-01' : ''}T00:00:00.000Z`);
    const nextBucket = interval === 'weekly'
      ? new Date(bucketStart.getTime() + (7 * DAY_MS))
      : new Date(Date.UTC(bucketStart.getUTCFullYear(), bucketStart.getUTCMonth() + 1, 1));
    const rangeStart = new Date(Math.max(bucketStart.getTime(), period.start.getTime()));
    const bucketEnd = new Date(Math.min(nextBucket.getTime() - 1, period.end.getTime()));
    const normalized = rows.map((row) => ({ createdAt: new Date(row.createdAt), closureDate: row.closureDate ? new Date(row.closureDate) : null, legacyBacklog: row.legacyBacklog === true }));
    const oldAtBucketStart = (row) => row.legacyBacklog ? rangeStart >= LEGACY_BACKLOG_START : row.createdAt < rangeStart;
    const availableInBucket = (row) => !row.legacyBacklog || rangeStart >= LEGACY_BACKLOG_START;
    const openingPending = normalized.filter((row) => availableInBucket(row) && oldAtBucketStart(row) && (!row.closureDate || row.closureDate >= rangeStart)).length;
    const newLeads = normalized.filter((row) => !row.legacyBacklog && row.createdAt >= rangeStart && row.createdAt <= bucketEnd).length;
    const closedFromOpening = normalized.filter((row) => availableInBucket(row) && oldAtBucketStart(row) && row.closureDate && row.closureDate >= rangeStart && row.closureDate <= bucketEnd).length;
    const closedFromNew = normalized.filter((row) => !row.legacyBacklog && row.createdAt >= rangeStart && row.createdAt <= bucketEnd && row.closureDate && row.closureDate <= bucketEnd).length;
    const closedThisMonth = closedFromOpening + closedFromNew;
    return {
      month, openingPending, newLeads, totalAvailable: openingPending + newLeads,
      closedFromOpening, closedFromNew, closedThisMonth,
      closingPending: Math.max(0, openingPending + newLeads - closedThisMonth)
    };
  });
}

function rounded(value, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function formatAggregation(result, period, interval = 'monthly') {
  const rawSummary = result?.summary?.[0] || {};
  const totalLeads = Number(rawSummary.totalLeads) || 0;
  const convertedLeads = Number(rawSummary.convertedLeads) || 0;
  const summary = {
    totalLeads,
    oldLeads: Number(rawSummary.oldLeads) || 0,
    newLeads: Number(rawSummary.newLeads) || 0,
    conversionRate: totalLeads ? rounded((convertedLeads / totalLeads) * 100) : 0,
    convertedLeads,
    totalRevenue: rounded(rawSummary.confirmedRevenue, 2),
    confirmedRevenue: rounded(rawSummary.confirmedRevenue, 2),
    oldBusinessLeads: Number(rawSummary.oldBusinessLeads) || 0,
    oldBusinessPoValue: rounded(rawSummary.oldBusinessPoValue, 2),
    newBusinessLeads: Number(rawSummary.newBusinessLeads) || 0,
    newBusinessQuotationValue: rounded(rawSummary.newBusinessQuotationValue, 2),
    newBusinessPoValue: rounded(rawSummary.newBusinessPoValue, 2),
    approvedQuotationValue: rounded(rawSummary.approvedQuotationValue, 2),
    approvedQuotations: Number(rawSummary.approvedQuotations) || 0,
    closedDeals: Number(rawSummary.closedDeals) || 0
  };
  const managerTrendMap = (result?.managerMonthlyTrend || []).reduce((map, row) => {
    const key = text(row?._id?.managerId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ month: row?._id?.month, conversionRate: rounded(row.conversionRate), revenue: rounded(row.revenue, 2) });
    return map;
  }, new Map());
  const managerPerformance = (result?.managerPerformance || []).map((row) => {
    const conversionRate = rounded(row.conversionRate);
    const status = row.totalLeads < 3 ? 'warning' : conversionRate >= ACTIVE_THRESHOLD ? 'active' : conversionRate >= WARNING_THRESHOLD ? 'warning' : 'at-risk';
    return {
      managerId: text(row._id), leadOwnerId: text(row._id),
      managerName: row.leadOwnerName || 'Unassigned owner', leadOwnerName: row.leadOwnerName || 'Unassigned owner',
      reportingManagerId: text(row.reportingManagerId), reportingManagerName: row.reportingManagerName || '-', role: row.role || '-',
      teamId: text(row.teamId), department: row.department || 'No team assigned', totalLeads: Number(row.totalLeads) || 0,
      oldLeads: Number(row.oldLeads) || 0, newLeads: Number(row.newLeads) || 0,
      openQuotations: Number(row.openQuotations) || 0, approvedQuotations: Number(row.approvedQuotations) || 0,
      convertedToSale: Number(row.convertedToSale) || 0, closedDeals: Number(row.closedDeals) || 0,
      conversionRate, approvedQuotationValue: rounded(row.approvedQuotationValue, 2), confirmedRevenue: rounded(row.confirmedRevenue, 2),
      oldBusinessLeads: Number(row.oldBusinessLeads) || 0, oldBusinessPoValue: rounded(row.oldBusinessPoValue, 2),
      newBusinessLeads: Number(row.newBusinessLeads) || 0, newBusinessQuotationValue: rounded(row.newBusinessQuotationValue, 2),
      newBusinessPoValue: rounded(row.newBusinessPoValue, 2),
      stalledQuotations: Number(row.stalledQuotations) || 0, overdueFollowUps: Number(row.overdueFollowUps) || 0,
      status, monthlyTrend: managerTrendMap.get(text(row._id)) || []
    };
  });
  const trendMap = new Map((result?.monthlyTrend || []).map((row) => [row._id, row]));
  const monthlyTrend = periodKeys(period.start, period.end, interval).map((month) => {
    const row = trendMap.get(month) || {};
    return {
      month, open: Number(row.open) || 0, quotationOpen: Number(row.quotationOpen) || 0,
      quotationApproved: Number(row.quotationApproved) || 0, converted: Number(row.converted) || 0,
      closed: Number(row.converted) || 0, quotationClosed: Number(row.quotationClosed) || 0,
      conversionRate: rounded(row.conversionRate)
    };
  });
  const departmentBreakdown = (result?.departmentBreakdown || []).map((row) => ({
    teamId: text(row.teamId), department: row._id || 'No team assigned', leadCount: Number(row.leadCount) || 0,
    convertedLeads: Number(row.convertedLeads) || 0, closedDeals: Number(row.closedDeals) || 0,
    conversionRate: rounded(row.conversionRate), avgDealValue: rounded(row.avgDealValue, 2),
    approvedQuotationValue: rounded(row.approvedQuotationValue, 2), target: null, actual: rounded(row.actual, 2), attainmentRate: null
  }));
  return {
    summary, managerPerformance, monthlyTrend, departmentBreakdown, leadDetails: result?.leadDetails || [],
    stalledQuotations: Number(rawSummary.stalledQuotations) || 0,
    overdueFollowUps: Number(rawSummary.overdueFollowUps) || 0
  };
}

async function visibleOwnerIds(requester) {
  if (userHasAnyRole(requester, ADMIN_ROLES)) return [];
  const requesterId = objectId(requester?._id || requester?.id);
  if (!requesterId) return [];
  if (userHasAnyRole(requester, ['manager'])) {
    const reports = await User.find({ managerId: requesterId }).distinct('_id');
    return [requesterId, ...reports];
  }
  if (userHasAnyRole(requester, ['operation head', 'operations head'])) {
    const teams = await Team.find({ operationHead: requesterId }).select('manager members').lean();
    return [...new Map([requesterId, ...teams.flatMap((team) => [team.manager, ...(team.members || [])])].filter(Boolean).map((id) => [text(id), id])).values()];
  }
  return [requesterId];
}

async function getSalesManagementDashboard({ dateFrom, dateTo, department, managerId, interval = 'monthly', requester, includeLeadDetails = false }) {
  const period = parseDateRange(dateFrom, dateTo);
  if (!['weekly', 'monthly'].includes(interval)) throw Object.assign(new Error('interval must be weekly or monthly.'), { statusCode: 400 });
  if (text(managerId) && !objectId(managerId)) throw Object.assign(new Error('managerId must be a valid identifier.'), { statusCode: 400 });
  const ownerIds = await visibleOwnerIds(requester);
  const duration = period.end.getTime() - period.start.getTime() + 1;
  const previousEnd = new Date(period.start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - duration + 1);
  const [currentRows, previousRows, departments, carryForwardRows] = await Promise.all([
    Lead.aggregate(buildSalesManagementAggregation({ ...period, department, managerId, ownerIds, interval })).option({ maxTimeMS: 30000 }),
    Lead.aggregate(buildSalesManagementAggregation({ start: previousStart, end: previousEnd, department, managerId, ownerIds, interval })).option({ maxTimeMS: 30000 }),
    User.distinct('team', { ...(ownerIds.length ? { _id: { $in: ownerIds } } : {}), isActive: { $ne: false } }),
    Lead.aggregate(buildMonthlyCarryForwardAggregation({ ...period, department, ownerIds })).option({ maxTimeMS: 30000 })
  ]);
  const current = formatAggregation(currentRows[0] || {}, period, interval);
  const previous = formatAggregation(previousRows[0] || {}, { start: previousStart, end: previousEnd }, interval);
  current.summary.previousPeriod = {
    totalLeadsChangePct: rounded(percentChange(current.summary.totalLeads, previous.summary.totalLeads)),
    conversionRateChange: rounded(current.summary.conversionRate - previous.summary.conversionRate),
    revenueChangePct: rounded(percentChange(current.summary.confirmedRevenue, previous.summary.confirmedRevenue))
  };
  const lowConversionManagers = current.managerPerformance.filter((row) => row.status === 'at-risk').length;
  const topManagers = [...current.managerPerformance].sort((a, b) => b.conversionRate - a.conversionRate || b.confirmedRevenue - a.confirmedRevenue).slice(0, 3);
  const recommendations = [];
  if (current.stalledQuotations) recommendations.push(`Prioritize ${current.stalledQuotations} quotation${current.stalledQuotations === 1 ? '' : 's'} awaiting action for more than 30 days.`);
  if (current.overdueFollowUps) recommendations.push(`Resolve ${current.overdueFollowUps} overdue lead follow-up${current.overdueFollowUps === 1 ? '' : 's'} and record the next action.`);
  if (lowConversionManagers) recommendations.push(`Review coaching and lead allocation for ${lowConversionManagers} at-risk manager${lowConversionManagers === 1 ? '' : 's'}.`);
  if (!recommendations.length) recommendations.push('Maintain the current follow-up cadence and monitor approved quotations awaiting purchase orders.');
  const response = {
    summary: current.summary,
    managerPerformance: current.managerPerformance,
    monthlyTrend: current.monthlyTrend,
    monthlyCarryForward: formatMonthlyCarryForward(carryForwardRows, period, interval),
    departmentBreakdown: current.departmentBreakdown,
    riskIndicators: { stalledQuotations: current.stalledQuotations, lowConversionManagers, overdueFollowUps: current.overdueFollowUps },
    insights: { topManagers, recommendations },
    meta: {
      dateFrom: period.from, dateTo: period.to, interval, currency: 'INR', timezone: 'Asia/Kolkata', refreshAfterSeconds: 300,
      departments: departments.filter(Boolean).sort(),
      definitions: {
        conversion: 'A distinct lead with at least one admin-approved PO service.',
        closedDeal: 'A service assignment with an admin-approved PO.',
        revenue: 'Sum of PO amounts on admin-approved service assignments.',
        quotationValue: 'Sum of approved quotation grand totals; not added to revenue.',
        oldBusiness: 'Approved PO rows with PO value above zero and CRM quotation value equal to zero.',
        newBusiness: 'Approved PO rows with both CRM quotation value and PO value above zero.',
        oldLead: `Historical bulk-imported leads saved through ${LEGACY_BULK_CUTOFF.toISOString().slice(0, 10)}.`,
        newLead: `Leads created normally after the historical import cutoff of ${LEGACY_BULK_CUTOFF.toISOString().slice(0, 10)}.`,
        legacyLead: `Bulk-imported leads saved through ${LEGACY_BULK_CUTOFF.toISOString().slice(0, 10)} are opening backlog from ${LEGACY_BACKLOG_START.toISOString().slice(0, 10)}.`
      },
      legacyBulkCutoff: LEGACY_BULK_CUTOFF.toISOString().slice(0, 10),
      legacyBacklogStart: LEGACY_BACKLOG_START.toISOString().slice(0, 10),
      statusThresholds: { activeAtOrAbove: ACTIVE_THRESHOLD, warningAtOrAbove: WARNING_THRESHOLD }
    }
  };
  if (includeLeadDetails || text(managerId)) response.leadDetails = current.leadDetails;
  return response;
}

module.exports = {
  buildMonthlyCarryForwardAggregation,
  buildSalesManagementAggregation,
  formatAggregation,
  formatMonthlyCarryForward,
  getSalesManagementDashboard,
  parseDateRange
};
