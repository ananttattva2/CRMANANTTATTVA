// Dry run by default. --apply backs up changed data before conditional writes.
require('../config/loadEnv')();
const mongoose = require('mongoose');
const fs = require('node:fs/promises');
const path = require('node:path');
const { mongoConfig, safeMongoError } = require('../config/mongoConfig');
const { normalizeProductQuantities, validateProductQuantities } = require('../../../shared/productQuantity.cjs');
(async () => {
 try {
  const config = mongoConfig();
  await mongoose.connect(config.uri, { dbName: config.dbName, authSource: config.authSource, serverSelectionTimeoutMS:15000, autoIndex:false });
  const Client = require('../models/Client');
  const { clientMasterSourceRecordFilter, savedClientDirectoryBranches } = require('../services/clientMasterVisibility');
  const closed = await require('../services/clientClosedPoDirectory').closedPoClientFilter();
  const missing = await Client.find({ $and:[clientMasterSourceRecordFilter(), { $or:savedClientDirectoryBranches() }, { $nor:[closed] }] }).select('_id data.basic.clientLegalName').lean();
  console.info('Saved clients excluded by old PO directory rule', JSON.stringify(missing.map(row => ({ id:row._id, name:row.data?.basic?.clientLegalName }))));
  const apply = process.argv.includes('--apply');
  let changed = 0, skipped = 0;
  for await (const row of Client.find({}).lean().cursor()) {
   const data = normalizeProductQuantities(row.data);
   if (JSON.stringify(data) === JSON.stringify(row.data)) continue;
   const error = validateProductQuantities(data);
   if (error) { skipped++; console.info('Requires manual review', String(row._id)); continue; }
   changed++;
   console.info(apply ? 'Migrating' : 'Would migrate', String(row._id), row.data?.basic?.clientLegalName || '');
   if (apply) {
    const directory = path.resolve(__dirname, '../../../.client-quantity-backups');
    await fs.mkdir(directory,{recursive:true});
    await fs.writeFile(path.join(directory, `${row._id}-${Date.now()}.json`), JSON.stringify(row), { flag:'wx',mode:0o600 });
    const result = await Client.collection.updateOne({ _id:row._id, data:row.data }, { $set:{ data } });
    if (!result.matchedCount) throw new Error('Concurrent edit; rerun repair');
   }
  }
  console.info(JSON.stringify({ apply, changed, skipped }));
 } catch (error) { console.error('Client quantity repair unavailable',safeMongoError(error)); process.exitCode=1; }
 finally { await mongoose.disconnect(); }
})();
