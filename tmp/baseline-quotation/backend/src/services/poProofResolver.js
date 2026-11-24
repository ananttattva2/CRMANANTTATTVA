const text = (value) => String(value ?? '').trim();

const URL_FIELDS = [
  'poFileUrl', 'poProofUrl', 'poDocumentUrl', 'poUploadUrl', 'poAttachmentUrl',
  'uploadedDocumentUrl', 'documentUrl', 'fileUrl', 'secureUrl', 'secure_url',
  'imageUrl', 'image_url', 'pdfUrl', 'pdf_url', 'downloadUrl', 'download_url',
  'directUrl', 'direct_url', 'sourceUrl', 'source_url', 'originalUrl', 'original_url',
  'url'
];

const NAME_FIELDS = [
  'poFileName', 'poProofName', 'poDocumentName', 'poUploadName', 'poAttachmentName',
  'uploadedDocumentName', 'documentName', 'fileName', 'originalName', 'name',
  'displayName', 'display_name', 'originalFilename', 'original_filename',
  'filename', 'originalFileName', 'original_file_name'
];

const MIME_FIELDS = ['poFileMimeType', 'poProofMimeType', 'mimeType', 'contentType', 'type'];
const SIZE_FIELDS = ['poFileSize', 'poProofSize', 'fileSize', 'bytes', 'size'];

const FILE_FIELDS = [
  'poProof', 'poFile', 'poDocument', 'poUpload', 'poAttachment',
  'uploadedDocument', 'document', 'file', 'attachment',
  'cloudinary', 'media', 'upload', 'resource', 'asset',
  'payload', 'meta', 'metadata', 'data', 'info', 'detail', 'extra', 'source'
];

