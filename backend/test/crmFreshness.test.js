const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('browser writes refresh immediately; one shared poll refreshes other users before TTL; unmount cleans listeners', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/services/crmFreshness.js'), 'utf8').replace(/export /g, '');
  const windowListeners = new Map();
  const documentListeners = new Map();
  let timer;
  let timers = 0;
  let polls = 0;
  let revision = 'before';
  let a = 0, b = 0, broadcasts = 0;
  const window = {
    setInterval(fn, ms) { assert.equal(ms, 5000); timers++; timer = fn; return 1; },
    clearInterval() { timers--; },
    addEventListener: (name, fn) => windowListeners.set(name, fn),
    removeEventListener: name => windowListeners.delete(name)
  };
  const document = { visibilityState: 'visible', addEventListener: (name, fn) => documentListeners.set(name, fn), removeEventListener: name => documentListeners.delete(name) };
  const context = vm.createContext({ window, document, localStorage: { setItem: () => { broadcasts++; } }, Date, Math });
  vm.runInContext(source, context);
  const fetchRevision = async () => { polls++; return { data: { revision } }; };
  const stopA = context.subscribeCrmChanges(() => { a++; }, fetchRevision);
  const stopB = context.subscribeCrmChanges(() => { b++; }, fetchRevision);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(timers, 1);
  assert.equal(polls, 1);
  context.notifyCrmChanged();
  assert.equal(context.getCrmGeneration(), 1);
  assert.equal(a, 1); assert.equal(b, 1); assert.equal(broadcasts, 1);
  revision = 'after-write';
  await timer();
  assert.equal(a, 2); assert.equal(b, 2); assert.equal(broadcasts, 1);
  document.visibilityState = 'hidden';
  await timer();
  assert.equal(polls, 2);
  document.visibilityState = 'visible';
  windowListeners.get('storage')({ key: 'crm:data:changed' });
  assert.equal(a, 3); assert.equal(b, 3);
  stopA(); assert.equal(timers, 1);
  stopB(); assert.equal(timers, 0);
  assert.equal(windowListeners.size, 0); assert.equal(documentListeners.size, 0);
});

test('a slow GET from before a write is retried before it reaches page state', async () => {
  let generation = 0;
  let beforeRequest, afterResponse;
  let retryConfig;
  const client = {
    interceptors: {
      request: { use: fn => { beforeRequest = fn; } },
      response: { use: fn => { afterResponse = fn; } }
    },
    request: async config => { retryConfig = beforeRequest(config); return { fresh: true }; }
  };
  let source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/services/api.js'), 'utf8');
  source = source.replace(/^import .*$/gm, '').replace(/import\.meta\.env/g, '({ DEV: false })')
    .replace(/export default api/g, '').replace(/export \{[^}]*\}/g, '').replace(/export /g, '');
  const context = vm.createContext({ axios: { create: () => client }, API_ENDPOINTS: { auth: {} },
    getCrmGeneration: () => generation, notifyCrmChanged: () => { generation++; },
    localStorage: { getItem: () => '' }, window: { setTimeout: fn => fn() }, fetch: () => Promise.resolve(), console });
  vm.runInContext(source, context);
  const config = beforeRequest({ method: 'get', url: '/leads', headers: {} });
  generation++;
  const result = await afterResponse({ config, data: { count: 10 } });
  assert.equal(result.fresh, true);
  assert.equal(retryConfig._crmReadGeneration, 1);
  assert.equal(retryConfig._crmFreshnessRetries, 1);
  await afterResponse({ config: { method: 'post', url: '/auth/milestones/ticket-100/claim' }, data: { claimed: false } });
  assert.equal(generation, 1);
  const currentResponse = { config: retryConfig, data: { count: 11 } };
  assert.equal(await afterResponse(currentResponse), currentResponse);
  const revisionResponse = { config: { method: 'get', url: '/cache/revision' }, data: {} };
  assert.equal(await afterResponse(revisionResponse), revisionResponse);
});
