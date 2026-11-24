require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Lead = require('../models/Lead');
const User = require('../models/User');

const LEAD_CODE = 'ATPL-LEAD-0327';

async function findActiveUser(name) {
  const user = await User.findOne({ name: new RegExp(`^${name}$`, 'i'), isActive: { $ne: false } }).lean();
  if (!user) throw new Error(`Active CRM user not found: ${name}`);
  return user;
}

async function run() {
  await connectDB();
  const [creator, assigner] = await Promise.all([
    findActiveUser('GAURAV CHANDRA'),
    findActiveUser('ANAND PADHYA')
  ]);
  const lead = await Lead.findOne({ leadCode: LEAD_CODE });
  if (!lead) throw new Error(`${LEAD_CODE} was not found`);
  if (String(lead.company || '').trim().toUpperCase() !== 'SD INTERNATIONAL') {
    throw new Error(`${LEAD_CODE} company mismatch; refusing to update`);
  }

  lead.createdBy = creator._id;
  lead.createdByCrmUserId = String(creator._id);
  lead.createdByName = creator.name;
  lead.createdByEmail = creator.email;
  lead.importedCreatedBy = creator.name;
  lead.assignedBy = assigner.name;
  await lead.save();
  console.log(JSON.stringify({
    ok: true,
    leadCode: lead.leadCode,
    company: lead.company,
    createdBy: creator.name,
    assignedBy: assigner.name
  }));
}

run()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
