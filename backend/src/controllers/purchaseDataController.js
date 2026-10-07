const mongoose = require('mongoose');
const Client = require('../models/Client');
const PurchaseData = require('../models/PurchaseData');
const PurchaseImportRow = require('../models/PurchaseImportRow');
const {
  PURCHASE_CHECKLIST_PARTICULARS, defaultChecklist, normalizePurchaseRows, describePurchaseFinancialYearMismatch, reconcilePurchaseRows,
  purchaseReadiness, calculatePurchaseStatus, checksum
} = require('../services/purchaseDataService');
const { notifyPurchaseWorkflow } = require('../services/purchaseDataNotifications');
const { getVisibleUserScope, ownerFilter } = require('../utils/visibilityScope');

function role(user) { return String(user?.role || '').trim().toLowerCase().replace(/[\s_-]+/g, ''); }
function isAdmin(user) { return ['admin', 'superadmin'].includes(role(user)); }
function isManager(user) { return role(user) === 'manager'; }
function isCompliance(user) { return role(user).includes('compliance'); }
function canEdit(user) { return isAdmin(user) || (!isManager(user) && !isCompliance(user)); }
function actor(user) { return { userId: user?._id, name: user?.name || user?.email || 'CRM User', role: user?.role || '' }; }
function historyItem(stage, decision, user, message = '') { return { stage, decision, message: String(message || '').trim(), by: actor(user), at: new Date() }; }
function validYear(value) { return /^20\d{2}-\d{2}$/.test(String(value || '').trim()); }

async function findClient(value, user) {
  const id = String(value || '').trim();
  const visibility = ownerFilter(await getVisibleUserScope(user), 'createdBy', 'adminControls.assignedTo', [
    'data.importMeta.assignedTo', 'data.importMeta.user', 'data.importMeta.userName',
    'data.importMeta.createdBy', 'data.importMeta.createdByEmail'
  ]);
  if (mongoose.Types.ObjectId.isValid(id)) {
    const byId = await Client.findOne({ $and: [{ _id: id }, visibility] });
    if (byId) return byId;
  }
  return Client.findOne({ $and: [{ $or: [{ 'data.importMeta.uniqueId': id }, { 'data.basic.clientLegalName': id }, { 'data.basic.tradeName': id }] }, visibility] });
}

