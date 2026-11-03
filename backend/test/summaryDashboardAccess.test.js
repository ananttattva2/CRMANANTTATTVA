const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requireRoles } = require('../src/middleware/auth');
const { ADMIN_ROLES } = require('../src/constants/roles');

test('Summary Dashboard APIs require Admin or Super Admin roles', () => {
  const leads = fs.readFileSync(path.resolve(__dirname, '../src/routes/leads.js'), 'utf8');
  const insights = fs.readFileSync(path.resolve(__dirname, '../src/routes/dashboardInsights.js'), 'utf8');
  assert.match(leads, /router\.get\('\/summary-dashboard', requireAuth, requireRoles\(ADMIN_ROLES\), cacheRead, revenueCtrl\.pipeline\)/);
  assert.match(insights, /router\.get\('\/annual-return-operations', requireAuth, requireRoles\(ADMIN_ROLES\), cacheRead, controller\.annualReturnOperations\)/);
});

test('Summary Dashboard role guard accepts either admin role, including a secondary role', () => {
  const guard = requireRoles(ADMIN_ROLES);
  for (const user of [
    { role: 'admin' },
    { role: 'superadmin' },
    { role: 'sales', roles: ['sales', 'admin'] }
  ]) {
    let passed = false;
    guard({ user }, { status: () => ({ json: () => assert.fail('Admin was rejected') }) }, () => { passed = true; });
    assert.equal(passed, true);
  }
  let status;
  guard({ user: { role: 'sales' } }, { status: value => { status = value; return { json: () => {} }; } }, () => assert.fail('Sales user was allowed'));
  assert.equal(status, 403);
});

test('frontend Summary Dashboard routes and menu are role protected', () => {
  const app = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/App.jsx'), 'utf8');
  const navigation = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/constants/dashboard.js'), 'utf8');
  assert.match(app, /path="\/summary-dashboard"[^\n]+allowedRoles=\{\['admin', 'superadmin'\]\}/);
  assert.match(app, /path="\/summary-dashboard\/operations"[^\n]+allowedRoles=\{\['admin', 'superadmin'\]\}/);
  assert.match(navigation, /label: 'Summary Dashboard'[^\n]+roles: adminRoles/);
});

