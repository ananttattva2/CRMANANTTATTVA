const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { presenceValue } = require('../src/services/misClientProjection');
const { analyzeClientMasterData } = require('../src/services/userProductivityReport');

test('complete MIS aggregate command stays below Atlas BSON nesting limit', () => {
  const { misClientProjection } = require('../src/services/misClientProjection');
  const depth = value => value && typeof value === 'object' ? 1 + Math.max(0, ...Object.values(value).map(depth)) : 0;
  const command = { aggregate: 'clients', pipeline: [{ $match: {} }, { $project: misClientProjection }], cursor: {} };
  assert.ok(depth(command) < 50, `Command nesting is ${depth(command)}`);
});

test('Atlas projection rejection falls back to the same scoped records rather than empty MIS counts', async () => {
  const { readMisClients } = require('../src/services/misClientProjection');
  const scope = { createdBy: { $in: ['manager-member'] } }, records = [{ _id: 'one', workflowStatus: 'draft' }];
  const Client = {
    aggregate(stages) { assert.equal(stages[0].$match, scope); return { option: async () => { throw Object.assign(new Error('Atlas restriction'), { code: 8000 }); } }; },
    find(filter) { assert.equal(filter, scope); return { select() { return this; }, maxTimeMS() { return this; }, lean: async () => records }; }
  };
  assert.equal(await readMisClients(Client, scope), records);
});

// Evaluate the small Mongo expression subset used here against concrete fixtures.
// Production uses these expressions in MongoDB before transferring documents.
function evaluate(expression, document, variables = {}) {
  const valueAt = (object, parts) => parts.reduce((value, key) => value?.[key], object);
  if (typeof expression === 'string' && expression.startsWith('$$')) return valueAt(variables, expression.slice(2).split('.'));
  if (typeof expression === 'string' && expression.startsWith('$')) return valueAt(document, expression.slice(1).split('.'));
  if (!expression || typeof expression !== 'object' || Object.prototype.toString.call(expression) === '[object Date]') return expression;
  const ev = value => evaluate(value, document, variables);
  if (Array.isArray(expression)) return expression.map(ev);
  const [operator, argument] = Object.entries(expression)[0] || [];
  if (!operator?.startsWith('$')) return Object.fromEntries(Object.entries(expression).map(([key, value]) => [key, ev(value)]));
  switch (operator) {
    case '$let': return evaluate(argument.in, document, { ...variables, ...Object.fromEntries(Object.entries(argument.vars).map(([key, value]) => [key, ev(value)])) });
    case '$switch': { const branch = argument.branches.find(row => ev(row.case)); return ev(branch ? branch.then : argument.default); }
    case '$cond': return ev(ev(argument[0]) ? argument[1] : argument[2]);
    case '$map': return ev(argument.input).map(entry => evaluate(argument.in, document, { ...variables, [argument.as]: entry }));
    case '$type': { const value = ev(argument); return typeof value === 'string' ? 'string' : value instanceof Date ? 'date' : Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value; }
    case '$isArray': return Array.isArray(ev(argument));
    case '$objectToArray': return Object.entries(ev(argument)).map(([k, v]) => ({ k, v }));
    case '$arrayToObject': return Object.fromEntries(ev(argument).map(({ k, v }) => [k, v]));
    case '$strLenBytes': return Buffer.byteLength(ev(argument));
    case '$trim': return ev(argument.input).trim();
    case '$eq': return ev(argument[0]) === ev(argument[1]);
    case '$ne': return ev(argument[0]) !== ev(argument[1]);
    case '$gt': return ev(argument[0]) > ev(argument[1]);
    case '$ifNull': { const [left, right] = argument; return ev(left) ?? ev(right); }
    case '$max': return ev(argument).reduce((left, right) => left > right ? left : right);
    case '$min': return Math.min(...ev(argument));
    case '$floor': return Math.floor(ev(argument));
    case '$add': return ev(argument).reduce((sum, value) => sum + value, 0);
    case '$subtract': return ev(argument[0]) - ev(argument[1]);
    case '$divide': return ev(argument[0]) / ev(argument[1]);
    case '$concatArrays': return ev(argument).flat();
    case '$slice': return ev(argument[0]).slice(ev(argument[1]));
    default: throw new Error(`Unsupported test operator ${operator}`);
  }
}