function cleanFile(file = {}) {
  const url = String(file.secureUrl || file.url || '').trim();
  if (!/^https:\/\//i.test(url)) return null;
  return {
    name: String(file.name || file.originalName || 'file').trim().slice(0, 240), originalName: String(file.originalName || file.name || 'file').trim().slice(0, 240),
    mimeType: String(file.mimeType || file.type || '').trim().slice(0, 120), size: Math.max(0, Number(file.size || file.bytes) || 0),
    url, secureUrl: url, publicId: String(file.publicId || '').trim(), uploadedAt: file.uploadedAt || new Date().toISOString()
  };
}
function cleanFiles(files) { return (Array.isArray(files) ? files : []).map(cleanFile).filter(Boolean).slice(0, 20); }
function cleanEvidenceFiles(files) {
  return cleanFiles(files).filter((file) => /^image\//i.test(file.mimeType) || /application\/pdf/i.test(file.mimeType) || /message\/rfc822/i.test(file.mimeType) || /application\/vnd\.ms-outlook/i.test(file.mimeType) || /\.(pdf|eml|msg|png|jpe?g|gif|webp)$/i.test(file.name));
}

async function getOrCreate(client, financialYear, user) {
  let purchase = await PurchaseData.findOne({ clientId: client._id, financialYear });
  if (!purchase) purchase = new PurchaseData({ clientId: client._id, financialYear, checklist: defaultChecklist(), createdBy: user?._id, updatedBy: user?._id });
  if (!purchase.checklist?.length) purchase.checklist = defaultChecklist();
  return purchase;
}

function resetApprovals(purchase) {
  purchase.managerVerificationStatus = 'Not Submitted';
  purchase.managerVerifiedAt = undefined;
  purchase.managerVerifiedBy = undefined;
  purchase.managerVerifiedByName = '';
  purchase.complianceVerificationStatus = 'Not Ready';
  purchase.complianceVerifiedAt = undefined;
  purchase.complianceVerifiedBy = undefined;
  purchase.complianceVerifiedByName = '';
  purchase.submittedAt = undefined;
}

function hasBothExcelImports(purchase) {
  return purchase.baseUpload?.importStatus === 'Imported' && purchase.portalUpload?.importStatus === 'Imported';
}

async function submitForManagerApproval({ purchase, client, user, message }) {
  const duplicate = purchase.lastSubmissionVersion === purchase.dataVersion && purchase.managerVerificationStatus === 'Pending';
  if (!duplicate) {
    const wasSubmitted = Boolean(purchase.lastSubmissionVersion);
    purchase.managerVerificationStatus = 'Pending';
    purchase.complianceVerificationStatus = 'Not Ready';
    purchase.submittedBy = user._id;
    purchase.submittedByName = user.name || user.email || 'CRM User';
    purchase.submittedAt = new Date();
    purchase.lastSubmissionVersion = purchase.dataVersion;
    purchase.reviewHistory.push(historyItem('User', wasSubmitted ? 'Revised' : 'Submitted', user, message));
    purchase.markModified('reviewHistory');
    purchase.calculatedStatus = calculatePurchaseStatus(purchase);
    await purchase.save();
  }
  if (purchase.baseUpload && purchase.portalUpload) message += ` Uploaded by ${user.name || user.email || 'CRM User'}: Purchase Base Data (${purchase.baseUpload.name}) and Purchase Portal Upload (${purchase.portalUpload.name}).`;
  const notification = await notifyPurchaseWorkflow({ stage: 'manager_pending', client, purchase, actor: user, message, preventDuplicate: true });
  return { duplicate, notification };
}

async function rowsFor(purchase, source) {
  const upload = source === 'base' ? purchase.baseUpload : purchase.portalUpload;
  if (!upload?.uploadId) return [];
  return PurchaseImportRow.find({ uploadId: upload.uploadId }).lean();
}
async function refreshReconciliation(purchase) {
  const [baseRows, portalRows] = await Promise.all([rowsFor(purchase, 'base'), rowsFor(purchase, 'portal')]);
  purchase.reconciliation = reconcilePurchaseRows(baseRows, portalRows);
  purchase.calculatedStatus = calculatePurchaseStatus(purchase);
  purchase.markModified('reconciliation');
  return purchase.reconciliation;
}
function payload(purchase, user) {
  const object = purchase.toObject ? purchase.toObject() : purchase;
  return {
    ...object,
    checklist: defaultChecklist(object.checklist),
    readiness: purchaseReadiness(object),
    calculatedStatus: calculatePurchaseStatus(object),
    permissions: {
      canEdit: canEdit(user), canManagerReview: isAdmin(user) || isManager(user), canComplianceReview: isAdmin(user) || isCompliance(user), canAdminOverride: isAdmin(user)
    }
  };
}

exports.getPurchaseData = async (req, res) => {
  try {
    const financialYear = String(req.query.financialYear || '').trim();
    if (!validYear(financialYear)) return res.status(400).json({ error: 'financialYear must use YYYY-YY.' });
    const client = await findClient(req.params.id, req.user);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const purchase = await getOrCreate(client, financialYear, req.user);
    purchase.calculatedStatus = calculatePurchaseStatus(purchase);
    await purchase.save();
    res.json({ ok: true, purchaseData: payload(purchase, req.user) });
  } catch (error) { console.error('Purchase Data load failed', error); res.status(500).json({ error: 'Unable to load Purchase Data.' }); }
};

exports.updateChecklist = async (req, res) => {
  try {
    if (!canEdit(req.user)) return res.status(403).json({ error: 'Your role has read-only access to the Purchase Data checklist.' });
    const financialYear = String(req.body.financialYear || '').trim();
    if (!validYear(financialYear)) return res.status(400).json({ error: 'financialYear must use YYYY-YY.' });
    const client = await findClient(req.params.id, req.user);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const purchase = await getOrCreate(client, financialYear, req.user);
    const incoming = new Map((Array.isArray(req.body.checklist) ? req.body.checklist : []).map((row) => [String(row.particular || '').trim(), row]));
    const existingRows = new Map(defaultChecklist(purchase.checklist).map((row) => [row.particular, row]));
    purchase.checklist = PURCHASE_CHECKLIST_PARTICULARS.map((particular) => {
      const row = incoming.get(particular) || {};
      const existingProofs = new Map((existingRows.get(particular)?.files || []).filter((file) => file?.proofId).map((file) => [String(file.proofId), file]));
      const requestedProofs = (Array.isArray(row.files) ? row.files : []).filter((file) => file?.proofId).map((file) => existingProofs.get(String(file.proofId))).filter(Boolean);
      const ordinaryFiles = cleanEvidenceFiles((Array.isArray(row.files) ? row.files : []).filter((file) => !file?.proofId));
      return { particular, partialDataReceived: row.yesNo === 'Yes' && row.partialDataReceived === true, completeDataReceived: row.yesNo === 'Yes' && row.completeDataReceived === true, yesNo: ['Yes', 'No'].includes(row.yesNo) ? row.yesNo : '', date: /^\d{4}-\d{2}-\d{2}$/.test(row.date || '') ? row.date : '', files: [...requestedProofs, ...ordinaryFiles].slice(0, 20), remarks: String(row.remarks || '').trim().slice(0, 2000) };
    });
    if (req.body.userRemarks !== undefined) purchase.userRemarks = String(req.body.userRemarks || '').trim().slice(0, 3000);
    purchase.updatedBy = req.user._id;
    purchase.calculatedStatus = calculatePurchaseStatus(purchase);
    purchase.markModified('checklist');
    await purchase.save();
    const nilReadiness = purchaseReadiness(purchase);
    if (nilReadiness.nilUpload && nilReadiness.ready && purchase.managerVerificationStatus === 'Not Submitted') {
      await submitForManagerApproval({ purchase, client, user: req.user, message: 'Nil Upload automatically submitted after client approval.' });
    }
    res.json({ ok: true, purchaseData: payload(purchase, req.user), });
  } catch (error) { console.error('Purchase checklist update failed', error); res.status(500).json({ error: 'Unable to save Purchase Data checklist.' }); }
};

exports.updateScreenshots = async (req, res) => {
  try {
    if (!canEdit(req.user)) return res.status(403).json({ error: 'Your role cannot change Purchase Data screenshots.' });
    const financialYear = String(req.body.financialYear || '').trim();
    if (!validYear(financialYear)) return res.status(400).json({ error: 'financialYear must use YYYY-YY.' });
    const client = await findClient(req.params.id, req.user);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const purchase = await getOrCreate(client, financialYear, req.user);
    purchase.screenshots = cleanEvidenceFiles(req.body.screenshots);
    purchase.updatedBy = req.user._id;
    purchase.markModified('screenshots');
    await purchase.save();
    res.json({ ok: true, purchaseData: payload(purchase, req.user) });
  } catch (error) { console.error('Purchase screenshot update failed', error); res.status(500).json({ error: 'Unable to save screenshots.' }); }
};

exports.importPurchaseRows = async (req, res) => {
  let insertedUploadId = null;
  let importCommitted = false;
  try {
    if (!canEdit(req.user)) return res.status(403).json({ error: 'Your role cannot replace Purchase Excel files.' });
    const source = String(req.params.source || '').toLowerCase();
    if (!['base', 'portal'].includes(source)) return res.status(400).json({ error: 'source must be base or portal.' });
    const financialYear = String(req.body.financialYear || '').trim();
    if (!validYear(financialYear)) return res.status(400).json({ error: 'financialYear must use YYYY-YY.' });
    const file = cleanFile(req.body.file);
    if (!file) return res.status(400).json({ error: 'A securely uploaded Excel file is required.' });
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (rows.length > 10000) return res.status(413).json({ error: 'A maximum of 10,000 rows is supported per import.' });
    let parsed;
    try { parsed = normalizePurchaseRows(rows, source, financialYear, req.body.headerRowNumber); }
    catch (error) { return res.status(422).json({ error: error.message, code: error.code, missingHeaders: error.missingHeaders || [] }); }
    if (!parsed.acceptedRows.length) {
      const financialYearMismatch = describePurchaseFinancialYearMismatch(parsed, financialYear);
      return res.status(422).json({
        error: financialYearMismatch?.message || 'No valid rows could be imported. Correct the listed row errors and try again.',
        code: financialYearMismatch ? 'FINANCIAL_YEAR_MISMATCH' : 'NO_VALID_ROWS',
        selectedFinancialYear: financialYearMismatch?.selectedFinancialYear,
        workbookFinancialYears: financialYearMismatch?.workbookFinancialYears,
        upload: parsed,
        previewRows: [],
        validationErrors: parsed.validationErrors
      });
    }
    const client = await findClient(req.params.id, req.user);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const purchase = await getOrCreate(client, financialYear, req.user);
    const field = source === 'base' ? 'baseUpload' : 'portalUpload';
    const previous = purchase[field];
    const fileChecksum = checksum({ name: file.name, size: file.size, rows });
    const uploadId = new mongoose.Types.ObjectId();
    const docs = parsed.acceptedRows.map((row) => ({ ...row, clientId: client._id, financialYear, uploadId, createdBy: req.user._id }));
    if (docs.length) { await PurchaseImportRow.insertMany(docs, { ordered: true }); insertedUploadId = uploadId; }
    purchase[field] = {
      uploadId, source, ...file, checksum: fileChecksum, sheetName: String(req.body.sheetName || '').trim(), headerRowNumber: Number(req.body.headerRowNumber) || 1,
      totalRows: parsed.totalRows, importedRowCount: docs.length, validRowCount: parsed.validRowCount, warningRowCount: parsed.warningRowCount, invalidRowCount: parsed.invalidRowCount, duplicateRowCount: parsed.duplicateRowCount,
      totalQuantity: parsed.totalQuantity, totalGst: parsed.totalGst, validationErrors: parsed.validationErrors, importStatus: 'Imported', uploadedAt: new Date(), uploadedBy: req.user._id, uploadedByName: req.user.name || req.user.email || 'CRM User'
    };
    purchase.dataVersion = (purchase.dataVersion || 0) + 1;
    resetApprovals(purchase);
    purchase.reviewHistory.push(historyItem('User', previous ? 'Revised' : 'Submitted', req.user, `${source === 'base' ? 'Purchase Base Data' : 'Purchase Portal Data'} ${previous ? 'replaced' : 'uploaded'} by ${req.user.name || req.user.email}.`));
    purchase.updatedBy = req.user._id;
    await refreshReconciliation(purchase);
    purchase.markModified(field); purchase.markModified('reviewHistory');
    await purchase.save();
    importCommitted = true;
    if (previous?.uploadId) await PurchaseImportRow.deleteMany({ uploadId: previous.uploadId });
    let automaticSubmission = null;
    const readiness = purchaseReadiness(purchase);
    if (hasBothExcelImports(purchase)) {
      const warningNote = readiness.warningIssueCount ? ` Reconciliation includes ${readiness.warningIssueCount} warning(s) for Manager review.` : '';
      try {
        automaticSubmission = await submitForManagerApproval({ purchase, client, user: req.user, message: `Automatically submitted after both Purchase Excel files were imported.${warningNote}` });
      } catch (notificationError) {
        console.error('Purchase import succeeded but automatic submission notification failed', {
          clientId: String(client._id), financialYear, message: notificationError.message, stack: notificationError.stack
        });
      }
    }
    res.json({
      ok: true,
      upload: purchase[field],
      previewRows: parsed.acceptedRows.slice(0, 100),
      validationErrors: parsed.validationErrors,
      summary: purchase.reconciliation,
      purchaseData: payload(purchase, req.user),
      autoSubmitted: Boolean(automaticSubmission && !automaticSubmission.duplicate) || (purchase.managerVerificationStatus === 'Pending' && purchase.lastSubmissionVersion === purchase.dataVersion),
      managerNotificationCreated: Boolean(automaticSubmission?.notification?.ok),
      managerEmailSent: Number(automaticSubmission?.notification?.emailSent || 0) > 0,
      partialImport: parsed.invalidRowCount > 0 || parsed.duplicateRowCount > 0,
      importedRowCount: docs.length,
      skippedRowCount: parsed.invalidRowCount + parsed.duplicateRowCount
    });
  } catch (error) {
    if (insertedUploadId && !importCommitted) await PurchaseImportRow.deleteMany({ uploadId: insertedUploadId }).catch(() => {});
    console.error('Purchase import failed', { clientId: req.params.id, source: req.params.source, financialYear: req.body?.financialYear, userId: String(req.user?._id || ''), code: error.code, message: error.message, stack: error.stack });
    res.status(500).json({ error: 'Unable to import Purchase Excel data.', code: error.code || 'PURCHASE_IMPORT_FAILED' });
  }
};

exports.removePurchaseImport = async (req, res) => {
  try {
    if (!canEdit(req.user)) return res.status(403).json({ error: 'Your role cannot remove Purchase Excel files.' });
    const source = String(req.params.source || '').toLowerCase();
    const financialYear = String(req.query.financialYear || '').trim();
    if (!validYear(financialYear)) return res.status(400).json({ error: 'financialYear must use YYYY-YY.' });
    const client = await findClient(req.params.id, req.user);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const purchase = await getOrCreate(client, financialYear, req.user);
    const field = source === 'base' ? 'baseUpload' : source === 'portal' ? 'portalUpload' : '';
    if (!field) return res.status(400).json({ error: 'source must be base or portal.' });
    const previous = purchase[field];
    purchase[field] = null; purchase.dataVersion = (purchase.dataVersion || 0) + 1; resetApprovals(purchase);
    purchase.reviewHistory.push(historyItem('User', 'Revised', req.user, `${source === 'base' ? 'Purchase Base Data' : 'Purchase Portal Data'} removed.`));
    await refreshReconciliation(purchase); purchase.markModified(field); purchase.markModified('reviewHistory'); await purchase.save();
    if (previous?.uploadId) await PurchaseImportRow.deleteMany({ uploadId: previous.uploadId });
    res.json({ ok: true, purchaseData: payload(purchase, req.user) });
  } catch (error) { console.error('Purchase import removal failed', error); res.status(500).json({ error: 'Unable to remove Purchase import.' }); }
};

exports.listPurchaseRows = async (req, res) => {
  try {
    const financialYear = String(req.query.financialYear || '').trim();
    const source = String(req.query.source || 'base').toLowerCase();
    if (!validYear(financialYear)) return res.status(400).json({ error: 'financialYear must use YYYY-YY.' });
    if (!['base', 'portal'].includes(source)) return res.status(400).json({ error: 'source must be base or portal.' });
    const client = await findClient(req.params.id, req.user);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const purchase = await PurchaseData.findOne({ clientId: client._id, financialYear });
    if (!purchase) return res.json({ ok: true, rows: [], pagination: { page: 1, pages: 1, total: 0 } });
    const upload = source === 'portal' ? purchase.portalUpload : purchase.baseUpload;
    if (!upload?.uploadId) return res.json({ ok: true, rows: [], pagination: { page: 1, pages: 1, total: 0 } });
    const page = Math.max(1, Number(req.query.page) || 1); const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 25));
    const filter = { uploadId: upload.uploadId };
    if (req.query.category) filter.plasticCategory = req.query.category;
    if (req.query.registrationType) filter.registrationType = req.query.registrationType;
    if (req.query.validationStatus) filter.validationStatus = req.query.validationStatus;
    if (req.query.search) {
      const escaped = String(req.query.search).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [{ entityName: { $regex: escaped, $options: 'i' } }, { gstin: { $regex: escaped, $options: 'i' } }];
    }
    const [rows, total] = await Promise.all([PurchaseImportRow.find(filter).sort({ rowNumber: 1 }).skip((page - 1) * limit).limit(limit).lean(), PurchaseImportRow.countDocuments(filter)]);
    res.json({ ok: true, rows, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (error) { console.error('Purchase rows load failed', error); res.status(500).json({ error: 'Unable to load Purchase rows.' }); }
};

exports.getReconciliation = async (req, res) => {
  try {
    if (!validYear(req.query.financialYear)) return res.status(400).json({ error: 'financialYear must use YYYY-YY.' });
    const client = await findClient(req.params.id, req.user); if (!client) return res.status(404).json({ error: 'Client not found or not accessible' });
    const purchase = await getOrCreate(client, String(req.query.financialYear || '').trim(), req.user);
    await refreshReconciliation(purchase); await purchase.save();
    res.json({ ok: true, reconciliation: purchase.reconciliation, readiness: purchaseReadiness(purchase), calculatedStatus: calculatePurchaseStatus(purchase) });
  } catch (error) { console.error('Purchase reconciliation failed', error); res.status(500).json({ error: 'Unable to calculate reconciliation.' }); }
};

exports.getPurchaseErrors = async (req, res) => {
  if (!validYear(req.query.financialYear)) return res.status(400).json({ error: 'financialYear must use YYYY-YY.' });
  const client = await findClient(req.params.id, req.user); if (!client) return res.status(404).json({ error: 'Client not found or not accessible' });
  const purchase = await PurchaseData.findOne({ clientId: client._id, financialYear: String(req.query.financialYear || '').trim() }).lean();
  res.json({ ok: true, issues: purchase?.reconciliation?.issues || [] });
};

exports.submitPurchaseData = async (req, res) => {
  try {
    if (!canEdit(req.user)) return res.status(403).json({ error: 'Your role cannot submit Purchase Data.' });
    const financialYear = String(req.body.financialYear || '').trim();
    if (!validYear(financialYear)) return res.status(400).json({ error: 'financialYear must use YYYY-YY.' });
    const client = await findClient(req.params.id, req.user); if (!client) return res.status(404).json({ error: 'Client not found or not accessible' });
    const purchase = await getOrCreate(client, financialYear, req.user);
    const readiness = purchaseReadiness(purchase);
    if (!readiness.ready) return res.status(422).json({ error: 'Purchase Data is not ready for submission.', errors: readiness.errors });
    const message = String(req.body.message || purchase.userRemarks || '').trim();
    if (readiness.warningIssueCount && !message) return res.status(422).json({ error: 'Explain reconciliation warnings before submission.' });
    const submission = await submitForManagerApproval({ purchase, client, user: req.user, message: message || (readiness.nilUpload ? 'Nil Upload submitted.' : 'Purchase Data submitted for Manager review.') });
    const duplicate = submission.duplicate;
    res.json({ ok: true, purchaseData: payload(purchase, req.user), duplicateSubmission: duplicate });
  } catch (error) { console.error('Purchase submission failed', error); res.status(500).json({ error: 'Unable to submit Purchase Data.' }); }
};

exports.managerReview = async (req, res) => {
  try {
    if (!(isAdmin(req.user) || isManager(req.user))) return res.status(403).json({ error: 'Manager permission is required.' });
    const decision = String(req.body.decision || '').toUpperCase(); const message = String(req.body.message || '').trim();
    if (!['APPROVED', 'REJECTED'].includes(decision)) return res.status(400).json({ error: 'Decision must be APPROVED or REJECTED.' });
    if (decision === 'REJECTED' && !message) return res.status(400).json({ error: 'Rejection comments are required.' });
    const financialYear = String(req.body.financialYear || '').trim();
    if (!validYear(financialYear)) return res.status(400).json({ error: 'financialYear must use YYYY-YY.' });
    const client = await findClient(req.params.id, req.user); if (!client) return res.status(404).json({ error: 'Client not found or not accessible' });
    const purchase = await getOrCreate(client, financialYear, req.user);
    if (purchase.managerVerificationStatus !== 'Pending') return res.status(409).json({ error: 'Purchase Data is not pending Manager review.' });
    const readiness = purchaseReadiness(purchase); if (!readiness.ready) return res.status(422).json({ error: 'Purchase Data is no longer ready.', errors: readiness.errors });
    if (decision === 'APPROVED' && readiness.warningIssueCount && req.body.acknowledgeWarnings !== true) return res.status(422).json({ error: 'Manager must acknowledge reconciliation warnings.' });
    purchase.managerVerificationStatus = decision === 'APPROVED' ? 'Approved' : 'Rejected'; purchase.managerVerifiedAt = new Date(); purchase.managerVerifiedBy = req.user._id; purchase.managerVerifiedByName = req.user.name || req.user.email || 'Manager';
    purchase.complianceVerificationStatus = decision === 'APPROVED' ? 'Pending' : 'Not Ready';
    purchase.reviewHistory.push(historyItem('Manager', decision === 'APPROVED' ? 'Approved' : 'Rejected', req.user, message)); purchase.markModified('reviewHistory'); purchase.calculatedStatus = calculatePurchaseStatus(purchase); await purchase.save();
    await notifyPurchaseWorkflow({ stage: decision === 'APPROVED' ? 'compliance_pending' : 'manager_rejected', client, purchase, actor: req.user, message });
    res.json({ ok: true, purchaseData: payload(purchase, req.user) });
  } catch (error) { console.error('Purchase Manager review failed', error); res.status(500).json({ error: 'Unable to complete Manager review.' }); }
};

exports.complianceReview = async (req, res) => {
  try {
    if (!(isAdmin(req.user) || isCompliance(req.user))) return res.status(403).json({ error: 'Compliance permission is required.' });
    const decision = String(req.body.decision || '').toUpperCase(); const message = String(req.body.message || '').trim();
    if (!['APPROVED', 'REJECTED'].includes(decision)) return res.status(400).json({ error: 'Decision must be APPROVED or REJECTED.' });
    if (decision === 'REJECTED' && !message) return res.status(400).json({ error: 'Rejection comments are required.' });
    const financialYear = String(req.body.financialYear || '').trim();
    if (!validYear(financialYear)) return res.status(400).json({ error: 'financialYear must use YYYY-YY.' });
    const client = await findClient(req.params.id, req.user); if (!client) return res.status(404).json({ error: 'Client not found or not accessible' });
    const purchase = await getOrCreate(client, financialYear, req.user);
    if (purchase.managerVerificationStatus !== 'Approved' || purchase.complianceVerificationStatus !== 'Pending') return res.status(409).json({ error: 'Manager approval is required before Compliance review.' });
    purchase.complianceVerificationStatus = decision === 'APPROVED' ? 'Approved' : 'Rejected'; purchase.complianceVerifiedAt = new Date(); purchase.complianceVerifiedBy = req.user._id; purchase.complianceVerifiedByName = req.user.name || req.user.email || 'Compliance Manager';
    purchase.reviewHistory.push(historyItem('Compliance', decision === 'APPROVED' ? 'Approved' : 'Rejected', req.user, message)); purchase.markModified('reviewHistory'); purchase.calculatedStatus = calculatePurchaseStatus(purchase); await purchase.save();
    await notifyPurchaseWorkflow({ stage: decision === 'APPROVED' ? 'compliance_approved' : 'compliance_rejected', client, purchase, actor: req.user, message });
    res.json({ ok: true, purchaseData: payload(purchase, req.user) });
  } catch (error) { console.error('Purchase Compliance review failed', error); res.status(500).json({ error: 'Unable to complete Compliance review.' }); }
};
