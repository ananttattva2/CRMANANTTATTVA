const test = require('node:test');
const assert = require('node:assert/strict');
const Lead = require('../src/models/Lead');
const ctrl = require('../src/controllers/clientPortalUploadController');
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
test('uploads reject invalid companies and cross-account access before storing files', async () => {
  let res = response();
  await ctrl.create({ params: { lead: 'invalid', kind: 'po' } }, res);
  assert.equal(res.code, 400);
  const original = Lead.exists;
  Lead.exists = async () => null;
  try {
    res = response();
    await ctrl.create({ params: { lead: '012345678901234567890123', kind: 'po' }, clientEmail: 'client@example.com' }, res);
    assert.equal(res.code, 403);
  } finally { Lead.exists = original; }
});
test('uploads reject missing files, unsupported formats and forged PDF content', async () => {
  const original = Lead.exists;
  Lead.exists = async () => ({ _id: '012345678901234567890123' });
  try {
    for (const file of [undefined, { originalname: 'attack.svg', buffer: Buffer.from('<svg>') }, { originalname: 'order.pdf', buffer: Buffer.from('not a pdf') }]) {
      const res = response();
      await ctrl.create({ params: { lead: '012345678901234567890123', kind: 'po' }, clientEmail: 'client@example.com', file }, res);
      assert.equal(res.code, 422);
    }
  } finally { Lead.exists = original; }
});
test('valid PDF upload persists company metadata and cleans storage when persistence fails', async () => {
  const Upload = require('../src/models/ClientPortalUpload');
  const storagePath = require.resolve('../src/services/spacesStorage');
  const originalModule = require.cache[storagePath];
  const storage = {};
  require.cache[storagePath] = { id: storagePath, filename: storagePath, loaded: true, exports: storage };
  const originals = { exists: Lead.exists, create: Upload.create, upload: storage.uploadBuffer, remove: storage.deleteObject };
  let deleted = false;
  Lead.exists = async () => ({ _id: '012345678901234567890123' });
  storage.uploadBuffer = async () => ({ url: 'https://files.example/order.pdf', storageKey: 'spaces:test-file' });
  storage.deleteObject = async () => { deleted = true; };
  try {
    Upload.create = async row => ({ ...row, _id: 'upload1', createdAt: new Date() });
    const req = { params: { lead: '012345678901234567890123', kind: 'po' }, clientEmail: 'client@example.com', file: { originalname: 'order.pdf', buffer: Buffer.from('%PDF-1.7'), size: 8 } };
    let res = response(); await ctrl.create(req, res);
    assert.equal(res.code, 201); assert.equal(res.body.name, 'order.pdf'); assert.equal(res.body.lead, req.params.lead);
    assert.equal(res.body.storageKey, undefined); assert.equal(res.body.uploadedBy, undefined);
    Upload.create = async () => { throw new Error('database unavailable'); };
    res = response(); await ctrl.create(req, res);
    assert.equal(res.code, 503); assert.equal(deleted, true);
  } finally { Lead.exists = originals.exists; Upload.create = originals.create; storage.uploadBuffer = originals.upload; storage.deleteObject = originals.remove; if (originalModule) require.cache[storagePath] = originalModule; else delete require.cache[storagePath]; }
});
