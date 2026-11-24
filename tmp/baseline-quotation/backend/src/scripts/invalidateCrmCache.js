require('dotenv').config({ override: true });
const mongoose = require('mongoose');
const { getCrmCache } = require('../services/crmCache');
async function main() {
  const { buildMongoUri } = require('../config/db').__test;
  await mongoose.connect(buildMongoUri(), { dbName: process.env.DB_NAME || 'registerd_types', serverSelectionTimeoutMS: 10000 });
  const revision = await getCrmCache().invalidate();
  if (!revision) throw new Error('Cache invalidation did not complete. Check MongoDB and Redis configuration.');
  console.log('CRM cache revision changed. Next requests will load current data.');
}
main().catch(error => { console.error('Cache invalidation failed:', error.name); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
