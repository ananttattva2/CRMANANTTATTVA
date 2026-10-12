const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

test('announcements allow an optional image and email every active CRM user', () => {
  const controller = read('../src/controllers/notificationController.js');
  const page = read('../../frontend/src/pages/Notifications.jsx');
  assert.doesNotMatch(controller, /Announcement image is required/);
  assert.match(controller, /User\.find\(\{ isActive: \{ \$ne: false \}/);
  assert.match(controller, /ANNOUNCEMENT_EMAIL_CONCURRENCY/);
  assert.match(controller, /attempt <= 3/);
  assert.match(controller, /emailDelivery/);
  assert.match(controller, /formatAnnouncementDescription/);
  assert.match(controller, /join\('<br \/>'\)/);
  assert.match(page, /Add Announcement/);
  assert.match(page, /accept="image\/\*"/);
  assert.match(page, /Choose Image \(Optional\)/);
  assert.match(page, /Field label="Announcement Image \(Optional\)"/);
  assert.doesNotMatch(page, /modalMode === 'create' && !draft\.attachmentUrl/);
  assert.match(page, /Submit Announcement/);
  assert.match(controller, /Official CRM Announcement/);
  assert.match(controller, /ANANTTATTVA CRM/);
  assert.match(controller, /\^https:\\\/\\\//);
  const contacts = read('../../frontend/src/features/clientMaster/ClientMasterFormSections.jsx');
  assert.match(contacts, /title="Authorised Person"/);
  assert.match(contacts, /Add Authorized Person/);
  assert.match(contacts, /Add OTP Contact/);
  assert.match(contacts, /Add Coordinating Person/);
  assert.match(contacts, /min-w-\[980px\]/);
  assert.match(contacts, />Action<\/th>/);
  assert.match(contacts, /Edit \$\{title\}/);
});

test('internal ticket email is claimed once per ticket, sender, and recipient', () => {
  const controller = read('../src/controllers/internalTicketController.js');
  const delivery = read('../src/models/InternalTicketEmailDelivery.js');
  const service = read('../src/services/internalTicketEmails.js');
  assert.match(controller, /notifyFirstMessage/);
  assert.match(delivery, /\{ ticket: 1, sender: 1, recipient: 1 \}/);
  assert.match(delivery, /unique: true/);
  assert.match(delivery, /enum: \['sending', 'sent', 'failed'\]/);
  assert.match(service, /error\?\.code === 11000/);
  assert.match(service, /Promise\.allSettled/);
  assert.match(service, /This notification is sent only for the first message/);
});

test('CRM automatically logs out and audits users after two idle hours', () => {
  const app = read('../../frontend/src/App.jsx');
  const auth = read('../src/controllers/authController.js');
  assert.match(app, /2 \* 60 \* 60 \* 1000/);
  assert.match(app, /reason: 'inactivity'/);
  assert.match(auth, /Automatically logged out after 2 hours of inactivity/);
});

test('document progress and frozen fields follow Producer and Importer applicability', () => {
  const page = read('../../frontend/src/pages/ClientMaster.jsx');
  const sections = read('../../frontend/src/features/clientMaster/ClientMasterFormSections.jsx');
  assert.match(page, /category\.includes\('producer'\)/);
  assert.match(page, /category\.includes\('importer'\)/);
  assert.match(page, /new Set\(\['factoryLicense'/);
  assert.match(page, /isNonCorporate \? \['cin'\] : \['dicDcssi'\]/);
  assert.match(page, /getApplicableComplianceRows\(client\)\.flatMap/);
  assert.match(sections, /Not Applicable/);
  assert.match(sections, /disabled=\{!applicable\}/);
});

test('support ticket replies create bell notifications for the other participant', () => {
  const controller = read('../src/controllers/supportTicketController.js');
  assert.match(controller, /kind: 'support_ticket_reply'/);
  assert.match(controller, /audience, metadata: \{ ticketId:/);
});

test('clearing a bell notification hides it only for the current user', () => {
  const controller = read('../src/controllers/notificationController.js');
  const model = read('../src/models/Notification.js');
  const routes = read('../src/routes/notifications.js');
  const topbar = read('../../frontend/src/components/dashboard/Topbar.jsx');
  assert.match(model, /hiddenBy: \[\{ type: mongoose\.Schema\.Types\.ObjectId/);
  assert.match(controller, /item\.hiddenBy.*String\(user\._id\)/);
  assert.match(controller, /\$addToSet: \{ hiddenBy: req\.user\._id \}/);
  assert.match(routes, /router\.delete\('\/:id', requireAuth, notificationCtrl\.clearNotification\)/);
  assert.match(topbar, /Clear only for me/);
});
