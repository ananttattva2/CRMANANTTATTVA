const mongoose = require('mongoose');
const Client = require('../models/Client');
const PurchaseData = require('../models/PurchaseData');
const SalesData = require('../models/SalesData');
const PurchaseProof = require('../models/PurchaseProof');
const { PURCHASE_CHECKLIST_PARTICULARS, defaultChecklist, purchaseReadiness, calculatePurchaseStatus } = require('../services/purchaseDataService');
const { safeName, sha256, validateFile, decodeEmail, uploadBuffer, deleteStored, publicEmailData } = require('../services/purchaseEmailProofService');
const { logActivity } = require('../services/activityLogService');
const { getVisibleUserScope, ownerFilter } = require('../utils/visibilityScope');
const { userHasAnyRole } = require('../utils/userRoles');

function normalizedRole(user) { return String(user?.role || '').toLowerCase().replace(/[\s_-]+/g, ''); }
function canEdit(user) { const role = normalizedRole(user); return ['admin', 'superadmin'].includes(role) || (role !== 'manager' && !role.includes('compliance')); }
function validYear(value) { return /^20\d{2}-\d{2}$/.test(String(value || '').trim()); }
async function findClient(value, user, reviewRead = false) {
  if (!mongoose.Types.ObjectId.isValid(value)) return null;
  if (reviewRead) {
    const scope = userHasAnyRole(user, ['admin', 'superadmin', 'compliance']) ? {} : await require('./clientController').clientAccessFilter(user);
    return Client.findOne({ $and: [{ _id: value }, scope] });
  }
  const visibility = ownerFilter(await getVisibleUserScope(user), 'createdBy', 'adminControls.assignedTo', [
    'data.importMeta.assignedTo', 'data.importMeta.user', 'data.importMeta.userName',
    'data.importMeta.createdBy', 'data.importMeta.createdByEmail'
  ]);
  return Client.findOne({ $and: [{ _id: value }, visibility] });
}
function proofReference(proof, full = true) {
  const emailData = full ? proof.emailData : { format: proof.emailData?.format, subject: proof.emailData?.subject, from: proof.emailData?.from, sentAt: proof.emailData?.sentAt, receivedAt: proof.emailData?.receivedAt, decodeStatus: proof.emailData?.decodeStatus, decodeWarnings: proof.emailData?.decodeWarnings || [] };
  return { proofId: proof._id, name: proof.name, originalName: proof.originalName, fileType: proof.fileType, type: proof.mimeType, mimeType: proof.mimeType, size: proof.size, url: `/api/purchase-proofs/${proof._id}/download`, uploadedAt: proof.createdAt, emailData };
}
function purchasePayload(purchase, user) { const object = purchase.toObject(); return { ...object, checklist: defaultChecklist(object.checklist), readiness: purchaseReadiness(object), calculatedStatus: calculatePurchaseStatus(object), permissions: { canEdit: canEdit(user), canManagerReview: ['admin', 'superadmin', 'manager'].includes(normalizedRole(user)), canComplianceReview: ['admin', 'superadmin'].includes(normalizedRole(user)) || normalizedRole(user).includes('compliance') } }; }
function dataPayload(record, user, section = 'purchase') {
  const value = purchasePayload(record, user);
  if (section !== 'sales') return value;
  return { ...value, readiness: { ...value.readiness, errors: value.readiness.errors.map((error) => error.replace(/Purchase Base Data/g, 'Sales Base Data').replace(/Purchase Portal Upload/g, 'Sales Portal Upload')) }, calculatedStatus: record.managerVerificationStatus === 'Pending' ? 'Manager Review Pending' : value.calculatedStatus };
}
async function audit(req, action, proof, statusCode = 200) { return logActivity({ req, user: req.user, action, module: 'Purchase Email Proof', statusCode, entityType: 'PurchaseProof', entityId: String(proof?._id || ''), entityName: proof?.name || '', recordId: String(proof?._id || ''), description: `${action}: ${proof?.name || 'email proof'}`, metadata: { clientId: String(proof?.clientId || ''), financialYear: proof?.financialYear, progressParticular: proof?.progressParticular, proofId: String(proof?._id || ''), fileName: proof?.name, decodeStatus: proof?.emailData?.decodeStatus } }); }

