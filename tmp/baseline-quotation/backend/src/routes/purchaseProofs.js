const express = require('express');
const controller = require('../controllers/purchaseProofController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.get('/:proofId', requireAuth, controller.getProof);
router.get('/:proofId/download', requireAuth, controller.downloadProof);
router.get('/:proofId/attachments/:attachmentId/download', requireAuth, controller.downloadAttachment);
router.delete('/:proofId', requireAuth, controller.deleteProof);
module.exports = router;