test('MIS projection drops multi-megabyte embedded bytes while preserving completion counts and nested types', () => {
  const data = { basic: { clientLegalName: 'Example', piboCategory: 'Importer', companyType: 'Private Limited' },
    compliance: { gstFile: `data:application/pdf;base64,${'a'.repeat(3_000_000)}`, panFile: { url: `data:image/png;base64,${'b'.repeat(2_000_000)}` } },
    cpcbScreenshots: [{ file: 'c'.repeat(2_000_000) }], companyOverview: { productImage: '', companySummary: ' '.repeat(5000) },
    msmeRows: [{ file: 'd'.repeat(500_000), turnover: 42 }], values: [false, 0, null, '', new Date('2026-10-13')] };
  const compact = evaluate(presenceValue('$data'), { data });
  assert.deepEqual(analyzeClientMasterData(compact), analyzeClientMasterData(data));
  assert.ok(JSON.stringify(compact).length < 2000);
  assert.equal(compact.msmeRows[0].turnover, 42);
  assert.equal(compact.values[0], false); assert.equal(compact.values[1], 0); assert.equal(compact.values[2], null);
  assert.equal(compact.values[4].getTime(), data.values[4].getTime());
  assert.equal(data.compliance.gstFile.length > 3_000_000, true);
});

test('concurrent heartbeat requests update current session atomically without double-counting or versioned saves', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/controllers/authController.js'), 'utf8');
  const start = source.indexOf('exports.activityHeartbeat =');
  const end = source.indexOf('\nexports.superAdminOverview', start);
  let session = { activeSeconds: 0, lastHeartbeatAt: new Date(Date.now() - 20000), lastActivityAt: new Date(Date.now() - 20000), presenceState: 'active', presenceTimeline: [] };
  const filters = [], context = { exports: {}, console,
    UserSession: { findOneAndUpdate(filter, pipeline) { filters.push(filter);
      const before = session;
      const changes = Object.fromEntries(Object.entries(pipeline[0].$set).map(([key, expression]) => [key, evaluate(expression, before)]));
      session = { ...before, ...changes };
      return { lean: async () => ({ activeSeconds: session.activeSeconds, presenceState: session.presenceState }) };
    } }
  };
  vm.createContext(context); vm.runInContext(source.slice(start, end), context);
  const request = state => ({ authSessionId: 'session-one', user: { _id: 'user-one' }, body: { state } });
  const results = [], response = { json: body => results.push(body) };
  await Promise.all([context.exports.activityHeartbeat(request('active'), response), context.exports.activityHeartbeat(request('active'), response)]);
  assert.equal(session.activeSeconds, 20);
  assert.ok(results.every(row => row.ok && row.tracking !== false));
  await context.exports.activityHeartbeat(request('away'), response);
  assert.equal(session.presenceTimeline.length, 1); assert.equal(session.presenceTimeline[0].state, 'away');
  assert.equal(session.activeSeconds, 20);
  assert.ok(filters.every(filter => filter.sessionId === 'session-one' && filter.userId === 'user-one' && filter.logoutAt === null));
});

