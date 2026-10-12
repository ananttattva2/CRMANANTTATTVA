// Read-only runtime diagnostics. Never print environment values, tokens or documents.
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const root = path.resolve(process.argv[2] || '.');
const backend = path.join(root, 'backend');
const appRequire = createRequire(path.join(backend, 'package.json'));
appRequire('dotenv').config({ path: path.join(backend, '.env'), quiet: true });
// Presence checks only: never reveal secret values or attachment URLs in Actions logs.
console.log(JSON.stringify({ check: 'storage-configuration', configured: Object.fromEntries([
  'SPACES_ACCESS_KEY_ID', 'SPACES_SECRET_ACCESS_KEY', 'SPACES_LINK_SECRET',
  'STORAGE_PUBLIC_API_ORIGIN', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'
].map(name => [name, Boolean(process.env[name])])), migrationInstalled: fs.existsSync(path.join(backend, 'src/scripts/migrateCloudinaryToSpaces.js')) }));
const storageState = path.join(root, '.storage-migration/state/crm-full/state.json');
let inventoryCollection;
if (fs.existsSync(storageState)) {
  const state = JSON.parse(fs.readFileSync(storageState, 'utf8'));
  console.log(JSON.stringify({ check: 'storage-phase', phase: state.phase || 'inventory', checkpointBytes: fs.statSync(storageState).size, patchJournalBytes: fs.existsSync(path.join(path.dirname(storageState), 'patch-journal.jsonl')) ? fs.statSync(path.join(path.dirname(storageState), 'patch-journal.jsonl')).size : 0 }));
  inventoryCollection = state.collections?.find(name => !(state.referenceCollectionsComplete || []).includes(name));
  console.log(JSON.stringify({ check: 'storage-progress', discovered: state.assets?.length || 0, discoveryComplete: !!state.discoveryComplete, discoveryPageComplete: !!state.discovery?.complete, collectionsScanned: state.referenceCollectionsComplete?.length || 0, collectionsTotal: state.collections?.length || 0, verified: state.assets?.filter(a => a.status === 'verified').length || 0, failed: state.assets?.filter(a => a.status === 'failed').length || 0, missing: state.assets?.filter(a => a.status === 'missing').length || 0, databaseUpdates: state.patches?.filter(p => p.status === 'applied').length || 0 }));
}
const originalsState = path.join(root, '.storage-migration/state/crm-originals/state.json');
if (fs.existsSync(originalsState)) {
  const state = JSON.parse(fs.readFileSync(originalsState, 'utf8'));
  const errors = {};
  for (const asset of state.assets || []) if (asset.error) {
    const category = asset.error.match(/^Cloudinary download HTTP \d+/)?.[0] || asset.error.match(/^Transfer failed \([A-Za-z0-9]+(?: HTTP \d+)?\)/)?.[0] || 'File verification/transfer failed';
    errors[category] = (errors[category] || 0) + 1;
  }
  console.log(JSON.stringify({ check: 'originals-copy-progress', total: state.assets?.length || 0, verified: state.assets?.filter(a => a.status === 'verified').length || 0, failed: state.assets?.filter(a => a.status === 'failed').length || 0, missing: state.assets?.filter(a => a.status === 'missing').length || 0, errorCategories: errors }));
}
const storageLock = path.join(root, '.storage-migration/state/crm-full/run.lock');
if (fs.existsSync(storageLock)) {
  const lock = JSON.parse(fs.readFileSync(storageLock, 'utf8')); let active = true;
  try { process.kill(lock.pid, 0); } catch (error) { if (error.code === 'ESRCH') active = false; }
  console.log(JSON.stringify({ check: 'storage-lock', active }));
  if (active) {
    const processInfo = spawnSync('ps', ['-o', 'etime=,pcpu=,rss=', '-p', String(lock.pid)], { encoding: 'utf8' });
    console.log(JSON.stringify({ check: 'storage-process', usage: processInfo.stdout.trim() }));

  }
}
const mongoose = appRequire('mongoose');
const report = (value) => console.log(JSON.stringify(value));
async function measure(name, run) {
  const start = Date.now();
  try { const result = await run(); report({ check: name, ms: Date.now() - start, ...result }); }
  catch (error) { report({ check: name, ms: Date.now() - start, error: error.name, code: error.code }); }
}
(async () => {
  try {
    await measure('spaces-bucket-access', async () => {
      const directory = path.join(root, '.storage-migration/code');
      const staged = fs.readdirSync(directory).sort((a, b) => fs.statSync(path.join(directory, b)).mtimeMs - fs.statSync(path.join(directory, a)).mtimeMs)[0];
      const stagingRequire = createRequire(path.join(directory, staged, 'backend/package.json'));
      const { S3Client, HeadBucketCommand } = stagingRequire('@aws-sdk/client-s3');
      const client = new S3Client({ endpoint: process.env.SPACES_ENDPOINT, region: process.env.SPACES_REGION, credentials: { accessKeyId: process.env.SPACES_ACCESS_KEY_ID, secretAccessKey: process.env.SPACES_SECRET_ACCESS_KEY } });
      await client.send(new HeadBucketCommand({ Bucket: process.env.SPACES_BUCKET }));
      return { accessible: true };
    });
    if (fs.existsSync(originalsState) && fs.existsSync(path.join(backend, 'src/services/spacesStorage.js'))) await measure('spaces-live-preview-download', async () => {
      const migration = appRequire('./src/services/storageMigration'); const storage = appRequire('./src/services/spacesStorage');
      const state = migration.loadState(originalsState); const verified = state.assets.filter(asset => asset.status === 'verified');
      const samples = ['pdf', 'png', 'jpg'].map(format => verified.find(asset => asset.format === format)).filter(Boolean);
      const checks = [];
      for (const asset of samples) {
        const response = await fetch(storage.fileUrl(asset.key), { signal: AbortSignal.timeout(45000) });
        if (!response.ok) throw new Error('Live preview/download request failed.');
        const digest = await migration.digestStream(require('node:stream').Readable.fromWeb(response.body));
        migration.verified(asset.verification, digest);
        checks.push({ format: asset.format, status: response.status, checksumVerified: true });
      }
      return { samples: checks };
    });
    for (const logPath of ['/var/log/nginx/access.log', '/var/log/nginx/error.log']) {
      if (!fs.existsSync(logPath)) continue;
      const fd = fs.openSync(logPath, 'r'); const length = fs.fstatSync(fd).size;
      const buffer = Buffer.alloc(Math.min(length, 512 * 1024));
      fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, length - buffer.length)); fs.closeSync(fd);
      const lines = buffer.toString().split('\n').slice(-1000);
      if (logPath.endsWith('access.log')) {
        const totals = {}; const latest = {};
        for (const line of lines) {
          const match = line.match(/"(?:GET|POST|PUT|PATCH|DELETE) (\/api\/[^ ?"]+)[^"]*" (\d{3}) /);
          if (!match) continue;
          const route = match[1].split('/').slice(0, 4).join('/').replace(/\/[a-f0-9]{24}/gi, '/:id');
          const label = `${route}:${match[2]}`; totals[label] = (totals[label] || 0) + 1;
          latest[route] = { status: Number(match[2]), at: line.match(/\[([^\]]+)\]/)?.[1] };
        }
        report({ check: 'recent-http-statuses', counts: totals, latest });
      } else report({ check: 'proxy-errors', counts: Object.fromEntries(['upstream timed out', 'connect() failed', 'upstream prematurely closed', 'upstream sent too big header'].map((name) => [name, lines.filter((line) => line.includes(name)).length])) });
    }
    const processList = spawnSync('pm2', ['jlist'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    if (processList.status === 0) {
      for (const process of JSON.parse(processList.stdout)) {
        if (!String(process.name).includes('crm')) continue;
        report({ check: 'process', name: process.name, status: process.pm2_env?.status, restarts: process.pm2_env?.restart_time, memoryMB: Math.round((process.monit?.memory || 0) / 1048576) });
        const logPath = process.pm2_env?.pm_err_log_path;
        if (logPath && fs.existsSync(logPath)) {
          const fd = fs.openSync(logPath, 'r');
          const length = fs.fstatSync(fd).size;
          const buffer = Buffer.alloc(Math.min(length, 128 * 1024));
          fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, length - buffer.length)); fs.closeSync(fd);
          const log = buffer.toString();
          report({ check: 'recent-error-types', counts: Object.fromEntries(['MongoServerSelectionError', 'MongoNetworkError', 'MongoPoolClearedError', 'MongooseError', 'MongoServerError', 'CastError', 'ReferenceError', 'TypeError', 'overall-dashboard'].map((name) => [name, log.split(name).length - 1])) });
        }
      }
    }
    await mongoose.connect(appRequire('./src/config/db').__test.buildMongoUri(), { dbName: process.env.DB_NAME || 'registerd_types', autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
    if (inventoryCollection) await measure('inventory-current-collection', async () => ({ collection: inventoryCollection, estimatedDocuments: await mongoose.connection.db.collection(inventoryCollection).estimatedDocumentCount({ maxTimeMS: 10000 }) }));
    await measure('authentication-user-query', async () => ({ found: Boolean(await appRequire('./src/models/User').findOne({ isActive: { $ne: false } }).select('_id').maxTimeMS(10000).lean()) }));
    await measure('reminder-scan', async () => {
      const rows = await appRequire('./src/services/leadWorkflowReminders').__test.getCcpLeads();
      return { leads: rows.length, payloadKB: Math.round(Buffer.byteLength(JSON.stringify(rows)) / 1024) };
    });
    await measure('overall-dashboard', async () => {
      const { loadOverallRecords } = appRequire('./src/services/overallDashboardData');
      const { buildOverall } = appRequire('./src/services/overallDashboard');
      const { buildUserSections } = appRequire('./src/services/overallDashboardUsers');
      const [records, users, teams, requests] = await Promise.all([
        loadOverallRecords(appRequire('./src/models/Lead'), {}, null),
        appRequire('./src/models/User').find({ isActive: { $ne: false } }).select('_id crmUserId name email role roles managerId teamId').maxTimeMS(10000).lean(),
        appRequire('./src/models/Team').find({}).select('_id manager members').maxTimeMS(10000).lean(),
        appRequire('./src/models/ClientDeactivation').find({ status: 'INACTIVE' }).select('companyKey status').maxTimeMS(10000).lean()
      ]);
      const result = buildOverall(records, requests);
      return { closedRecords: records.length, clients: result.portfolioSummary.clients, users: buildUserSections(records, requests, users, teams).length };
    });
  } catch (error) { report({ check: 'connection', error: error.name, code: error.code }); process.exitCode = 1; }
  finally { await mongoose.disconnect(); }
})();
