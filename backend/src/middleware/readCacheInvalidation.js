const { readCache } = require('../services/readCache');

function affectsReadCache(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return false;
  const path = String(req.originalUrl || '').split('?')[0];
  return /^\/api\/(clients|leads|teams|dashboard-insights|pending-approvals|duplicate-approvals|quotations|annual-returns|temporary-leads|support-tickets|internal-tickets|purchase-orders|purchase-proofs|health-report-assignments|sales-mis|proforma-invoices|purchase-data|sales-data|integrations\/compliance)(?:\/|$)/.test(path)
    || /^\/api\/auth\/(admin\/users|admin\/create-user|me|roles)(?:\/|$)/.test(path);
}

function createInvalidationMiddleware(invalidate = () => readCache.invalidate()) {
  return (req, res, next) => {
    if (affectsReadCache(req)) {
      const json = res.json;
      let scheduled = false;
      res.json = function (body) {
        if (scheduled || res.statusCode >= 400) return json.call(this, body);
        scheduled = true;
        // Complete cross-worker invalidation before acknowledging a successful
        // edit. Redis outages are bounded by the connection command timeout.
        Promise.resolve().then(invalidate).catch(() => {}).then(() => json.call(this, body));
        return this;
      };
    }
    next();
  };
}

module.exports = { affectsReadCache, createInvalidationMiddleware };
