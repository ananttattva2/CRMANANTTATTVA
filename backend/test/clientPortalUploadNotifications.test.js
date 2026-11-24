const test = require('node:test');
const assert = require('node:assert/strict');
const Lead = require('../src/models/Lead');
const User = require('../src/models/User');
const portal = require('../src/services/clientPortal');
const mailer = require('../src/utils/mailer');
test('Excel receipt emails reach deduplicated SPOCs and closing user with escaped professional content', async () => {
  const original = { lead: Lead.findById, users: User.find, portal: portal.loadPortalData, mail: mailer.sendMail };
  const sent = [];
  Lead.findById = () => ({ lean: async () => ({ company: '<Client & Co>', leadCode: 'L-123', closedBy: 'closer', closedByEmail: 'CLOSER@example.com' }) });
  User.find = filter => ({ select: () => ({ lean: async () => filter.$or ? [{ email: 'superadmin@example.com' }, { email: 'spoc@example.com' }] : [{ email: 'closer@example.com' }] }) });
  portal.loadPortalData = async () => ({ clients: [{ _id: 'lead1', spoc: { email: 'spoc@example.com' }, assignments: [{ spoc: { email: 'spoc@example.com' } }, { spoc: { email: 'service@example.com' } }] }] });
  mailer.sendMail = async (to, subject, html) => { sent.push({ to, subject, html }); if (to === 'service@example.com') throw new Error('Mail unavailable'); };
  const servicePath = require.resolve('../src/services/clientPortalUploadNotifications');
  delete require.cache[servicePath];
  try {
    const { notifyUpload } = require(servicePath);
    const result = await notifyUpload({ lead: 'lead1', applicantType: 'Importer', uploadedBy: 'client@example.com', name: 'details.xlsx', url: 'https://files.example/data.xlsx' });
    assert.deepEqual(new Set(sent.map(row => row.to)), new Set(['spoc@example.com', 'service@example.com', 'closer@example.com', 'superadmin@example.com']));
    assert.deepEqual(result, { sent: 3, failed: 1 });
    assert.match(sent[0].subject, /Importer data received/);
    assert.match(sent[0].html, /&lt;Client &amp; Co&gt;/);
    assert.match(sent[0].html, /available for your review/);
    assert.match(sent[0].html, /details.xlsx/);
    assert.match(sent[0].html, /<html>/);
    assert.match(sent[0].html, /Client Data Uploads/);
    assert.match(sent[0].html, /background:#f26522/);
  } finally { Lead.findById = original.lead; User.find = original.users; portal.loadPortalData = original.portal; mailer.sendMail = original.mail; delete require.cache[servicePath]; }
});
test('service-scoped purchase and sales receipts reach lead generator, selected SPOC, Admin and Super Admin', async () => {
  const original = { lead: Lead.findById, users: User.find, portal: portal.loadPortalData, mail: mailer.sendMail };
  const sent = [];
  Lead.findById = () => ({ lean: async () => ({ company: 'Company', createdBy: 'creator-id', serviceSelections: [{ assignedServiceId: 'one', subApplicantType: 'Producer', closedAt: new Date() }] }) });
  User.find = filter => ({ select: () => ({ lean: async () => {
    if (filter.$or) { assert.ok(filter.$or[0].role.test('admin')); assert.ok(filter.$or[0].role.test('super_admin')); assert.equal(filter.isActive.$ne, false); return [{ email: 'admin@example.com' }, { email: 'super@example.com' }]; }
    assert.ok(filter._id.$in.includes('creator-id')); return [{ email: 'creator@example.com' }];
  } }) });
  portal.loadPortalData = async () => ({ clients: [{ _id: 'lead1', spoc: { email: 'wrong@example.com' }, assignments: [{ assignedServiceId: 'one', spoc: { email: 'spoc@example.com' } }, { assignedServiceId: 'two', spoc: { email: 'unrelated@example.com' } }] }] });
  mailer.sendMail = async (to, subject, html) => { sent.push({ to, subject, html }); };
  const servicePath = require.resolve('../src/services/clientPortalUploadNotifications'); delete require.cache[servicePath];
  try {
    const { notifyUpload } = require(servicePath);
    for (const dataType of ['purchase', 'sales']) {
      sent.length = 0;
      const result = await notifyUpload({ lead: 'lead1', applicantType: 'Producer', dataType, serviceContext: { assignedServiceId: 'one', servicesOffered: 'Annual Return Filling', annualReturnYear: '2025-26', poNumber: '003' }, uploadedBy: 'client@example.com', name: 'data.xlsx', url: 'https://files.test/data.xlsx' });
      assert.deepEqual(new Set(sent.map(row => row.to)), new Set(['creator@example.com', 'spoc@example.com', 'admin@example.com', 'super@example.com']));
      assert.deepEqual(result, { sent: 4, failed: 0 });
      assert.match(sent[0].subject.toLowerCase(), new RegExp(dataType));
      assert.match(sent[0].html, /2025-26/); assert.match(sent[0].html, /003/); assert.match(sent[0].html, /Annual Return Filling/);
    }
  } finally { Lead.findById = original.lead; User.find = original.users; portal.loadPortalData = original.portal; mailer.sendMail = original.mail; delete require.cache[servicePath]; }
});
