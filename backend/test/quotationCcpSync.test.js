const test = require('node:test');
const assert = require('node:assert/strict');
const quotationController = require('../src/controllers/quotationController');
const fs = require('node:fs');
const path = require('node:path');

test('every revised quotation maps to a fresh pending approval request', () => {
  const row = quotationController.mapQuotationPendingApprovalRow({
    _id: '64b000000000000000000001',
    quotationNumber: 'AT/26-27/001',
    status: 'draft',
    createdAt: '2026-09-28T07:00:00.000Z',
    managementApproval: { requestedAt: '2026-10-15T06:30:00.000Z' },
    leadDetails: { companyName: 'Updated Company' },
    items: []
  }, 'UPDATE');
  assert.equal(row.approvalStatus, 'PENDING');
  assert.equal(row.approvalType, 'UPDATE');
  assert.equal(row.quotationDate, '15/10/2026');
  assert.equal(row.requestDate, '15/10/2026');
  assert.equal(new Date(row.createdAt).toISOString(), '2026-09-28T07:00:00.000Z');
});

test('revised quotation falls back to its latest revision date for approval display', () => {
  const row = quotationController.mapQuotationPendingApprovalRow({
    _id: '64b000000000000000000002',
    quotationNumber: 'AT/26-27/002',
    status: 'draft',
    createdAt: '2026-09-28T07:00:00.000Z',
    updatedAt: '2026-10-14T07:00:00.000Z',
    revisionHistory: [{ at: '2026-10-15T00:30:00.000Z' }],
    leadDetails: { companyName: 'Updated Company' },
    items: []
  }, 'UPDATE');

  assert.equal(row.quotationDate, '15/10/2026');
  assert.equal(row.requestDate, '15/10/2026');
});

test('quotation approval endpoints are restricted to admin roles', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/quotations.js'), 'utf8');
  assert.match(routes, /approve-all[^\n]+requireRoles\(ADMIN_ROLES\)/);
  assert.match(routes, /:id\/approval[^\n]+requireRoles\(ADMIN_ROLES\)/);
});

test('company normalization treats common legal suffix variants consistently', () => {
  const { normalizeCompanyName } = quotationController._test;
  assert.equal(normalizeCompanyName('Example Pvt. Ltd.'), normalizeCompanyName('Example Private Limited'));
  assert.equal(normalizeCompanyName('A & B LLP'), normalizeCompanyName('A and B L.L.P.'));
});

test('quotation approval sync does not overwrite a terminal CRM approval with submitted', () => {
  const { preserveTerminalApprovalStatus } = quotationController._test;
  assert.equal(preserveTerminalApprovalStatus({ status: 'approved' }, { status: 'submitted' }).status, 'approved');
  assert.equal(preserveTerminalApprovalStatus({ status: 'rejected' }, { status: 'draft' }).status, 'rejected');
  assert.equal(preserveTerminalApprovalStatus({ status: 'draft' }, { status: 'submitted' }).status, 'submitted');
});
