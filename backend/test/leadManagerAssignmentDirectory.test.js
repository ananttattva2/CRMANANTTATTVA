const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');

test('lead assignment loads all active managers after PO approval', () => {
  const controller = read('../src/controllers/leadController.js');
  const routes = read('../src/routes/leads.js');
  const endpoints = read('../../frontend/src/services/apiEndpoints.js');
  const page = read('../../frontend/src/pages/LeadGeneration.jsx');

  assert.match(controller, /exports\.listAssignmentUsers/);
  assert.match(controller, /User\.find\(\{ isActive: \{ \$ne: false \} \}\)/);
  assert.match(controller, /role roles team teamId managerId operationHeadId/);
  assert.match(routes, /get\('\/assignment-users', requireAuth, cacheRead, leadCtrl\.listAssignmentUsers\)/);
  assert.ok(routes.indexOf("get('/assignment-users'") < routes.indexOf("get('/:id/history'"));
  assert.match(endpoints, /assignmentUsers: '\/leads\/assignment-users'/);
  assert.match(page, /api\.get\(API_ENDPOINTS\.leads\.assignmentUsers\)/);
  assert.match(page, /function userHasManagerRole/);
  assert.match(page, /staff\.filter\(userHasManagerRole\)/);
  assert.match(page, /managerAssignmentReady/);
});
