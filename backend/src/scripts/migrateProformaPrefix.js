require('../config/loadEnv')();
const mongoose = require('mongoose');
const fs = require('node:fs/promises');
const path = require('node:path');
const { mongoConfig } = require('../config/mongoConfig');
const { migrateProformaPrefix } = require('../services/proformaPrefixMigration');
(async () => {
  try {
    const config = mongoConfig();
    await mongoose.connect(config.uri, { dbName: config.dbName, authSource: config.authSource, serverSelectionTimeoutMS: 15000, autoIndex: false });
    const summary = await migrateProformaPrefix({ Model: require('../models/ProformaInvoice'), connection: mongoose.connection, backup: async rows => {
      const directory = path.resolve(__dirname, '../../../.invoice-correction-backups');
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(directory, `proforma-atpi-prefix-${Date.now()}.json`), JSON.stringify(rows), { flag: 'wx', mode: 0o600 });
    } });
    console.info('Proforma ATPI prefix migration', JSON.stringify(summary));
  } catch (error) {
    console.error('Proforma prefix migration failed', { name: error.name, code: error.code });
    process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
})();
