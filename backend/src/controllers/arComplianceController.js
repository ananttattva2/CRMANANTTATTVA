const mongoose = require('mongoose');
const Client = require('../models/Client');
const AnnualReturn = require('../models/AnnualReturn');
const PurchaseData = require('../models/PurchaseData');
const SalesData = require('../models/SalesData');
const PurchaseRows = require('../models/PurchaseImportRow');
const SalesRows = require('../models/SalesImportRow');
const Review = require('../models/ArComplianceReview');
const {
  buildSections,
  reviewState,
  validateDecision,
  readyModule,
  sourceRevision,
  workflowState
} = require('../services/arCompliance');
const {
  userHasAnyRole
} = require('../utils/userRoles');
const yearKey = value => String(value || '').replace(/^FY\s*/i, '').trim();
const nameOf = client => client.data?.basic?.clientLegalName || client.data?.basic?.tradeName || client.selectedLead?.company || 'Client';
const readyFilter = {
  'baseUpload.importStatus': 'Imported',
  'portalUpload.importStatus': 'Imported'
};
async function clientScope(user) {
  return userHasAnyRole(user, ['admin', 'superadmin', 'compliance']) ? {} : require('./clientController').clientAccessFilter(user);
}
function filingsFor(client, records = []) {
  return Object.assign({}, ...records.map(record => ({
    ...(record.filings || {}),
    ...(record.annualYear && Object.keys(record.draft || {}).length ? {
      [record.annualYear]: {
        draft: record.draft
      }
    } : {})
  })), client.data?.annualReturn?.filings || {});
}
function actorStage(user, workflow) {
  if (userHasAnyRole(user, ['admin', 'superadmin'])) return workflow.stage.startsWith('MANAGER') ? 'manager' : 'compliance';
  return userHasAnyRole(user, ['manager']) && (!userHasAnyRole(user, ['compliance']) || workflow.stage.startsWith('MANAGER')) ? 'manager' : 'compliance';
}
async function source(req) {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return null;
  const client = await Client.findOne({
    $and: [{
      _id: req.params.id
    }, await clientScope(req.user)]
  }).populate('selectedLead', 'company leadCode').lean();
  if (!client) return null;
  const records = await AnnualReturn.find({
    client: client._id
  }).sort({
    updatedAt: 1,
    _id: 1
  }).lean();
  const filings = filingsFor(client, records);
  const [purchaseYears, salesYears] = await Promise.all([PurchaseData.find({
    clientId: client._id,
    ...readyFilter
  }).select('financialYear').lean(), SalesData.find({
    clientId: client._id,
    ...readyFilter
  }).select('financialYear').lean()]);
  const years = [...new Set([...purchaseYears, ...salesYears].map(row => yearKey(row.financialYear)))].filter(Boolean).sort().reverse();
  const financialYear = yearKey(req.query.financialYear || req.body?.financialYear || years[0]);
  if (!years.includes(financialYear)) return {
    client,
    years,
    financialYear: '',
    sections: []
  };
  const filter = {
    clientId: client._id,
    financialYear
  };
  const [purchase, sales, purchaseRows, salesRows] = await Promise.all([PurchaseData.findOne(filter).lean(), SalesData.findOne(filter).lean(), PurchaseRows.find(filter).select('-original -createdBy -createdAt -updatedAt -__v -clientId -financialYear -uploadId').sort({
    source: 1,
    rowNumber: 1,
    _id: 1
  }).lean(), SalesRows.find(filter).select('-original -createdBy -createdAt -updatedAt -__v -clientId -financialYear -uploadId').sort({
    source: 1,
    rowNumber: 1,
    _id: 1
  }).lean()]);
  const filing = Object.entries(filings).find(([key]) => yearKey(key) === financialYear)?.[1];
  const inputs = {
    draft: filing?.draft || {},
    purchase,
    sales,
    purchaseRows,
    salesRows
  };
  return {
    client,
    years,
    financialYear,
    sections: buildSections(inputs),
    revision: sourceRevision(inputs)
  };
}
async function load(req) {
  const data = await source(req);
  if (!data) return null;
  const review = data.financialYear ? await Review.findOne({
    client: data.client._id,
    financialYear: data.financialYear
  }).lean() : null;
  const saved = review || {};
  const fingerprint = reviewState(data.sections, saved).sourceFingerprint;
  const workflow = workflowState(saved, fingerprint);
  const reviewStage = actorStage(req.user, workflow);
  const canReview = reviewStage === 'manager' ? workflow.stage.startsWith('MANAGER') : ['COMPLIANCE_REVIEW', 'COMPLETED'].includes(workflow.stage);
  return {
    ...data,
    review: saved,
    ...reviewState(data.sections, saved, reviewStage),
    workflow,
    reviewStage,
    canReview: Boolean(data.sections.length && canReview)
  };
}
function publicPayload(data) {
  const manager = data.reviewStage === 'manager';
  return {
    client: {
      _id: data.client._id,
      name: nameOf(data.client),
      code: data.client.data?.importMeta?.uniqueId || data.client.selectedLead?.leadCode || '-'
    },
    years: data.years,
    financialYear: data.financialYear,
    sections: data.sections,
    progress: data.progress,
    sourceFingerprint: data.sourceFingerprint,
    status: data.workflow.stage === 'MANAGER_REJECTED' ? 'REJECTED' : data.workflow.complianceStatus === 'NOT_READY' ? 'PENDING' : data.workflow.complianceStatus,
    workflow: data.workflow,
    reviewStage: data.reviewStage,
    canReview: data.canReview,
    managerDecision: {
      status: data.workflow.managerStatus,
      remarks: data.review.managerFinalRemarks || '',
      by: data.review.managerDecidedByName || '-',
      at: data.review.managerDecidedAt || null
    },
    finalRemarks: manager ? data.review.managerFinalRemarks || '' : data.review.finalRemarks || '',
    decidedAt: manager ? data.review.managerDecidedAt || null : data.review.decidedAt || null
  };
}
const wrap = fn => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (error) {
    next(error);
  }
};
exports.list = wrap(async (req, res) => {
  const clients = await Client.find(await clientScope(req.user)).select('data.basic data.importMeta data.annualReturn.filings selectedLead').populate('selectedLead', 'company').lean();
  const ids = clients.map(client => client._id);
  const [annuals, purchases, sales, reviews] = await Promise.all([AnnualReturn.find({
    client: {
      $in: ids
    }
  }).sort({
    updatedAt: 1,
    _id: 1
  }).lean(), PurchaseData.find({
    clientId: {
      $in: ids
    },
    ...readyFilter
  }).lean(), SalesData.find({
    clientId: {
      $in: ids
    },
    ...readyFilter
  }).lean(), Review.find({
    client: {
      $in: ids
    }
  }).populate('decidedBy', 'name email').lean()]);
  const rows = clients.flatMap(client => {
    const same = id => String(id) === String(client._id);
    const ownPurchase = purchases.filter(row => same(row.clientId) && readyModule(row));
    const ownSales = sales.filter(row => same(row.clientId) && readyModule(row));
    const years = new Set([...ownPurchase, ...ownSales].map(row => yearKey(row.financialYear)));
    const filings = filingsFor(client, annuals.filter(row => same(row.client)));
    return [...years].filter(Boolean).sort().reverse().map(financialYear => {
      const review = reviews.find(row => same(row.client) && row.financialYear === financialYear) || {};
      const filing = Object.entries(filings).find(([year]) => yearKey(year) === financialYear)?.[1];
      const revision = sourceRevision({
        draft: filing?.draft || {},
        purchase: ownPurchase.find(row => yearKey(row.financialYear) === financialYear),
        sales: ownSales.find(row => yearKey(row.financialYear) === financialYear)
      });
      const workflow = workflowState({
        ...review,
        managerSourceFingerprint: review.managerSourceRevision,
        sourceFingerprint: review.sourceRevision
      }, revision);
      const manager = workflow.stage.startsWith('MANAGER');
      return {
        clientId: client._id,
        clientName: nameOf(client),
        financialYear,
        status: workflow.stage === 'MANAGER_REJECTED' ? 'REJECTED' : manager ? 'PENDING' : workflow.complianceStatus,
        ...workflow,
        decisionBy: manager ? review.managerDecidedByName || '-' : review.decidedBy?.name || review.decidedBy?.email || '-',
        reviewedAt: manager ? review.managerDecidedAt || null : review.decidedAt || null
      };
    });
  });
  res.json({
    rows
  });
});
exports.get = wrap(async (req, res) => {
  const data = await load(req);
  if (!data) return res.status(404).json({
    error: 'Client not found or unavailable.'
  });
  res.json(publicPayload(data));
});
exports.saveField = wrap(async (req, res) => {
  const data = await load(req);
  if (!data) return res.status(404).json({
    error: 'Client not found or unavailable.'
  });
  if (!data.canReview || req.body.reviewStage !== data.reviewStage) return res.status(403).json({
    error: 'Manager must approve this AR data before Compliance review. Only the current stage reviewer can save.'
  });
  const field = data.sections.flatMap(section => section.fields).find(item => item.key === req.body.key);
  if (!field || field.fingerprint !== req.body.fingerprint) return res.status(409).json({
    error: 'This field changed. Reload the saved data before reviewing it.'
  });
  const {
    status,
    remarks
  } = req.body;
  if (!['VERIFIED', 'CHANGES_REQUIRED'].includes(status) || typeof remarks !== 'string' || !remarks.trim() || remarks.length > 2000) return res.status(400).json({
    error: 'Select a review status and enter field remarks (up to 2000 characters).'
  });
  try {
    await Review.updateOne({
      client: data.client._id,
      financialYear: data.financialYear
    }, {
      $setOnInsert: {
        fields: []
      }
    }, {
      upsert: true
    });
  } catch (error) {
    if (error.code !== 11000) throw error; // Another reviewer created this year's record first.
  }
  const fieldPath = data.reviewStage === 'manager' ? 'managerFields' : 'fields';
  const stageUpdates = data.reviewStage === 'manager' ? {
    managerStatus: 'IN_REVIEW',
    managerSourceFingerprint: '',
    managerSourceRevision: ''
  } : {
    status: 'IN_REVIEW'
  };
  // Atomic replacement prevents simultaneous reviews of different fields or tables from being lost.
  await Review.updateOne({
    client: data.client._id,
    financialYear: data.financialYear
  }, [{
    $set: {
      [fieldPath]: {
        $concatArrays: [{
          $filter: {
            input: {
              $ifNull: [`$${fieldPath}`, []]
            },
            as: 'field',
            cond: {
              $ne: ['$$field.key', {
                $literal: field.key
              }]
            }
          }
        }, {
          $literal: [{
            key: field.key,
            fingerprint: field.fingerprint,
            status,
            remarks: remarks.trim(),
            reviewedBy: req.user._id,
            reviewedAt: new Date()
          }]
        }]
      },
      ...stageUpdates,
      sourceFingerprint: data.sourceFingerprint,
      sourceRevision: data.revision,
      updatedAt: new Date(),
      history: {
        $concatArrays: [{
          $ifNull: ['$history', []]
        }, {
          $literal: [{
            action: 'ITEM_REVIEW',
            stage: data.reviewStage,
            key: field.key,
            status,
            remarks: remarks.trim(),
            by: req.user._id,
            at: new Date()
          }]
        }]
      }
    }
  }]);
  res.json(publicPayload(await load(req)));
});
exports.decide = wrap(async (req, res) => {
  const data = await load(req);
  if (!data) return res.status(404).json({
    error: 'Client not found or unavailable.'
  });
  if (!data.canReview || req.body.reviewStage !== data.reviewStage) return res.status(403).json({
    error: 'This decision is not available at the current review stage.'
  });
  if (data.sourceFingerprint !== req.body.sourceFingerprint) return res.status(409).json({
    error: 'Saved data changed. Reload and review the changed fields.'
  });
  const error = validateDecision(req.body.decision, req.body.remarks, data, data.reviewStage);
  if (error) return res.status(400).json({
    error
  });
  const manager = data.reviewStage === 'manager';
  const updates = manager ? {
    managerStatus: req.body.decision,
    managerSourceFingerprint: data.sourceFingerprint,
    managerSourceRevision: data.revision,
    managerFinalRemarks: req.body.remarks.trim(),
    managerDecidedBy: req.user._id,
    managerDecidedByName: req.user.name || req.user.email || 'Manager',
    managerDecidedAt: new Date(),
    status: 'PENDING'
  } : {
    status: req.body.decision,
    sourceFingerprint: data.sourceFingerprint,
    sourceRevision: data.revision,
    finalRemarks: req.body.remarks.trim(),
    decidedBy: req.user._id,
    decidedAt: new Date()
  };
  let reviewUpdatedAt = data.review.updatedAt;
  if (!reviewUpdatedAt) {
    try {
      await Review.updateOne({
        client: data.client._id,
        financialYear: data.financialYear
      }, {
        $setOnInsert: {
          fields: [],
          managerFields: []
        }
      }, {
        upsert: true
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    const initialized = await Review.findOne({
      client: data.client._id,
      financialYear: data.financialYear
    }).lean();
    reviewUpdatedAt = initialized.updatedAt;
  }
  const result = await Review.updateOne({
    client: data.client._id,
    financialYear: data.financialYear,
    updatedAt: reviewUpdatedAt
  }, {
    $set: updates,
    $push: {
      history: {
        action: 'DECISION',
        stage: data.reviewStage,
        status: req.body.decision,
        remarks: req.body.remarks.trim(),
        by: req.user._id,
        at: new Date()
      }
    }
  });
  if (!result.matchedCount) return res.status(409).json({
    error: 'Another reviewer updated this review. Reload before deciding.'
  });
  res.json(publicPayload(await load(req)));
});
