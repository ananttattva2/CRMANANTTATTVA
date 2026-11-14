// Revalidate small per-record fingerprints before reusing a large projection.
// This cache does not trust TTL or the global revision to establish freshness.
const { createHash } = require('node:crypto');
const { EJSON } = require('mongoose').mongo.BSON;
const flights = new Map();
const amountRows = path => ({ $map: { input: { $ifNull: [path, []] }, as: 'assignment', in: {
  po: { $map: { input: { $ifNull: ['$$assignment.poYearRows', []] }, as: 'po', in: { $toString: { $ifNull: ['$$po.poAmount', ''] } } } },
  original: { $toString: { $ifNull: ['$$assignment.originalPoDetails.poAmount', ''] } }
} } });
const fingerprintProjection = { _id: 1, signature: { $toString: { $toHashedIndexKey: {
  source: { $toHashedIndexKey: '$$ROOT' },
  // Preserve decimals, which Mongo's ordinary hashed-index function truncates.
  amounts: amountRows('$assignments'), snapshotAmounts: amountRows('$data.selectedLeadSnapshot.assignments'),
  totals: { $map: { input: ['$grandTotal', '$combinedBasicAmount', '$payload.basicAmount', '$payload.grandTotal'], as: 'amount', in: { $toString: { $ifNull: ['$$amount', ''] } } } },
  items: { $map: { input: { $ifNull: ['$items', []] }, as: 'item', in: { basic: { $toString: { $ifNull: ['$$item.basicAmount', ''] } }, unit: { $toString: { $ifNull: ['$$item.unit', ''] } } } } }
} } } };

async function readDashboardCollection(Model, filter, projection, options = {}) {
  const direct = () => Model.aggregate([{ $match: filter }, { $project: projection }]).option({ maxTimeMS: 12000 });
  if (!Model.collection?.name) return direct();
  const { redisStore, cacheEnabled, namespace } = require('./redisStore');
  if (!cacheEnabled() && !options.store) return direct();
  const store = options.store || redisStore;
  const key = `${namespace}:validated-snapshot:v3:${createHash('sha256').update(EJSON.stringify({ collection: Model.collection.name, projection })).digest('hex')}`;
  // Only source rows are shared. Scope is always checked in Mongo first, and
  // concurrent HTTP scopes must never join one another's promise.
  const flightKey = `${key}:${createHash('sha256').update(EJSON.stringify(filter)).digest('hex')}`;
  if (flights.has(flightKey)) return flights.get(flightKey);
  const pending = (async () => {
    let cached;
    try { const value = await store.get(key); if (value) cached = EJSON.parse(value); if (!Array.isArray(cached?.meta) || !Array.isArray(cached?.rows)) cached = null; } catch { /* Read Mongo if Redis is unavailable. */ }
    if (!cached) {
      const before = await metadata(); const rows = await direct(); const after = await metadata();
      if (same(before, after)) await save(after, rows);
      return rows;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await metadata();
      const previous = new Map(cached.meta.map(row => [String(row._id), EJSON.stringify(row)]));
      const present = new Set(cached.rows.map(row => String(row._id)));
      const changed = current.filter(row => !present.has(String(row._id)) || previous.get(String(row._id)) !== EJSON.stringify(row)).map(row => row._id);
      if (!changed.length) {
        const byId = new Map(cached.rows.map(row => [String(row._id), row]));
        return current.map(row => byId.get(String(row._id))).filter(Boolean);
      }
      const updates = changed.length ? await Model.aggregate([{ $match: { $and: [filter, { _id: { $in: changed } }] } }, { $project: projection }]).option({ maxTimeMS: 12000 }) : [];
      const byId = new Map(cached.rows.map(row => [String(row._id), row]));
      updates.forEach(row => byId.set(String(row._id), row));
      const rows = current.map(row => byId.get(String(row._id))).filter(Boolean);
      const after = await metadata();
      if (same(current, after)) {
        const union = new Map(cached.meta.map(row => [String(row._id), row]));
        after.forEach(row => union.set(String(row._id), row));
        await save([...union.values()], [...byId.values()]); return rows;
      }
      cached = { meta: current, rows };
    }
    return direct();
    async function metadata() { return Model.aggregate([{ $match: filter }, { $project: fingerprintProjection }]).option({ maxTimeMS: 12000 }); }
    async function save(meta, rows) { try { const value = EJSON.stringify({ meta, rows }); if (Buffer.byteLength(value) <= 8 * 1024 * 1024) await store.set(key, value, 300); } catch { /* Cache writes cannot fail a read. */ } }
  })().catch(async error => {
    // Older Mongo-compatible servers may not implement the hash operator.
    if ([168, 40324, 8000].includes(error.code)) return direct();
    throw error;
  });
  flights.set(flightKey, pending);
  try { return await pending; } finally { if (flights.get(flightKey) === pending) flights.delete(flightKey); }
}
function same(left, right) { return EJSON.stringify(left) === EJSON.stringify(right); }
module.exports = { readDashboardCollection, fingerprintProjection };

const aggregationMetadataFlights = new Map();
async function readDashboardAggregation(Model, pipeline, options = {}) {
  const direct = () => Model.aggregate(pipeline).option({ maxTimeMS: 30000 });
  if (!Model.collection?.name) return direct();
  const { redisStore, cacheEnabled, namespace } = require('./redisStore');
  if (!cacheEnabled() && !options.store) return direct();
  const store = options.store || redisStore;
  const key = `${namespace}:validated-aggregation:v1:${createHash('sha256').update(EJSON.stringify({ collection: Model.collection.name, pipeline })).digest('hex')}`;
  const dependencies = new Set([Model.collection.name]);
  const visit = value => { if (!value || typeof value !== 'object') return; if (value.$lookup?.from) dependencies.add(value.$lookup.from); Object.values(value).forEach(visit); };
  visit(pipeline);
  if (dependencies.size > 1 && !Model.db?.collection) return direct();
  async function metadata() {
    return Promise.all([...dependencies].sort().map(async name => {
      const sourceKey = `${Model.db?.name || ''}:${name}`;
      if (aggregationMetadataFlights.has(sourceKey)) return { collection: name, rows: await aggregationMetadataFlights.get(sourceKey) };
      const query = name === Model.collection.name
        ? Model.aggregate([{ $project: fingerprintProjection }]).option({ maxTimeMS: 12000 })
        : Model.db.collection(name).aggregate([{ $project: fingerprintProjection }], { maxTimeMS: 12000 }).toArray();
      const pending = Promise.resolve(query);
      aggregationMetadataFlights.set(sourceKey, pending);
      try { return { collection: name, rows: await pending }; } finally { if (aggregationMetadataFlights.get(sourceKey) === pending) aggregationMetadataFlights.delete(sourceKey); }
    }));
  }
  let cached;
  try { const value = await store.get(key); if (value) cached = EJSON.parse(value); } catch { /* Recompute rather than trust a damaged cache. */ }
  const before = await metadata();
  if (Array.isArray(cached?.rows) && same(before, cached.meta)) return cached.rows;
  const rows = await direct();
  const after = await metadata();
  if (same(before, after)) {
    try { const value = EJSON.stringify({ meta: after, rows }); if (Buffer.byteLength(value) <= 8 * 1024 * 1024) await store.set(key, value, 300); } catch { /* Mongo remains authoritative. */ }
  }
  return rows;
}
module.exports.readDashboardAggregation = readDashboardAggregation;
