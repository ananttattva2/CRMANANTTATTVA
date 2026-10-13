const { cacheRead } = require('../services/crmCache');
const express = require('express');
const controller = require('../controllers/dashboardInsightsController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.get('/overall', requireAuth, cacheRead, controller.overall);
router.get('/purchase-orders', requireAuth, cacheRead, controller.purchaseOrders);
router.get('/upload-tracker', requireAuth, cacheRead, controller.uploadTracker);
router.get('/purchase-sales', requireAuth, cacheRead, controller.purchaseSales);

module.exports = router;
