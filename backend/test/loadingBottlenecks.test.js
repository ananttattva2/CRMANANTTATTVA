const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.resolve(__dirname, file), 'utf8');

test('MIS report shares admin reads but keeps manager scopes separate and reloads after invalidation', async () => {
  const { createCrmCache } = require('../src/services/crmCache');
  let revision = 'one', reads = 0;
  const stored = new Map();
  const cache = createCrmCache({ store: { get: async key => stored.get(key), set: async (key, value) => stored.set(key, value), disable: async () => {} },
    revisions: { read: async () => revision, bump: async () => (revision = 'two') } });
  const source = read('../src/services/userProductivityReport.js');
  const start = source.indexOf('async function getUserProductivityReport(');
  const end = source.indexOf('\nfunction canViewUserWorkReport', start);
  const query = () => ({ select() { return this; }, sort() { return this; }, limit() { return this; }, maxTimeMS() { return this; }, lean: async () => [] });
  const model = { find: query };
  const context = { require: name => name === './misClientProjection' ? { readMisClients: async () => [] } : { getCrmCache: () => cache }, entityId: value => String(value || ''),
    reportDateRange: () => ({ from: '2026-10-01', to: '2026-10-13', start: new Date('2026-10-01'), end: new Date('2026-10-14') }),
    reportQuery: async (_name, result) => result, buildUserProductivityReport: () => ({ users: [] }),
    Team: { find() { reads++; return query(); } }, User: model, UserSession: model, AuditLog: model, Lead: model, TemporaryLead: model, Client: { ...model, aggregate: () => ({ option: async () => [] }) },
    SupportTicket: { aggregate: () => ({ option: async () => [] }) }
  };
  vm.createContext(context); vm.runInContext(source.slice(start, end), context);
  await context.getUserProductivityReport({ requester: { _id: 'admin-one', role: 'admin' } });
  await context.getUserProductivityReport({ requester: { _id: 'admin-two', role: 'superadmin' } });
  assert.equal(reads, 1);
  await context.getUserProductivityReport({ requester: { _id: 'manager-one', role: 'manager' } });
  await context.getUserProductivityReport({ requester: { _id: 'manager-two', role: 'manager' } });
  assert.equal(reads, 3);
  await cache.invalidate();
  await context.getUserProductivityReport({ requester: { _id: 'admin-one', role: 'admin' } });
  assert.equal(reads, 4);
});

test('dashboard snapshot loads all scoped records with one request instead of fetching each directory page', async () => {
  const source = read('../../frontend/src/pages/AdminDashboard.jsx');
  const code = source.slice(source.indexOf('async function fetchDashboardCollection'), source.indexOf('\nfunction readCalendarTodoItems'));
  const calls = [];
  const clients = Array.from({ length: 251 }, (_, index) => ({ _id: `client-${index}` }));
  const context = { api: { get: async (url, config) => { calls.push({ url, config }); return { data: { clients, pagination: { totalPages: 1 } } }; } } };
  vm.createContext(context); vm.runInContext(code, context);
  const result = await context.fetchDashboardCollection('/clients', 'clients', { timeout: 20000 }, { dashboard: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].config.params.snapshot, true);
  assert.equal(calls[0].config.params.dashboard, true);
  assert.equal(result.data.clients.length, 251);
});

test('lead dashboard snapshot retains access/exclusion filters and every record without count/summary queries', async () => {
  const source = read('../src/controllers/leadController.js');
  const start = source.indexOf('exports.listLeads =');
  const end = source.indexOf('\nexports.', start + 1);
  const rows = Array.from({ length: 251 }, (_, index) => ({ _id: `lead-${index}` }));
  const scope = { createdBy: 'owner' }, exclusion = { createdBy: { $ne: 'test' } };
  let matched, skip, limit, body;
  const query = { select() { return this; }, populate() { return this; }, sort() { return this; },
    skip(value) { skip = value; return this; }, limit(value) { limit = value; return this; }, maxTimeMS() { return this; }, lean: async () => rows };
  const context = { exports: {}, process, req: { query: { dashboard: 'true', snapshot: 'true', paginated: 'true' }, user: {} },
    res: { set() {}, json(value) { body = value; } },
    leadAccessFilter: async () => scope, getAdminCreatedLeadReferences: async () => [], dashboardLeadExclusionFilter: () => exclusion,
    combineAccessFilters: (...filters) => ({ $and: filters }), mongoose: { mongo: { BSON: { EJSON: { stringify: JSON.stringify } } } },
    Lead: { find(filter) { matched = filter; return query; }, countDocuments() { assert.fail('snapshot must not count separately'); }, aggregate() { assert.fail('snapshot must not aggregate a directory summary'); } },
    require: () => ({ getCrmCache: () => ({ remember: async (_key, load) => load() }) })
  };
  vm.createContext(context); vm.runInContext(source.slice(start, end), context);
  await context.exports.listLeads(context.req, context.res);
  assert.deepEqual(Array.from(matched.$and), [scope, exclusion]);
  assert.equal(skip, 0); assert.equal(limit, 0);
  assert.equal(body.leads.length, 251); assert.equal(body.pagination.total, 251); assert.equal(body.pagination.hasNextPage, false);
});

