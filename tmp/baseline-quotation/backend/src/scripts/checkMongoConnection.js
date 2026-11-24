// Read-only: no models, indexes, seeding, startup services, or document writes.
const fs = require('node:fs');
const inherited = { ...process.env };
const loaded = require('../config/loadEnv')();
const { mongoConfig, safeMongoError } = require('../config/mongoConfig');
const { MongoClient } = require('mongodb');
async function main() {
  const config = mongoConfig();
  const keys = ['MONGO_URI', 'MONGO_ATLAS_URI', 'DB_NAME', 'MONGO_AUTH_SOURCE', 'MONGO_DIRECT_HOSTS', 'MONGO_REPLICA_SET'];
  const pid = process.argv.find(arg => /^--pid=\d+$/.test(arg))?.slice(6);
  let running;
  if (pid) running = Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean).map(entry => {
    const at = entry.indexOf('='); return [entry.slice(0, at), entry.slice(at + 1)];
  }));
  console.log(JSON.stringify({ ...config.diagnostics, envFileLoaded: Boolean(loaded.parsed), environment: keys.map(key => ({
    key, filePresent: loaded.parsed?.[key] !== undefined,
    shellDiffersFromFile: loaded.parsed?.[key] !== undefined && inherited[key] !== undefined && inherited[key] !== loaded.parsed[key],
    pm2DiffersFromFile: running && loaded.parsed?.[key] !== undefined ? running[key] !== loaded.parsed[key] : undefined
  })) }, null, 2));
  const host = config.uri.replace(/^mongodb\+srv:\/\/(?:[^/]*@)?/, '').split(/[/?]/)[0];
  if (!config.uri.startsWith('mongodb+srv://') || host !== 'cluster0.qslasmc.mongodb.net' || config.dbName !== 'crm' || config.authSource !== 'admin') {
    throw new Error('Unexpected migration target; refusing diagnostic connection');
  }
  const client = new MongoClient(config.uri, { authSource: config.authSource, serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db(config.dbName);
    await db.command({ ping: 1 });
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    console.log(JSON.stringify({ ping: 'ok', database: db.databaseName, collections: collections.map(c => c.name).sort() }));
    for (const name of ['clients', 'leads', 'quotations', 'users', 'roles', 'pendingapprovals']) {
      const exists = collections.some(c => c.name === name);
      const hasDocuments = exists && Boolean(await db.collection(name).findOne({}, { projection: { _id: 1 }, maxTimeMS: 10000 }));
      console.log(JSON.stringify({ collection: name, exists, readable: true, hasDocuments }));
    }
  } finally { await client.close(); }
}
main().catch(error => { console.error('Read-only MongoDB diagnostic failed', safeMongoError(error)); process.exitCode = 1; });
