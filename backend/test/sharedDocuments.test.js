const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDocumentFilter,
  normalizeDocumentType,
  safeFileName,
  validateDocumentMetadata
} = require('../src/services/sharedDocuments');

const valid = {
  documentType: 'company', title: 'Company Profile 2026', serviceCategory: '',
  originalName: 'Company_Profile.pdf', mimeType: 'application/pdf', size: 2048,
  storageKey: 'spaces:crm/documents/company/abc-Company_Profile.pdf'
};

test('shared document metadata accepts supported secure uploads', () => {
  assert.deepEqual(validateDocumentMetadata(valid), { ...valid, serviceCategory: 'Company Documents' });
  assert.equal(normalizeDocumentType(' POLICY '), 'policy');
});

test('policy documents accept only controlled waste categories', () => {
  const policy = validateDocumentMetadata({
    ...valid,
    documentType: 'policy',
    serviceCategory: 'EPR - Plastic Waste',
    storageKey: 'spaces:crm/documents/policy/abc-policy.pdf'
  });
  assert.equal(policy.serviceCategory, 'Plastic Waste');
  assert.throws(() => validateDocumentMetadata({ ...policy, serviceCategory: 'Annual Return Filling' }), /valid policy category/);
});

test('shared document metadata rejects unsafe file types and storage locations', () => {
  assert.throws(() => validateDocumentMetadata({ ...valid, mimeType: 'text/html' }), /Only PDF/);
  assert.throws(() => validateDocumentMetadata({ ...valid, storageKey: 'spaces:crm/uploads/file.pdf' }), /Invalid document storage/);
  assert.throws(() => validateDocumentMetadata({ ...valid, size: 26 * 1024 * 1024 }), /smaller than 25 MB/);
});

test('document queries preserve shared type, category and escaped search filtering', () => {
  const filter = buildDocumentFilter({ type: 'policy', category: 'EPR - Plastic Waste', search: 'SOP (2026)' });
  assert.equal(filter.documentType, 'policy');
  assert.equal(filter.serviceCategory, 'EPR - Plastic Waste');
  assert.equal(filter.$or.length, 4);
  assert.equal(filter.$or[0].title.test('SOP (2026)'), true);
  assert.equal(filter.$or[0].title.test('SOP 2026'), false);
});

test('download file names remove path traversal and Windows-reserved characters', () => {
  assert.equal(safeFileName('../../Board:Policy?.pdf'), 'Board-Policy-.pdf');
});
