require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const User = require('../models/User');
const { __test: dbTest } = require('../config/db');

const LEAD_CODE = 'ATPL-LEAD-0409';
const COMPANY = 'TATA MOTORS LIMITED';
const CREATOR_NAME = 'GAURAV CHANDRA';
const shouldApply = process.argv.includes('--apply');
const leadCodePattern = /^(?:ATPL-LEAD-|ATPL-)?0*409$/i;

function exactName(value) {
  return new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
}

async function run() {
  const uri = dbTest.buildMongoUri();
  if (!uri) throw new Error('MongoDB connection is not configured.');
  await mongoose.connect(uri, { dbName: process.env.DB_NAME || 'registerd_types', serverSelectionTimeoutMS: 10000 });

  const [leads, creator] = await Promise.all([
    Lead.find({ $or: [{ leadCode: leadCodePattern }, { sourceLeadId: leadCodePattern }, { externalLeadId: leadCodePattern }] }).limit(3),
    User.findOne({ name: exactName(CREATOR_NAME), isActive: { $ne: false } }).select('_id name email').lean()
  ]);
  if (leads.length !== 1) throw new Error(`${LEAD_CODE} resolved to ${leads.length} records; no update was made.`);
  if (!creator) throw new Error(`${CREATOR_NAME} active CRM user was not found.`);
  const lead = leads[0];
  if (String(lead.company || '').trim().toUpperCase() !== COMPANY) {
    throw new Error(`${LEAD_CODE} company mismatch; no update was made.`);
  }

  const summary = { leadCode: lead.leadCode, company: lead.company, currentCreator: lead.createdByName || lead.importedCreatedBy || String(lead.createdBy || ''), targetCreator: creator.name, dryRun: !shouldApply };
  if (!shouldApply) return console.log(JSON.stringify(summary, null, 2));

  lead.createdBy = creator._id;
  lead.createdByCrmUserId = String(creator._id);
  lead.createdByName = creator.name;
  lead.createdByEmail = String(creator.email || '').toLowerCase();
  lead.importedCreatedBy = creator.name;
  await lead.save();
  console.log(JSON.stringify({ ...summary, dryRun: false, updated: true }, null, 2));
}

run().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
