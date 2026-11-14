const { createHash } = require('node:crypto');
const readyIndexes = new WeakMap();
const memory = new WeakMap();

// Store only the requested list fields. Every read checks the source's covered
// (_id, updatedAt) index, so writes/deletions are visible without a stale TTL.
async function compactReadSnapshot(Model, { filter = {}, versionIndex, selection }) {
  let ready = readyIndexes.get(Model);
  if (!ready) {
    ready = Model.collection.createIndex(versionIndex);
    readyIndexes.set(Model, ready);
    ready.catch(() => readyIndexes.delete(Model));
  }
  const index = await ready;
  const versions = await Model.collection.find(filter, { projection: { _id: 1, updatedAt: 1 }, hint: index, maxTimeMS: 10000 }).toArray();
  if (!versions.length) return [];
  const collection = Model.db.collection('crm_compact_read_snapshots');
  const schema = createHash('sha256').update(selection).digest('hex');
  const cached = memory.get(Model);
  const byId = cached?.schema === schema ? new Map(cached.byId) : new Map();
  const missing = versions.filter(row => !byId.has(String(row._id)));
  if (missing.length) {
    const keys = missing.map(row => `${Model.modelName}:${row._id}`);
    const saved = await collection.find({ _id: { $in: keys } }, { maxTimeMS: 10000 }).toArray();
    for (const row of saved) byId.set(String(row.sourceId), row);
  }
  const version = row => row?.updatedAt ? new Date(row.updatedAt).getTime() : 0;
  const changed = versions.filter(row => {
    const stored = byId.get(String(row._id));
    return !stored || stored.schema !== schema || stored.version !== version(row);
  });
  if (changed.length) {
    const ids = changed.map(row => row._id);
    const rows = await Model.find({ $and: [filter, { _id: { $in: ids } }] }).select(`${selection} updatedAt`).maxTimeMS(15000).lean();
    for (const id of ids) byId.delete(String(id));
    const updates = rows.map(data => {
      const document = { sourceId: data._id, schema, version: version(data), data };
      byId.set(String(data._id), document);
      return { updateOne: { filter: { _id: `${Model.modelName}:${data._id}` }, update: { $set: document }, upsert: true } };
    });
    if (updates.length) await collection.bulkWrite(updates, { ordered: false });
  }
  memory.set(Model, { schema, byId });
  const rows = versions.map(row => byId.get(String(row._id))?.data).filter(Boolean);
  const { EJSON } = require('mongoose').mongo.BSON;
  return EJSON.parse(EJSON.stringify(rows), { relaxed: true });
}
module.exports = { compactReadSnapshot };