test('quotation list renders before slow lead/editor references and later receives service enrichment', async () => {
  const source = read('../../frontend/src/pages/Quotations.jsx');
  const start = source.indexOf('  async function loadPage(');
  const end = source.indexOf('  async function openManagementApproval', start);
  let release, loading = true, savedRows = [];
  const references = new Promise(resolve => { release = resolve; });
  const context = { listRequestRef: { current: 0 }, leads: [],
    API_ENDPOINTS: { auth: { me: 'me' }, leads: { list: 'leads' }, quotations: { list: 'quotes', serviceCategories: 'categories', piboCategories: 'pibos', dropdownOptions: 'dropdowns' } },
    api: { get(url) { if (url === 'me') return Promise.resolve({ data: { user: {} } });
      if (url === 'quotes') return Promise.resolve({ data: { quotations: [{ _id: 'q1', leadId: 'l1', items: [{ basicAmount: 100 }] }] } });
      return references.then(() => ({ data: { leads: [{ _id: 'l1' }], categories: [], options: [] } })); } },
    setLoading: value => { loading = value; }, setError() {}, setCurrentUser() {}, setLeads() {}, setCustomServiceCategories() {}, setPiboCategories() {}, setCustomDropdownOptions() {}, setPiboCategoriesLoading() {},
    mergeLeadLists: rows => rows, findLeadForQuotation: (quote, rows) => rows.find(row => row._id === quote.leadId),
    syncQuotationItemsWithLead: items => items.map(item => ({ ...item, businessCategory: 'updated' })),
    setQuotations: value => { savedRows = typeof value === 'function' ? value(savedRows) : value; }
  };
  vm.createContext(context); vm.runInContext(source.slice(start, end), context);
  await context.loadPage();
  assert.equal(loading, false); assert.equal(savedRows[0]._id, 'q1');
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(savedRows[0].items[0].businessCategory, 'updated');
  assert.equal(savedRows[0].items[0].basicAmount, 100);
});

test('client dashboard snapshot retains every scoped client and does not repeat directory counts', async () => {
  const source = read('../src/controllers/clientController.js');
  const start = source.indexOf('exports.listClients =');
  const end = source.indexOf('\nexports.', start + 1);
  const rows = Array.from({ length: 251 }, (_, index) => ({ _id: `client-${index}`, data: {} }));
  const scope = { createdBy: 'owner' };
  let matched, skip, limit, body;
  const chain = data => ({ select() { return this; }, populate() { return this; }, sort() { return this; },
    skip(value) { skip = value; return this; }, limit(value) { limit = value; return this; }, maxTimeMS() { return this; }, lean: async () => data });
  const context = { exports: {}, process,
    req: { query: { dashboard: 'true', snapshot: 'true', paginated: 'true' }, user: {} }, res: { set() {}, json(value) { body = value; } },
    clientAccessFilter: async () => scope, getAdminCreatedLeadReferences: async () => [], dashboardClientExclusionFilter: () => ({ excluded: true }),
    combineAccessFilters: (...filters) => ({ $and: filters }), inclusionProjection: fields => fields.join(' '),
    mongoose: { mongo: { BSON: { EJSON: { stringify: JSON.stringify } } } },
    Client: { find(filter) { matched = filter; return chain(rows); }, countDocuments() { assert.fail('snapshot must not count separately'); }, aggregate() { assert.fail('snapshot must not aggregate a directory summary'); } },
    PendingApproval: { find: () => chain([]) }, ClientComplianceReview: { find: () => chain([]) },
    require: () => ({ getCrmCache: () => ({ remember: async (_key, load) => load() }) })
  };
  vm.createContext(context); vm.runInContext(source.slice(start, end), context);
  await context.exports.listClients(context.req, context.res);
  assert.equal(matched.$and[0].$and.includes(scope), true);
  assert.equal(skip, 0); assert.equal(limit, 0);
  assert.equal(body.clients.length, 251); assert.equal(body.pagination.total, 251);
  assert.equal(body.pagination.hasNextPage, false);
});
