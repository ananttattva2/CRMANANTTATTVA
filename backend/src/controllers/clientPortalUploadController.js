const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const Upload = require('../models/ClientPortalUpload');
const { contactEmailFilter } = require('../services/clientPortal');
const { uploadBuffer, deleteStored } = require('../services/purchaseEmailProofService');
const { applicantTypes } = require('../services/clientPortalApplicantTypes');
const { notifyUpload } = require('../services/clientPortalUploadNotifications');
const publicFile = row => ({ _id: row._id, lead: row.lead, kind: row.kind, applicantType: row.applicantType, notificationStatus: row.notificationStatus, name: row.name, url: row.url, size: row.size, uploadedAt: row.createdAt });
exports.options = async (req, res) => {
  try { res.json(await applicantTypes()); }
  catch { res.status(503).json({ error: 'Applicant types could not be loaded. Please retry.' }); }
};
exports.list = async (req, res) => {
  try {
    const leads = await Lead.find(contactEmailFilter(req.clientEmail)).select('_id').lean();
    const rows = await Upload.find({ lead: { $in: leads.map(row => row._id) } }).sort({ createdAt: -1 }).limit(200).lean();
    res.json(rows.map(publicFile));
  } catch { res.status(503).json({ error: 'Uploads could not be loaded. Please retry.' }); }
};
exports.create = async (req, res) => {
  let stored;
  try {
    if (!mongoose.isValidObjectId(req.params.lead)) return res.status(400).json({ error: 'Choose a valid company.' });
    const lead = await Lead.exists({ $and: [{ _id: req.params.lead }, contactEmailFilter(req.clientEmail)] });
    if (!lead) return res.status(403).json({ error: 'This company is not linked to your account.' });
    const kind = req.params.kind;
    const applicantType = String(req.body?.applicantType || '').trim();
    if (kind === 'excel' && !(await applicantTypes()).includes(applicantType)) return res.status(422).json({ error: 'Select a valid Applicant Type before uploading your Excel file.' });
    const file = req.file;
    const ext = String(file?.originalname || '').split('.').pop().toLowerCase();
    const types = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel' };
    const allowed = kind === 'excel' ? ['xlsx', 'xls'] : kind === 'po' ? ['pdf', 'png', 'jpg', 'jpeg', 'webp'] : [];
    const b = file?.buffer;
    const signature = b && ({ pdf: b.subarray(0, 5).toString() === '%PDF-', png: b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), jpg: b[0] === 255 && b[1] === 216 && b[2] === 255, jpeg: b[0] === 255 && b[1] === 216 && b[2] === 255, webp: b.subarray(0,4).toString() === 'RIFF' && b.subarray(8,12).toString() === 'WEBP', xlsx: b.subarray(0,4).equals(Buffer.from([80,75,3,4])), xls: b.subarray(0,8).equals(Buffer.from([208,207,17,224,161,177,26,225])) })[ext];
    if (!file || !allowed.includes(ext) || !signature) return res.status(422).json({ error: 'Choose a valid file in one of the supported formats.' });
    stored = await uploadBuffer(b, file.originalname, types[ext], `crm/client-portal/${lead._id}/${kind}`);
    const row = await Upload.create({ lead: lead._id, kind, applicantType: kind === 'excel' ? applicantType : undefined, notificationStatus: kind === 'excel' ? 'pending' : 'not_required', name: file.originalname.slice(0,255), url: stored.url, storageKey: stored.storageKey, size: file.size, uploadedBy: req.clientEmail });
    stored = null; // A saved upload must survive email or status update failures.
    if (kind === 'excel') {
      try {
        const result = await notifyUpload(row);
        row.notificationStatus = result.failed ? (result.sent ? 'partial' : 'failed') : 'sent';
      } catch { row.notificationStatus = 'failed'; }
      await Upload.updateOne({ _id: row._id }, { $set: { notificationStatus: row.notificationStatus } }).catch(() => {});
    }
    return res.status(201).json(publicFile(row));
  } catch {
    if (stored) await deleteStored(stored.storageKey).catch(() => {});
    return res.status(503).json({ error: 'Upload could not be saved. Please retry.' });
  }
};
