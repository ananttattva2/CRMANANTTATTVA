const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/LeadGeneration.jsx'), 'utf8');
const start = source.indexOf('function LeadDirectoryView');
const end = source.indexOf('function MetricOutputCard', start);
const directory = source.slice(start, end);

test('lead directory shows service Accounts IDs, omits Applicant Type, and preserves table alignment', () => {
  assert.ok(start >= 0 && end > start);
  assert.match(directory, /\['Lead ID', 'w-\[140px\]'\], \['Account ID', 'w-\[150px\]'\], \['Company', 'w-\[170px\]'\], \['Service Category'/);
  assert.match(directory, /leadAccountsRecordIds\(item\)/);
  assert.doesNotMatch(directory, /\['Applicant Type', 'w-\[120px\]'\]/);
  assert.doesNotMatch(directory, /\{item\.piboCategory \|\| '-'\}/);
  assert.match(directory, /colSpan=\{15\}/);
});

test('lead directory and Excel export show PO-backed closure status', () => {
  assert.match(directory, /function leadClosureDetails\(item = \{\}\)/);
  assert.match(directory, /status: hasPo && hasApprovedClosure \? 'Closed' : 'Still Not Closed'/);
  assert.match(directory, /Status: closure\.status/);
  assert.match(directory, /'Lead Pipeline Status': closure\.pipelineStatus/);
  assert.match(directory, /'PO Number\(s\)': closure\.poNumbers\.join\(', '\)/);
  assert.match(directory, /\{leadClosureDetails\(item\)\.status\}<\/span>/);
});
