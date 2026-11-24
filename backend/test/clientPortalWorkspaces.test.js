const test = require('node:test');
const assert = require('node:assert/strict');
const { serviceWorkspaces } = require('../src/services/clientPortalWorkspaces');
const Lead = require('../src/models/Lead');
const Upload = require('../src/models/ClientPortalUpload');
const leadId = '012345678901234567890123';
const source = (id = leadId) => ({ _id: id, serviceSelections: [{ assignedServiceId: 'producer-ar', applicantType: 'PIBO', subApplicantType: 'Producer', servicesOffered: 'Annual Return Filling' }], assignments: [{ assignedServiceId: 'producer-ar', closedAt: new Date(), poYearRows: ['2025-26', '2026-27'].map(annualReturnYear => ({ fy: '2026-27', annualReturnYear, poNumber: '003' })) }] });
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
test('same Producer and PO have separate stable workspaces for each annual year', () => {
  const rows = serviceWorkspaces(source());
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.annualReturnYear).sort(), ['2025-26', '2026-27']);
  assert.ok(rows.every(row => row.applicantType === 'Producer' && row.poNumber === '003' && row.servicesOffered === 'Annual Return Filling'));
  assert.notEqual(rows[0].serviceKey, rows[1].serviceKey);
  assert.deepEqual(rows.map(row => row.serviceKey), serviceWorkspaces(source()).map(row => row.serviceKey));
  assert.notEqual(rows[0].serviceKey, serviceWorkspaces(source('112345678901234567890123'))[0].serviceKey);
  const open = source(); delete open.assignments[0].closedAt;
  assert.deepEqual(serviceWorkspaces(open), []);
});
test('uploads validate company service keys and persist server-owned year and PO context', async () => {
  const notifications = require('../src/services/clientPortalUploadNotifications');
  const storagePath = require.resolve('../src/services/spacesStorage');
  const controllerPath = require.resolve('../src/controllers/clientPortalUploadController');
  const saved = { exists: Lead.exists, find: Lead.find, byId: Lead.findById, create: Upload.create, update: Upload.updateOne, notify: notifications.notifyUpload, storage: require.cache[storagePath], controller: require.cache[controllerPath] };
  const persisted = [];
  Lead.exists = async () => ({ _id: leadId });
  Lead.find = () => ({ select() { return this; }, lean: async () => [source()] });
  Lead.findById = () => ({ select() { return this; }, lean: async () => source() });
  Upload.create = async row => { persisted.push(row); return { ...row, _id: 'file1' }; };
  Upload.updateOne = async () => {};
  notifications.notifyUpload = async () => ({ sent: 4, failed: 0 });
  let uploads = 0;
  require.cache[storagePath] = { id: storagePath, filename: storagePath, loaded: true, exports: { uploadBuffer: async () => { uploads++; return { url: 'https://files.test/data.xlsx', storageKey: 'spaces:key' }; } } };
  delete require.cache[controllerPath];
  try {
    const ctrl = require(controllerPath);
    const contexts = serviceWorkspaces(source());
    const req = { params: { lead: leadId, kind: 'excel' }, clientEmail: 'client@example.com', file: { originalname: 'purchase.xlsx', buffer: Buffer.from([80,75,3,4,1]), size: 5 } };
    for (const key of ['', 'forged', serviceWorkspaces(source('112345678901234567890123'))[0].serviceKey]) {
      const res = response(); await ctrl.create({ ...req, body: { applicantType: 'Producer', dataType: 'purchase', serviceKey: key } }, res); assert.equal(res.code, 422);
    }
    assert.equal(uploads, 0);
    for (const [index, context] of contexts.entries()) {
      const res = response(); await ctrl.create({ ...req, body: { applicantType: 'Producer', dataType: index ? 'sales' : 'purchase', serviceKey: context.serviceKey, annualReturnYear: '2099-00', poNumber: 'forged' } }, res);
      assert.equal(res.code, 201); assert.equal(res.body.serviceKey, context.serviceKey); assert.equal(res.body.serviceContext.annualReturnYear, context.annualReturnYear); assert.equal(res.body.serviceContext.poNumber, '003');
    }
    assert.equal(persisted.length, 2); assert.notEqual(persisted[0].serviceKey, persisted[1].serviceKey);
  } finally { Lead.exists = saved.exists; Lead.find = saved.find; Lead.findById = saved.byId; Upload.create = saved.create; Upload.updateOne = saved.update; notifications.notifyUpload = saved.notify; require.cache[storagePath] = saved.storage; require.cache[controllerPath] = saved.controller; }
});
