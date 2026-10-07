const mongoose = require('mongoose');
const Client = require('../models/Client');
const SalesData = require('../models/SalesData');
const SalesImportRow = require('../models/SalesImportRow');
const { PURCHASE_CHECKLIST_PARTICULARS, defaultChecklist, normalizePurchaseRows, reconcilePurchaseRows, purchaseReadiness, calculatePurchaseStatus, checksum } = require('../services/purchaseDataService');
const { notifySalesWorkflow } = require('../services/salesDataNotifications');
const { getVisibleUserScope, ownerFilter } = require('../utils/visibilityScope');

const normalizedRole = (user) => String(user?.role || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
const isAdmin = (user) => ['admin', 'superadmin'].includes(normalizedRole(user));
const isManager = (user) => normalizedRole(user) === 'manager';
const isCompliance = (user) => normalizedRole(user).includes('compliance');
const canEdit = (user) => isAdmin(user) || (!isManager(user) && !isCompliance(user));
const validYear = (value) => /^20\d{2}-\d{2}$/.test(String(value || '').trim());
const actor = (user) => ({ userId: user?._id, name: user?.name || user?.email || 'CRM User', role: user?.role || '' });
const historyItem = (stage, decision, user, message = '') => ({ stage, decision, message: String(message || '').trim(), by: actor(user), at: new Date() });

async function findClient(value, user) {
  const id = String(value || '').trim();
  const visibility = ownerFilter(await getVisibleUserScope(user), 'createdBy', 'adminControls.assignedTo', [
    'data.importMeta.assignedTo', 'data.importMeta.user', 'data.importMeta.userName',
    'data.importMeta.createdBy', 'data.importMeta.createdByEmail'
  ]);
  if (mongoose.Types.ObjectId.isValid(id)) {
    const client = await Client.findOne({ $and: [{ _id: id }, visibility] });
    if (client) return client;
  }
  return Client.findOne({ $and: [{ $or: [{ 'data.importMeta.uniqueId': id }, { 'data.basic.clientLegalName': id }, { 'data.basic.tradeName': id }] }, visibility] });
}

function cleanFile(file = {}) {
  const url = String(file.secureUrl || file.url || '').trim();
  if (!/^https:\/\//i.test(url)) return null;
  return { name: String(file.name || file.originalName || 'file').trim().slice(0, 240), originalName: String(file.originalName || file.name || 'file').trim().slice(0, 240), mimeType: String(file.mimeType || file.type || '').trim().slice(0, 120), size: Math.max(0, Number(file.size || file.bytes) || 0), url, secureUrl: url, publicId: String(file.publicId || '').trim(), uploadedAt: file.uploadedAt || new Date().toISOString() };
}

function cleanFiles(files) { return (Array.isArray(files) ? files : []).map(cleanFile).filter(Boolean).slice(0, 20); }
function cleanEvidenceFiles(files) {
  return cleanFiles(files).filter((file) => /^image\//i.test(file.mimeType) || /application\/pdf/i.test(file.mimeType) || /message\/rfc822/i.test(file.mimeType) || /application\/vnd\.ms-outlook/i.test(file.mimeType) || /\.(pdf|eml|msg|png|jpe?g|gif|webp)$/i.test(file.name));
}

async function getOrCreate(client, financialYear, user) {
  let sales = await SalesData.findOne({ clientId: client._id, financialYear });
  if (!sales) sales = new SalesData({ clientId: client._id, financialYear, checklist: defaultChecklist(), createdBy: user?._id, updatedBy: user?._id });
  return sales;
}

function resetApprovals(sales) {
  sales.managerVerificationStatus = 'Not Submitted'; sales.managerVerifiedAt = undefined; sales.managerVerifiedBy = undefined; sales.managerVerifiedByName = '';
  sales.complianceVerificationStatus = 'Not Ready'; sales.complianceVerifiedAt = undefined; sales.complianceVerifiedBy = undefined; sales.complianceVerifiedByName = ''; sales.submittedAt = undefined;
}

function readiness(sales = {}) {
  const value = purchaseReadiness(sales);
  return { ...value, errors: value.errors.map((error) => error.replace(/Purchase Base Data/g, 'Sales Base Data').replace(/Purchase Portal Upload/g, 'Sales Portal Upload')) };
}

function calculatedStatus(sales = {}) {
  if (sales.managerVerificationStatus === 'Pending') return 'Manager Review Pending';
  return calculatePurchaseStatus(sales);
}

function payload(sales, user) {
  const object = sales.toObject ? sales.toObject() : sales;
  return { ...object, checklist: defaultChecklist(object.checklist), readiness: readiness(object), calculatedStatus: calculatedStatus(object), permissions: { canEdit: canEdit(user), canManagerReview: isAdmin(user) || isManager(user), canComplianceReview: isAdmin(user) || isCompliance(user) } };
}

async function rowsFor(sales, source) {
  const upload = source === 'base' ? sales.baseUpload : sales.portalUpload;
  return upload?.uploadId ? SalesImportRow.find({ uploadId: upload.uploadId }).lean() : [];
}

async function refreshReconciliation(sales) {
  const [baseRows, portalRows] = await Promise.all([rowsFor(sales, 'base'), rowsFor(sales, 'portal')]);
  sales.reconciliation = reconcilePurchaseRows(baseRows, portalRows);
  sales.calculatedStatus = calculatedStatus(sales);
  sales.markModified('reconciliation');
}

async function submitForManager({ sales, client, user, message }) {
  const duplicate = sales.lastSubmissionVersion === sales.dataVersion && sales.managerVerificationStatus === 'Pending';
  if (!duplicate) {
    const wasSubmitted = Boolean(sales.lastSubmissionVersion);
    sales.managerVerificationStatus = 'Pending'; sales.complianceVerificationStatus = 'Not Ready'; sales.submittedBy = user._id;
    sales.submittedByName = user.name || user.email || 'CRM User'; sales.submittedAt = new Date(); sales.lastSubmissionVersion = sales.dataVersion;
    sales.reviewHistory.push(historyItem('User', wasSubmitted ? 'Revised' : 'Submitted', user, message)); sales.markModified('reviewHistory'); sales.calculatedStatus = calculatedStatus(sales);
    await sales.save();
  }
  if (sales.baseUpload && sales.portalUpload) message += ` Uploaded by ${user.name || user.email || 'CRM User'}: Sales Base Data (${sales.baseUpload.name}) and Sales Portal Upload (${sales.portalUpload.name}).`;
  const notification = await notifySalesWorkflow({ stage: 'manager_pending', client, sales, actor: user, message, preventDuplicate: true });
  return { duplicate, notification };
}

exports.getSalesData = async (req, res) => {
  try {
    const financialYear = String(req.query.financialYear || '').trim();
    if (!validYear(financialYear)) return res.status(400).json({ error: 'financialYear must use YYYY-YY.' });
    const client = await findClient(req.params.id, req.user); if (!client) return res.status(404).json({ error: 'Client not found or not accessible' });
    const sales = await getOrCreate(client, financialYear, req.user); sales.calculatedStatus = calculatedStatus(sales); await sales.save();
    res.json({ ok: true, salesData: payload(sales, req.user) });
  } catch (error) { console.error('Sales Data load failed', error); res.status(500).json({ error: 'Unable to load Sales Data.' }); }
};

exports.updateChecklist = async (req, res) => {
  try {
    if (!canEdit(req.user)) return res.status(403).json({ error: 'Your role has read-only access to the Sales Data checklist.' });
    const financialYear = String(req.body.financialYear || '').trim();
    if (!validYear(financialYear)) return res.status(400).json({ error: 'financialYear must use YYYY-YY.' });
    const client = await findClient(req.params.id, req.user); if (!client) return res.status(404).json({ error: 'Client not found or not accessible' });
    const sales = await getOrCreate(client, financialYear, req.user);
    const incoming = new Map((Array.isArray(req.body.checklist) ? req.body.checklist : []).map((row) => [String(row.particular || '').trim(), row]));
    const existingRows = new Map(defaultChecklist(sales.checklist).map((row) => [row.particular, row]));
    sales.checklist = PURCHASE_CHECKLIST_PARTICULARS.map((particular) => {
      const row = incoming.get(particular) || {};
      const existingProofs = new Map((existingRows.get(particular)?.files || []).filter((file) => file?.proofId).map((file) => [String(file.proofId), file]));
      const requestedProofs = (Array.isArray(row.files) ? row.files : []).filter((file) => file?.proofId).map((file) => existingProofs.get(String(file.proofId))).filter(Boolean);
      const ordinaryFiles = cleanEvidenceFiles((Array.isArray(row.files) ? row.files : []).filter((file) => !file?.proofId));
      return { particular, partialDataReceived: row.yesNo === 'Yes' && row.partialDataReceived === true, completeDataReceived: row.yesNo === 'Yes' && row.completeDataReceived === true, yesNo: ['Yes', 'No'].includes(row.yesNo) ? row.yesNo : '', date: /^\d{4}-\d{2}-\d{2}$/.test(row.date || '') ? row.date : '', files: [...requestedProofs, ...ordinaryFiles].slice(0, 20), remarks: String(row.remarks || '').trim().slice(0, 2000) };
    });
    if (req.body.userRemarks !== undefined) sales.userRemarks = String(req.body.userRemarks || '').trim().slice(0, 3000);
    sales.updatedBy = req.user._id; sales.calculatedStatus = calculatedStatus(sales); sales.markModified('checklist'); await sales.save();
    const nilReadiness = readiness(sales);
    if (nilReadiness.nilUpload && nilReadiness.ready && sales.managerVerificationStatus === 'Not Submitted') {
      await submitForManager({ sales, client, user: req.user, message: 'Nil Upload automatically submitted after client approval.' });
    }
    res.json({ ok: true, salesData: payload(sales, req.user) });
  } catch (error) { console.error('Sales checklist update failed', error); res.status(500).json({ error: 'Unable to save Sales Data checklist.' }); }
};

exports.updateScreenshots = async (req, res) => {
  try {
    if (!canEdit(req.user)) return res.status(403).json({ error: 'Your role cannot change Sales Data evidence.' });
    const financialYear = String(req.body.financialYear || '').trim(); if (!validYear(financialYear)) return res.status(400).json({ error: 'financialYear must use YYYY-YY.' });
    const client = await findClient(req.params.id, req.user); if (!client) return res.status(404).json({ error: 'Client not found or not accessible' });
    const sales = await getOrCreate(client, financialYear, req.user); sales.screenshots = cleanEvidenceFiles(req.body.screenshots); sales.updatedBy = req.user._id; sales.markModified('screenshots'); await sales.save();
    res.json({ ok: true, salesData: payload(sales, req.user) });
  } catch (error) { console.error('Sales evidence update failed', error); res.status(500).json({ error: 'Unable to save Sales evidence.' }); }
};

exports.importSalesRows = async (req, res) => {
  let insertedUploadId = null;
  let importCommitted = false;
  try {
    if (!canEdit(req.user)) return res.status(403).json({ error: 'Your role cannot replace Sales Excel files.' });
    const source = String(req.params.source || '').toLowerCase();
    if (!['base', 'portal'].includes(source)) return res.status(400).json({ error: 'source must be base or portal.' });
    const financialYear = String(req.body.financialYear || '').trim();
    if (!validYear(financialYear)) return res.status(400).json({ error: 'financialYear must use YYYY-YY.' });
    const file = cleanFile(req.body.file); if (!file) return res.status(400).json({ error: 'A securely uploaded Excel file is required.' });
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (rows.length > 10000) return res.status(413).json({ error: 'A maximum of 10,000 rows is supported per import.' });
    let parsed;
    try { parsed = normalizePurchaseRows(rows, source, financialYear, req.body.headerRowNumber); }
    catch (error) { return res.status(422).json({ error: String(error.message || '').replace(/purchase/gi, 'sales'), code: error.code, missingHeaders: error.missingHeaders || [] }); }
    if (!parsed.acceptedRows.length) return res.status(422).json({ error: 'No valid rows could be imported. Correct the listed row errors and try again.', upload: parsed, previewRows: [], validationErrors: parsed.validationErrors });
    const client = await findClient(req.params.id, req.user); if (!client) return res.status(404).json({ error: 'Client not found or not accessible' });
    const sales = await getOrCreate(client, financialYear, req.user); const field = source === 'base' ? 'baseUpload' : 'portalUpload'; const previous = sales[field];
    const fileChecksum = checksum({ name: file.name, size: file.size, rows });
    const uploadId = new mongoose.Types.ObjectId();
    const docs = parsed.acceptedRows.map((row) => ({ ...row, clientId: client._id, financialYear, uploadId, createdBy: req.user._id }));
    if (docs.length) { await SalesImportRow.insertMany(docs, { ordered: true }); insertedUploadId = uploadId; }
    sales[field] = { uploadId, source, ...file, checksum: fileChecksum, sheetName: String(req.body.sheetName || '').trim(), headerRowNumber: Number(req.body.headerRowNumber) || 1, totalRows: parsed.totalRows, importedRowCount: docs.length, validRowCount: parsed.validRowCount, warningRowCount: parsed.warningRowCount, invalidRowCount: parsed.invalidRowCount, duplicateRowCount: parsed.duplicateRowCount, totalQuantity: parsed.totalQuantity, totalGst: parsed.totalGst, validationErrors: parsed.validationErrors, importStatus: 'Imported', uploadedAt: new Date(), uploadedBy: req.user._id, uploadedByName: req.user.name || req.user.email || 'CRM User' };
    sales.dataVersion = (sales.dataVersion || 0) + 1; resetApprovals(sales); sales.updatedBy = req.user._id;
    sales.reviewHistory.push(historyItem('User', previous ? 'Revised' : 'Uploaded', req.user, `${source === 'base' ? 'Sales Base Data' : 'Sales Portal Data'} ${previous ? 'replaced' : 'uploaded'}.`));
    await refreshReconciliation(sales); sales.markModified(field); sales.markModified('reviewHistory'); await sales.save(); importCommitted = true;
    if (previous?.uploadId) await SalesImportRow.deleteMany({ uploadId: previous.uploadId });
    let automaticSubmission = null;
    if (sales.baseUpload?.importStatus === 'Imported' && sales.portalUpload?.importStatus === 'Imported') {
      try {
        automaticSubmission = await submitForManager({ sales, client, user: req.user, message: 'Automatically submitted after both Sales Excel files were imported. Reconciliation differences are included for Manager review.' });
      } catch (notificationError) {
        console.error('Sales import succeeded but automatic submission notification failed', {
          clientId: String(client._id), financialYear, message: notificationError.message, stack: notificationError.stack
        });
      }
    }
    res.json({ ok: true, upload: sales[field], previewRows: parsed.acceptedRows.slice(0, 100), validationErrors: parsed.validationErrors, summary: sales.reconciliation, salesData: payload(sales, req.user), autoSubmitted: Boolean(automaticSubmission && !automaticSubmission.duplicate) || (sales.managerVerificationStatus === 'Pending' && sales.lastSubmissionVersion === sales.dataVersion), managerNotificationCreated: Boolean(automaticSubmission?.notification?.ok), managerEmailSent: Number(automaticSubmission?.notification?.emailSent || 0) > 0, partialImport: parsed.invalidRowCount > 0 || parsed.duplicateRowCount > 0, importedRowCount: docs.length, skippedRowCount: parsed.invalidRowCount + parsed.duplicateRowCount });
  } catch (error) {
    if (insertedUploadId && !importCommitted) await SalesImportRow.deleteMany({ uploadId: insertedUploadId }).catch(() => {});
    console.error('Sales import failed', { clientId: req.params.id, source: req.params.source, financialYear: req.body?.financialYear, userId: String(req.user?._id || ''), code: error.code, message: error.message, stack: error.stack });
    res.status(500).json({ error: 'Unable to import Sales Excel data.', code: error.code || 'SALES_IMPORT_FAILED' });
  }
};

exports.removeSalesImport = async (req, res) => {
  try {
    if (!canEdit(req.user)) return res.status(403).json({ error: 'Your role cannot remove Sales Excel files.' });
    const source = String(req.params.source || '').toLowerCase(); const field = source === 'base' ? 'baseUpload' : source === 'portal' ? 'portalUpload' : '';
    if (!field) return res.status(400).json({ error: 'source must be base or portal.' });
    const financialYear = String(req.query.financialYear || '').trim(); if (!validYear(financialYear)) return res.status(400).json({ error: 'financialYear must use YYYY-YY.' });
    const client = await findClient(req.params.id, req.user); if (!client) return res.status(404).json({ error: 'Client not found or not accessible' });
    const sales = await getOrCreate(client, financialYear, req.user); const previous = sales[field]; sales[field] = null; sales.dataVersion = (sales.dataVersion || 0) + 1; resetApprovals(sales);
    sales.reviewHistory.push(historyItem('User', 'Revised', req.user, `${source === 'base' ? 'Sales Base Data' : 'Sales Portal Data'} removed.`)); await refreshReconciliation(sales); sales.markModified(field); sales.markModified('reviewHistory'); await sales.save();
    if (previous?.uploadId) await SalesImportRow.deleteMany({ uploadId: previous.uploadId });
    res.json({ ok: true, salesData: payload(sales, req.user) });
  } catch (error) { console.error('Sales import removal failed', error); res.status(500).json({ error: 'Unable to remove Sales import.' }); }
};

exports.listSalesRows = async (req, res) => {
  try {
    const financialYear = String(req.query.financialYear || '').trim(); const source = String(req.query.source || 'base').toLowerCase();
    if (!validYear(financialYear) || !['base', 'portal'].includes(source)) return res.status(400).json({ error: 'Valid financialYear and source are required.' });
    const client = await findClient(req.params.id, req.user); if (!client) return res.status(404).json({ error: 'Client not found or not accessible' });
    const sales = await SalesData.findOne({ clientId: client._id, financialYear }); const upload = source === 'base' ? sales?.baseUpload : sales?.portalUpload;
    if (!upload?.uploadId) return res.json({ ok: true, rows: [], pagination: { page: 1, pages: 1, total: 0 } });
    const page = Math.max(1, Number(req.query.page) || 1); const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 25)); const filter = { uploadId: upload.uploadId };
    if (req.query.search) { const escaped = String(req.query.search).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); filter.$or = [{ entityName: { $regex: escaped, $options: 'i' } }, { gstin: { $regex: escaped, $options: 'i' } }]; }
    const [rows, total] = await Promise.all([SalesImportRow.find(filter).sort({ rowNumber: 1 }).skip((page - 1) * limit).limit(limit).lean(), SalesImportRow.countDocuments(filter)]);
    res.json({ ok: true, rows, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (error) { console.error('Sales rows load failed', error); res.status(500).json({ error: 'Unable to load Sales rows.' }); }
};

exports.getReconciliation = async (req, res) => {
  try {
    if (!validYear(req.query.financialYear)) return res.status(400).json({ error: 'financialYear must use YYYY-YY.' });
    const client = await findClient(req.params.id, req.user); if (!client) return res.status(404).json({ error: 'Client not found or not accessible' }); const sales = await getOrCreate(client, String(req.query.financialYear).trim(), req.user);
    await refreshReconciliation(sales); await sales.save(); res.json({ ok: true, reconciliation: sales.reconciliation, readiness: readiness(sales), calculatedStatus: calculatedStatus(sales) });
  } catch (error) { console.error('Sales reconciliation failed', error); res.status(500).json({ error: 'Unable to calculate Sales reconciliation.' }); }
};

exports.submitSalesData = async (req, res) => {
  try {
    if (!canEdit(req.user)) return res.status(403).json({ error: 'Your role cannot submit Sales Data.' }); const financialYear = String(req.body.financialYear || '').trim();
    if (!validYear(financialYear)) return res.status(400).json({ error: 'financialYear must use YYYY-YY.' }); const client = await findClient(req.params.id, req.user); if (!client) return res.status(404).json({ error: 'Client not found or not accessible' });
    const sales = await getOrCreate(client, financialYear, req.user); const ready = readiness(sales); if (!ready.ready) return res.status(422).json({ error: 'Sales Data is not ready for submission.', errors: ready.errors });
    const result = await submitForManager({ sales, client, user: req.user, message: String(req.body.message || '').trim() || 'Sales Data submitted for Manager review.' }); res.json({ ok: true, salesData: payload(sales, req.user), duplicateSubmission: result.duplicate });
  } catch (error) { console.error('Sales submission failed', error); res.status(500).json({ error: 'Unable to submit Sales Data.' }); }
};

exports.managerReview = async (req, res) => {
  try {
    if (!(isAdmin(req.user) || isManager(req.user))) return res.status(403).json({ error: 'Manager permission is required.' }); const decision = String(req.body.decision || '').toUpperCase(); const message = String(req.body.message || '').trim();
    if (!['APPROVED', 'REJECTED'].includes(decision) || (decision === 'REJECTED' && !message)) return res.status(400).json({ error: decision === 'REJECTED' ? 'Rejection comments are required.' : 'Decision must be APPROVED or REJECTED.' });
    const financialYear = String(req.body.financialYear || '').trim(); if (!validYear(financialYear)) return res.status(400).json({ error: 'financialYear must use YYYY-YY.' });
    const client = await findClient(req.params.id, req.user); if (!client) return res.status(404).json({ error: 'Client not found or not accessible' }); const sales = await getOrCreate(client, financialYear, req.user);
    if (sales.managerVerificationStatus !== 'Pending') return res.status(409).json({ error: 'Sales Data is not pending Manager review.' });
    const ready = readiness(sales); if (!ready.ready) return res.status(422).json({ error: 'Sales Data is no longer ready.', errors: ready.errors });
    if (decision === 'APPROVED' && ready.warningIssueCount && req.body.acknowledgeWarnings !== true) return res.status(422).json({ error: 'Manager must acknowledge reconciliation warnings.' });
    sales.managerVerificationStatus = decision === 'APPROVED' ? 'Approved' : 'Rejected'; sales.managerVerifiedAt = new Date(); sales.managerVerifiedBy = req.user._id; sales.managerVerifiedByName = req.user.name || req.user.email || 'Manager'; sales.complianceVerificationStatus = decision === 'APPROVED' ? 'Pending' : 'Not Ready';
    sales.reviewHistory.push(historyItem('Manager', decision === 'APPROVED' ? 'Approved' : 'Rejected', req.user, message)); sales.markModified('reviewHistory'); sales.calculatedStatus = calculatedStatus(sales); await sales.save();
    await notifySalesWorkflow({ stage: decision === 'APPROVED' ? 'compliance_pending' : 'manager_rejected', client, sales, actor: req.user, message }); res.json({ ok: true, salesData: payload(sales, req.user) });
  } catch (error) { console.error('Sales Manager review failed', error); res.status(500).json({ error: 'Unable to complete Manager review.' }); }
};

exports.complianceReview = async (req, res) => {
  try {
    if (!(isAdmin(req.user) || isCompliance(req.user))) return res.status(403).json({ error: 'Compliance permission is required.' }); const decision = String(req.body.decision || '').toUpperCase(); const message = String(req.body.message || '').trim();
    if (!['APPROVED', 'REJECTED'].includes(decision) || (decision === 'REJECTED' && !message)) return res.status(400).json({ error: decision === 'REJECTED' ? 'Rejection comments are required.' : 'Decision must be APPROVED or REJECTED.' });
    const financialYear = String(req.body.financialYear || '').trim(); if (!validYear(financialYear)) return res.status(400).json({ error: 'financialYear must use YYYY-YY.' });
    const client = await findClient(req.params.id, req.user); if (!client) return res.status(404).json({ error: 'Client not found or not accessible' }); const sales = await getOrCreate(client, financialYear, req.user);
    if (sales.managerVerificationStatus !== 'Approved' || sales.complianceVerificationStatus !== 'Pending') return res.status(409).json({ error: 'Manager approval is required before Compliance review.' });
    sales.complianceVerificationStatus = decision === 'APPROVED' ? 'Approved' : 'Rejected'; sales.complianceVerifiedAt = new Date(); sales.complianceVerifiedBy = req.user._id; sales.complianceVerifiedByName = req.user.name || req.user.email || 'Compliance Manager';
    sales.reviewHistory.push(historyItem('Compliance', decision === 'APPROVED' ? 'Approved' : 'Rejected', req.user, message)); sales.markModified('reviewHistory'); sales.calculatedStatus = calculatedStatus(sales); await sales.save();
    await notifySalesWorkflow({ stage: decision === 'APPROVED' ? 'compliance_approved' : 'compliance_rejected', client, sales, actor: req.user, message }); res.json({ ok: true, salesData: payload(sales, req.user) });
  } catch (error) { console.error('Sales Compliance review failed', error); res.status(500).json({ error: 'Unable to complete Compliance review.' }); }
};
