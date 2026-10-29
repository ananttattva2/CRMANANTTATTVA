const test = require('node:test');
const assert = require('node:assert/strict');
const Lead = require('../src/models/Lead');
const { applicantTypes, closedServices } = require('../src/services/clientPortalApplicantTypes');
const ctrl = require('../src/controllers/clientPortalUploadController');
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
test('Applicant Type options contain only the selected company closed service types', async () => {
  const original = Lead.find;
  let filter;
  Lead.find = value => { filter = value; return { select: () => ({ lean: async () => [{ serviceSelections: [{ assignedServiceId: 'one', applicantType: 'PIBO', subApplicantType: 'Importer' }, { assignedServiceId: 'two', applicantType: 'PIBO', subApplicantType: 'Brand Owner' }], assignments: [{ assignedServiceId: 'two' }, { assignedServiceId: 'one', closedAt: new Date() }] }] }) }; };
  try {
    assert.deepEqual(await applicantTypes('client@example.com', 'lead1'), ['Importer']);
    assert.equal(filter.$and[1]._id, 'lead1');
    assert.ok(filter.$and[0].$or[0]['contacts.emails'].test('client@example.com'));
    assert.deepEqual(await applicantTypes('', 'lead1'), []);
  } finally { Lead.find = original; }
});
test('closed-service matching uses service IDs and does not expose open or unrelated applicant types', () => {
  assert.deepEqual(closedServices({ serviceSelections: [{ assignedServiceId: 'a', applicantType: 'Importer' }, { assignedServiceId: 'b', applicantType: 'Recycler' }], assignments: [{ assignedServiceId: 'b', closedByText: 'Sales' }, { assignedServiceId: 'a' }] }).map(row => row.applicantType), ['Recycler']);
  assert.deepEqual(closedServices({ serviceSelections: [{ applicantType: 'Importer' }, { applicantType: 'Recycler' }], closedAt: new Date() }), []);
  assert.deepEqual(closedServices({ applicantType: 'Importer', closedAt: new Date() }).map(row => row.applicantType), ['Importer']);
});
test('Excel uploads require an Applicant Type from the server catalog', async () => {
  const original = { exists: Lead.exists, find: Lead.find };
  Lead.exists = async () => ({ _id: '012345678901234567890123' });
  Lead.find = () => ({ select: () => ({ lean: async () => [{ applicantType: 'Importer', closedAt: new Date() }] }) });
  try {
    for (const applicantType of ['', 'Forged category']) {
      const res = response();
      await ctrl.create({ params: { lead: '012345678901234567890123', kind: 'excel' }, body: { applicantType }, clientEmail: 'client@example.com' }, res);
      assert.equal(res.code, 422); assert.match(res.body.error, /Applicant Type/);
    }
  } finally { Lead.exists = original.exists; Lead.find = original.find; }
});
test('Excel upload retains Applicant Type and saved file when email delivery fails', async () => {
  const Upload = require('../src/models/ClientPortalUpload');
  const notifications = require('../src/services/clientPortalUploadNotifications');
  const storagePath = require.resolve('../src/services/spacesStorage');
  const controllerPath = require.resolve('../src/controllers/clientPortalUploadController');
  const original = { exists: Lead.exists, find: Lead.find, create: Upload.create, update: Upload.updateOne, notify: notifications.notifyUpload, storage: require.cache[storagePath], controller: require.cache[controllerPath] };
  let saved, status, deleted = false;
  Lead.exists = async () => ({ _id: '012345678901234567890123' });
  Lead.find = () => ({ select: () => ({ lean: async () => [{ applicantType: 'Importer', closedAt: new Date() }] }) });
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
    Lead.exists = original.exists; Lead.find = original.find; Upload.create = original.create; Upload.updateOne = original.update; notifications.notifyUpload = original.notify;
    if (original.storage) require.cache[storagePath] = original.storage; else delete require.cache[storagePath];
    require.cache[controllerPath] = original.controller;
  }
});
