const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const User = require('../src/models/User');
const mailer = require('../src/utils/mailer');

function queryResult(rows) {
  return { select() { return this; }, lean: async () => rows };
}

test('PO referral and payment notifications reach the owner and secondary-role admins', async (t) => {
  const originalFind = User.find;
  const originalSendMail = mailer.sendMail;
  const controllerPath = require.resolve('../src/controllers/leadController');
  const sent = [];
  const owner = { email: 'owner@example.test' };
  const superAdmin = { email: 'superadmin@example.test' };
  const admin = { email: 'admin@example.test' };
  const submitter = { email: 'submitter@example.test' };

  User.find = (filter) => {
    if (filter._id) return queryResult([owner]);
    const clauses = filter.$or || [];
    if (clauses.some((clause) => clause.roles?.$in?.includes('accounts'))) return queryResult([]);
    if (clauses.some((clause) => clause._id)) return queryResult([superAdmin, admin, submitter]);
    return queryResult([superAdmin, admin]);
  };
  mailer.sendMail = async (to, subject, html) => {
    sent.push({ to, subject, html });
    return { summary: { accepted: [to], rejected: [] } };
  };
  delete require.cache[controllerPath];
  const { notifyPurchaseOrderDecision } = require('../src/controllers/leadController');

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
  assert.equal(referral.sent, 4);
  assert.deepEqual(new Set(sent.map((mail) => mail.to)), new Set([
    'owner@example.test', 'superadmin@example.test', 'admin@example.test', 'submitter@example.test'
  ]));
  assert.ok(sent.every((mail) => mail.subject.includes('PO Special Approval requested')));
  assert.ok(sent.every((mail) => mail.html.includes('Please confirm payment terms.')));

  sent.length = 0;
  const payment = await notifyPurchaseOrderDecision({
    approval, lead, index: 0, status: 'PAYMENT', remarks: '', paymentReceived: true,
    paymentStatus: { status: 'ADVANCE_RECEIVED', amount: 250, confirmed: false }, poAmount: 1000
  });
  assert.equal(payment.sent, 3);
  assert.deepEqual(new Set(sent.map((mail) => mail.to)), new Set([
    'owner@example.test', 'superadmin@example.test', 'admin@example.test'
  ]));
  assert.ok(sent.every((mail) => mail.subject.includes('Payment received')));
  assert.ok(sent.every((mail) => mail.html.includes('Received amount')));
});

test('Finance Approval remains role restricted and sidebar refreshes authenticated roles', () => {
  const dashboard = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/constants/dashboard.js'), 'utf8');
  const sidebar = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/dashboard/Sidebar.jsx'), 'utf8');
  const app = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/App.jsx'), 'utf8');

  assert.match(dashboard, /label: 'Finance Approval'.*roles: \['accounts', 'finance', 'admin', 'superadmin'\]/);
  assert.match(app, /path="\/finance-approval".*allowedRoles=\{\['accounts', 'finance', 'admin', 'superadmin'\]\}/);
  assert.match(sidebar, /api\.get\('\/auth\/me'\)/);
  assert.match(sidebar, /setSidebarUser\(data\.user\)/);
});

