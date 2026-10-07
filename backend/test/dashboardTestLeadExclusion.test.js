const test = require('node:test');
const assert = require('node:assert/strict');
const {
  loadAdminCreatedLeadReferences,
  getAssignmentDashboardLeadReferences,
  dashboardLeadExclusionFilter,
  dashboardClientExclusionFilter,
  dashboardQuotationExclusionFilter
} = require('../src/services/dashboardTestLeadExclusion');

function queryResult(value) {
  return {
    select() { return this; },
    async lean() { return value; }
  };
}

test('assignment dashboards retain Admin-created permanent staff work and exclude unassigned test leads', async () => {
  const queries = [];
  const references = await getAssignmentDashboardLeadReferences({
    UserModel: { find() { return queryResult([{ _id: 'admin' }]); } },
    LeadModel: { find(filter) {
      queries.push(filter);
      return queryResult(queries.length === 1 ? [{ _id: 'assigned', leadCode: 'REAL' }, { _id: 'test', leadCode: 'TEST' }] : [{ _id: 'test', leadCode: 'TEST' }]);
    } }
  });
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[1]._id.$in, ['assigned', 'test']);
  const staffCondition = queries[1].$nor.find(clause => clause.assignedStaff).assignedStaff;
  assert.deepEqual(staffCondition.$nin, [null]);
  assert.ok(queries[1].$nor.some(clause => clause.assignments?.$elemMatch?.$or.some(owner => owner.assignedStaff)));
  assert.deepEqual(dashboardLeadExclusionFilter(references), { _id: { $nin: ['test'] } });
  const excludedIds = dashboardClientExclusionFilter(references).$nor[0].selectedLead.$in;
  assert.deepEqual(excludedIds, ['test']);
  assert.deepEqual(references.identityValues, ['test', 'TEST']);
});

test('dashboard test-lead exclusion selects exact Admin creators but not Super Admin', async () => {
  let userFilter;
  let leadFilter;
  const references = await loadAdminCreatedLeadReferences({
    UserModel: {
      find(filter) {
        userFilter = filter;
        return queryResult([{ _id: 'admin-user' }]);
      }
    },
    LeadModel: {
      find(filter) {
        leadFilter = filter;
        return queryResult([{ _id: 'lead-1', leadCode: 'ATPL-LEAD-0001', sourceLeadId: 'legacy-1' }]);
      }
    }
  });

  assert.equal(userFilter.role.test('Admin'), true);
  assert.equal(userFilter.role.test('Super Admin'), false);
  assert.deepEqual(leadFilter, { createdBy: { $in: ['admin-user'] } });
  assert.deepEqual(dashboardLeadExclusionFilter(references), {
    createdBy: { $nin: ['admin-user'] }
  });

  const clientFilter = dashboardClientExclusionFilter(references);
  assert.deepEqual(clientFilter.$nor[0], { selectedLead: { $in: ['lead-1'] } });
  assert.ok(clientFilter.$nor.some((row) => row['data.selectedLeadSnapshot.leadCode']?.$in.includes('ATPL-LEAD-0001')));
  assert.ok(clientFilter.$nor.some((row) => row['data.selectedLeadSnapshot.sourceLeadId']?.$in.includes('legacy-1')));
  const quotationFilter = dashboardQuotationExclusionFilter(references);
  assert.ok(quotationFilter.$nor.some((row) => row.leadRef?.$in.includes('lead-1')));
  assert.ok(quotationFilter.$nor.some((row) => row.leadCode?.$in.includes('ATPL-LEAD-0001')));
});

test('dashboard filters remain no-ops when no exact Admin creators exist', () => {
  assert.deepEqual(dashboardLeadExclusionFilter({ adminIds: [] }), {});
  assert.deepEqual(dashboardClientExclusionFilter({ ids: [], identityValues: [] }), {});
  assert.deepEqual(dashboardQuotationExclusionFilter({ ids: [], identityValues: [] }), {});
});