exports.uploadEmailProof = async (req, res) => {
  let originalStorage;
  try {
    const section = String(req.body.section || 'purchase').toLowerCase(); const sectionLabel = section === 'sales' ? 'Sales' : 'Purchase'; const DataModel = section === 'sales' ? SalesData : PurchaseData;
    if (!canEdit(req.user)) return res.status(403).json({ success: false, message: `Your role cannot upload ${sectionLabel} proof.` });
    const financialYear = String(req.body.financialYear || '').trim(); const particular = String(req.body.progressParticular || '').trim();
    if (!validYear(financialYear)) return res.status(400).json({ success: false, message: 'financialYear must use YYYY-YY.' });
    if (!['purchase', 'sales'].includes(section)) return res.status(400).json({ success: false, message: 'section must be purchase or sales.' });
    if (!PURCHASE_CHECKLIST_PARTICULARS.includes(particular)) return res.status(400).json({ success: false, message: `Unknown ${sectionLabel} Progress Tracker row.` });
    const client = await findClient(req.params.clientId, req.user); if (!client) return res.status(404).json({ success: false, message: 'Client not found or not accessible.' });
    let format; try { format = validateFile(req.file); } catch (error) { return res.status(422).json({ success: false, message: error.message, code: error.code }); }
    const checksum = section === 'sales' ? sha256(Buffer.concat([Buffer.from('sales:'), req.file.buffer])) : sha256(req.file.buffer);
    const duplicate = await PurchaseProof.findOne({ clientId: client._id, financialYear, section, progressParticular: particular, checksum });
    if (duplicate) return res.json({ success: true, duplicate: true, message: 'This email proof is already uploaded.', proof: proofReference(duplicate) });
    const folder = `crm/${section}-email-proofs/${client._id}/${financialYear}`;
    originalStorage = await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype, `${folder}/originals`);
    let emailData; let decodeErrorCode = '';
    try { emailData = await decodeEmail(req.file, format); } catch (error) { decodeErrorCode = error.code || 'EMAIL_DECODE_FAILED'; emailData = { format, messageId: '', subject: '', from: { name: '', email: '' }, to: [], cc: [], bcc: [], replyTo: [], sentAt: null, receivedAt: null, textBody: '', sanitizedHtmlBody: '', headers: [], attachments: [], decodeStatus: 'Failed', decodeWarnings: [error.message || 'Email decoding failed.'] }; }
    const messageDuplicate = emailData.messageId ? await PurchaseProof.findOne({ clientId: client._id, financialYear, section, progressParticular: particular, 'emailData.messageId': emailData.messageId }) : null;
    if (messageDuplicate) { await deleteStored(originalStorage.storageKey).catch(() => {}); return res.json({ success: true, duplicate: true, message: 'This email proof is already uploaded.', proof: proofReference(messageDuplicate) }); }
    const storedAttachments = [];
    if (emailData.decodeStatus !== 'Failed') {
      for (const attachment of emailData.attachments) {
        try { const stored = await uploadBuffer(attachment.content, attachment.fileName, attachment.contentType, `${folder}/attachments`); storedAttachments.push({ ...attachment, ...stored, checksum: sha256(attachment.content) }); }
        catch { emailData.decodeWarnings.push(`${attachment.fileName}: attachment could not be stored.`); }
      }
      if (storedAttachments.length !== emailData.attachments.length) emailData.decodeStatus = 'PartiallyDecoded';
    }
    const normalizedEmail = publicEmailData(emailData, storedAttachments);
    const proof = await PurchaseProof.create({ clientId: client._id, financialYear, section, progressParticular: particular, name: safeName(req.file.originalname), originalName: safeName(req.file.originalname), fileType: format, mimeType: req.file.mimetype, size: req.file.size, storageKey: originalStorage.storageKey, storageUrl: originalStorage.storageUrl, checksum, emailData: normalizedEmail, attachments: storedAttachments.map(({ content, ...item }) => item), uploadedBy: req.user._id, uploadedByName: req.user.name || req.user.email, decodeErrorCode });
    if (emailData.decodeStatus === 'Failed') { await audit(req, 'PURCHASE_EMAIL_DECODE_FAILED', proof, 422); return res.status(422).json({ success: false, message: `${format.toUpperCase()} email could not be decoded.`, code: decodeErrorCode || 'EMAIL_DECODE_FAILED', details: emailData.decodeWarnings, proof: proofReference(proof) }); }
    const record = await DataModel.findOne({ clientId: client._id, financialYear }) || new DataModel({ clientId: client._id, financialYear, checklist: defaultChecklist(), createdBy: req.user._id });
    record.checklist = defaultChecklist(record.checklist).map((row) => row.particular === particular ? { ...row, files: [...(row.files || []), proofReference(proof, false)].slice(0, 20) } : row);
    record.updatedBy = req.user._id; record.markModified('checklist'); await record.save();
    await audit(req, 'PURCHASE_EMAIL_PROOF_UPLOADED', proof, 201); await audit(req, 'PURCHASE_EMAIL_DECODED', proof, 201);
    return res.status(201).json({ success: true, message: 'Email proof decoded and uploaded successfully.', proof: proofReference(proof), [section === 'sales' ? 'salesData' : 'purchaseData']: dataPayload(record, req.user, section) });
  } catch (error) {
    console.error('Purchase email proof upload failed', { code: error.code, message: error.message });
    if (error?.code === 11000) return res.status(409).json({ success: false, message: 'This email proof is already uploaded.', code: 'EMAIL_DUPLICATE' });
    return res.status(500).json({ success: false, message: error.message || 'Email proof upload failed.', code: error.code || 'EMAIL_UPLOAD_FAILED' });
  }
};

