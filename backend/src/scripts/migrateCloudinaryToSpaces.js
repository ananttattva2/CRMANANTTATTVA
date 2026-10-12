/* No Cloudinary deletion is implemented. Cloudinary requests are read-only search/download.
 * Run with --help. Production writes require explicit --approve-production.
 */
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const mongoose = require('mongoose');
const { Upload } = require('@aws-sdk/lib-storage');
const { EJSON } = require('bson');
const spaces = require('../services/spacesStorage');
const migration = require('../services/storageMigration');
const runner = require('../services/storageMigrationRunner');

function options(argv) {
  const result = { command: 'inventory', directory: 'storage-migration-output/default', retry: false, approved: false, backup: false, resume: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (['inventory', 'copy', 'apply', 'rollback', 'report', 'verify'].includes(arg)) result.command = arg;
    else if (arg === '--run-dir') { if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('--run-dir requires a value.'); result.directory = argv[++i]; }
    else if (arg === '--retry') result.retry = true;
    else if (arg === '--resume') result.resume = true;
    else if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--approve-production') result.approved = true;
    else if (arg === '--backup-confirmed') result.backup = true;
    else if (arg === '--help') result.help = true;
    else throw new Error(`Unknown migration option: ${arg}`);
  }
  if (result.dryRun) result.command = 'inventory';
  if (['copy', 'apply', 'rollback'].includes(result.command) && !result.approved) throw new Error('Production writes require user approval and --approve-production.');
  if (result.command === 'apply' && !result.backup) throw new Error('Take a MongoDB Atlas backup and supply --backup-confirmed before reference updates.');
  return result;
}
function cloudConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY; const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) throw new Error('Cloudinary Admin API credentials are required.');
  const prefix = process.env.CLOUDINARY_API_PREFIX || 'https://api.cloudinary.com';
  if (!/^https:\/\/api(?:-eu|-ap)?\.cloudinary\.com$/.test(prefix)) throw new Error('Invalid Cloudinary API prefix.');
  return { cloudName, apiKey, apiSecret, base: `${prefix}/v1_1/${encodeURIComponent(cloudName)}` };
}
async function retryRequest(operation) {
  const attempts = 4;
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= attempts - 1 || (error.status && error.status !== 429 && error.status < 500)) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(error.retryAfter || 1000 * 2 ** attempt, 30000)));
    }
  }
}
async function fetchPage(cursor) {
  const c = cloudConfig();
  return retryRequest(async () => {
    // Empty search expression enumerates all resource/delivery types, not just image/upload.
    const response = await fetch(`${c.base}/resources/search`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${c.apiKey}:${c.apiSecret}`).toString('base64')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ max_results: 500, ...(cursor ? { next_cursor: cursor } : {}) }), signal: AbortSignal.timeout(60000) });
    if (!response.ok) { const error = new Error(`Cloudinary inventory request failed (${response.status}).`); error.status = response.status; error.retryAfter = Number(response.headers.get('retry-after')) * 1000; throw error; }
    return response.json();
  });
}
function sourceUrl(asset) {
  if (asset.kind === 'reference') {
    if (!migration.cloudUrl(asset.sourceUrl)) throw new Error('Unsafe source URL.');
    return asset.sourceUrl;
  }
  const c = cloudConfig(); const params = { asset_id: asset.id, expires_at: Math.floor(Date.now() / 1000) + 3600 };
  const signable = Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('&');
  const signature = crypto.createHash('sha1').update(signable + c.apiSecret).digest('hex');
  // No format or transformation: retrieves original bytes, including private/authenticated assets.
  return `${c.base}/asset/download?${new URLSearchParams({ ...params, api_key: c.apiKey, signature })}`;
}
async function verifyTarget(asset) {
  const metadata = await spaces.head(asset.key);
  const object = await spaces.get(asset.key); const digest = await migration.digestStream(object.Body);
  migration.verified(asset.verification, digest);
  if (metadata.ContentLength !== digest.size) throw new Error('Destination HEAD size mismatch.');
  return digest;
}
async function transfer(asset, state, directory) {
  if (!asset.key || !spaces.validKey(asset.key)) { const error = new Error(); error.safeMessage = 'Invalid destination path.'; throw error; }
  const temporary = path.join(directory, `${migration.sha256(asset.id)}.download`);
  let response;
  try {
    response = await retryRequest(async () => {
      const res = await fetch(sourceUrl(asset), { redirect: 'error', headers: { 'Accept-Encoding': 'identity' }, signal: AbortSignal.timeout(30 * 60 * 1000) });
      if (!res.ok) { const error = new Error(); error.status = res.status; error.sourceMissing = res.status === 404 || res.status === 410; error.safeMessage = `Cloudinary download HTTP ${res.status}.`; throw error; }
      return res;
    });
    const hash = crypto.createHash('sha256'); let size = 0;
    const tap = new Transform({ transform(chunk, encoding, callback) { hash.update(chunk); size += chunk.length; callback(null, chunk); } });
    await pipeline(Readable.fromWeb(response.body), tap, fs.createWriteStream(temporary, { mode: 0o600 }));
    const source = { size, sha256: hash.digest('hex') };
    const advertised = response.headers.get('content-length');
    if ((advertised !== null && Number(advertised) !== size) || (asset.kind === 'original' && Number.isFinite(asset.bytes) && asset.bytes !== size)) { const error = new Error(); error.safeMessage = 'Cloudinary original size changed or source download was incomplete.'; throw error; }
    let existing;
    try { existing = await spaces.head(asset.key); } catch (error) { if (error.$metadata?.httpStatusCode !== 404 && error.name !== 'NotFound' && error.name !== 'NoSuchKey') throw error; }
    if (existing) {
      const object = await spaces.get(asset.key); const destination = await migration.digestStream(object.Body);
      try { migration.verified(source, destination, asset.kind === 'original' ? asset.bytes : undefined); return source; }
      catch {
        if (existing.Metadata?.['migration-run'] !== state.runId || existing.Metadata?.['source-id'] !== migration.sha256(asset.id)) { const error = new Error(); error.safeMessage = 'Destination already exists with different bytes; no overwrite performed.'; throw error; }
      }
    }
    const c = spaces.config(); const contentType = (response.headers.get('content-type') || 'application/octet-stream').split(';')[0];
    const upload = new Upload({ client: c.client, queueSize: 2, partSize: 8 * 1024 * 1024, leavePartsOnError: false, params: {
      Bucket: c.bucket, Key: asset.key, Body: fs.createReadStream(temporary), ContentLength: size, ContentType: contentType,
      ContentDisposition: /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(contentType) ? 'inline' : 'attachment', ACL: 'private',
      Metadata: { sha256: source.sha256, 'migration-run': state.runId, 'source-id': migration.sha256(asset.id) }
    } });
    await upload.done();
    const metadata = await spaces.head(asset.key); const object = await spaces.get(asset.key);
    const destination = await migration.digestStream(object.Body);
    migration.verified(source, destination, asset.kind === 'original' ? asset.bytes : undefined);
    if (metadata.ContentLength !== size) throw new Error('HEAD size mismatch.');
    return { ...source, verifiedAt: new Date().toISOString() };
  } finally {
    // Removes only this run's local temporary download, never remote objects.
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
async function connectMongo() {
  const uri = require('../config/db').__test.buildMongoUri();
  if (!uri) throw new Error('MongoDB connection is required for complete reference discovery.');
  await mongoose.connect(uri, { dbName: process.env.DB_NAME || 'registerd_types', serverSelectionTimeoutMS: 15000 });
  return mongoose.connection.db;
}
function identity() {
  const uri = require('../config/db').__test.buildMongoUri() || '';
  return { cloudName: process.env.CLOUDINARY_CLOUD_NAME, bucket: process.env.SPACES_BUCKET || 'ananttattva-crm-files', endpoint: process.env.SPACES_ENDPOINT || 'https://sgp1.digitaloceanspaces.com', databaseFingerprint: migration.sha256(`${uri}|${process.env.DB_NAME || 'registerd_types'}`), origin: process.env.STORAGE_PUBLIC_API_ORIGIN || '', linkSecretFingerprint: migration.sha256(process.env.SPACES_LINK_SECRET || '') };
}
function writeReport(directory, state) {
  const data = migration.report(state); migration.atomicWrite(path.join(directory, 'report.json'), data);
  const columns = ['id', 'kind', 'publicId', 'folder', 'key', 'status', 'attempts', 'size', 'sha256', 'referenceCount', 'error'];
  const csv = x => `"${String(x ?? '').replace(/"/g, '""')}"`;
  fs.writeFileSync(path.join(directory, 'report.csv'), [columns.join(','), ...data.files.map(file => columns.map(key => csv(file[key])).join(','))].join('\n'), { mode: 0o600 });
  console.log(JSON.stringify({ ...data, files: undefined }));
  return data;
}
async function main(argv = process.argv.slice(2)) {
  const opts = options(argv);
  if (opts.help) { console.log('Commands: inventory (default/dry-run), copy, verify, apply, rollback, report\nOptions: --run-dir PATH --resume --retry --dry-run --approve-production --backup-confirmed\ncopy/apply/rollback require explicit approval. apply also requires Atlas backup confirmation. No deletion command exists.'); return; }
  const directory = path.resolve(opts.directory); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stateFile = path.join(directory, 'state.json'); const lockFile = path.join(directory, 'run.lock');
  let lock;
  try { lock = fs.openSync(lockFile, 'wx', 0o600); fs.writeSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); }
  catch { throw new Error('Run directory is locked. Confirm no migration process is running before removing a stale local run.lock.'); }
  let state; const save = () => migration.atomicWrite(stateFile, state);
  try {
    const exists = fs.existsSync(stateFile);
    if (opts.command !== 'inventory' && !exists) throw new Error('Create and review an inventory first.');
    if (exists && opts.command === 'inventory' && !opts.resume) throw new Error('Inventory exists. Use --resume or choose a new --run-dir.');
    state = exists ? migration.loadState(stateFile) : { schemaVersion: 1, runId: crypto.randomUUID(), identity: identity(), assets: [], patches: [], collections: [], discoveryErrors: [], discoveryComplete: false };
    if (state.schemaVersion !== 1) throw new Error('Unsupported migration state version.');
    if (opts.command === 'report') { writeReport(directory, state); return; }
    if (EJSON.stringify(state.identity) !== EJSON.stringify(identity())) throw new Error('Run cloud/bucket/database/origin configuration changed. Restore the original configuration or create a new inventory.');
    if (opts.command === 'inventory') {
      await runner.discoverLibrary(state, fetchPage, save);
      if (!state.discoveryComplete) {
        migration.assignKeys(state.assets);
        const db = await connectMongo();
        const list = await db.listCollections({}, { nameOnly: false }).toArray();
        const requested = (process.env.STORAGE_MIGRATION_COLLECTIONS || '').split(',').map(x => x.trim()).filter(Boolean);
        state.collections = list.filter(c => c.type !== 'view' && !c.name.startsWith('system.') && (!requested.length || requested.includes(c.name))).map(c => c.name).sort();
        if (requested.some(name => !state.collections.includes(name))) throw new Error('A requested MongoDB collection does not exist.');
        const references = [];
        for (const name of state.collections) for await (const doc of db.collection(name).find({})) migration.walkReferences(doc, (url, trail) => references.push({ collection: name, documentId: doc._id, path: trail.join('.'), url }));
        // Rebuild references after interrupted discovery without duplicating records.
        for (const asset of state.assets) asset.references = [];
        migration.connectReferences(state.assets, references);
        const uniqueKeys = new Set();
        for (const asset of state.assets) if (asset.key) { if (uniqueKeys.has(asset.key)) throw new Error('Destination key collision.'); uniqueKeys.add(asset.key); }
        state.discoveryComplete = true; state.discoveryErrors = []; await save();
      }
    } else if (opts.command === 'copy') {
      spaces.config(); await runner.transferAll(state, asset => transfer(asset, state, directory), save, opts);
    } else if (opts.command === 'verify') {
      for (const asset of state.assets.filter(a => a.status === 'verified')) {
        try { await verifyTarget(asset); } catch { asset.status = 'failed'; asset.error = 'Destination re-verification failed.'; }
        await save();
      }
    } else {
      const db = await connectMongo();
      await runner.updateReferences(state, db, spaces.fileUrl, verifyTarget, save, { rollback: opts.command === 'rollback', retry: opts.retry });
    }
    const result = writeReport(directory, state);
    if (result.failed || result.missing || result.database.conflicts || !result.discoveryComplete) process.exitCode = 2;
  } catch (error) {
    if (state) { state.discoveryErrors ||= []; state.discoveryErrors.push(error.message); await save(); writeReport(directory, state); }
    throw error;
  } finally {
    await mongoose.disconnect(); fs.closeSync(lock); fs.unlinkSync(lockFile);
  }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { options, sourceUrl, transfer, verifyTarget, main };
