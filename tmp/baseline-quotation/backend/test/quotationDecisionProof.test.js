const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '../src');
const frontendRoot = path.resolve(__dirname, '../../frontend/src');

test('Admin quotation approval requires proof while Super Admin can approve directly', () => {
  const controller = fs.readFileSync(path.join(backendRoot, 'controllers/quotationController.js'), 'utf8');
  const page = fs.readFileSync(path.join(frontendRoot, 'pages/PendingApproval.jsx'), 'utf8');

  assert.match(controller, /status === 'APPROVED' && reviewerRole === 'admin' && !proofUrl/);
  assert.match(controller, /Only Super Admin can approve all quotations without individual proof/);
  assert.match(page, /status === 'APPROVED' && isSuperAdmin/);
  assert.match(page, /Please upload the approval proof/);
});

test('quotation rejection requires a reason and decision evidence is persisted', () => {
  const controller = fs.readFileSync(path.join(backendRoot, 'controllers/quotationController.js'), 'utf8');
  const pendingModel = fs.readFileSync(path.join(backendRoot, 'models/PendingApproval.js'), 'utf8');
  const quotationModel = fs.readFileSync(path.join(backendRoot, 'models/Quotation.js'), 'utf8');

  assert.match(controller, /status === 'REJECTED' && !remarks/);
  assert.match(controller, /quotation\.approvalDecision =/);
  assert.match(pendingModel, /decisionProofUrl/);
  assert.match(quotationModel, /approvalDecision/);
});
