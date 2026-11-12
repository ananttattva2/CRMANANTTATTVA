const { cacheRead } = require('../services/crmCache');
const express = require('express');
const router = express.Router();
const leadCtrl = require('../controllers/leadController');
const { requireAuth, requireRoles } = require('../middleware/auth');
const { ADMIN_ROLES } = require('../constants/roles');
const quotationCtrl = require('../controllers/quotationController');
const temporaryAssignmentCtrl = require('../controllers/temporaryLeadAssignmentController');
const temporaryLeadCtrl = require('../controllers/temporaryLeadController');

const revenueCtrl = require('../controllers/leadRevenueController');
const { refreshNoOwnerLeads } = require('../services/leadOwnershipAndEmailWorkflow');

async function refreshNoOwnerPool(req, _res, next) {
  if (String(req.query.workspace || '').trim().toLowerCase() !== 'no-owner') return next();
  try {
    // Refresh before cacheRead. Otherwise a cached empty response can hide
    // leads until a separate background scheduler happens to run.
    await refreshNoOwnerLeads();
  } catch (error) {
    // Keep the authoritative directory available even when an automation scan
    // fails. The recurring scheduler will retry and logs retain the root cause.
    console.error('No Owner Leads on-read refresh failed', { name: error.name, message: error.message });
  }
  return next();
}
router.get('/summary-dashboard', requireAuth, requireRoles(ADMIN_ROLES), cacheRead, revenueCtrl.pipeline);
router.get('/pipeline-revenue', requireAuth, cacheRead, revenueCtrl.pipeline);
router.get('/pipeline-revenue/:kind/:id/services', requireAuth, revenueCtrl.services);
router.get('/revenue/:kind/:id', requireAuth, revenueCtrl.get);
router.post('/revenue/:kind/:id', requireAuth, revenueCtrl.add);
router.patch('/revenue/:kind/:id/:entryId', requireAuth, revenueCtrl.correct);
router.post('/revenue/cold/:id/close', requireAuth, revenueCtrl.closeCold);

router.get('/', requireAuth, refreshNoOwnerPool, cacheRead, leadCtrl.listLeads);
router.get('/assignment-users', requireAuth, cacheRead, leadCtrl.listAssignmentUsers);
router.get('/service-catalog', requireAuth, cacheRead, leadCtrl.listServiceCatalog);
router.get('/dropdown-options', requireAuth, cacheRead, leadCtrl.listLeadDropdownOptions);
router.post('/dropdown-options', requireAuth, requireRoles(ADMIN_ROLES), leadCtrl.createLeadDropdownOption);
router.post('/service-catalog/categories', requireAuth, requireRoles(ADMIN_ROLES), leadCtrl.createServiceCatalogCategory);
router.post('/service-catalog/categories/:category/services', requireAuth, requireRoles(ADMIN_ROLES), leadCtrl.addServiceCatalogOffering);
router.get('/search/company', requireAuth, cacheRead, leadCtrl.searchCompanies);
router.get('/duplicate-approvals', requireAuth, cacheRead, leadCtrl.listDuplicateLeadApprovals);
router.get('/temporary', requireAuth, cacheRead, temporaryLeadCtrl.list);
router.post('/temporary', requireAuth, temporaryLeadCtrl.create);
router.put('/temporary/:id', requireAuth, temporaryLeadCtrl.update);
router.post('/temporary/bulk', requireAuth, temporaryLeadCtrl.bulkCreate);
router.post('/temporary/:id/convert', requireAuth, temporaryLeadCtrl.convert);
router.post('/temporary/:id/follow-up', requireAuth, temporaryLeadCtrl.saveFollowUp);
router.post('/temporary/:id/follow-up/close', requireAuth, temporaryLeadCtrl.closeFollowUp);
router.patch('/temporary/:id/reassign', requireAuth, requireRoles(ADMIN_ROLES), temporaryLeadCtrl.reassign);
router.post('/duplicate-approvals', requireAuth, leadCtrl.requestDuplicateLeadApproval);
router.patch('/duplicate-approvals/:id', requireAuth, leadCtrl.updateDuplicateLeadApproval);
router.post('/service-accounts-records/bulk', requireAuth, requireRoles(ADMIN_ROLES), leadCtrl.bulkAssignServiceAccountsRecordIds);
router.post('/bulk', requireAuth, requireRoles(ADMIN_ROLES), leadCtrl.bulkCreateLeads);
router.post('/', requireAuth, leadCtrl.createLead);
router.patch('/:id/allocation', requireAuth, requireRoles(ADMIN_ROLES), leadCtrl.allocateLead);
router.patch('/:id/creator', requireAuth, requireRoles(ADMIN_ROLES), leadCtrl.updateLeadCreator);
router.get('/:id', requireAuth, cacheRead, leadCtrl.getLead);
router.get('/:id/history', requireAuth, cacheRead, leadCtrl.getLeadHistory);
router.post('/:id/history/email', requireAuth, leadCtrl.recordIntroductionEmail);
router.post('/:id/royalty-claims', requireAuth, leadCtrl.claimLeadRoyalty);
router.post('/:id/temporary-assignments', requireAuth, temporaryAssignmentCtrl.requestTemporaryAssignment);
router.patch('/:id/assignments/:rowIndex/staff', requireAuth, leadCtrl.assignLeadStaff);
router.patch('/:id/purchase-orders/reassign', requireAuth, requireRoles(ADMIN_ROLES), leadCtrl.reassignPurchaseOrder);
router.post('/:id/permanent-closure', requireAuth, leadCtrl.permanentlyCloseProvisionalLead);
router.patch('/temporary-assignments/:approvalId', requireAuth, temporaryAssignmentCtrl.decideTemporaryAssignment);
router.get('/purchase-order-approvals/:id', requireAuth, requireRoles(ADMIN_ROLES), cacheRead, leadCtrl.getPurchaseOrderApproval);
router.delete('/purchase-order-approvals/:id', requireAuth, requireRoles(ADMIN_ROLES), require('../controllers/leadDeletionController').removePoApproval);
router.patch('/purchase-order-approvals/:id', requireAuth, requireRoles(ADMIN_ROLES), leadCtrl.decidePurchaseOrderApproval);
router.patch('/purchase-order-approvals/:id/proof', requireAuth, requireRoles(ADMIN_ROLES), leadCtrl.uploadPurchaseOrderProof);
router.get('/:leadId/quotations', requireAuth, cacheRead, quotationCtrl.listLeadQuotations);
router.put('/:id', requireAuth, leadCtrl.updateLead);
router.delete('/:id', requireAuth, requireRoles(ADMIN_ROLES), require('../controllers/leadDeletionController').deleteLead);

module.exports = router;
