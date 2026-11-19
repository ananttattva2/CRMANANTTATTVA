const { cacheRead } = require('../services/crmCache');
const express = require('express');
const router = express.Router();
const quotationCtrl = require('../controllers/quotationController');
const { requireAuth, requireRoles } = require('../middleware/auth');
const { ADMIN_ROLES } = require('../constants/roles');
const multer = require('multer');

const quotationEmailAttachments = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5, fields: 8, fieldSize: 10000 },
  fileFilter(_req, file, callback) {
    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']);
    if (!allowedTypes.has(file.mimetype)) {
      return callback(new Error('Only JPEG, PNG, GIF, WebP, and PDF files can be attached.'));
    }
    return callback(null, true);
  }
}).array('attachments', 5);

function parseQuotationEmailAttachments(req, res, next) {
  quotationEmailAttachments(req, res, error => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Each attached file must be 5 MB or smaller.'
      : error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE'
        ? 'Attach up to 5 supported files.'
        : error.message || 'Unable to read attached files.';
    return res.status(400).json({ error: message });
  });
}

router.get('/', requireAuth, cacheRead, quotationCtrl.listQuotations);
router.get('/service-categories', requireAuth, cacheRead, quotationCtrl.listServiceCategories);
router.post('/service-categories', requireAuth, requireRoles(ADMIN_ROLES), quotationCtrl.createServiceCategory);
router.get('/pibo-categories', requireAuth, cacheRead, quotationCtrl.listPiboCategories);
router.post('/pibo-categories', requireAuth, requireRoles(ADMIN_ROLES), quotationCtrl.createPiboCategory);
router.get('/dropdown-options', requireAuth, cacheRead, quotationCtrl.listDropdownOptions);
router.get('/management-approvers', requireAuth, cacheRead, quotationCtrl.listManagementApprovers);
router.post('/dropdown-options', requireAuth, requireRoles(ADMIN_ROLES), quotationCtrl.createDropdownOption);
router.patch('/pending-approvals/approve-all', requireAuth, requireRoles(ADMIN_ROLES), quotationCtrl.approveAllPendingQuotations);
router.post('/bulk', requireAuth, quotationCtrl.bulkCreateQuotations);
router.post('/', requireAuth, quotationCtrl.createQuotation);
router.get('/:id', requireAuth, cacheRead, quotationCtrl.getQuotation);
router.get('/:id/pdf', requireAuth, requireRoles(ADMIN_ROLES), quotationCtrl.downloadQuotation);
router.patch('/:id/credit-calculations', requireAuth, quotationCtrl.updateEprCreditCalculations);
router.post('/:id/email', requireAuth, parseQuotationEmailAttachments, quotationCtrl.emailQuotation);
router.patch('/:id/management-approval', requireAuth, quotationCtrl.submitManagementApproval);
router.patch('/:id/management-approval/finalize', requireAuth, requireRoles(['superadmin']), quotationCtrl.finalizeManagementApproval);
router.patch('/:id/approval', requireAuth, requireRoles(ADMIN_ROLES), quotationCtrl.updateQuotationApproval);
router.put('/:id', requireAuth, quotationCtrl.updateQuotation);

module.exports = router;
