const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const User = require('../src/models/User');
const mailer = require('../src/utils/mailer');
const { _test: financeTest } = require('../src/controllers/poFinanceController');

function queryResult(rows) {
  return { select() { return this; }, lean: async () => rows };
}

test('PO referral and payment notifications reach the owner and secondary-role admins', async (t) => {
  const originalFind = User.find;
  const originalSendMail = mailer.sendMail;
  const controllerPath = require.resolve('../src/controllers/leadController');
  const sent = [];
  const owner = { email: 'owner@example.test' };
  const primaryOwner = { email: 'gaurav@example.test' };
  const superAdmin = { email: 'superadmin@example.test' };
  const admin = { email: 'admin@example.test' };
  const submitter = { email: 'submitter@example.test' };
  const adminRoleQueries = [];

  User.find = (filter) => {
    const clauses = filter.$or || [];
    if (clauses.some((clause) => clause._id === 'gaurav-id' || clause.email === 'gaurav@example.test' || clause.name === 'Gaurav Chandra')) return queryResult([primaryOwner]);
    if (clauses.some((clause) => ['owner-id', 'owner-crm'].includes(clause.crmUserId) || ['owner-id', 'Owner User'].includes(clause.name))) return queryResult([owner]);
    if (clauses.some((clause) => clause.roles?.$in?.includes('accounts'))) return queryResult([]);
    if (clauses.some((clause) => {
      const patterns = [...(clause.role?.$in || []), ...(clause.roles?.$in || [])];
      const matchesSuperAdminAlias = patterns.some((pattern) => pattern instanceof RegExp && pattern.test('Super Admin'));
      if (matchesSuperAdminAlias) adminRoleQueries.push(filter);
      return matchesSuperAdminAlias;
    })) return queryResult([superAdmin, admin]);
    if (clauses.some((clause) => clause._id)) return queryResult([superAdmin, admin, submitter]);
    return queryResult([superAdmin, admin]);
  };
  mailer.sendMail = async (to, subject, html) => {
    sent.push({ to, subject, html });
    return { summary: { accepted: [to], rejected: [] } };
  };
  delete require.cache[controllerPath];
  const { notifyPurchaseOrderDecision, _test: leadTest } = require('../src/controllers/leadController');

  t.after(() => {
    User.find = originalFind;
    mailer.sendMail = originalSendMail;
    delete require.cache[controllerPath];
  });

  const approval = {
    _id: 'approval-id',
    createdByName: 'Submitted by',
    payload: {
      poSubmittedByEmail: 'submitter@example.test',
      poYearRows: [{ poNumber: 'PO-1', poAmount: 1000 }]
    }
  };
  const lead = {
    company: 'Example Ltd',
    leadCode: 'LEAD-1',
    assignments: [{ assignedStaff: 'owner-id', poYearRows: [{ poNumber: 'PO-1', poAmount: 1000 }] }]
  };

  const referral = await notifyPurchaseOrderDecision({
    approval, lead, index: 0, status: 'REFERRED', remarks: 'Please confirm payment terms.', specialApproval: true
  });
  assert.equal(referral.recipients, 1);
  assert.equal(referral.sent, 1);
  assert.deepEqual(sent.map((mail) => mail.to), ['owner@example.test']);
  assert.ok(sent.every((mail) => mail.subject.includes('PO Special Approval requested')));
  assert.ok(sent.every((mail) => mail.html.includes('Please confirm payment terms.')));

  sent.length = 0;
  await notifyPurchaseOrderDecision({
    approval, lead: {
      ...lead,
      generatedForUser: 'gaurav-id',
      generatedForName: 'Gaurav Chandra',
      generatedForEmail: 'gaurav@example.test',
      assignments: [{ assignedStaff: 'anand-id', assignedStaffEmail: 'anand@example.test', poYearRows: [{ poNumber: 'PO-1', poAmount: 1000 }] }]
    },
    index: 0, status: 'REFERRED', remarks: 'Owner should receive this.', specialApproval: true
  });
  assert.deepEqual(sent.map((mail) => mail.to), ['gaurav@example.test']);

  sent.length = 0;
  const payment = await notifyPurchaseOrderDecision({
    approval, lead: {
      ...lead,
      generatedForUser: 'gaurav-id',
      generatedForName: 'Gaurav Chandra',
      generatedForEmail: 'gaurav@example.test',
      assignments: [{ assignedStaff: 'anand-id', assignedStaffEmail: 'anand@example.test', poYearRows: [{ poNumber: 'PO-1', poAmount: 1000 }] }]
    },
    index: 0, status: 'PAYMENT', remarks: '', paymentReceived: true,
    paymentStatus: { status: 'ADVANCE_RECEIVED', amount: 250, confirmed: false, name: 'Finance User', at: '2026-11-21T10:00:00Z' }, poAmount: 1000
  });
  assert.equal(payment.sent, 3);
  assert.deepEqual(new Set(sent.map((mail) => mail.to)), new Set([
    'gaurav@example.test', 'superadmin@example.test', 'admin@example.test'
  ]));
  assert.ok(adminRoleQueries.length > 0, 'payment notifications query role aliases such as "Super Admin"');
  assert.ok(sent.every((mail) => /payment received/i.test(mail.subject)));
  assert.ok(sent.every((mail) => mail.html.includes('Amount received')));
  assert.ok(sent.every((mail) => mail.html.includes('Recorded by') && mail.html.includes('Finance User') && mail.html.includes('Updated at')));
  assert.ok(sent.every((mail) => mail.html.includes('Payment status')));
  assert.ok(sent.every((mail) => mail.html.includes('Review payment in Finance Approval')));
  assert.ok(sent.every((mail) => mail.html.includes('/finance-approval')));
  assert.ok(sent.every((mail) => !mail.html.includes('display:flex')));

  sent.length = 0;
  const approved = await notifyPurchaseOrderDecision({
    approval,
    lead: {
      ...lead,
      generatedForUser: 'gaurav-id',
      generatedForName: 'Gaurav Chandra',
      generatedForEmail: 'gaurav@example.test'
    },
    index: 0, status: 'APPROVED', remarks: 'Finance approved the PO.'
  });
  assert.equal(approved.failed, 0);
  assert.deepEqual(new Set(sent.map((mail) => mail.to)), new Set([
    'gaurav@example.test', 'superadmin@example.test', 'admin@example.test', 'submitter@example.test'
  ]));
  assert.ok(sent.every((mail) => /PO APPROVED/i.test(mail.subject)));

  sent.length = 0;
  const initialApproval = await notifyPurchaseOrderDecision({
    approval,
    lead: {
      ...lead,
      generatedForUser: 'gaurav-id',
      generatedForName: 'Gaurav Chandra',
      generatedForEmail: 'gaurav@example.test'
    },
    index: 0, status: 'FINANCE_PENDING', remarks: 'Admin review completed.', initialApproval: true
  });
  assert.equal(initialApproval.failed, 0);
  assert.ok(sent.some((mail) => mail.to === 'gaurav@example.test'));
  assert.ok(sent.every((mail) => /passed Admin review/i.test(mail.subject)));
  assert.ok(sent.every((mail) => /awaiting Finance approval/i.test(mail.html)));

  const preview = leadTest.buildPurchaseOrderEmail({
    eyebrow: 'Payment update', title: 'Advance payment received', message: 'A payment was recorded.',
    clientName: 'Example Ltd', leadCode: 'LEAD-1', rows: [], status: 'PAYMENT',
    summaryHtml: '<table><tr><td>Amount received</td></tr></table>',
    actionUrl: 'https://crm.example.test/finance-approval',
    actionLabel: 'Review payment in Finance Approval'
  });
  assert.match(preview, /role="presentation"/);
  assert.match(preview, /Review payment in Finance Approval/);
  assert.match(preview, /Anant Tattva CRM/);

  sent.length = 0;
  const retry = await notifyPurchaseOrderDecision({
    approval, lead, index: 0, status: 'REFERRED', remarks: 'Please confirm payment terms.',
    specialApproval: true, ownerOnly: true
  });
  assert.equal(retry.recipients, 1);
  assert.equal(retry.sent, 1);
  assert.deepEqual(sent.map((mail) => mail.to), ['owner@example.test']);
  assert.ok(sent[0].subject.includes('PO Special Approval requested'));

  sent.length = 0;
  const legacyRetry = await notifyPurchaseOrderDecision({
    approval: { ...approval, payload: { ...approval.payload, service: { assignedStaffCrmUserId: 'owner-crm' } } },
    lead: { ...lead, assignments: [{ poYearRows: [{ poNumber: 'PO-1', poAmount: 1000 }] }] },
    index: 0, status: 'REFERRED', remarks: '', specialApproval: true, ownerOnly: true
  });
  assert.equal(legacyRetry.recipients, 1);
  assert.deepEqual(sent.map((mail) => mail.to), ['owner@example.test']);

  sent.length = 0;
  const serviceMatchedRetry = await notifyPurchaseOrderDecision({
    approval: { ...approval, payload: { ...approval.payload, assignedServiceId: 'service-a' } },
    lead: {
      ...lead,
      assignedStaffEmail: 'wrong-lead-owner@example.test',
      assignments: [{ assignedServiceId: 'service-a' }, { assignedServiceId: 'service-b' }],
      serviceSelections: [
        { assignedServiceId: 'service-b', assignedStaffCrmUserId: 'wrong-crm' },
        { assignedServiceId: 'service-a', assignedStaffCrmUserId: 'owner-crm' }
      ]
    },
    index: 0, status: 'REFERRED', remarks: '', specialApproval: true, ownerOnly: true
  });
  assert.equal(serviceMatchedRetry.recipients, 1);
  assert.deepEqual(sent.map((mail) => mail.to), ['owner@example.test']);

  sent.length = 0;
  const closedOnBehalfRetry = await notifyPurchaseOrderDecision({
    approval: { ...approval, payload: { ...approval.payload, assignedServiceId: 'service-a' } },
    lead: {
      ...lead,
      assignments: [{
        assignedServiceId: 'service-a',
        closedOnBehalfOfUser: 'owner-crm',
        closedOnBehalfOfName: 'Owner User',
        closedOnBehalfOfEmail: 'owner@example.test'
      }]
    },
    index: 0, status: 'REFERRED', remarks: '', specialApproval: true, ownerOnly: true
  });
  assert.equal(closedOnBehalfRetry.recipients, 1);
  assert.deepEqual(sent.map((mail) => mail.to), ['owner@example.test']);
});

