const { pipeline } = require('node:stream/promises');
const SharedDocument = require('../models/SharedDocument');
const spaces = require('../services/spacesStorage');
const {
  buildDocumentFilter,
  normalizeDocumentType,
  safeFileName,
  serializeDocument,
  validateDocumentMetadata
} = require('../services/sharedDocuments');

function pageNumber(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

exports.list = async (req, res) => {
  const page = pageNumber(req.query.page, 1);
  const limit = pageNumber(req.query.limit, 24, 60);
  const filter = buildDocumentFilter(req.query);
  const collectionFilter = buildDocumentFilter(req.query, { includeCategory: false });

  const [documents, total, collections, totalsByType] = await Promise.all([
    SharedDocument.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    SharedDocument.countDocuments(filter),
    SharedDocument.aggregate([
      { $match: collectionFilter },
      { $group: { _id: '$serviceCategory', count: { $sum: 1 }, latestAt: { $max: '$createdAt' } } },
      { $sort: { count: -1, _id: 1 } }
    ]),
    SharedDocument.aggregate([
      { $group: { _id: '$documentType', count: { $sum: 1 } } }
    ])
  ]);

  const typeTotals = Object.fromEntries(totalsByType.map((item) => [item._id, item.count]));
  res.set('Cache-Control', 'private, no-store');
  return res.json({
    documents: documents.map(serializeDocument),
    collections: collections.map((item) => ({ serviceCategory: item._id, count: item.count, latestAt: item.latestAt })),
    totals: { company: typeTotals.company || 0, policy: typeTotals.policy || 0 },
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }
  });
};

exports.create = async (req, res) => {
  const metadata = validateDocumentMetadata(req.body);
  const key = spaces.rawKey(metadata.storageKey);
  let uploaded;
  try {
    uploaded = await spaces.head(key);
  } catch {
    return res.status(400).json({ error: 'The uploaded file could not be verified. Please upload it again.' });
  }
  if (Number(uploaded.ContentLength) !== metadata.size || String(uploaded.ContentType || '').toLowerCase() !== metadata.mimeType) {
    return res.status(400).json({ error: 'Uploaded file details could not be verified.' });
  }

  const uploadedByName = String(req.user?.name || [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' ') || req.user?.email || 'CRM User').trim();
  let document;
  try {
    document = await SharedDocument.create({ ...metadata, uploadedBy: req.user._id, uploadedByName });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'This uploaded file has already been added.' });
    throw error;
  }
  return res.status(201).json({ document: serializeDocument(document.toObject()) });
};

exports.file = async (req, res) => {
  const document = await SharedDocument.findById(req.params.id).lean();
  if (!document) return res.status(404).json({ error: 'Document not found.' });

  const object = await spaces.get(spaces.rawKey(document.storageKey));
  const download = String(req.query.download || '').toLowerCase() === 'true';
  const disposition = download ? 'attachment' : 'inline';
  res.set({
    'Content-Type': object.ContentType || document.mimeType || 'application/octet-stream',
    'Content-Disposition': `${disposition}; filename="${safeFileName(document.originalName).replace(/"/g, '')}"`,
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff'
  });
  if (object.ContentLength) res.set('Content-Length', String(object.ContentLength));
  await pipeline(object.Body, res);
};

exports.validateType = (req, res, next) => {
  if (req.query.type && !normalizeDocumentType(req.query.type)) return res.status(400).json({ error: 'Invalid document type.' });
  return next();
};
