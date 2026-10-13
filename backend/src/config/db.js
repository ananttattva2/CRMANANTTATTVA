const mongoose = require('mongoose');
const Quotation = require('../models/Quotation');
const QuotationPiboCategory = require('../models/QuotationPiboCategory');
const ReminderDelivery = require('../models/ReminderDelivery');

mongoose.set('bufferCommands', false);

function buildMongoUri() {
  const srvUri = process.env.MONGO_ATLAS_URI || process.env.MONGO_URI;
  const directHosts = String(process.env.MONGO_DIRECT_HOSTS || '').trim();
  if (!srvUri || !directHosts || !srvUri.startsWith('mongodb+srv://')) return srvUri;

  const parsed = new URL(srvUri);
  const credentials = parsed.username
    ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ''}@`
    : '';
  const params = new URLSearchParams(parsed.search);
  params.set('tls', 'true');
  params.set('authSource', process.env.MONGO_AUTH_SOURCE || params.get('authSource') || 'admin');
  if (process.env.MONGO_REPLICA_SET) params.set('replicaSet', process.env.MONGO_REPLICA_SET);
  params.set('retryWrites', params.get('retryWrites') || 'true');
  params.set('w', params.get('w') || 'majority');
  const dbName = process.env.DB_NAME || parsed.pathname.replace(/^\//, '') || 'registerd_types';
  return `mongodb://${credentials}${directHosts}/${encodeURIComponent(dbName)}?${params.toString()}`;
}

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
    if (!uri) throw new Error('MongoDB Atlas is not configured. Set MONGO_ATLAS_URI or MONGO_URI.');
    await mongoose.connect(uri, {
      dbName: process.env.DB_NAME || 'registerd_types',
      serverSelectionTimeoutMS: 10000,
      compressors: ['zlib'],
      zlibCompressionLevel: 1
    });
    await ensureQuotationIndexes();
    await ensurePiboCategoryIndexes();
    await ReminderDelivery.createIndexes();
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection error', err);
    throw err;
  }
};

module.exports = connectDB;
module.exports.__test = { buildMongoUri };
