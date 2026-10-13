const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { cacheInvalidationPlugin, createWriteInvalidation } = require('../src/services/crmCacheInvalidation');

test('scheduler model writes await revision changes; telemetry reads never invalidate', async () => {
  const schema = new mongoose.Schema({ name: String });
  let invalidations = 0;
  cacheInvalidationPlugin(schema, { invalidate: async () => { invalidations++; } });
  const run = (operation, context) => new Promise((resolve, reject) => {
    schema.s.hooks.execPost(operation, context, [{}], {}, error => error ? reject(error) : resolve());
  });
  await run('save', { constructor: { modelName: 'Lead' } });
  await run('insertMany', { modelName: 'Client' });
  for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne']) {
    await run(operation, { model: { modelName: 'Quotation' } });
  }
  assert.equal(invalidations, 9);
  await run('updateOne', { model: { modelName: 'UserSession' } });
  await run('save', { constructor: { modelName: 'AuditLog' } });
  assert.equal(invalidations, 9);
});

test('write response waits for invalidation, including bulk imports and partial failures', async () => {
  let finish;
  const invalidate = () => new Promise(resolve => { finish = resolve; });
  for (const path of ['/api/leads', '/api/quotations/bulk', '/api/clients/years/bulk', '/api/integrations/compliance/sync', '/api/auth/admin/users/id']) {
    let sent = false;
    const headers = {};
    const res = { statusCode: 200, set: (key, value) => { headers[key] = value; }, json: () => { sent = true; } };
    createWriteInvalidation(invalidate)({ method: 'POST', originalUrl: path }, res, () => {});
    const response = res.json({ success: true });
    assert.equal(sent, false);
    finish('updated');
    await response;
    assert.equal(sent, true);
    assert.equal(headers['X-CRM-Revision'], 'updated');
  }
});

test('read requests and background heartbeat cannot thrash cached reports', () => {
  const middleware = createWriteInvalidation(() => { throw new Error('must not invalidate'); });
  for (const [method, path] of [['GET', '/api/leads'], ['POST', '/api/auth/activity-heartbeat'], ['POST', '/api/assets/upload'], ['PATCH', '/api/notifications/id']]) {
    const json = () => {};
    const res = { json };
    middleware({ method, originalUrl: path }, res, () => {});
    assert.equal(res.json, json);
  }
});
