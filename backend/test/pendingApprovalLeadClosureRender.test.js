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
const expression = source.slice(start, end).trim().replace(/\}$/, '');

function renderRows(rows) {
  // Execute the production JSX callback so undefined render helpers fail here.
  const code = esbuild.transformSync(`${helpers}\n${normalization}\nresult = (${expression});`, { loader: 'jsx', format: 'cjs' }).code;
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
