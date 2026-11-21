const router = require('express').Router();
const controller = require('../controllers/proformaInvoiceController');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, controller.list);
router.get('/eligible-quotation/:id', requireAuth, controller.eligibleQuotation);
router.post('/', requireAuth, controller.create);
router.get('/:id/email-options', requireAuth, controller.emailOptions);
router.post('/:id/email', requireAuth, controller.sendEmail);
router.put('/:id', requireAuth, controller.update);

module.exports = router;
