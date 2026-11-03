const test = require('node:test');
const assert = require('node:assert/strict');

test('period comparisons include exact revenue and PO amounts and previous-only owners', async () => {
  const { salesRepSummary } = await import('../../frontend/src/utils/salesRepSummary.mjs');
  const reps = salesRepSummary([
    { kind: 'hot', state: 'open', owner: 'Asha', revenuePaise: 105050, poAmountPaise: 0 },
    { kind: 'hot', state: 'closed', owner: 'Asha', revenuePaise: 230025, poAmountPaise: 700099 },
    { kind: 'cold', state: 'open', owner: 'Asha' }
  ], [
    { kind: 'hot', state: 'closed', owner: 'Asha', revenuePaise: 50000, poAmountPaise: 800000 },
    { kind: 'cold', state: 'open', owner: 'Previous only', revenuePaise: 12345 }
  ]);
  const asha = reps.find(rep => rep.owner === 'Asha');
  assert.equal(asha.totalLeads, 3);
  assert.equal(asha.previousTotalLeads, 1);
  assert.equal(asha.expectedRevenuePaise, 335075);
  assert.equal(asha.previousExpectedRevenuePaise, 50000);
  assert.equal(asha.poValuePaise, 700099);
  assert.equal(asha.previousPoValuePaise, 800000);
  const prior = reps.find(rep => rep.owner === 'Previous only');
  assert.equal(prior.totalLeads, 0);
  assert.equal(prior.previousTotalLeads, 1);
  assert.equal(prior.expectedRevenuePaise, 0);
  assert.equal(prior.previousExpectedRevenuePaise, 12345);
});

test('month comparison uses adjacent non-overlapping periods and omits converted cold history', async () => {
  const { salesRepSummary } = await import('../../frontend/src/utils/salesRepSummary.mjs');
  const { currentPipelineRows, pipelinePeriodRange, previousPipelinePeriodRange, inPipelinePeriod } = await import('../../frontend/src/utils/leadPipeline.mjs');
  const rows = [
    { kind: 'hot', state: 'open', owner: 'Asha', createdAt: '2026-11-01T12:00:00', revenuePaise: 20000 },
    { kind: 'cold', owner: 'Asha', createdAt: '2026-11-01T12:00:00', converted: true, revenuePaise: 20000 },
    { kind: 'hot', state: 'closed', owner: 'Asha', createdAt: '2026-10-31T12:00:00', poAmountPaise: 30000 },
    { kind: 'hot', state: 'open', owner: 'Asha', createdAt: '2026-09-30T12:00:00', revenuePaise: 990000 }
  ];
  const current = pipelinePeriodRange('month', '2026-11-03');
  const previous = previousPipelinePeriodRange('month', '2026-11-03');
  const [rep] = salesRepSummary(currentPipelineRows(rows.filter(row => inPipelinePeriod(row.createdAt, current))), currentPipelineRows(rows.filter(row => inPipelinePeriod(row.createdAt, previous))));
  assert.equal(rep.totalLeads, 1);
  assert.equal(rep.previousTotalLeads, 1);
  assert.equal(rep.expectedRevenuePaise, 20000);
  assert.equal(rep.previousExpectedRevenuePaise, 0);
  assert.equal(rep.previousPoValuePaise, 30000);
});

test('sales rep summary keeps Hot states separate and combines every Cold state into Open', async () => {
  const { salesRepSummary } = await import('../../frontend/src/utils/salesRepSummary.mjs');
  const current = [
    { id: 'h1', kind: 'hot', state: 'open', owner: 'Asha', communicationMode: 'LinkedIn Ads' },
    { id: 'h2', kind: 'hot', state: 'closed', owner: 'Asha', communicationMode: 'LinkedIn Ads' },
    { id: 'c1', kind: 'cold', state: 'open', owner: 'Asha', communicationMode: 'Referral' },
    { id: 'c2', kind: 'cold', state: 'closed', owner: 'Asha', communicationMode: 'Referral' }
  ];
  const [asha] = salesRepSummary(current);
  assert.equal(asha.hotOpen, 1);
  assert.equal(asha.hotClosed, 1);
  assert.equal(asha.coldOpen, 2);
  assert.deepEqual(asha.trafficSources.map(source => [source.label, source.count]), [['Digital Marketing', 2], ['Reference & Referral', 2]]);
});

test('sales rep summary exposes previous-period counts and includes reps with only previous activity', async () => {
  const { salesRepSummary } = await import('../../frontend/src/utils/salesRepSummary.mjs');
  const rows = salesRepSummary(
    [{ id: 'now', kind: 'hot', state: 'open', owner: 'Current' }],
    [{ id: 'old-1', kind: 'cold', state: 'closed', owner: 'Current' }, { id: 'old-2', kind: 'hot', state: 'closed', owner: 'Previous only' }]
  );
  assert.equal(rows.find(row => row.owner === 'Current').previousColdOpen, 1);
  assert.equal(rows.find(row => row.owner === 'Previous only').previousHotClosed, 1);
});

test('sales reps are ranked by total Hot Leads before Cold volume', async () => {
  const { salesRepSummary } = await import('../../frontend/src/utils/salesRepSummary.mjs');
  const rows = salesRepSummary([
    ...Array.from({ length: 8 }, (_, index) => ({ id: `cold-${index}`, kind: 'cold', state: 'open', owner: 'Cold Heavy' })),
    { id: 'hot-1', kind: 'hot', state: 'open', owner: 'Hot Leader' },
    { id: 'hot-2', kind: 'hot', state: 'closed', owner: 'Hot Leader' }
  ]);
  assert.deepEqual(rows.map(row => row.owner), ['Hot Leader', 'Cold Heavy']);
});

test('week, month and quarter comparisons use the immediately preceding calendar period', async () => {
  const { previousPipelinePeriodRange } = await import('../../frontend/src/utils/leadPipeline.mjs');
  const week = previousPipelinePeriodRange('week', '2026-11-02');
  assert.equal(new Date(week.start).getFullYear(), 2026);
  assert.equal(new Date(week.start).getMonth(), 9);
  assert.equal(new Date(week.start).getDate(), 26);
  const month = previousPipelinePeriodRange('month', '2026-11-15');
  assert.equal(new Date(month.start).getMonth(), 9);
  assert.equal(new Date(month.end).getMonth(), 10);
  const quarter = previousPipelinePeriodRange('quarter', '2026-11-15');
  assert.equal(new Date(quarter.start).getMonth(), 6);
  assert.equal(new Date(quarter.end).getMonth(), 9);
  assert.equal(previousPipelinePeriodRange('year', '2026-01-01'), null);
});
