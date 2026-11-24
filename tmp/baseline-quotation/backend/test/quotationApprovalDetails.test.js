const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function approve(role, details = {}) {
  const controller = fs.readFileSync(path.resolve(__dirname, '../src/controllers/quotationController.js'), 'utf8');
  const start = controller.indexOf('exports.updateQuotationApproval =');
  const end = controller.indexOf('\n};', start) + 3;
  const quotation = { _id: 'quotation-id', status: 'submitted', managementApproval: { status: 'PENDING', approverId: 'assigned-final-reviewer' }, save: async () => {} };
  const updates = [];
  const context = {
    exports: {}, normalizeApprovalStatus: (value) => value,
    userHasAnyRole: (user, roles) => roles.includes(user.role),
    require: () => ({ Types: { ObjectId: { isValid: (value) => Boolean(value) } } }),
    Quotation: { findById: () => ({ populate: async () => quotation }) },
    PendingApproval: { updateMany: async (filter, update) => updates.push(update) },
    sendQuotationLifecycleEmail: async () => {}, console
  };
  vm.runInNewContext(controller.slice(start, end), context);
  const result = { code: 200 };
  const res = { status(code) { result.code = code; return this; }, json(body) { result.body = body; return this; } };
  await context.exports.updateQuotationApproval({ params: { id: quotation._id }, user: { _id: 'reviewer', name: 'Reviewer', role }, body: { status: 'APPROVED', ...details } }, res);
  return { result, quotation, updates };
}

for (const role of ['admin', 'superadmin']) {
  test(`${role} approval saves price approver, source, note and proof without changing final reviewer assignment`, async () => {
    const { result, quotation, updates } = await approve(role, { priceApprovedByName: 'KRUNAL GODA', source: 'OUTLOOK', remarks: 'Price confirmed', proofUrl: 'https://example.test/proof.pdf', proofName: 'proof.pdf' });
    assert.equal(result.code, 200);
    assert.equal(quotation.status, role === 'admin' ? 'admin_approved' : 'approved');
    assert.equal(quotation.managementApproval.priceApprovedByName, 'KRUNAL GODA');
    assert.equal(quotation.managementApproval.source, 'OUTLOOK');
    assert.equal(quotation.managementApproval.note, 'Price confirmed');
    assert.equal(quotation.managementApproval.approverId, 'assigned-final-reviewer');
    assert.equal(quotation.approvalDecision.proofName, 'proof.pdf');
    assert.equal(updates[0].$set.managementApprovalSource, 'OUTLOOK');
  });
}

test('approval rejects unknown names and sources', async () => {
  assert.equal((await approve('admin', { priceApprovedByName: 'Unknown', source: 'TEAMS' })).result.code, 400);
  assert.equal((await approve('admin', { priceApprovedByName: 'ANAND PADHYA', source: 'Unknown' })).result.code, 400);
});
