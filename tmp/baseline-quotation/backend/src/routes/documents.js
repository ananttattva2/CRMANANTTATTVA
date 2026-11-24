const express = require('express');
const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/sharedDocumentController');

const router = express.Router();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch((error) => {
  if (res.headersSent) return next(error);
  const status = Number(error?.status || error?.statusCode) || 500;
  if (status >= 500) console.error('[documents] request failed', { name: error?.name, message: error?.message });
  return res.status(status).json({ error: status < 500 ? error.message : 'The document request could not be completed. Please retry.' });
});

router.get('/', requireAuth, controller.validateType, asyncRoute(controller.list));
router.post('/', requireAuth, asyncRoute(controller.create));
router.get('/:id/file', requireAuth, asyncRoute(controller.file));

module.exports = router;
