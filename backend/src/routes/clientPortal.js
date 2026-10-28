const express = require('express');
const controller = require('../controllers/clientPortalController');
const router = express.Router();
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
// Temporary email-only login; OTP routes are intentionally not exposed.
router.post('/login', controller.emailLogin);
router.get('/overview', controller.requireClient, controller.overview);
module.exports = router;
