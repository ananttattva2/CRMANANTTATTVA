const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { ObjectId, Long, EJSON } = require('bson');
const migration = require('../src/services/storageMigration');
const runner = require('../src/services/storageMigrationRunner');
const { options, sourceUrl } = require('../src/scripts/migrateCloudinaryToSpaces');
const oldUrl = 'https://res.cloudinary.com/demo/raw/upload/v1/crm/purchase-email-proofs/a.eml';
const newUrl = 'https://crm.test/api/assets/file?key=crm%2Fpurchase-email-proofs%2Fa.eml&signature=test';
const asset = (extra = {}) => ({ id: 'a', public_id: 'crm/purchase-email-proofs/a.eml', resource_type: 'raw', type: 'upload', kind: 'original', key: 'crm/purchase-email-proofs/a.eml', aliases: [oldUrl], status: 'verified', verification: { size: 3, sha256: migration.sha256('abc') }, ...extra });
function memoryDatabase(documents) {
  const rows = documents.map(doc => EJSON.parse(EJSON.stringify(doc))); const calls = [];
  const collection = {
    find: () => rows,
    findOne: async query => rows.find(doc => String(doc._id) === String(query._id)),
    updateOne: async (query, update) => {
      calls.push({ query, update });
      const doc = rows.find(row => String(row._id) === String(query._id));
      const { _id, ...expected } = query;
      if (!migration.valuesMatch(doc, expected)) return { matchedCount: 0 };
      for (const [field, value] of Object.entries(update.$set)) { const parts = field.split('.'); let parent = doc; for (const part of parts.slice(0, -1)) parent = parent[part]; parent[parts.at(-1)] = value; }
      return { matchedCount: 1 };
    }
  };
  return { collection: () => collection, rows, calls };
}
test('all resource types and delivery types survive multi-page library discovery', async () => {
  const state = { assets: [] }; const cursors = []; let saves = 0;
  await runner.discoverLibrary(state, async cursor => {
    cursors.push(cursor);
    return cursor === null ? { total_count: 3, resources: [{ asset_id: 'image', public_id: 'crm/image', resource_type: 'image', type: 'private' }], next_cursor: 'next' } :
      { total_count: 3, resources: [{ asset_id: 'pdf', public_id: 'crm/file.pdf', resource_type: 'raw', type: 'authenticated' }, { asset_id: 'audio', public_id: 'crm/audio', resource_type: 'video', type: 'upload' }] };
  }, async () => { saves++; });
  assert.deepEqual(cursors, [null, 'next']); assert.equal(state.assets.length, 3); assert.equal(saves, 2);
  assert.ok(state.discovery.complete); assert.equal(state.assets[0].type, 'private');
});
test('discovery resumes saved cursor and never claims completeness on count mismatch', async () => {
  const state = { assets: [{ id: 'a', kind: 'original' }], discovery: { cursor: 'saved', expectedTotal: 2, complete: false } };
  await assert.rejects(runner.discoverLibrary(state, async cursor => { assert.equal(cursor, 'saved'); return { resources: [], total_count: 2 }; }, async () => {}), /count mismatch/);
  assert.equal(state.discovery.complete, false);
});
test('folder paths preserve fixed and dynamic mode; raw extensions are never doubled', () => {
  assert.equal(migration.originalKey(asset()), 'crm/purchase-email-proofs/a.eml');
  assert.equal(migration.originalKey(asset({ public_id: 'random-id', asset_folder: 'crm/invoices/2026', resource_type: 'image', format: 'pdf' })), 'crm/invoices/2026/random-id.pdf');
  assert.equal(migration.originalKey(asset({ public_id: 'crm/avatar', resource_type: 'image', format: 'png' })), 'crm/avatar.png');
  assert.throws(() => migration.originalKey(asset({ asset_folder: '../escape' })), /Unsafe/);
});
test('colliding image/raw filenames retain folder and distinct deterministic object keys', () => {
  const assets = [asset({ id: 'one', public_id: 'crm/a', resource_type: 'image', format: 'pdf' }), asset({ id: 'two', public_id: 'crm/a.pdf' })];
  migration.assignKeys(assets); assert.notEqual(assets[0].key, assets[1].key);
  assert.ok(assets.every(a => a.key.startsWith('crm/') && a.collisionRenamed));
});
test('unreferenced library originals remain in the inventory and missing Mongo URLs are included', () => {
  const assets = [asset(), asset({ id: 'orphan', aliases: [], public_id: 'crm/orphan.pdf' })];
  migration.connectReferences(assets, [{ url: oldUrl, collection: 'proofs', documentId: '1', path: 'file' }, { url: 'https://res.cloudinary.com/demo/raw/upload/crm/deleted.pdf', collection: 'proofs', documentId: '2', path: 'file' }]);
  assert.equal(assets.length, 3); assert.equal(assets[0].references.length, 1); assert.equal(assets[2].kind, 'reference');
});
test('SHA-256 and byte length must both match, independently of ETags', async () => {
  const source = await migration.digestStream(Readable.from([Buffer.from('abc')]));
  assert.ok(migration.verified(source, { ...source }, 3));
  assert.throws(() => migration.verified(source, { ...source, size: 4 }), /verification failed/);
  assert.throws(() => migration.verified(source, { ...source, sha256: 'bad' }), /verification failed/);
  assert.throws(() => migration.verified(source, source, 4), /verification failed/);
});
test('retry/resume skips verified assets and reports failures and missing sources separately', async () => {
  const state = { discoveryComplete: true, assets: [asset(), asset({ id: 'retry', status: 'failed' }), asset({ id: 'gone', status: 'pending' })] };
  const seen = [];
  await runner.transferAll(state, async a => { seen.push(a.id); const error = new Error(); error.sourceMissing = true; error.safeMessage = 'HTTP 404'; throw error; }, async () => {});
  assert.deepEqual(seen, ['gone']); assert.equal(state.assets[2].status, 'missing');
  await runner.transferAll(state, async a => { seen.push(a.id); return { size: 3, sha256: migration.sha256('abc') }; }, async () => {}, { retry: true });
  const report = migration.report(state); assert.equal(report.total, 3); assert.equal(report.successful, 3); assert.equal(report.missing, 0); assert.equal(report.failed, 0);
});
test('only verified references change, including nested attachments and embedded email HTML', () => {
  const doc = { attachments: [{ storageUrl: oldUrl, storageKey: 'cloud-id' }], emailData: { html: `<a href="${oldUrl}">proof</a>` }, missing: 'https://res.cloudinary.com/demo/raw/upload/missing.pdf' };
  const changes = migration.referencePatches(doc, [asset()], () => newUrl);
  assert.equal(changes.after['attachments.0.storageUrl'], newUrl);
  assert.equal(changes.after['attachments.0.storageKey'], 'spaces:crm/purchase-email-proofs/a.eml');
  assert.ok(changes.after['emailData.html'].includes('api/assets/file'));
  assert.equal(changes.after.missing, undefined);
  assert.equal(Object.keys(migration.referencePatches(doc, [asset({ status: 'failed' })], () => newUrl).after).length, 0);
});
test('durable write-ahead journal precedes Mongo update and rollback restores originals', async () => {
  const db = memoryDatabase([{ _id: 'id', file: { url: oldUrl, publicId: 'old-id' } }]);
  const state = { discoveryComplete: true, assets: [asset()], patches: [], collections: ['proofs'] }; const snapshots = [];
  await runner.updateReferences(state, db, () => newUrl, async () => {}, async () => {
    snapshots.push({ status: state.patches.at(-1)?.status, writes: db.calls.length });
  });
  assert.ok(snapshots.some(s => s.status === 'pending' && s.writes === 0));
  assert.equal(db.rows[0].file.url, newUrl); assert.equal(state.patches[0].status, 'applied');
  await runner.updateReferences(state, db, () => newUrl, async () => {}, async () => {}, { rollback: true });
  assert.equal(db.rows[0].file.url, oldUrl); assert.equal(db.rows[0].file.publicId, 'old-id'); assert.equal(state.patches[0].status, 'rolled-back');
});
test('a failed journal write prevents the database update', async () => {
  const db = memoryDatabase([{ _id: 'id', url: oldUrl }]); const state = { discoveryComplete: true, assets: [asset()], patches: [], collections: ['proofs'] };
  await assert.rejects(runner.updateReferences(state, db, () => newUrl, async () => {}, async () => { if (state.patches.length) throw new Error('disk full'); }), /disk full/);
  assert.equal(db.calls.length, 0); assert.equal(db.rows[0].url, oldUrl);
});
test('rollback refuses to overwrite concurrent edits', async () => {
  const db = memoryDatabase([{ _id: 'id', url: 'newer-user-edit' }]);
  const patch = { documentId: 'id', before: { url: oldUrl }, after: { url: newUrl } };
  assert.equal(await migration.applyPatch(db.collection(), patch, 'rollback'), 'conflict'); assert.equal(db.calls.length, 0);
});
test('resume recognizes a DB write completed before the final checkpoint', async () => {
  const db = memoryDatabase([{ _id: 'id', url: newUrl }]);
  const state = { discoveryComplete: true, assets: [asset()], collections: [], patches: [{ collection: 'proofs', documentId: 'id', before: { url: oldUrl }, after: { url: newUrl }, assetIds: ['a'], status: 'pending' }] };
  await runner.updateReferences(state, db, () => newUrl, async () => {}, async () => {});
  assert.equal(state.patches[0].status, 'applied'); assert.equal(db.calls.length, 0);
});
test('failed destination re-verification prevents reference updates', async () => {
  const db = memoryDatabase([{ _id: 'id', url: oldUrl }]); const state = { discoveryComplete: true, assets: [asset()], patches: [], collections: ['proofs'] };
  await runner.updateReferences(state, db, () => newUrl, async () => { throw new Error('corrupt object'); }, async () => {});
  assert.equal(db.calls.length, 0); assert.equal(state.assets[0].status, 'failed');
});
test('checkpoints keep JS counters and exact BSON ObjectId/64-bit identifiers across resume', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-migration-test-')); const file = path.join(directory, 'state.json');
  try {
    const long = Long.fromString('9223372036854775806'); const id = new (require('mongoose').Types.ObjectId)();
    migration.atomicWrite(file, { schemaVersion: 1, assets: [{ bytes: 12, references: [{ documentId: long }] }], patches: [{ documentId: id }] });
    const restored = migration.loadState(file); assert.equal(restored.schemaVersion, 1); assert.equal(restored.assets[0].bytes, 12);
    assert.equal(restored.assets[0].references[0].documentId.toString(), long.toString()); assert.equal(restored.patches[0].documentId.toHexString(), id.toHexString());
  } finally { fs.unlinkSync(file); fs.rmdirSync(directory); }
});
test('mutating commands require approval; apply also requires a backup; dry-run never mutates', () => {
  for (const command of ['copy', 'apply', 'rollback']) assert.throws(() => options([command]), /approval/);
  assert.throws(() => options(['apply', '--approve-production']), /backup/);
  assert.equal(options(['apply', '--dry-run']).command, 'inventory');
  assert.equal(options(['apply', '--approve-production', '--backup-confirmed']).command, 'apply');
  assert.throws(() => options(['delete']), /Unknown/);
});
test('original source requests use signed asset IDs without transformations or format conversions', () => {
  const keys = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']; const previous = keys.map(key => process.env[key]);
  Object.assign(process.env, { CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_KEY: 'key', CLOUDINARY_API_SECRET: 'secret' });
  try { const url = new URL(sourceUrl(asset({ type: 'authenticated' }))); assert.equal(url.pathname, '/v1_1/demo/asset/download'); assert.equal(url.searchParams.get('asset_id'), 'a'); assert.ok(url.searchParams.get('signature')); assert.ok(Number(url.searchParams.get('timestamp')) > 0); assert.equal(url.searchParams.get('transformation'), null); assert.equal(url.searchParams.get('format'), null); }
  finally { keys.forEach((key, i) => previous[i] === undefined ? delete process.env[key] : process.env[key] = previous[i]); }
});
test('server-side reference projection matches local discovery without returning document payloads', () => {
  const doc = { _id: new ObjectId(), bigUnrelated: 'a'.repeat(100000), rows: [{ file: oldUrl }], email: `<a href="${oldUrl}">proof</a>` };
  const local = []; migration.walkReferences(doc, (url, path) => local.push({ url, path: path.join('.') }));
  assert.deepEqual(migration.serverReferences(doc), local);
});
test('append-only write-ahead journal recovers pending/applied patches and exact IDs without a full checkpoint', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-journal-test-')); const file = path.join(directory, 'state.json'); const journal = path.join(directory, 'patch-journal.jsonl');
  try {
    migration.atomicWrite(file, { schemaVersion: 1, patches: [] });
    const patch = { documentId: new ObjectId(), collection: 'clients', before: { url: oldUrl }, after: { url: newUrl }, status: 'pending' }; const known = new WeakMap();
    migration.journalChanges(journal, [patch], known);
    assert.equal(migration.loadState(file).patches[0].status, 'pending');
    patch.status = 'applied'; migration.journalChanges(journal, [patch], known);
    fs.appendFileSync(journal, '{incomplete uncommitted tail');
    const recovered = migration.loadState(file); assert.equal(recovered.patches[0].status, 'applied'); assert.equal(recovered.patches[0].documentId.toHexString(), patch.documentId.toHexString());
    patch.status = 'rolled-back'; migration.journalChanges(journal, [patch], known);
    assert.equal(migration.loadState(file).patches[0].status, 'rolled-back', 'Uncommitted partial tail is removed before new durable entries');
  } finally { for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name)); fs.rmdirSync(directory); }
});
