const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('quotation list shows Admin approval to regular users while final approval is pending', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
  assert.match(page, /function isQuotationAdminApproved\(row = \{\}\)/);
  assert.match(page, /isQuotationAdminApproved\(row\).*Admin Approved/s);
  assert.match(page, /managementApproval\?\.adminApprovalStatus/);
  assert.match(page, /approvalDecision\?\.approvalKind/);
});