test('PO approval list defers proof enrichment, preserves amounts/status, and detail returns original proof', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/controllers/leadController.js'), 'utf8');
  const start = source.indexOf('exports.listDuplicateLeadApprovals =');
  const end = source.indexOf('\nexports.', start + 1);
  const original = { _id: '64b000000000000000000001', type: 'purchase_order', approvalStatus: 'PENDING',
    clientName: 'Example', payload: { leadId: '64b000000000000000000002', poYearRows: [{ poNumber: 'PO-42', poAmount: 42000, poFileUrl: `data:application/pdf;base64,${'a'.repeat(2_000_000)}` }] } };
  const projections = [];
  const context = { exports: {}, require: name => require(name.replace('../services/', '../src/services/')), userHasAnyRole: () => true, ADMIN_ROLES: ['admin'],
    Lead: { collection: { collectionName: 'leads' }, find() { assert.fail('List must not fetch every related lead/proof'); } },
    mongoose: { isValidObjectId: () => true },
    PendingApproval: { collection: { collectionName: 'pendingapprovals' },
      find(filter) { let selected = ''; return { select(value) { selected = value; projections.push(value); return this; }, populate() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => {
        if (!filter.approvalStatus.$in.includes('PENDING')) return [];
        assert.ok(selected.includes('-payload.poYearRows.poFileUrl'));
        return [{ ...original, payload: { ...original.payload, poYearRows: [{ poNumber: 'PO-42', poAmount: 42000 }] } }];
      } }; },
      findOne(filter) { assert.equal(filter.type, 'purchase_order'); return { lean: async () => original }; }
    }
  };
  vm.createContext(context); vm.runInContext(source.slice(start, end), context);
  let body;
  await context.exports.listDuplicateLeadApprovals({ query: { listOnly: 'true' }, user: { role: 'admin' } }, { json: value => { body = value; } });
  assert.equal(body.approvals[0].detailsDeferred, true);
  assert.equal(body.approvals[0].approvalStatus, 'PENDING');
  assert.equal(body.approvals[0].payload.poYearRows[0].poAmount, 42000);
  assert.ok(JSON.stringify(body).length < 2000);
  const detailStart = source.indexOf('exports.getPurchaseOrderApproval =');
  vm.runInContext(source.slice(detailStart), context);
  await context.exports.getPurchaseOrderApproval({ params: { id: original._id } }, { json: value => { body = value; }, status() { return this; } });
  assert.equal(body.approval.payload.poYearRows[0].poFileUrl, original.payload.poYearRows[0].poFileUrl);
});

test('annual-return dashboard keeps every filing and its PO data without repeating the entire filing tree', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/controllers/annualReturnController.js'), 'utf8');
  const client = { _id: 'client-one', updatedAt: new Date('2026-10-13'), data: { basic: { clientLegalName: 'Example' },
    annualReturn: { filings: { '2025-26': { status: 'submitted', financials: { compliancePoNo: 'PO-1' } }, '2026-27': { status: 'draft' } } } } };
  let clientReads = 0, body;
  const selections = [];
  const query = rows => ({ select(value) { selections.push(value); return this; }, populate() { return this; }, sort() { return this; }, lean: async () => rows });
  const context = { exports: {}, require(name) {
    if (name.endsWith('/AnnualReturn')) return { find: () => query([]) };
    if (name.endsWith('/Client')) return { find: () => query(++clientReads === 1 ? [client] : [client]) };
    if (name.endsWith('/visibilityScope')) return { getVisibleUserScope: async () => null, ownerFilter: () => ({}) };
    if (name.endsWith('/dashboardTestLeadExclusion')) return { getAdminCreatedLeadReferences: async () => [], dashboardClientExclusionFilter: () => ({}) };
    throw new Error(name);
  } };
  vm.createContext(context); vm.runInContext(source, context);
  await context.exports.listAnnualReturns({ query: { dashboard: 'true' }, user: {} }, { json: value => { body = value; } });
  assert.equal(body.annualReturns.length, 2);
  const filed = body.annualReturns.find(row => row.annualYear === '2025-26');
  assert.equal(filed.status, 'submitted'); assert.equal(filed.financials.compliancePoNo, 'PO-1');
  assert.equal(filed.clientData.annualReturn, undefined);
  assert.equal(Object.keys(client.data.annualReturn.filings).length, 2);
  assert.ok(selections.includes('data.basic data.importMeta data.selectedLeadSnapshot data.financials adminControls data.annualReturn.filings data.annualReturn.lastSavedAt updatedAt'));
});
