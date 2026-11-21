// Authorized Legal SLA operator; logs aggregate results only, never client lists or credentials.
const { createRequire } = require('node:module');
const path = require('node:path');
const root = path.resolve(process.argv[2] || '.');
const operation = process.argv[3];
if (!['preview', 'send'].includes(operation)) throw new Error('Choose preview or send');
const appRequire = createRequire(path.join(root, 'backend/package.json'));
appRequire('dotenv').config({ path: path.join(root, 'backend/.env'), quiet: true });
const mongoose = appRequire('mongoose');
(async () => {
  try {
    const { mongoConfig } = appRequire('./src/config/mongoConfig');
    const config = mongoConfig();
    await mongoose.connect(config.uri, { dbName: config.dbName, autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
    const provider = appRequire('./src/utils/mailer').getMailDebugConfig();
    console.log(JSON.stringify({ check: 'legal-sla-mail', provider: provider.provider, sender: provider.sender, fromName: 'Krishna Yadav' }));
    const result = await appRequire('./src/services/legalSlaReminders').runLegalSlaReminders({ sendNow: true, dryRun: operation === 'preview' });
    console.log(JSON.stringify({ check: 'legal-sla-result', ...result }));
    if (result.failures) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ check: 'legal-sla-failed', name: error.name, code: error.code || 'FAILED' }));
    process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
})();
