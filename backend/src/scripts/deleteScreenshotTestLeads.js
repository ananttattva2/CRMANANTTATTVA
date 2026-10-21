require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env'), quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const TemporaryLead = require('../models/TemporaryLead');
const { __test: { buildMongoUri } } = require('../config/db');
// Exact records identified in the two screenshots supplied on 2026-10-21.
const TARGETS = [
  { type: 'lead', code: 'ATPL-LEAD-0398', company: '22' },
  { type: 'lead', code: 'ATPL-LEAD-0402', company: 'AAA' },
  { type: 'lead', code: 'ATPL-LEAD-0403', company: '2222' },
  { type: 'lead', code: 'ATPL-LEAD-0404', company: '223' },
  { type: 'lead', code: 'ATPL-LEAD-0406', company: 'aaa344' },
  { type: 'lead', code: 'ATPL-LEAD-0456', company: 'xxyy' },
  { type: 'temporary', code: 'ATPL-TEMP-0042', company: 'test' },
  { type: 'temporary', code: 'ATPL-TEMP-0015', company: 'xyz' },
  { type: 'temporary', code: 'ATPL-TEMP-0002', company: 'test2' },
  { type: 'temporary', code: 'ATPL-TEMP-0001', company: 'test\\' }
];
const normalize = value => String(value || '').trim().toLowerCase();
function validateTarget(target, rows) {
  if (rows.length !== 1) throw new Error(`${target.code}: expected one exact record, found ${rows.length}.`);
  const row = rows[0];
  const company = target.type === 'lead' ? row.company : row.clientName;
  if (normalize(company) !== normalize(target.company)) throw new Error(`${target.code}: company mismatch (${company}). No records changed.`);
  if (target.type === 'temporary' && row.status !== 'DRAFT') throw new Error(`${target.code}: temporary lead is no longer a draft.`);
  return row;
}
async function refreshCacheAndVerify() {
  // Local cache settings may be disabled while production Redis is enabled.
  // Bump the shared Mongo revision directly for every deployed namespace.
  const { randomUUID } = require('node:crypto');
  const revisions = mongoose.connection.collection('crm_cache_revisions');
  const update = { $set: { revision: randomUUID(), updatedAt: new Date() } };
  await revisions.updateMany({}, update, { maxTimeMS: 10000, writeConcern: { w: 'majority' } });
  await revisions.updateOne({ _id: String(process.env.REDIS_CACHE_PREFIX || 'crm:production:v1').trim() }, update, { upsert: true, maxTimeMS: 10000, writeConcern: { w: 'majority' } });
  const remainingLeads = await Lead.countDocuments({ leadCode: { $in: TARGETS.filter(t => t.type === 'lead').map(t => t.code) } });
  const remainingTemporary = await TemporaryLead.countDocuments({ tempLeadCode: { $in: TARGETS.filter(t => t.type === 'temporary').map(t => t.code) } });
  if (remainingLeads || remainingTemporary) throw new Error('Post-deletion verification failed. Check the backup and target records.');
  return { remainingLeads, remainingTemporary, cacheInvalidated: true };
}
async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(buildMongoUri(), { dbName: process.env.DB_NAME || 'registerd_types', serverSelectionTimeoutMS: 12000, autoIndex: false });
  if (process.argv.includes('--verify')) return console.log(JSON.stringify(await refreshCacheAndVerify(), null, 2));
  const records = [];
  for (const target of TARGETS) {
    const collection = target.type === 'lead' ? Lead.collection : TemporaryLead.collection;
    const field = target.type === 'lead' ? 'leadCode' : 'tempLeadCode';
    const rows = await collection.find({ [field]: target.code }).toArray();
    const record = validateTarget(target, rows);
    records.push({ ...target, record });
  }
  console.log(JSON.stringify({ dryRun: !apply, targets: records.map(({ type, code, record }) => ({ type, code, company: record.company || record.clientName, alreadyDeleted: Boolean(record.deletedAt) })) }, null, 2));
  if (!apply) return;
  const backupDir = path.resolve(__dirname, '../../storage-migration-output/lead-cleanup');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `screenshot-leads-${Date.now()}.ejson`);
  fs.writeFileSync(backupPath, mongoose.mongo.BSON.EJSON.stringify({ reason: 'User requested deletion of records in two screenshots', records }, { relaxed: false }), { flag: 'wx' });
  const session = await mongoose.startSession();
  let deletedLeads = 0, deletedTemporary = 0;
  try {
    await session.withTransaction(async () => {
      deletedLeads = 0; deletedTemporary = 0;
      for (const target of records) {
        const { record } = target;
        const collection = target.type === 'lead' ? Lead.collection : TemporaryLead.collection;
        const field = target.type === 'lead' ? 'leadCode' : 'tempLeadCode';
        const current = await collection.find({ _id: record._id, [field]: target.code }, { session }).toArray();
        validateTarget(target, current);
        if (String(current[0].updatedAt || '') !== String(record.updatedAt || '')) throw new Error(`${target.code}: record changed since backup.`);
        if (target.type === 'lead') {
          // Match the application's existing reversible Lead deletion behavior.
          const result = await collection.updateOne({ _id: record._id, [field]: target.code, deletedAt: null, updatedAt: record.updatedAt }, { $set: { deletedAt: new Date(), recordStatus: 'DELETED' } }, { session });
          deletedLeads += result.modifiedCount;
        } else {
          // TemporaryLead has no soft-delete visibility support. Preserve its
          // complete BSON backup before removing this exact draft document.
          const result = await collection.deleteOne({ _id: record._id, [field]: target.code, status: 'DRAFT', updatedAt: record.updatedAt }, { session });
          if (result.deletedCount !== 1) throw new Error(`${target.code}: draft changed during cleanup.`);
          deletedTemporary += result.deletedCount;
        }
      }
    });
  } finally { await session.endSession(); }
  const verification = await refreshCacheAndVerify();
  console.log(JSON.stringify({ deletedLeads, deletedTemporary, backupPath, ...verification }, null, 2));
}
module.exports = { TARGETS, validateTarget };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
