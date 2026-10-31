const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('authenticated quotation users can request management review while decision routes retain role checks', () => {
  const routes = new Map();
  const router = {};
  for (const method of ['get', 'post', 'patch', 'put']) {
    router[method] = (url, ...handlers) => routes.set(`${method} ${url}`, handlers);
  }
  const requireAuth = () => {};
  const requireRoles = (roles) => Object.assign(() => {}, { roles });
  const controller = new Proxy({}, { get: () => () => {} });
  const context = {
    module: { exports: {} }, require(name) {
      if (name === 'express') return { Router: () => router };
      if (name.includes('quotationController')) return controller;
      if (name.includes('middleware/auth')) return { requireAuth, requireRoles };
      if (name.includes('constants/roles')) return { ADMIN_ROLES: ['admin', 'superadmin'] };
      if (name.includes('services/crmCache')) return { cacheRead: () => {} };
      throw new Error(`Unexpected module: ${name}`);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/routes/quotations.js'), 'utf8'), context);
  assert.equal(routes.get('get /management-approvers')[0], requireAuth);
  assert.equal(routes.get('get /management-approvers').length, 3);
  assert.equal(routes.get('patch /:id/management-approval')[0], requireAuth);
  assert.equal(routes.get('patch /:id/management-approval').length, 2);
  assert.deepEqual(Array.from(routes.get('patch /:id/management-approval/finalize')[1].roles), ['superadmin']);
  assert.deepEqual(Array.from(routes.get('patch /:id/approval')[1].roles), ['admin', 'superadmin']);
});
