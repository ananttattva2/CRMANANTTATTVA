const { cacheRead } = require('../services/crmCache');
const express = require('express');
const router = express.Router();
const teamCtrl = require('../controllers/teamController');
const { requireAuth, requireRoles } = require('../middleware/auth');
const { ADMIN_ROLES } = require('../constants/roles');
router.get('/', requireAuth, requireRoles(ADMIN_ROLES), cacheRead, teamCtrl.listTeams);
router.post('/', requireAuth, requireRoles(ADMIN_ROLES), teamCtrl.createTeam);

module.exports = router;
