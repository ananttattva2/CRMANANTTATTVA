const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const express = require('express');
const Lead = require('../src/models/Lead');
const Upload = require('../src/models/ClientPortalUpload');
const { serviceWorkspaces } = require('../src/services/clientPortalWorkspaces');
test('authenticated multipart PO upload accepts service fields, saves context and triggers receipt notification', async () => {
  const leadId = '012345678901234567890123';
  const lead = { _id: leadId, serviceSelections: [{ assignedServiceId: 's1', subApplicantType: 'Producer', servicesOffered: 'Annual Return Filling' }], assignments: [{ assignedServiceId: 's1', closedAt: '2026-01-01', poYearRows: [{ annualReturnYear: '2025-26', poNumber: '003', fy: '2026-27' }] }] };
  const notification = require('../src/services/clientPortalUploadNotifications');
  const storagePath = require.resolve('../src/services/spacesStorage');
  const original = { exists: Lead.exists, leadUpdate: Lead.updateOne, byId: Lead.findById, create: Upload.create, update: Upload.updateOne, notify: notification.notifyUpload, storage: require.cache[storagePath], secret: process.env.JWT_SECRET };
  let notified;
  Lead.exists = async () => ({ _id: leadId }); Lead.findById = () => ({ select() { return this; }, lean: async () => lead });
  Lead.updateOne = async () => ({ modifiedCount: 1 });
  Upload.create = async row => ({ ...row, _id: 'upload1', createdAt: new Date() }); Upload.updateOne = async () => {};
  notification.notifyUpload = async row => { notified = row; return { sent: 4, failed: 0 }; };
  require.cache[storagePath] = { id: storagePath, filename: storagePath, loaded: true, exports: { uploadBuffer: async () => ({ url: 'https://files.test/po.pdf', storageKey: 'spaces:po' }) } };
  delete require.cache[require.resolve('../src/controllers/clientPortalUploadController')]; delete require.cache[require.resolve('../src/routes/clientPortal')];
  process.env.JWT_SECRET = 'multipart-test-only';
  const app = express(); app.use('/client-portal', require('../src/routes/clientPortal')); const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    const body = new FormData(); body.append('applicantType', 'Producer'); body.append('serviceKey', serviceWorkspaces(lead)[0].serviceKey); body.append('file', new Blob(['%PDF-1.7 test'], { type: 'application/pdf' }), 'client-po.pdf');
    const token = jwt.sign({ type: 'client', email: 'client@example.com' }, process.env.JWT_SECRET, { audience: 'client-portal', issuer: 'crm-client-portal', expiresIn: '1h' });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/client-portal/uploads/${leadId}/po`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body });
    assert.equal(response.status, 201); const row = await response.json(); assert.equal(row.kind, 'po'); assert.equal(row.serviceContext.poNumber, '003'); assert.equal(row.notificationStatus, 'sent'); assert.equal(notified.kind, 'po'); assert.equal(notified.applicantType, 'Producer');
  } finally { await new Promise(resolve => server.close(resolve)); Lead.exists = original.exists; Lead.updateOne = original.leadUpdate; Lead.findById = original.byId; Upload.create = original.create; Upload.updateOne = original.update; notification.notifyUpload = original.notify; require.cache[storagePath] = original.storage; if (original.secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = original.secret; }
});
