require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const mongoose = require('mongoose');
const Quotation = require('../models/Quotation');
const ProformaInvoice = require('../models/ProformaInvoice');
const Notification = require('../models/Notification');
const { __test: dbTest } = require('../config/db');

const MIN_START = 313;
const shouldApply = process.argv.includes('--apply');

function parseNumber(quotationNumber = '') {
  const parts = String(quotationNumber || '').split('/');
  if (parts.length !== 3) return null;
  const [prefix, fy, suffix] = parts;
  if (prefix.toUpperCase() !== 'AT') return null;
  if (!/^\d{2}-\d{2}$/.test(fy)) return null;
  const num = Number.parseInt(suffix, 10);
  if (!Number.isFinite(num)) return null;
  return { prefix, fy, num, raw: quotationNumber };
}

function buildNumber(prefix, fy, num) {
  return `${prefix}/${fy}/${String(num).padStart(3, '0')}`;
}

async function run() {
  const uri = dbTest.buildMongoUri();
  if (!uri) throw new Error('MongoDB connection is not configured.');

  await mongoose.connect(uri, {
    dbName: process.env.DB_NAME || 'registerd_types',
    serverSelectionTimeoutMS: 15000
  });

  const allQuotes = await Quotation.find({})
    .select('_id quotationNumber leadId createdAt quotationDate revisionHistory')
    .sort({ createdAt: 1, quotationNumber: 1 })
    .lean();

  const byFinancialYear = new Map();
  for (const quote of allQuotes) {
    const parsed = parseNumber(quote.quotationNumber);
    if (!parsed) continue;
    if (!byFinancialYear.has(parsed.fy)) byFinancialYear.set(parsed.fy, []);
    byFinancialYear.get(parsed.fy).push({ quote, parsed });
  }

  const summary = {
    financialYears: [],
    totalRenumbered: 0,
    proformaUpdated: 0,
    notificationsUpdated: 0,
    dryRun: !shouldApply
  };

  for (const [fy, entries] of byFinancialYear.entries()) {
    const below = entries.filter((e) => e.parsed.num < MIN_START).sort((a, b) => {
      const ta = a.quote.createdAt?.getTime ? a.quote.createdAt.getTime() : 0;
      const tb = b.quote.createdAt?.getTime ? b.quote.createdAt.getTime() : 0;
      if (ta !== tb) return ta - tb;
      return a.parsed.num - b.parsed.num;
    });
    const above = entries.filter((e) => e.parsed.num >= MIN_START).map((e) => e.parsed.num);
    const occupied = new Set(above);

    let next = MIN_START;
    const assignments = [];
    for (const entry of below) {
      while (occupied.has(next)) next += 1;
      const newNumber = buildNumber(entry.parsed.prefix, fy, next);
      assignments.push({
        id: String(entry.quote._id),
        oldNumber: entry.parsed.raw,
        newNumber,
        oldNum: entry.parsed.num,
        newNum: next,
        createdAt: entry.quote.createdAt
      });
      occupied.add(next);
      next += 1;
    }

    summary.financialYears.push({
      financialYear: fy,
      belowThresholdCount: below.length,
      alreadyAboveCount: above.length,
      assignments: assignments.map((a) => ({
        old: a.oldNumber,
        new: a.newNumber
      }))
    });
    summary.totalRenumbered += assignments.length;

    if (!shouldApply || !assignments.length) continue;

    const byOldNumber = new Map(assignments.map((a) => [a.oldNumber, a]));
    const byQuoteId = new Map(assignments.map((a) => [a.id, a]));

    for (const assignment of assignments) {
      const updates = { quotationNumber: assignment.newNumber };
      const current = await Quotation.findById(assignment.id).select('revisionHistory').lean();
      if (Array.isArray(current?.revisionHistory) && current.revisionHistory.length) {
        const newRevisions = current.revisionHistory.map((entry) => {
          if (!entry || typeof entry !== 'object') return entry;
          const updated = { ...entry };
          if (typeof updated.quotationNumber === 'string' && byOldNumber.has(updated.quotationNumber)) {
            updated.quotationNumber = byOldNumber.get(updated.quotationNumber).newNumber;
          }
          if (Array.isArray(updated.items)) {
            updated.items = updated.items.map((item) => {
              if (!item || typeof item !== 'object') return item;
              const fixed = { ...item };
              if (typeof fixed.quotationNumber === 'string' && byOldNumber.has(fixed.quotationNumber)) {
                fixed.quotationNumber = byOldNumber.get(fixed.quotationNumber).newNumber;
              }
              return fixed;
            });
          }
          return updated;
        });
        updates.revisionHistory = newRevisions;
      }
      await Quotation.updateOne({ _id: assignment.id }, { $set: updates });
    }

    const oldNumbers = [...byOldNumber.keys()];
    const proBulk = [];
    for (const oldNumber of oldNumbers) {
      const assign = byOldNumber.get(oldNumber);
      proBulk.push(
        ProformaInvoice.updateMany(
          { quotationNumber: oldNumber },
          { $set: { quotationNumber: assign.newNumber } }
        ).then((r) => (r.modifiedCount || 0))
      );
    }
    const proCounts = await Promise.all(proBulk);
    summary.proformaUpdated += proCounts.reduce((sum, n) => sum + n, 0);

    const notifBulk = [];
    for (const oldNumber of oldNumbers) {
      const assign = byOldNumber.get(oldNumber);
      notifBulk.push(
        Notification.updateMany(
          { 'metadata.quotationNumber': oldNumber },
          { $set: { 'metadata.quotationNumber': assign.newNumber } }
        ).then((r) => (r.modifiedCount || 0))
      );
    }
    const notifCounts = await Promise.all(notifBulk);
    summary.notificationsUpdated += notifCounts.reduce((sum, n) => sum + n, 0);
  }

  console.log(JSON.stringify(summary, null, 2));
}

run()
  .catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