async function loadProof(req, res, reviewRead = false) {
  if (!mongoose.Types.ObjectId.isValid(req.params.proofId)) { res.status(404).json({ error: 'Proof not found.' }); return null; }
  const proof = await PurchaseProof.findById(req.params.proofId);
  if (!proof || !await findClient(proof.clientId, req.user, reviewRead)) { res.status(404).json({ error: 'Proof not found or not accessible.' }); return null; }
  return proof;
}
exports.getProof = async (req, res) => { const proof = await loadProof(req, res, true); if (!proof) return; await audit(req, 'PURCHASE_EMAIL_PROOF_PREVIEWED', proof); return res.json({ success: true, proof: proofReference(proof) }); };
async function streamStored(req, res, proof, stored, name, action) { const response = await fetch(stored.storageUrl); if (!response.ok) return res.status(502).json({ error: 'Stored file is temporarily unavailable.' }); const buffer = Buffer.from(await response.arrayBuffer()); res.set({ 'Content-Type': response.headers.get('content-type') || 'application/octet-stream', 'Content-Length': String(buffer.length), 'Content-Disposition': `attachment; filename="${safeName(name).replace(/"/g, '')}"`, 'Cache-Control': 'private, no-store' }); await audit(req, action, proof); return res.send(buffer); }
exports.downloadProof = async (req, res) => { const proof = await loadProof(req, res, true); if (!proof) return; return streamStored(req, res, proof, proof, proof.name, 'PURCHASE_EMAIL_PROOF_DOWNLOADED'); };
exports.downloadAttachment = async (req, res) => { const proof = await loadProof(req, res, true); if (!proof) return; const attachment = (proof.attachments || []).find((item) => item.attachmentId === req.params.attachmentId); if (!attachment) return res.status(404).json({ error: 'Attachment not found.' }); return streamStored(req, res, proof, attachment, attachment.fileName, 'PURCHASE_EMAIL_ATTACHMENT_DOWNLOADED'); };
exports.deleteProof = async (req, res) => {
  const proof = await loadProof(req, res); if (!proof) return;
  const role = normalizedRole(req.user); if (!(String(proof.uploadedBy) === String(req.user._id) || ['admin', 'superadmin'].includes(role))) return res.status(403).json({ error: 'Only the uploader or an administrator can remove this proof.' });
  const section = proof.section === 'sales' ? 'sales' : 'purchase'; const DataModel = section === 'sales' ? SalesData : PurchaseData;
  const record = await DataModel.findOne({ clientId: proof.clientId, financialYear: proof.financialYear });
  if (record) { record.checklist = defaultChecklist(record.checklist).map((row) => ({ ...row, files: (row.files || []).filter((file) => String(file.proofId || '') !== String(proof._id)) })); record.markModified('checklist'); await record.save(); }
  await audit(req, 'PURCHASE_EMAIL_PROOF_REMOVED', proof);
  await Promise.allSettled([deleteStored(proof.storageKey), ...(proof.attachments || []).map((attachment) => deleteStored(attachment.storageKey))]);
  await PurchaseProof.deleteOne({ _id: proof._id });
  return res.json({ success: true, message: 'Email proof removed.', [section === 'sales' ? 'salesData' : 'purchaseData']: record ? dataPayload(record, req.user, section) : null });
};
