const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createCrmCache } = require('../src/services/crmCache');

function fixture() {
  let now = 0;
  let version = 'v1';
  let reads = 0;
  let count = 10;
  const entries = new Map();
  const revisions = { read: async () => version, bump: async () => (version = `v${Number(version.slice(1)) + 1}`) };
  const store = {
    async get(key) { const entry = entries.get(key); return entry?.until > now ? entry.value : null; },
    async set(key, value, ttl) { entries.set(key, { value, until: now + ttl * 1000 }); },
    async disable() { entries.clear(); }
  };
  const cache = createCrmCache({ store, revisions });
  const req = (user = 'alice', query = {}) => ({
    method: 'GET', originalUrl: '/api/leads', query, user: { _id: user, role: 'admin' }, get: () => ''
  });
  const response = () => ({ statusCode: 200, headers: {}, set(key, value) { this.headers[key] = value; }, json(body) { this.body = body; return this; } });
  async function read(request = req(), middleware = cache.middleware) {
    const res = response();
    await middleware(request, res, async () => { reads++; await res.json({ count }); });
    return res;
  }
  return { cache, store, revisions, entries, req, response, read,
    setCount: value => { count = value; }, reads: () => reads, advance: ms => { now += ms; } };
}

test('10 to 11 immediately after a write, before the 60-second TTL expires, across workers', async () => {
  const f = fixture();
  assert.equal((await f.read()).body.count, 10);
  assert.equal((await f.read()).headers['X-CRM-Cache'], 'HIT');
  f.advance(1000);
  f.setCount(11);
  await f.cache.invalidate();
  const secondWorker = createCrmCache({ store: f.store, revisions: f.revisions });
  assert.equal((await f.read(f.req(), secondWorker.middleware)).body.count, 11);
  assert.equal(f.reads(), 2);
  assert.equal((await f.read()).headers['X-CRM-Cache'], 'HIT');
});

test('user, role, team, filters and pagination have separate entries; query order and cache busters do not', async () => {
  const f = fixture();
  await f.read(f.req('alice', { status: 'open', page: 1 }));
  assert.equal((await f.read(f.req('alice', { page: 1, status: 'open', _: 'timestamp' }))).headers['X-CRM-Cache'], 'HIT');
  for (const request of [f.req('bob', { status: 'open', page: 1 }), f.req('alice', { status: 'closed', page: 1 }), f.req('alice', { status: 'open', page: 2 })]) {
    assert.equal((await f.read(request)).headers['X-CRM-Cache'], 'MISS');
  }
  const changedRole = f.req('alice', { status: 'open', page: 1 });
  changedRole.user.role = 'sales';
  assert.equal((await f.read(changedRole)).headers['X-CRM-Cache'], 'MISS');
  changedRole.user.team = 'new-team';
  assert.equal((await f.read(changedRole)).headers['X-CRM-Cache'], 'MISS');
});

test('actual MongoDB user and team ObjectIds remain distinct in response cache keys', async () => {
  const f = fixture();
  const { ObjectId } = require('mongoose').Types;
  const request = f.req();
  request.user = { _id: new ObjectId('64b000000000000000000001'), role: 'manager' };
  await f.read(request);
  f.setCount(11);
  const other = f.req();
  other.user = { _id: new ObjectId('64b000000000000000000002'), role: 'manager' };
  const result = await f.read(other);
  assert.equal(result.headers['X-CRM-Cache'], 'MISS');
  assert.equal(result.body.count, 11);
  const originalKey = f.cache.keyFor(request, 'same-revision');
  request.user.teamId = new ObjectId('64b000000000000000000003');
  const teamKey = f.cache.keyFor(request, 'same-revision');
  assert.notEqual(teamKey, originalKey);
  request.user.teamId = new ObjectId('64b000000000000000000004');
  assert.notEqual(f.cache.keyFor(request, 'same-revision'), teamKey);
});

test('read overlapping a write cannot repopulate a stale generation', async () => {
  const f = fixture();
  const oldResponse = f.response();
  await f.cache.middleware(f.req(), oldResponse, () => {});
  await f.cache.invalidate();
  await oldResponse.json({ count: 10 });
  assert.equal(f.entries.size, 0);
  f.setCount(11);
  assert.equal((await f.read()).body.count, 11);
});

test('invalidation between Redis lookup and hit delivery discards the hit', async () => {
  const f = fixture();
  await f.read();
  const get = f.store.get;
  f.store.get = async key => { const result = await get(key); await f.cache.invalidate(); f.setCount(11); return result; };
  assert.equal((await f.read()).body.count, 11);
});

