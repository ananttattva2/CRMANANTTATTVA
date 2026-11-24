// Read-only checks. Never print connection strings, tokens or CRM records.
require('dotenv').config({ override: true });
const mongoose = require('mongoose');
const { performance } = require('node:perf_hooks');
const { buildMongoUri } = require('../config/db').__test;

async function main() {
  const connection = await mongoose.createConnection(buildMongoUri(), {
    dbName: process.env.DB_NAME || 'registerd_types', autoIndex: false, autoCreate: false,
    serverSelectionTimeoutMS: 10000, maxPoolSize: 2
  }).asPromise();
  try {
    const pings = [];
    for (let index = 0; index < 5; index++) {
      const start = performance.now();
      await connection.db.command({ ping: 1 });
      pings.push(Math.round(performance.now() - start));
    }
    console.log('MongoDB round-trip milliseconds:', pings.join(', '));
    for (const [name, filter, sort] of [
      ['leads', {}, { leadCode: 1, createdAt: 1 }],
      ['clients', {}, { createdAt: -1, _id: -1 }],
      ['quotations', {}, { quotationDate: -1, createdAt: -1 }],
      ['pendingapprovals', { type: 'client', approvalStatus: 'PENDING' }, { createdAt: -1 }],
      ['usersessions', {}, { loginAt: -1 }],
      ['auditlogs', {}, { occurredAt: -1 }]
    ]) {
      const collection = connection.collection(name);
      const start = performance.now();
      const explanation = await collection.find(filter, { projection: { _id: 1 } })
        .sort(sort).limit(100).maxTimeMS(10000).explain('executionStats');
      const stats = explanation.executionStats || {};
      const plan = JSON.stringify(explanation.queryPlanner?.winningPlan || {});
      console.log(name, JSON.stringify({ elapsedMs: Math.round(performance.now() - start),
        databaseMs: stats.executionTimeMillis, returned: stats.nReturned,
        examinedDocuments: stats.totalDocsExamined, examinedKeys: stats.totalKeysExamined,
        collectionScan: plan.includes('COLLSCAN'), blockingSort: /"stage":"SORT"/.test(plan) }));
    }
    const { misClientProjection } = require('../services/misClientProjection');
    for (const [label, project] of [['original', null], ['MIS-presence', misClientProjection]]) {
      const start = performance.now();
      const stages = [{ $limit: 100 }, ...(project ? [{ $project: project }] : []),
        { $group: { _id: null, records: { $sum: 1 }, bytes: { $sum: { $bsonSize: '$$ROOT' } } } }];
      const [sample] = await connection.collection('clients').aggregate(stages, { maxTimeMS: 20000 }).toArray();
      console.log('client-payload-sample', label, JSON.stringify({ records: sample?.records || 0,
        bytes: sample?.bytes || 0, elapsedMs: Math.round(performance.now() - start) }));
    }
    console.log('Read-only performance check completed. Compare browser Timing: Waiting vs Queueing.');
  } finally { await connection.close(); }
}
main().catch(error => {
  const message = String(error.message || '').replace(/(?:mongodb(?:\+srv)?|rediss?):\/\/\S+/gi, '[connection hidden]').slice(0, 500);
  console.error('Performance check failed:', error.code || error.name, message);
  process.exitCode = 1;
});
