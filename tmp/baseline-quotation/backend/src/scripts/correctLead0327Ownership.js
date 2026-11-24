require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const User = require('../models/User');
const { __test: dbTest } = require('../config/db');

const LEAD_CODE = 'ATPL-LEAD-0327';
const CREATOR_NAME = 'GAURAV CHANDRA';
const OWNER_NAME = 'ANAND PADHYA';
const shouldApply = process.argv.includes('--apply');
const legacyLeadCode = /^(?:ATPL-LEAD-|ATPL-)?0*327$/i;

function exactName(value) {
  return new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
}

async function run() {
  const uri = dbTest.buildMongoUri();
  if (!uri) throw new Error('MongoDB connection is not configured.');
  await mongoose.connect(uri, { dbName: process.env.DB_NAME || 'registerd_types', serverSelectionTimeoutMS: 10000 });

  const [leadCandidates, creator, owner] = await Promise.all([
    Lead.find({
      $or: [
        { leadCode: legacyLeadCode },
        { leadNumber: legacyLeadCode },
        { sourceLeadId: legacyLeadCode },
        { externalLeadId: legacyLeadCode }
      ]
    }).limit(3),
    User.findOne({ name: exactName(CREATOR_NAME), isActive: { $ne: false } }).select('_id name email').lean(),
    User.findOne({ name: exactName(OWNER_NAME), isActive: { $ne: false } }).select('_id name email').lean()
  ]);
  if (!leadCandidates.length) throw new Error(`${LEAD_CODE} (including legacy stored formats) was not found.`);
  if (leadCandidates.length > 1) throw new Error(`${LEAD_CODE} resolved to multiple records; no update was made.`);
  const lead = leadCandidates[0];
  if (!creator) throw new Error(`${CREATOR_NAME} active CRM user was not found.`);
  if (!owner) throw new Error(`${OWNER_NAME} active CRM user was not found.`);

  const summary = {
    leadCode: lead.leadCode,
    company: lead.company,
    currentCreator: lead.createdByName || lead.importedCreatedBy || String(lead.createdBy || ''),
    targetCreator: creator.name,
    targetOtherUserOwner: owner.name,
    serviceCount: Array.isArray(lead.serviceSelections) ? lead.serviceSelections.length : 0,
    dryRun: !shouldApply
  };
  if (!shouldApply) return console.log(JSON.stringify(summary, null, 2));

  lead.createdBy = creator._id;
  lead.createdByCrmUserId = String(creator._id);
  lead.createdByName = creator.name;
  lead.createdByEmail = String(creator.email || '').toLowerCase();
  lead.importedCreatedBy = creator.name;
  lead.generatedForUser = owner._id;
  lead.generatedForName = owner.name;
  lead.generatedForEmail = String(owner.email || '').toLowerCase();
  lead.serviceSelections = (lead.serviceSelections || []).map((service) => ({
    ...service,
    createdByCrmUserId: String(owner._id),
    createdByName: owner.name,
    createdByEmail: String(owner.email || '').toLowerCase()
  }));
  lead.markModified('serviceSelections');
  await lead.save();
  console.log(JSON.stringify({ ...summary, dryRun: false, updated: true }, null, 2));
}

run().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
