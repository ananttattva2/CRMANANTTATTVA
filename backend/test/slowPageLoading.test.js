const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const page = name => fs.readFileSync(path.resolve(__dirname, `../../frontend/src/pages/${name}.jsx`), 'utf8');

test('Lead Open/Close list starts auth, staff and compact page requests in parallel without loading all quotations', async () => {
  const source = page('LeadGeneration');
  const code = source.slice(source.indexOf('  async function loadPage()'), source.indexOf('  const lastDirectoryParams'));
  const calls = [];
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const context = { location: { search: '' }, viewMode: 'list', viewLead: null, leadListRequestRef: { current: 0 }, URLSearchParams,
    API_ENDPOINTS: { auth: { me: 'me' }, leads: { assignmentUsers: 'users', list: 'leads' } },
    api: { get(url, options) { calls.push({ url, options }); return pending.then(() => ({ data: { user: { name: 'User' }, users: [], leads: [] } })); } },
    setLoading() {}, setError() {}, setCurrentUser() {}, setStaff() {}, setAllCcpLeads() {}, setLeads() {}, setLeadPagination() {}, setLeadSummary() {},
    loadLeadReferenceData() { assert.fail('Form data must not block the directory'); }
  };
  vm.createContext(context); vm.runInContext(code, context);
  const load = context.loadPage();
  assert.deepEqual(calls.map(row => row.url), ['me', 'users', 'leads']);
  assert.equal(calls[2].options.params.directory, true);
  assert.equal(calls[2].options.params.limit, 10);
  release(); await load;
});

test('Pending Approval starts the special/PO feed alongside primary reads and preserves pagination on live refresh', async () => {
  const source = page('PendingApproval');
  const code = source.slice(source.indexOf('  async function loadPage(options'), source.indexOf('  function requestClientDecision'));
  const calls = [], resets = [];
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const context = { loadRequestRef: { current: 0 }, currentUser: {}, cachedApprovalData: null, readPendingApprovalCache: () => null,
    PENDING_APPROVAL_AUTH_TIMEOUT_MS: 4500, PENDING_APPROVAL_DATA_TIMEOUT_MS: 20000,
    API_ENDPOINTS: { auth: { me: 'me' }, clients: { pendingApprovals: 'approvals' }, leads: { duplicateApprovals: 'special' } },
    api: { get(url) { calls.push(url); return pending.then(() => ({ data: { pendingClients: [], pendingQuotations: [], approvals: [] } })); } },
    console: { info() {}, groupCollapsed() {}, table() {}, groupEnd() {}, error() {} },
    applyBulkLeadCreators: rows => rows, applyBulkQuotationOwners: rows => rows, hydratePurchaseOrderApprovals: rows => rows,
    storeSessionUser() {}, writePendingApprovalCache() {}, setLoading() {}, setError() {}, setCurrentUser() {}, setPendingClients() {}, setPendingQuotations() {}, setDebugInfo() {},
    setClientPage: () => resets.push('clients'), setQuotePage: () => resets.push('quotes'), setPoPage: () => resets.push('po'),
    setDuplicateLeadApprovals() {}, setServiceApprovals() {}, setRoyaltyApprovals() {}, setTemporaryApprovals() {}, setPoApprovals() {}
  };
  vm.createContext(context); vm.runInContext(code, context);
  const load = context.loadPage({ force: true, silent: true });
  assert.deepEqual(calls, ['special', 'me', 'approvals']);
  release(); await load;
  assert.deepEqual(resets, []);
});

test('sidebar Lead Open/Close requests only review data and price fields, and preserves rows on a failed refresh', async () => {
  const source = page('PendingLeads');
  const code = source.slice(source.indexOf('  async function load('), source.indexOf('  useEffect(() => { load(); }'));
  const calls = [];
  let assignedRows, error;
  const context = {
    API_ENDPOINTS: { auth: { me: 'me' }, leads: { list: 'leads' }, quotations: { list: 'quotes' } },
    api: { get(url, config) { calls.push({ url, config }); return url === 'leads'
      ? Promise.reject(new Error('timeout')) : Promise.resolve({ data: { user: {}, quotations: [] } }); } },
    setLoading() {}, setCurrentUser() {}, setQuotations() {}, setLeads: rows => { assignedRows = rows; }, setError: message => { error = message; }
  };
  vm.createContext(context); vm.runInContext(code, context);
  await context.load({ silent: true });
  assert.equal(calls.find(row => row.url === 'leads').config.params.view, 'review');
  assert.equal(calls.find(row => row.url === 'quotes').config.params.view, 'lead-review');
  assert.equal(assignedRows, undefined);
  assert.ok(error.includes('Unable to refresh'));
});
