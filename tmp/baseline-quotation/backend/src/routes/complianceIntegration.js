const express = require('express');
const controller = require('../controllers/complianceIntegrationController');
const { requireComplianceIntegration } = require('../middleware/complianceIntegrationAuth');

const router = express.Router();

router.get('/clients', requireComplianceIntegration, controller.listClients);
router.get('/clients/:id', requireComplianceIntegration, controller.getClient);

module.exports = router;
