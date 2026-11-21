require('../config/loadEnv')();
const mongoose = require('mongoose');
const fs = require('node:fs/promises');
const path = require('node:path');
const { mongoConfig } = require('../config/mongoConfig');
const { correctMysticalPoAmount } = require('../services/mysticalPoAmountCorrection');
(async () => {
  try {
    const directory = path.resolve(__dirname, '../../../.invoice-correction-backups');
    const marker = path.join(directory, 'mystical-po-40000.completed.json');
    try { await fs.access(marker); console.info('Mystical PO amount correction previously completed.'); return; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const config = mongoConfig();
    await mongoose.connect(config.uri, { dbName: config.dbName, authSource: config.authSource, serverSelectionTimeoutMS: 15000, autoIndex: false });
    const summary = await correctMysticalPoAmount({ Lead: require('../models/Lead'), Approval: require('../models/PendingApproval'), connection: mongoose.connection, backup: async data => {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(directory, `mystical-po-${Date.now()}.json`), JSON.stringify(data), { flag: 'wx', mode: 0o600 });
    } });
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.writeFile(marker, JSON.stringify(summary), { flag: 'wx', mode: 0o600 });
    console.info('Mystical PO amount correction', summary);
  } catch (error) {
    console.error('Mystical PO amount correction failed', { name: error.name, code: error.code, reason: error.name === 'Error' ? error.message : 'Database operation failed' });
    process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
})();
