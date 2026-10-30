const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Lead Generation uses inline tabs for temporary and notified leads', () => {
  const page = read('frontend/src/pages/LeadGeneration.jsx');
  const app = read('frontend/src/App.jsx');
  const styles = read('frontend/src/styles/modules/02-auth-leads-and-client-detail.css');

  assert.match(page, /function LeadWorkspaceTabs/);
  assert.match(page, /label: 'Cold Leads'/);
  assert.match(page, /label: 'Notified Leads'/);
  assert.match(page, /workspaceTab === 'temporary'/);
  assert.match(page, /workspaceTab === 'notified'/);
  assert.match(page, /h-12 min-w-\[150px\]/);
  assert.match(page, /key=\{workspaceTab\} className="lead-tab-content-enter"/);
  assert.match(styles, /@keyframes lead-tab-content-in/);
  assert.doesNotMatch(page, /navigate\('\/sales\/lead-generation\/temporary'\)/);
  assert.match(app, /lead-generation\/temporary.*Navigate to="\/sales\/lead-generation\?tab=temporary"/);
});

test('Notified Leads contains closed manager assignments that are still waiting for staff', () => {
  const page = read('frontend/src/pages/LeadGeneration.jsx');
  const controller = read('backend/src/controllers/leadController.js');

  assert.match(page, /\['manager', 'admin', 'superadmin'\]\.includes\(currentRole\)/);
  assert.match(page, /initialWorkspace === 'notified' && !canViewNotifiedLeads \? 'leads'/);
  assert.match(page, /showNotified=\{canViewNotifiedLeads\}/);
  assert.match(page, /\.\.\.\(showNotified \? \[\{ id: 'notified'/);
  assert.match(page, /function pendingManagerAssignmentRows/);
  assert.match(page, /if \(!isClosed \|\| !hasManager \|\| hasStaff\) return \[\]/);
  assert.match(page, /service\.managerAssignedStaffName/);
  assert.match(page, /Manager Assigned to Staff/);
  assert.match(page, /Manager action pending/);
  assert.match(page, /No notified leads are pending/);
  assert.match(page, /workspaceTab === 'notified' \? activeTotal : null/);
  assert.match(page, /workspace: initialWorkspace/);
  assert.match(page, /\[Lead Notifications\] fetch complete/);
  assert.match(page, /onDirectoryQueryChange\(currentDirectoryRequest\(\)\)/);
  assert.match(controller, /function hasPendingClosedManagerAssignment/);
  assert.match(controller, /if \(workspace === 'notified'\)/);
  assert.match(controller, /candidates\.filter\(\(lead\) => hasPendingClosedManagerAssignment\(lead, req\.user\)\)/);
  assert.doesNotMatch(controller, /filters\.push\(notifiedFilter\)/);
  assert.match(controller, /notifiedPending: workspace === 'notified' \? total : undefined/);
});

test('manager assignment email links to and explains the Notified Leads tab', () => {
  const service = read('backend/src/services/leadAssignmentNotifications.js');

  assert.match(service, /lead-generation\?tab=notified/);
  assert.match(service, /complete pending list is available in the <strong>Notified Leads<\/strong> tab/);
  assert.match(service, /Once you assign a staff member/);
  assert.match(service, /Open Notified Leads/);
});
