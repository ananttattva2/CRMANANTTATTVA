const test = require('node:test');
const assert = require('node:assert/strict');
const contacts = require('../src/services/clientPortalContacts');
const Message = require('../src/models/ClientPortalMessage');
const mailer = require('../src/utils/mailer');
const controllerPath = require.resolve('../src/controllers/clientPortalMessageController');
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
test('client messages validate recipient server-side and reject access to unrelated companies', async () => {
  const original = contacts.portalContacts;
  try {
    contacts.portalContacts = async () => null; delete require.cache[controllerPath];
    let ctrl = require(controllerPath), res = response();
    await ctrl.send({ clientEmail: 'client@example.com', body: { lead: 'other', recipient: 'attacker@example.com', message: 'Help' } }, res);
    assert.equal(res.code, 403);
    contacts.portalContacts = async () => ({ lead: { _id: 'one' }, contacts: [{ id: 'spoc@example.com', email: 'spoc@example.com' }] }); delete require.cache[controllerPath];
    ctrl = require(controllerPath); res = response();
    await ctrl.send({ clientEmail: 'client@example.com', body: { lead: 'one', recipient: 'attacker@example.com', message: 'Help' } }, res);
    assert.equal(res.code, 422);
  } finally { contacts.portalContacts = original; delete require.cache[controllerPath]; }
});
test('support message is emailed only to selected team member and retained if email fails', async () => {
  const original = { contacts: contacts.portalContacts, create: Message.create, count: Message.countDocuments, update: Message.updateOne, mail: mailer.sendMail };
  const sent = [];
  contacts.portalContacts = async () => ({ lead: { _id: 'one', company: 'Test & Co', leadCode: 'L1' }, contacts: [{ id: 'it_support@ananttattva.com', email: 'it_support@ananttattva.com', name: 'IT Support', role: 'Technical support' }, { id: 'spoc@example.com', email: 'spoc@example.com', name: 'Account SPOC', role: 'SPOC' }] });
  Message.countDocuments = async () => 0;
  Message.create = async row => ({ ...row, _id: 'message1', createdAt: new Date() });
  Message.updateOne = async () => ({});
  mailer.sendMail = async (to, subject, html) => { sent.push({ to, subject, html }); };
  delete require.cache[controllerPath];
  try {
    const ctrl = require(controllerPath), req = { clientEmail: 'client@example.com', body: { lead: 'one', recipient: 'it_support@ananttattva.com', message: '<Please help>' } };
    let res = response(); await ctrl.send(req, res);
    assert.equal(res.code, 201); assert.equal(res.body.emailStatus, 'sent'); assert.deepEqual(sent.map(row => row.to), ['it_support@ananttattva.com']);
    assert.match(sent[0].html, /&lt;Please help&gt;/); assert.match(sent[0].html, /client@example.com/);
    mailer.sendMail = async () => { throw new Error('SMTP unavailable'); };
    res = response(); await ctrl.send(req, res); assert.equal(res.code, 201); assert.equal(res.body.emailStatus, 'failed'); assert.equal(res.body.body, '<Please help>');
    Message.countDocuments = async () => 30;
    res = response(); await ctrl.send(req, res); assert.equal(res.code, 429);
  } finally { contacts.portalContacts = original.contacts; Message.create = original.create; Message.countDocuments = original.count; Message.updateOne = original.update; mailer.sendMail = original.mail; delete require.cache[controllerPath]; }
});
test('staff uploads use account ownership scope and admin visibility', () => {
  const { uploadLeadFilter } = require('../src/controllers/clientPortalStaffController');
  assert.deepEqual(uploadLeadFilter(null), {});
  const filter = uploadLeadFilter({ ids: ['staff1'], identities: ['staff@example.com'] });
  assert.ok(filter.$or.some(clause => clause.closedBy));
  assert.ok(filter.$or.some(clause => clause['assignments.assignedStaff']));
  assert.ok(JSON.stringify(filter).includes('staff@example'));
  assert.deepEqual(uploadLeadFilter({ ids: [], identities: [] }), { _id: { $exists: false } });
});
test('staff upload listing only queries Excel submissions from visible client leads', async () => {
  const Lead = require('../src/models/Lead');
  const Upload = require('../src/models/ClientPortalUpload');
  const Client = require('../src/models/Client');
  const ctrl = require('../src/controllers/clientPortalStaffController');
  const original = { lead: Lead.find, clients: Client.find, rows: Upload.find, count: Upload.countDocuments };
  Client.find = () => ({ select: () => ({ lean: async () => [] }) });
  const filters = [];
  Lead.find = () => ({ select: () => ({ lean: async () => [{ _id: 'visible1', company: 'Visible Company', leadCode: 'L1' }] }) });
  Upload.countDocuments = async filter => { filters.push(filter); return 1; };
  Upload.find = filter => { filters.push(filter); return { sort: () => ({ skip: () => ({ limit: () => ({ select: () => ({ lean: async () => [{ _id: 'upload1', lead: 'visible1', name: 'data.xlsx', applicantType: 'Importer' }] }) }) }) }) }; };
  try {
    const res = response();
    await ctrl.list({ user: { _id: 'user1', role: 'operation', email: 'staff@example.com' }, query: { page: '1', q: 'Visible' } }, res);
    assert.equal(res.code, 200); assert.equal(res.body.rows[0].company, 'Visible Company'); assert.equal(res.body.total, 1);
    for (const filter of filters) { assert.equal(filter.kind, 'excel'); assert.deepEqual(filter.lead.$in, ['visible1']); }
  } finally { Lead.find = original.lead; Client.find = original.clients; Upload.find = original.rows; Upload.countDocuments = original.count; }
});
