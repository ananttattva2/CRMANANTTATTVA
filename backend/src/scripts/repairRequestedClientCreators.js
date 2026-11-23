require('../config/loadEnv')();
const mongoose = require('mongoose');
const fs = require('node:fs/promises');
const path = require('node:path');
const { mongoConfig } = require('../config/mongoConfig');
(async () => {
  try {
    const directory = path.resolve(__dirname, '../../../.invoice-correction-backups'), marker = path.join(directory, 'requested-client-creators-krishna.completed.json');
    try { await fs.access(marker); console.info('Requested client creator correction previously completed.'); return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const config = mongoConfig();
    await mongoose.connect(config.uri, { dbName: config.dbName, authSource: config.authSource, serverSelectionTimeoutMS: 15000, autoIndex: false });
    const result = await require('../services/requestedClientCreators').correctRequestedClientCreators({ User: require('../models/User'), Lead: require('../models/Lead'), Client: require('../models/Client'), Approval: require('../models/PendingApproval'), connection: mongoose.connection, backup: async data => {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(directory, `requested-client-creators-${Date.now()}.json`), JSON.stringify(data), { flag: 'wx', mode: 0o600 });
    } });
    await fs.writeFile(marker, JSON.stringify(result), { flag: 'wx', mode: 0o600 });
    console.info('Requested client creator correction', JSON.stringify(result));
  } catch (error) { console.error('Requested client creator correction failed', { name: error.name, code: error.code }); process.exitCode = 1; }
  finally { await mongoose.disconnect(); }
})();
