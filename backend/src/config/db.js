const mongoose = require('mongoose');
const Quotation = require('../models/Quotation');
const QuotationPiboCategory = require('../models/QuotationPiboCategory');
const ReminderDelivery = require('../models/ReminderDelivery');

mongoose.set('bufferCommands', false);

const { buildMongoUri, mongoConfig, safeMongoError } = require('./mongoConfig');

async function ensureQuotationIndexes() {
  const collection = mongoose.connection.collection('quotations');
  let indexes = [];
  try {
    indexes = await collection.indexes();
  } catch (err) {
    if (err?.codeName === 'NamespaceNotFound' || err?.code === 26) return;
    throw err;
  }
  const legacyGlobalIndex = indexes.find((index) => (
    index.unique === true
    && Object.keys(index.key || {}).length === 1
    && index.key?.quotationNumber === 1
  ));
  if (legacyGlobalIndex) {
    await collection.dropIndex(legacyGlobalIndex.name);
    console.log('Removed legacy global quotation-number index');
  }
  await Quotation.createIndexes();
}

async function ensurePiboCategoryIndexes() {
  const collection = mongoose.connection.collection('quotationpibocategories');
  let indexes = [];
  try {
    indexes = await collection.indexes();
  } catch (err) {
    if (err?.codeName !== 'NamespaceNotFound' && err?.code !== 26) throw err;
  }
  const legacyNameIndex = indexes.find((index) => index.unique === true && index.key?.name === 1 && Object.keys(index.key || {}).length === 1);
  if (legacyNameIndex) {
    await collection.dropIndex(legacyNameIndex.name);
    console.log('Removed legacy global PIBO category-name index');
  }
  await QuotationPiboCategory.createIndexes();
}

const connectDB = async () => {
  try {
    const uri = buildMongoUri();
    const config = mongoConfig();
    console.info('MongoDB connecting', config.diagnostics);
    await mongoose.connect(uri, {
      dbName: config.dbName,
      authSource: config.authSource,
      serverSelectionTimeoutMS: 10000,
      compressors: ['zlib'],
      zlibCompressionLevel: 1
    });
    await require('../models/LeadRevenue').createIndexes();
    await ensureQuotationIndexes();
    await ensurePiboCategoryIndexes();
    await ReminderDelivery.createIndexes();
    // Add only non-unique read indexes; an unrelated legacy unique-index
    // problem must not prevent the CRM from starting.
    await Promise.all([
      ...[
        { leadCode: 1, createdAt: 1 }, { status: 1, leadCode: 1, createdAt: 1 },
        { createdBy: 1, leadCode: 1, createdAt: 1 }, { generatedForUser: 1, leadCode: 1, createdAt: 1 }
      ].map(keys => mongoose.connection.collection('leads').createIndex(keys)),
      mongoose.connection.collection('pendingapprovals').createIndex({ type: 1, approvalStatus: 1, actionAt: -1, createdAt: -1 }),
      ...[
        ['clients', { createdAt: -1, _id: -1 }],
        ['clients', { createdBy: 1, createdAt: -1, _id: -1 }],
        ['clients', { 'adminControls.approvalStatus': 1, createdAt: -1 }],
        ['quotations', { quotationDate: -1, createdAt: -1 }],
        ['quotations', { createdBy: 1, quotationDate: -1, createdAt: -1 }],
        ['quotations', { 'managementApproval.status': 1, status: 1, createdAt: -1 }],
        ['pendingapprovals', { type: 1, approvalStatus: 1, createdAt: -1 }],
        ['usersessions', { userId: 1, loginAt: -1 }],
        ['auditlogs', { userId: 1, occurredAt: -1 }],
        ['auditlogs', { occurredAt: -1, module: 1, action: 1 }]
      ].map(([collection, keys]) => mongoose.connection.collection(collection).createIndex(keys))
    ]).catch(error => console.error('CRM read index setup failed', { name: error.name, code: error.code }));
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection error', safeMongoError(err));
    throw err;
  }
};

module.exports = connectDB;
module.exports.__test = { buildMongoUri };
