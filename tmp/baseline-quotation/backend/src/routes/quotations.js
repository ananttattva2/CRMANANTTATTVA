const { cacheRead } = require('../services/crmCache');
const express = require('express');
const router = express.Router();
const quotationCtrl = require('../controllers/quotationController');
const { requireAuth, requireRoles } = require('../middleware/auth');
const { ADMIN_ROLES } = require('../constants/roles');

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
router.patch('/:id/management-approval', requireAuth, quotationCtrl.submitManagementApproval);
router.patch('/:id/management-approval/finalize', requireAuth, requireRoles(['superadmin']), quotationCtrl.finalizeManagementApproval);
router.patch('/:id/approval', requireAuth, requireRoles(ADMIN_ROLES), quotationCtrl.updateQuotationApproval);
router.put('/:id', requireAuth, quotationCtrl.updateQuotation);

module.exports = router;
