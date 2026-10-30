const test = require('node:test');
const assert = require('node:assert/strict');
const { mongoConfig, safeMongoError } = require('../src/config/mongoConfig');
const { singleFlight } = require('../src/config/databaseReadiness');
const uri = 'mongodb+srv://ananttattva2_db_user:p%40ss@cluster0.qslasmc.mongodb.net/crm';
test('new SRV credentials and topology survive stale legacy configuration', () => {
  const config = mongoConfig({ MONGO_URI: uri, MONGO_ATLAS_URI: 'mongodb://old/old', MONGO_DIRECT_HOSTS: 'old.cvawhfr.mongodb.net', MONGO_REPLICA_SET: 'old-set' });
  assert.equal(config.uri, uri);
  assert.equal(config.dbName, 'crm');
  assert.equal(config.authSource, 'admin');
  assert.equal(config.diagnostics.legacyDirectHostsIgnored, true);
  assert.equal(config.diagnostics.alternateUriIgnored, true);
  assert.ok(!JSON.stringify(config.diagnostics).includes('p%40ss'));
});
test('explicit database and URI auth source are respected', () => {
  assert.equal(mongoConfig({ MONGO_URI: uri, DB_NAME: 'other' }).dbName, 'other');
  assert.equal(mongoConfig({ MONGO_URI: uri + '?authSource=admin', MONGO_AUTH_SOURCE: 'old' }).authSource, 'admin');
  assert.equal(mongoConfig({ MONGO_URI: 'mongodb://user:pass@a:27017,b:27017/crm' }).dbName, 'crm');
  assert.throws(() => mongoConfig({}), /MONGO_URI/);
});
test('connection errors never expose raw messages or nested driver data', () => {
  const error = Object.assign(new Error(uri), { code: 18, cause: { uri } });
  assert.deepEqual(safeMongoError(error), { category: 'authentication', code: 18 });
});
test('concurrent database requests wait for one attempt and retry after rejection', async () => {
  let calls = 0, reject;
  const ready = singleFlight(() => { calls++; return new Promise((_resolve, fail) => { reject = fail; }); });
  const a = ready(), b = ready();
  assert.equal(a, b);
  await Promise.resolve();
  assert.equal(calls, 1);
  reject(new Error('offline'));
  await assert.rejects(a);
  const retry = ready();
  await Promise.resolve();
  assert.equal(calls, 2);
  reject(new Error('offline'));
  await assert.rejects(retry);
});
test('backend .env overrides stale PM2 values independent of cwd', () => {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  let options;
  const context = { __dirname: path.resolve(__dirname, '../src/config'), module: { exports: {} }, require(name) {
    return name === 'dotenv' ? { config(value) { options = value; return {}; } } : require(name);
  } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/config/loadEnv.js'), 'utf8'), context);
  context.module.exports();
  assert.equal(options.override, true);
  assert.equal(options.path, path.resolve(__dirname, '../.env'));
});
