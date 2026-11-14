import { trafficSourceHierarchy } from './trafficSources.mjs';

function blankRep(owner) {
  return {
    owner,
    hotOpen: 0,
    hotClosed: 0,
    coldOpen: 0,
    previousHotOpen: 0,
    previousHotClosed: 0,
    previousColdOpen: 0,
    totalLeads: 0,
    previousTotalLeads: 0,
    expectedRevenuePaise: 0,
    previousExpectedRevenuePaise: 0,
    poValuePaise: 0,
    previousPoValuePaise: 0,
    trafficSources: []
  };
}

function count(rows, reps, previous = false) {
  for (const row of rows) {
    const owner = String(row.owner || 'Unassigned').trim() || 'Unassigned';
    if (!reps.has(owner)) reps.set(owner, blankRep(owner));
    const rep = reps.get(owner);
    const prefix = previous ? 'previous' : '';
    rep[previous ? 'previousTotalLeads' : 'totalLeads'] += 1;
    rep[previous ? 'previousExpectedRevenuePaise' : 'expectedRevenuePaise'] += Number(row.revenuePaise) || 0;
    rep[previous ? 'previousPoValuePaise' : 'poValuePaise'] += Number(row.poAmountPaise) || 0;
    if (row.kind === 'hot' && row.state === 'closed') rep[`${prefix}${previous ? 'HotClosed' : 'hotClosed'}`] += 1;
    else if (row.kind === 'hot') rep[`${prefix}${previous ? 'HotOpen' : 'hotOpen'}`] += 1;
    // Cold Closed is intentionally included in Open for the sales summary.
    if (row.kind === 'cold') rep[`${prefix}${previous ? 'ColdOpen' : 'coldOpen'}`] += 1;
  }
}

export function salesRepSummary(currentRows = [], previousRows = [], configuredSources = []) {
  const reps = new Map();
  count(currentRows, reps);
  count(previousRows, reps, true);
  for (const rep of reps.values()) {
    rep.trafficSources = trafficSourceHierarchy(currentRows.filter((row) => (String(row.owner || 'Unassigned').trim() || 'Unassigned') === rep.owner), configuredSources)
      .filter((source) => source.count > 0)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 3)
      .map(({ label, count, keys }) => ({ label, count, keys }));
  }
  return [...reps.values()].sort((a, b) => {
    const aHot = a.hotOpen + a.hotClosed;
    const bHot = b.hotOpen + b.hotClosed;
    return bHot - aHot || b.hotOpen - a.hotOpen || a.owner.localeCompare(b.owner);
  });
}

// Unowned leads are a separate Hot Leads bucket, never a representative.
export function salesRepTableData(allReps = []) {
  const isUnassigned = rep => !String(rep.owner || '').trim() || String(rep.owner).trim().toLowerCase() === 'unassigned';
  const keys = ['totalLeads', 'hotOpen', 'hotClosed', 'coldOpen', 'expectedRevenuePaise', 'poValuePaise', 'previousTotalLeads', 'previousHotOpen', 'previousHotClosed', 'previousColdOpen', 'previousExpectedRevenuePaise', 'previousPoValuePaise'];
  const sum = rows => rows.reduce((total, rep) => {
    for (const key of keys) total[key] += Number(rep[key]) || 0;
    return total;
  }, Object.fromEntries(keys.map(key => [key, 0])));
  const reps = allReps.filter(rep => !isUnassigned(rep));
  const unassigned = sum(allReps.filter(isUnassigned));
  const totals = sum(allReps);
  totals.hotOpen -= unassigned.hotOpen;
  totals.hotClosed -= unassigned.hotClosed;
  totals.previousHotOpen -= unassigned.previousHotOpen;
  totals.previousHotClosed -= unassigned.previousHotClosed;
  totals.hotUnassigned = unassigned.hotOpen + unassigned.hotClosed;
  totals.previousHotUnassigned = unassigned.previousHotOpen + unassigned.previousHotClosed;
  return { reps, unassigned, totals };
}
