const test = require('node:test');
const assert = require('node:assert/strict');

test('Admin and Super Admin land on Summary Dashboard while other roles keep their landing page', async () => {
  const { defaultLandingPath, isSummaryDashboardAdmin } = await import('../../frontend/src/utils/defaultLanding.mjs');
  assert.equal(defaultLandingPath({ role: 'admin' }), '/summary-dashboard');
  assert.equal(defaultLandingPath({ role: 'Super Admin' }), '/summary-dashboard');
  assert.equal(defaultLandingPath({ role: 'sales', roles: ['sales', 'superadmin'] }), '/summary-dashboard');
  assert.equal(defaultLandingPath({ role: 'sales' }), '/overall-dashboard');
  assert.equal(defaultLandingPath({ role: 'operation' }), '/overall-dashboard');
  assert.equal(isSummaryDashboardAdmin({ role: 'manager' }), false);
});

