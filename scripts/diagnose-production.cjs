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
if (fs.existsSync(storageState)) {
  const state = JSON.parse(fs.readFileSync(storageState, 'utf8'));
  console.log(JSON.stringify({ check: 'storage-progress', discovered: state.assets?.length || 0, discoveryComplete: !!state.discoveryComplete, discoveryPageComplete: !!state.discovery?.complete, verified: state.assets?.filter(a => a.status === 'verified').length || 0, failed: state.assets?.filter(a => a.status === 'failed').length || 0, missing: state.assets?.filter(a => a.status === 'missing').length || 0, databaseUpdates: state.patches?.filter(p => p.status === 'applied').length || 0 }));
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
