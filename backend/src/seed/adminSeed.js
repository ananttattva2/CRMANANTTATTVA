require('../config/loadEnv')();
const { mongoConfig, safeMongoError } = require('../config/mongoConfig');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Role = require('../models/Role');
const { ROLES } = require('../constants/roles');

async function seed() {
  const config = mongoConfig();
  await mongoose.connect(config.uri, { dbName: config.dbName, authSource: config.authSource });
  console.log('Connected to DB for seeding');

  for (const r of ROLES) {
    await Role.updateOne({ name: r }, { name: r }, { upsert: true });
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD in env');
    process.exit(1);
  }

  let admin = await User.findOne({ email: adminEmail });
  if (!admin) {
    const hash = await bcrypt.hash(adminPassword, 10);
    admin = new User({ name: process.env.ADMIN_NAME || 'System Admin', email: adminEmail, password: hash, role: 'superadmin' });
    await admin.save();
    console.log('Admin user created:', adminEmail);
  } else {
    if (process.env.ADMIN_SYNC_PASSWORD === 'true') {
      admin.password = await bcrypt.hash(adminPassword, 10);
      admin.name = process.env.ADMIN_NAME || admin.name;
      admin.role = 'superadmin';
      admin.isActive = true;
      await admin.save();
      console.log('Admin user synced:', adminEmail);
    } else {
      console.log('Admin already exists');
    }
  }
  process.exit(0);
}

seed().catch(err => { console.error(safeMongoError(err)); process.exit(1); });
