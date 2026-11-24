const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const proofUrl of ['', 'https://example.com/proof.png']) {
  test(`Admin approval saves with ${proofUrl ? 'attached' : 'no'} proof and keeps final review pending`, async () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/controllers/quotationController.js'), 'utf8');
    const start = source.indexOf('exports.updateQuotationApproval =');
    const end = source.indexOf('\nexports.', start + 1);
    let saved = false;
    let update;
    const quotation = {
      _id: 'quotation-id', managementApproval: { status: 'PENDING', source: 'EMAIL', note: 'Review pricing', approverId: 'superadmin-id' },
      save: async () => { saved = true; }
    };
    const context = {
      exports: {}, console, normalizeApprovalStatus: (value) => value,
      userHasAnyRole: () => false,
      require: () => ({ Types: { ObjectId: { isValid: (value) => Boolean(value) } } }),
      Quotation: { findById: () => ({ populate: async () => quotation }) },
      PendingApproval: { updateMany: async (query, values) => { update = values.$set; } },
      sendQuotationLifecycleEmail: async () => ({})
    };
    vm.runInNewContext(source.slice(start, end), context);
    let response;
    const res = { status: (code) => { throw new Error(`Unexpected HTTP ${code}`); }, json: (body) => { response = body; } };
    await context.exports.updateQuotationApproval({ params: { id: 'quotation-id' }, body: { status: 'APPROVED', proofUrl }, user: { _id: 'admin-id', role: 'admin', name: 'Admin' } }, res);
    assert.equal(saved, true);
    assert.equal(response.adminApprovalStatus, 'APPROVED');
    assert.equal(quotation.status, 'admin_approved');
    assert.equal(quotation.managementApproval.status, 'PENDING');
    assert.equal(quotation.managementApproval.source, 'EMAIL');
    assert.equal(quotation.managementApproval.note, 'Review pricing');
    assert.equal(quotation.managementApproval.adminApprovalProofUrl, proofUrl);
    assert.equal(update.decisionProofUrl, proofUrl);
  });
}
