const OLD_NUMBER = 'PI/26-27/002';
const NEW_NUMBER = 'PI/26-27/203';
const OLD_PO = 'ATPL-LEAD-0545';
const NEW_PO = 'ATPL/Nov/01';

function isRequestedCompany(row) {
  return /^shri sagar wovens pvt\.? ltd\.?$/i.test(String(row.companyName || '').trim().replace(/\s+/g, ' '));
}

async function repairRequestedProforma(Model, backup) {
  const old = await Model.findOne({ proformaNumber: OLD_NUMBER }).lean();
  const target = await Model.findOne({ proformaNumber: NEW_NUMBER }).lean()
    || await Model.findOne({ proformaNumber: NEW_NUMBER.replace(/^PI\//, 'ATPI/') }).lean();
  if (!old) {
    if (target && isRequestedCompany(target) && target.poNumber === NEW_PO) {
      return { status: 'already-correct', invoice: target.proformaNumber, poNumber: NEW_PO };
    }
    throw new Error('Requested source invoice missing; manual review required.');
  }
  if (!isRequestedCompany(old) || ![OLD_PO, NEW_PO].includes(old.poNumber)) {
    throw new Error('Source invoice identity differs from the requested correction.');
  }
  if (target) throw new Error('Requested invoice number is already occupied; no records changed.');
  await backup(old);
  const result = await Model.updateOne(
    { _id: old._id, proformaNumber: OLD_NUMBER, poNumber: old.poNumber, updatedAt: old.updatedAt },
    { $set: { proformaNumber: NEW_NUMBER, poNumber: NEW_PO } }
  );
  if (result.modifiedCount !== 1) throw new Error('Invoice changed concurrently; correction stopped.');
  const saved = await Model.findOne({ _id: old._id }).lean();
  if (saved?.proformaNumber !== NEW_NUMBER || saved?.poNumber !== NEW_PO) throw new Error('Saved correction verification failed.');
  return { status: 'corrected', invoice: NEW_NUMBER, poNumber: NEW_PO };
}

async function main() {
  require('../config/loadEnv')();
  const mongoose = require('mongoose');
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const { mongoConfig } = require('../config/mongoConfig');
  try {
    const directory = path.resolve(__dirname, '../../../.invoice-correction-backups');
    const marker = path.join(directory, 'shri-sagar-pi-203.completed.json');
    try {
      await fs.access(marker);
      console.info('Requested Proforma correction previously completed.');
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const config = mongoConfig();
    await mongoose.connect(config.uri, { dbName: config.dbName, authSource: config.authSource, serverSelectionTimeoutMS: 15000, autoIndex: false });
    const Model = require('../models/ProformaInvoice');
    const summary = await repairRequestedProforma(Model, async (row) => {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(directory, `${row._id}-${Date.now()}.json`), JSON.stringify(row), { flag: 'wx', mode: 0o600 });
    });
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.writeFile(marker, JSON.stringify(summary), { flag: 'wx', mode: 0o600 });
    console.info('Requested Proforma correction', summary);
  } catch (error) {
    console.error('Requested Proforma correction failed', { name: error.name, code: error.code });
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) main();
module.exports = { repairRequestedProforma };
