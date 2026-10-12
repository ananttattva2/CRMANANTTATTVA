// Runs only through the explicit, manually dispatched migration workflow.
// Secret input arrives over SSH stdin, never command arguments or logs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const [appArgument, operation, codeArgument] = process.argv.slice(2);
const app = fs.realpathSync(appArgument);
const code = fs.realpathSync(codeArgument);
const backend = path.join(code, 'backend');
const appRequire = createRequire(path.join(backend, 'package.json'));
const dotenv = appRequire('dotenv');
async function main() {
  if (!['inventory', 'copy', 'apply', 'rollback'].includes(operation)) throw new Error('Invalid operation.');
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
  const stateDirectory = path.join(app, '.storage-migration/state/crm-full');
  fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  const backup = path.join(stateDirectory, 'backend-env.before-storage');
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, original, { mode: 0o600, flag: 'wx' });
  let updated = original;
  for (const [key, value] of Object.entries(additions)) {
    const line = `${key}=${JSON.stringify(value)}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    updated = pattern.test(updated) ? updated.replace(pattern, () => line) : `${updated.trimEnd()}\n${line}\n`;
  }
  fs.writeFileSync(`${envFile}.storage-tmp`, updated, { mode: 0o600 }); fs.renameSync(`${envFile}.storage-tmp`, envFile);
  Object.assign(process.env, dotenv.parse(updated));
  // Apply cannot introduce file links before the actual deployed CRM can serve them.
  if (operation === 'apply') {
    const response = await fetch(`${additions.STORAGE_PUBLIC_API_ORIGIN}/api/assets/file?key=invalid&signature=invalid`, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (response.status !== 403 || !(await response.text()).includes('Invalid file link')) throw new Error('Deploy Spaces preview/download routes before applying MongoDB references.');
    if (payload.backupConfirmed !== true) throw new Error('Atlas backup confirmation is required.');
  }
  const args = [path.join(backend, 'src/scripts/migrateCloudinaryToSpaces.js'), operation, '--run-dir', stateDirectory];
  if (operation === 'inventory' && fs.existsSync(path.join(stateDirectory, 'state.json'))) args.push('--resume');
  if (operation !== 'inventory') args.push('--approve-production');
  if (operation === 'copy') args.push('--retry', '--resume');
  if (operation === 'apply') args.push('--backup-confirmed', '--retry');
  console.log(JSON.stringify({ operation, bucket: additions.SPACES_BUCKET, region: additions.SPACES_REGION, secretsConfigured: true }));
  const result = spawnSync(process.execPath, args, { cwd: backend, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  // Emit aggregate report only; attachment URLs, identifiers and paths remain on the server.
  const reportFile = path.join(stateDirectory, 'report.json');
  if (fs.existsSync(reportFile)) {
    const report = appRequire('bson').EJSON.parse(fs.readFileSync(reportFile, 'utf8'));
    const { files, discoveryErrors, ...summary } = report; console.log(JSON.stringify(summary));
    if (discoveryErrors?.length) console.log(JSON.stringify({ errorCount: discoveryErrors.length }));
  }
  if (result.status !== 0) throw new Error(`Migration stopped (exit ${result.status}); inspect the protected report on the server.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
