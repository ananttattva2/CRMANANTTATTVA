const router = require('express').Router();
const controller = require('../controllers/proformaInvoiceController');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, controller.list);
router.post('/', requireAuth, controller.create);
router.put('/:id', requireAuth, controller.update);

module.exports = router;
