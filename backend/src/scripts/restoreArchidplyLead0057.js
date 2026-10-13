const path = require('node:path');
const args = process.argv.slice(2);
const envIndex = args.indexOf('--env');
require('dotenv').config({ path: envIndex >= 0 ? args[envIndex + 1] : path.resolve(__dirname, '../../.env'), quiet: true });
const mongoose = require('mongoose');
const { __test: dbTest } = require('../config/db');
const { restoreArchidplyLead } = require('../services/restoreArchidplyLead');
async function run() {
  const uri = dbTest.buildMongoUri();
  if (!uri) throw new Error('MongoDB connection is not configured.');
  await mongoose.connect(uri, { dbName: process.env.DB_NAME || 'registerd_types', serverSelectionTimeoutMS: 10000, autoIndex: false, autoCreate: false });
  console.log(JSON.stringify(await restoreArchidplyLead(mongoose.connection.db, { apply: args.includes('--apply') }), null, 2));
}
run().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
