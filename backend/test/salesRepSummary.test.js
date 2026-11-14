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

test('dashboard separates unassigned Hot leads without losing totals or comparison values', async () => {
 const { salesRepSummary, salesRepTableData } = await import('../../frontend/src/utils/salesRepSummary.mjs');
 const raw = salesRepSummary([
  {kind:'hot',state:'open',owner:'Asha',revenuePaise:100},
  {kind:'hot',state:'closed',owner:'Asha',poAmountPaise:500},
  {kind:'hot',state:'open',owner:'Unassigned',revenuePaise:200},
  {kind:'hot',state:'closed',owner:'Unassigned',poAmountPaise:700},
  {kind:'cold',state:'open',owner:'Unassigned',revenuePaise:300}
 ], [{kind:'hot',state:'open',owner:'Unassigned'}]);
 const before = JSON.stringify(raw);
 const { reps, totals } = salesRepTableData(raw);
 assert.deepEqual(reps.map(rep=>rep.owner), ['Asha']);
 assert.equal(totals.hotClosed,1); assert.equal(totals.hotOpen,1); assert.equal(totals.hotUnassigned,2);
 assert.equal(totals.totalLeads,5); assert.equal(totals.coldOpen,1);
 assert.equal(totals.hotClosed+totals.hotOpen+totals.hotUnassigned+totals.coldOpen, totals.totalLeads);
 assert.equal(totals.expectedRevenuePaise,600);assert.equal(totals.poValuePaise,1200);
 assert.equal(totals.previousHotUnassigned,1);
 assert.equal(JSON.stringify(raw),before);
});

test('unassigned-only and empty dashboards keep a visible count without a fake representative', async () => {
 const {salesRepSummary,salesRepTableData}=await import('../../frontend/src/utils/salesRepSummary.mjs');
 assert.equal(salesRepTableData([]).totals.hotUnassigned,0);
 const data=salesRepTableData(salesRepSummary([{kind:'hot',state:'open',owner:''}]));
 assert.equal(data.reps.length,0);assert.equal(data.totals.hotUnassigned,1);assert.equal(data.totals.totalLeads,1);
});

test('released leads are attributed to their recorded previous owner without inflating current open counts',async()=>{
 const {salesRepSummary,salesRepTableData}=await import('../../frontend/src/utils/salesRepSummary.mjs');
 const rows=[...Array.from({length:8},(_,i)=>({id:'a'+i,kind:'hot',state:'open',owner:'Anand'})),...Array.from({length:2},(_,i)=>({id:'u'+i,kind:'hot',state:'open',owner:'Unassigned',previousOwner:'Anand'})),{kind:'hot',state:'open',owner:'Unassigned',previousOwner:'Other'}, {kind:'hot',state:'open',owner:'Unassigned'}];
 const {reps,totals}=salesRepTableData(salesRepSummary(rows));const anand=reps.find(rep=>rep.owner==='Anand');
 assert.equal(anand.hotOpen,8);assert.equal(anand.hotUnassigned,2);assert.equal(anand.totalLeads,10);assert.equal(reps.find(rep=>rep.owner==='Other').hotUnassigned,1);
 assert.equal(totals.hotUnassigned,4);assert.equal(totals.totalLeads,12);assert.equal(totals.hotOpen+totals.hotClosed+totals.hotUnassigned+totals.coldOpen,12);
});
