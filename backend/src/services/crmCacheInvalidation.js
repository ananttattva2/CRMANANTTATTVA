const { invalidateCrmCache } = require('./crmCache');
const trackedModels = new Set([
  'Lead', 'TemporaryLead', 'Quotation', 'Client', 'Team', 'User', 'Role',
  'PendingApproval', 'AnnualReturn', 'ProformaInvoice', 'PurchaseData', 'SalesData',
  'PurchaseImportRow', 'SalesImportRow', 'PurchaseProof', 'ClientComplianceReview',
  'ArComplianceReview', 'ClientDeactivation', 'HealthReportAssignment',
  'SupportTicket', 'InternalTicket', 'CalendarItem', 'LeadAssignmentOverride'
]);

// Register before models are imported. Await post-write invalidation, including
// scheduler writes, rather than waiting for an HTTP response 'finish' event.
function cacheInvalidationPlugin(schema, options = {}) {
  const invalidateCache = options.invalidate || invalidateCrmCache;
  async function invalidate(result) {
    // Repeated milestone claims match no document. No-op writes must not
    // rotate the global revision and discard every user's warm dashboard.
    if (result === null) return;
    if (result?.modifiedCount === 0 && !result.upsertedCount && !result.upsertedId) return;
    if (result?.deletedCount === 0) return;
    const modelName = this.model?.modelName || this.constructor?.modelName || this.modelName;
    if (trackedModels.has(modelName)) await invalidateCache();
  }
  schema.post('save', invalidate);
  schema.post('insertMany', invalidate);
  for (const operation of ['updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete', 'deleteOne', 'deleteMany']) {
    schema.post(operation, invalidate);
  }
}

function createWriteInvalidation(invalidateCache = invalidateCrmCache) {
  return function writeInvalidation(req, res, next) {
    const path = req.originalUrl.split('?')[0];
    const mutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    const skipped = /^\/api\/auth\/(?:activity-heartbeat|request-otp|resend-otp|verify-otp|logout|forgot-password|reset-password)(?:\/|$)/.test(path);
    const milestoneCheck = /^\/api\/auth\/milestones\/[^/]+\/claim$/.test(path);
    // Genuine milestone writes are covered by the User model post-write hook.
    if (!mutation || /^\/api\/client-portal(?:\/|$)/.test(path) || skipped || milestoneCheck || /^\/api\/(?:assets|notifications)(?:\/|$)/.test(path)) return next();
    const originalJson = res.json.bind(res);
    res.json = async body => {
      if ([401, 403].includes(res.statusCode)) return originalJson(body);
      // Covers native collection writes and bulkWrite (no Mongoose middleware in
      // Mongoose 7), integration imports, and multi-record partial failures too.
      const revision = await invalidateCache();
      if (revision) res.set('X-CRM-Revision', revision);
      return originalJson(body);
    };
    return next();
  };
}
const writeInvalidation = createWriteInvalidation();
module.exports = { cacheInvalidationPlugin, writeInvalidation, createWriteInvalidation, trackedModels };