const DEEP_URL_RE = /^https?:\/\/(?:[^\s/]+\/api\/assets\/file\?|(?:res\.cloudinary\.com|[\w.-]+\.digitaloceanspaces\.com|storage\.googleapis\.com|[\w.-]+\.amazonaws\.com|commondatastorage\.googleapis\.com|lh\d*\.googleusercontent\.com|firebasestorage\.googleapis\.com|drive\.google\.com|pdf\.s3)\/)\S/i;
const DEEP_NAME_RE = /\.(?:pdf|png|jpe?g|webp|gif|heic|tiff?|bmp)(?:[?#].*)?$/i;

function firstText(source, fields) {
  if (!source || typeof source !== 'object') return '';
  for (const field of fields) {
    const raw = source[field];
    if (raw === null || raw === undefined) continue;
    if (Array.isArray(raw)) continue;
    if (typeof raw === 'object') continue;
    const value = text(raw);
    if (!value) continue;
    if (/\[object/.test(value)) continue;
    return value;
  }
  return '';
}

// Last-resort depth-limited recursive scan: any valid https:// proof URL buried in nested
// legacy objects (Cloudinary responses stored directly without flattening, etc.)
function deepFindProofField(root, want, seen, depth) {
  depth = depth || 0;
  if (depth > 8 || root == null) return '';
  if (typeof root === 'string') {
    const v = root.trim();
    if (!v) return '';
    if (want === 'url') return DEEP_URL_RE.test(v) ? v : '';
    return DEEP_NAME_RE.test(v) || (v.length < 220 && v.length > 3 && v.indexOf('http') !== 0 && /[A-Za-z]/.test(v)) ? v : '';
  }
  if (typeof root !== 'object') return '';
  seen = seen || new WeakSet();
  if (seen.has(root)) return '';
  try { seen.add(root); } catch (e) { /* primitive */ }
  const entries = Array.isArray(root)
    ? root.map((val, i) => [i, val])
    : Object.entries(root);
  for (let i = 0; i < entries.length; i++) {
    const found = deepFindProofField(entries[i][1], want, seen, depth + 1);
    if (found) return found;
  }
  return '';
}

function resolvePoProof(source, fallbacks) {
  const args = Array.prototype.slice.call(arguments);
  const candidates = args.filter((value) => value && typeof value === 'object');
  const composite = Object.assign.apply(Object, [{}].concat(candidates));
  const allSources = candidates.concat([composite]);
  for (let ci = 0; ci < allSources.length; ci++) {
    const candidate = allSources[ci];
    const directUrl = firstText(candidate, URL_FIELDS);
    if (directUrl) {
      const name = firstText(candidate, NAME_FIELDS) || deepFindProofField(candidate, 'name');
      const mime = firstText(candidate, MIME_FIELDS);
      const size = firstText(candidate, SIZE_FIELDS);
      return { url: directUrl, name, mimeType: mime, size };
    }
    for (let fi = 0; fi < FILE_FIELDS.length; fi++) {
      const nested = candidate[FILE_FIELDS[fi]];
      if (!nested || typeof nested !== 'object') continue;
      const nestedUrl = firstText(nested, URL_FIELDS);
      if (nestedUrl) {
        const name = firstText(nested, NAME_FIELDS) || firstText(candidate, NAME_FIELDS) || deepFindProofField(nested, 'name');
        const mime = firstText(nested, MIME_FIELDS) || firstText(candidate, MIME_FIELDS);
        const size = firstText(nested, SIZE_FIELDS) || firstText(candidate, SIZE_FIELDS);
        return { url: nestedUrl, name, mimeType: mime, size };
      }
    }
  }
  // Last-ditch deep recursive on union across all candidates
  const deepUrl = deepFindProofField(composite, 'url');
  if (deepUrl) {
    return {
      url: deepUrl,
      name: deepFindProofField(composite, 'name'),
      mimeType: firstText(composite, MIME_FIELDS),
      size: firstText(composite, SIZE_FIELDS)
    };
  }
  return { url: '', name: '', mimeType: '', size: '' };
}

function approvalRows(payload = {}) {
  if (Array.isArray(payload.poYearRows)) return payload.poYearRows;
  if (Array.isArray(payload.poRows)) return payload.poRows;
  if (Array.isArray(payload.purchaseOrders)) return payload.purchaseOrders;
  return [];
}

function samePoNumber(left, right) {
  const leftNumber = text(left?.poNumber);
  const rightNumber = text(right?.poNumber);
  return Boolean(leftNumber && rightNumber && leftNumber === rightNumber);
}

function indexedEntryForPo(entries, rowIndex, normalizedRow) {
  const entry = entries[rowIndex];
  if (!entry) return null;
  const expectedPoNumber = text(normalizedRow?.poNumber);
  const indexedPoNumber = text(entry.poNumber);
  return !expectedPoNumber || !indexedPoNumber || samePoNumber(entry, normalizedRow) ? entry : null;
}

function resolveApprovalPoProof({ approval = {}, normalizedRow = {}, rowIndex = 0 } = {}) {
  const payload = approval.payload || {};
  const rows = approvalRows(payload);
  const manifest = Array.isArray(payload.poProofManifest) ? payload.poProofManifest : [];
  const poNumber = text(normalizedRow.poNumber);
  const proof = resolvePoProof(
    normalizedRow,
    indexedEntryForPo(rows, rowIndex, normalizedRow),
    rows.find((row) => poNumber && samePoNumber(row, normalizedRow)),
    indexedEntryForPo(manifest, rowIndex, normalizedRow),
    manifest.find((row) => poNumber && samePoNumber(row, normalizedRow)),
    payload,
    approval
  );
  return {
    poFileUrl: proof.url,
    poFileName: proof.name,
    poFileMimeType: proof.mimeType,
    poFileSize: proof.size !== '' && Number.isFinite(Number(proof.size)) ? Number(proof.size) : null,
    hasPoFileUrl: Boolean(proof.url)
  };
}

module.exports = { resolvePoProof, resolveApprovalPoProof };
