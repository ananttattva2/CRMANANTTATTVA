import { uniquePipelineRows } from './leadPipeline.mjs';
export const BASE_TRAFFIC_SOURCES = ['TeleCalling', 'Referral', 'Physical Visit', 'Campaign', 'Existing Client', 'Web Database', 'Webinar', 'Seminar', 'Exhibition', 'Associate Reference', 'Government', 'Call'];
export const UNKNOWN_SOURCE = 'Other / Not specified';
export function trafficSourceKey(value) {
  return String(value || UNKNOWN_SOURCE).trim().toLowerCase().replace(/[^a-z0-9]/g, '') || 'othernotspecified';
}
export function trafficSourceSummary(rows = [], configured = []) {
  const modes = new Map();
  for (const label of [...BASE_TRAFFIC_SOURCES, ...configured, ...rows.map(r => r.communicationMode), UNKNOWN_SOURCE]) {
    const clean = String(label || '').trim();
    if (clean && !modes.has(trafficSourceKey(clean))) modes.set(trafficSourceKey(clean), { key: trafficSourceKey(clean), label: clean, count: 0 });
  }
  const unique = uniquePipelineRows(rows);
  for (const row of unique) modes.get(trafficSourceKey(row.communicationMode)).count++;
  return [...modes.values()].map(source => ({ ...source, percentage: unique.length ? source.count / unique.length * 100 : 0 }));
}
