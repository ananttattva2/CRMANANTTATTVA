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
    trafficSources: []
  };
}

function count(rows, reps, previous = false) {
  for (const row of rows) {
    const owner = String(row.owner || 'Unassigned').trim() || 'Unassigned';
    if (!reps.has(owner)) reps.set(owner, blankRep(owner));
    const rep = reps.get(owner);
    const prefix = previous ? 'previous' : '';
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
      .map(({ label, count }) => ({ label, count }));
  }
  return [...reps.values()].sort((a, b) => {
    const aTotal = a.hotOpen + a.hotClosed + a.coldOpen;
    const bTotal = b.hotOpen + b.hotClosed + b.coldOpen;
    return bTotal - aTotal || a.owner.localeCompare(b.owner);
  });
}
