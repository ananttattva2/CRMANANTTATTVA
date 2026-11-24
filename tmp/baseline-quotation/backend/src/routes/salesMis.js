const { cacheRead } = require('../services/crmCache');
const express = require('express');
const controller = require('../controllers/salesManagementController');
const { requireAuth, requireRoles } = require('../middleware/auth');
const { ADMIN_ROLES } = require('../constants/roles');

const router = express.Router();

router.get(
  '/management-dashboard',
  requireAuth,
  requireRoles([...ADMIN_ROLES, 'manager', 'operation head', 'operations head']),
  cacheRead,
  controller.managementDashboard
);

module.exports = router;
