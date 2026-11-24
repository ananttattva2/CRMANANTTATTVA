const { createHash, randomUUID } = require('node:crypto');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  // BSON IDs use non-enumerable storage. Treating them as plain objects loses
  // identity and can collapse distinct user/team scopes into the same key.
  if (typeof value.toHexString === 'function') return value.toHexString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof RegExp) return { pattern: value.source, flags: value.flags };
  if (Buffer.isBuffer(value)) return value.toString('hex');
  if (value instanceof Map) return canonical(Object.fromEntries(value));
  if (value instanceof Set) return [...value].map(canonical);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

// Revision lives in MongoDB, not an evictable Redis key. Redis outages/restarts
// and multiple Node workers cannot resurrect a cache from before a CRM write.
function createCrmCache({ store, revisions, namespace = 'crm:production:v1', ttl = 60, maxBytes = 8 * 1024 * 1024 }) {
  const inFlight = new Map();
  let invalidationFailed = false;
  const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
  const keyFor = (req, revision) => `${namespace}:${revision}:${digest({
    path: req.originalUrl.split('?')[0],
    query: Object.fromEntries(Object.entries(req.query || {}).filter(([key]) => key !== '_')),
    // Authentication runs on every request, even on a cache hit. Include the
    // current user document to separate roles, teams and changed permissions.
    user: req.user?.toObject ? req.user.toObject() : req.user
  })}`;
  async function revision() {
    if (invalidationFailed) return null;
    try { return await revisions.read(); } catch { return null; }
  }
  async function invalidate() {
    try {
      const next = await revisions.bump();
      if (next) invalidationFailed = false;
      return next;
    } catch {
      invalidationFailed = true;
      inFlight.clear();
      // Invalidate Redis too if Mongo's revision update fails after a write.
      await store.disable().catch(() => {});
      return null;
    }
  }
  async function remember(name, load) {
    const before = await revision();
    if (!before) return load();
    const key = `${namespace}:${before}:model:${digest(name)}`;
    if (inFlight.has(key)) return inFlight.get(key);
    const pending = (async () => {
      const { EJSON } = require('mongoose').mongo.BSON;
      try {
        const cached = await store.get(key);
        if (cached && await revision() === before) return EJSON.parse(cached, { relaxed: true });
      } catch { /* Corrupt/missing Redis entries fall back to the loader. */ }
      const data = await load();
      try {
        const encoded = EJSON.stringify(data, { relaxed: true });
        if (Buffer.byteLength(encoded) <= maxBytes && await revision() === before) await store.set(key, encoded, ttl);
      } catch { /* Do not block the authoritative read on cache failure. */ }
      return data;
    })();
    // Sharing only within a revision prevents a post-write read from joining
    // an old in-flight loader. Completed results live in Redis, not process RAM.
    if (inFlight.size < 100) inFlight.set(key, pending);
    try { return await pending; } finally { if (inFlight.get(key) === pending) inFlight.delete(key); }
  }
  async function middleware(req, res, next) {
    if (req.method !== 'GET' || !req.user) return next();
    res.set('Cache-Control', 'private, no-store');
    const lookupStarted = Date.now();
    const before = await revision();
    if (!before) { res.set('X-CRM-Cache', 'BYPASS'); return next(); }
    res.set('X-CRM-Revision', before);
    const key = keyFor(req, before);
    const force = /no-cache|no-store/i.test(String(req.get('cache-control') || ''));
    if (!force) {
      try {
        const cached = await store.get(key);
        if (cached && await revision() === before) {
          const body = JSON.parse(cached);
          res.set('X-CRM-Cache', 'HIT');
          res.set('Server-Timing', `auth;dur=${req.crmAuthMs || 0}, cache;dur=${Date.now() - lookupStarted}`);
          return res.json(body);
        }
      } catch { /* Redis failure never blocks a MongoDB read. */ }
    }
    const lookupMs = Date.now() - lookupStarted;
    res.set('X-CRM-Cache', 'MISS');
    const originalJson = res.json.bind(res);
    res.json = async body => {
      const controllerTiming = res.get?.('Server-Timing');
      res.set('Server-Timing', [controllerTiming, `auth;dur=${req.crmAuthMs || 0}, cache;dur=${lookupMs}`].filter(Boolean).join(', '));
      if (res.statusCode === 200 && !body?.error && !body?.errors && body?.success !== false && body?.ok !== false) {
        try {
          const serialized = JSON.stringify(body);
          // A read that overlaps a write must never fill the new generation
          // with its old snapshot. Old generation keys expire naturally.
          if (Buffer.byteLength(serialized) <= maxBytes && await revision() === before) {
            await store.set(key, serialized, ttl);
          }
        } catch { /* Keep serving the authoritative controller result. */ }
      }
      return originalJson(body);
    };
    return next();
  }
  return { middleware, revision, invalidate, keyFor, remember };
}

let singleton;
function getCrmCache() {
  if (singleton) return singleton;
  const { redisStore, cacheEnabled, namespace } = require('./redisStore');
  const mongoose = require('mongoose');
  const collection = () => mongoose.connection.collection('crm_cache_revisions');
  singleton = createCrmCache({
    namespace,
    ttl: Math.max(1, Math.min(300, Number(process.env.REDIS_CACHE_TTL_SECONDS) || 60)),
    store: redisStore,
    revisions: {
      async read() {
        if (!cacheEnabled()) return null;
        const row = await collection().findOne({ _id: namespace }, { maxTimeMS: 2000, readPreference: 'primary' });
        return row?.revision || 'initial';
      },
      async bump() {
        if (!cacheEnabled()) return null;
        const revision = randomUUID();
        await collection().updateOne({ _id: namespace }, { $set: { revision, updatedAt: new Date() } },
          { upsert: true, maxTimeMS: 2000, writeConcern: { w: 'majority' } });
        return revision;
      }
    }
  });
  return singleton;
}
const cacheRead = (req, res, next) => getCrmCache().middleware(req, res, next).catch(next);
const invalidateCrmCache = () => getCrmCache().invalidate();
module.exports = { createCrmCache, cacheRead, invalidateCrmCache, getCrmCache };
