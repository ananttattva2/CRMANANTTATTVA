const migration = require('./storageMigration');

async function discoverLibrary(state, fetchPage, save) {
  state.discovery ||= { cursor: null, started: false, complete: false, expectedTotal: null };
  if (state.discovery.complete) return;
  do {
    const page = await fetchPage(state.discovery.cursor);
    if (!Array.isArray(page.resources) || !Number.isSafeInteger(page.total_count)) throw new Error('Invalid Cloudinary discovery response.');
    if (state.discovery.expectedTotal !== null && state.discovery.expectedTotal !== page.total_count) throw new Error('Cloudinary inventory changed during discovery. Freeze uploads and create a fresh inventory.');
    state.discovery.expectedTotal = page.total_count;
    const known = new Set(state.assets.map(a => a.id));
    for (const resource of page.resources) {
      if (!resource.asset_id || !resource.public_id || !resource.resource_type) throw new Error('Incomplete Cloudinary asset metadata.');
      if (!known.has(resource.asset_id)) {
        state.assets.push({ ...resource, id: resource.asset_id, kind: 'original', status: 'pending', aliases: [resource.secure_url, resource.url].filter(Boolean), references: [] });
        known.add(resource.asset_id);
      }
    }
    if (page.next_cursor && page.next_cursor === state.discovery.cursor) throw new Error('Cloudinary returned a repeating cursor.');
    state.discovery.cursor = page.next_cursor || null; state.discovery.started = true;
    state.discovery.complete = !page.next_cursor;
    if (state.discovery.complete && state.assets.filter(a => a.kind === 'original').length !== page.total_count) {
      state.discovery.complete = false;
      throw new Error('Cloudinary inventory count mismatch; discovery is incomplete.');
    }
    await save();
  } while (!state.discovery.complete);
}
async function transferAll(state, transfer, save, { retry = false } = {}) {
  if (!state.discoveryComplete) throw new Error('Complete discovery is required before copying.');
  const queue = state.assets.filter(asset => asset.status !== 'verified' && (retry || !['failed', 'missing'].includes(asset.status)));
  let cursor = 0; let completed = 0;
  const concurrency = Math.max(1, Math.min(8, Number(process.env.STORAGE_MIGRATION_CONCURRENCY) || 4));
  async function worker() {
   while (cursor < queue.length) {
    const asset = queue[cursor++];
    try {
      asset.attempts = (asset.attempts || 0) + 1;
      asset.status = 'pending'; await save();
      asset.verification = await transfer(asset);
      asset.status = 'verified'; delete asset.error;
    } catch (error) {
      asset.status = error.sourceMissing ? 'missing' : 'failed';
      // Never persist signed Cloudinary/S3 download URLs from HTTP error messages.
      asset.error = error.safeMessage || `Transfer failed (${error.name || 'Error'}${error.$metadata?.httpStatusCode ? ` HTTP ${error.$metadata.httpStatusCode}` : ''}); inspect credentials/access and retry.`;
    }
    await save();
    completed++;
    if (completed % 25 === 0 || completed === queue.length) console.log(JSON.stringify({ progress: 'copy', completed, queued: queue.length, verified: state.assets.filter(a => a.status === 'verified').length, failed: state.assets.filter(a => a.status === 'failed').length, missing: state.assets.filter(a => a.status === 'missing').length }));
   }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
}
async function updateReferences(state, database, fileUrl, verifyAsset, save, { rollback = false, retry = false } = {}) {
  if (!state.discoveryComplete && !rollback) throw new Error('Complete discovery is required before updating references.');
  if (rollback) {
    for (const patch of [...state.patches].reverse()) {
      if (patch.status === 'rolled-back') continue;
      const result = await migration.applyPatch(database.collection(patch.collection), patch, 'rollback');
      patch.status = result === 'conflict' ? 'conflict' : 'rolled-back'; await save();
    }
    return;
  }
  // Re-verify every target before touching MongoDB, including resumed transfers.
  const verificationQueue = state.assets.filter(a => a.status === 'verified' && (!Array.isArray(a.references) || a.references.length));
  let verificationCursor = 0; let verificationComplete = 0;
  state.phase = 'verifying-references';
  async function verifyWorker() { while (verificationCursor < verificationQueue.length) {
    const asset = verificationQueue[verificationCursor++];
    try { await verifyAsset(asset); }
    catch { asset.status = 'failed'; asset.error = 'Destination re-verification failed; references left untouched.'; }
    await save();
    verificationComplete++;
    if (verificationComplete % 25 === 0 || verificationComplete === verificationQueue.length) console.log(JSON.stringify({ progress: 'reference-verification', completed: verificationComplete, queued: verificationQueue.length }));
  } }
  await Promise.all(Array.from({ length: Math.min(4, verificationQueue.length) }, verifyWorker));
  state.phase = 'updating-references'; await save(true);
  // Recover write-ahead entries after a process died between MongoDB update and checkpoint.
  for (const patch of state.patches.filter(p => p.status === 'pending' || (retry && p.status === 'conflict'))) {
    if (!patch.assetIds.every(id => state.assets.find(a => a.id === id)?.status === 'verified')) continue;
    const result = await migration.applyPatch(database.collection(patch.collection), patch);
    patch.status = result === 'conflict' ? 'conflict' : 'applied'; await save();
  }
  const aliasIndex = migration.verifiedAliasIndex(state.assets);
  for (const name of state.collections) {
    const collection = database.collection(name);
    const ids = new Map();
    for (const asset of state.assets.filter(a => a.status === 'verified')) for (const ref of asset.references || []) if (ref.collection === name) ids.set(require('bson').EJSON.stringify(ref.documentId), ref.documentId);
    if (!ids.size && state.assets.every(a => Array.isArray(a.references))) continue;
    async function* documents() {
      const values = [...ids.values()];
      if (!values.length) { for await (const doc of collection.find({})) yield doc; return; }
      for (let index = 0; index < values.length; index += 500) for await (const doc of collection.find({ _id: { $in: values.slice(index, index + 500) } })) yield doc;
    }
    for await (const doc of documents()) {
      const changes = migration.referencePatches(doc, state.assets, fileUrl, aliasIndex);
      if (!Object.keys(changes.after).length) continue;
      const existing = state.patches.find(p => p.collection === name && migration.sha256(require('bson').EJSON.stringify(p.documentId)) === migration.sha256(require('bson').EJSON.stringify(doc._id)) && p.status !== 'rolled-back' && Object.keys(p.after).some(field => field in changes.after));
      if (existing) continue;
      const patch = { collection: name, documentId: doc._id, ...changes, status: 'pending' };
      state.patches.push(patch);
      // Durable journal is saved before the database write, not after it.
      await save();
      const result = await migration.applyPatch(collection, patch);
      patch.status = result === 'conflict' ? 'conflict' : 'applied'; await save();
    }
  }
}
module.exports = { discoverLibrary, transferAll, updateReferences };
