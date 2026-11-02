const test = require('node:test');
const assert = require('node:assert/strict');

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

test('week and month comparison ranges use the immediately preceding calendar period', async () => {
  const { previousPipelinePeriodRange } = await import('../../frontend/src/utils/leadPipeline.mjs');
  const week = previousPipelinePeriodRange('week', '2026-11-02');
  assert.equal(new Date(week.start).getFullYear(), 2026);
  assert.equal(new Date(week.start).getMonth(), 9);
  assert.equal(new Date(week.start).getDate(), 26);
  const month = previousPipelinePeriodRange('month', '2026-11-15');
  assert.equal(new Date(month.start).getMonth(), 9);
  assert.equal(new Date(month.end).getMonth(), 10);
  assert.equal(previousPipelinePeriodRange('year', '2026-01-01'), null);
});
