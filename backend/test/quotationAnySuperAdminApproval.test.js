const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/controllers/quotationController.js'), 'utf8');

function load(name, context) {
  context.userHasAnyRole = require('../src/utils/userRoles').userHasAnyRole;
  const start = source.indexOf(`exports.${name} =`);
  const next = source.indexOf('\nexports.', start + 1);
  context.exports = {};
  vm.runInNewContext(source.slice(start, next < 0 ? undefined : next), context);
  return context.exports[name];
}

for (const primaryRole of ['admin', 'manager']) for (const adminStatus of ['PENDING', 'APPROVED']) {
  test(`${primaryRole} with Super Admin permission directly finalizes while Admin is ${adminStatus}`, async () => {
    const quotation = { _id: 'quote', status: 'submitted', managementApproval: { status: 'PENDING', adminApprovalStatus: adminStatus }, save: async () => {} };
    let update, code = 200;
    const handler = load('finalizeManagementApproval', {
      console, mongoose: { Types: { ObjectId: { isValid: () => true } } },
      Quotation: { findById: () => ({ populate: async () => quotation }) },
      PendingApproval: { updateMany: async (_, changes) => { update = changes.$set; } },
      sendQuotationLifecycleEmail: async () => ({})
    });
    await handler({ params: { id: 'quote' }, body: {}, user: { _id: 'super', role: primaryRole, roles: ['Super Admin'] } }, {
      status(value) { code = value; return this; }, json() {}
    });
    assert.equal(code, 200);
    assert.equal(quotation.status, 'approved');
    assert.equal(quotation.approvalDecision.approvalKind, 'MANAGEMENT_FINAL');
    assert.equal(update.approvalStatus, 'APPROVED');
  });
}

test('regular approval gives secondary Super Admin permission precedence over primary Admin', async () => {
  const quotation = { _id: 'quote', status: 'submitted', managementApproval: { status: 'PENDING' }, save: async () => {} };
  const handler = load('updateQuotationApproval', {
    console, normalizeApprovalStatus: value => value,
    require: () => ({ Types: { ObjectId: { isValid: value => Boolean(value) } } }),
    Quotation: { findById: () => ({ populate: async () => quotation }) },
    PendingApproval: { updateMany: async () => {} }, sendQuotationLifecycleEmail: async () => ({})
  });
  await handler({ params: { id: 'quote' }, body: { status: 'APPROVED' }, user: { _id: 'super', role: 'admin', roles: ['superadmin'] } }, {
    status(value) { assert.fail(`Unexpected HTTP ${value}`); }, json() {}
  });
  assert.equal(quotation.status, 'approved');
  assert.equal(quotation.managementApproval.status, 'APPROVED');
  assert.equal(quotation.approvalDecision.reviewerRole, 'superadmin');
  assert.equal(quotation.approvalDecision.approvalKind, 'MANAGEMENT_FINAL');
});

for (const adminStatus of ['PENDING', 'APPROVED']) for (const role of ['superadmin', 'admin']) {
  test(`${role}: final approval with Admin ${adminStatus} by someone other than the price approver`, async () => {
    let saved = false;
    let update;
    const quotation = {
      _id: 'quote', managementApproval: { status: 'PENDING', adminApprovalStatus: adminStatus, approverId: 'price-approver', approverName: 'Price reviewer', source: 'EMAIL', note: 'Price agreed' },
      save: async () => { saved = true; }
    };
    const handler = load('finalizeManagementApproval', {
      console, mongoose: { Types: { ObjectId: { isValid: () => true } } },
      Quotation: { findById: () => ({ populate: async () => quotation }) },
      PendingApproval: { updateMany: async (filter, changes) => { update = changes.$set; } },
      sendQuotationLifecycleEmail: async () => ({})
    });
    let code = 200;
    let response;
    const res = { status(value) { code = value; return this; }, json(value) { response = value; } };
    await handler({ params: { id: 'quote' }, body: {}, user: { _id: 'different-reviewer', role, name: 'Final reviewer' } }, res);
    if (role === 'admin') {
      assert.equal(code, 403);
      assert.equal(saved, false);
      return;
    }
    assert.equal(code, 200);
    assert.equal(response.approvalStatus, 'APPROVED');
    assert.equal(saved, true);
    assert.equal(update.approvalStatus, 'APPROVED');
    assert.equal(quotation.managementApproval.approverId, 'price-approver');
    assert.equal(quotation.managementApproval.actionBy, 'different-reviewer');
    assert.equal(quotation.approvalDecision.actionBy, 'different-reviewer');
  });
}

