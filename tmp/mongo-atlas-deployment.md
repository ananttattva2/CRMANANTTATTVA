# MongoDB fix review and deployment

## Findings

Confirmed in local source: db.js rewrites every SRV URI when MONGO_DIRECT_HOSTS is present. This is not a failure-only fallback. New credentials can therefore be sent to the old cluster. MONGO_REPLICA_SET is also injected. A manual MongoClient SRV ping bypasses this behavior. MONGO_ATLAS_URI additionally takes precedence over MONGO_URI in the old code.

index.js already uses dotenv override:true, so stale PM2 MONGO_URI alone does not explain the failure if the correct .env is loaded. Its default dotenv path depends on cwd. The seed script uses different loading and connection rules. Both entrypoints now use backend/.env with override:true and shared connection configuration. Variables absent from .env remain inherited; the diagnostic reports differences without showing values.

The 503 response quoted by the user comes from the global /api database readiness gate before requestOtp runs. requestOtp subsequently reads User and saves OTP state using the shared Mongoose connection. Application models use that default connection. The fix uses MONGO_URI first, passes it unchanged to the driver, ignores legacy host/replica-set environment overrides, selects DB_NAME or URI database or crm, and defaults authentication to admin. Explicit URI authSource takes priority over the environment.

Connection attempts are shared across simultaneous requests; routes await connection/index initialization. Startup services remain chained after successful initialization. Error metadata is allowlisted, with no raw driver messages or URI. No credentials, dependencies, schemas, or OTP behavior were changed.

## Validation and limitations

20 selected tests passed: configuration/readiness, auth database failure, backup safety, and client portal regression tests. The HTTP test initially hit sandbox localhost EACCES and passed with localhost access. Syntax and whitespace checks passed.

Production PM2 configuration, environment, collection contents, login and email delivery have not been inspected or verified. No production connection, deployment, restart, seed, migration, data write, or credential change was performed. Read-only diagnostic deliberately imports neither models nor the server, so it cannot trigger automatic indexes or startup jobs.

Existing startup behavior remains: quotation/PIBO legacy index reconciliation, guarded known-data correction, reminder reconciliation and notification schedulers. A normal production restart can execute these pre-existing jobs. Diagnostic commands do not execute them. No additional correction or reseed is required for this fix.

## Deploy only after approval

Do not push main merely to stage this fix: the repository has a push-triggered production workflow. The patch contains only reviewed source/test files, no .env. Supply the actual SSH destination below; no production SSH host/user was supplied in this chat.

From local PowerShell, after approval:

```powershell
$productionSsh = 'USER@SERVER_IP'
scp 'C:\Users\Client\Desktop\CRM_V3\CRM_1\tmp\mongo-atlas-fix.patch' "${productionSsh}:/tmp/mongo-atlas-fix.patch"
ssh $productionSsh
```

On Ubuntu, as the existing PM2 owner (do not use a different user's PM2 daemon):

```bash
set -euo pipefail
cd /var/www/CRMANANTTATTVA
git apply --check /tmp/mongo-atlas-fix.patch
backup_dir=$(mktemp -d /var/tmp/crm-mongo-fix.XXXXXX)
chmod 700 "$backup_dir"
tar -czf "$backup_dir/backend-code.tgz" backend/src/config backend/src/index.js backend/src/seed/adminSeed.js backend/src/scripts backend/test/dbConfig.test.js
git apply /tmp/mongo-atlas-fix.patch
cd backend
node --check src/index.js
node --test test/dbConfig.test.js test/authDatabaseFailure.test.js test/storageBackup.test.js
backend_pid=$(pm2 pid crm-backend)
if [[ "$backend_pid" =~ ^[1-9][0-9]*$ ]]; then
  node src/scripts/checkMongoConnection.js --pid="$backend_pid"
else
  node src/scripts/checkMongoConnection.js
fi
```

STOP unless ping is ok, database is crm, expected collections exist and are readable, and required business collections contain the expected migrated records. hasDocuments confirms presence only, not migration completeness. If the target differs, the diagnostic refuses to connect. Do not run seed-admin. Do not print .env, pm2 env, pm2 jlist, or raw connection errors. If git apply --check fails, review the deployed code difference before continuing; do not force apply.

Only after successful diagnostics and restart approval:

```bash
cd /var/www/CRMANANTTATTVA/backend
pm2 restart crm-backend --update-env
curl --fail --silent --show-error http://127.0.0.1:4000/api/health
curl --fail --silent --show-error https://crmananttattva.com/api/health
curl --silent --show-error -X POST https://crmananttattva.com/api/auth/request-otp \
  -H 'Content-Type: application/json' --data '{}'
```

The empty-body OTP probe should return 400 Email required, proving the global DB gate passes without changing a user or sending email. Actual OTP delivery and verification still require a controlled login by the account owner. A successful health response alone does not verify email delivery. Avoid sharing historical PM2 logs, which may contain raw errors from the previous code. After confirming stable operation, run `pm2 save` under the same PM2 owner.

Rollback code, only with approval for the consequent restart: restore the code archive from the displayed backup_dir and remove only the four new files listed in the patch after verifying they did not exist before this deployment. Do not restore an old .env or reconnect to the old Atlas cluster. An old-code rollback would re-enable legacy host overrides, so prefer fixing forward after reviewing diagnostics.
