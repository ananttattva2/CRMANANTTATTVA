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
  User.find = () => ({ select: () => ({ lean: async () => [{ email: 'closer@example.com' }] }) });
  portal.loadPortalData = async () => ({ clients: [{ _id: 'lead1', spoc: { email: 'spoc@example.com' }, assignments: [{ spoc: { email: 'spoc@example.com' } }, { spoc: { email: 'service@example.com' } }] }] });
  mailer.sendMail = async (to, subject, html) => { sent.push({ to, subject, html }); if (to === 'service@example.com') throw new Error('Mail unavailable'); };
  const servicePath = require.resolve('../src/services/clientPortalUploadNotifications');
  delete require.cache[servicePath];
  try {
    const { notifyUpload } = require(servicePath);
    const result = await notifyUpload({ lead: 'lead1', applicantType: 'Importer', uploadedBy: 'client@example.com', name: 'details.xlsx', url: 'https://files.example/data.xlsx' });
    assert.deepEqual(new Set(sent.map(row => row.to)), new Set(['spoc@example.com', 'service@example.com', 'closer@example.com']));
    assert.deepEqual(result, { sent: 2, failed: 1 });
    assert.match(sent[0].subject, /Importer data received/);
    assert.match(sent[0].html, /&lt;Client &amp; Co&gt;/);
    assert.match(sent[0].html, /available for your review/);
    assert.match(sent[0].html, /details.xlsx/);
  } finally { Lead.findById = original.lead; User.find = original.users; portal.loadPortalData = original.portal; mailer.sendMail = original.mail; delete require.cache[servicePath]; }
});
