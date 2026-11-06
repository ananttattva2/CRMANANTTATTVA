const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('quotation APIs populate approval reviewer and closure shows proof audit', () => {
  const controller = read('backend/src/controllers/quotationController.js');
  const leadPage = read('frontend/src/pages/LeadGeneration.jsx');
  assert.match(controller, /populate\('approvalDecision\.actionBy', 'name email role'\)/);
  assert.match(leadPage, /Quotation Approved/);
  assert.match(leadPage, /View approval proof/);
  assert.match(leadPage, /businessLeadCode \|\| lead\.leadCode/);
});

test('internal tickets have isolated database API, participants, chat, and attachments', () => {
  const model = read('backend/src/models/InternalTicket.js');
  const controller = read('backend/src/controllers/internalTicketController.js');
  const app = read('backend/src/index.js');
  const frontend = read('frontend/src/pages/InternalTickets.jsx');
  assert.match(model, /participants/);
  assert.match(model, /messages/);
  assert.match(controller, /cleanAttachments/);
  assert.match(controller, /canAccess/);
  assert.match(controller, /req\.query\.scope/);
  assert.match(controller, /exports\.listParticipants/);
  assert.match(controller, /exports\.downloadAttachment/);
  assert.match(controller, /Content-Disposition/);
  assert.match(controller, /res\.cloudinary\.com/);
  assert.match(controller, /isActive: \{ \$ne: false \}/);
  assert.match(controller, /activeParticipants/);
  assert.match(controller, /Select at least one participant/);
  assert.match(app, /\/api\/internal-tickets/);
  assert.match(frontend, /Internal Tickets & Team Chat/);
  assert.match(frontend, /Attach files or images/);
  assert.match(frontend, /scope.*mine/);
  assert.match(frontend, /const STATUSES = \['Open', 'In Progress', 'Resolved', 'Closed'\]/);
  assert.match(frontend, /onComposerKeyDown/);
  assert.match(frontend, /teams-app-rail/);
  assert.match(frontend, /teams-status-list/);
  assert.match(frontend, /searchUsers/);
  assert.match(frontend, /API_ENDPOINTS\.internalTickets\.participants/);
  assert.match(frontend, /teams-emoji-picker/);
  assert.match(frontend, /chatTab === 'shared'/);
  assert.match(frontend, /appView === 'files'/);
  assert.match(frontend, /appView === 'settings'/);
  assert.match(frontend, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(frontend, /RTCPeerConnection/);
  assert.match(frontend, /createOffer/);
  assert.match(frontend, /createAnswer/);
  assert.match(frontend, /Incoming call/);
  assert.match(frontend, /new Notification/);
  assert.match(frontend, /startRingtone/);
  assert.match(frontend, /createOscillator/);
  assert.match(frontend, /document\.title/);
  assert.match(frontend, /previewFile/);
  assert.match(frontend, /downloadInternalTicketFile/);
  assert.match(frontend, /responseType: 'blob'/);
  assert.match(frontend, /URL\.createObjectURL/);
  assert.match(controller, /exports\.incomingCall/);
  assert.match(controller, /exports\.callConfig/);
  assert.match(controller, /WEBRTC_TURN_URLS/);
  assert.match(model, /enum: \['Open', 'In Progress', 'Resolved', 'Closed'\]/);
  assert.match(model, /CallSessionSchema/);
  assert.match(controller, /exports\.call/);
  assert.match(controller, /action === 'answer'/);
  const routes = read('backend/src/routes/internalTickets.js');
  assert.match(routes, /get\('\/participants', requireAuth, controller\.listParticipants\)/);
  assert.match(routes, /get\('\/attachments\/download', requireAuth, controller\.downloadAttachment\)/);
  assert.ok(routes.indexOf("get('/participants'") < routes.indexOf("get('/:id'"), 'participants route must be declared before the dynamic id route');
  assert.ok(routes.indexOf("get('/attachments/download'") < routes.indexOf("get('/:id'"), 'attachment download route must be declared before the dynamic id route');
  assert.match(routes, /patch\('\/:id\/call'/);
  assert.match(routes, /get\('\/call\/incoming', requireAuth, controller\.incomingCall\)/);
  assert.match(routes, /get\('\/call\/config', requireAuth, controller\.callConfig\)/);
  assert.ok(routes.indexOf("get('/call/incoming'") < routes.indexOf("get('/:id'"), 'incoming-call route must be declared before the dynamic id route');
  const appPage = read('frontend/src/App.jsx');
  const listener = read('frontend/src/components/InternalCallListener.jsx');
  assert.match(appPage, /InternalCallListener/);
  assert.match(listener, /internalTickets\.incomingCall/);
  assert.match(listener, /getUserMedia/);
  assert.match(listener, /waitForInternalCallIce/);
});

test('desktop CRM uses a compact 100-percent browser density without changing print or mobile', () => {
  const main = read('frontend/src/main.jsx');
  const density = read('frontend/src/styles/modules/14-desktop-density.css');
  const authLayout = read('frontend/src/components/AuthLayout.jsx');
  assert.match(main, /14-desktop-density\.css/);
  assert.match(density, /--crm-desktop-scale: 0\.75/);
  assert.match(density, /min-width: 1100px/);
  assert.doesNotMatch(density, /--crm-desktop-canvas/);
  assert.match(density, /overflow-x: auto/);
  assert.match(density, /scrollbar-gutter: stable/);
  assert.match(density, /overflow-x: auto !important/);
  assert.match(density, /\.teams-shell/);
  assert.match(density, /height: calc\(133\.3334vh - 136px\)/);
  assert.match(authLayout, /auth-page/);
  assert.match(authLayout, /auth-page-grid/);
  assert.match(density, /\.auth-page,\s*\.auth-page-grid\s*\{\s*min-height: 133\.3334dvh/s);
  assert.match(density, /\.auth-page-grid\s*\{\s*height: auto/s);
  assert.match(density, /\.teams-chat-header/);
  assert.match(density, /flex: 0 0 auto/);
  assert.match(density, /@media print/);
  assert.match(density, /zoom: 1 !important/);
});

test('Sales Dashboard uses the full available width beside the sidebar', () => {
  const density = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/styles/modules/14-desktop-density.css'), 'utf8');
  assert.match(density, /body\.sales-dashboard-page \.sales-dashboard \{[\s\S]*?max-width: none !important;[\s\S]*?margin-left: 0 !important;/);
});

test('Sales activity is readable and map hover details remain inside the map card', () => {
  const density = read('frontend/src/styles/modules/14-desktop-density.css');
  const dashboard = read('frontend/src/pages/AdminDashboard.jsx');
  assert.match(density, /\.sales-reference-bottom-grid th\{[^}]*font-size:11px!important/);
  assert.match(density, /\.sales-reference-bottom-grid td\{[^}]*font-size:12px!important/);
  assert.match(density, /\.sales-map-tooltip\{position:absolute/);
  assert.match(dashboard, /container\.offsetWidth - 150/);
  assert.match(dashboard, /showMapTooltip\(event, details\)/);
});

test('operations dashboard uses the compact PO-first reference composition', () => {
  const dashboard = read('frontend/src/pages/AdminDashboard.jsx');
  const density = read('frontend/src/styles/modules/14-desktop-density.css');
  const poIndex = dashboard.lastIndexOf('<UserWisePoStatus');
  assert.match(dashboard, /operations-welcome-bar/);
  assert.ok(poIndex >= 0);
  assert.doesNotMatch(dashboard.slice(poIndex), /<OperationMisSection/);
  assert.match(dashboard, /operations-po-dashboard/);
  assert.match(density, /grid-template-columns: minmax\(0, \.82fr\) minmax\(0, 1\.18fr\)/);
  assert.match(density, /\.red-flag-table-wrap[\s\S]*max-height: 390px/);
});
