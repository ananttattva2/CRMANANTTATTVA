const test = require('node:test');
const assert = require('node:assert/strict');
const { restoreArchidplyLead } = require('../src/services/restoreArchidplyLead');
function fixture(company = 'ARCHIDPLY INDUSTRIES LIMITED') {
  const lead = { _id: '111111111111111111111111', leadCode: 'ATPL-LEAD-0057', company, deletedAt: new Date(), deletedBy: 'admin' };
  let archived = 2;
  const db = { collection: name => name === 'leads' ? {
    find: filter => { assert.ok(filter.leadCode.test(lead.leadCode)); return { toArray: async () => [lead] }; },
    updateOne: async (filter, update) => { assert.equal(filter._id, lead._id); lead.deletedAt = update.$set.deletedAt; return { modifiedCount: 1 }; },
    findOne: async () => lead
  } : {
    countDocuments: async filter => { assert.equal(filter.type, 'purchase_order'); assert.equal(filter.$or[0]['payload.leadId'], lead._id); return archived; },
    updateMany: async () => { const modifiedCount = archived; archived = 0; return { modifiedCount }; }
  } };
  return { db, lead };
}
test('exact lead and archived approvals restore; repeat is safe and dry run writes nothing', async () => {
  const { db, lead } = fixture();
  assert.equal((await restoreArchidplyLead(db)).archivedApprovals, 2);
  assert.ok(lead.deletedAt);
  const result = await restoreArchidplyLead(db, { apply: true });
  assert.equal(result.restored, true);
  assert.equal(result.restoredApprovals, 2);
  assert.equal(lead.deletedAt, null);
  assert.equal((await restoreArchidplyLead(db, { apply: true })).restoredApprovals, 0);
});
test('company mismatch prevents restoration', async () => {
  const { db, lead } = fixture('OTHER COMPANY');
  await assert.rejects(restoreArchidplyLead(db, { apply: true }), /company mismatch/);
  assert.ok(lead.deletedAt);
});
