const { cacheRead } = require('../services/crmCache');
const express = require('express');
const router = express.Router();
const annualReturnCtrl = require('../controllers/annualReturnController');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, cacheRead, annualReturnCtrl.listAnnualReturns);

module.exports = router;
