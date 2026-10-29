const test = require('node:test');
const assert = require('node:assert/strict');
const Lead = require('../src/models/Lead');
const Category = require('../src/models/QuotationPiboCategory');
const { applicantTypes } = require('../src/services/clientPortalApplicantTypes');
const ctrl = require('../src/controllers/clientPortalUploadController');
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
test('Applicant Type catalog includes all built-in families, direct types and custom CRM options', async () => {
  const original = Category.find;
  Category.find = () => ({ select: () => ({ lean: async () => [{ name: 'Custom Applicant' }] }) });
  try {
    const types = await applicantTypes();
    for (const type of ['Producer', 'Brand Owner', 'Importer', 'PIBO', 'SIMP', 'PWP', 'Producer (Small & Micro)', 'Manufacturer of Raw Material', 'Recycler', 'Refurbisher', 'Retreader', 'Used Oil Importers', 'Custom Applicant']) assert.ok(types.includes(type), type);
    assert.equal(types.length, new Set(types).size);
  } finally { Category.find = original; }
});
test('Excel uploads require an Applicant Type from the server catalog', async () => {
  const original = { exists: Lead.exists, find: Category.find };
  Lead.exists = async () => ({ _id: '012345678901234567890123' });
  Category.find = () => ({ select: () => ({ lean: async () => [] }) });
  try {
    for (const applicantType of ['', 'Forged category']) {
      const res = response();
      await ctrl.create({ params: { lead: '012345678901234567890123', kind: 'excel' }, body: { applicantType }, clientEmail: 'client@example.com' }, res);
      assert.equal(res.code, 422); assert.match(res.body.error, /Applicant Type/);
    }
  } finally { Lead.exists = original.exists; Category.find = original.find; }
});
test('Excel upload retains Applicant Type and saved file when email delivery fails', async () => {
  const Upload = require('../src/models/ClientPortalUpload');
  const notifications = require('../src/services/clientPortalUploadNotifications');
  const storagePath = require.resolve('../src/services/spacesStorage');
  const controllerPath = require.resolve('../src/controllers/clientPortalUploadController');
  const original = { exists: Lead.exists, find: Category.find, create: Upload.create, update: Upload.updateOne, notify: notifications.notifyUpload, storage: require.cache[storagePath], controller: require.cache[controllerPath] };
  let saved, status, deleted = false;
  Lead.exists = async () => ({ _id: '012345678901234567890123' });
  Category.find = () => ({ select: () => ({ lean: async () => [] }) });
  Upload.create = async row => { saved = { ...row, _id: 'upload1' }; return saved; };
  Upload.updateOne = async (filter, update) => { status = update.$set.notificationStatus; };
  notifications.notifyUpload = async () => { throw new Error('SMTP unavailable'); };
  require.cache[storagePath] = { id: storagePath, filename: storagePath, loaded: true, exports: { uploadBuffer: async () => ({ url: 'https://files.example/data.xlsx', storageKey: 'spaces:excel' }), deleteObject: async () => { deleted = true; } } };
  delete require.cache[controllerPath];
  try {
    const controller = require(controllerPath), res = response();
    await controller.create({ params: { lead: '012345678901234567890123', kind: 'excel' }, body: { applicantType: 'Importer' }, clientEmail: 'client@example.com', file: { originalname: 'data.xlsx', buffer: Buffer.from([80,75,3,4]), size: 4 } }, res);
    assert.equal(res.code, 201); assert.equal(saved.applicantType, 'Importer'); assert.equal(status, 'failed'); assert.equal(res.body.notificationStatus, 'failed'); assert.equal(deleted, false);
  } finally {
    Lead.exists = original.exists; Category.find = original.find; Upload.create = original.create; Upload.updateOne = original.update; notifications.notifyUpload = original.notify;
    if (original.storage) require.cache[storagePath] = original.storage; else delete require.cache[storagePath];
    require.cache[controllerPath] = original.controller;
  }
});