test('Finance Approval is visible to authenticated users and sidebar refreshes authenticated roles', () => {
  const dashboard = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/constants/dashboard.js'), 'utf8');
  const sidebar = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/dashboard/Sidebar.jsx'), 'utf8');
  const app = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/App.jsx'), 'utf8');
  const financeController = fs.readFileSync(path.resolve(__dirname, '../src/controllers/poFinanceController.js'), 'utf8');

  assert.match(dashboard, /label: 'Finance Approval'.*path: '\/finance-approval'/);
  assert.doesNotMatch(dashboard.match(/label: 'Finance Approval'[^\n]*/)?.[0] || '', /roles:/);
  assert.match(app, /path="\/finance-approval" element=\{<ProtectedRoute>/);
  assert.match(sidebar, /api\.get\('\/auth\/me'\)/);
  assert.match(sidebar, /setSidebarUser\(data\.user\)/);
  assert.match(financeController, /filterAssignedLeadOwnerApprovals\(approvals, req\.user\)/);
  assert.match(financeController, /exports\.resendOwnerNotification/);
});

test('lead owner request rows and details are restricted to the assigned owner', () => {
  const approval = { payload: { assignmentIndex: 0 } };
  assert.equal(financeTest.isAssignedLeadOwner(approval, {
    assignments: [{ assignedStaff: 'owner-1' }]
  }, 'owner-1'), true);
  assert.equal(financeTest.isAssignedLeadOwner(approval, {
    assignments: [{ assignedStaff: 'owner-1' }]
  }, 'owner-2'), false);
  const leadWithPrimaryOwner = {
    generatedForUser: 'gaurav-id',
    generatedForName: 'Gaurav Chandra',
    generatedForEmail: 'gaurav@example.test',
    assignments: [{ assignedStaff: 'anand-id', assignedStaffEmail: 'anand@example.test' }]
  };
  assert.equal(financeTest.isAssignedLeadOwner(approval, leadWithPrimaryOwner, {
    _id: 'gaurav-id', name: 'Gaurav Chandra', email: 'gaurav@example.test'
  }), true);
  assert.equal(financeTest.isAssignedLeadOwner(approval, leadWithPrimaryOwner, {
    _id: 'anand-id', name: 'Anand Padhya', email: 'anand@example.test'
  }), false);
  assert.equal(financeTest.isAssignedLeadOwner({ payload: { assignedServiceId: 'service-2' } }, {
    assignments: [{ assignedServiceId: 'service-1', assignedStaff: 'owner-1' }, { assignedServiceId: 'service-2', assignedStaff: 'owner-2' }]
  }, 'owner-2'), true);
  assert.equal(financeTest.isAssignedLeadOwner({ payload: { assignmentIndex: 0 } }, {
    assignments: [{ assignedStaffText: 'Ritual Owner', assignedStaffEmail: 'ritual@example.test' }]
  }, { _id: 'owner-3', name: 'Ritual Owner', email: 'ritual@example.test' }), true);
  assert.equal(financeTest.isAssignedLeadOwner({ payload: { assignmentIndex: 0, service: { assignedStaffCrmUserId: 'owner-crm' } } }, {
    assignments: [{}]
  }, { _id: 'owner-3', crmUserId: 'owner-crm' }), true);
  assert.equal(financeTest.isAssignedLeadOwner({ payload: { assignedServiceId: 'service-a' } }, {
    assignments: [],
    serviceSelections: [
      { assignedServiceId: 'service-b', assignedStaffCrmUserId: 'other-crm' },
      { assignedServiceId: 'service-a', assignedStaffCrmUserId: 'owner-crm' }
    ]
  }, { _id: 'owner-3', crmUserId: 'owner-crm' }), true);
  assert.equal(financeTest.isAssignedLeadOwner({ payload: { assignedServiceId: 'service-a' } }, {
    assignments: [{ assignedServiceId: 'service-a' }, { assignedServiceId: 'service-b' }],
    assignedStaffEmail: 'lead-wide@example.test',
    serviceSelections: [
      { assignedServiceId: 'service-b', assignedStaffCrmUserId: 'other-crm' },
      { assignedServiceId: 'service-a', assignedStaffCrmUserId: 'owner-crm' }
    ]
  }, { _id: 'owner-4', email: 'lead-wide@example.test' }), false);
  assert.equal(financeTest.isAssignedLeadOwner({ payload: { assignmentIndex: 0 } }, {
    assignments: [{ closedOnBehalfOfUser: 'owner-5', closedOnBehalfOfName: 'Owner User', closedOnBehalfOfEmail: 'owner@example.test' }]
  }, { _id: 'owner-5', email: 'owner@example.test', name: 'Owner User' }), true);
  assert.equal(financeTest.isAssignedLeadOwner({ payload: { assignmentIndex: 0 } }, {
    assignments: [{ assignedStaff: 'other-owner', closedOnBehalfOfUser: 'owner-6', closedOnBehalfOfEmail: 'owner@example.test' }]
  }, { _id: 'owner-6', email: 'owner@example.test' }), false);
});
