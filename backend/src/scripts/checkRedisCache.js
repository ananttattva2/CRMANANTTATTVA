require('dotenv').config({ quiet: true });
const { randomUUID } = require('node:crypto');
const { store, enabled, namespace, startConnection } = require('../services/redisConnection');

async function main() {
  if (!enabled()) throw new Error('Set REDIS_CACHE_ENABLED=true and REDIS_URL first.');
  await startConnection();
  const version = await store.version();
  if (!version) throw new Error('Redis is unavailable. Check trusted sources, URL and CA configuration.');
  const key = `${namespace}:connection-check:${randomUUID()}`;
  await store.putIfCurrent(version, key, 'ok', 5000);
  if (await store.get(key) !== 'ok') throw new Error('Cache read/write check failed.');
  console.info('Redis TLS/connection and expiring cache read/write check passed.');
}
main().then(() => process.exit(0)).catch(error => {
  // No raw connection/client errors or credentials in diagnostic output.
  console.error(error.message.startsWith('Set ') ? error.message : 'Redis check failed; verify connectivity, trusted sources and TLS CA.');
  process.exit(1);
});
