const test = require('node:test');
const assert = require('node:assert/strict');
const { correctionPlan, correctMysticalPoAmount } = require('../src/services/mysticalPoAmountCorrection');
const { sourceSignature } = require('../src/services/poApprovalWorkflow');
function fixture() {
  const lead = { _id: 'lead', leadCode: 'ATPL-LEAD-0615', company: 'MYSTICAL PROPACK PRIVATE LIMITED', serviceSelections: ['a', 'b', 'c', 'd'].map(id => ({ assignedServiceId: id, servicesOffered: 'Annual Return Filling' })), assignments: [30000, 30000, 25000, 40000].map((amount, i) => ({ assignedServiceId: 'abcd'[i], poStatus: 'received', poYearRows: [{ poNumber: `PO-${i}`, poAmount: amount }] })) };
  const approvals = [30000, 30000, 25000, 125000].map((amount, i) => ({ _id: `approval-${i}`, approvalStatus: 'PARTIALLY_APPROVED', payload: { assignedServiceId: 'abcd'[i], poYearRows: [{ poNumber: `PO-${i}`, poAmount: amount, quotationBasicAmount: i === 3 ? 40000 : amount }] }, poReview: { stage: 'LEAD_CLOSURE_PENDING', version: 3, poSummary: [{ poNumber: `PO-${i}`, poAmount: amount }], history: [] } }));
  return { lead, approvals };
}
function apply(row, update) {
  for (const [path, value] of Object.entries(update.$set || {})) {
    const parts = path.split('.'), last = parts.pop(); let target = row;
    for (const part of parts) target = target[part]; target[last] = value;
  }
  if (update.$push) for (const [path, value] of Object.entries(update.$push)) {
    const parts = path.split('.'), last = parts.pop(); let target = row;
    for (const part of parts) target = target[part]; target[last].push(value);
  }
}
const query = row => ({ session() { return this; }, lean: async () => structuredClone(row) });

test('syncs stale 125000 approval to corrected source 40000 and preserves every sibling PO', () => {
  const f = fixture(), original = structuredClone(f);
  const plan = correctionPlan(f.lead, f.approvals);
  assert.deepEqual(plan.sourceSets, {});
  assert.equal(plan.sets['payload.poYearRows.0.poAmount'], 40000);
  assert.equal(plan.sets['poReview.poSummary.0.poAmount'], 40000);
  assert.equal(plan.sets['poReview.version'], 4);
  assert.equal(plan.sets['poReview.sourceSignature'], sourceSignature(f.lead.assignments[3], f.lead.serviceSelections[3]));
  assert.deepEqual(f, original, 'planning does not mutate source records');
});

test('finds exact service after reorder, handles a source still at 125000 and refuses ambiguous targets', () => {
  const f = fixture(); f.lead.assignments.reverse(); f.lead.assignments[0].poYearRows[0].poAmount = 125000;
  const plan = correctionPlan(f.lead, f.approvals);
  assert.equal(plan.sourceSets['assignments.0.poYearRows.0.poAmount'], 40000);
  f.approvals.push(structuredClone(f.approvals[3]));
  assert.throws(() => correctionPlan(f.lead, f.approvals), /not uniquely/);
  assert.throws(() => correctionPlan({ ...f.lead, company: 'Other Company' }, f.approvals), /identity/);
});

test('transaction backs up, verifies saved amount, clears snapshots and is idempotent', async () => {
  const f = fixture(), before = structuredClone(f), backups = [], deletions = [];
  let transactions = 0, ended = 0;
  const deps = {
    Lead: { findOne: () => query(f.lead), updateOne: async (_filter, update) => { apply(f.lead, update); return { modifiedCount: 1 }; } },
    Approval: { find: () => query(f.approvals), findById: id => query(f.approvals.find(row => row._id === id)), updateOne: async (filter, update) => { apply(f.approvals.find(row => row._id === filter._id), update); return { modifiedCount: 1 }; } },
    connection: { startSession: async () => ({ withTransaction: async fn => { transactions++; await fn(); }, endSession: async () => { ended++; } }), collection: () => ({ deleteMany: async filter => { deletions.push(filter); } }) },
    backup: async data => backups.push(structuredClone(data))
  };
  const result = await correctMysticalPoAmount(deps);
  assert.equal(result.status, 'corrected'); assert.equal(result.poAmount, 40000);
  assert.deepEqual(f.approvals.slice(0, 3), before.approvals.slice(0, 3));
  assert.deepEqual(f.lead, before.lead);
  assert.equal(backups[0].approvals[3].payload.poYearRows[0].poAmount, 125000);
  assert.equal(f.approvals[3].poReview.stage, 'LEAD_CLOSURE_PENDING');
  assert.equal(f.approvals[3].poReview.history[0].event, 'PO_AMOUNT_CORRECTED');
  assert.deepEqual(deletions[0]._id.$in, ['PendingApproval:approval-3']);
  assert.equal((await correctMysticalPoAmount(deps)).status, 'already-correct');
  assert.equal(backups.length, 1); assert.equal(transactions, 2); assert.equal(ended, 2);
});