test('bulk approval considers pending quotations for all price approvers', async () => {
  let filter;
  const handler = load('approveAllPendingQuotations', {
    console, PendingApproval: { find: async (query) => { filter = query; return []; } }
  });
  await handler({ body: {}, user: { _id: 'different-reviewer', role: 'superadmin' } }, { json() {} });
  assert.equal(filter['payload.managementApproverId'], undefined);
  assert.equal(filter['payload.adminApprovalStatus'], undefined);
  assert.equal(filter.approvalStatus, 'PENDING');
});

test('Super Admin final decision is saved once and a subsequent decision is rejected', async () => {
  let saves = 0;
  const quotation = { _id: 'quote', status: 'submitted', managementApproval: { status: 'PENDING' }, save: async () => { saves++; } };
  const handler = load('finalizeManagementApproval', {
    console, mongoose: { Types: { ObjectId: { isValid: () => true } } },
    Quotation: { findById: () => ({ populate: async () => quotation }) },
    PendingApproval: { updateMany: async () => {} }, sendQuotationLifecycleEmail: async () => ({})
  });
  let code = 200;
  const res = { status(value) { code = value; return this; }, json() {} };
  const req = { params: { id: 'quote' }, body: { remarks: 'Verified pricing', proofUrl: 'https://example.test/proof', proofName: 'proof' }, user: { _id: 'super', role: 'superadmin', name: 'Super' } };
  await handler(req, res);
  assert.equal(quotation.status, 'approved');
  assert.equal(quotation.$where.status, 'submitted');
  assert.equal(quotation.approvalDecision.remarks, 'Verified pricing');
  assert.equal(quotation.approvalDecision.proofName, 'proof');
  assert.equal(quotation.managementApproval.adminApprovalStatus, undefined);
  await handler(req, res);
  assert.equal(code, 409);
  assert.equal(saves, 1);
});

test('a concurrent final decision returns conflict without changing the approval index', async () => {
  let indexUpdates = 0;
  const quotation = { _id: 'quote', status: 'submitted', managementApproval: { status: 'PENDING' }, save: async () => { const error = new Error('status changed'); error.name = 'DocumentNotFoundError'; throw error; } };
  const handler = load('finalizeManagementApproval', {
    console, mongoose: { Types: { ObjectId: { isValid: () => true } } },
    Quotation: { findById: () => ({ populate: async () => quotation }) },
    PendingApproval: { updateMany: async () => { indexUpdates++; } }, sendQuotationLifecycleEmail: async () => ({})
  });
  let code;
  const res = { status(value) { code = value; return this; }, json() {} };
  await handler({ params: { id: 'quote' }, body: {}, user: { role: 'superadmin' } }, res);
  assert.equal(code, 409);
  assert.equal(quotation.$where.status, 'submitted');
  assert.equal(indexUpdates, 0);
});

test('regular approval API lets Super Admin approve directly and blocks subsequent Admin decisions', async () => {
  let saves = 0;
  const quotation = { _id: 'quote', status: 'submitted', managementApproval: { status: 'PENDING' }, save: async () => { saves++; } };
  const handler = load('updateQuotationApproval', {
    console, normalizeApprovalStatus: (value) => value, userHasAnyRole: () => false,
    require: () => ({ Types: { ObjectId: { isValid: (value) => Boolean(value) } } }),
    Quotation: { findById: () => ({ populate: async () => quotation }) },
    PendingApproval: { updateMany: async () => {} }, sendQuotationLifecycleEmail: async () => ({})
  });
  let code = 200;
  const res = { status(value) { code = value; return this; }, json() {} };
  const req = { params: { id: 'quote' }, body: { status: 'APPROVED' }, user: { _id: 'super', role: 'superadmin' } };
  await handler(req, res);
  assert.equal(quotation.status, 'approved');
  assert.equal(quotation.managementApproval.status, 'APPROVED');
  assert.equal(quotation.approvalDecision.approvalKind, 'MANAGEMENT_FINAL');
  await handler({ ...req, user: { _id: 'admin', role: 'admin' } }, res);
  assert.equal(code, 409);
  assert.equal(saves, 1);
});
