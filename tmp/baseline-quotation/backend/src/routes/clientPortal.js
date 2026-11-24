const express = require('express');
const controller = require('../controllers/clientPortalController');
const router = express.Router();
const uploads = require('../controllers/clientPortalUploadController');
const messages = require('../controllers/clientPortalMessageController');
const staff = require('../controllers/clientPortalStaffController');
const { requireAuth } = require('../middleware/auth');
const multer = require('multer');
const receive = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 1, fieldSize: 256 } }).single('file');
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
// Temporary email-only login; OTP routes are intentionally not exposed.
router.post('/login', controller.emailLogin);
router.get('/overview', controller.requireClient, controller.overview);
router.get('/uploads', controller.requireClient, uploads.list);
router.get('/staff/uploads', requireAuth, staff.list);
router.get('/support/contacts', controller.requireClient, messages.contacts);
router.get('/support/messages', controller.requireClient, messages.list);
router.post('/support/messages', controller.requireClient, messages.send);
router.get('/applicant-types', controller.requireClient, uploads.options);
router.post('/uploads/:lead/:kind', controller.requireClient, (req, res, next) => receive(req, res, error => error ? res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Maximum file size is 15 MB.' : 'Choose one file to upload.' }) : next()), uploads.create);
module.exports = router;
