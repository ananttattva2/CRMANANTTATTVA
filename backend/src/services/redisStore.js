const { createClient } = require('redis');
const namespace = String(process.env.REDIS_CACHE_PREFIX || 'crm:production:v1').trim();
const cacheEnabled = () => Boolean(process.env.REDIS_URL) && process.env.REDIS_CACHE_ENABLED !== 'false';
let client;
let retryAfter = 0;
let ready = false;
let permanentlyDisabled = false;
let lastErrorLog = 0;
const timeoutMs = Math.max(50, Math.min(2000, Number(process.env.REDIS_CACHE_TIMEOUT_MS) || 200));

function getClient() {
  if (!cacheEnabled() || permanentlyDisabled) return null;
  if (!client) {
    client = createClient({
      url: process.env.REDIS_URL,
      disableOfflineQueue: true,
      commandsQueueMaxLength: 100,
      socket: { connectTimeout: 1500, reconnectStrategy: retries => Math.min(1000 * (retries + 1), 10000) }
    });
    client.on('error', () => {
      ready = false;
      if (Date.now() - lastErrorLog > 60000) {
        lastErrorLog = Date.now();
        console.warn('[crm-cache] Redis unavailable; using MongoDB. Check Redis connectivity.');
      }
    });
    client.on('ready', () => { ready = true; });
    client.on('reconnecting', () => { ready = false; });
    client.connect().catch(() => {});
  }
  return ready && client.isReady && Date.now() >= retryAfter ? client : null;
}
async function command(run) {
  const connection = getClient();
  if (!connection) return null;
  let timer;
  try {
    return await Promise.race([
      run(connection),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Cache timeout')), timeoutMs); })
    ]);
  } catch {
    retryAfter = Date.now() + 5000;
    return null;
  } finally { clearTimeout(timer); }
}
const redisStore = {
  get: key => command(connection => connection.get(key)),
  set: (key, value, ttl) => command(connection => connection.set(key, value, { EX: ttl })),
  async disable() {
    // Fail closed after an unsuccessful revision write: restart the backend
    // after MongoDB recovers. No worker may trust its old Redis entries.
    permanentlyDisabled = true;
    ready = false;
    if (client?.isOpen) client.destroy();
  }
};
function cacheStatus() {
  return { enabled: cacheEnabled(), state: permanentlyDisabled ? 'disabled-after-invalidation-error'
    : !cacheEnabled() ? 'disabled' : ready && client?.isReady ? 'connected' : 'unavailable',
  ttlSeconds: Math.max(1, Math.min(300, Number(process.env.REDIS_CACHE_TTL_SECONDS) || 60)) };
}
module.exports = { redisStore, cacheEnabled, namespace, cacheStatus, getClient };
