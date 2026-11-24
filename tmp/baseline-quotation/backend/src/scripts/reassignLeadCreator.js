require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const mongoose = require('mongoose');
const User = require('../models/User');
const Lead = require('../models/Lead');
const { __test: dbTest } = require('../config/db');

const FROM_NAME = 'PRACHI CHAVAN';
const TO_NAME = 'GAURAV CHANDRA';
const shouldApply = process.argv.includes('--apply');

function exactName(name) {
  return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
}

async function run() {
  const uri = dbTest.buildMongoUri();
  if (!uri) throw new Error('MongoDB connection is not configured.');

  await mongoose.connect(uri, { dbName: process.env.DB_NAME || 'registerd_types', serverSelectionTimeoutMS: 10000 });
  const [fromUser, toUser] = await Promise.all([
    User.findOne({ name: exactName(FROM_NAME) }).select('_id name email crmUserId').lean(),
    User.findOne({ name: exactName(TO_NAME) }).select('_id name email crmUserId isActive').lean()
  ]);
  if (!fromUser) throw new Error(`CRM user ${FROM_NAME} was not found.`);
  if (!toUser) throw new Error(`CRM user ${TO_NAME} was not found.`);
  if (toUser.isActive === false) throw new Error(`${TO_NAME} is inactive and cannot own leads.`);

  const ownerQuery = {
    $or: [
      { createdBy: fromUser._id },
      { createdByCrmUserId: String(fromUser._id) },
      { createdByName: exactName(FROM_NAME) },
      { createdByEmail: String(fromUser.email || '').toLowerCase() },
      { importedCreatedBy: exactName(FROM_NAME) }
    ]
  };
  const affected = await Lead.find(ownerQuery).select('_id leadCode company').lean();
  const summary = { from: FROM_NAME, to: TO_NAME, affectedLeadCount: affected.length, leadCodes: affected.map((lead) => lead.leadCode || String(lead._id)) };

  if (!shouldApply) {
    console.log(JSON.stringify({ ...summary, dryRun: true }, null, 2));
    return;
  }

  const result = await Lead.updateMany(ownerQuery, {
    $set: {
      createdBy: toUser._id,
      createdByCrmUserId: String(toUser._id),
      createdByName: toUser.name,
      createdByEmail: String(toUser.email || '').toLowerCase(),
      importedCreatedBy: toUser.name
    }
  });
  console.log(JSON.stringify({ ...summary, dryRun: false, matched: result.matchedCount, modified: result.modifiedCount }, null, 2));
}

run()
  .catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
