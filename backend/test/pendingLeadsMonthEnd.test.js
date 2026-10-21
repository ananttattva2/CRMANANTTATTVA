const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Lead Open review retains completed India month-end snapshots', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/PendingLeads.jsx'), 'utf8');
  assert.match(page, /function latestVisibleReviewMonth\(input = new Date\(\)\)/);
  assert.match(page, /function buildMonthEndReviewRows\(leads = \[\], input = new Date\(\)\)/);
  assert.match(page, /Currently open leads are counted once/);
  assert.match(page, /monthFilter === 'all' \? currentOpenLeads/);
  assert.doesNotMatch(page, /isIndiaMonthEnd\(\) && servicesForMode/);
  assert.doesNotMatch(page, /PENDING_AFTER_MS|15 minutes or more|pending for 15 minutes/);
});

test('optimized month-end review preserves historical rows and India midnight boundaries', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/PendingLeads.jsx'), 'utf8');
  const helpers = source.slice(source.indexOf('function idFor'), source.indexOf('const PAGE_SIZE'));
  const context = vm.createContext({ Date, Intl });
  vm.runInContext(helpers, context);
  const rows = context.buildMonthEndReviewRows([
    { _id: 'open', createdAt: '2026-01-10', serviceSelections: [{ servicesOffered: 'Registration' }] },
    { _id: 'closed', createdAt: '2026-01-15', closedAt: '2026-03-10', closedBy: 'Owner' },
    { _id: 'boundary', createdAt: '2026-02-05', closedAt: '2026-03-31T18:30:00Z', closedBy: 'Owner' },
    { _id: 'new-service', createdAt: '2026-02-15', serviceSelections: [{ createdAt: '2026-02-28T18:30:00Z' }] },
    { _id: 'undated-close', createdAt: '2026-01-01', closedBy: 'Owner' },
    { _id: 'future', createdAt: '2026-11-01' }
  ], new Date('2026-10-13T12:00:00+05:30'));
  const months = id => Array.from(rows).filter(row => row._id === id).map(row => row.__reviewMonth);
  assert.deepEqual(months('closed'), ['2026-01', '2026-02']);
  assert.deepEqual(months('boundary'), ['2026-02', '2026-03']);
  assert.equal(months('open').length, 9);
  assert.equal(months('new-service')[0], '2026-03');
  assert.equal(months('new-service').length, 7);
  assert.deepEqual(months('undated-close'), []);
  assert.deepEqual(months('future'), []);
  assert.equal(rows.length, 20);
});
