const {
  createHash
} = require('node:crypto');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const label = key => String(key).replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[_.-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const ignored = new Set(['_id', '__v', 'createdAt', 'updatedAt', 'savedAt', 'updatedBy', 'createdBy', 'approvalWorkflow', 'reviewHistory', 'original']);
function readyModule(data) {
  return data?.baseUpload?.importStatus === 'Imported' && data?.portalUpload?.importStatus === 'Imported';
}
function safeValue(value) {
  if (value && typeof value.toHexString === 'function') return value.toHexString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(safeValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => !ignored.has(key) && !key.startsWith('__')).map(key => [key, safeValue(value[key])]));
  return value ?? '';
}
function table(key, title, rows = [], columns) {
  const safeRows = rows.map(safeValue);
  const keys = columns || [...new Set(safeRows.flatMap(row => Object.keys(row && typeof row === 'object' ? row : {
    value: row
  })))];
  return {
    key,
    label: title,
    kind: 'table',
    rows: safeRows.map(row => row && typeof row === 'object' ? row : {
      value: row
    }),
    columns: keys.map(column => ({
      key: column,
      label: label(column)
    }))
  };
}
function flatten(value, path = [], result = []) {
  if (Array.isArray(value)) {
    result.push(table(JSON.stringify(path), path.map(label).join(' / '), value));
  } else if (value && typeof value === 'object') {
    const url = value.secureUrl || value.url;
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) result.push({
      key: JSON.stringify(path),
      label: path.map(label).join(' / '),
      value: value.name || value.fileName || 'Supporting document',
      url
    });else Object.keys(value).sort().filter(key => !ignored.has(key) && !key.startsWith('__')).forEach(key => flatten(value[key], [...path, key], result));
  } else result.push({
    key: JSON.stringify(path),
    label: path.map(label).join(' / '),
    value: value ?? '',
    ...(typeof value === 'string' && /^https?:\/\//i.test(value) ? {
      url: value
    } : {})
  });
  return result;
}
function moduleSource(data) {
  return Object.fromEntries(['checklist', 'screenshots', 'userRemarks', 'baseUpload', 'portalUpload', 'reconciliation', 'dataVersion'].map(key => [key, safeValue(data?.[key])]));
}
function sourceRevision({
  draft = {},
  purchase,
  sales
}) {
  return hash({
    draft: safeValue(draft),
    purchase: readyModule(purchase) ? moduleSource(purchase) : null,
    sales: readyModule(sales) ? moduleSource(sales) : null
  });
}
function buildSections({
  draft = {},
  purchase = null,
  sales = null,
  purchaseRows = [],
  salesRows = []
}) {
  if (!readyModule(purchase) && !readyModule(sales)) return [];
  const groups = new Map();
  const names = {
    basic: 'Basic Info',
    financials: 'Financial Details',
    data: 'Data Compliance',
    brandOwner: 'Brand Owner',
    importer: 'Importer',
    annual: 'Annual Filing',
    cpcbLetter: 'CPCB Letter',
    purchaseOrderConfirmation: 'Purchase Order Confirmation'
  };
  Object.keys(draft).sort().filter(key => !ignored.has(key) && !key.startsWith('__')).forEach(key => {
    const prefix = key.split('.')[0],
      group = names[prefix] ? prefix : 'details';
    if (!groups.has(group)) groups.set(group, {
      key: `annual:${group}`,
      label: names[group] || 'Annual Return Details',
      fields: []
    });
    groups.get(group).fields.push(...flatten(draft[key], [key]));
  });
  const sections = [...groups.values()];
  for (const [key, data, rows] of [['purchase', purchase, purchaseRows], ['sales', sales, salesRows]]) {
    if (!readyModule(data)) continue;
    const title = label(key),
      summary = data.reconciliation || {};
    const checklist = (data.checklist || []).filter(row => !['partially data received', 'complete data received', 'work in process', 'partially complete'].includes(String(row.particular || '').toLowerCase()));
    const fields = [{
      ...table('checklist', `${title} Upload Tracker`, checklist, ['particular', 'yesNo', 'date', 'partialDataReceived', 'completeDataReceived', 'files', 'remarks']),
      kind: 'tracker'
    }, ...['base', 'portal'].map(source => ({
      key: `${source}Upload`,
      label: `${title} ${source === 'base' ? 'Base Data Excel' : 'Portal Upload Excel'}`,
      kind: 'upload',
      upload: safeValue(data[`${source}Upload`])
    })), {
      key: 'summary',
      label: `${title} Upload Summary`,
      kind: 'summary',
      totals: safeValue(summary.totals || {}),
      categories: safeValue(summary.categorySummary || {})
    }, ...['Registered', 'Unregistered'].map(type => table(`entities:${type}`, `${type} Entity List`, summary.entitySummary?.[type] || [], ['name', 'gstin', 'baseQty', 'portalQty', 'qtyDiff', 'gstDiff', 'result'])), table('issues', 'Validation & Reconciliation Issues', summary.issues || []), ...['base', 'portal'].map(source => table(`excel:${source}`, `${title} ${source === 'base' ? 'Base' : 'Portal'} Excel Table`, rows.filter(row => row.source === source), ['rowNumber', 'entityName', 'registrationType', 'gstin', 'invoiceNumber', 'invoiceDate', 'plasticCategory', 'materialType', 'quantity', 'gstPaid', 'state', 'remarks', 'validationStatus'])), table('screenshots', 'Supporting Screenshots', data.screenshots || []), {
      key: 'remarks',
      label: 'User Remarks',
      value: data.userRemarks || ''
    }];
    sections.push({
      key,
      label: `${title} Data`,
      fields
    });
  }
  return sections.filter(section => section.fields.length).map(section => ({
    ...section,
    fields: section.fields.map(field => {
      const key = JSON.stringify([section.key, field.key]);
      return {
        ...field,
        key,
        fingerprint: hash(safeValue({
          ...field,
          key
        }))
      };
    })
  }));
}
function reviewState(sections, review = {}, reviewStage = 'compliance') {
  const saved = new Map((reviewStage === 'manager' ? review.managerFields || [] : review.fields || []).map(field => [field.key, field]));
  const sourceFingerprint = hash(sections.map(section => [section.key, section.fields.map(field => field.fingerprint)]));
  const enriched = sections.map(section => ({
    ...section,
    fields: section.fields.map(field => {
      const previous = saved.get(field.key);
      const current = previous?.fingerprint === field.fingerprint;
      return {
        ...field,
        review: current ? previous : {
          status: 'NOT_REVIEWED',
          remarks: '',
          stale: Boolean(previous)
        }
      };
    })
  }));
  const fields = enriched.flatMap(section => section.fields);
  const verified = fields.filter(field => field.review.status === 'VERIFIED').length;
  const reviewed = fields.filter(field => field.review.status !== 'NOT_REVIEWED').length;
  return {
    sections: enriched,
    sourceFingerprint,
    status: reviewStage === 'manager' ? review.managerStatus || 'PENDING' : review.sourceFingerprint && review.sourceFingerprint !== sourceFingerprint ? 'IN_REVIEW' : review.status || 'PENDING',
    progress: {
      total: fields.length,
      verified,
      reviewed,
      issues: reviewed - verified,
      percentage: fields.length ? Math.round(verified / fields.length * 100) : 0
    }
  };
}
function validateDecision(decision, remarks, state, reviewStage = 'compliance') {
  if (reviewStage === 'manager' && !['APPROVED', 'REJECTED'].includes(decision)) return 'Manager must select Approve or Reject.';
  if (!['APPROVED', 'PARTIALLY_APPROVED', 'REJECTED'].includes(decision)) return 'Select Approve, Reject or Partially Approve.';
  if (typeof remarks !== 'string' || !remarks.trim() || remarks.length > 2000) return 'Enter final remarks (up to 2000 characters).';
  if (!state.progress.total) return 'No annual-return data is available for review.';
  return '';
}
function workflowState(review, fingerprint) {
  const managerCurrent = review.managerSourceFingerprint === fingerprint;
  if (!managerCurrent || !['APPROVED', 'REJECTED'].includes(review.managerStatus)) return {
    stage: 'MANAGER_REVIEW',
    stageLabel: 'Manager Review',
    managerStatus: 'PENDING',
    complianceStatus: 'NOT_READY'
  };
  if (review.managerStatus === 'REJECTED') return {
    stage: 'MANAGER_REJECTED',
    stageLabel: 'Manager Rejected',
    managerStatus: 'REJECTED',
    complianceStatus: 'NOT_READY'
  };
  const complianceCurrent = review.sourceFingerprint === fingerprint;
  const complete = complianceCurrent && ['APPROVED', 'PARTIALLY_APPROVED', 'REJECTED'].includes(review.status);
  return {
    stage: complete ? 'COMPLETED' : 'COMPLIANCE_REVIEW',
    stageLabel: complete ? 'Compliance Decision Saved' : 'Compliance Review',
    managerStatus: 'APPROVED',
    complianceStatus: complete ? review.status : 'PENDING'
  };
}
module.exports = {
  buildSections,
  reviewState,
  validateDecision,
  readyModule,
  sourceRevision,
  workflowState
};
