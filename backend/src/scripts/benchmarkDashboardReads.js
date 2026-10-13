// Read-only diagnostic. Example:
// node src/scripts/benchmarkDashboardReads.js --env .env --baseline <commit>
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const { performance } = require('node:perf_hooks');
const { gzipSync } = require('node:zlib');
const assert = require('node:assert/strict');
const args = process.argv.slice(2);
const argument = name => args[args.indexOf(name) + 1];
require('dotenv').config({ path: args.includes('--env') ? argument('--env') : '.env', quiet: true });
const mongoose = require('mongoose');
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const controllerPath = path.resolve(__dirname, '../controllers/dashboardInsightsController.js');
function baselineController(ref) {
  const source = execFileSync('git', ['show', `${ref}:backend/src/controllers/dashboardInsightsController.js`], { encoding: 'utf8' });
  const loaded = new Module(controllerPath, module);
  loaded.filename = controllerPath;
  loaded.paths = Module._nodeModulePaths(path.dirname(controllerPath));
  loaded._compile(source, controllerPath);
  return loaded.exports;
}
async function measure(controller) {
  const started = performance.now();
  let result, status = 200;
  const headers = {};
  await controller.uploadTracker({ user: { _id: new mongoose.Types.ObjectId(), role: 'admin' }, query: { assignmentsOnly: 'true', ...(args.includes('--portfolio') ? { portfolioOnly: 'true' } : {}) } }, {
    set(key, value) { headers[key] = value; }, status(code) { status = code; return this; }, json(payload) { result = payload; }
  });
  assert.equal(status, 200, `Dashboard HTTP ${status}`);
  const json = JSON.stringify(result);
  return { payload: result, metrics: { milliseconds: Math.round(performance.now() - started), serverTiming: headers['Server-Timing'], bytes: Buffer.byteLength(json), gzipBytes: gzipSync(json).length, assignments: result.assignments.length } };
}
async function main() {
  const { buildMongoUri } = require('../config/db').__test;
  await mongoose.connect(buildMongoUri(), { dbName: process.env.DB_NAME || 'registerd_types', serverSelectionTimeoutMS: 10000, autoIndex: false, autoCreate: false, monitorCommands: true, compressors: ['zlib'], zlibCompressionLevel: 1 });
  const commands = [];
  mongoose.connection.getClient().on('commandSucceeded', event => { if (!['hello', 'endSessions'].includes(event.commandName)) commands.push({ command: event.commandName, milliseconds: event.duration, namespace: event.reply.cursor?.ns, bytes: Buffer.byteLength(JSON.stringify(event.reply)) }); });
  const current = require(controllerPath);
  const baseline = args.includes('--baseline') ? await measure(baselineController(argument('--baseline'))) : null;
  const cold = await measure(current);
  const warm = await measure(current);
  const report = { baseline: baseline?.metrics, optimizedCold: cold.metrics, optimizedWarm: warm.metrics, commands };
  if (baseline) {
    const { buildApplicationPortfolio, applicationSummaryRecords } = await import('../../../frontend/src/utils/applicationPortfolio.mjs');
    const summarize = payload => buildApplicationPortfolio(payload.assignments, payload.users).map(group => ({
      id: group.id, total: group.total, records: applicationSummaryRecords(group).map(row => ({
        id: row.id, name: row.name, category: row.category, bucket: row.bucket,
        annualYears: row.annualYears, offered: row.offered, sourceIds: row.sourceIds,
        services: row.services.map(service => ({ id: service.id, bucket: service.bucket, closed: service.closed, annualYears: service.annualYears, offeredServices: service.offeredServices }))
      }))
    }));
    assert.deepEqual(summarize(cold.payload), summarize(baseline.payload), 'Compact reads must preserve portfolio counts, ownership and statuses');
    report.portfolioParity = true;
  }
  // Evaluate projection edge cases on the server using synthetic documents.
  // $replaceWith changes only the aggregation stream, never stored records.
  const { clientProjection, leadProjection } = require('../services/dashboardReadModel');
  const { resolveClientMasterData } = require('../services/clientMasterResolver');
  const fixture = { assignedServiceId: 'direct', data: { cpcb: { status: 'Not Started' },
    cpcbDataByAssignedServiceId: { direct: { status: 'Approved' }, nested: { cpcb: { status: 'Rejected' } } } } };
  const Client = require('../models/Client');
  const [projected] = await Client.aggregate([{ $limit: 1 }, { $replaceWith: { $literal: fixture } }, { $project: clientProjection }]);
  assert.equal(resolveClientMasterData(projected, 'direct').cpcb.status, 'Approved');
  assert.equal(resolveClientMasterData(projected, 'nested').cpcb.status, 'Rejected');
  const Lead = require('../models/Lead');
  const [projectedLead] = await Lead.aggregate([{ $limit: 1 }, { $replaceWith: { $literal: {
    assignments: [{ poYearRows: [{ poFileUrl: 'data:application/pdf;base64,' + 'A'.repeat(50000) }] }]
  } } }, { $project: leadProjection }]);
  assert.equal(projectedLead.assignments[0].poYearRows[0].poFileUrl, '');
  assert.equal(projectedLead.assignments[0].poYearRows[0].poFileName, 'Purchase Order');
  report.projectionFixturesPassed = true;
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(`Dashboard benchmark failed: ${error.name}: ${error.code || 'validation/query failure'}`); process.exitCode = 1; }).finally(() => mongoose.disconnect());
