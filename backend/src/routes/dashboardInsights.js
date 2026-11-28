const { cacheRead } = require('../services/crmCache');
const express = require('express');
const controller = require('../controllers/dashboardInsightsController');
const { requireAuth, requireRoles } = require('../middleware/auth');
const { ADMIN_ROLES } = require('../constants/roles');

const router = express.Router();
router.post('/legal/send', requireAuth, requireRoles(ADMIN_ROLES), async (req, res) => {
  try {
    const result = await require('../services/legalSlaReminders').runLegalSlaReminders({ sendNow: true });
    const message = result.skipped ? 'An SLA email run is already in progress.' : result.emails ? `${result.emails} email(s) accepted by the mail provider. Check Outlook, including Junk and Other folders.` : result.failures ? 'The mail provider could not accept the SLA list.' : 'No new pending lists to send. This week�s lists may already have been sent.';
    res.json({ ...result, message });
  } catch (error) { res.status(500).json({ error: 'Unable to send Legal SLA lists. Please retry.' }); }
});
router.get('/legal', requireAuth, async (req, res) => {
  try {
    const { rows, visibility } = await require('../services/legalSla').loadLegalSla(req.user);
    res.set('Cache-Control', 'private, no-store');
    res.json({ rows, visibility });
  } catch (error) { res.status(500).json({ error: 'Unable to load Legal SLA records. Please retry.' }); }
});
router.get('/overall', requireAuth, cacheRead, controller.overall);
router.get('/annual-return-operations', requireAuth, requireRoles(ADMIN_ROLES), (req, res, next) => {
  if (req.query.export === 'true') return next();
  return cacheRead(req, res, next);
}, controller.annualReturnOperations);
router.get('/purchase-orders', requireAuth, cacheRead, controller.purchaseOrders);
router.get('/upload-tracker', requireAuth, cacheRead, controller.uploadTracker);
router.get('/purchase-sales', requireAuth, cacheRead, controller.purchaseSales);
router.get('/pending-count', requireAuth, controller.pendingCount);

module.exports = router;
