const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
module.exports = async function backup(appRequire, directory) {
  const mongoose = appRequire('mongoose'); const { EJSON } = appRequire('bson');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  await mongoose.connect(appRequire('./src/config/db').__test.buildMongoUri(), { dbName: process.env.DB_NAME || 'registerd_types', autoIndex: false, autoCreate: false });
  const db = mongoose.connection.db; const session = mongoose.connection.getClient().startSession({ snapshot: true });
  const manifest = { createdAt: new Date().toISOString(), collections: [], verified: false };
  try {
    const collections = (await db.listCollections().toArray()).filter(c => c.type !== 'view' && !c.name.startsWith('system.'));
    for (const collection of collections) {
      const file = `${crypto.createHash('sha256').update(collection.name).digest('hex')}.jsonl`;
      const target = path.join(directory, file); const fd = fs.openSync(target, 'wx', 0o600); let count = 0; const hash = crypto.createHash('sha256');
      try {
        for await (const doc of db.collection(collection.name).find({}, { session })) {
          const line = EJSON.stringify(doc, { relaxed: false }) + '\n'; fs.writeSync(fd, line); hash.update(line); count++;
        }
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      const expected = hash.digest('hex'); const actual = crypto.createHash('sha256'); let checked = 0;
      const reader = require('node:readline').createInterface({ input: fs.createReadStream(target), crlfDelay: Infinity });
      for await (const line of reader) { EJSON.parse(line, { relaxed: false }); actual.update(line + '\n'); checked++; }
      if (count !== checked || expected !== actual.digest('hex')) throw new Error('Snapshot backup verification failed.');
      manifest.collections.push({ name: collection.name, file, documents: count, sha256: expected, indexes: await db.collection(collection.name).indexes(), options: collection.options || {} });
    }
    manifest.verified = true;
    fs.writeFileSync(path.join(directory, 'manifest.json'), EJSON.stringify(manifest, { relaxed: false }), { mode: 0o600, flag: 'wx' });
    return { backupVerified: true, collections: manifest.collections.length, documents: manifest.collections.reduce((sum, c) => sum + c.documents, 0) };
  } finally { await session.endSession(); await mongoose.disconnect(); }
};
