const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const esbuild = require('../../frontend/node_modules/esbuild');
const React = require('../../frontend/node_modules/react');
const { renderToStaticMarkup } = require('../../frontend/node_modules/react-dom/server');

const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/PendingApproval.jsx'), 'utf8');
const helpers = source.slice(source.indexOf('function formatAmount('), source.indexOf('function NormalizedPoProof('));
const normalization = source.slice(source.indexOf('function normalizePoApprovalRow('), source.indexOf('function SubmittedPoReview('));
const start = source.indexOf('filteredLeadClosureApprovals.map((row) => {');
const end = source.indexOf('\n                </ApprovalTable>', start);
const closureStatus = source.slice(source.indexOf('function leadClosureApproved('), source.indexOf('function getApprovalStatus('));
const expression = source.slice(start, end).trim().replace(/\}$/, '');

function renderRows(rows) {
  // Execute the production JSX callback so undefined render helpers fail here.
  const code = esbuild.transformSync(`${helpers}\n${normalization}\n${closureStatus}\nresult = (${expression});`, { loader: 'jsx', format: 'cjs' }).code;
  const context = {
    React, console: { debug() {} }, filteredLeadClosureApprovals: rows,
    savingId: '', canApprove: true, openLeadClosureApproval() {},
  };
  vm.runInNewContext(code, context);
  return renderToStaticMarkup(React.createElement('table', null, React.createElement('tbody', null, context.result)));
}

test('Lead Closure Approval renders multi-row PO totals without missing helpers', () => {
  const html = renderRows([{ _id: 'approval-1', clientName: 'Demo Client', payload: {
    poYearRows: [{ poNumber: 'PO-1', poAmount: '1200' }, { poNumber: 'PO-2', poAmount: 300 }],
  } }]);
  assert.match(html, /Demo Client/);
  assert.match(html, /₹1,500\.00/);
  assert.match(html, /Awaiting Lead Closure Approval/);
  assert.match(html, />Approve<\/button>/);
});

test('Lead Closure Approval handles legacy payloads and missing PO data', () => {
  assert.match(renderRows([{ id: 'legacy', payload: { poNumber: 'OLD-PO', poAmount: 2500 } }]), /₹2,500\.00/);
  assert.match(renderRows([{ id: 'empty' }]), /<td>—<\/td>/);
  assert.equal(renderRows([]), '<table><tbody></tbody></table>');
});

test('Lead Closure Approval displays finance remarks, payment date and legacy payment text', () => {
  const row = { id: 'review', poReview: {
    financeReferral: { remarks: 'Confirm advance before closure' },
    leadOwnerRequest: { paymentDate: '2026-12-15' }
  } };
  const html = renderRows([row]);
  assert.match(html, /Confirm advance before closure/);
  assert.match(html, /15 Dec 2026/);
  row.poReview.leadOwnerRequest = { paymentData: 'Payment expected after delivery' };
  assert.match(renderRows([row]), /Payment expected after delivery/);
});

test('Lead Closure Approval retains Super Admin approvals after the final Finance decision', () => {
  const html = renderRows([{ id: 'approved', poReview: {
    stage: 'FINALIZED', leadClosureApproval: { name: 'Super Admin', remarks: 'Go ahead' }
  } }]);
  assert.match(html, />Approved</);
  assert.match(html, /By Super Admin/);
  assert.match(html, /Go ahead/);
  assert.match(html, /View PO Details/);
  assert.doesNotMatch(html, />Approve<\/button>/);
  assert.match(source, /\) : activeTab === 'epr-credit' \? <CreditRateApprovals/);
});
