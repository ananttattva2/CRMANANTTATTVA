const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EJSON, ObjectId } = require('bson');
const backup = require('../../scripts/storage-backup.cjs');
test('snapshot backup verifies BSON documents and captures index metadata without database writes', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-backup-test-'));
  let snapshot = false; let ended = false;
  const documents = [{ _id: new ObjectId(), url: 'original-cloudinary-reference' }, { _id: new ObjectId(), createdAt: new Date() }];
  const mongoose = { connect: async () => {}, disconnect: async () => {}, connection: {
    getClient: () => ({ startSession: options => { snapshot = options.snapshot; return { endSession: async () => { ended = true; } }; } }),
    db: { listCollections: () => ({ toArray: async () => [{ name: 'clients', type: 'collection' }] }), collection: () => ({ find: () => documents, indexes: async () => [{ name: '_id_', key: { _id: 1 } }] }) }
  } };
  const appRequire = name => name === 'mongoose' ? mongoose : name === 'bson' ? { EJSON } : { __test: { buildMongoUri: () => 'fixture' } };
  try {
    const result = await backup(appRequire, directory); assert.equal(result.documents, 2); assert.ok(result.backupVerified && snapshot && ended);
    const manifest = EJSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
    assert.ok(manifest.verified); assert.equal(manifest.collections[0].indexes[0].name, '_id_');
  } finally { for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name)); fs.rmdirSync(directory); }
});
