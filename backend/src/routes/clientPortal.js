const express = require('express');
const controller = require('../controllers/clientPortalController');
const router = express.Router();
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
router.post('/request-otp', controller.requestOtp);
router.post('/verify-otp', controller.verifyOtp);
router.get('/overview', controller.requireClient, controller.overview);
module.exports = router;
