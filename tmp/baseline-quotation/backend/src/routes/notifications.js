const express = require('express');
const notificationCtrl = require('../controllers/notificationController');
const { requireAuth, requireRoles } = require('../middleware/auth');

const router = express.Router();
router.get('/unread-announcements', requireAuth, notificationCtrl.unreadAnnouncements);
router.post('/:id/read', requireAuth, notificationCtrl.markAnnouncementRead);
router.get('/', requireAuth, notificationCtrl.listNotifications);
router.post('/', requireAuth, requireRoles(['admin', 'superadmin', 'manager']), notificationCtrl.createNotification);
router.put('/:id', requireAuth, requireRoles(['admin', 'superadmin', 'manager']), notificationCtrl.updateNotification);
router.delete('/:id', requireAuth, notificationCtrl.clearNotification);

module.exports = router;
