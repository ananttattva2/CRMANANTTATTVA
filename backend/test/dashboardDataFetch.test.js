const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { inclusionProjection } = require('../src/utils/inclusionProjection');

test('client list projections avoid MongoDB parent/child collisions for every request mode', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/controllers/clientController.js'), 'utf8');
  const start = source.indexOf('const projection = inclusionProjection(');
  const end = source.indexOf('const queryStartedAt', start);
  for (const query of [{}, { dashboard: 'true' }, { allocation: 'true' }, { export: 'true' }, { dashboard: 'true', export: 'true', allocation: 'true' }]) {
    const projection = vm.runInNewContext(`${source.slice(start, end)} projection`, { inclusionProjection, req: { query } });
    const fields = projection.split(' ');
    assert.equal(fields.length, new Set(fields).size);
    for (const field of fields) assert.ok(!fields.some((parent) => field.startsWith(`${parent}.`)), field);
    assert.ok(fields.includes('adminControls'));
    assert.ok(fields.includes('selectedLead'));
    if (query.dashboard) assert.ok(fields.includes('data.basic'));
  }
});

test('client ownership resolves the linked lead service assignee without matching another service', async () => {
  const { allocationOwnerKeys, permanentStaffOwnerKeys } = await import('../../frontend/src/utils/operationsUserProgress.mjs');
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/AdminDashboard.jsx'), 'utf8');
  const start = source.indexOf('function getAssignedUserKeysFromClient(');
  const end = source.indexOf('function resolveAssignedUser(', start);
  const keys = vm.runInNewContext(`${source.slice(start, end)} getAssignedUserKeysFromClient(client)`, {
    allocationOwnerKeys,
    permanentStaffOwnerKeys,
    asRecord: (value) => value && typeof value === 'object' ? value : {},
    readClientData: (value) => value.data || {},
    normalizeKey: (value) => String(value?._id || value || '').trim().toLowerCase(),
    client: { assignedServiceId: 'service-2', selectedLead: { assignments: [
      { assignedServiceId: 'service-1', assignedStaff: 'other-user' },
      { assignedServiceId: 'service-2', assignedStaff: 'owner-user', assignedStaffEmail: 'Owner@example.com' }
    ] } }
  });
  assert.ok(keys.includes('owner-user'));
  assert.ok(keys.includes('owner@example.com'));
  assert.ok(!keys.includes('other-user'));
});

test('dashboard applies fetched clients when team loading fails and falls back to the user directory', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/AdminDashboard.jsx'), 'utf8');
  const start = source.indexOf('  async function loadDashboard(');
  const end = source.indexOf('  async function handleCreateUser(', start);
  const user = { _id: 'admin-id', name: 'Admin', role: 'admin' };
  const endpoints = {
    auth: { me: 'me', roles: 'roles', adminUsers: 'adminUsers', users: 'users' },
    teams: { list: 'teams' }, clients: { list: 'clients', dashboardComplianceRecords: 'compliance', pendingApprovals: 'approvals' },
    leads: { list: 'leads' }, quotations: { list: 'quotations' }, annualReturns: { list: 'returns' }, calendarItems: { list: 'calendar' }
  };
  let snapshot;
  await vm.runInNewContext(`${source.slice(start, end)} loadDashboard({ force: true })`, {
    dashboardRequestInFlightRef: { current: false }, dashboardLoadSequenceRef: { current: 0 }, dashboardDataRef: { current: {} }, location: { pathname: '/dashboard' },
    DASHBOARD_CACHE_KEY: 'test', DASHBOARD_REQUEST_TIMEOUT_MS: 30000, currentUser: user, isUserManagementView: false,
    adminRoles: ['admin', 'superadmin'], defaultRoles: [], isSalesDashboardUser: () => false, showDashboardSwitcher: false, dashboardMode: 'operations', API_ENDPOINTS: endpoints,
    setLoading() {}, setError() {}, setCurrentUser() {}, storeSessionUser() {}, setAvailableRoles() {},
    readSessionCache: () => null, writeSessionCache() {}, normalizeKey: (value) => String(value).toLowerCase(),
    asRecordList: (value) => value || [], mergeLeadSources: (value) => value,
    readClientData: (value) => value.data || {}, complianceText: () => '',
    console: { groupCollapsed() {}, groupEnd() {}, info() {}, error() {}, table() {} },
    api: { get: async (endpoint) => {
      if (['teams', 'adminUsers', 'roles'].includes(endpoint)) throw new Error('Directory unavailable');
      if (endpoint === 'me') return { data: { user } };
      if (endpoint === 'users') return { data: { users: [user, { _id: 'owner', name: 'Owner' }] } };
      return { data: {} };
    } },
    fetchDashboardCollection: async (_endpoint, key) => ({ data: { [key]: key === 'clients' ? [{ _id: 'client-1', data: {} }] : [] } }),
    applyDashboardData: (value) => { snapshot = value; }
  });
  assert.equal(snapshot.clients[0]._id, 'client-1');
  assert.equal(snapshot.users[1].name, 'Owner');
  assert.equal(snapshot.teams.length, 0);
});

test('Sales Dashboard does not wait for operations-only compliance, annual returns or approvals', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/AdminDashboard.jsx'), 'utf8');
  const start = source.indexOf('  async function loadDashboard('), end = source.indexOf('  async function handleCreateUser(', start);
  const calls = [], user = { _id: 'admin', role: 'admin' };
  let snapshot;
  const endpoints = { auth: { me: 'me', roles: 'roles', adminUsers: 'users', users: 'users' }, teams: { list: 'teams' },
    clients: { list: 'clients', dashboardComplianceRecords: 'compliance', pendingApprovals: 'approvals' },
    leads: { list: 'leads' }, quotations: { list: 'quotes' }, annualReturns: { list: 'annual' }, calendarItems: { list: 'calendar' } };
  await vm.runInNewContext(`${source.slice(start, end)} loadDashboard({ force: true })`, {
    dashboardRequestInFlightRef: { current: false }, dashboardLoadSequenceRef: { current: 0 }, dashboardDataRef: { current: {} }, location: { pathname: '/dashboard' },
    DASHBOARD_CACHE_KEY: 'test', DASHBOARD_REQUEST_TIMEOUT_MS: 30000, currentUser: user, isUserManagementView: false,
    adminRoles: ['admin'], defaultRoles: [], isSalesDashboardUser: () => false, showDashboardSwitcher: true, dashboardMode: 'sales', API_ENDPOINTS: endpoints,
    setLoading() {}, setError() {}, setCurrentUser() {}, storeSessionUser() {}, setAvailableRoles() {}, readSessionCache: () => null, writeSessionCache() {},
    normalizeKey: value => String(value).toLowerCase(), asRecordList: value => value || [], mergeLeadSources: value => value,
    readClientData: value => value.data || {}, complianceText: () => '', console: { groupCollapsed() {}, groupEnd() {}, info() {}, error() {}, table() {} },
    api: { get: async endpoint => { calls.push(endpoint); return { data: { user, users: [user], teams: [], items: [] } }; } },
    fetchDashboardCollection: async (endpoint, key) => { calls.push(endpoint); return { data: { [key]: [{ _id: `${key}-one`, data: {} }] } }; },
    applyDashboardData: value => { snapshot = value; }
  });
  assert.ok(calls.includes('leads') && calls.includes('quotes') && calls.includes('clients'));
  assert.ok(!calls.includes('compliance') && !calls.includes('annual') && !calls.includes('approvals'));
  assert.equal(snapshot.leads.length, 1); assert.equal(snapshot.quotations.length, 1);
});
