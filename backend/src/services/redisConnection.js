const fs = require('node:fs');
const { randomUUID } = require('node:crypto');

const namespace = process.env.REDIS_CACHE_PREFIX || 'crm:read-cache:v1';
const versionKey = `${namespace}:version`;
const timeoutMs = 750;
let client, connecting, retryAt = 0;
const stats = { errors: 0 };

function enabled() {
  return process.env.REDIS_CACHE_ENABLED === 'true' && Boolean(process.env.REDIS_URL);
}

function disconnect(target) {
  if (target?.isOpen) target.destroy();
  if (client === target) client = undefined;
  retryAt = Date.now() + 10000;
}

async function command(target, run, deadlineMs = timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(run),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          disconnect(target);
          reject(new Error('Cache command timed out'));
        }, deadlineMs);
      })
    ]);
  } catch (error) {
    stats.errors += 1;
    disconnect(target);
    throw error;
  } finally { clearTimeout(timer); }
}

function startConnection() {
  if (!enabled() || connecting || client?.isReady || Date.now() < retryAt) return;
  connecting = (async () => {
    let target;
    try {
      const { createClient } = require('redis');
      const socket = { connectTimeout: 1500, reconnectStrategy: false };
      if (process.env.REDIS_URL.startsWith('rediss://')) {
        socket.tls = true;
        if (process.env.REDIS_CA_PATH) socket.ca = fs.readFileSync(process.env.REDIS_CA_PATH);
      } else if (process.env.REDIS_CA_PATH) {
        throw new Error('TLS URL required when a CA is configured');
      }
      target = createClient({ url: process.env.REDIS_URL, socket, disableOfflineQueue: true });
      // Never log connection strings, credentials or raw Redis errors.
      target.on('error', () => { stats.errors += 1; });
      await command(target, () => target.connect(), 2000);
      // Startup/recovery discards possibly stale entries after an outage.
      await command(target, () => target.set(versionKey, randomUUID()));
      client = target;
      console.info('[cache] Redis connected');
    } catch {
      disconnect(target);
      console.warn('[cache] Redis unavailable; database fallback active');
    }
  })().finally(() => { connecting = undefined; });
  return connecting;
}

function readyClient() {
  startConnection();
  return enabled() && client?.isReady ? client : null;
}

const store = {
  async version() {
    const target = readyClient();
    if (!target) return null;
    return command(target, async () => {
      await target.set(versionKey, randomUUID(), { NX: true });
      return target.get(versionKey);
    });
  },
  async get(key) {
    const target = readyClient();
    return target ? command(target, () => target.get(key)) : null;
  },
  async putIfCurrent(version, key, value, ttl) {
    const target = readyClient();
    if (!target) return;
    return command(target, () => target.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3]) end return nil",
      { keys: [versionKey, key], arguments: [version, value, String(ttl)] }
    ));
  },
  async invalidate() {
    const target = readyClient();
    if (target) await command(target, () => target.set(versionKey, randomUUID()));
  }
};

function cacheConnectionStatus() {
  return { enabled: enabled(), ready: Boolean(enabled() && client?.isReady), errors: stats.errors };
}

module.exports = { store, enabled, namespace, startConnection, cacheConnectionStatus };
