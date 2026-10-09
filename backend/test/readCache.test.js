const test = require('node:test');
const assert = require('node:assert/strict');
const { createReadCacheSystem } = require('../src/services/readCache');
const { createInvalidationMiddleware, affectsReadCache } = require('../src/middleware/readCacheInvalidation');

function fakeStore() {
  let revision = 0, clock = 0;
  const entries = new Map();
  return {
    entries,
    version: async () => String(revision),
    get: async key => { const entry = entries.get(key); return entry && entry.expiry > clock ? entry.value : null; },
    putIfCurrent: async (version, key, value, ttl) => {
      if (version === String(revision)) entries.set(key, { value, expiry: clock + ttl });
    },
    invalidate: async () => { revision += 1; },
    advance: value => { clock += value; }
  };
}

test('disabled Redis retains bounded memory cache, expiration and request coalescing', async () => {
  let clock = 0, calls = 0;
  const system = createReadCacheSystem({ enabled: () => false });
  const read = system.createCache({ name: 'test', ttl: 10, maxEntries: 2, now: () => clock });
  assert.deepEqual(await Promise.all([read('a', async () => ++calls), read('a', async () => ++calls)]), [1, 1]);
  clock = 11;
  assert.equal(await read('a', async () => ++calls), 2);
  await system.invalidate();
  assert.equal(await read('a', async () => ++calls), 3);
});

test('Redis cache shares between workers, isolates scopes and namespaces, and expires', async () => {
  const store = fakeStore();
  const first = createReadCacheSystem({ store, enabled: () => true });
  const second = createReadCacheSystem({ store, enabled: () => true });
  const a = first.createCache({ name: 'report', ttl: 10 });
  const b = second.createCache({ name: 'report', ttl: 10 });
  const other = second.createCache({ name: 'different-report' });
  const loader = async () => ({ count: 5 });
  const shouldNotLoad = async () => assert.fail('expected Redis hit');
  await a('admin:2026-10', loader);
  assert.deepEqual(await b('admin:2026-10', shouldNotLoad), { count: 5 });
  assert.deepEqual(await b('manager:2026-10', async () => ({ count: 1 })), { count: 1 });
  assert.equal(await other('admin:2026-10', async () => 'different'), 'different');
  store.advance(11);
  assert.deepEqual(await b('admin:2026-10', async () => ({ count: 6 })), { count: 6 });
});

test('cross-worker edits prevent an earlier in-flight read repopulating stale results', async () => {
  const store = fakeStore();
  const first = createReadCacheSystem({ store, enabled: () => true });
  const second = createReadCacheSystem({ store, enabled: () => true });
  const a = first.createCache({ name: 'report' });
  const b = second.createCache({ name: 'report' });
  let finish, started;
  const loading = new Promise(resolve => { started = resolve; });
  const oldRead = a('owner', () => { started(); return new Promise(resolve => { finish = resolve; }); });
  await loading;
  await second.invalidate();
  assert.equal(await b('owner', async () => 'edited'), 'edited');
  finish('old');
  assert.equal(await oldRead, 'old');
  assert.equal(await a('owner', async () => assert.fail('stale entry replaced edited data')), 'edited');
});

test('Redis failures and corrupt JSON fall back to database, loader failures remain retryable', async () => {
  const store = fakeStore();
  store.get = async () => 'corrupt JSON';
  store.putIfCurrent = async () => { throw new Error('offline'); };
  const system = createReadCacheSystem({ store, enabled: () => true });
  const read = system.createCache({ name: 'report' });
  assert.equal(await read('owner', async () => 'fresh'), 'fresh');
  store.version = async () => { throw new Error('offline'); };
  await assert.rejects(read('owner', async () => { throw new Error('MongoDB failure'); }), /MongoDB failure/);
  assert.equal(await read('owner', async () => 'recovered'), 'recovered');
  assert.equal(await read('owner', async () => 'newer'), 'newer');
  await system.invalidate();
});

test('concurrent Redis misses share one database load and oversized payloads are not stored', async () => {
  const store = fakeStore();
  const system = createReadCacheSystem({ store, enabled: () => true });
  const read = system.createCache({ name: 'report' });
  let calls = 0;
  const results = await Promise.all(Array.from({ length: 10 }, () => read('owner', async () => ++calls)));
  assert.deepEqual(results, Array(10).fill(1));
  assert.equal(calls, 1);
  const large = 'x'.repeat(2 * 1024 * 1024);
  await read('large', async () => large);
  assert.equal(store.entries.size, 1);
});

test('successful edits acknowledge only after invalidation; failed edits and heartbeat skip it', async () => {
  let finish, complete;
  const invalidation = new Promise(resolve => { finish = resolve; });
  const sent = new Promise(resolve => { complete = resolve; });
  const middleware = createInvalidationMiddleware(() => invalidation);
  const res = { statusCode: 200, json(body) { complete(body); return this; } };
  middleware({ method: 'PATCH', originalUrl: '/api/quotations/123/approval' }, res, () => {});
  assert.equal(res.json({ ok: true }), res);
  let delivered = false;
  sent.then(() => { delivered = true; });
  await Promise.resolve();
  assert.equal(delivered, false);
  finish();
  assert.deepEqual(await sent, { ok: true });
  for (const route of ['/api/auth/activity-heartbeat', '/api/auth/milestones/test/claim', '/api/notifications/123/read']) {
    assert.equal(affectsReadCache({ method: 'POST', originalUrl: route }), false);
  }
  assert.equal(affectsReadCache({ method: 'PUT', originalUrl: '/api/auth/admin/users/123' }), true);
  let invalidations = 0;
  const failed = { statusCode: 403, json() {} };
  createInvalidationMiddleware(() => { invalidations += 1; })({ method: 'PATCH', originalUrl: '/api/leads/123' }, failed, () => {});
  failed.json({ error: 'forbidden' });
  await Promise.resolve();
  assert.equal(invalidations, 0);
});
