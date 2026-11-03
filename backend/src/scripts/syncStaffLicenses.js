require('../config/loadEnv')();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { syncStaffLicenses } = require('../services/staffLicenses');

(async () => {
  try {
    await connectDB();
    const summary = await syncStaffLicenses();
    console.info('Staff license reconciliation', summary);
    if (summary.failed || summary.pending) process.exitCode = 1;
  } catch (error) {
    console.error('Staff license reconciliation failed', { name: error.name, code: error.code });
    process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
})();