test('TTL expiry, explicit fresh request and Redis failure fall back to Mongo controller', async () => {
  const f = fixture();
  await f.read();
  f.advance(60001); f.setCount(11);
  assert.equal((await f.read()).body.count, 11);
  const fresh = f.req(); fresh.get = () => 'no-cache'; f.setCount(12);
  assert.equal((await f.read(fresh)).body.count, 12);
  f.store.get = async () => { throw new Error('offline'); };
  f.store.set = async () => { throw new Error('offline'); };
  f.setCount(13);
  assert.equal((await f.read()).body.count, 13);
});

test('unavailable revision, failed responses, errors and oversized payloads are never cached', async () => {
  const f = fixture();
  const cache = createCrmCache({ store: f.store, revisions: f.revisions, maxBytes: 20 });
  for (const [status, body] of [[403, { error: 'Denied' }], [500, { error: 'database' }], [200, { success: false }], [200, { error: 'partial failure' }], [200, { large: 'x'.repeat(100) }]]) {
    const res = f.response();
    await cache.middleware(f.req(), res, async () => { res.statusCode = status; await res.json(body); });
  }
  assert.equal(f.entries.size, 0);
  f.revisions.read = async () => { throw new Error('MongoDB unavailable'); };
  assert.equal((await f.read()).headers['X-CRM-Cache'], 'BYPASS');
  f.revisions.bump = async () => { throw new Error('revision write failed'); };
  assert.equal(await f.cache.invalidate(), null);
});

test('warm HTTP cache never skips authentication or roles, and serializes dates identically', async t => {
  const f = fixture();
  const app = express();
  let authCalls = 0;
  app.get('/api/leads', (req, res, next) => {
    authCalls++;
    if (req.get('authorization') !== 'Bearer admin') return res.status(401).json({ error: 'Unauthorized' });
    req.user = { _id: 'admin', role: 'admin' }; next();
  }, f.cache.middleware, (req, res) => res.json({ count: 10, date: new Date('2026-01-01T00:00:00Z') }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/leads`;
  const first = await fetch(url, { headers: { authorization: 'Bearer admin' } });
  const firstBody = await first.json();
  const second = await fetch(url, { headers: { authorization: 'Bearer admin' } });
  assert.equal(second.headers.get('x-crm-cache'), 'HIT');
  assert.equal(second.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await second.json(), firstBody);
  assert.equal((await fetch(url)).status, 401);
  assert.equal(authCalls, 3);
});

test('shared read models coalesce loads, preserve BSON ids/dates/numbers and expire with the revision', async () => {
  const f = fixture();
  const { ObjectId } = require('bson');
  let loads = 0;
  const load = async () => { loads++; return { _id: new ObjectId('64b000000000000000000001'), at: new Date('2026-10-13'), count: 11 }; };
  await Promise.all([f.cache.remember('scope-a', load), f.cache.remember('scope-a', load)]);
  assert.equal(loads, 1);
  const cached = await f.cache.remember('scope-a', load);
  assert.equal(loads, 1);
  assert.equal(cached._id.toHexString(), '64b000000000000000000001');
  assert.ok(cached.at instanceof Date);
  assert.equal(cached.count, 11);
  await f.cache.remember('scope-b', load);
  assert.equal(loads, 2);
  await f.cache.invalidate();
  await f.cache.remember('scope-a', load);
  assert.equal(loads, 3);
  f.advance(60001);
  await f.cache.remember('scope-a', load);
  assert.equal(loads, 4);
});

test('a post-write read model cannot join or be overwritten by an old in-flight read', async () => {
  const f = fixture();
  let finish;
  const old = f.cache.remember('assignments', () => new Promise(resolve => { finish = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  await f.cache.invalidate();
  assert.deepEqual(await f.cache.remember('assignments', async () => ({ count: 11 })), { count: 11 });
  finish({ count: 10 });
  await old;
  assert.deepEqual(await f.cache.remember('assignments', () => assert.fail('fresh result must be cached')), { count: 11 });
});

test('read model failures can be retried and Redis outages never hide loader results', async () => {
  const f = fixture();
  await assert.rejects(f.cache.remember('records', async () => { throw new Error('query failed'); }));
  f.store.get = f.store.set = async () => { throw new Error('Redis unavailable'); };
  assert.deepEqual(await f.cache.remember('records', async () => ({ count: 11 })), { count: 11 });
});

test('failed invalidation also bypasses old in-flight snapshots in the affected worker', async () => {
  const f = fixture();
  let finish;
  const old = f.cache.remember('same', () => new Promise(resolve => { finish = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  f.revisions.bump = async () => { throw new Error('revision write failed'); };
  await f.cache.invalidate();
  assert.deepEqual(await f.cache.remember('same', async () => ({ count: 11 })), { count: 11 });
  finish({ count: 10 }); await old;
  assert.equal(f.entries.size, 0);
});
