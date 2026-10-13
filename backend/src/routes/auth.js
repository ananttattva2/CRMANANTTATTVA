const { cacheRead } = require('../services/crmCache');
const express = require('express');
const router = express.Router();
const authCtrl = require('../controllers/authController');
const { requireAuth, requireRoles } = require('../middleware/auth');
const { ADMIN_ROLES } = require('../constants/roles');


router.post('/request-otp', authCtrl.requestOtp);
router.post('/resend-otp', authCtrl.resendOtp);
router.post('/verify-otp', authCtrl.verifyOtp);
router.post('/forgot-password', authCtrl.forgotPassword);
router.post('/reset-password', authCtrl.resetPassword);
router.post('/logout', requireAuth, authCtrl.logout);
router.post('/activity-heartbeat', requireAuth, authCtrl.activityHeartbeat);
router.get('/admin/logs', requireAuth, requireRoles(ADMIN_ROLES), authCtrl.listAuditLogs);
router.get('/superadmin/overview', requireAuth, requireRoles(ADMIN_ROLES), cacheRead, authCtrl.superAdminOverview);
router.get('/superadmin/productivity-report', requireAuth, requireRoles([...ADMIN_ROLES, 'manager', 'operation head', 'operations head']), cacheRead, authCtrl.userProductivityReport);
router.get('/superadmin/users/:id/work-report', requireAuth, requireRoles([...ADMIN_ROLES, 'manager', 'operation head', 'operations head']), cacheRead, authCtrl.userWorkReport);
router.get('/me', requireAuth, authCtrl.me);
router.post('/milestones/:key/claim', requireAuth, authCtrl.claimMilestone);
router.put('/me', requireAuth, authCtrl.updateMe);
router.put('/me/password', requireAuth, authCtrl.updatePassword);
router.get('/users', requireAuth, cacheRead, authCtrl.listActiveUsers);
router.get('/roles', requireAuth, authCtrl.listRoles);
router.post('/roles', requireAuth, requireRoles(ADMIN_ROLES), authCtrl.createRole);
router.get('/admin/users', requireAuth, requireRoles(ADMIN_ROLES), authCtrl.listUsers);
router.post('/admin/create-user', requireAuth, requireRoles(ADMIN_ROLES), authCtrl.createUserByAdmin);
router.put('/admin/users/:id', requireAuth, requireRoles(ADMIN_ROLES), authCtrl.updateUserByAdmin);

module.exports = router;
