const path = require('node:path');

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
]);

function cleanText(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeDocumentType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['company', 'policy'].includes(normalized) ? normalized : '';
}

function safeFileName(value) {
  return path.basename(cleanText(value, 220)).replace(/[<>:"/\\|?*]/g, '-');
}

function validateDocumentMetadata(body = {}) {
  const documentType = normalizeDocumentType(body.documentType);
  const title = cleanText(body.title, 160);
  const serviceCategory = cleanText(body.serviceCategory, 120);
  const originalName = safeFileName(body.originalName);
  const mimeType = cleanText(body.mimeType, 120).toLowerCase();
  const size = Number(body.size);
  const storageKey = cleanText(body.storageKey, 1024);

  if (!documentType) throw Object.assign(new Error('Choose Company Document or Policy Document.'), { status: 400 });
  if (title.length < 2) throw Object.assign(new Error('Document title is required.'), { status: 400 });
  if (!serviceCategory) throw Object.assign(new Error('Service category is required.'), { status: 400 });
  if (!originalName) throw Object.assign(new Error('Original file name is required.'), { status: 400 });
  if (!ALLOWED_MIME_TYPES.has(mimeType)) throw Object.assign(new Error('Only PDF, JPG, PNG, WEBP and GIF files are allowed.'), { status: 400 });
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_DOCUMENT_BYTES) throw Object.assign(new Error('File must be smaller than 25 MB.'), { status: 400 });
  if (!storageKey.startsWith('spaces:crm/documents/')) throw Object.assign(new Error('Invalid document storage reference.'), { status: 400 });

  return { documentType, title, serviceCategory, originalName, mimeType, size, storageKey };
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildDocumentFilter(query = {}, { includeCategory = true } = {}) {
  const filter = {};
  const documentType = normalizeDocumentType(query.type || query.documentType);
  const category = cleanText(query.category, 120);
  const search = cleanText(query.search, 100);
  if (documentType) filter.documentType = documentType;
  if (includeCategory && category) filter.serviceCategory = category;
  if (search) {
    const term = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ title: term }, { originalName: term }, { serviceCategory: term }, { uploadedByName: term }];
  }
  return filter;
}

function serializeDocument(document = {}) {
  return {
    id: String(document._id || document.id || ''),
    documentType: document.documentType,
    title: document.title,
    serviceCategory: document.serviceCategory,
    originalName: document.originalName,
    mimeType: document.mimeType,
    size: document.size,
    uploadedBy: String(document.uploadedBy?._id || document.uploadedBy || ''),
    uploadedByName: document.uploadedBy?.name || document.uploadedByName,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt
  };
}

module.exports = {
  ALLOWED_MIME_TYPES,
  MAX_DOCUMENT_BYTES,
  buildDocumentFilter,
  normalizeDocumentType,
  safeFileName,
  serializeDocument,
  validateDocumentMetadata
};
