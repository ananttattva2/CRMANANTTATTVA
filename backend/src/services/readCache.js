const { createHash } = require('node:crypto');
const { createOverallCache } = require('./overallDashboardData');
const redis = require('./redisConnection');

function createReadCacheSystem({ store = redis.store, enabled = redis.enabled, prefix = redis.namespace } = {}) {
  const resets = new Set();
  let generation = 0;
  const stats = { hits: 0, misses: 0, fallbacks: 0, invalidations: 0 };

  function createCache({ name, ttl = 15000, maxEntries = 50, now = Date.now } = {}) {
    if (!name) throw new Error('A stable cache name is required');
    let local = createOverallCache({ ttl, maxEntries, now });
    const inFlight = new Map();
    resets.add(() => { local = createOverallCache({ ttl, maxEntries, now }); inFlight.clear(); });

    return (scopeKey, load) => {
      if (!enabled()) return local(scopeKey, load);
      const hash = createHash('sha256').update(String(scopeKey)).digest('hex');
      const startedGeneration = generation;
      // Redis failures bypass stored local responses; independent workers
      // cannot reliably invalidate each other's memory during an outage.
      return (async () => {
        let version;
        try { version = await store.version(); } catch { /* database fallback */ }
        const flightKey = `${startedGeneration}:${version || 'offline'}:${hash}`;
        if (inFlight.has(flightKey)) return inFlight.get(flightKey);
        const pending = (async () => {
          const key = version ? `${prefix}:${name}:${version}:${hash}` : null;
          if (key) {
            try {
              const cached = await store.get(key);
              if (cached !== null && cached !== undefined) {
                const envelope = JSON.parse(cached);
                if (envelope?.format === 1 && Object.hasOwn(envelope, 'value')) {
                  stats.hits += 1;
                  return envelope.value;
                }
              }
            } catch { /* Corrupt/unavailable cache must never fail a DB read. */ }
          } else stats.fallbacks += 1;
          stats.misses += 1;
          const value = await load();
          if (key && startedGeneration === generation) {
            try {
              const encoded = JSON.stringify({ format: 1, value });
              // Avoid putting unusually large forms/reports into shared RAM.
              if (Buffer.byteLength(encoded) <= 2 * 1024 * 1024) {
                await store.putIfCurrent(version, key, encoded, ttl);
              }
            } catch { /* The original database response remains successful. */ }
          }
          return value;
        })();
        inFlight.set(flightKey, pending);
        try { return await pending; }
        finally { if (inFlight.get(flightKey) === pending) inFlight.delete(flightKey); }
      })();
    };
  }

  async function invalidate() {
    generation += 1;
    for (const reset of resets) reset();
    stats.invalidations += 1;
    if (enabled()) {
      try { await store.invalidate(); } catch { /* connection recovery rotates the version */ }
    }
  }

  return { createCache, invalidate, stats };
}

const readCache = createReadCacheSystem();
module.exports = { readCache, createReadCacheSystem };
