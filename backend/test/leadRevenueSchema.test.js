const test = require('node:test');
const assert = require('node:assert/strict');
test('revenue schema requires unique service pricing and idempotency indexes', () => {
 const model = require('../src/models/LeadRevenue');
 const indexes = model.schema.indexes();
 assert.ok(indexes.some(([keys,options]) => keys.leadKind===1 && keys.leadId===1 && keys.serviceKeys===1 && options.unique));
 assert.ok(indexes.some(([keys,options]) => keys.requestId===1 && options.unique));
 for(const field of ['amountPaise','groupId','leadKind','leadId','createdBy','serviceKeys']) assert.equal(model.schema.path(field).options.immutable,true);
});
