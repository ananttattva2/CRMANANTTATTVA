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

function excludesExistingLead(row) {
  return row.existingLead === true
    || String(row.existingClient || '').trim().toLowerCase() === 'yes'
    || /^existing client\b/i.test(String(row.status || '').trim());
}

export function salesRepSummary(currentRows = [], previousRows = [], configuredSources = []) {
  const eligibleCurrentRows = currentRows.filter((row) => !excludesExistingLead(row));
  const eligiblePreviousRows = previousRows.filter((row) => !excludesExistingLead(row));
  const reps = new Map();
  count(eligibleCurrentRows, reps);
  count(eligiblePreviousRows, reps, true);
  for (const rep of reps.values()) {
    rep.trafficSources = trafficSourceHierarchy(eligibleCurrentRows.filter((row) => (String(row.owner || 'Unassigned').trim() || 'Unassigned') === rep.owner), configuredSources)
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
