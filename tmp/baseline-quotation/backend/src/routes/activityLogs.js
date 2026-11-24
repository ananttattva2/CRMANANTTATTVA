const router = require('express').Router();
const controller = require('../controllers/activityLogController');
const { requireAuth, requireRoles } = require('../middleware/auth');
const { ADMIN_ROLES } = require('../constants/roles');

router.use(requireAuth, requireRoles(ADMIN_ROLES));
router.get('/', controller.list);
router.get('/stats', controller.stats);
router.get('/filters', controller.filters);
router.get('/:id', controller.detail);
module.exports = router;
