const assert = require('node:assert/strict');
const test = require('node:test');
const controller = require('../src/controllers/quotationController');
const leadController = require('../src/controllers/leadController');
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

test('reassigned quotation editors are authorized by created-on-behalf ownership like lead editors', async () => {
  const userId = '64b8f1c2a1e2f3d4c5b6a7e8';
  const user = { _id: userId, name: 'New Lead Editor', email: 'editor@example.com', role: 'sales' };
  const scope = { ids: [userId], identities: [userId, user.name, user.email] };
  const quotationFilter = controller._test.quotationLeadVisibilityFilter(scope);
  const leadFilter = await leadController.leadAccessFilter(user, { includeShared: true });
  const ownedQuotation = quotationFilter.$or.find((condition) => condition.$or?.some((row) => row.createdBy));
  const ownedLead = leadFilter.$or.find((condition) => condition.$or?.some((row) => row.createdBy));

  for (const owned of [ownedQuotation, ownedLead]) {
    assert.ok(owned.$or.some((row) => row.createdOnBehalfOfUser?.$in?.includes(userId)));
    assert.ok(owned.$or.some((row) => row.createdOnBehalfOfEmail?.$options === 'i'));
    assert.ok(owned.$or.some((row) => row.secondaryCreatedByName?.$options === 'i'));
  }
});

test('quotation save refresh can resolve a lead allocated to the current editor', async (t) => {
  const userId = '64b8f1c2a1e2f3d4c5b6a7e8';
  const lead = {
    _id: '64b8f1c2a1e2f3d4c5b6a7f0',
    leadCode: 'ATPL-LEAD-0305',
    company: 'TECH WEAVE INTERNATIONAL PRIVATE LIMITED',
    createdOnBehalfOfUser: userId
  };
  const originalFindOne = Lead.findOne;
  let query;
  t.after(() => { Lead.findOne = originalFindOne; });
  Lead.findOne = (filter) => {
    query = filter;
    return { lean: async () => lead };
  };

  const result = await controller._test.refreshQuotationLeadDetails({
    leadId: lead._id,
    leadCode: lead.leadCode,
    companyName: 'Old company name'
  }, null, {
    _id: userId,
    name: 'New Lead Editor',
    email: 'editor@example.com',
    role: 'sales'
  });

  assert.match(JSON.stringify(query), new RegExp(`createdOnBehalfOfUser.*${userId}`));
  assert.equal(result.companyName, lead.company);
  assert.equal(result.leadDetails.companyName, lead.company);
});
test('Finance and Accounts primary or secondary roles can read the complete quotation list', async () => {
  for (const user of [{ role: 'finance' }, { role: 'accounts' }, { role: 'sales', roles: ['Finance'] }]) assert.deepEqual(await controller._test.quotationAccessFilter(user, { allowFinanceRead: true }), {});
});
