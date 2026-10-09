const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function connectionModule(env, target, timers = setTimeout) {
  let options;
  const messages = [];
  const context = {
    module: { exports: {} }, process: { env }, Date,
    setTimeout: timers, clearTimeout,
    console: { info: value => messages.push(value), warn: value => messages.push(value) },
    require(name) {
      if (name === 'redis') return { createClient(value) { options = value; return target; } };
      if (name === 'node:fs') return { readFileSync: () => Buffer.from('test CA') };
      return require(name);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/redisConnection.js'), 'utf8'), context);
  return { api: context.module.exports, options: () => options, messages };
}

test('connection is opt-in and never loads a client with missing configuration', async () => {
  for (const env of [{}, { REDIS_URL: 'redis://localhost:6379' }, { REDIS_CACHE_ENABLED: 'true' }]) {
    const loaded = connectionModule(env, null);
    await loaded.api.startConnection();
    assert.equal(loaded.options(), undefined);
    assert.equal(loaded.api.enabled(), false);
  }
});

test('managed TLS connection verifies CA, disables offline queue and rotates shared cache version', async () => {
  const writes = [];
  const target = {
    isOpen: false, isReady: false,
    on() {}, async connect() { this.isOpen = true; this.isReady = true; },
    async set(...args) { writes.push(args); }, async get() { return writes[0][1]; }
  };
  const loaded = connectionModule({ REDIS_CACHE_ENABLED: 'true', REDIS_URL: 'rediss://user:secret@example.test:25061', REDIS_CA_PATH: '/test/ca.crt' }, target);
  await loaded.api.startConnection();
  assert.equal(loaded.options().socket.tls, true);
  assert.equal(loaded.options().socket.ca.toString(), 'test CA');
  assert.equal(loaded.options().socket.rejectUnauthorized, undefined);
  assert.equal(loaded.options().disableOfflineQueue, true);
  assert.equal(loaded.options().socket.reconnectStrategy, false);
  assert.ok(await loaded.api.store.version());
  await loaded.api.store.invalidate();
  assert.notEqual(writes[0][1], writes.at(-1)[1]);
  assert.ok(!JSON.stringify(loaded.messages).includes('secret'));
});

test('stalled handshake is destroyed at the deadline and database fallback remains available', async () => {
  const target = {
    isOpen: true, isReady: false, destroyed: false, on() {},
    connect: () => new Promise(() => {}),
    destroy() { this.destroyed = true; this.isOpen = false; }
  };
  const loaded = connectionModule({ REDIS_CACHE_ENABLED: 'true', REDIS_URL: 'redis://localhost:6379' }, target, callback => setTimeout(callback, 5));
  await loaded.api.startConnection();
  assert.equal(target.destroyed, true);
  assert.equal(loaded.api.cacheConnectionStatus().ready, false);
  assert.equal(await loaded.api.store.version(), null);
  assert.equal(loaded.messages.length, 1);
});
