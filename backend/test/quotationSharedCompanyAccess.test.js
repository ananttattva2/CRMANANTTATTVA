const test = require('node:test');
const assert = require('node:assert/strict');
const controller = require('../src/controllers/quotationController');
const Lead = require('../src/models/Lead');

test('admin and superadmin can see every quotation', async () => {
  assert.deepEqual(await controller._test.quotationAccessFilter({ role: 'admin', _id: 'admin-id' }), {});
  assert.deepEqual(await controller._test.quotationAccessFilter({ role: 'superadmin', _id: 'admin-id' }), {});
});

test('normal user access includes own quotations and quotations linked to owned or assigned leads', async (t) => {
  const originalFind = Lead.find;
  t.after(() => { Lead.find = originalFind; });
  Lead.find = (query) => ({
    select() {
      return { lean: async () => [{ _id: 'lead-object-id', leadCode: 'ATPL-LEAD-0327', sourceLeadId: '327' }] };
    }
  });
  const userId = '64b8f1c2a1e2f3d4c5b6a7e8';
  const filter = await controller._test.quotationAccessFilter({
    _id: userId,
    name: 'GAURAV CHANDRA',
    email: 'gaurav@example.com',
    role: 'sales'
  });

  assert.deepEqual(filter.$or[0], { createdBy: { $in: [userId] } });
  assert.ok(filter.$or.some((row) => row.leadId?.$in?.includes('ATPL-LEAD-0327')));
  assert.ok(filter.$or.some((row) => row.leadCode?.$in?.includes('327')));
});

test('unauthenticated scope cannot see quotations', async () => {
  assert.deepEqual(await controller._test.quotationAccessFilter(null), { _id: { $exists: false } });
});

test('quotation lead visibility matches generated, secondary, assigned, and shared lead access', () => {
  const userId = '64b8f1c2a1e2f3d4c5b6a7e8';
  const filter = controller._test.quotationLeadVisibilityFilter({
    ids: [userId],
    identities: [userId, 'sales@example.com']
  });
  const ownedFilter = filter.$or.find((condition) => condition.$or?.some((row) => row.createdBy));
  assert.ok(ownedFilter.$or.some((row) => row.secondaryCreatedBy?.$in?.includes(userId)));
  assert.ok(ownedFilter.$or.some((row) => row.generatedForUser?.$in?.includes(userId)));
  assert.ok(ownedFilter.$or.some((row) => row.generatedForEmail?.$options === 'i'));
  assert.ok(filter.$or.some((condition) => condition.$or?.some((row) => row['noOwner.active'] === true)));
});
