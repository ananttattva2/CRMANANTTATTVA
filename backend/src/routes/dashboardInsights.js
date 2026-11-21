const { cacheRead } = require('../services/crmCache');
const express = require('express');
const controller = require('../controllers/dashboardInsightsController');
const { requireAuth, requireRoles } = require('../middleware/auth');
const { ADMIN_ROLES } = require('../constants/roles');

const router = express.Router();
router.get('/legal', requireAuth, async (req, res) => {
  try {
    const { rows, visibility } = await require('../services/legalSla').loadLegalSla(req.user);
    res.set('Cache-Control', 'private, no-store');
    res.json({ rows, visibility });
  } catch (error) { res.status(500).json({ error: 'Unable to load Legal SLA records. Please retry.' }); }
});
router.get('/overall', requireAuth, cacheRead, controller.overall);
router.get('/annual-return-operations', requireAuth, requireRoles(ADMIN_ROLES), cacheRead, controller.annualReturnOperations);
router.get('/purchase-orders', requireAuth, cacheRead, controller.purchaseOrders);
router.get('/upload-tracker', requireAuth, cacheRead, controller.uploadTracker);
router.get('/purchase-sales', requireAuth, cacheRead, controller.purchaseSales);
router.get('/pending-count', requireAuth, controller.pendingCount);

module.exports = router;
