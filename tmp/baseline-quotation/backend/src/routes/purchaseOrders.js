const express = require('express');
const controller = require('../controllers/purchaseOrderController');
const { requireComplianceIntegration } = require('../middleware/complianceIntegrationAuth');

const router = express.Router();

router.get('/', requireComplianceIntegration, controller.list);
router.get('/:id', requireComplianceIntegration, controller.getOne);

module.exports = router;
