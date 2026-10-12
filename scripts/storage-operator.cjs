// Runs only through the explicit, manually dispatched migration workflow.
// Secret input arrives over SSH stdin, never command arguments or logs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { spawn } = require('node:child_process');
const [appArgument, requestedOperation, codeArgument] = process.argv.slice(2);
const delta = requestedOperation.startsWith('delta-');
const originalInventory = requestedOperation === 'delta-inventory-originals';
const operation = originalInventory ? 'inventory' : delta ? requestedOperation.slice(6) : requestedOperation;
const app = fs.realpathSync(appArgument);
const code = fs.realpathSync(codeArgument);
const backend = path.join(code, 'backend');
const appRequire = createRequire(path.join(backend, 'package.json'));
const dotenv = appRequire('dotenv');
async function main() {
  if (!['inventory', 'restart-inventory', 'copy', 'copy-originals', 'backup', 'apply', 'restart-apply', 'rollback'].includes(operation)) throw new Error('Invalid operation.');
  const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (operation !== 'inventory' && payload.confirmation !== 'COPY_AND_UPDATE_APPROVED') throw new Error('Explicit migration approval is required.');
  const envFile = path.join(app, 'backend/.env');
  const original = fs.readFileSync(envFile, 'utf8'); const parsed = dotenv.parse(original);
  if (!payload.SPACES_ACCESS_KEY_ID || !payload.SPACES_SECRET_ACCESS_KEY) throw new Error('Missing Spaces GitHub secrets.');
  const additions = {
    SPACES_ACCESS_KEY_ID: payload.SPACES_ACCESS_KEY_ID, SPACES_SECRET_ACCESS_KEY: payload.SPACES_SECRET_ACCESS_KEY,
    SPACES_BUCKET: 'ananttattva-crm-files', SPACES_REGION: 'sgp1', SPACES_ENDPOINT: 'https://sgp1.digitaloceanspaces.com',
    SPACES_LINK_SECRET: parsed.SPACES_LINK_SECRET || crypto.randomBytes(32).toString('hex'),
    STORAGE_PUBLIC_API_ORIGIN: parsed.STORAGE_PUBLIC_API_ORIGIN || payload.publicOrigin || 'https://crmananttattva.com'
  };
  const stateDirectory = path.join(app, '.storage-migration/state', delta ? originalInventory || operation === 'copy-originals' ? 'crm-delta-originals' : 'crm-delta' : operation === 'copy-originals' ? 'crm-originals' : 'crm-full');
  fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  const backup = path.join(stateDirectory, 'backend-env.before-storage');
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, original, { mode: 0o600, flag: 'wx' });
  let updated = original;
  for (const [key, value] of Object.entries(additions)) {
    const line = `${key}=${JSON.stringify(value)}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    updated = pattern.test(updated) ? updated.replace(pattern, () => line) : `${updated.trimEnd()}\n${line}\n`;
  }
  fs.writeFileSync(`${envFile}.storage-${process.pid}-tmp`, updated, { mode: 0o600 }); fs.renameSync(`${envFile}.storage-${process.pid}-tmp`, envFile);
  Object.assign(process.env, dotenv.parse(updated));
  const backupPointer = path.join(stateDirectory, 'verified-backup.json');
  const databaseFingerprint = crypto.createHash('sha256').update(`${appRequire('./src/config/db').__test.buildMongoUri()}|${process.env.DB_NAME || 'registerd_types'}`).digest('hex');
  async function takeBackup() {
    const directory = path.join(app, '.storage-migration/backups', new Date().toISOString().replace(/[:.]/g, '-'));
    const inventory = appRequire('./src/services/storageMigration').loadState(path.join(stateDirectory, 'state.json'));
    if (!inventory.discoveryComplete) throw new Error('Complete reference inventory is required before backup.');
    const grouped = {};
    for (const asset of inventory.assets) for (const ref of asset.references || []) {
      grouped[ref.collection] ||= new Map(); grouped[ref.collection].set(appRequire('bson').EJSON.stringify(ref.documentId), ref.documentId);
    }
    const targets = Object.fromEntries(Object.entries(grouped).map(([name, rows]) => [name, [...rows.values()]]));
    const summary = await require('./storage-backup.cjs')(appRequire, directory, targets);
    fs.writeFileSync(backupPointer, JSON.stringify({ directory, databaseFingerprint, completedAt: new Date().toISOString(), ...summary }), { mode: 0o600 });
    console.log(JSON.stringify(summary));
  }
  if (operation === 'backup') { await takeBackup(); return; }
  if (operation === 'copy-originals' && !fs.existsSync(path.join(stateDirectory, 'state.json'))) {
    const migration = appRequire('./src/services/storageMigration');
    const source = migration.loadState(path.join(app, '.storage-migration/state/crm-full/state.json'));
    if (!source.discovery?.complete || source.assets.filter(a => a.kind === 'original').length !== source.discovery.expectedTotal) throw new Error('Complete Cloudinary library discovery is required.');
    source.assets = source.assets.filter(a => a.kind === 'original');
    for (const asset of source.assets) asset.references = [];
    migration.assignKeys(source.assets);
    source.collections = []; source.patches = []; source.discoveryComplete = true; source.originalsOnly = true;
    delete source.mongoReferences; delete source.referenceCollectionsComplete;
    migration.atomicWrite(path.join(stateDirectory, 'state.json'), source);
  }
  if (operation === 'copy' || operation === 'apply' || delta && operation === 'copy-originals') {
    const migration = appRequire('./src/services/storageMigration');
    const originalsFile = path.join(app, '.storage-migration/state', delta ? 'crm-full' : 'crm-originals', 'state.json');
    const fullFile = path.join(stateDirectory, 'state.json');
    if (fs.existsSync(originalsFile) && fs.existsSync(fullFile) && !fs.existsSync(path.join(stateDirectory, 'run.lock'))) {
      const originals = migration.loadState(originalsFile); const full = migration.loadState(fullFile);
      for (const asset of full.assets) {
        const copied = originals.assets.find(other => other.id === asset.id && other.key === asset.key && other.bytes === asset.bytes && other.version === asset.version && other.status === 'verified');
        if (copied) { asset.status = 'verified'; asset.verification = copied.verification; asset.attempts = copied.attempts; }
      }
      migration.atomicWrite(fullFile, full);
    }
  }
  // Preserve other CORS rules; failure does not send new uploads back to Cloudinary.
  try {
    const { S3Client, GetBucketCorsCommand, PutBucketCorsCommand } = appRequire('@aws-sdk/client-s3');
    const client = new S3Client({ endpoint: additions.SPACES_ENDPOINT, region: additions.SPACES_REGION, credentials: { accessKeyId: additions.SPACES_ACCESS_KEY_ID, secretAccessKey: additions.SPACES_SECRET_ACCESS_KEY } });
    let rules = [];
    try { rules = (await client.send(new GetBucketCorsCommand({ Bucket: additions.SPACES_BUCKET }))).CORSRules || []; }
    catch (error) { if (error.name !== 'NoSuchCORSConfiguration' && error.$metadata?.httpStatusCode !== 404) throw error; }
    if (!rules.some(rule => rule.ID === 'crm-direct-uploads')) {
      rules.push({ ID: 'crm-direct-uploads', AllowedOrigins: [new URL(additions.STORAGE_PUBLIC_API_ORIGIN).origin], AllowedMethods: ['PUT', 'GET', 'HEAD'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 600 });
      await client.send(new PutBucketCorsCommand({ Bucket: additions.SPACES_BUCKET, CORSConfiguration: { CORSRules: rules } }));
    }
    console.log(JSON.stringify({ corsConfigured: true }));
  } catch { console.log(JSON.stringify({ corsConfigured: false, sameOriginUploadFallback: true })); }
  // Apply cannot introduce file links before the actual deployed CRM can serve them.
  if (operation === 'apply' || operation === 'restart-apply') {
    const response = await fetch(`${additions.STORAGE_PUBLIC_API_ORIGIN}/api/assets/file?key=invalid&signature=invalid`, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (response.status !== 403 || !(await response.text()).includes('Invalid file link')) throw new Error('Deploy Spaces preview/download routes before applying MongoDB references.');
    if (payload.backupConfirmed !== true) {
      const existing = fs.existsSync(backupPointer) ? JSON.parse(fs.readFileSync(backupPointer, 'utf8')) : null;
      if (!existing?.backupVerified || existing.databaseFingerprint !== databaseFingerprint || Date.now() - new Date(existing.completedAt).getTime() > 12 * 60 * 60 * 1000) await takeBackup();
      else console.log(JSON.stringify({ backupVerified: true, existingSnapshotReused: true }));
    }
  }
  const args = [path.join(backend, 'src/scripts/migrateCloudinaryToSpaces.js'), operation === 'copy-originals' ? 'copy' : operation === 'restart-inventory' ? 'inventory' : operation === 'restart-apply' ? 'apply' : operation, '--run-dir', stateDirectory];
  if (originalInventory) args.push('--originals-only');
  const lockFile = path.join(stateDirectory, 'run.lock');
  if (fs.existsSync(lockFile)) {
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    let active = true; try { process.kill(lock.pid, 0); } catch (error) { if (error.code === 'ESRCH') active = false; else throw error; }
    if (active && (operation === 'restart-inventory' || operation === 'restart-apply')) {
      const command = fs.readFileSync(`/proc/${lock.pid}/cmdline`, 'utf8').split('\0');
      const expectedOperation = operation === 'restart-apply' ? 'apply' : 'inventory';
      if (operation === 'restart-apply') {
        const checkpoint = appRequire('./src/services/storageMigration').loadState(path.join(stateDirectory, 'state.json'));
        if (!fs.existsSync(backupPointer) || !checkpoint.patches.every(patch => patch.documentId && patch.before && patch.after && ['pending', 'applied', 'conflict', 'rolled-back'].includes(patch.status))) throw new Error('Verified backup and valid write-ahead state are required for resume.');
      }
      if (!command.includes(expectedOperation) || !command.includes(stateDirectory) || !command.some(arg => arg.endsWith('/migrateCloudinaryToSpaces.js'))) throw new Error('Refusing to stop a non-inventory process.');
      process.kill(lock.pid, 'SIGTERM');
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 200));
        try { process.kill(lock.pid, 0); } catch (error) { if (error.code === 'ESRCH') { active = false; break; } throw error; }
      }
    }
    if (!active) fs.unlinkSync(lockFile);
    else throw new Error('A previous migration process is still running; do not start a second operator.');
  }
  if ((operation === 'inventory' || operation === 'restart-inventory') && fs.existsSync(path.join(stateDirectory, 'state.json'))) args.push('--resume');
  if (operation !== 'inventory') args.push('--approve-production');
  if (operation === 'copy' || operation === 'copy-originals') args.push('--retry', '--resume');
  if (operation === 'apply' || operation === 'restart-apply') args.push('--backup-confirmed', '--retry');
  console.log(JSON.stringify({ operation, bucket: additions.SPACES_BUCKET, region: additions.SPACES_REGION, secretsConfigured: true }));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: backend, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let pending = '';
    child.stdout.on('data', chunk => {
      pending += chunk.toString(); let index;
      while ((index = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, index); pending = pending.slice(index + 1);
        try { const value = JSON.parse(line); if (value.progress === 'copy') console.log(JSON.stringify({ progress: value.progress, completed: value.completed, queued: value.queued, verified: value.verified, failed: value.failed, missing: value.missing })); else if (value.progress === 'reference-verification') console.log(JSON.stringify({ progress: value.progress, completed: value.completed, queued: value.queued })); else if (value.progress === 'inventory') console.log(JSON.stringify({ progress: value.progress, collectionsComplete: value.collectionsComplete, collectionsTotal: value.collectionsTotal })); } catch {}
      }
    });
    child.stderr.on('data', () => {});
    child.once('error', reject); child.once('close', status => resolve({ status }));
  });
  // Emit aggregate report only; attachment URLs, identifiers and paths remain on the server.
  const reportFile = path.join(stateDirectory, 'report.json');
  if (fs.existsSync(reportFile)) {
    const report = appRequire('bson').EJSON.parse(fs.readFileSync(reportFile, 'utf8'));
    const { files, discoveryErrors, ...summary } = report; console.log(JSON.stringify(summary));
    if (discoveryErrors?.length) {
      let message = String(discoveryErrors.at(-1));
      for (const [name, value] of Object.entries(process.env)) if (/secret|password|key|token/i.test(name) && value.length >= 8) message = message.split(value).join('[redacted]');
      message = message.replace(/https?:\/\/\S+|mongodb(?:\+srv)?:\/\/\S+/g, '[redacted URL]');
      console.log(JSON.stringify({ errorCount: discoveryErrors.length, lastError: message.slice(0, 300) }));
    }
  }
  if (result.status !== 0) throw new Error(`Migration stopped (exit ${result.status}); inspect the protected report on the server.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
