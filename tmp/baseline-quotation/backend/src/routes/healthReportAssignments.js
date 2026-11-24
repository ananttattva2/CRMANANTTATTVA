const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/healthReportAssignmentController');

router.get('/', requireAuth, controller.listAssignments);
router.post('/', requireAuth, controller.createAssignment);
router.patch('/:id/assign', requireAuth, controller.assignUser);

module.exports = router;
